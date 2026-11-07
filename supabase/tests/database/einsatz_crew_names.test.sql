-- Crew names for every invitee (migration 20261107180000_einsatz_crew_names_for_all.sql, #938).
-- NOT YET RUN: dry run before applying the migration.
--
-- Asserts: an invitee who is NOT a friend of the others sees every answer and
-- slot taker by name (display name + handle only); a blocked pair sees neither
-- name (both directions, counts stay); a suspended account stays hidden; a
-- non-invitee gets nothing; the group path still works. begin ... rollback, real roles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email, created_at)
select ('00000000-0000-4000-a000-0000000e00' || lpad(to_hex(i), 2, '0'))::uuid,
       'pgtap-names-' || i || '@example.test', now() - interval '30 days'
from generate_series(1, 7) i;
insert into public.profiles (id, is_approved)
select u.id, true from auth.users u where u.email like 'pgtap-names-%@example.test'
on conflict (id) do update set is_approved = true;
update public.profiles p
   set display_name = 'Name' || substr(u.email, 13, 1), username = 'handle' || substr(u.email, 13, 1)
  from auth.users u
 where u.id = p.id and u.email like 'pgtap-names-%@example.test';

-- u1 owns e1, friends with u2 and u3 only (u2 and u3 are strangers to each other),
-- shares e1 with both and with a group that u4 and u5 join. u6 is an outsider.
insert into public.hq_einsaetze (user_id, id, title)
values ('00000000-0000-4000-a000-0000000e0001', '00000000-0000-4000-a000-0000000e1001', 'Names run');
insert into public.friendships (user_low, user_high) values
  ('00000000-0000-4000-a000-0000000e0001', '00000000-0000-4000-a000-0000000e0002'),
  ('00000000-0000-4000-a000-0000000e0001', '00000000-0000-4000-a000-0000000e0003');
insert into public.friend_shares (owner_id, kind, einsatz_id, shared_with) values
  ('00000000-0000-4000-a000-0000000e0001', 'einsatz', '00000000-0000-4000-a000-0000000e1001', '00000000-0000-4000-a000-0000000e0002'),
  ('00000000-0000-4000-a000-0000000e0001', 'einsatz', '00000000-0000-4000-a000-0000000e1001', '00000000-0000-4000-a000-0000000e0003');

create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0001","role":"authenticated"}', true);
select public.set_einsatz_slots('00000000-0000-4000-a000-0000000e1001', array['Pilot', 'Gunner']);
insert into t_ctx select 'g', (public.create_group('Names Crew'))->>'id';
insert into t_ctx select 'code', invite_code from public.list_my_groups();
select public.share_einsatz_with_group('00000000-0000-4000-a000-0000000e1001', (select v::uuid from t_ctx where k = 'g'));

-- u2 takes Pilot, u3 declines; u4 and u5 join the group, u5 answers maybe.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0002","role":"authenticated"}', true);
select public.respond_einsatz('00000000-0000-4000-a000-0000000e1001', 'yes',
  ((public.get_einsatz_crew('00000000-0000-4000-a000-0000000e1001'))->'slots'->0->>'id')::uuid);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0003","role":"authenticated"}', true);
select public.respond_einsatz('00000000-0000-4000-a000-0000000e1001', 'no', null);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0004","role":"authenticated"}', true);
select public.join_group((select v from t_ctx where k = 'code'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0005","role":"authenticated"}', true);
select public.join_group((select v from t_ctx where k = 'code'));
select public.respond_einsatz('00000000-0000-4000-a000-0000000e1001', 'maybe', null);

-- u3 (a stranger to u2 and u5) sees every name.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0003","role":"authenticated"}', true);
select is(
  (select array_agg(x->>'username' order by x->>'username')
     from jsonb_array_elements(public.get_einsatz_crew('00000000-0000-4000-a000-0000000e1001')->'rsvps') x),
  array['handle2', 'handle3', 'handle5'], 'an invitee sees all three answers by name, strangers included');
select is(public.get_einsatz_crew('00000000-0000-4000-a000-0000000e1001')->'slots'->0->'taker'->>'username',
  'handle2', 'an invitee sees the slot taker by name');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     (public.get_einsatz_crew('00000000-0000-4000-a000-0000000e1001')->'rsvps')->0) k),
  array['answer', 'answered_at', 'display_name', 'slot_id', 'user_id', 'username'],
  'a rsvp row carries display name and handle as identity, nothing more');

-- Group-only invitee u4 sees the names too (group path).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0004","role":"authenticated"}', true);
select is(jsonb_array_length(public.get_einsatz_crew('00000000-0000-4000-a000-0000000e1001')->'rsvps'), 3,
  'a group invitee sees all names');

-- Non-invitee.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0006","role":"authenticated"}', true);
select throws_ok($$ select public.get_einsatz_crew('00000000-0000-4000-a000-0000000e1001') $$,
  'P0002', 'einsatz_not_found', 'a non-invitee gets nothing');

-- Block u3 <-> u2: neither sees the other's name; counts stay.
reset role;
insert into public.user_blocks (blocker_id, blocked_id)
values ('00000000-0000-4000-a000-0000000e0003', '00000000-0000-4000-a000-0000000e0002');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0003","role":"authenticated"}', true);
select ok(not exists (select 1 from jsonb_array_elements(public.get_einsatz_crew('00000000-0000-4000-a000-0000000e1001')->'rsvps') x
                       where x->>'username' = 'handle2')
      and public.get_einsatz_crew('00000000-0000-4000-a000-0000000e1001')->'slots'->0->'taker' = 'null'::jsonb
      and public.get_einsatz_crew('00000000-0000-4000-a000-0000000e1001')->'slots'->0->>'taken' = 'true',
  'the blocker no longer sees the blocked taker by name, the slot stays taken');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0002","role":"authenticated"}', true);
select ok(not exists (select 1 from jsonb_array_elements(public.get_einsatz_crew('00000000-0000-4000-a000-0000000e1001')->'rsvps') x
                       where x->>'username' = 'handle3'), 'the blocked person does not see the blocker either');

-- Suspend u5: hidden from everyone.
reset role;
update public.profiles set suspended_at = now(), suspended_until = null
 where id = '00000000-0000-4000-a000-0000000e0005';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0004","role":"authenticated"}', true);
select ok(not exists (select 1 from jsonb_array_elements(public.get_einsatz_crew('00000000-0000-4000-a000-0000000e1001')->'rsvps') x
                       where x->>'username' = 'handle5'), 'a suspended account stays hidden');

-- Owner sees the unsuspended answers (u2, u3).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0001","role":"authenticated"}', true);
select is(jsonb_array_length(public.get_einsatz_crew('00000000-0000-4000-a000-0000000e1001')->'rsvps'), 2,
  'the owner sees the unsuspended answers');

select * from finish();
rollback;
