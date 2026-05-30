-- ============================================================
-- 00008_codex_catalog.sql
-- Codex catalog data layer (Wave 2).
--
-- WHAT THIS CREATES
--   A queryable, searchable, filterable catalog of the extracted Star Citizen
--   game data (ships / weapons / components / items / ammunition / manufacturers
--   + their item-ports + localized strings). Source of truth is the desktop
--   extractor (`desktop-tool/python/sc_extract/`), whose EXACT JSON shape is
--   documented in `docs/concepts/codex-extraction-output.md`. The tables below
--   mirror that contract.
--
--   Tables:
--     codex_builds          — a catalog version as a first-class row (one
--                             "current" build per channel drives the default UI).
--     codex_manufacturers   — SCItemManufacturer projections.
--     codex_ships           — ship/vehicle EntityClassDefinition projections.
--     codex_weapons         — ship + FPS weapon projections.
--     codex_components       — PowerPlant/Shield/Cooler/QuantumDrive/... projections.
--     codex_items           — every other attachable item projection.
--     codex_ammunition      — AmmoParams projections.
--     codex_item_ports      — hardpoints (FK to any parent codex entity).
--     codex_entity_strings  — localized text rows (entity ref, lang, field,
--                             value, key) matching the global.ini shape.
--
-- NATURAL KEY
--   Entities are keyed by (channel, patch_version, build_number, class_name).
--   `class_name` is the stable join/permalink slug (the
--   `EntityClassDefinition.` / `<Type>.` prefix already stripped by the
--   extractor). Every entity also FKs to its `codex_builds` row (build_id) so a
--   "current build" flag can scope the whole catalog in one predicate. Because
--   (channel, patch_version, build_number) is unique on codex_builds, the
--   composite natural key and the build_id are equivalent — build_id is the
--   compact join column, the natural key columns are denormalized onto every
--   entity for ergonomic filtering and permalinks.
--
-- JSONB RATIONALE (alpha-phase churn)
--   The live DataForge schema is heterogeneous and still moving (DataForge v8,
--   struct names differ per entity, ship flight stats currently null, ammo
--   damage nested). We PROMOTE only the handful of columns the UI sorts/filters
--   on (class_name, entity_kind, attach_type/kind, size, grade,
--   manufacturer_code, weapon_class) to typed indexed columns, and keep the
--   heterogeneous rest (component.stats, weaponParams, ammo.raw, full payload)
--   as JSONB so the schema survives patch-to-patch churn without a migration.
--   Promote more columns to typed once they stabilize in beta.
--
-- SEARCH
--   pg_trgm is enabled; GIN trigram indexes cover class_name AND a denormalized
--   localized-name column (en + de concatenated) so server-side fuzzy search
--   spans BOTH localized names and classNames — our differentiator vs erkul.
--
-- RLS
--   Every codex_* table: RLS on. SELECT = any authenticated user (viewer and
--   up, matching the /news authGuard-only model). INSERT/UPDATE/DELETE =
--   service_role only (writes go through the ingest edge function / seed
--   script, never the client) — mirrors the p4k_uploads service-role-write
--   pattern.
--
-- ADDITIVE: this migration drops nothing. All objects are new `codex_*`.
-- ============================================================

create extension if not exists pg_trgm with schema extensions;

-- ============================================================
-- codex_builds — a catalog version as a first-class row
-- ============================================================
create table public.codex_builds (
  id uuid primary key default gen_random_uuid(),
  channel text not null,                 -- extractor emits e.g. "LIVE" (free string, not the p4k_channel enum)
  patch_version text not null,
  build_number text not null default '',
  schema_version int not null default 1,
  quality_score numeric,
  tool_version text,
  entity_counts jsonb not null default '{}'::jsonb,
  manifest jsonb not null default '{}'::jsonb,
  is_current boolean not null default false,  -- one active build per channel drives the default UI
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint codex_builds_channel_patch_build_key
    unique (channel, patch_version, build_number)
);

-- At most one current build per channel.
create unique index codex_builds_one_current_per_channel
  on public.codex_builds (channel) where is_current;

create index codex_builds_channel_idx on public.codex_builds (channel, created_at desc);

comment on table public.codex_builds is
  'A Codex catalog version (one extractor run). is_current scopes the default UI per channel.';

