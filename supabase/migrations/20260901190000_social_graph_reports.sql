-- ============================================================
-- 20260901190000_social_graph_reports.sql
--
-- Phase 1 of the "users can befriend each other" epic (admin feedback
-- cf0ddf7d): the social graph plus the report ledger that feeds the admin
-- users area.
--
-- IN SCOPE HERE
--   * friend_requests  — send / accept / decline / withdraw
--   * friendships      — the accepted edge, stored ONCE as an ordered pair
--   * user_blocks      — a block hides me from them and kills any pending
--                        request or friendship between us
--   * user_reports     — the collected reports; admins read the aggregate
--                        through list_users_for_admin().report_count
--
-- DELIBERATELY NOT IN SCOPE (phase 2, still with the admin for a decision)
--   * Suspending an account, blocking sign-in, revoking live sessions across
--     products. `user_reports.status` + `reviewed_at`/`reviewed_by` are the
--     prepared seam; nothing writes them yet and there is no admin action.
--   * Sharing loadouts with friends / public share links. That builds on this
--     graph and lands in its own migration.
--
-- ADDITIVE: this migration drops nothing except the one function it
-- re-creates with a widened RETURNS TABLE (list_users_for_admin, same
-- DROP-first pattern and same reason as 20260706221138 / 20260802080000).
--
-- WRITE PATH — no table here has an INSERT/UPDATE/DELETE policy at all.
-- Every mutation goes through a SECURITY DEFINER RPC that pins the actor to
-- auth.uid(), so a raw PostgREST call cannot forge a report from somebody
-- else, cannot re-open a friendship the other side removed, and cannot walk
-- around the block/rate-limit checks. Same shape as desktop_connections
-- (20260823130000). RLS below is therefore read-only by design.
-- ============================================================

