-- profiles write guards (AUD-350, REQ-35).
--
-- Two triggers on public.profiles:
--   profiles_role_write_guard (current body: 20260921220000_profile_last_seen.sql:82)
--     A raw browser session (current_user authenticated/anon) may not change
--     role, is_approved, the suspension columns or last_seen_at directly —
--     only through set_user_role(), suspend_user()/unsuspend_user() and
--     touch_last_seen(). It checks current_user only, so postgres (the
--     fixture here) and SECURITY DEFINER paths pass.
--   profiles_protected_admin_guard -> protected_admin_guard()
--     (20260802080000_protected_admins.sql:114/156): a protected account's
--     role/approval is frozen and the row cannot be deleted, for EVERY caller.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- Fixture: a plain user ...e001 and an admin ...e002. Rows in profiles come
-- from on_auth_user_created (handle_new_user), so only UPDATE them here.
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-00000000e001', 'pgtap-viewer@example.test'),
  ('00000000-0000-4000-a000-00000000e002', 'pgtap-admin@example.test');

select lives_ok($$
  update public.profiles set role = 'viewer', is_approved = true
  where id = '00000000-0000-4000-a000-00000000e001'
$$, 'postgres (a trusted path) may set role and approval');

update public.profiles set role = 'admin', is_approved = true
where id = '00000000-0000-4000-a000-00000000e002';

-- A raw session of the plain user --------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-00000000e001","role":"authenticated"}', true);

select throws_ok($$
  update public.profiles set role = 'admin' where id = '00000000-0000-4000-a000-00000000e001'
$$, '42501', null, 'a user cannot promote herself');

select throws_ok($$
  update public.profiles set is_approved = false where id = '00000000-0000-4000-a000-00000000e001'
$$, '42501', null, 'a user cannot change her own approval');

select throws_ok($$
  update public.profiles set suspended_at = null, suspended_until = now()
  where id = '00000000-0000-4000-a000-00000000e001'
$$, '42501', null, 'a user cannot touch her own suspension columns');

select throws_ok($$
  update public.profiles set last_seen_at = now() - interval '1 year'
  where id = '00000000-0000-4000-a000-00000000e001'
$$, '42501', null, 'a user cannot write last_seen_at directly');

reset role;

select is(
  (select role from public.profiles where id = '00000000-0000-4000-a000-00000000e001'),
  'viewer', 'the refused writes left the role alone');

-- A protected admin, even for postgres ---------------------------------------
insert into public.protected_admins (user_id, reason)
values ('00000000-0000-4000-a000-00000000e002', 'pgtap');

select throws_ok($$
  update public.profiles set role = 'viewer' where id = '00000000-0000-4000-a000-00000000e002'
$$, '42501', null, 'a protected admin cannot be demoted');

select throws_ok($$
  update public.profiles set is_approved = false where id = '00000000-0000-4000-a000-00000000e002'
$$, '42501', null, 'a protected admin cannot be un-approved');

select throws_ok($$
  delete from public.profiles where id = '00000000-0000-4000-a000-00000000e002'
$$, '42501', null, 'a protected admin cannot be deleted');

select * from finish();
rollback;