-- ============================================================
-- codex_manufacturers
-- ============================================================
create table public.codex_manufacturers (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  class_name text not null,
  guid text,
  manufacturer_code text,                 -- e.g. "AEG" — promoted for filtering
  name_localized text,                    -- denormalized en+de for trigram search
  payload jsonb not null,                 -- full Manufacturer JSON (name/description/source)
  created_at timestamptz not null default now(),
  constraint codex_manufacturers_natkey
    unique (channel, patch_version, build_number, class_name)
);

-- ============================================================
-- codex_ships
-- ============================================================
create table public.codex_ships (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  class_name text not null,
  guid text,
  entity_kind text not null default 'ship',
  manufacturer_code text,
  role text,                              -- localization key, e.g. "@vehicle_class_lightfighter"
  crew_size int,
  is_variant boolean not null default false,  -- AI/template heuristic (MASTER_*, *_Template, *_PU_AI_*, ...)
  name_localized text,                    -- en+de for trigram search
  payload jsonb not null,                 -- full Ship JSON (flight/itemPorts/defaultLoadout/...)
  created_at timestamptz not null default now(),
  constraint codex_ships_natkey
    unique (channel, patch_version, build_number, class_name)
);

-- ============================================================
-- codex_weapons
-- ============================================================
create table public.codex_weapons (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  class_name text not null,
  guid text,
  entity_kind text not null default 'weapon',
  weapon_class text,                      -- "Ship" | "FPS"
  sub_type text,
  size int,
  grade text,
  manufacturer_code text,
  is_variant boolean not null default false,
  name_localized text,
  payload jsonb not null,                 -- full Weapon JSON (weaponParams/itemPorts/...)
  created_at timestamptz not null default now(),
  constraint codex_weapons_natkey
    unique (channel, patch_version, build_number, class_name)
);

-- ============================================================
-- codex_components
-- ============================================================
create table public.codex_components (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  class_name text not null,
  guid text,
  entity_kind text not null default 'component',
  kind text,                              -- PowerPlant|Shield|Cooler|QuantumDrive|Thruster|FuelTank|FuelIntake|CargoGrid|Other
  attach_type text,
  sub_type text,
  size int,
  grade text,
  manufacturer_code text,
  is_variant boolean not null default false,
  name_localized text,
  payload jsonb not null,                 -- full Component JSON; stats is heterogeneous JSONB keyed by struct name
  created_at timestamptz not null default now(),
  constraint codex_components_natkey
    unique (channel, patch_version, build_number, class_name)
);

-- ============================================================
-- codex_items
-- ============================================================
create table public.codex_items (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  class_name text not null,
  guid text,
  entity_kind text not null default 'item',
  attach_type text,
  sub_type text,
  size int,
  grade text,
  manufacturer_code text,
  is_variant boolean not null default false,
  name_localized text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint codex_items_natkey
    unique (channel, patch_version, build_number, class_name)
);

-- ============================================================
-- codex_ammunition
-- ============================================================
create table public.codex_ammunition (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  class_name text not null,
  guid text,
  speed numeric,
  lifetime numeric,
  size numeric,
  name_localized text,
  payload jsonb not null,                 -- full Ammunition JSON incl. raw AmmoParams + impactDamage
  created_at timestamptz not null default now(),
  constraint codex_ammunition_natkey
    unique (channel, patch_version, build_number, class_name)
);

-- ============================================================
-- codex_item_ports — hardpoints, FK to the parent entity's build + class_name
-- ============================================================
-- Parent is referenced by (build_id, parent_class_name, parent_kind) rather than
-- a hard FK to one entity table, because a port can belong to a ship, weapon, or
-- component. Indexed for "give me all ports of this entity" lookups.
create table public.codex_item_ports (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  parent_class_name text not null,
  parent_kind text not null,              -- 'ship' | 'weapon' | 'component' | 'item'
  port_name text,
  min_size int,
  max_size int,
  types text[] not null default '{}',     -- accepted item types
  flags text[] not null default '{}',
  port_index int not null default 0,      -- preserves order within the parent
  created_at timestamptz not null default now()
);

create index codex_item_ports_parent_idx
  on public.codex_item_ports (build_id, parent_class_name);

comment on table public.codex_item_ports is
  'Hardpoints of any codex entity. Parent referenced by (build_id, parent_class_name, parent_kind).';

