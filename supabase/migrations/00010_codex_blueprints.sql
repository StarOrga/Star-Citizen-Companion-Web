-- ============================================================
-- 00010_codex_blueprints.sql
-- Crafting Blueprint catalog layer (Wave 1b).
--
-- WHAT THIS CREATES
--   codex_blueprints        — one row per CraftingBlueprintRecord extracted by
--                             the desktop tool. Promoted scalar columns cover the
--                             UI filter/sort surface; full payload stored as JSONB.
--   codex_blueprint_ingredients — child table (one row per ingredient per
--                             blueprint), mirrors the codex_item_ports pattern.
--                             Indexed both forward (all ingredients of blueprint X)
--                             AND reverse (all blueprints that use resource Y) —
--                             the "what can I craft with resource X?" differentiator.
--
-- NATURAL KEY
--   Same composite key as all codex_* entity tables:
--     (channel, patch_version, build_number, class_name)
--   build_id FK to codex_builds for compact join.
--
-- JSONB RATIONALE
--   ingredients[], outputs[], qualityRefs, gameplayProperties, categoryLabel, raw
--   are all heterogeneous / still-evolving (R1–R5 status per extractor). Only the
--   handful of columns the UI sorts/filters on are promoted (category, tier,
--   craft_time_seconds, output_class_name, is_default). The full BlueprintPayload
--   JSON is kept in `payload` so the schema survives patch churn without migration.
--
-- RLS
--   Mirrors 00008 exactly: SELECT = any authenticated user, INSERT/UPDATE/DELETE
--   = service_role only (no write policies; grants revoked from authenticated/anon).
--
-- ADDITIVE: this migration drops nothing. All objects are new codex_blueprint_*.
-- ============================================================

-- ============================================================
-- codex_blueprints — one row per CraftingBlueprintRecord
-- ============================================================
create table public.codex_blueprints (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  class_name text not null,
  guid text,
  entity_kind text not null default 'blueprint',

  -- Promoted scalar columns (UI filter / sort surface)
  category text,                     -- category className string (e.g. "Craft_Cat_Weapons")
  tier int,                          -- integer blueprint tier (1–N; null if unresolved)
  craft_time_seconds numeric,        -- fabrication time in seconds (null = unverified)
  dismantle_time_seconds numeric,    -- dismantle time in seconds (null = unverified)
  dismantle_efficiency numeric,      -- 0–1 fraction (null = unverified)
  output_class_name text,            -- className of outputs[0] (primary craft product)
  is_default boolean,                -- isAvailableByDefault flag from DataForge
  is_variant boolean not null default false,  -- heuristic (reserved; always false in v1)

  -- Denormalized name for trigram search (en preferred, de fallback)
  name_localized text,

  -- Full BlueprintPayload JSON (nothing lost — survives schema churn)
  payload jsonb not null,

  created_at timestamptz not null default now(),
  constraint codex_blueprints_natkey
    unique (channel, patch_version, build_number, class_name)
);

comment on table public.codex_blueprints is
  'Crafting Blueprint catalog (one row per CraftingBlueprintRecord). '
  'Full payload in JSONB; promoted columns for UI filter/sort. '
  'Child ingredients in codex_blueprint_ingredients.';

-- ============================================================
-- codex_blueprint_ingredients — child table, one row per ingredient
-- ============================================================
-- Parent is referenced by (build_id, blueprint_class_name) — same soft-ref
-- pattern as codex_item_ports (parent_class_name, parent_kind). No hard FK to
-- codex_blueprints because ingredient rows are deleted + re-inserted per seed run.
create table public.codex_blueprint_ingredients (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  blueprint_class_name text not null,   -- FK to codex_blueprints.class_name (soft)
  ingredient_class_name text,           -- null = dangling GUID (unresolvable in v1)
  ingredient_guid text,                 -- raw DataForge GUID
  quantity numeric,
  min_quality numeric,
  role text,                            -- ingredient role slot (unconfirmed field — R1)
  ingredient_index int not null default 0,  -- preserves order within the blueprint
  created_at timestamptz not null default now()
);

comment on table public.codex_blueprint_ingredients is
  'Flattened ingredients of each blueprint. '
  'Indexed forward (blueprint -> ingredients) AND reverse (ingredient -> blueprints). '
  'Null ingredient_class_name = dangling GUID not resolvable in this build.';

-- ============================================================
-- Promoted-column indexes (UI filter / sort)
-- ============================================================
create index codex_blueprints_build_idx
  on public.codex_blueprints (build_id);

create index codex_blueprints_filter_idx
  on public.codex_blueprints (build_id, category, tier, is_default);

create index codex_blueprints_output_idx
  on public.codex_blueprints (build_id, output_class_name);

-- ============================================================
-- Trigram search indexes — class_name + localized name
-- ============================================================
-- pg_trgm already enabled by 00008 (create extension if not exists pg_trgm).
create index codex_blueprints_class_trgm
  on public.codex_blueprints using gin (class_name extensions.gin_trgm_ops);

create index codex_blueprints_name_trgm
  on public.codex_blueprints using gin (name_localized extensions.gin_trgm_ops);

-- ============================================================
-- Ingredient lookup indexes
-- ============================================================
-- Forward: "give me all ingredients for blueprint X"
create index codex_bp_ingredients_forward_idx
  on public.codex_blueprint_ingredients (build_id, blueprint_class_name);

-- Reverse: "which blueprints use resource Y?" — differentiator query
create index codex_bp_ingredients_reverse_idx
  on public.codex_blueprint_ingredients (build_id, ingredient_class_name);

-- ============================================================
-- RLS — viewer-readable, service-role-writable
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'codex_blueprints', 'codex_blueprint_ingredients'
  ] loop
    execute format('alter table public.%I enable row level security;', t);

    -- SELECT: any authenticated user (viewer and up). authGuard-only model.
    execute format($p$
      create policy %I on public.%I
        for select to authenticated using (true);
    $p$, t || '_authenticated_read', t);

    -- No INSERT/UPDATE/DELETE policies for anon/authenticated → writes denied.
    -- service_role bypasses RLS (ingest edge function / seed script).
    -- Defense-in-depth: also revoke table-level DML grants.
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated, anon;', t);
  end loop;
end $$;
