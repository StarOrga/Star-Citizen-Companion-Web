-- Codex storage reclaim (storage plan, 2026-10-23).
--
-- Problem: prune_codex_builds(2) (pg_cron 'codex-build-retention', 03:30) deletes
-- old builds through the codex_builds cascade, but DELETE only makes pages
-- reusable, it never returns them to the OS. The database therefore creeps back
-- to ~480-510 MB (Free plan limit: 500 MB). Measured 2026-10-23: 434 MB; a
-- manual VACUUM FULL of codex_locale_strings (empty staging table, 46 MB bloated
-- pkey) and of every codex_* table brought it to 241 MB with builds 4.10.0 and
-- 4.10.2 intact.
--
-- This migration schedules that VACUUM FULL nightly, one pg_cron job per table.
-- Why one job per table: VACUUM cannot run inside a transaction block or a
-- function, and pg_cron sends a job's command string as one simple-query
-- message, so a string with several statements becomes ONE implicit transaction
-- and VACUUM refuses it. A single-statement command is fine.
--
-- Schedule: 04:45 .. 04:58 UTC, one table per minute, big tables first. That is
-- after the prune (03:30) and after the other nightly slots (04:15, 04:25, 04:40;
-- sc-events-sync runs at :17 every 6 h and is unrelated) and before
-- patch-stability (06:00). The jobs touch only codex_* tables.
--
-- Trade-offs (deliberate):
--   * VACUUM FULL takes an ACCESS EXCLUSIVE lock: reads of that table block for
--     its duration. Measured 2026-10-23: codex_items ~29 s, codex_entity_strings
--     ~13 s, the rest 1-4 s each. Off-hours, and the web app caches the catalog
--     (ngsw + ETag), so a reader sees at worst one slow request.
--   * It rewrites the table, so it needs free disk for a second copy of that
--     one table (largest ~100 MB) while it runs. Fine below the 500 MB limit;
--     it would fail, not corrupt, if the database were already at the limit.
--   * It runs every night, also when the prune deleted nothing. A "only if the
--     prune deleted something" condition is not possible: VACUUM cannot be
--     called from SQL/PL/pgSQL, and the job string must be a single statement.
--     On a night with nothing to reclaim it just rewrites ~240 MB once (~1 min
--     in total). Cheaper than a 500 MB database that blocks writes (402).
--   * No statement_timeout is set (it cannot be in the same string). The
--     slowest table is ~29 s, well below the postgres role's default.
--
-- codex_builds itself is tiny and not vacuumed. Tables = every codex_* table
-- with a build_id column in migrations 00008, 00010, 20260530000000,
-- 20260712000000, 20260920150000, 20261008123750. A table added later needs a
-- line here (new migration) or it keeps its bloat.
--
-- Idempotent: each job is unscheduled first if it exists.
--
-- Verify after the first night:
--   select jobname, status, return_message, start_time, end_time
--   from cron.job_run_details d join cron.job j using (jobid)
--   where j.jobname like 'codex-storage-reclaim-%' order by start_time desc;
--
-- ROLLBACK:
--   select cron.unschedule(jobname) from cron.job
--   where jobname like 'codex-storage-reclaim-%';

do $$
declare
  t record;
begin
  for t in
    select * from (values
      (1,  'codex_items'),
      (2,  'codex_entity_strings'),
      (3,  'codex_locale_strings'),
      (4,  'codex_components'),
      (5,  'codex_blueprints'),
      (6,  'codex_weapons'),
      (7,  'codex_ships'),
      (8,  'codex_item_ports'),
      (9,  'codex_silhouettes'),
      (10, 'codex_manufacturers'),
      (11, 'codex_blueprint_ingredients'),
      (12, 'codex_ammunition'),
      (13, 'codex_keybinds'),
      (14, 'codex_locations')
    ) as v(slot, tbl)
  loop
    if exists (select 1 from cron.job where jobname = 'codex-storage-reclaim-' || t.tbl) then
      perform cron.unschedule('codex-storage-reclaim-' || t.tbl);
    end if;
    perform cron.schedule(
      'codex-storage-reclaim-' || t.tbl,
      format('%s 4 * * *', 44 + t.slot),
      format('vacuum full public.%I', t.tbl)
    );
  end loop;
end $$;
