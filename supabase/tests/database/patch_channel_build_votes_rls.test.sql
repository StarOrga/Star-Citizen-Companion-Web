-- Build votes (#885, migration 20261103090000_patch_channel_build_votes.sql).
--
-- Pins: self-only RLS (no reading, writing or changing another account's vote), no DELETE grant,
-- Hotfix / PTU only (no Evocati), only the newest running build of a channel, the 12 h change lock,
-- the 3-per-24-h cap, the approval gate, and an aggregate that carries no user id, counts accounts
-- younger than 7 days with weight 0, counts a vote only from the next full hour, withholds the split
-- below 10 counted votes and shows each caller only their own vote.
-- Runs in begin ... rollback as the real roles (authenticated / anon).
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- Fixtures (as the migration owner) ----------------------------------------
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-a000-000000885001', 'pgtap-bv-a@example.test', now() - interval '30 days'),
  ('00000000-0000-4000-a000-000000885002', 'pgtap-bv-b@example.test', now() - interval '30 days'),
  ('00000000-0000-4000-a000-000000885003', 'pgtap-bv-c@example.test', now() - interval '30 days'),
  -- fresh account (< 7 days): its vote counts, but with weight 0
  ('00000000-0000-4000-a000-000000885004', 'pgtap-bv-d@example.test', now()),
  -- never approved
  ('00000000-0000-4000-a000-000000885005', 'pgtap-bv-e@example.test', now() - interval '30 days'),
  -- approved, voted, then suspended
  ('00000000-0000-4000-a000-000000885006', 'pgtap-bv-f@example.test', now() - interval '30 days');
insert into public.profiles (id, is_approved)
select u.id, u.email <> 'pgtap-bv-e@example.test' from auth.users u where u.email like 'pgtap-bv-%@example.test'
on conflict (id) do update set is_approved = excluded.is_approved;

-- Future thread_first_at: the fixtures are the newest running build of their channel.
insert into public.patch_channel_builds (channel, version, line, started_at, thread_first_at, running) values
  ('ptu',     'pgtap-9.9.0',   '9.9', now(), now() + interval '2 days', true),
  ('ptu',     'pgtap-9.8.0',   '9.8', now(), now() - interval '9 days', false),
  ('ptu',     'pgtap-9.7.0',   '9.7', now(), now() + interval '1 day',  true),   -- running, but not the newest
  ('evocati', 'pgtap-9.9.0e',  '9.9', now(), now() + interval '2 days', true),
  ('hotfix',  'pgtap-9.8.1',   '9.8', now(), now() + interval '2 days', true);

-- C's cap fixtures: three hotfix builds voted while each was the running one.
insert into public.patch_channel_builds (channel, version, line, started_at, thread_first_at, running) values
  ('hotfix', 'pgtap-cap-1', '9.6', now(), now() + interval '3 days', true);
insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
  values ('00000000-0000-4000-a000-000000885003', 'hotfix', 'pgtap-cap-1', 'stabil');
update public.patch_channel_builds set running = false where version = 'pgtap-cap-1';
insert into public.patch_channel_builds (channel, version, line, started_at, thread_first_at, running) values
  ('hotfix', 'pgtap-cap-2', '9.6', now(), now() + interval '3 days', true);
insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
  values ('00000000-0000-4000-a000-000000885003', 'hotfix', 'pgtap-cap-2', 'stabil');
update public.patch_channel_builds set running = false where version = 'pgtap-cap-2';
insert into public.patch_channel_builds (channel, version, line, started_at, thread_first_at, running) values
  ('hotfix', 'pgtap-cap-3', '9.6', now(), now() + interval '3 days', true);
insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
  values ('00000000-0000-4000-a000-000000885003', 'hotfix', 'pgtap-cap-3', 'stabil');
update public.patch_channel_builds set running = false where version = 'pgtap-cap-3';

-- F votes on the PTU build, then gets suspended: the vote stays but must not count.
insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
  values ('00000000-0000-4000-a000-000000885006', 'ptu', 'pgtap-9.9.0', 'stabil');
update public.profiles set suspended_at = now(), suspended_until = null
 where id = '00000000-0000-4000-a000-000000885006';

-- Grants --------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.patch_channel_build_votes', 'SELECT'), 'anon cannot read build votes');
select ok(not has_table_privilege('authenticated', 'public.patch_channel_build_votes', 'DELETE'), 'a build vote cannot be withdrawn');
select ok(has_function_privilege('anon', 'public.patch_channel_build_vote_state()', 'EXECUTE'), 'anon may read the aggregate');
select ok(not exists (
  select 1 from information_schema.routines r
    join information_schema.parameters p on p.specific_name = r.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'patch_channel_build_vote_state'
     and p.parameter_name ilike '%user%'), 'the aggregate returns no user id');

-- User A ----------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000885001","role":"authenticated"}', true);

select lives_ok($$ insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
                   values (auth.uid(), 'ptu', 'pgtap-9.9.0', 'instabil') $$, 'A votes on the running PTU build');
select lives_ok($$ insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
                   values (auth.uid(), 'hotfix', 'pgtap-9.8.1', 'wackelig') $$, 'A votes on the running hotfix build');
select throws_ok($$ insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
                    values ('00000000-0000-4000-a000-000000885002', 'ptu', 'pgtap-9.9.0', 'stabil') $$,
                 '42501', null, 'A cannot cast a vote in B''s name');
select throws_ok($$ insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
                    values (auth.uid(), 'evocati', 'pgtap-9.9.0e', 'stabil') $$,
                 '23514', null, 'Evocati builds take no votes');
select throws_ok($$ insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
                    values (auth.uid(), 'ptu', 'pgtap-9.8.0', 'stabil') $$,
                 'P0001', 'vote_build_not_running', 'a finished build takes no votes');
select throws_ok($$ insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
                    values (auth.uid(), 'ptu', 'pgtap-9.7.0', 'stabil') $$,
                 'P0001', 'vote_build_not_running', 'only the newest running build of a channel takes votes');
select throws_ok($$ update public.patch_channel_build_votes set verdict = 'stabil'
                     where channel = 'ptu' and version = 'pgtap-9.9.0' $$,
                 'P0001', 'vote_change_too_soon', 'a vote cannot be changed within 12 hours');
select throws_ok($$ insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
                    values (auth.uid(), 'ptu', 'pgtap-9.9.0', 'stabil')
                    on conflict (user_id, channel, version) do update set verdict = excluded.verdict $$,
                 'P0001', 'vote_change_too_soon', 'the upsert path obeys the 12 h lock too');
select throws_ok($$ delete from public.patch_channel_build_votes where channel = 'ptu' $$,
                 '42501', null, 'A cannot delete a vote');
select is((select own_verdict from public.patch_channel_build_vote_state() where version = 'pgtap-9.9.0'), 'instabil',
          'A sees their own vote in the aggregate');
select throws_ok($$ update public.patch_channel_build_votes set user_id = '00000000-0000-4000-a000-000000885002'
                     where channel = 'hotfix' $$,
                 '42501', null, 'A cannot move a vote to another account');

-- Same-verdict refresh: as owner, age A's hotfix vote past the lock, then re-send the same verdict.
reset role;
alter table public.patch_channel_build_votes disable trigger patch_channel_build_votes_guard;
update public.patch_channel_build_votes set updated_at = now() - interval '13 hours'
 where user_id = '00000000-0000-4000-a000-000000885001' and channel = 'hotfix';
alter table public.patch_channel_build_votes enable trigger patch_channel_build_votes_guard;
set local role authenticated;
select lives_ok($$ update public.patch_channel_build_votes set verdict = 'wackelig' where channel = 'hotfix' $$,
                'the same verdict again is accepted');
select ok((select updated_at < now() - interval '12 hours' from public.patch_channel_build_votes where channel = 'hotfix'),
          'but does not refresh the vote''s weight');

-- User B ----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000885002","role":"authenticated"}', true);

select is((select count(*)::int from public.patch_channel_build_votes), 0, 'B reads none of A''s votes');
update public.patch_channel_build_votes set verdict = 'stabil'
 where user_id = '00000000-0000-4000-a000-000000885001';
select is((select own_verdict from public.patch_channel_build_vote_state() where version = 'pgtap-9.9.0'), null,
          'B does not see A''s vote as their own');
select is((select votes from public.patch_channel_build_vote_state() where version = 'pgtap-9.9.0'), 0,
          'a vote of the current hour is not counted yet');

-- User C: the daily cap -----------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000885003","role":"authenticated"}', true);
select throws_ok($$ insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
                    values (auth.uid(), 'ptu', 'pgtap-9.9.0', 'stabil') $$,
                 'P0001', 'vote_daily_cap', 'a fourth build vote within 24 h is refused');

-- User D: fresh account -----------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000885004","role":"authenticated"}', true);
select lives_ok($$ insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
                   values (auth.uid(), 'ptu', 'pgtap-9.9.0', 'stabil') $$, 'a fresh account may vote');

-- User E: never approved ----------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000885005","role":"authenticated"}', true);
select throws_ok($$ insert into public.patch_channel_build_votes (user_id, channel, version, verdict)
                    values (auth.uid(), 'ptu', 'pgtap-9.9.0', 'stabil') $$,
                 '42501', null, 'an unapproved account cannot vote');

-- Owner check: B's update above did not touch A's vote ------------------------
reset role;
select is((select count(*)::int from public.patch_channel_build_votes where version = 'pgtap-9.9.0'), 3,
          'the suspended account''s vote is kept, only not counted');
select is((select verdict from public.patch_channel_build_votes
            where user_id = '00000000-0000-4000-a000-000000885001' and version = 'pgtap-9.9.0'), 'instabil',
          'B''s update left A''s vote untouched');

-- Aggregate: age every PTU vote past the hour batch, then read it as B ------
alter table public.patch_channel_build_votes disable trigger patch_channel_build_votes_guard;
update public.patch_channel_build_votes set updated_at = now() - interval '2 hours' where version = 'pgtap-9.9.0';
alter table public.patch_channel_build_votes enable trigger patch_channel_build_votes_guard;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000885002","role":"authenticated"}', true);
select is((select votes from public.patch_channel_build_vote_state() where version = 'pgtap-9.9.0'), 2,
          'from the next hour A and D count, the suspended account does not');
select is((select sum_w from public.patch_channel_build_vote_state() where version = 'pgtap-9.9.0'), 0::double precision,
          'below 10 counted votes the split is withheld');

-- Ten more aged voters (all instabil): the split appears, D still weighs 0.
reset role;
insert into auth.users (id, email, created_at)
select ('00000000-0000-4000-a000-0000008851' || lpad(i::text, 2, '0'))::uuid, 'pgtap-bv-x' || i || '@example.test', now() - interval '30 days'
  from generate_series(1, 10) i;
insert into public.profiles (id, is_approved)
select u.id, true from auth.users u where u.email like 'pgtap-bv-x%@example.test'
on conflict (id) do update set is_approved = true;
alter table public.patch_channel_build_votes disable trigger patch_channel_build_votes_guard;
insert into public.patch_channel_build_votes (user_id, channel, version, verdict, updated_at)
select u.id, 'ptu', 'pgtap-9.9.0', 'instabil', now() - interval '2 hours' from auth.users u where u.email like 'pgtap-bv-x%@example.test';
alter table public.patch_channel_build_votes enable trigger patch_channel_build_votes_guard;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000885002","role":"authenticated"}', true);
select is((select votes from public.patch_channel_build_vote_state() where version = 'pgtap-9.9.0'), 12, 'twelve counted votes');
select ok((select w_instabil > 0 from public.patch_channel_build_vote_state() where version = 'pgtap-9.9.0'),
          'from 10 counted votes the split is returned');
select is((select w_stabil from public.patch_channel_build_vote_state() where version = 'pgtap-9.9.0'), 0::double precision,
          'the fresh account''s stabil vote weighs 0');
reset role;

-- Anonymous -------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select own_verdict from public.patch_channel_build_vote_state() where version = 'pgtap-9.9.0'), null,
          'anon gets the aggregate without an own vote');
select ok(not exists (select 1 from public.patch_channel_build_vote_state() where channel = 'evocati'),
          'the aggregate lists no Evocati build');

reset role;
select * from finish();
rollback;
