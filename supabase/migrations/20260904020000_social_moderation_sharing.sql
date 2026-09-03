-- ============================================================
-- 20260904020000_social_moderation_sharing.sql
--
-- Phase 2 of the "users can befriend each other" epic (admin feedback
-- cf0ddf7d). Phase 1 (20260903220000) built the graph and the read-only
-- report feed and left three seams open; the board owner decided all three in
-- the thread, so this migration closes them:
--
--   1. MODERATION — an admin can WARN an account (the "grace period with
--      info to the user" branch) or SUSPEND it. A suspended account keeps no
--      access: `is_approved()` — the RESTRICTIVE RLS gate every self-scoped
--      table already carries — turns false for it, its live sessions are
--      dropped, and the app signs it out and tells it why.
--   2. LOADOUT SHARING — share a role loadout with a friend, or mint an
--      unguessable link ANY visitor (signed out included) can read. There is
--      deliberately NO public-read policy on `hangar_role_loadouts`: the link
--      path is a single SECURITY DEFINER read function keyed on the token.
--   3. FRIEND-REQUEST EXPIRY — a request nobody answers within 7 days is
--      dead. Enforced in the READ and ACCEPT paths, so it is correct with or
--      without a sweeper; `expire_stale_friend_requests()` is bookkeeping
--      sugar for a cron, never the enforcement.
--
-- ADDITIVE. Nothing is dropped except (a) three functions re-created with a
-- widened RETURNS TABLE (same DROP-first pattern and same reason as
-- 20260903220000's `list_users_for_admin`), and (b) the `friend_requests`
-- status CHECK, re-added WIDER with 'expired'. No table, column or row is
-- removed.
--
-- WRITE PATH — unchanged doctrine: no new table gets an INSERT/UPDATE/DELETE
-- policy. Every mutation is a SECURITY DEFINER RPC that pins the actor to
-- auth.uid() (or to is_admin() for the moderation calls).
-- ============================================================


-- ============================================================
-- PART 1 — friend requests expire after 7 days
-- ============================================================

-- One place that owns the number. `list_my_friend_edges`, the accept path,
-- the crossing-request resolution and the sweeper all read it, so the window
-- cannot drift between them.
create or replace function public.friend_request_ttl()
returns interval language sql immutable as $$ select interval '7 days' $$;

grant execute on function public.friend_request_ttl() to authenticated;

-- Widen the status CHECK so the sweeper can record 'expired' instead of
-- silently deleting evidence. The constraint is looked up by definition
-- rather than by name: it was created inline in 20260903220000, and a
-- hard-coded `drop constraint friend_requests_status_check` that misses would
-- leave the OLD, narrower check in place and only fail at runtime.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.friend_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.friend_requests drop constraint %I;', c.conname);
  end loop;
end $$;

alter table public.friend_requests
  add constraint friend_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'expired'));

comment on column public.friend_requests.status is
  'pending | accepted | declined | withdrawn | expired. A pending row older '
  'than friend_request_ttl() counts as expired EVERYWHERE it is read, whether '
  'or not the sweeper has stamped it yet.';

-- Optional cron sugar: flips already-dead rows to 'expired' so the table
-- reads honestly. Deliberately NOT granted to `authenticated` — it is a
-- maintenance sweep, not a user action, and the read paths below do not
-- depend on it having run.
create or replace function public.expire_stale_friend_requests()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.friend_requests
  set status = 'expired', responded_at = now()
  where status = 'pending'
    and created_at < now() - public.friend_request_ttl();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.expire_stale_friend_requests() from public, anon, authenticated;
grant execute on function public.expire_stale_friend_requests() to service_role;

comment on function public.expire_stale_friend_requests() is
  'Housekeeping sweep for a cron. NOT the enforcement: list_my_friend_edges() '
  'hides and respond_friend_request() refuses an over-age pending row anyway.';

-- list_my_friend_edges — hide expired pending rows, project the deadline.
-- DROP first: adding `expires_at` widens RETURNS TABLE, which CREATE OR
-- REPLACE rejects. No-arg function, so the drop is unambiguous.
drop function if exists public.list_my_friend_edges();

