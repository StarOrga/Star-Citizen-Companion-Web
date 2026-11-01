-- HQ RLS + RPC contracts (migrations 20261101000000 .. 20261101070000).
--
-- Pins: owner-only isolation on every hq_* table, LWW + caps on hq_supplies, step/kind and
-- payload-size checks, the favourite cap, community reports being insert-only with a median
-- that stays hidden below 5 distinct users and drops IQR outliers, and the RPC grants.
-- Runs in begin ... rollback as the real roles (authenticated / anon).
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- Fixtures (as the migration owner) ----------------------------------------
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-a000-0000000f0001', 'pgtap-hq-a@example.test', now() - interval '30 days'),
  ('00000000-0000-4000-a000-0000000f0002', 'pgtap-hq-b@example.test', now() - interval '30 days'),
  ('00000000-0000-4000-a000-0000000f0003', 'pgtap-hq-c@example.test', now() - interval '30 days'),
  ('00000000-0000-4000-a000-0000000f0004', 'pgtap-hq-d@example.test', now() - interval '30 days'),
  ('00000000-0000-4000-a000-0000000f0005', 'pgtap-hq-e@example.test', now() - interval '30 days'),
  ('00000000-0000-4000-a000-0000000f0006', 'pgtap-hq-f@example.test', now() - interval '30 days'),
  ('00000000-0000-4000-a000-0000000f0007', 'pgtap-hq-g@example.test', now() - interval '30 days'),
  ('00000000-0000-4000-a000-0000000f0008', 'pgtap-hq-h@example.test', now() - interval '30 days'),
  -- fresh account (< 7 days): its reports must not count
  ('00000000-0000-4000-a000-0000000f0009', 'pgtap-hq-i@example.test', now());
-- Every fixture account is approved (the restrictive is_approved() gate, 20261101080000).
insert into public.profiles (id, is_approved)
select u.id, true from auth.users u where u.email like 'pgtap-hq-%@example.test'
on conflict (id) do update set is_approved = true;

-- Community fixtures: L1 has 6 distinct reporters incl. one outlier (5 remain after removal),
-- L2 only 4 reporters, L3 4 old + 1 fresh account (only 4 count), L4 5 reporters but the
-- outlier removal leaves 4 (all three below the threshold).
insert into public.hq_community_reports (user_id, kind, class_name, location, value) values
  ('00000000-0000-4000-a000-0000000f0003', 'price', 'PGTAP_Item', 'L1', 100),
  ('00000000-0000-4000-a000-0000000f0004', 'price', 'PGTAP_Item', 'L1', 102),
  ('00000000-0000-4000-a000-0000000f0005', 'price', 'PGTAP_Item', 'L1', 98),
  ('00000000-0000-4000-a000-0000000f0006', 'price', 'PGTAP_Item', 'L1', 101),
  ('00000000-0000-4000-a000-0000000f0007', 'price', 'PGTAP_Item', 'L1', 5000),
  ('00000000-0000-4000-a000-0000000f0008', 'price', 'PGTAP_Item', 'L1', 99),
  ('00000000-0000-4000-a000-0000000f0003', 'price', 'PGTAP_Item', 'L3', 70),
  ('00000000-0000-4000-a000-0000000f0004', 'price', 'PGTAP_Item', 'L3', 70),
  ('00000000-0000-4000-a000-0000000f0005', 'price', 'PGTAP_Item', 'L3', 70),
  ('00000000-0000-4000-a000-0000000f0006', 'price', 'PGTAP_Item', 'L3', 70),
  ('00000000-0000-4000-a000-0000000f0009', 'price', 'PGTAP_Item', 'L3', 70),
  ('00000000-0000-4000-a000-0000000f0003', 'price', 'PGTAP_Item', 'L4', 10),
  ('00000000-0000-4000-a000-0000000f0004', 'price', 'PGTAP_Item', 'L4', 10),
  ('00000000-0000-4000-a000-0000000f0005', 'price', 'PGTAP_Item', 'L4', 10),
  ('00000000-0000-4000-a000-0000000f0006', 'price', 'PGTAP_Item', 'L4', 10),
  ('00000000-0000-4000-a000-0000000f0007', 'price', 'PGTAP_Item', 'L4', 9999),
  ('00000000-0000-4000-a000-0000000f0003', 'price', 'PGTAP_Item', 'L2', 50),
  ('00000000-0000-4000-a000-0000000f0004', 'price', 'PGTAP_Item', 'L2', 50),
  ('00000000-0000-4000-a000-0000000f0005', 'price', 'PGTAP_Item', 'L2', 50),
  ('00000000-0000-4000-a000-0000000f0006', 'price', 'PGTAP_Item', 'L2', 50);

