-- LIVE votes hardening (migration 20261103091000_patch_stability_votes_hardening.sql).
--
-- Pins: the approval gate, the same-verdict no-op, suspended voters dropped from the aggregate,
-- the hourly batch and the split withheld below 10 counted votes.
-- Runs in begin ... rollback as the real roles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email, created_at)
select ('00000000-0000-4000-a000-0000008852' || lpad(i::text, 2, '0'))::uuid, 'pgtap-lv-' || i || '@example.test', now() - interval '30 days'
  from generate_series(1, 12) i;
insert into public.profiles (id, is_approved)
select u.id, u.email <> 'pgtap-lv-12@example.test' from auth.users u where u.email like 'pgtap-lv-%@example.test'
on conflict (id) do update set is_approved = excluded.is_approved;
insert into public.patch_stability_patches (patch_line, live_at, notes_thread_id, notes_slug)
values ('pgtap-9.9', now() - interval '3 days', 999999001, 'pgtap');

-- User 1 votes now (current hour) ------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000885201","role":"authenticated"}', true);
select lives_ok($$ insert into public.patch_stability_votes (user_id, patch_line, verdict) values (auth.uid(), 'pgtap-9.9', 'stabil') $$,
                'an approved account votes on the LIVE line');
select is((select votes from public.patch_stability_vote_state('pgtap-9.9')), 0, 'a vote of the current hour is not counted yet');

-- User 12 is not approved ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000885212","role":"authenticated"}', true);
select throws_ok($$ insert into public.patch_stability_votes (user_id, patch_line, verdict) values (auth.uid(), 'pgtap-9.9', 'stabil') $$,
                 '42501', null, 'an unapproved account cannot vote on the LIVE line');

-- Same verdict after the lock: no weight refresh -----------------------------------
reset role;
alter table public.patch_stability_votes disable trigger patch_stability_votes_guard;
update public.patch_stability_votes set updated_at = now() - interval '13 hours' where patch_line = 'pgtap-9.9';
alter table public.patch_stability_votes enable trigger patch_stability_votes_guard;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000885201","role":"authenticated"}', true);
update public.patch_stability_votes set verdict = 'stabil' where patch_line = 'pgtap-9.9';
select ok((select updated_at < now() - interval '12 hours' from public.patch_stability_votes where patch_line = 'pgtap-9.9'),
          're-sending the same verdict does not refresh the weight');

-- Users 2..10 aged votes: 10 counted (user 11 suspended) ---------------------------
reset role;
alter table public.patch_stability_votes disable trigger patch_stability_votes_guard;
insert into public.patch_stability_votes (user_id, patch_line, verdict, updated_at)
select u.id, 'pgtap-9.9', 'instabil', now() - interval '2 hours'
  from auth.users u where u.email like 'pgtap-lv-%@example.test' and u.email not in ('pgtap-lv-1@example.test', 'pgtap-lv-12@example.test');
alter table public.patch_stability_votes enable trigger patch_stability_votes_guard;
update public.profiles set suspended_at = now(), suspended_until = null where id = '00000000-0000-4000-a000-000000885211';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select votes from public.patch_stability_vote_state('pgtap-9.9')), 10, 'the suspended account is not counted');
select ok((select w_instabil > 0 and w_stabil > 0 from public.patch_stability_vote_state('pgtap-9.9')), 'from 10 counted votes the split is returned');

-- Below 10: one more suspension drops it to 9 --------------------------------------
reset role;
update public.profiles set suspended_at = now(), suspended_until = null where id = '00000000-0000-4000-a000-000000885210';
set local role anon;
select is((select votes from public.patch_stability_vote_state('pgtap-9.9')), 9, 'nine counted votes');
select is((select sum_w from public.patch_stability_vote_state('pgtap-9.9')), 0::double precision, 'below 10 the split is withheld');

reset role;
select * from finish();
rollback;
