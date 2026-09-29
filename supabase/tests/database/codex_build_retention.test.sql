-- prune_codex_builds (AUD-350, REQ-35).
--
-- Current definition: 20260928231143_delete_paths_and_log_retention.sql
-- (plan D02, AUD-113), replacing 20260925010000_codex_build_retention.sql.
-- Per channel it keeps the current build plus the p_keep newest FINALIZED
-- builds; a build without finalized_at (import running or abandoned) never
-- counts, so it cannot push the previous LIVE build out. Never-finalized,
-- non-current builds older than 7 days are swept.
--
-- Scenario, channel PGTAP, newest first, p_keep = 2:
--   d005  unfinished, 1 hour old     -> kept (does not count, not yet abandoned)
--   d004  finalized                  -> kept (rank 1)
--   d003  finalized                  -> kept (rank 2)
--   d002  finalized, is_current      -> kept (current, whatever its rank)
--   d001  finalized, oldest          -> PRUNED (rank 4)
--   d006  unfinished, 8 days old     -> PRUNED (abandoned import)
-- prune_codex_builds works on every channel; the local stack may hold other
-- builds, so every assertion filters on the test channel. rollback restores all.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into public.codex_builds (id, channel, patch_version, build_number, is_current, created_at, finalized_at) values
  ('00000000-0000-4000-d000-00000000d006', 'PGTAP', '4.0.0', '6', false, now() - interval '8 days',  null),
  ('00000000-0000-4000-d000-00000000d001', 'PGTAP', '4.0.0', '1', false, now() - interval '5 days',  now() - interval '5 days'),
  ('00000000-0000-4000-d000-00000000d002', 'PGTAP', '4.0.0', '2', true,  now() - interval '4 days',  now() - interval '4 days'),
  ('00000000-0000-4000-d000-00000000d003', 'PGTAP', '4.0.0', '3', false, now() - interval '3 days',  now() - interval '3 days'),
  ('00000000-0000-4000-d000-00000000d004', 'PGTAP', '4.0.0', '4', false, now() - interval '2 days',  now() - interval '2 days'),
  ('00000000-0000-4000-d000-00000000d005', 'PGTAP', '4.0.0', '5', false, now() - interval '1 hour',  null);

create temp table pruned on commit drop as
  select * from public.prune_codex_builds(2);

select set_eq(
  $$ select build_id from pruned where channel = 'PGTAP' $$,
  array['00000000-0000-4000-d000-00000000d001', '00000000-0000-4000-d000-00000000d006']::uuid[],
  'prunes the oldest finalized build beyond the two newest and the abandoned import'
);

select set_eq(
  $$ select id from public.codex_builds where channel = 'PGTAP' $$,
  array[
    '00000000-0000-4000-d000-00000000d002',
    '00000000-0000-4000-d000-00000000d003',
    '00000000-0000-4000-d000-00000000d004',
    '00000000-0000-4000-d000-00000000d005'
  ]::uuid[],
  'keeps the current build, the two newest finalized builds and a running import'
);

select ok(
  exists (select 1 from public.codex_builds where id = '00000000-0000-4000-d000-00000000d002' and is_current),
  'the current build survives although it ranks third'
);

select throws_ok(
  $$ select * from public.prune_codex_builds(0) $$,
  'P0001', null,
  'p_keep below 1 is refused'
);

select * from finish();
rollback;
