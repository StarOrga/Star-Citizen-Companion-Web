-- my_feedback is READ-ONLY BY GRANT (AUD-350, REQ-35).
--
-- The view runs with owner rights (security_invoker = false) and is
-- auto-updatable, so Supabase's default ALL grant on a freshly created view
-- would be a write-through bypass of every RLS policy on admin_feedback.
-- Every re-creation of the view has to repeat the revoke/grant pair (last in
-- 20260903230000_user_feedback_withdraw.sql:153-154). This test is what
-- notices when one does not.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Grants ------------------------------------------------------------------
select ok(has_table_privilege('authenticated', 'public.my_feedback', 'SELECT'),
  'authenticated may read my_feedback');
select ok(not has_table_privilege('authenticated', 'public.my_feedback', 'INSERT'),
  'authenticated may not INSERT through my_feedback');
select ok(not has_table_privilege('authenticated', 'public.my_feedback', 'UPDATE'),
  'authenticated may not UPDATE through my_feedback');
select ok(not has_table_privilege('authenticated', 'public.my_feedback', 'DELETE'),
  'authenticated may not DELETE through my_feedback');
select ok(not has_table_privilege('authenticated', 'public.my_feedback', 'TRUNCATE'),
  'authenticated may not TRUNCATE my_feedback');
select ok(not has_table_privilege('anon', 'public.my_feedback', 'SELECT'),
  'anon may not read my_feedback');
select ok(not has_table_privilege('anon', 'public.my_feedback', 'INSERT'),
  'anon may not write through my_feedback');

-- Behaviour, as a real browser session -------------------------------------
-- The profiles row comes from the on_auth_user_created trigger.
insert into auth.users (id, email)
values ('00000000-0000-4000-a000-00000000f001', 'pgtap-feedback@example.test');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-00000000f001","role":"authenticated"}', true);

select lives_ok($$ select * from public.my_feedback $$,
  'a signed-in author can read the view');
select throws_ok($$ insert into public.my_feedback (body) values ('write-through') $$,
  '42501', null, 'INSERT through the view is refused');
select throws_ok($$ update public.my_feedback set body = 'rewritten' $$,
  '42501', null, 'UPDATE through the view is refused');
select throws_ok($$ delete from public.my_feedback $$,
  '42501', null, 'DELETE through the view is refused');

reset role;
set local role anon;
select throws_ok($$ select * from public.my_feedback $$,
  '42501', null, 'anon cannot read the view');
reset role;

select * from finish();
rollback;
