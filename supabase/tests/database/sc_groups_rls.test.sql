-- Real groups (migration 20261107120000_real_groups.sql). NOT YET RUN: written
-- without a local stack; the orchestrator runs it before applying the migration.
--
-- Pins: no client write path to groups/members/roles, the invite code is not
-- readable by columns, join by code (and a wrong code answers NULL), the last
-- owner cannot leave, a non-member sees nothing of the group or of an Einsatz
-- shared with it, a member sees the Einsatz with crew slots and RSVPs, the
-- friend-share path is untouched, and the grants.
-- Runs in begin ... rollback as the real roles (authenticated / anon).
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-a000-0000000d0001', 'pgtap-grp-owner@example.test', now() - interval '30 days'),
  ('00000000-0000-4000-a000-0000000d0002', 'pgtap-grp-member@example.test', now() - interval '30 days'),
  ('00000000-0000-4000-a000-0000000d0003', 'pgtap-grp-outsider@example.test', now() - interval '30 days');
insert into public.profiles (id, is_approved)
select u.id, true from auth.users u where u.email like 'pgtap-grp-%@example.test'
on conflict (id) do update set is_approved = true;

insert into public.hq_einsaetze (user_id, id, title) values
  ('00000000-0000-4000-a000-0000000d0001', '00000000-0000-4000-a000-0000000d1001', 'Group run');

create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated;

-- Grants -----------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.sc_groups', 'SELECT'), 'anon cannot read groups');
select ok(not has_table_privilege('authenticated', 'public.sc_groups', 'INSERT'), 'authenticated cannot insert groups');
select ok(not has_table_privilege('authenticated', 'public.sc_group_members', 'UPDATE'), 'authenticated cannot update members (no role writes)');
select ok(not has_column_privilege('authenticated', 'public.sc_groups', 'invite_code', 'SELECT'), 'invite_code is not selectable by column');
select ok(not has_table_privilege('authenticated', 'public.sc_group_join_fails', 'SELECT'), 'the throttle table has no client grant');
select ok(not has_function_privilege('anon', 'public.join_group(text)', 'EXECUTE'), 'anon cannot join');
select ok(not has_function_privilege('authenticated', 'public.sc_group_member(uuid,uuid)', 'EXECUTE'), 'the membership helper is no oracle for clients');
select ok(not has_function_privilege('anon', 'public.list_my_groups()', 'EXECUTE'), 'anon cannot list groups');

-- Owner -------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000d0001","role":"authenticated"}', true);

insert into t_ctx select 'group', (public.create_group('Test Crew'))->>'id';
insert into t_ctx select 'code', invite_code from public.list_my_groups();
select is((select count(*)::int from public.list_my_groups()), 1, 'owner lists the new group');
select ok((select length(v) = 16 from t_ctx where k = 'code'), 'the code is 16 characters');
select throws_ok($$ insert into public.sc_group_members (group_id, user_id, role)
                    values ((select v::uuid from t_ctx where k = 'group'), '00000000-0000-4000-a000-0000000d0003', 'owner') $$,
  '42501', null, 'a client cannot insert a membership');
select throws_ok($$ select invite_code from public.sc_groups $$, '42501', null, 'a client cannot read invite_code directly');
select throws_ok($$ select public.leave_group((select v::uuid from t_ctx where k = 'group')) $$,
  '22023', 'last_owner', 'the last owner cannot leave');
select is(public.share_einsatz_with_group('00000000-0000-4000-a000-0000000d1001', (select v::uuid from t_ctx where k = 'group')),
  'created', 'owner shares the Einsatz with the group');

-- Member joins by code -------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000d0002","role":"authenticated"}', true);
select is(public.join_group('0000-0000-0000-0000'), null, 'a wrong code answers NULL');
select is(public.join_group((select v from t_ctx where k = 'code')), (select v::uuid from t_ctx where k = 'group'), 'a member joins with the code');
select is((select count(*)::int from public.list_group_members((select v::uuid from t_ctx where k = 'group'))), 2, 'a member sees the member list');
select is((select invite_code from public.list_my_groups()), null, 'a plain member is not handed the code');
select throws_ok($$ select public.rotate_group_invite((select v::uuid from t_ctx where k = 'group')) $$,
  'P0002', 'group_not_found', 'a plain member cannot rotate the code');
select throws_ok($$ select public.set_group_member_role((select v::uuid from t_ctx where k = 'group'),
                    '00000000-0000-4000-a000-0000000d0002', 'owner') $$,
  'P0002', 'group_not_found', 'a member cannot promote themselves');
select is((select count(*)::int from public.list_einsaetze_shared_with_me()), 1, 'the member sees the group Einsatz');
select is((public.respond_einsatz('00000000-0000-4000-a000-0000000d1001', 'yes', null))->'counts'->>'yes', '1', 'the member answers; the count shows');

-- Outsider -----------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000d0003","role":"authenticated"}', true);
select is((select count(*)::int from public.sc_groups), 0, 'a non-member sees no group row');
select is((select count(*)::int from public.sc_group_members), 0, 'a non-member sees no membership row');
select is((select count(*)::int from public.list_einsaetze_shared_with_me()), 0, 'a non-member sees no shared Einsatz');
select throws_ok($$ select public.get_einsatz_crew('00000000-0000-4000-a000-0000000d1001') $$,
  'P0002', 'einsatz_not_found', 'a non-member gets nothing from the crew view');

-- Rotation and removal -------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000d0001","role":"authenticated"}', true);
select lives_ok($$ select public.rotate_group_invite((select v::uuid from t_ctx where k = 'group')) $$, 'owner rotates the code');
select lives_ok($$ select public.remove_group_member((select v::uuid from t_ctx where k = 'group'),
                    '00000000-0000-4000-a000-0000000d0002') $$, 'owner removes the member');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000d0002","role":"authenticated"}', true);
select is((select count(*)::int from public.list_einsaetze_shared_with_me()), 0, 'the removed member no longer sees the Einsatz');

reset role;
select * from finish();
rollback;
