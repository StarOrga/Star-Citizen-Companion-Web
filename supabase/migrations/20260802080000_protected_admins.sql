-- ============================================================
-- 20260802080000_protected_admins.sql
-- Founder-admin protection (admin_feedback #83)
--
-- THREAT MODEL
-- ------------
-- A *compromised admin app account* must not be able to lock the
-- founders out of their own product. Today an admin can:
--   a) call set_user_role(founder, 'viewer')        → demotion
--   b) UPDATE public.profiles SET role = 'viewer'   → demotion (RLS
--      policy "profiles_admin_role_update" from 00003 allows it, so
--      set_user_role's last-admin guard is trivially bypassed)
--   c) UPDATE public.profiles SET is_approved=false → soft lock-out
--      (approvedGuard bounces the user back to /login)
--   d) invoke the `delete-user` Edge Function → auth.users delete →
--      FK cascade wipes the profile
-- A UI-only guard is worthless here: (a)-(d) are all reachable with a
-- stolen access token and curl. The enforcement therefore lives in the
-- database; the UI only mirrors it.
--
-- DESIGN — why a dedicated table and not `profiles.protected`
-- -----------------------------------------------------------
-- `profiles` already carries a blanket admin-UPDATE policy
-- ("profiles_admin_role_update": using/with check = is_admin()). A
-- `profiles.protected` column would live *inside* that policy's reach,
-- so the flag would be one `UPDATE profiles SET protected=false` away
-- from being switched off by the very account we are defending
-- against — it would need its own column-level guard trigger anyway.
-- A separate table gets "service_role only" for free: RLS is enabled
-- with a SELECT policy and *no* write policy at all, and the write
-- grants are revoked from anon/authenticated. Only `service_role`
-- (RLS bypass, key lives in Supabase secrets — never in the client
-- bundle) and the DB owner can change the protected set.
--
-- ENFORCEMENT (three independent layers)
-- --------------------------------------
--  1. FK  protected_admins.user_id → auth.users(id) ON DELETE RESTRICT
--     A GoTrue `admin.deleteUser()` on a protected account fails at the
--     FK, before any trigger runs.
--  2. TRIGGER profiles_protected_admin_guard  BEFORE UPDATE OR DELETE
--     on public.profiles — rejects role / is_approved / id changes and
--     any delete of a protected account, for *every* caller (including
--     service_role). The only way through is to remove the row from
--     public.protected_admins first — which needs the service key.
--  3. TRIGGER profiles_role_write_guard  BEFORE UPDATE on
--     public.profiles — closes the pre-existing privilege-escalation
--     hole: "profiles_self_update" (00001) let *any* authenticated user
--     UPDATE their own row including `role`, i.e. self-promote to admin.
--     Role/approval writes must now go through set_user_role() (SECURITY
--     DEFINER) or service_role.
--
-- LEGITIMATE CHANGE PATH
-- ----------------------
--   select public.unprotect_admin('<uuid>');   -- service_role only
--   ... perform the demotion/deletion normally ...
--   select public.protect_admin('<uuid>', 'founder');
-- Both helpers have EXECUTE revoked from anon/authenticated.
--
-- E-MAIL CONFIRMATION (feedback #83, second half) — NOT IMPLEMENTED
-- -----------------------------------------------------------------
-- The repo has no outbound transactional-mail path: the only mail we
-- send is Supabase's built-in GoTrue invite (`inviteUserByEmail`,
-- functions/invite-user), whose templates are auth-flow only, and
-- supabase/config.toml configures no custom SMTP. Adding a provider
-- would mean a new secret, which is a separate decision. Instead this
-- migration ships the *seam*: public.protected_admin_removal_requests
-- is the boundary a `request-admin-removal` / `confirm-admin-removal`
-- Edge-Function pair would plug into (create row + mail signed link →
-- confirm token → unprotect_admin + delete). The hard DB guard above
-- already satisfies the stated threat model on its own.
--
-- ADDITIVE: no table/column is dropped and no data is deleted. Two
-- functions are re-created: list_users_for_admin() (DROP + CREATE,
-- because its RETURNS TABLE is widened by `protected` — same pattern
-- and same reason as 20260706221138) and set_user_role() (plain
-- CREATE OR REPLACE, signature unchanged).
-- ============================================================

