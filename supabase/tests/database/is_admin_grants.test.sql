-- is_admin(uuid) is not callable from a browser session (AUD-350, REQ-35).
--
-- 20260928211538_profile_insert_and_is_admin_grants.sql (plan D01) revoked
-- EXECUTE on is_admin(uuid) from public, anon and authenticated: with it, any
-- visitor could probe arbitrary account ids for admin rights. The no-argument
-- is_admin() — "am I an admin?", used by RLS policies — stays callable.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select ok(not has_function_privilege('anon', 'public.is_admin(uuid)', 'execute'),
  'anon cannot call is_admin(uuid)');
select ok(not has_function_privilege('authenticated', 'public.is_admin(uuid)', 'execute'),
  'authenticated cannot call is_admin(uuid)');
select ok(has_function_privilege('service_role', 'public.is_admin(uuid)', 'execute'),
  'service_role keeps is_admin(uuid)');
select ok(has_function_privilege('authenticated', 'public.is_admin()', 'execute'),
  'authenticated keeps the argument-less is_admin()');

select * from finish();
rollback;
