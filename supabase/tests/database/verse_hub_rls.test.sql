-- Verse hub RLS + RPC contracts (migration 20261009100000_verse_hub.sql).
--
-- Pins: own-rows isolation on verse_seen / patch_readiness / patch_prediction,
-- the comet vote is insert-only and refused once a patch is LIVE, the median
-- stays hidden until the caller voted, stars only enter through the
-- pool-validated RPC (comet via the vote trigger), verse_constellations and
-- verse_pins are public-read / privileged-write, and verse_digest() answers anon.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Fixtures (as the migration owner) ----------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-0000000e0001', 'pgtap-verse-a@example.test'),
  ('00000000-0000-4000-a000-0000000e0002', 'pgtap-verse-b@example.test');

insert into public.patch_stability_patches (patch_line, live_at, notes_thread_id, notes_slug)
values ('pgtap-9.0', now() - interval '3 days', 1, 'pgtap-notes')
on conflict (patch_line) do nothing;

insert into public.verse_constellations (patch_line, class_name, kind, points)
values ('pgtap-9.1', 'PGTAP_Ship', 'ship',
        '[[0.1,0.2],[0.3,0.1],[0.5,0.05],[0.7,0.1],[0.9,0.2],[0.6,0.8],[0.4,0.8]]');

-- Grants --------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.verse_seen', 'SELECT'), 'anon cannot read verse_seen');
select ok(not has_table_privilege('anon', 'public.patch_prediction', 'SELECT'), 'anon cannot read patch_prediction');
select ok(not has_table_privilege('authenticated', 'public.patch_prediction', 'UPDATE'), 'votes cannot be edited');
select ok(not has_table_privilege('authenticated', 'public.verse_star_progress', 'INSERT'), 'stars cannot be inserted directly');
select ok(not has_table_privilege('authenticated', 'public.verse_constellations', 'INSERT'), 'constellations are service-role write');
select ok(has_table_privilege('anon', 'public.verse_constellations', 'SELECT'), 'constellations are public read');
select ok(not has_function_privilege('anon', 'public.patch_prediction_median(text)', 'EXECUTE'), 'anon cannot call the median');
select ok(has_function_privilege('anon', 'public.verse_digest()', 'EXECUTE'), 'anon may call verse_digest');

-- Constraint: points must be exactly 7 normalised pairs
select throws_ok($$ insert into public.verse_constellations (patch_line, class_name, kind, points)
                   values ('pgtap-bad', 'X', 'ship', '[[0,0],[1,1]]') $$,
  '23514', null, 'a constellation needs exactly 7 points');

-- User A ----------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000e0001","role":"authenticated"}', true);

select lives_ok($$ insert into public.verse_seen (item_key) values ('news:a') $$, 'A marks an item seen');
select lives_ok($$ insert into public.patch_readiness (patch_line, checklist) values ('pgtap-9.1', '{"backup":true}') $$,
  'A saves a readiness checklist');
select is(public.patch_prediction_median('pgtap-9.1'), null, 'median hidden before A voted');
select lives_ok($$ insert into public.patch_prediction (patch_line, predicted_live_date)
                   values ('pgtap-9.1', current_date + 10) $$, 'A votes on an upcoming patch');
select is((public.patch_prediction_median('pgtap-9.1') ->> 'votes')::int, 1, 'median visible after A voted');
select is((select count(*)::int from public.verse_star_progress where star_key = 'comet'), 1,
  'the vote earned the comet star');
select throws_ok($$ insert into public.patch_prediction (patch_line, predicted_live_date)
                   values ('pgtap-9.0', current_date + 1) $$,
  '42501', null, 'no vote once the patch is LIVE');
select throws_ok($$ select public.verse_earn_star('pgtap-9.1', 'comet') $$,
  '22023', null, 'comet cannot be claimed directly');
select throws_ok($$ select public.verse_earn_star('pgtap-9.1', 'cx-compare') $$,
  '22023', null, 'a key outside the pool is refused');
select ok(public.verse_earn_star('pgtap-9.1', 'cx-newship'), 'cx-newship is offered when the patch has a ship');
select ok(not ('cx-newship' = any (public.verse_star_pool('pgtap-9.0'))), 'cx-newship is not offered without a ship');
select ok(cardinality(public.verse_star_pool('pgtap-9.1')) <= 7, 'the pool offers at most 7 stars');
select is((public.verse_explorer_state() -> 'streak' ->> 'current')::int, 1, 'explorer state counts the streak');
select throws_ok($$ insert into public.verse_pins (item_key, kind, title) values ('pin:x', 'link', 'x') $$,
  '42501', null, 'a non-admin cannot pin');

-- User B sees nothing of A ----------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000e0002","role":"authenticated"}', true);
select is((select count(*)::int from public.verse_seen), 0, 'B cannot see A''s seen rows');
select is((select count(*)::int from public.patch_prediction), 0, 'B cannot see A''s vote');
select is(public.patch_prediction_median('pgtap-9.1'), null, 'B gets no median without voting');
select is((select count(*)::int from public.verse_star_progress), 0, 'B cannot see A''s stars');

-- Anon ------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select ok(public.verse_digest() ? 'items', 'anon gets the digest payload');
reset role;

select * from finish();
rollback;
