-- Real groups (migration 20261107120000_real_groups.sql).
-- NOT YET RUN: written without a local stack; run it before applying the migration.
--
-- Asserts: no direct table access for anon/authenticated, execute grants on every
-- RPC and helper, join by code (a wrong or rotated code answers NULL, a blocked
-- user is not refused), roles (no self-promotion, an admin cannot remove an
-- owner, an owner demotes a co-owner, the last owner cannot leave), account
-- deletion of the only owner (successor promoted / empty group removed), blocks
-- (member list, Einsatz access, taker name), an outsider sees nothing and cannot
-- answer, answers do not come back on rejoin, and a friend-only Einsatz still
-- behaves as before. Runs in begin ... rollback as the real roles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

insert into auth.users (id, email, created_at)
select ('00000000-0000-4000-a000-0000000d00' || lpad(to_hex(i), 2, '0'))::uuid,
       'pgtap-grp-' || i || '@example.test', now() - interval '30 days'
from generate_series(1, 12) i;
insert into public.profiles (id, is_approved)
select u.id, true from auth.users u where u.email like 'pgtap-grp-%@example.test'
on conflict (id) do update set is_approved = true;

-- u1 owns two Einsaetze: e1 (shared with the group), e2 (friend-only share to u9).
insert into public.hq_einsaetze (user_id, id, title) values
  ('00000000-0000-4000-a000-0000000d0001', '00000000-0000-4000-a000-0000000d1001', 'Group run'),
  ('00000000-0000-4000-a000-0000000d0001', '00000000-0000-4000-a000-0000000d1002', 'Friend run');
-- u1 and u9 are friends; e2 is shared with u9 through the old friend path.
insert into public.friendships (user_low, user_high)
values ('00000000-0000-4000-a000-0000000d0001', '00000000-0000-4000-a000-0000000d0009');
insert into public.friend_shares (owner_id, kind, einsatz_id, shared_with)
values ('00000000-0000-4000-a000-0000000d0001', 'einsatz',
        '00000000-0000-4000-a000-0000000d1002', '00000000-0000-4000-a000-0000000d0009');
-- u1 <-> u8 is blocked before u8 joins (a block must not stop the join).
insert into public.user_blocks (blocker_id, blocked_id)
values ('00000000-0000-4000-a000-0000000d0001', '00000000-0000-4000-a000-0000000d0008');

create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated;

-- Grants and RLS (as the migration owner) ------------------------------------
select ok(not has_table_privilege('anon', 'public.sc_groups', 'SELECT'), 'anon cannot read groups');
select ok(
  not exists (
    select 1 from unnest(array['sc_groups', 'sc_group_members', 'sc_group_einsatz_shares', 'sc_group_join_fails']) t
    where has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE')
       or has_any_column_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE')
       or has_any_column_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE')
  ), 'no table or column privilege for authenticated or anon on any group table');
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid = any (array['public.sc_groups'::regclass, 'public.sc_group_members'::regclass,
                           'public.sc_group_einsatz_shares'::regclass, 'public.sc_group_join_fails'::regclass])),
  'RLS is enabled on every group table');
select ok(
  not exists (select 1 from pg_policies where tablename in ('sc_groups', 'sc_group_members', 'sc_group_einsatz_shares', 'sc_group_join_fails')),
  'no policy exists: the tables are RPC-only');
select ok(
  not exists (
    select 1 from unnest(array[
      'create_group(text)', 'join_group(text)', 'rotate_group_invite(uuid)', 'leave_group(uuid)',
      'remove_group_member(uuid,uuid)', 'set_group_member_role(uuid,uuid,text)', 'delete_group(uuid)',
      'list_my_groups()', 'list_group_members(uuid)', 'share_einsatz_with_group(uuid,uuid)',
      'unshare_einsatz_from_group(uuid,uuid)', 'list_einsatz_group_shares(uuid)',
      'list_einsaetze_shared_with_me()'
    ]) f where has_function_privilege('anon', 'public.' || f, 'EXECUTE')
  ), 'anon cannot execute any group RPC');
select ok(
  (select bool_and(has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')) from unnest(array[
      'create_group(text)', 'join_group(text)', 'rotate_group_invite(uuid)', 'leave_group(uuid)',
      'remove_group_member(uuid,uuid)', 'set_group_member_role(uuid,uuid,text)', 'delete_group(uuid)',
      'list_my_groups()', 'list_group_members(uuid)', 'share_einsatz_with_group(uuid,uuid)',
      'unshare_einsatz_from_group(uuid,uuid)', 'list_einsatz_group_shares(uuid)'
  ]) f), 'authenticated can execute every group RPC');
select ok(
  not exists (
    select 1 from unnest(array[
      'sc_group_member(uuid,uuid)', 'sc_group_role(uuid,uuid)', 'sc_group_new_code()', 'sc_group_lock(uuid)',
      'sc_group_has_owner(uuid)', 'sc_group_prune_answers(uuid[])', 'einsatz_group_access(uuid,uuid)',
      'einsatz_group_common(uuid,uuid,uuid)', 'einsatz_access(uuid,uuid)', 'einsatz_crew_json(uuid,uuid,uuid)',
      'sc_group_members_after_delete()', 'friendships_after_delete()'
    ]) f where has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')
                or has_function_privilege('anon', 'public.' || f, 'EXECUTE')
  ), 'no internal helper is executable by authenticated or anon');

