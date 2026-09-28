-- ============================================================
-- 20260928211538_profile_insert_and_is_admin_grants.sql
-- Pin a session's own profile INSERT to neutral viewer values and take
-- public.is_admin(uuid) away from anon + authenticated
-- (AUD-318, AUD-317 · plan D01 step 7).
--
-- WHY
--   AUD-318: "profiles_self_upsert" (00001_init_schema.sql:20) only checks
--   auth.uid() = id. A session whose profiles row is missing (deleted, or the
--   trigger failed) can insert its own row with role = 'admin',
--   is_approved = true or a hand-picked username — every privileged column
--   added since (role, is_approved, suspension, last_seen_at, username) is
--   writable on INSERT. handle_new_user() (SECURITY DEFINER) and the service
--   role bypass RLS and are unaffected.
--
--   AUD-317: 20260529_public_api_tokens.sql:41 granted EXECUTE on
--   is_admin(uuid) to anon + authenticated, so anyone can probe whether an
--   arbitrary user id is an admin. Its only `authenticated` caller is the
--   api_tokens policy — and functions in RLS policies run with the rights of
--   the CALLING role, not the table owner — so that policy moves to the
--   no-arg is_admin() FIRST, otherwise the revoke breaks token management.
--
-- WHAT
--   1. drops "profiles_self_upsert" (no data dropped) and creates
--      "profiles_self_insert": own row only, role = 'viewer',
--      is_approved = false, no suspension, last_seen_at null, username null
--      (only set_username() validates handles). Harmless columns
--      (display_name, rsi_handle, preferred_* , flagship_ship_class,
--      starscape_top_only) stay free.
--   2. recreates "admins manage own tokens" on api_tokens with is_admin().
--   3. revokes EXECUTE on is_admin(uuid) from public, anon, authenticated;
--      service_role keeps it.
--
-- IDEMPOTENT: safe to re-run (drop policy if exists before every create
--   policy; revoke / grant are repeatable).
--
-- ROLLBACK: drop policy if exists "profiles_self_insert" on public.profiles;
--           create policy "profiles_self_upsert" on public.profiles
--             for insert with check (auth.uid() = id);   -- 00001_init_schema.sql:20-21
--           drop policy if exists "admins manage own tokens" on public.api_tokens;
--           create policy "admins manage own tokens" on public.api_tokens
--             for all to authenticated
--             using (owner_user_id = auth.uid() and public.is_admin(auth.uid()))
--             with check (owner_user_id = auth.uid() and public.is_admin(auth.uid()));
--           grant execute on function public.is_admin(uuid) to authenticated, anon;
-- ============================================================

-- AUD-318
drop policy if exists "profiles_self_upsert" on public.profiles;
drop policy if exists "profiles_self_insert" on public.profiles;
create policy "profiles_self_insert" on public.profiles
  for insert to authenticated
  with check (
    auth.uid() = id
    and role = 'viewer'
    and is_approved = false
    and suspended_at is null
    and suspended_until is null
    and suspension_reason is null
    and last_seen_at is null
    and username is null
  );

-- AUD-317 — policy first, then the revoke.
drop policy if exists "admins manage own tokens" on public.api_tokens;
create policy "admins manage own tokens" on public.api_tokens
  for all to authenticated
  using (owner_user_id = auth.uid() and public.is_admin())
  with check (owner_user_id = auth.uid() and public.is_admin());

revoke execute on function public.is_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_admin(uuid) to service_role;