-- ============================================================
-- protected_admins — the protected set
-- ============================================================
create table if not exists public.protected_admins (
  -- ON DELETE RESTRICT (not CASCADE): this FK is enforcement layer 1.
  user_id uuid primary key references auth.users(id) on delete restrict,
  reason text not null default 'founder',
  created_at timestamptz not null default now()
);

comment on table public.protected_admins is
  'Accounts that cannot be demoted, un-approved or deleted (admin_feedback #83). '
  'Writable by service_role / the DB owner only — RLS grants SELECT to admins and nothing else.';
comment on column public.protected_admins.reason is
  'Free-text justification, e.g. "founder". Informational only.';

alter table public.protected_admins enable row level security;

-- Read-only for admins so the admin UI / a debugging session can see the
-- set. No INSERT/UPDATE/DELETE policy exists on purpose: without a policy
-- RLS denies the write outright for anon + authenticated.
drop policy if exists "protected_admins_read_admin" on public.protected_admins;
create policy "protected_admins_read_admin" on public.protected_admins
  for select to authenticated using (public.is_admin());

-- Belt and braces on top of RLS — revoke the table grants Supabase's
-- default privileges hand out to the PostgREST roles.
revoke insert, update, delete on public.protected_admins from anon, authenticated;

-- ============================================================
-- Enforcement layer 2 — protected-account guard
-- ============================================================
-- SECURITY DEFINER so the lookup in protected_admins is not itself
-- subject to the caller's RLS (a non-admin session sees zero rows
-- through the SELECT policy and would otherwise read "not protected").
create or replace function public.protected_admin_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_protected boolean;
begin
  if tg_op = 'DELETE' then
    select exists (select 1 from public.protected_admins pa where pa.user_id = old.id)
      into target_protected;
    if target_protected then
      raise exception
        'protected_admin: account % is protected and cannot be deleted. Remove it from public.protected_admins first (service_role only).',
        old.id
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE: only privilege-relevant columns are frozen. A protected
  -- founder can still edit their own display_name, username, language,
  -- flagship, … — this guard is about not being locked out.
  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.is_approved is distinct from old.is_approved then
    select exists (select 1 from public.protected_admins pa where pa.user_id = old.id)
      into target_protected;
    if target_protected then
      raise exception
        'protected_admin: role/approval of account % is frozen. Remove it from public.protected_admins first (service_role only).',
        old.id
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protected_admin_guard on public.profiles;
create trigger profiles_protected_admin_guard
  before update or delete on public.profiles
  for each row execute function public.protected_admin_guard();

-- ============================================================
-- Enforcement layer 3 — no direct role/approval writes from PostgREST
-- ============================================================
-- Deliberately SECURITY INVOKER: the check reads `current_user`, which
-- SECURITY DEFINER would rewrite to the function owner and thereby
-- disarm it. PostgREST does `SET LOCAL ROLE authenticated|anon` per
-- request, so those two names identify "came straight from a browser
-- session". set_user_role() (SECURITY DEFINER, owner = postgres) and
-- service_role callers such as functions/invite-user are unaffected.
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
  return new;
end;
$$;

drop trigger if exists profiles_role_write_guard on public.profiles;
create trigger profiles_role_write_guard
  before update on public.profiles
  for each row execute function public.profiles_role_write_guard();

-- ============================================================
-- Protected-set maintenance — service_role only
-- ============================================================
create or replace function public.protect_admin(p_user_id uuid, p_reason text default 'founder')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'protect_admin: no profile %', p_user_id using errcode = '23503';
  end if;
  insert into public.protected_admins (user_id, reason)
  values (p_user_id, coalesce(nullif(trim(p_reason), ''), 'founder'))
  on conflict (user_id) do update set reason = excluded.reason;
end;
$$;

create or replace function public.unprotect_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.protected_admins where user_id = p_user_id;
end;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default — revoke it, or the
-- guard is one RPC call away from being switched off by a hacked admin.
revoke execute on function public.protect_admin(uuid, text) from public, anon, authenticated;
revoke execute on function public.unprotect_admin(uuid) from public, anon, authenticated;
grant execute on function public.protect_admin(uuid, text) to service_role;
grant execute on function public.unprotect_admin(uuid) to service_role;