-- Grants --------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.hq_supplies', 'SELECT'), 'anon cannot read hq_supplies');
select ok(not has_table_privilege('anon', 'public.hq_live_events', 'SELECT'), 'anon cannot read hq_live_events');
select ok(not has_table_privilege('authenticated', 'public.hq_community_reports', 'SELECT'), 'nobody reads raw community reports');
select ok(not has_function_privilege('anon', 'public.hq_community_median(text,text)', 'EXECUTE'), 'anon cannot call the community median');
select ok(not has_function_privilege('anon', 'public.hq_fleet_patch()', 'EXECUTE'), 'anon cannot call hq_fleet_patch');
select ok(not has_function_privilege('anon', 'public.hq_stats(text)', 'EXECUTE'), 'anon cannot call hq_stats');

-- User A ----------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000f0001","role":"authenticated"}', true);

select lives_ok($$ insert into public.hq_supplies (id, name, qty, step_kind, set_kind, set_id)
                   values ('s1', 'Original', 2, 'buy', 'ship', gen_random_uuid()) $$, 'A adds a supply');
select lives_ok($$ insert into public.hq_einsaetze (id, title, activity)
                   values ('00000000-0000-4000-a000-0000000e1001', 'Bunker run', 'bunker') $$, 'A creates an Einsatz');
select lives_ok($$ insert into public.hq_einsatz_steps (einsatz_id, ord, kind, label)
                   values ('00000000-0000-4000-a000-0000000e1001', 0, 'buy', 'Kaufen') $$, 'A adds a step');
select lives_ok($$ insert into public.hq_live_events (id, type, data, at)
                   values ('e1', 'shop.purchase', '{"kind":"buy","price":1200}', now()) $$, 'A stores a live event');
select lives_ok($$ insert into public.hq_live_state (state) values ('{"location":"Lorville"}') $$, 'A stores the live state');
select lives_ok($$ insert into public.hq_inventory_snapshots (location, source) values ('Lorville', 'log') $$, 'A stores a snapshot');
select lives_ok($$ insert into public.hq_inventory_items (location, name, qty, unit)
                   values ('Lorville', 'Gold', 12, 'scu') $$, 'A stores a snapshot item');
select lives_ok($$ insert into public.hq_community_reports (kind, class_name, location, value)
                   values ('price', 'PGTAP_Other', 'L9', 10) $$, 'A files a community report');

-- Validation / isolation of writes
select throws_ok($$ insert into public.hq_supplies (user_id, id, name)
                    values ('00000000-0000-4000-a000-0000000f0002', 'x', 'Spoof') $$,
  '42501', null, 'A cannot write a supply for B');
select throws_ok($$ insert into public.hq_einsatz_steps (einsatz_id, ord, kind, label)
                    values ('00000000-0000-4000-a000-0000000e1001', 1, 'dance', 'Bad kind') $$,
  '23514', null, 'an unknown step kind is rejected');
select throws_ok($$ insert into public.hq_live_events (id, type, data, at)
                    values ('big', 'shop.purchase', jsonb_build_object('x', repeat('y', 3000)), now()) $$,
  '23514', null, 'a live event payload over 2 KiB is rejected');
select throws_ok($$ select count(*) from public.hq_community_reports $$,
  '42501', null, 'A cannot select community reports');

-- LWW: a stale edit must not overwrite the stored row
update public.hq_supplies set name = 'Stale', updated_at = now() - interval '1 hour' where id = 's1';
select is((select name from public.hq_supplies where id = 's1'), 'Original', 'a stale update is skipped (last-write-wins)');

-- Cap: 300 live supplies per user
select lives_ok($$ insert into public.hq_supplies (id, name)
                   select 'bulk-' || g, 'Bulk ' || g from generate_series(1, 299) g $$, 'A fills the 300 supply slots');