-- ============================================================
-- codex_entity_strings — localized text (matches global.ini shape)
-- ============================================================
create table public.codex_entity_strings (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  entity_class_name text not null,        -- which entity this string belongs to
  entity_kind text not null,              -- 'ship'|'weapon'|'component'|'item'|'ammunition'|'manufacturer'
  lang text not null,                     -- 'de' | 'en'
  field text not null,                    -- 'name' | 'description' | 'vehicleName' | ...
  value text,
  loc_key text,                           -- raw global.ini key for fallback/debug
  created_at timestamptz not null default now(),
  constraint codex_entity_strings_natkey
    unique (build_id, entity_class_name, lang, field)
);

create index codex_entity_strings_entity_idx
  on public.codex_entity_strings (build_id, entity_class_name);

comment on table public.codex_entity_strings is
  'Localized text rows (entity ref, lang, field, value, key) — global.ini shape.';

-- ============================================================
-- Promoted-column indexes (UI sort/filter)
-- ============================================================
create index codex_ships_build_idx       on public.codex_ships (build_id);
create index codex_ships_filter_idx       on public.codex_ships (build_id, is_variant, manufacturer_code);

create index codex_weapons_build_idx      on public.codex_weapons (build_id);
create index codex_weapons_filter_idx      on public.codex_weapons (build_id, weapon_class, size, grade);

create index codex_components_build_idx   on public.codex_components (build_id);
create index codex_components_filter_idx   on public.codex_components (build_id, kind, size, grade);

create index codex_items_build_idx        on public.codex_items (build_id);
create index codex_items_filter_idx        on public.codex_items (build_id, attach_type, size);

create index codex_ammunition_build_idx   on public.codex_ammunition (build_id);
create index codex_manufacturers_build_idx on public.codex_manufacturers (build_id);

-- ============================================================
-- Trigram search indexes — class_name + localized name (en+de), per entity
-- ============================================================
create index codex_ships_class_trgm   on public.codex_ships        using gin (class_name extensions.gin_trgm_ops);
create index codex_ships_name_trgm    on public.codex_ships        using gin (name_localized extensions.gin_trgm_ops);
create index codex_weapons_class_trgm  on public.codex_weapons      using gin (class_name extensions.gin_trgm_ops);
create index codex_weapons_name_trgm   on public.codex_weapons      using gin (name_localized extensions.gin_trgm_ops);
create index codex_components_class_trgm on public.codex_components using gin (class_name extensions.gin_trgm_ops);
create index codex_components_name_trgm  on public.codex_components using gin (name_localized extensions.gin_trgm_ops);
create index codex_items_class_trgm    on public.codex_items        using gin (class_name extensions.gin_trgm_ops);
create index codex_items_name_trgm     on public.codex_items        using gin (name_localized extensions.gin_trgm_ops);
create index codex_ammo_class_trgm     on public.codex_ammunition   using gin (class_name extensions.gin_trgm_ops);
create index codex_ammo_name_trgm      on public.codex_ammunition   using gin (name_localized extensions.gin_trgm_ops);
create index codex_manu_class_trgm     on public.codex_manufacturers using gin (class_name extensions.gin_trgm_ops);
create index codex_manu_name_trgm      on public.codex_manufacturers using gin (name_localized extensions.gin_trgm_ops);

-- ============================================================
-- set_current_codex_build — flip the current flag atomically (service-role)
-- ============================================================
create or replace function public.set_current_codex_build(p_build_id uuid)
returns void
language plpgsql security definer set search_path = public as $func$
declare
  v_channel text;
begin
  select channel into v_channel from public.codex_builds where id = p_build_id;
  if v_channel is null then
    raise exception 'codex build % not found', p_build_id;
  end if;
  update public.codex_builds set is_current = false
    where channel = v_channel and is_current and id <> p_build_id;
  update public.codex_builds set is_current = true where id = p_build_id;
end
$func$;

revoke all on function public.set_current_codex_build(uuid) from public, anon, authenticated;

-- ============================================================
-- RLS — viewer-readable, service-role-writable
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'codex_builds','codex_manufacturers','codex_ships','codex_weapons',
    'codex_components','codex_items','codex_ammunition','codex_item_ports',
    'codex_entity_strings'
  ] loop
    execute format('alter table public.%I enable row level security;', t);

    -- SELECT: any authenticated user (viewer and up). authGuard-only model.
    execute format($p$
      create policy %I on public.%I
        for select to authenticated using (true);
    $p$, t || '_authenticated_read', t);

    -- No INSERT/UPDATE/DELETE policies for anon/authenticated ⇒ writes are
    -- denied to clients. The service_role bypasses RLS, so the ingest edge
    -- function / seed script (service-role key) can write. Mirrors p4k_uploads.
  end loop;
end $$;