create or replace function public.list_my_friend_edges()
returns table (
  kind         text,
  request_id   uuid,
  user_id      uuid,
  display_name text,
  username     citext,
  since        timestamptz,
  expires_at   timestamptz
)
language sql security definer set search_path = public stable as $$
  with me as (select auth.uid() as id)
  select 'friend'::text, null::uuid, p.id, p.display_name, p.username, f.created_at, null::timestamptz
  from public.friendships f
  join me on me.id in (f.user_low, f.user_high)
  join public.profiles p
    on p.id = case when f.user_low = me.id then f.user_high else f.user_low end
  union all
  select 'incoming'::text, r.id, p.id, p.display_name, p.username, r.created_at,
         r.created_at + public.friend_request_ttl()
  from public.friend_requests r
  join me on me.id = r.addressee_id
  join public.profiles p on p.id = r.requester_id
  where r.status = 'pending'
    and r.created_at > now() - public.friend_request_ttl()
  union all
  select 'outgoing'::text, r.id, p.id, p.display_name, p.username, r.created_at,
         r.created_at + public.friend_request_ttl()
  from public.friend_requests r
  join me on me.id = r.requester_id
  join public.profiles p on p.id = r.addressee_id
  where r.status = 'pending'
    and r.created_at > now() - public.friend_request_ttl()
  union all
  select 'blocked'::text, null::uuid, p.id, p.display_name, p.username, b.created_at, null::timestamptz
  from public.user_blocks b
  join me on me.id = b.blocker_id
  join public.profiles p on p.id = b.blocked_id
  order by 1, 6 desc
$$;

grant execute on function public.list_my_friend_edges() to authenticated;

-- respond_friend_request — an over-age request is gone, not answerable. The
-- caller gets a distinct code so the UI can say "expired" rather than the
-- misleading "request not found".
--
-- It deliberately does NOT stamp the row 'expired' first: RAISE aborts the
-- transaction, so that UPDATE would be rolled back with it — a write that
-- looks like bookkeeping and never lands is worse than no write. The row
-- stays 'pending', which costs nothing: every read path already treats an
-- over-age pending row as gone, the pair-unique upsert in
-- send_friend_request() reuses it, and expire_stale_friend_requests() stamps
-- it if a cron is ever wired up.
create or replace function public.respond_friend_request(request_id uuid, accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  req public.friend_requests%rowtype;
begin
  -- The addressee filter is the authorization check: a request id belonging
  -- to somebody else simply does not resolve.
  select * into req from public.friend_requests
  where id = request_id and addressee_id = caller and status = 'pending';
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  if req.created_at <= now() - public.friend_request_ttl() then
    raise exception 'request_expired' using errcode = 'P0002';
  end if;

  if accept then
    if public.is_blocked_between(caller, req.requester_id) then
      raise exception 'blocked' using errcode = '42501';
    end if;
    insert into public.friendships (user_low, user_high)
    values (least(caller, req.requester_id), greatest(caller, req.requester_id))
    on conflict do nothing;
    update public.friend_requests set status = 'accepted', responded_at = now() where id = req.id;
    return 'accepted';
  end if;

  update public.friend_requests set status = 'declined', responded_at = now() where id = req.id;
  return 'declined';
end;
$$;

grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

-- send_friend_request — the crossing-requests shortcut must not resurrect a
-- request that already timed out: an expired row is stamped and ignored, so
-- "send" starts a fresh 7-day window instead of instantly friending two
-- people off a week-old intent.
create or replace function public.send_friend_request(target uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  reverse_id uuid;
begin
  if target is null or target = caller then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = target) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  -- Same answer for "they blocked me" and "I blocked them": the caller must
  -- not be able to tell the two apart.
  if public.is_blocked_between(caller, target) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  if public.are_friends(caller, target) then
    return 'already_friends';
  end if;

  update public.friend_requests
  set status = 'expired', responded_at = now()
  where requester_id = target and addressee_id = caller
    and status = 'pending'
    and created_at <= now() - public.friend_request_ttl();

  select r.id into reverse_id
  from public.friend_requests r
  where r.requester_id = target and r.addressee_id = caller and r.status = 'pending';

  if reverse_id is not null then
    insert into public.friendships (user_low, user_high)
    values (least(caller, target), greatest(caller, target))
    on conflict do nothing;
    update public.friend_requests
    set status = 'accepted', responded_at = now()
    where id = reverse_id;
    return 'accepted';
  end if;

  insert into public.friend_requests (requester_id, addressee_id, status, created_at, responded_at)
  values (caller, target, 'pending', now(), null)
  on conflict (requester_id, addressee_id) do update
    set status = 'pending', created_at = now(), responded_at = null;
  return 'pending';
end;
$$;

grant execute on function public.send_friend_request(uuid) to authenticated;


-- ============================================================
-- PART 2 — moderation: warnings and account suspension
-- ============================================================

-- Current state lives denormalized on `profiles` and the history lives in
-- `moderation_actions`. Two places on purpose:
--   * `is_approved()` is called by a RESTRICTIVE policy on every self-scoped
--     table, i.e. on essentially every row the app reads. It must stay ONE
--     indexed single-row lookup — resolving "is there an unlifted suspension"
--     out of a ledger on that path would put a correlated subquery in front
--     of the whole database.
--   * the ledger is the audit trail (who suspended whom, why, when, was it
--     lifted) and the delivery channel for a warning the user must see.
-- The RPCs below are the only writers, and they write both in one
-- transaction, so the two cannot drift.
alter table public.profiles add column if not exists suspended_at      timestamptz;
alter table public.profiles add column if not exists suspended_until   timestamptz;
alter table public.profiles add column if not exists suspension_reason text;

comment on column public.profiles.suspended_at is
  'Set by suspend_user(). While set (and suspended_until is null or in the future) is_approved() returns false, which closes every RESTRICTIVE RLS gate in the schema for this account.';
comment on column public.profiles.suspended_until is
  'NULL = indefinite. A past value is an expired suspension and lifts itself.';

create table if not exists public.moderation_actions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  actor_id        uuid references auth.users (id) on delete set null,
  kind            text not null check (kind in ('warning', 'suspension', 'unsuspension')),
  reason          text,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  constraint moderation_actions_reason_len check (reason is null or char_length(reason) <= 2000)
);

