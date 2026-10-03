-- ============================================================
-- 20261003214512_ship_blueprints.sql
-- Blueprint drawings per ship hull (data-uploader/docs/blueprint.md).
--
-- The uploader draws two SVGs from every hull GLB it uploads (top + side
-- line drawing `full`, top-view `icon`) and stores them content-addressed in
-- R2 under `ship-skins/_blueprints/<sha256>.svg`, through ingest-skins
-- (blueprint_sign / blueprint_commit). Commit links them to the ship's hull
-- rows (`model_path is not null`) — the drawing belongs to the hull, and only
-- that row has one.
--
-- The web reads both paths from ship_skins_index, which it already loads once
-- per session for the Holo-Ready badge: one request tells the search rows and
-- tiles which ships have a drawing, so a ship without one never costs a 404.
--
-- ADDITIVE: two nullable columns + two view columns. Nothing is dropped; a
-- hull commit (upsert of the listed columns) leaves the drawing columns alone.
-- ============================================================

alter table public.ship_skins
  add column if not exists blueprint_path text,
  add column if not exists blueprint_icon_path text;

alter table public.ship_skins
  add constraint ship_skins_blueprint_path_shape
    check (blueprint_path is null or blueprint_path ~ '^_blueprints/[0-9a-f]{64}\.svg$'),
  add constraint ship_skins_blueprint_icon_path_shape
    check (blueprint_icon_path is null or blueprint_icon_path ~ '^_blueprints/[0-9a-f]{64}\.svg$');

comment on column public.ship_skins.blueprint_path is
  'Full blueprint drawing (top + side SVG) of this row''s hull, `_blueprints/<sha256>.svg` under ship-skins/. Hull rows only; written by ingest-skins blueprint_commit.';
comment on column public.ship_skins.blueprint_icon_path is
  'Icon blueprint drawing (top-view SVG) of this row''s hull, `_blueprints/<sha256>.svg` under ship-skins/. Hull rows only; written by ingest-skins blueprint_commit.';

-- New columns go last: `create or replace view` may only append.
create or replace view public.ship_skins_index
with (security_invoker = true) as
select
  s.ship_id,
  count(*)                                                as livery_count,
  count(s.model_path)                                     as model_count,
  min(s.icon_path) filter (where s.icon_path is not null) as poster_path,
  array_agg(distinct s.source order by s.source)          as sources,
  max(s.created_at)                                       as latest_added,
  min(s.blueprint_path) filter (where s.blueprint_path is not null)           as blueprint_path,
  min(s.blueprint_icon_path) filter (where s.blueprint_icon_path is not null) as blueprint_icon_path
from public.ship_skins s
group by s.ship_id;

grant select on public.ship_skins_index to anon, authenticated;
