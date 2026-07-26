-- Codex Showroom discovery plane. A cheap, metadata-only summary of which ships
-- have 3D liveries — one row per ship that has >=1 ship_skins entry. NEVER carries
-- a .glb URL (the heavy asset plane resolves those per-ship in the viewer). Small
-- forever (hundreds of rows), so a plain view suffices — no materialized refresh.
--
-- Data provenance: derived purely from public.ship_skins, which is populated ONLY
-- by the data-uploader -> ingest-skins pipeline (build-scoped). No counts are
-- hardcoded; this view reflects whatever the uploader has ingested.
--
-- security_invoker=true so the caller's RLS on ship_skins applies (ship_skins
-- already grants anon + authenticated SELECT). Build scoping / display names are
-- resolved client-side against codex_ships for the current LIVE build.

create or replace view public.ship_skins_index
with (security_invoker = true) as
select
  s.ship_id,
  count(*)                                                as livery_count,
  count(s.model_path)                                     as model_count,
  min(s.icon_path) filter (where s.icon_path is not null) as poster_path,
  array_agg(distinct s.source order by s.source)          as sources,
  max(s.created_at)                                       as latest_added
from public.ship_skins s
group by s.ship_id;

grant select on public.ship_skins_index to anon, authenticated;
