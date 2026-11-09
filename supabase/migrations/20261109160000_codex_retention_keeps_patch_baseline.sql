-- ============================================================
-- 20261109160000_codex_retention_keeps_patch_baseline.sql
-- The nightly build retention keeps the diff baseline of the current patch.
--
-- WHY
--   "Neu in <patch>" (Codex landing list, "new first" sorting, fleet deltas)
--   compares the current LIVE build with the newest build of an OLDER patch
--   (src/app/codex/codex-diff-pair.ts). prune_codex_builds(3) kept the newest
--   N builds per channel regardless of their patch, so rebuilds of one patch
--   (hotfix builds, re-extractions) pushed the older patch out: on 2026-11-09
--   only two 4.10.2 builds (12881860, 12913470 — identical) were left, 4.10.0
--   was gone and the landing's "Neu in 4.10.2" list came up empty. The deleted
--   4.10.0 rows cannot be restored (no backups on Supabase Free); this keeps
--   it from happening again from the next patch on.
--
-- WHAT
--   prune_codex_builds(p_keep) — same signature, same return — additionally
--   spares, per channel, the newest finalized build whose patch_version differs
--   from the channel's newest kept build (the current one when there is one).
--   Everything else is unchanged: the p_keep newest finalized builds stay, the
--   is_current build always stays, never-finalized non-current builds go after
--   7 days.
--
-- SAFETY
--   Only narrows what the nightly job deletes (one extra build per channel at
--   most, ~payload-deduped, see .claude/deep-knowledge/storage.md). No data is
--   touched by this migration itself. Dry run:
--     begin; select * from public.prune_codex_builds(3); rollback;
-- ============================================================

create or replace function public.prune_codex_builds(p_keep integer default 3)
returns table(build_id uuid, channel text, patch_version text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_keep is null or p_keep < 1 then
    raise exception 'prune_codex_builds: p_keep must be >= 1 (got %)', p_keep;
  end if;

  return query
  with eligible as (
    select b.id, b.channel, b.patch_version, b.is_current, b.created_at
    from public.codex_builds b
    where b.finalized_at is not null or b.is_current
  ),
  ranked as (
    select e.*, row_number() over (partition by e.channel order by e.created_at desc) as rn
    from eligible e
  ),
  -- The patch "new in" is measured for: the current build's, else the channel's newest.
  head as (
    select distinct on (r.channel) r.channel, r.patch_version
    from ranked r
    order by r.channel, r.is_current desc, r.created_at desc
  ),
  -- Its diff baseline: the newest eligible build of any other patch.
  baseline as (
    select distinct on (r.channel) r.id
    from ranked r
    join head h on h.channel = r.channel
    where r.patch_version is distinct from h.patch_version
    order by r.channel, r.created_at desc
  ),
  doomed as (
    select r.id from ranked r
    where r.rn > p_keep and not r.is_current
      and r.id not in (select id from baseline)
    union
    select b.id from public.codex_builds b
    where b.finalized_at is null and not b.is_current
      and b.created_at < now() - interval '7 days'
  )
  delete from public.codex_builds d
  using doomed x
  where d.id = x.id
  returning d.id, d.channel, d.patch_version;
end
$function$;