-- ============================================================
-- friend_requests
-- ============================================================
-- One row per ORDERED pair, for the lifetime of the pair: re-sending after a
-- decline updates the existing row back to 'pending' instead of piling up
-- history rows. Keeps the table O(edges) and makes "is there a pending
-- request between us" a single index lookup.
create table if not exists public.friend_requests (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references auth.users (id) on delete cascade,
  addressee_id  uuid not null references auth.users (id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  constraint friend_requests_not_self check (requester_id <> addressee_id),
  constraint friend_requests_pair_unique unique (requester_id, addressee_id)
);

create index if not exists friend_requests_addressee_pending_idx
  on public.friend_requests (addressee_id) where status = 'pending';
create index if not exists friend_requests_requester_pending_idx
  on public.friend_requests (requester_id) where status = 'pending';

comment on table public.friend_requests is
  'Friend request between two accounts, one row per ordered pair. Written only through send_friend_request()/respond_friend_request()/withdraw_friend_request().';

-- ============================================================
-- friendships
-- ============================================================
-- An accepted friendship is symmetric, so it is stored ONCE with the two ids
-- in a canonical order (user_low < user_high). A two-row representation would
-- need a trigger to keep both halves in sync and can drift; the CHECK makes
-- the invariant unfalsifiable instead.
create table if not exists public.friendships (
  user_low   uuid not null references auth.users (id) on delete cascade,
  user_high  uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint friendships_ordered check (user_low < user_high)
);

create index if not exists friendships_user_high_idx on public.friendships (user_high);

comment on table public.friendships is
  'Accepted friendship, stored once as the ordered pair (user_low < user_high). Written only through the friend RPCs.';

-- ============================================================
-- user_blocks
-- ============================================================
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

comment on table public.user_blocks is
  'Directed block. RLS lets ONLY the blocker read the row - the blocked account must not be able to detect the block.';

-- ============================================================
-- user_reports
-- ============================================================
-- `status`/`reviewed_at`/`reviewed_by` exist but are inert in phase 1: the
-- admin surface is read-only and nothing in the app writes them. They are the
-- seam the phase-2 "grace period vs. suspend" decision plugs into.
create table if not exists public.user_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references auth.users (id) on delete cascade,
  target_id    uuid not null references auth.users (id) on delete cascade,
  category     text not null default 'other'
                 check (category in ('spam', 'harassment', 'impersonation', 'inappropriate', 'other')),
  reason       text,
  status       text not null default 'open'
                 check (status in ('open', 'reviewed', 'dismissed')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references auth.users (id) on delete set null,
  constraint user_reports_not_self check (reporter_id <> target_id),
  constraint user_reports_reason_len check (reason is null or char_length(reason) <= 1000)
);

-- One OPEN report per reporter+target: re-clicking "report" must not inflate
-- the count the admin sorts by. A closed report frees the slot again, so the
-- same account can be reported once more after a review.
create unique index if not exists user_reports_open_unique
  on public.user_reports (reporter_id, target_id) where status = 'open';
create index if not exists user_reports_target_open_idx
  on public.user_reports (target_id) where status = 'open';

comment on table public.user_reports is
  'Collected user reports. Insert-only, and only through report_user() which pins reporter_id to auth.uid(). Readable by admins only.';

-- ============================================================
-- RLS — read-only policies, no write policy anywhere
-- ============================================================
alter table public.friend_requests enable row level security;
alter table public.friendships     enable row level security;
alter table public.user_blocks     enable row level security;
alter table public.user_reports    enable row level security;

drop policy if exists "friend_requests_read_own" on public.friend_requests;
create policy "friend_requests_read_own" on public.friend_requests
  for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "friendships_read_own" on public.friendships;
create policy "friendships_read_own" on public.friendships
  for select to authenticated
  using (auth.uid() = user_low or auth.uid() = user_high);

-- Blocker-only on purpose: a policy that also matched blocked_id would turn
-- the table into a "who blocked me" feed, which is what a block must not leak.
drop policy if exists "user_blocks_read_blocker" on public.user_blocks;
create policy "user_blocks_read_blocker" on public.user_blocks
  for select to authenticated
  using (auth.uid() = blocker_id);

drop policy if exists "user_reports_read_admin" on public.user_reports;
create policy "user_reports_read_admin" on public.user_reports
  for select to authenticated
  using (public.is_admin());

-- Belt and braces on top of "no write policy": revoke the table grants
-- Supabase's default privileges hand to the PostgREST roles.
revoke insert, update, delete on public.friend_requests from anon, authenticated;
revoke insert, update, delete on public.friendships     from anon, authenticated;
revoke insert, update, delete on public.user_blocks     from anon, authenticated;
revoke insert, update, delete on public.user_reports    from anon, authenticated;

-- Same RESTRICTIVE approval gate the self-scoped tables got in
-- 20260805120000: a signed-up-but-never-approved account reaching PostgREST
-- directly reads nothing here either.
do $$
declare t text;
begin
  foreach t in array array['friend_requests', 'friendships', 'user_blocks', 'user_reports']
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_approved_gate', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (public.is_approved()) with check (public.is_approved());',
      t || '_approved_gate', t
    );
  end loop;
end $$;

-- ============================================================
-- Helpers
-- ============================================================
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.friendships f
    where f.user_low = least(a, b) and f.user_high = greatest(a, b)
  );
$$;

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = a and ub.blocked_id = b)
       or (ub.blocker_id = b and ub.blocked_id = a)
  );
$$;

grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

-- Shared precondition for every write RPC below. Raises instead of returning
-- false so a caller can never accidentally ignore it.
create or replace function public.social_actor()
returns uuid language plpgsql security definer set search_path = public stable as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_approved() then
    raise exception 'not approved' using errcode = '42501';
  end if;
  return caller;
end;
$$;

grant execute on function public.social_actor() to authenticated;