select throws_ok($$ insert into public.hq_supplies (id, name) values ('over', 'Over the cap') $$,
  '23514', null, 'the 301st live supply is rejected');

-- R1: at the cap, an upsert of an EXISTING row (a deletion push) must still work
select lives_ok($$ insert into public.hq_supplies (id, name, deleted_at) values ('s1', 'Original', now())
                   on conflict (user_id, id) do update set deleted_at = excluded.deleted_at $$,
  'an upsert of an existing supply at the cap (tombstone push) is not blocked');

-- R2: atomic step replace, cap 40, upsert of an existing step at the cap, tombstone drops steps
select is(public.hq_replace_einsatz_steps('00000000-0000-4000-a000-0000000e1001',
  (select jsonb_agg(jsonb_build_object('kind', 'buy', 'label', 'Step ' || g)) from generate_series(1, 40) g)), 40,
  'hq_replace_einsatz_steps writes 40 steps');
select throws_ok($$ select public.hq_replace_einsatz_steps('00000000-0000-4000-a000-0000000e1001',
  (select jsonb_agg(jsonb_build_object('kind', 'buy', 'label', 'Step ' || g)) from generate_series(1, 41) g)) $$,
  '23514', null, 'more than 40 steps are rejected');
select lives_ok($$ insert into public.hq_einsatz_steps (einsatz_id, ord, kind, label)
                   values ('00000000-0000-4000-a000-0000000e1001', 0, 'buy', 'Re-pushed')
                   on conflict (einsatz_id, ord) do update set label = excluded.label $$,
  'upserting an existing step at 40 steps is not blocked');
update public.hq_einsaetze set deleted_at = now() where id = '00000000-0000-4000-a000-0000000e1001';
select is((select count(*)::int from public.hq_einsatz_steps where einsatz_id = '00000000-0000-4000-a000-0000000e1001'), 0,
  'tombstoning an Einsatz deletes its steps');

-- Favourite cap: 3 FPS sets
select lives_ok($$ insert into public.hangar_role_loadouts (user_id, name, role, favorite) values (auth.uid(), 'F1', 'fps', true) $$, 'favourite FPS set 1');
select lives_ok($$ insert into public.hangar_role_loadouts (user_id, name, role, favorite) values (auth.uid(), 'F2', 'fps', true) $$, 'favourite FPS set 2');
select lives_ok($$ insert into public.hangar_role_loadouts (user_id, name, role, favorite) values (auth.uid(), 'F3', 'fps', true) $$, 'favourite FPS set 3');
select throws_ok($$ insert into public.hangar_role_loadouts (user_id, name, role, favorite) values (auth.uid(), 'F4', 'fps', true) $$,
  '23514', null, 'a fourth favourite FPS set is rejected');

-- Community median: L1 passes the threshold and drops the 5000 outlier; L2 (4 users) stays hidden
select is((select count(*)::int from public.hq_community_median('price', 'PGTAP_Item')), 1,
  'only L1 qualifies (L3: fresh account does not count, L4: < 5 users after outlier removal)');
select is((select median from public.hq_community_median('price', 'PGTAP_Item') where location = 'L1'), 100::numeric,
  'the median ignores the IQR outlier');
select is((select newest from public.hq_community_median('price', 'PGTAP_Item') where location = 'L1'),
  date_trunc('day', now()), 'newest is rounded to the day');

-- User B ----------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000f0002","role":"authenticated"}', true);

select is((select count(*)::int from public.hq_supplies)
        + (select count(*)::int from public.hq_einsaetze)
        + (select count(*)::int from public.hq_einsatz_steps)
        + (select count(*)::int from public.hq_live_events)
        + (select count(*)::int from public.hq_live_state)
        + (select count(*)::int from public.hq_inventory_snapshots)
        + (select count(*)::int from public.hq_inventory_items), 0,
  'B sees none of A''s HQ rows');
select is((select (public.hq_stats('7d') -> 'missions' ->> 'total')::int), 0, 'hq_stats returns zeros for an empty user');
select is(public.hq_fleet_patch() -> 'lines', '[]'::jsonb, 'hq_fleet_patch has no lines for a user without a hangar');

reset role;

select * from finish();
rollback;