-- u1 creates the group, shares e1, sets slots --------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0001","role":"authenticated"}', true);
insert into t_ctx select 'g', (public.create_group('Test Crew'))->>'id';
insert into t_ctx select 'code', invite_code from public.list_my_groups();
select is((select count(*)::int from public.list_my_groups()), 1, 'owner lists the new group');
select throws_ok($$ select * from public.sc_groups $$, '42501', null, 'authenticated cannot read sc_groups directly');
select throws_ok($$ select * from public.sc_group_members $$, '42501', null, 'authenticated cannot read sc_group_members directly');
select throws_ok($$ select public.leave_group((select v::uuid from t_ctx where k = 'g')) $$,
  '22023', 'last_owner', 'the last owner cannot leave');
select is(public.share_einsatz_with_group('00000000-0000-4000-a000-0000000d1001', (select v::uuid from t_ctx where k = 'g')),
  'created', 'owner shares e1 with the group');
select lives_ok($$ select public.set_einsatz_slots('00000000-0000-4000-a000-0000000d1001', array['Pilot', 'Gunner']) $$, 'owner sets crew slots');

-- u2 joins, answers on the Pilot slot ------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0002","role":"authenticated"}', true);
select is(public.join_group('0000-0000-0000-0000'), null, 'a wrong code answers NULL');
select is(public.join_group((select v from t_ctx where k = 'code')), (select v::uuid from t_ctx where k = 'g'), 'u2 joins with the code');
select is((select invite_code from public.list_my_groups()), null, 'a plain member is not handed the code');
select throws_ok($$ select public.rotate_group_invite((select v::uuid from t_ctx where k = 'g')) $$,
  'P0002', 'group_not_found', 'a plain member cannot rotate the code');
select throws_ok($$ select public.set_group_member_role((select v::uuid from t_ctx where k = 'g'),
                    '00000000-0000-4000-a000-0000000d0002', 'owner') $$,
  'P0002', 'group_not_found', 'a member cannot promote themselves');
select is((select count(*)::int from public.list_einsaetze_shared_with_me()), 1, 'u2 sees the group Einsatz');
select is(
  (public.respond_einsatz('00000000-0000-4000-a000-0000000d1001', 'yes',
     ((public.get_einsatz_crew('00000000-0000-4000-a000-0000000d1001'))->'slots'->0->>'id')::uuid))->'counts'->>'yes',
  '1', 'u2 answers with a slot; the count shows');

-- u3 is an outsider -------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0003","role":"authenticated"}', true);
select is((select count(*)::int from public.list_group_members((select v::uuid from t_ctx where k = 'g'))), 0, 'an outsider gets an empty member list');
select is((select count(*)::int from public.list_einsaetze_shared_with_me()), 0, 'an outsider sees no shared Einsatz');
select throws_ok($$ select public.get_einsatz_crew('00000000-0000-4000-a000-0000000d1001') $$,
  'P0002', 'einsatz_not_found', 'an outsider gets nothing from the crew view');
select throws_ok($$ select public.respond_einsatz('00000000-0000-4000-a000-0000000d1001', 'yes', null) $$,
  'P0002', 'einsatz_not_found', 'an outsider cannot answer');