-- ============================================================
-- RPC — list_my_friend_edges
-- ============================================================
-- ONE round trip for the whole friends page. It also exists because
-- public.profiles is self-read only (00001): without a SECURITY DEFINER
-- projection the client would hold a list of uuids and no names to render.
-- Deliberately projects display_name + username and NOTHING else — no email,
-- no role, no last_sign_in_at.
create or replace function public.list_my_friend_edges()
returns table (
  kind         text,
  request_id   uuid,
  user_id      uuid,
  display_name text,
  username     citext,
  since        timestamptz
)
language sql security definer set search_path = public stable as $$
  with me as (select auth.uid() as id)
  select 'friend'::text, null::uuid, p.id, p.display_name, p.username, f.created_at
  from public.friendships f
  join me on me.id in (f.user_low, f.user_high)
  join public.profiles p
    on p.id = case when f.user_low = me.id then f.user_high else f.user_low end
  union all
  select 'incoming'::text, r.id, p.id, p.display_name, p.username, r.created_at
  from public.friend_requests r
  join me on me.id = r.addressee_id
  join public.profiles p on p.id = r.requester_id
  where r.status = 'pending'
  union all
  select 'outgoing'::text, r.id, p.id, p.display_name, p.username, r.created_at
  from public.friend_requests r
  join me on me.id = r.requester_id
  join public.profiles p on p.id = r.addressee_id
  where r.status = 'pending'
  union all
  select 'blocked'::text, null::uuid, p.id, p.display_name, p.username, b.created_at
  from public.user_blocks b
  join me on me.id = b.blocker_id
  join public.profiles p on p.id = b.blocked_id
  order by 1, 6 desc
$$;

grant execute on function public.list_my_friend_edges() to authenticated;

-- ============================================================
-- RPC — find_user_by_username
-- ============================================================
-- EXACT match only, never a prefix/ILIKE search: a substring search over
-- profiles is a user-enumeration endpoint, and this is the only way an
-- account becomes addressable at all. Returns nothing when the handle is
-- unset, when it is me, or when a block exists in either direction — a
-- blocked account must be indistinguishable from a nonexistent one.
create or replace function public.find_user_by_username(handle text)
returns table (user_id uuid, display_name text, username citext)
language plpgsql security definer set search_path = public stable as $$
declare caller uuid := public.social_actor();
begin
  return query
  select p.id, p.display_name, p.username
  from public.profiles p
  where p.username is not null
    and p.username = handle::citext
    and p.id <> caller
    and not public.is_blocked_between(caller, p.id)
  limit 1;
end;
$$;

grant execute on function public.find_user_by_username(text) to authenticated;

-- ============================================================
-- RPC — send_friend_request
-- ============================================================
-- Returns 'pending' | 'accepted' | 'already_friends'. 'accepted' is the
-- crossing-requests case: if the target already has a pending request out to
-- me, "send" is the same intent as "accept" — resolving it here is what stops
-- two pending rows from sitting there forever waiting for each other.
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
-- RPC — respond_friend_request
-- ============================================================
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

