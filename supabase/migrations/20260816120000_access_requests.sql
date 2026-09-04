-- ============================================================
-- 20260816120000_access_requests.sql
-- "Join the club": let a signed-out visitor APPLY for an invite from the
-- landing page, and let an admin turn that application into a real invite
-- from the existing Benutzer page (feedback 56f328ea).
--
-- WHAT THIS CREATES
--   access_requests            — one application per signed-out visitor.
--                                anon/authenticated may INSERT and nothing
--                                else; only admins ever read or decide.
--   access_requests_guard()    — BEFORE INSERT trigger: pins the row's own
--                                decision fields (an applicant must not be
--                                able to file a pre-accepted request), caps
--                                free text, dedupes per email and rate-limits
--                                the table as a whole.
--   pending_access_requests()  — admin RPC, projects the pending queue plus
--                                whether that email is already allowlisted /
--                                already has an account.
--
-- WHY A NEW TABLE AND NOT `allowed_emails`
--   `allowed_emails` IS the "may sign in" source of truth — an unreviewed
--   row in it grants access. An application is the opposite: untrusted text
--   from outside that grants nothing until an admin accepts it. Same
--   separation as admin_feedback's `triaged` gate.
--
-- ACCEPTING IS NOT DONE HERE. The admin's "Annehmen" calls the existing
--   invite-user edge function (allowlist + `sendInvite: true`, so the
--   applicant is actually told — the last action was the admin's), and only
--   then stamps the row `accepted`. That keeps one code path for "someone
--   gets access".
--
-- ALPHA-PHASE DATA POLICY: additive only, nothing dropped.
-- ============================================================

create table public.access_requests (
  id          uuid primary key default gen_random_uuid(),
  email       citext not null,
  -- Optional, purely informational: an RSI handle makes an application
  -- recognisable to an admin who does not know the email address.
  handle      text,
  message     text,
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references auth.users(id) on delete set null
);

comment on table public.access_requests is
  'Invite applications filed from the signed-out landing page. anon may '
  'INSERT only; reading and deciding is admin-only. An accepted request is '
  'turned into access by the invite-user edge function, never by a write '
  'to this table alone. See feedback 56f328ea.';

-- The admin queue is "pending, oldest first"; the partial index also backs
-- the uniqueness rule below.
create unique index access_requests_pending_email_idx
  on public.access_requests (email) where status = 'pending';
create index access_requests_created_idx on public.access_requests (created_at desc);
create index access_requests_status_idx on public.access_requests (status);

-- ============================================================
-- Guard trigger — the applicant controls the text, nothing else
-- ============================================================
create or replace function public.access_requests_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  recent_total int;
begin
  -- 1. Pin everything that is a decision, not an application. A WITH CHECK
  -- alone would reject (and leak) instead of normalising, and any caller
  -- that omits the column would fail with a bare permission error.
  new.status     := 'pending';
  new.decided_at := null;
  new.decided_by := null;
  new.created_at := now();

  new.email := lower(trim(new.email::text))::citext;
  if new.email::text !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  -- 2. Cap the free text. These land in an admin UI; unbounded input from
  -- an unauthenticated caller is a storage and rendering problem.
  new.handle  := nullif(left(trim(coalesce(new.handle, '')), 64), '');
  new.message := nullif(left(trim(coalesce(new.message, '')), 2000), '');

  -- 3. Dedupe: one open application per address. Silently keeping the first
  -- one is the friendly read of a double-submit, and the unique index above
  -- makes it impossible either way — this just gives a stable error code the
  -- client can treat as success (never confirming to a stranger whether an
  -- application for someone else's address exists).
  if exists (
    select 1 from public.access_requests r
    where r.email = new.email and r.status = 'pending'
  ) then
    raise exception 'duplicate access request' using errcode = '23505';
  end if;

  -- 4. Blunt flood protection for a table anyone on the internet can write
  -- to. 20/hour is far above real demand for an invite-only alpha and well
  -- below "the admin's queue is now unusable".
  select count(*) into recent_total
  from public.access_requests r
  where r.created_at > now() - interval '1 hour';
  if recent_total >= 20 then
    raise exception 'too many access requests, try again later'
      using errcode = '53400';
  end if;

  return new;
end;
$$;

create trigger access_requests_guard_trg
  before insert on public.access_requests
  for each row execute function public.access_requests_guard();

-- ============================================================
-- RLS — write-only for the world, admin-only for everything else
-- ============================================================
alter table public.access_requests enable row level security;

drop policy if exists "access_requests_public_insert" on public.access_requests;
create policy "access_requests_public_insert" on public.access_requests
  for insert to anon, authenticated with check (true);

drop policy if exists "access_requests_admin_select" on public.access_requests;
create policy "access_requests_admin_select" on public.access_requests
  for select to authenticated using (public.is_admin());

drop policy if exists "access_requests_admin_update" on public.access_requests;
create policy "access_requests_admin_update" on public.access_requests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "access_requests_admin_delete" on public.access_requests;
create policy "access_requests_admin_delete" on public.access_requests
  for delete to authenticated using (public.is_admin());

-- Supabase grants ALL on anything new in `public` to anon + authenticated by
-- default; strip that and hand back exactly what the policies are written
-- for. anon gets INSERT and nothing else — it must not be able to read back
-- (that would turn the table into an "is X invited?" oracle) and PostgREST
-- would happily return the inserted row otherwise.
revoke all on public.access_requests from public, anon, authenticated;
grant insert on public.access_requests to anon, authenticated;
grant select, update, delete on public.access_requests to authenticated;

-- ============================================================
-- Admin RPC — pending_access_requests()
-- Projects the queue with the two facts an admin needs before accepting:
-- is this address already allowlisted, and does an account already exist.
-- ============================================================
create or replace function public.pending_access_requests()
returns table (
  id           uuid,
  email        citext,
  handle       text,
  message      text,
  created_at   timestamptz,
  allowlisted  boolean,
  joined       boolean
)
language plpgsql security definer set search_path = public, auth stable as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;

  return query
    select
      r.id,
      r.email,
      r.handle,
      r.message,
      r.created_at,
      exists (select 1 from public.allowed_emails a where a.email = r.email) as allowlisted,
      exists (select 1 from auth.users u where u.email = r.email) as joined
    from public.access_requests r
    where r.status = 'pending'
    order by r.created_at asc;
end;
$$;

revoke execute on function public.pending_access_requests() from public, anon;
grant execute on function public.pending_access_requests() to authenticated;

-- ============================================================
-- Admin RPC — decide_access_request(request_id, accept)
-- The stamp half of a decision. Granting access itself stays with the
-- invite-user edge function, which the admin UI calls FIRST; this only
-- records the outcome, so a failed invite never leaves a request marked
-- accepted.
-- ============================================================
create or replace function public.decide_access_request(request_id uuid, accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;

  update public.access_requests
     set status     = case when accept then 'accepted' else 'declined' end,
         decided_at = now(),
         decided_by = auth.uid()
   where id = request_id and status = 'pending';
end;
$$;

revoke execute on function public.decide_access_request(uuid, boolean) from public, anon;
grant execute on function public.decide_access_request(uuid, boolean) to authenticated;