-- u4 admin, u5 co-owner, u6 member, u7 member, u8 blocked-with-owner joiner -----
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0004","role":"authenticated"}', true);
select public.join_group((select v from t_ctx where k = 'code'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0005","role":"authenticated"}', true);
select public.join_group((select v from t_ctx where k = 'code'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0006","role":"authenticated"}', true);
select public.join_group((select v from t_ctx where k = 'code'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0007","role":"authenticated"}', true);
select public.join_group((select v from t_ctx where k = 'code'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0008","role":"authenticated"}', true);
select isnt(public.join_group((select v from t_ctx where k = 'code')), null, 'a user blocked with the owner is NOT refused at join');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0001","role":"authenticated"}', true);
select public.set_group_member_role((select v::uuid from t_ctx where k = 'g'), '00000000-0000-4000-a000-0000000d0004', 'admin');
select public.set_group_member_role((select v::uuid from t_ctx where k = 'g'), '00000000-0000-4000-a000-0000000d0005', 'owner');

-- Roles -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0004","role":"authenticated"}', true);
select throws_ok($$ select public.remove_group_member((select v::uuid from t_ctx where k = 'g'), '00000000-0000-4000-a000-0000000d0005') $$,
  '42501', 'forbidden', 'an admin cannot remove an owner');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0001","role":"authenticated"}', true);
select lives_ok($$ select public.set_group_member_role((select v::uuid from t_ctx where k = 'g'), '00000000-0000-4000-a000-0000000d0005', 'member') $$,
  'an owner demotes a co-owner');
select is((select count(*)::int from public.list_group_members((select v::uuid from t_ctx where k = 'g')) where role = 'owner'), 1, 'one owner remains');

-- Blocks ------------------------------------------------------------------------------
-- u8 is blocked with the owner u1: no Einsatz access, not in the owner's member list.
select is((select count(*)::int from public.list_group_members((select v::uuid from t_ctx where k = 'g')) where user_id = '00000000-0000-4000-a000-0000000d0008'),
  0, 'the owner does not see the member they are blocked with');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0008","role":"authenticated"}', true);
select is((select count(*)::int from public.list_einsaetze_shared_with_me()), 0, 'a member blocked with the Einsatz owner has no access');
select throws_ok($$ select public.get_einsatz_crew('00000000-0000-4000-a000-0000000d1001') $$,
  'P0002', 'einsatz_not_found', 'and gets the nonexistent answer from the crew view');

-- u6 blocks u2 (the slot taker): member list and taker name hide each other.
reset role;
insert into public.user_blocks (blocker_id, blocked_id)
values ('00000000-0000-4000-a000-0000000d0006', '00000000-0000-4000-a000-0000000d0002');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0006","role":"authenticated"}', true);
select is((select count(*)::int from public.list_group_members((select v::uuid from t_ctx where k = 'g')) where user_id = '00000000-0000-4000-a000-0000000d0002'),
  0, 'u6 does not see u2 in the member list');
select is((public.get_einsatz_crew('00000000-0000-4000-a000-0000000d1001'))->'slots'->0->>'taker', null,
  'u6 does not see the name of the blocked slot taker');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0007","role":"authenticated"}', true);
select is((public.get_einsatz_crew('00000000-0000-4000-a000-0000000d1001'))->'slots'->0->'taker'->>'user_id',
  '00000000-0000-4000-a000-0000000d0002', 'an unblocked member sees the taker name');

-- Rotation, removal, answers do not come back ------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0001","role":"authenticated"}', true);
select lives_ok($$ select public.rotate_group_invite((select v::uuid from t_ctx where k = 'g')) $$, 'owner rotates the code');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0003","role":"authenticated"}', true);
select is(public.join_group((select v from t_ctx where k = 'code')), null, 'the old code no longer works');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0001","role":"authenticated"}', true);
update t_ctx set v = (select invite_code from public.list_my_groups()) where k = 'code';
select lives_ok($$ select public.remove_group_member((select v::uuid from t_ctx where k = 'g'), '00000000-0000-4000-a000-0000000d0002') $$, 'owner removes u2');
reset role;
select is((select count(*)::int from public.einsatz_rsvps where user_id = '00000000-0000-4000-a000-0000000d0002'), 0, 'the removed member''s answer and slot are deleted');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0002","role":"authenticated"}', true);
select is((select count(*)::int from public.list_einsaetze_shared_with_me()), 0, 'the removed member sees no Einsatz');
select public.join_group((select v from t_ctx where k = 'code'));
select is((public.get_einsatz_crew('00000000-0000-4000-a000-0000000d1001'))->>'my_answer', null, 'the old answer did not come back on rejoin');

-- A friend-only Einsatz behaves as before ------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0009","role":"authenticated"}', true);
select is((select count(*)::int from public.list_einsaetze_shared_with_me()), 1, 'the friend sees the friend-shared Einsatz');
select is((public.respond_einsatz('00000000-0000-4000-a000-0000000d1002', 'yes', null))->'counts'->>'yes', '1', 'and can answer it');
reset role;
delete from public.friendships;
select is((select count(*)::int from public.einsatz_rsvps where user_id = '00000000-0000-4000-a000-0000000d0009'), 0, 'unfriending still deletes the friend''s answer');

-- Account deletion --------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d000a","role":"authenticated"}', true);
insert into t_ctx select 'g2', (public.create_group('Second'))->>'id';
insert into t_ctx select 'code2', invite_code from public.list_my_groups();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d000b","role":"authenticated"}', true);
select public.join_group((select v from t_ctx where k = 'code2'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d000c","role":"authenticated"}', true);
insert into t_ctx select 'g3', (public.create_group('Solo'))->>'id';
reset role;
delete from auth.users where id in ('00000000-0000-4000-a000-0000000d000a', '00000000-0000-4000-a000-0000000d000c');
select is((select role from public.sc_group_members where user_id = '00000000-0000-4000-a000-0000000d000b'), 'owner',
  'deleting the only owner promotes the remaining member');
select is((select count(*)::int from public.sc_groups where id = (select v::uuid from t_ctx where k = 'g3')), 0,
  'deleting the owner of a solo group removes the empty group');

-- delete_group ---------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0006","role":"authenticated"}', true);
select throws_ok($$ select public.delete_group((select v::uuid from t_ctx where k = 'g')) $$,
  'P0002', 'group_not_found', 'a plain member cannot delete the group');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000d0001","role":"authenticated"}', true);
select lives_ok($$ select public.delete_group((select v::uuid from t_ctx where k = 'g')) $$, 'the owner deletes the group');

reset role;
select * from finish();
rollback;