-- ============================================================
-- RPC — withdraw_friend_request
-- ============================================================
create or replace function public.withdraw_friend_request(request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  update public.friend_requests
  set status = 'withdrawn', responded_at = now()
  where id = request_id and requester_id = caller and status = 'pending';
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.withdraw_friend_request(uuid) to authenticated;

-- ============================================================
-- RPC — remove_friend
-- ============================================================
-- Also clears the request row, so the pair is back to a clean slate and
-- either side can send a fresh request.
create or replace function public.remove_friend(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  if target is null or target = caller then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  delete from public.friendships
  where user_low = least(caller, target) and user_high = greatest(caller, target);
  delete from public.friend_requests
  where (requester_id = caller and addressee_id = target)
     or (requester_id = target and addressee_id = caller);
end;
$$;

grant execute on function public.remove_friend(uuid) to authenticated;

-- ============================================================
-- RPC — block_user / unblock_user
-- ============================================================
-- A block is not just a flag: it tears down the existing relationship in the
-- same transaction, otherwise the friendship row would keep granting the
-- blocked account visibility of me through list_my_friend_edges().
create or replace function public.block_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  if target is null or target = caller then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = target) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (caller, target)
  on conflict do nothing;

  delete from public.friendships
  where user_low = least(caller, target) and user_high = greatest(caller, target);
  delete from public.friend_requests
  where (requester_id = caller and addressee_id = target)
     or (requester_id = target and addressee_id = caller);
end;
$$;

create or replace function public.unblock_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  delete from public.user_blocks where blocker_id = caller and blocked_id = target;
end;
$$;

grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ============================================================
-- RPC — report_user
-- ============================================================
-- Three guards, because the report count is what the admin surface sorts by,
-- so inflating it is the attack:
--   1. reporter_id is auth.uid(), never a parameter;
--   2. one OPEN report per reporter+target (partial unique index);
--   3. a caller needs an existing edge to the target — friendship, request in
--      either direction, or a block. Phase 1 has no public profile surface,
--      so every legitimate report button sits on somebody you already have an
--      edge with; without this, a script could spray reports at guessed uuids
--      and manufacture "conspicuous" accounts.
create or replace function public.report_user(target uuid, category text, reason text)
returns text language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  open_by_caller int;
  inserted int;
begin
  if target is null or target = caller then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if category is null or category not in ('spam', 'harassment', 'impersonation', 'inappropriate', 'other') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if reason is not null and char_length(reason) > 1000 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  if not (
    public.are_friends(caller, target)
    or exists (
      select 1 from public.friend_requests r
      where (r.requester_id = caller and r.addressee_id = target)
         or (r.requester_id = target and r.addressee_id = caller)
    )
    or exists (
      select 1 from public.user_blocks b
      where b.blocker_id = caller and b.blocked_id = target
    )
  ) then
    raise exception 'no_relation' using errcode = '42501';
  end if;

  select count(*) into open_by_caller
  from public.user_reports where reporter_id = caller and status = 'open';
  if open_by_caller >= 20 then
    raise exception 'report_limit' using errcode = '54000';
  end if;

  insert into public.user_reports (reporter_id, target_id, category, reason)
  values (caller, target, category, nullif(btrim(coalesce(reason, '')), ''))
  on conflict (reporter_id, target_id) where status = 'open' do nothing;

  get diagnostics inserted = row_count;
  return case when inserted > 0 then 'created' else 'duplicate' end;
end;
$$;

grant execute on function public.report_user(uuid, text, text) to authenticated;

-- ============================================================
-- list_users_for_admin — project the open-report count
-- ============================================================
-- DROP first: widening RETURNS TABLE is rejected by CREATE OR REPLACE
-- ("cannot change return type of existing function"). Argument list is
-- unchanged (no args), so the drop is unambiguous. Body is 20260802080000's,
-- plus report_count.
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
-- RPC — list_reports_for_admin
-- ============================================================
-- A bare count cannot be decided on, so the admin card also renders the open
-- reports themselves. Read-only: there is no phase-1 RPC that resolves,
-- dismisses or acts on a report.
create or replace function public.list_reports_for_admin()
returns table (
  id uuid,
  target_id uuid,
  target_name text,
  target_username citext,
  reporter_id uuid,
  reporter_name text,
  reporter_username citext,
  category text,
  reason text,
  created_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select
    r.id,
    r.target_id, tp.display_name, tp.username,
    r.reporter_id, rp.display_name, rp.username,
    r.category, r.reason, r.created_at
  from public.user_reports r
  join public.profiles tp on tp.id = r.target_id
  join public.profiles rp on rp.id = r.reporter_id
  where public.is_admin() and r.status = 'open'
  order by r.created_at desc
$$;

grant execute on function public.list_reports_for_admin() to authenticated;
