-- Profile presence: "last seen" = last sign-in OR last visit with a live session
--
-- The admin user list showed `auth.users.last_sign_in_at` as "last active".
-- That column moves only on an actual sign-in (password, OAuth, magic link),
-- NOT on a token refresh — so a member who stays signed in for weeks and opens
-- the site every day reads as "last active" on the day they typed their
-- password. Wrong signal for the question the column answers ("is this account
-- still in use?").
--
-- Fix, in three pieces:
--   1. `profiles.last_seen_at` — written ONLY through `touch_last_seen()`, a
--      SECURITY DEFINER RPC pinned to auth.uid(). The app calls it on boot with
--      a restored session, when the tab becomes visible again and on a slow
--      timer; the RPC throttles server-side (5 min) so a busy tab does not turn
--      into a write per navigation.
--   2. `profiles_role_write_guard` freezes the column for raw PostgREST
--      sessions, same as the suspension columns: `profiles_self_update` has no
--      column list, so without this a user could post-date their own presence
--      with one PATCH.
--   3. `list_users_for_admin()` gains `last_seen_at` =
--      greatest(sign-in, visit). `last_sign_in_at` stays in the projection so a
--      client built before this migration keeps parsing.
--
-- Alpha-phase policy: ADDITIVE only. No table is dropped, renamed or altered
-- beyond the new nullable column.

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

comment on column public.profiles.last_seen_at is
  'Newest moment the account was observed using the site with a live session. '
  'Written only through touch_last_seen(); NULL = never observed since this column exists. '
  'Admin "last seen" = greatest(auth.users.last_sign_in_at, this).';

-- ------------------------------------------------------------------
-- touch_last_seen — record a visit for the CALLER only
-- ------------------------------------------------------------------
-- Returns the stored timestamp (unchanged when the throttle skipped the
-- write), so the client can see what the admin list will show. Suspended
-- accounts are NOT excluded on purpose: presence is a fact, not a privilege,
-- and an admin deciding whether to lift a suspension wants to know the person
-- is still around.
create or replace function public.touch_last_seen()
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_now  timestamptz := now();
  v_seen timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  update public.profiles
     set last_seen_at = v_now
   where id = v_uid
     and (last_seen_at is null or last_seen_at < v_now - interval '5 minutes')
  returning last_seen_at into v_seen;

  if v_seen is null then
    select p.last_seen_at into v_seen from public.profiles p where p.id = v_uid;
  end if;
  return v_seen;
end;
$$;

revoke all on function public.touch_last_seen() from public;
grant execute on function public.touch_last_seen() to authenticated;

comment on function public.touch_last_seen() is
  'Marks the calling account as seen now (throttled to one write per 5 minutes). '
  'The only write path for profiles.last_seen_at.';

-- ------------------------------------------------------------------
-- profiles_role_write_guard — also freeze last_seen_at for raw sessions
-- ------------------------------------------------------------------
-- Body is 20260904020000's, plus the third block. Stays SECURITY INVOKER for
-- the reason 20260802080000 gives: SECURITY DEFINER would rewrite
-- `current_user` to the owner and disarm every check. touch_last_seen() runs
-- as the owner and therefore passes.
create or replace function public.profiles_role_write_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.role is distinct from old.role
      or new.is_approved is distinct from old.is_approved)
     and current_user in ('authenticated', 'anon') then
    raise exception
      'role_change_forbidden: use set_user_role() — a direct UPDATE of profiles.role/is_approved is not allowed.'
      using errcode = '42501';
  end if;
  if (new.suspended_at is distinct from old.suspended_at
      or new.suspended_until is distinct from old.suspended_until
      or new.suspension_reason is distinct from old.suspension_reason)
     and current_user in ('authenticated', 'anon') then
    raise exception
      'suspension_change_forbidden: use suspend_user()/unsuspend_user() — a direct UPDATE of the suspension columns is not allowed.'
      using errcode = '42501';
  end if;
  if new.last_seen_at is distinct from old.last_seen_at
     and current_user in ('authenticated', 'anon') then
    raise exception
      'last_seen_change_forbidden: use touch_last_seen() — a direct UPDATE of profiles.last_seen_at is not allowed.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_write_guard on public.profiles;
create trigger profiles_role_write_guard
  before update on public.profiles
  for each row execute function public.profiles_role_write_guard();

-- ------------------------------------------------------------------
-- list_users_for_admin — project the combined "last seen"
-- ------------------------------------------------------------------
-- DROP first: widening RETURNS TABLE (same reason as 20260903220000 and
-- 20260904020000). Body is 20260904020000's plus one column.
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
  last_sign_in_at timestamptz,
  last_seen_at timestamptz
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
    u.last_sign_in_at,
    -- greatest() skips NULLs: an account that never signed in since the
    -- column exists still shows its last sign-in, and vice versa.
    greatest(u.last_sign_in_at, p.last_seen_at) as last_seen_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_admin()
  order by
    case p.role when 'admin' then 0 when 'collaborator' then 1 else 2 end,
    p.created_at desc
$$;

grant execute on function public.list_users_for_admin() to authenticated;
