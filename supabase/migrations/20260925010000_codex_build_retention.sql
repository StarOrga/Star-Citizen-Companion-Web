-- Codex build retention (storage plan 2026-09-24).
--
-- ingest-catalog never pruned old builds, so every patch upload added a full
-- catalog (~160 MB after VACUUM, ~190 MB before) to a Free-plan database whose
-- limit is 500 MB. On 2026-09-24 the database stood at 952 MB with six builds.
-- The four obsolete ones (three 2026-05-30 prototype builds "4.x"
-- live-proof/live-slots/live-preview and 4.8.0 with quality_score 0) were
-- deleted by hand, followed by VACUUM FULL on every codex_* table: 952 -> 349 MB.
-- Alpha data policy: codex_* is re-extractable catalog data, not user data.
--
-- What still READS older builds: the Holotable patch selector
-- (CodexService.buildsForChannel) and the inline patch diff
-- (CodexService.recentLiveBuilds, current + previous). Keeping the newest TWO
-- builds per channel keeps both working.
--
-- prune_codex_builds(p_keep):
--   * per channel, keeps the p_keep newest builds by created_at,
--   * never deletes the channel's is_current build, whatever its age,
--   * deletes through codex_builds, every codex_* child table cascades
--     (ON DELETE CASCADE since 00008 / 00010 / 20260530 / 20260712 / 20260920).
-- Freed pages are reused by the next ingest after autovacuum; the database
-- size only SHRINKS after a VACUUM FULL, which is deliberately not scheduled
-- (it takes an ACCESS EXCLUSIVE lock on catalog tables the site reads).
--
-- Scheduled nightly via pg_cron instead of being called from the ingest
-- `finalize` op: a cascade over ~500k rows can outlive an edge-function
-- request, and a failed prune must never fail an ingest.
--
-- ROLLBACK: select cron.unschedule('codex-build-retention');
--           drop function public.prune_codex_builds(int);

create extension if not exists pg_cron;

create or replace function public.prune_codex_builds(p_keep int default 2)
returns table (build_id uuid, channel text, patch_version text)
language plpgsql security definer set search_path = public as $func$
begin
  if p_keep is null or p_keep < 1 then
    raise exception 'prune_codex_builds: p_keep must be >= 1 (got %)', p_keep;
  end if;

  return query
  with ranked as (
    select b.id, b.channel, b.is_current,
           row_number() over (partition by b.channel order by b.created_at desc) as rn
    from public.codex_builds b
  )
  delete from public.codex_builds d
  using ranked r
  where d.id = r.id
    and r.rn > p_keep
    and not r.is_current
  returning d.id, d.channel, d.patch_version;
end
$func$;

revoke all on function public.prune_codex_builds(int) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'codex-build-retention') then
    perform cron.unschedule('codex-build-retention');
  end if;
end $$;

select cron.schedule(
  'codex-build-retention',
  '30 3 * * *',
  $job$ select count(*) from public.prune_codex_builds(2); $job$
);