create index if not exists moderation_actions_user_idx
  on public.moderation_actions (user_id, created_at desc);
create index if not exists moderation_actions_unack_idx
  on public.moderation_actions (user_id) where kind = 'warning' and acknowledged_at is null;

comment on table public.moderation_actions is
  'Moderation ledger: warnings, suspensions and liftings. Written only through warn_user()/suspend_user()/unsuspend_user(); the target may read (and acknowledge) their own rows, admins read all.';

alter table public.moderation_actions enable row level security;

-- The target reads their own rows. Note there is deliberately NO
-- `is_approved()` RESTRICTIVE gate on this table, unlike every other
-- self-scoped table in the schema: a suspended account has is_approved() =
-- false BY DEFINITION, and this is precisely the table that has to tell it
-- why. Gating it would make the suspension notice unreadable to the only
-- person who needs it.
drop policy if exists "moderation_actions_read_own" on public.moderation_actions;
create policy "moderation_actions_read_own" on public.moderation_actions
  for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

revoke insert, update, delete on public.moderation_actions from anon, authenticated;
revoke all on public.moderation_actions from anon;

-- ------------------------------------------------------------
-- is_suspended / is_approved
-- ------------------------------------------------------------
create or replace function public.is_suspended(target uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.profiles p
    where p.id = target
      and p.suspended_at is not null
      and (p.suspended_until is null or p.suspended_until > now())
  );
$$;

grant execute on function public.is_suspended(uuid) to authenticated;

comment on function public.is_suspended(uuid) is
  'True while the account carries an active suspension. A suspended_until in the past lifts itself without anyone having to run a job.';

