-- ============================================================
-- codex_locations — Verse location catalog (#1365, epic #1364)
-- ============================================================
-- One row per navigable place (system, star, planet, moon, Lagrange point,
-- station, city, outpost, clinic, comm array, jump point …) per codex build.
-- Mirrored by the desktop app (codex-sync-service → codex mirror, kind
-- 'location') and preferred over the app's bundled verse-locations.json.
--
-- Coordinates (meters):
--   frame = 'system' → pos_* in the star-system frame
--   frame = 'body'   → pos_* in the parent body's ROTATING frame (parent_id)
--   frame = null     → place is listed without coordinates (pos_* null)
--
-- Licensing: every row carries `source` (source ids, comma separated, see the
-- desktop catalog's `sources` block) and `license` (the matching licence
-- terms). No CC BY-NC-SA material is stored here.
--
-- Access: public read (anon + authenticated) exactly like the other codex_*
-- tables (20260710190000_public_codex_read.sql); writes service_role only.
-- ADDITIVE: this migration drops nothing.
-- ============================================================

create table public.codex_locations (
  build_id    uuid not null references public.codex_builds(id) on delete cascade,
  id          text not null,
  name        text not null,
  type        text not null,
  system_code text not null,
  parent_id   text,
  frame       text check (frame is null or frame in ('system', 'body')),
  pos_x       double precision,
  pos_y       double precision,
  pos_z       double precision,
  aliases     text[] not null default '{}'::text[],
  attributes  jsonb not null default '{}'::jsonb,
  source      text not null,
  license     text not null,
  created_at  timestamptz not null default now(),
  primary key (build_id, id),
  constraint codex_locations_pos_complete check (
    (frame is null and pos_x is null and pos_y is null and pos_z is null)
    or (frame is not null and pos_x is not null and pos_y is not null and pos_z is not null)
  )
);

comment on table public.codex_locations is
  'Verse location catalog per codex build (systems, bodies, Lagrange points, stations, '
  'outposts, jump points). frame=system: pos_* in system frame (m); frame=body: pos_* '
  'in parent body rotating frame (m); frame null: no coordinates. attributes holds '
  'radiusM/omRadiusM/rotationHours/rotationAdjustDeg/hidden. source/license = per-row '
  'attribution. Public read; service_role writes only.';

create index codex_locations_system_code_idx on public.codex_locations (build_id, system_code);
create index codex_locations_parent_id_idx   on public.codex_locations (build_id, parent_id);
create index codex_locations_type_idx        on public.codex_locations (build_id, type);

-- RLS: same model as the other codex_* tables.
alter table public.codex_locations enable row level security;

drop policy if exists codex_locations_authenticated_read on public.codex_locations;
create policy codex_locations_authenticated_read on public.codex_locations
  for select to authenticated using (true);

drop policy if exists codex_locations_anon_read on public.codex_locations;
create policy codex_locations_anon_read on public.codex_locations
  for select to anon using (true);

grant select on public.codex_locations to anon, authenticated;

-- Writes: service_role only (no write policies; table-level DML revoked).
revoke insert, update, delete, truncate on public.codex_locations from authenticated, anon;