-- ============================================================
-- Seed — the two founder accounts (admin_feedback #83)
-- ============================================================
-- Resolved from live data (auth.users / profiles), not hardcoded into
-- client code. Jeremy's address is already pinned in 00003; Christoph is
-- matched by local-part / handle so the migration does not publish a
-- private domain in a public repo.
--
-- POST-DEPLOY CHECK — this MUST return 2:
--   select count(*) from public.protected_admins;
-- If Christoph's account does not match any predicate below, add him
-- explicitly with the service key:
--   select public.protect_admin('<uuid>', 'founder');
insert into public.protected_admins (user_id, reason)
select p.id, 'founder'
from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = 'jeremy.treder@gmail.com'
   or lower(u.email) like 'christoph.loeschen@%'
   or p.username = 'Mollywator'                                    -- citext: case-insensitive
   or lower(coalesce(p.display_name, '')) in
      ('mollywator', 'christoph.loeschen', 'christoph loeschen', 'christoph löschen')
on conflict (user_id) do nothing;

-- ============================================================
-- Seam — removal requests (the e-mail-confirmation boundary)
-- ============================================================
-- Not wired to anything yet; see the E-MAIL CONFIRMATION note in the
-- header. An admin may *file* a request (harmless, auditable), but only
-- service_role can advance its status — i.e. only server-side code that
-- has verified a confirmation token can move a request to 'confirmed',
-- and only then may it call unprotect_admin() + delete.
create table if not exists public.protected_admin_removal_requests (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected', 'expired', 'executed')),
  -- SHA-256 of the token that goes into the confirmation mail. The
  -- plaintext token is never stored.
  confirmation_token_hash text,
  expires_at timestamptz not null default now() + interval '24 hours',
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.protected_admin_removal_requests is
  'Seam for the e-mail-confirmed removal of a protected admin (admin_feedback #83). '
  'No mail provider exists yet — a request currently does nothing on its own; '
  'the hard guard in protected_admin_guard() is what enforces the protection.';

create index if not exists protected_admin_removal_requests_target_idx
  on public.protected_admin_removal_requests (target_user_id, status);

alter table public.protected_admin_removal_requests enable row level security;

drop policy if exists "par_requests_read_admin" on public.protected_admin_removal_requests;
create policy "par_requests_read_admin" on public.protected_admin_removal_requests
  for select to authenticated using (public.is_admin());

drop policy if exists "par_requests_insert_admin" on public.protected_admin_removal_requests;
create policy "par_requests_insert_admin" on public.protected_admin_removal_requests
  for insert to authenticated
  with check (
    public.is_admin()
    and requested_by = auth.uid()
    and status = 'pending'
    and confirmation_token_hash is null
  );

-- No UPDATE/DELETE policy: status transitions are service_role-only.
revoke update, delete on public.protected_admin_removal_requests from anon, authenticated;

-- ============================================================
-- set_user_role — friendlier rejection for protected accounts
-- ============================================================
-- The trigger already blocks this path; this check only turns the raw
-- trigger error into a stable, checkable message for the admin UI.
create or replace function public.set_user_role(target_id uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;
  if new_role not in ('admin', 'collaborator', 'viewer') then
    raise exception 'invalid role: %', new_role;
  end if;
  if exists (select 1 from public.protected_admins pa where pa.user_id = target_id)
     and new_role is distinct from (select role from public.profiles where id = target_id) then
    raise exception 'protected_admin: this account is protected and its role cannot be changed'
      using errcode = '42501';
  end if;
  -- Prevent demoting the last admin
  if new_role <> 'admin' and target_id in (
    select id from public.profiles where role = 'admin'
  ) then
    if (select count(*) from public.profiles where role = 'admin') = 1 then
      raise exception 'cannot demote the only admin';
    end if;
  end if;
  update public.profiles set role = new_role where id = target_id;
end;
$$;

grant execute on function public.set_user_role(uuid, text) to authenticated;

-- ============================================================
-- list_users_for_admin — project the protected flag for the admin UI
-- ============================================================
-- DROP first: widening RETURNS TABLE is rejected by CREATE OR REPLACE
-- ("cannot change return type of existing function"). Argument list is
-- unchanged (no args), so the drop is unambiguous.
drop function if exists public.list_users_for_admin();

create or replace function public.list_users_for_admin()
returns table (
  id uuid,
  email text,
  display_name text,
  username citext,
  role text,
  protected boolean,
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