-- The blanket enforcement point. Every RESTRICTIVE `*_approved_gate` policy
-- in the schema (20260805120000, 20260903220000, …) already ANDs this in, so
-- widening it here suspends the account across hangar, loadouts, drafts,
-- uploads and the whole social graph in one place, with no policy churn.
-- Behaviour for a non-suspended account is byte-for-byte what it was.
create or replace function public.is_approved()
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((
    select p.is_approved
       and (p.suspended_at is null or (p.suspended_until is not null and p.suspended_until <= now()))
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

comment on function public.is_approved() is
  'True iff the calling auth.uid() has profiles.is_approved = true AND carries no ACTIVE suspension (feedback cf0ddf7d phase 2). Used as a RESTRICTIVE RLS gate on self-scoped tables, so both "never invited" and "suspended" close every gated table at once, including for a direct PostgREST caller.';

-- social_actor() answers with a distinct code so the UI can name the reason
-- instead of showing the generic "not approved".
create or replace function public.social_actor()
returns uuid language plpgsql security definer set search_path = public stable as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.is_suspended(caller) then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  if not public.is_approved() then
    raise exception 'not approved' using errcode = '42501';
  end if;
  return caller;
end;
$$;

grant execute on function public.social_actor() to authenticated;

-- ------------------------------------------------------------
-- my_account_status — what the signed-in client polls
-- ------------------------------------------------------------
-- SECURITY DEFINER and NOT gated on is_approved(), for the same reason the
-- ledger policy is not: a suspended session must be able to learn why it is
-- being signed out. Projects only the caller's own state.
create or replace function public.my_account_status()
returns table (
  suspended          boolean,
  suspended_at       timestamptz,
  suspended_until    timestamptz,
  suspension_reason  text,
  warning_id         uuid,
  warning_reason     text,
  warning_at         timestamptz
)
language sql security definer set search_path = public stable as $$
  select
    public.is_suspended(p.id),
    p.suspended_at,
    p.suspended_until,
    case when public.is_suspended(p.id) then p.suspension_reason else null end,
    w.id, w.reason, w.created_at
  from public.profiles p
  left join lateral (
    select m.id, m.reason, m.created_at
    from public.moderation_actions m
    where m.user_id = p.id and m.kind = 'warning' and m.acknowledged_at is null
    order by m.created_at desc
    limit 1
  ) w on true
  where p.id = auth.uid()
$$;

grant execute on function public.my_account_status() to authenticated;

create or replace function public.acknowledge_warning(action_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.moderation_actions
  set acknowledged_at = now()
  where id = action_id and user_id = caller and kind = 'warning' and acknowledged_at is null;
end;
$$;

grant execute on function public.acknowledge_warning(uuid) to authenticated;

-- ------------------------------------------------------------
-- Admin actions: warn / suspend / unsuspend
-- ------------------------------------------------------------
-- Shared precondition. Refuses on the three targets an admin must not be able
-- to moderate, in the order that leaks least: not-admin first (so a
-- non-admin never learns anything about the target at all).
create or replace function public.moderation_target(target uuid)
returns uuid language plpgsql security definer set search_path = public stable as $$
declare t_role text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if target is null or target = auth.uid() then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  select p.role into t_role from public.profiles p where p.id = target;
  if t_role is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  -- Admins are not moderated through this surface, and a protected admin
  -- (20260802080000) is explicitly off limits. Without this, "suspend" would
  -- be a lockout weapon between admins, and a compromised admin session could
  -- take the whole instance down with two clicks.
  if t_role = 'admin' or exists (select 1 from public.protected_admins pa where pa.user_id = target) then
    raise exception 'target_protected' using errcode = '42501';
  end if;
  return target;
end;
$$;

grant execute on function public.moderation_target(uuid) to authenticated;

-- The "grace period with info to the user" branch: no access is taken away,
-- the account just gets told, once, and has to acknowledge it.
create or replace function public.warn_user(target uuid, message text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  victim uuid := public.moderation_target(target);
  cleaned text := nullif(btrim(coalesce(message, '')), '');
  new_id uuid;
begin
  if cleaned is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if char_length(cleaned) > 2000 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;
  insert into public.moderation_actions (user_id, actor_id, kind, reason)
  values (victim, auth.uid(), 'warning', cleaned)
  returning id into new_id;
  return new_id;
end;
$$;

grant execute on function public.warn_user(uuid, text) to authenticated;

-- Suspend. `days` NULL = indefinite (until an admin lifts it).
--
-- Session termination is best effort BY DESIGN. Deleting `auth.sessions` is
-- what actually invalidates the refresh chain across every product sharing
-- this Supabase session (web, Starscape, the uploader), but the `auth` schema
-- is owned by `supabase_auth_admin`, not by us: if the grant is not there the
-- DELETE raises, and a moderation action must not fail because a
-- nice-to-have side effect did. The AUTHORITATIVE lockout is the row we just
-- wrote — is_approved() is false from this statement on, so every RLS-gated
-- read the old access token can still make returns nothing, and the client
-- signs itself out on the next my_account_status() poll.
--
-- Deliberately NOT setting auth.users.banned_until: GoTrue would then refuse
-- the sign-in with a generic error, and the requirement is that the suspended
-- user is TOLD WHY when he tries to sign in. He can still authenticate; the
-- app hands him the reason and drops the session immediately after.
create or replace function public.suspend_user(target uuid, reason text, days integer default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  victim uuid := public.moderation_target(target);
  cleaned text := nullif(btrim(coalesce(reason, '')), '');
  until_ts timestamptz;
begin
  if cleaned is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if char_length(cleaned) > 2000 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;
  if days is not null and (days < 1 or days > 3650) then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  until_ts := case when days is null then null else now() + (days * interval '1 day') end;

  update public.profiles
  set suspended_at = now(), suspended_until = until_ts, suspension_reason = cleaned
  where id = victim;

  insert into public.moderation_actions (user_id, actor_id, kind, reason, expires_at)
  values (victim, auth.uid(), 'suspension', cleaned, until_ts);

  -- Any share link the account had published stops resolving too (see
  -- get_shared_loadout), so a suspension does not leave a public surface up.
  begin
    delete from auth.sessions where user_id = victim;
  exception when others then
    raise notice 'suspend_user: could not drop auth.sessions for % (%). RLS lockout still applies.', victim, sqlerrm;
  end;

  return until_ts;
end;
$$;

grant execute on function public.suspend_user(uuid, text, integer) to authenticated;

create or replace function public.unsuspend_user(target uuid, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare victim uuid := public.moderation_target(target);
begin
  update public.profiles
  set suspended_at = null, suspended_until = null, suspension_reason = null
  where id = victim;

  insert into public.moderation_actions (user_id, actor_id, kind, reason)
  values (victim, auth.uid(), 'unsuspension', nullif(btrim(coalesce(note, '')), ''));
end;
$$;

grant execute on function public.unsuspend_user(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- Closing reports
-- ------------------------------------------------------------
-- An admin decides per ACCOUNT, not per report line, so this closes every
-- open report against one target in a single call. `dismiss` records which
-- way it went ('reviewed' = acted on, 'dismissed' = no case), and the partial
-- unique index frees the reporter/target slot either way, so the same account
-- can be reported again if the behaviour continues.
--
-- Deliberately NOT behind moderation_target(): closing reports is not a
-- sanction, and a bogus report filed AGAINST an admin has to be dismissable
-- too. is_admin() is the whole gate here.
create or replace function public.resolve_reports_for_user(target uuid, dismiss boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if target is null then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  update public.user_reports
  set status = case when dismiss then 'dismissed' else 'reviewed' end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where target_id = target and status = 'open';
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.resolve_reports_for_user(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- list_users_for_admin — project the suspension state
-- ------------------------------------------------------------
-- DROP first: widening RETURNS TABLE again (same reason as in
-- 20260903220000). Body is that migration's, plus three columns.
drop function if exists public.list_users_for_admin();

create or replace function public.list_users_for_admin()
returns table (
  id uuid,
  email text,
  display_name text,
  username citext,
  role text,
  protected boolean,
  report_count bigint,
  suspended boolean,
  suspended_at timestamptz,
  suspended_until timestamptz,
  suspension_reason text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select
    p.id,
    u.email,
    p.display_name,
    p.username,
    p.role,
    exists (select 1 from public.protected_admins pa where pa.user_id = p.id) as protected,
    (select count(*) from public.user_reports r where r.target_id = p.id and r.status = 'open') as report_count,
    (p.suspended_at is not null and (p.suspended_until is null or p.suspended_until > now())) as suspended,
    p.suspended_at,
    p.suspended_until,
    p.suspension_reason,
    p.created_at,
    u.last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_admin()
  order by
    case p.role when 'admin' then 0 when 'collaborator' then 1 else 2 end,
    p.created_at desc
$$;

grant execute on function public.list_users_for_admin() to authenticated;


-- ============================================================
-- PART 3 — loadout sharing (friends + public link)
-- ============================================================
-- Two share shapes, one table:
--   * FRIEND share — `shared_with` set, `token` null. Access is re-checked
--     against `friendships` on every read, so un-friending revokes it with no
--     cleanup pass and no way to miss a row.
--   * LINK share — `token` set, `shared_with` null. Anyone holding the token
--     may READ the loadout, signed out included.
--
-- `hangar_role_loadouts` keeps its self-only RLS untouched: there is no
-- public-read policy and no policy widening at all. The only way a non-owner
-- ever sees a row is `get_shared_loadout()` / `list_loadouts_shared_with_me()`
-- — SECURITY DEFINER functions that project name/role/items and nothing else,
-- and that hand back nothing without a valid, unrevoked share row.
create table if not exists public.loadout_shares (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  -- Only role loadouts today. A per-ship config share needs the ship, its
  -- ports and the item catalogue to render, which is its own piece of work —
  -- the column exists so widening the CHECK is the whole migration then.
  kind         text not null default 'role' check (kind in ('role')),
  loadout_id   uuid not null references public.hangar_role_loadouts (id) on delete cascade,
  token        text unique,
  shared_with  uuid references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  constraint loadout_shares_one_shape check (
    (token is not null and shared_with is null)
    or (token is null and shared_with is not null)
  ),
  constraint loadout_shares_not_self check (shared_with is null or shared_with <> owner_id),
  constraint loadout_shares_token_len check (token is null or char_length(token) between 32 and 128)
);

-- One live friend share per (loadout, friend): re-sharing must be idempotent,
-- not a way to pile up rows.
create unique index if not exists loadout_shares_friend_unique
  on public.loadout_shares (loadout_id, shared_with) where revoked_at is null and shared_with is not null;
-- One live link per loadout, so "the link" is a stable thing the owner can
-- point at and revoke, rather than a growing set of forgotten URLs.
create unique index if not exists loadout_shares_link_unique
  on public.loadout_shares (loadout_id) where revoked_at is null and token is not null;
create index if not exists loadout_shares_shared_with_idx
  on public.loadout_shares (shared_with) where revoked_at is null;
create index if not exists loadout_shares_owner_idx on public.loadout_shares (owner_id);

comment on table public.loadout_shares is
  'A role loadout shared with a friend (shared_with) or behind an unguessable link (token). Written only through create_loadout_link()/share_loadout_with_friend()/revoke_loadout_share().';

alter table public.loadout_shares enable row level security;

-- The owner sees their own shares; the friend sees the share pointing at
-- them. A link share carries no recipient, so nobody but the owner can read
-- the row — the token travels out of band, and reading it back out of the
-- table is exactly what must not be possible.
drop policy if exists "loadout_shares_read_involved" on public.loadout_shares;
create policy "loadout_shares_read_involved" on public.loadout_shares
  for select to authenticated
  using (auth.uid() = owner_id or auth.uid() = shared_with);

revoke insert, update, delete on public.loadout_shares from anon, authenticated;
revoke all on public.loadout_shares from anon;

drop policy if exists "loadout_shares_approved_gate" on public.loadout_shares;
create policy "loadout_shares_approved_gate" on public.loadout_shares
  as restrictive for all to authenticated
  using (public.is_approved()) with check (public.is_approved());

-- 244 bits from two v4 uuids. Deliberately not gen_random_bytes(): that is
-- pgcrypto, which lives in the `extensions` schema, and every function here
-- pins `search_path = public`.
create or replace function public.new_share_token()
returns text language sql volatile as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

revoke execute on function public.new_share_token() from public, anon, authenticated;

-- Owner check as its own step so all three write RPCs fail identically for a
-- loadout that is not yours or does not exist.
create or replace function public.owned_loadout(target_loadout uuid)
returns uuid language plpgsql security definer set search_path = public stable as $$
declare caller uuid := public.social_actor();
begin
  if target_loadout is null then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.hangar_role_loadouts l
    where l.id = target_loadout and l.user_id = caller
  ) then
    raise exception 'loadout_not_found' using errcode = 'P0002';
  end if;
  return caller;
end;
$$;

grant execute on function public.owned_loadout(uuid) to authenticated;

-- Idempotent: calling it again returns the link that already exists instead
-- of minting a second one. "Generate a new link" is revoke-then-create, which
-- is an explicit two-step in the UI for exactly that reason.
create or replace function public.create_loadout_link(target_loadout uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.owned_loadout(target_loadout);
  existing text;
  fresh text;
begin
  select s.token into existing
  from public.loadout_shares s
  where s.loadout_id = target_loadout and s.token is not null and s.revoked_at is null
  limit 1;
  if existing is not null then
    return existing;
  end if;

  fresh := public.new_share_token();
  insert into public.loadout_shares (owner_id, loadout_id, token)
  values (caller, target_loadout, fresh);
  return fresh;
end;
$$;

grant execute on function public.create_loadout_link(uuid) to authenticated;

create or replace function public.share_loadout_with_friend(target_loadout uuid, friend uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.owned_loadout(target_loadout);
  inserted integer;
begin
  if friend is null or friend = caller then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not public.are_friends(caller, friend) then
    raise exception 'not_friends' using errcode = '42501';
  end if;

  insert into public.loadout_shares (owner_id, loadout_id, shared_with)
  values (caller, target_loadout, friend)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  return case when inserted > 0 then 'created' else 'duplicate' end;
end;
$$;

grant execute on function public.share_loadout_with_friend(uuid, uuid) to authenticated;

-- Revoke, never delete: the row stays as the record that the link existed,
-- and the partial unique indexes above only constrain live rows, so a new
-- link can be minted straight after.
create or replace function public.revoke_loadout_share(share_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  update public.loadout_shares
  set revoked_at = now()
  where id = share_id and owner_id = caller and revoked_at is null;
  if not found then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.revoke_loadout_share(uuid) to authenticated;

-- Owner view of one loadout's shares. Resolves the friend's name through the
-- same SECURITY DEFINER projection the friends page uses, since `profiles` is
-- self-read only.
create or replace function public.list_loadout_shares(target_loadout uuid)
returns table (
  id            uuid,
  token         text,
  shared_with   uuid,
  friend_name   text,
  friend_handle citext,
  created_at    timestamptz
)
language plpgsql security definer set search_path = public stable as $$
declare caller uuid := public.owned_loadout(target_loadout);
begin
  return query
  select s.id, s.token, s.shared_with, p.display_name, p.username, s.created_at
  from public.loadout_shares s
  left join public.profiles p on p.id = s.shared_with
  where s.loadout_id = target_loadout and s.owner_id = caller and s.revoked_at is null
  order by s.created_at desc;
end;
$$;

grant execute on function public.list_loadout_shares(uuid) to authenticated;

-- Everything friends have shared WITH me. The `are_friends` join is the
-- authorization: removing or blocking the friend takes the loadout away on
-- the very next read, without a cleanup job that could lag behind.
create or replace function public.list_loadouts_shared_with_me()
returns table (
  share_id     uuid,
  loadout_id   uuid,
  name         text,
  role         text,
  items        jsonb,
  owner_id     uuid,
  owner_name   text,
  owner_handle citext,
  shared_at    timestamptz,
  updated_at   timestamptz
)
language sql security definer set search_path = public stable as $$
  select
    s.id, l.id, l.name, l.role, l.items,
    s.owner_id, p.display_name, p.username, s.created_at, l.updated_at
  from public.loadout_shares s
  join public.hangar_role_loadouts l on l.id = s.loadout_id
  join public.profiles p on p.id = s.owner_id
  where s.shared_with = auth.uid()
    and s.revoked_at is null
    -- Both ends are checked. The owner's suspension takes their loadout off
    -- every surface at once; the CALLER's is checked here because this is the
    -- one read path in the feature that does not go through social_actor()
    -- (it is `language sql`, so it cannot raise) — without it a suspended
    -- account could still pull friends' loadouts straight off PostgREST.
    and not public.is_suspended(auth.uid())
    and public.are_friends(auth.uid(), s.owner_id)
    and not public.is_suspended(s.owner_id)
  order by s.created_at desc
$$;

grant execute on function public.list_loadouts_shared_with_me() to authenticated;

-- THE public read path. Callable by `anon` — that is the whole point of a
-- share link — and it is the ONLY thing `anon` can reach in the hangar
-- schema. It takes a 64-char token, returns exactly the fields a read-only
-- view needs, and returns zero rows for a revoked link, an unknown token or a
-- suspended owner.
create or replace function public.get_shared_loadout(share_token text)
returns table (
  loadout_id   uuid,
  name         text,
  role         text,
  items        jsonb,
  owner_name   text,
  owner_handle citext,
  shared_at    timestamptz,
  updated_at   timestamptz
)
language sql security definer set search_path = public stable as $$
  select l.id, l.name, l.role, l.items, p.display_name, p.username, s.created_at, l.updated_at
  from public.loadout_shares s
  join public.hangar_role_loadouts l on l.id = s.loadout_id
  join public.profiles p on p.id = s.owner_id
  where s.token is not null
    and s.token = share_token
    and s.revoked_at is null
    and not public.is_suspended(s.owner_id)
  limit 1
$$;

grant execute on function public.get_shared_loadout(text) to anon, authenticated;

comment on function public.get_shared_loadout(text) is
  'Token-scoped read-only projection of one role loadout. The only hangar data anon can reach, and only with a live 64-hex-char share token.';
