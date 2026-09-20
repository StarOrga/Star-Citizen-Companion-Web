-- ============================================================
-- 20260920150000_codex_silhouettes.sql
-- Holotable silhouettes — build-scoped, uploader-derived outline + hardpoint
-- anchor data for ships AND mountable items (weapons/components/armor), per
-- the Wave-0 research contract
-- (docs/concepts/2026-09-20-codex-schiffsansicht-cinematisch-build/wave0-research.md
-- §C1/§C2) and the concept decisions (it.1/it.2/it.6 general comment).
--
-- WHAT THIS CREATES
--   codex_silhouettes — one row per (build, kind, class_name): the traced
--   top-down outline path the DATA UPLOADER renders from the raw hull/item
--   mesh (cgf-converter output, opencv contour trace + SCC styling), plus the
--   % anchors for every hardpoint the extractor already resolves via
--   codex_item_ports.position. THE WEBSITE NEVER COMPUTES, PROJECTS OR STYLES
--   ANY OF THIS — it only renders the delivered path/anchors verbatim
--   (concept it.6 general comment: "achte darauf nix zu erfinden ... die
--   website nimmt nur die sachen und stellt sie dar").
--
-- WHY A NEW TABLE (not keys inside codex_ships.payload — research §C2 option A)
--   The silhouette path is a separately-cacheable, Holotable-only artefact
--   that ships AND weapon/component/armor items need alike (tile-view art
--   when no preview exists) — keying by (kind, class_name) lets ONE table
--   serve every entity kind instead of duplicating the column across every
--   codex_<kind>.payload blob that every list/detail fetch would then also
--   carry (research §C2 option A con).
--
-- NATURAL KEY
--   Same shape as every other codex_* table: (channel, patch_version,
--   build_number, kind, class_name), FK'd to codex_builds.id so the
--   "current build" predicate scopes it exactly like codex_ships etc.
--
-- COLUMNS
--   view_box / path / bbox — the SVG contour (viewBox string, path `d`
--   attribute, bounding box) as delivered — never re-derived here.
--   anchors  — ships only: [{portId, x, y (% of viewBox), side, depth,
--              source, helper, clamped}]. '[]' for every non-ship kind
--              (contract §C1 — no client-side projection).
--   unresolved — port ids the uploader could not resolve to a mesh helper on
--              THIS build (rendered as dashed edge pins per §C3, never
--              silently dropped).
--   meta     — {source, method, frame, toolVersion, generatedAt,
--              scaleMPerUnit, pointCount, simplifyToleranceM, schema}: the
--              uploader's audit trail. Kept heterogeneous JSONB (alpha-phase
--              churn rationale, same as codex_components.payload.stats) so it
--              can grow without another migration.
--
-- RLS
--   Mirrors 00008_codex_catalog.sql + 20260710190000_public_codex_read.sql:
--   viewer (authenticated) AND anon SELECT, service-role-only writes.
--
-- ADDITIVE: this migration drops nothing.
-- ============================================================

create table public.codex_silhouettes (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  kind text not null check (kind in ('ship', 'weapon', 'component', 'item', 'armor')),
  class_name text not null,
  view_box text not null,
  path text not null,
  bbox jsonb not null,
  anchors jsonb not null default '[]'::jsonb,
  unresolved jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint codex_silhouettes_natkey
    unique (channel, patch_version, build_number, kind, class_name)
);

create index codex_silhouettes_build_idx on public.codex_silhouettes (build_id);

-- Current-build lookup by (kind, class_name) — the Holotable's hot path
-- (CodexService.silhouette(kind, className) for the current build).
create index codex_silhouettes_kind_class_idx
  on public.codex_silhouettes (build_id, kind, class_name);

comment on table public.codex_silhouettes is
  'Uploader-derived top-down outline + hardpoint anchors for the Holotable view (ships) and tile-view art (weapons/components/armor). Website renders verbatim, never computes.';

-- ============================================================
-- RLS — viewer + anon readable, service-role-writable (mirrors codex_* / 20260710190000)
-- ============================================================
alter table public.codex_silhouettes enable row level security;

create policy codex_silhouettes_authenticated_read on public.codex_silhouettes
  for select to authenticated using (true);

create policy codex_silhouettes_anon_read on public.codex_silhouettes
  for select to anon using (true);

revoke insert, update, delete, truncate on public.codex_silhouettes from authenticated, anon;
grant select on public.codex_silhouettes to anon;
