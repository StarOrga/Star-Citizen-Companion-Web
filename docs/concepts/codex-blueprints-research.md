# Crafting Blueprints — Wave-0 Research: Output Contract + DB-Schema Spec

> **Status:** Wave-0 research handoff. Unblocks Wave 1 (extend `CodexExtractor`), Wave 2 (migration `00010_codex_blueprints.sql` + ingest), Wave 3 (Angular UI).
> **Author:** devops:research · **Date:** 2026-06-04
> **Data-source decision (fixed, user hard requirement):** Extract **only** from `Data.p4k` → `Data/Game2.dcb` (DataForge v8). NO external API, NO sc-craft.tools data/asset/code reuse. Mission/drop provenance that is NOT in the DataCore is explicitly out of scope (see §2 facet table + Risk R5).
> **Mirrors:** `docs/concepts/codex-research.md` (conventions) and `docs/concepts/codex-extraction-output.md` (exact contract shape). New entity type = `blueprint`, a parallel vertical to ship/weapon/component/item/ammunition/manufacturer.

---

## 0. TL;DR for Waves 1–3

- **Primary record:** `CraftingBlueprintRecord` (1561 records). It is **not** an `EntityClassDefinition` — it is a standalone record type, so the extractor needs a **new code path** (`extract_blueprints()`), not the existing `extract_entities()` loop. Read it the same way `extract_ammunition()` reads `AmmoParams`: `df.records_by_type_name("CraftingBlueprintRecord")` → `record_to_dict()`.
- **DataCore location (VERIFIED, primary source):** records live under `Data/Libs/Foundry/Records/crafting/blueprints`, with sibling dirs `.../crafting/blueprintrewards` and the singleton `.../crafting/globalparams/craftingglobalparams.xml`. (From the live ScDataDumper `BlueprintService` source.)
- **The exact DataForge leaf property names of `CraftingBlueprintRecord` are NOT publicly documented.** No open-source loader publishes the typed field set; community tools (Star-Citizen-Wiki API, sc-craft.tools) expose only normalized projections. **Therefore every field path below is a Wave-1-confirm HYPOTHESIS** — Wave 1's first job is to dump 2–3 `CraftingBlueprintRecord` JSONs from the live `Game2.dcb` and reconcile. This mirrors how `codex-research.md` treated flight/IFCS leaf names (documented-null, never guessed).
- **VERIFIED structural anchors** (from ScDataDumper source — real string literals): the blueprint nests a `GenericCraftingBlueprint` carrying `processSpecificData` → typed process structs (e.g. `GenericCraftingProcess_Dismantle`), and time is a **`TimeValue_Partitioned`** struct with `@days/@hours/@minutes/@seconds` (NOT a flat float). The craft-process struct for fabrication will be a sibling of the dismantle one (likely `GenericCraftingProcess_Craft`/`_Manufacture` — Wave-1 confirm).
- **JOIN model:** ingredients and outputs reference other entities by **GUID** (resolved by `record_to_dict` to `{_RecordId_, _RecordName_, _RecordPath_}` stubs). The extractor must map that GUID → stable `className` so the UI deep-links to `codex_items`/`codex_components`/`codex_weapons`. Same pattern as `_manufacturer_ref()` (GUID→cache lookup).
- **Quality model:** v1 stores raw quality-record references in the JSONB payload and **defers the simulator** (R3). The records exist (`CraftingQualityDistributionRecord`=10, `CraftingQualityQuantizationRecord`=38, `CraftingGameplayPropertyDef`=29) but reproducing sc-craft.tools' live sliders needs the quantization curve math, which is too deep for v1.
- **Schema:** one promoted table `codex_blueprints` + a **child table `codex_blueprint_ingredients`** (justified in §6) mirroring the `codex_item_ports` parent-by-`(build_id, parent_class_name)` pattern. RLS identical to `00008`: read = authenticated, write = service-role only.
- **Legacy:** ignore `LegacyCraftingRecipeDefRecord` (34) and `LegacyCraftingRecipeListRecord` (5) — superseded by the `CraftingBlueprintRecord` system (the "Legacy" prefix is CIG's own deprecation marker). Capture them only via the existing generic `records/` dump, never as a typed projection.

**Headline risk:** the raw field names are unconfirmed. The contract is designed so the *shape* (table columns, JSON interface, JOIN model) is stable regardless of the exact leaf names — Wave 1 fills a small field-name lookup, same as the existing `_FLIGHT_FIELDS`/`_weapon_params` candidate-list pattern.

---

## 1. Record-type map

`datacore_schema.json` confirms the TYPES + COUNTS but contains **no property/field structures** (it is a `record_types` list + `record_type_histogram` + `component_param_histogram` only). So the field set below is cross-referenced, not read from that file. Stated explicitly per the brief.

| Record type | Count | Role | Wave-1 handling |
|---|---|---|---|
| **`CraftingBlueprintRecord`** | 1561 | **PRIMARY** — the blueprint itself (recipe = ingredients + output + process/time + category + quality refs). | New typed projection → `blueprints/<className>.json`. |
| `BlueprintPoolRecord` | 116 | Supporting — groups blueprints into acquisition pools (which fabricator/reward pool offers them; `is_available_by_default` likely derives here). Referenced from blueprint by GUID, or pool→blueprint list. | Resolve pool→blueprint membership; store `poolClassName`/`isDefault` on the blueprint payload. Dump pools in generic `records/`. |
| `BlueprintCategoryRecord` | 20 | Supporting — the category taxonomy (Armor/Weapons/Magazines/Attachments + sub-filters). Blueprint → category by GUID. | Resolve to `category` (className) + localized label; promote `category` column. |
| `BlueprintCategoryDatabaseRecord` | 1 | Supporting — singleton index/ordering of categories. | Use to order categories in UI; not per-blueprint. Generic dump only. |
| `CraftingQualityDistributionRecord` | 10 | Quality model — output stat distribution curve (ingredient quality → output quality band). Blueprint references by GUID. | v1: store raw ref in payload (`qualityRefs.distribution`). Defer simulator (R3). |
| `CraftingQualityQuantizationRecord` | 38 | Quality model — quantizes continuous quality into discrete bands/tiers. | v1: store raw ref in payload (`qualityRefs.quantization`). |
| `CraftingQualityLocationOverrideRecord` | 12 | Quality model — per-location quality overrides (planet/biome). | v1: out of typed scope; generic dump only. |
| `CraftingGameplayPropertyDef` | 29 | Quality model — defines which gameplay stats quality maps onto (the "stats" the simulator moves). | v1: store the def list once at build level (not per-blueprint); generic dump. |
| `CraftingGlobalParams` | 1 | Supporting — global crafting tuning singleton (`craftingglobalparams.xml`, VERIFIED path). | Read once; stash in `codex_builds.manifest.crafting` for the UI. Generic dump. |
| `LegacyCraftingRecipeDefRecord` | 34 | **IGNORE** (deprecated). | Generic dump only — NO typed projection. |
| `LegacyCraftingRecipeListRecord` | 5 | **IGNORE** (deprecated). | Generic dump only. |
| `CrafterComponentParams` / `EntityComponentLegacyCrafterParams` | — | Entity components (the fabricator machine's params), not blueprint data. | Already captured under entity `stats` / generic dump. Out of blueprint scope. |

**Linkage model (how supporting records attach to the primary):** all links are by **GUID**. `record_to_dict` resolves cross-record GUID refs to `{_RecordId_, _RecordName_, _RecordPath_}` stubs (per `codex-extraction-output.md` §3). The extractor turns each stub into a stable `className` via `_strip_type_prefix(_RecordName_)` (or a GUID→className cache built up-front, like `_manu_cache`).

---

## 2. Facet extractability from pure-P4K (the user's hard boundary)

For each sc-craft.tools facet, is it in `Game2.dcb`?

| Facet | In `Game2.dcb`? | Notes |
|---|---|---|
| Ingredients (input items + quantities) | **YES** | In `CraftingBlueprintRecord` recipe entries (GUID ref + quantity). Field names = Wave-1 hypothesis. |
| Ingredient min quality requirement | **LIKELY YES** | Quality refs are DataCore records; per-ingredient min-quality is a recipe-entry field (hypothesis — confirm). |
| Output(s) (produced item) | **YES** | Output item GUID ref on the record. |
| Craft time | **YES (VERIFIED structure)** | `TimeValue_Partitioned` (`@days/@hours/@minutes/@seconds`) — normalize to `craftTimeSeconds`. |
| Category | **YES** | `BlueprintCategoryRecord` GUID ref → localized label. |
| Quality effects / simulator | **PARTIAL** | Curve records exist; full simulator math deferred to v2 (R3). Raw refs stored. |
| Tier | **LIKELY YES** | sc-craft.tools shows "tiers"; likely a field on the record or derived from category/pool (Wave-1 confirm). |
| `is_available_by_default` | **YES** | Derivable from `BlueprintPoolRecord` membership (default pool). |
| **Mission / contractor source** | **OUT OF SCOPE for pure-P4K** | sc-craft.tools tracks "mission, contractor, location, lawfulness". Acquisition-by-mission lives in **mission/reward records** (`blueprintrewards` dir is in the DataCore, but the *mission→blueprint* linkage and contractor/lawfulness metadata are mission-design records, not the blueprint record). FLAG: a partial reward-pool link may be extractable via `BlueprintPoolRecord`/`blueprintrewards`, but full mission provenance is **out of scope** — document as null, mark R5. |
| **Drop location / world spawn** | **OUT OF SCOPE for pure-P4K** | Loot-table/spawn data is not in the blueprint record; needs entity-spawn/loot records that we do not project. Out of scope. |
| Version diffs | **DERIVED, not extracted** | sc-craft.tools diffs two patches. We already store one row per `(channel, patch, build)`, so version-diff is a Wave-3 query across two `build_id`s — no extraction work, free from our existing build-versioning. |

---

## 3. Field set per blueprint

Marking: **[reliable]** = structurally certain (record exists, link model proven, or path VERIFIED); **[flaky]** = leaf property name is a hypothesis to confirm against the live dump. Source paths are starting hypotheses except where marked VERIFIED.

| Field | Reliability | Source path (hypothesis unless VERIFIED) |
|---|---|---|
| `className` (join/permalink key) | [reliable] | `_strip_type_prefix(record.name)` |
| `guid` | [reliable] | `record.guid` |
| `type` | [reliable] | `record.type` = `"CraftingBlueprintRecord"` |
| `recordTag` | [reliable] | `record.tag` (v8) |
| `name` (localized) | [reliable] | a `@`-key field on the record → `global.ini`. Leaf name **[flaky]** (`name`/`Localization.Name`/`displayName`) — reuse `_NAME_KEY_FIELDS` generic search. |
| `description` (localized) | [flaky] | same generic `_DESC_KEY_FIELDS` search. May be absent (blueprints often inherit the output item's description — fall back to output's loc key). |
| `category` (className) | [reliable] | GUID ref → `BlueprintCategoryRecord` → `_strip_type_prefix`. Leaf field name [flaky]. |
| `categoryLabel` (localized) | [flaky] | category record's `@`-name key. |
| `tier` | [flaky] | hypothesis: a scalar on the record or category. Nullable if absent. |
| `craftTimeSeconds` | [reliable] (structure VERIFIED) | sum of `TimeValue_Partitioned` `@days*86400 + @hours*3600 + @minutes*60 + @seconds`, under `…/processSpecificData/<CraftProcess>/<timeField>/TimeValue_Partitioned`. **Process struct name for FABRICATION is [flaky]** (dismantle uses `GenericCraftingProcess_Dismantle`; craft is its sibling). |
| `dismantleTimeSeconds` | [reliable] (VERIFIED) | `…/GenericCraftingProcess_Dismantle/dismantleTime/TimeValue_Partitioned`. |
| `dismantleEfficiency` | [reliable] (VERIFIED) | `…/GenericCraftingProcess_Dismantle@efficiency`. |
| `ingredients[]` | [reliable] (existence) / [flaky] (field names) | recipe-entries array on the record. Each entry → §4. Array field name hypothesis: `ingredients`/`resources`/`entries`/`inputs`. |
| `outputs[]` | [reliable] (existence) / [flaky] (names) | output item GUID ref(s) + quantity. Often a single output; model as array for safety. |
| `qualityRefs` | [reliable] (refs exist) | `{ distribution: className|null, quantization: className|null }` — GUID refs to the quality records. Used by the v2 simulator. |
| `poolClassName` | [flaky] | `BlueprintPoolRecord` membership (resolved pool→blueprint). |
| `isDefault` | [flaky] | derived: blueprint is in the default pool. |
| `gameplayProperties[]` | [flaky] | refs to `CraftingGameplayPropertyDef` (which stats quality affects). v1: store ref list only. |
| `tags` | [flaky] | if the record carries a `Tags` array (reuse `_tags`-style read). |
| `missionSource` | **null in v1** | OUT OF SCOPE (R5) — documented-null, never guessed. |
| `source` | [reliable] | `self.source` (channel/patch/build). |

---

## 4. Ingredient & output JOIN model

Each **ingredient** and **output** references another game entity by **GUID**. After `record_to_dict`, a cross-record ref appears as `{_RecordId_, _RecordName_, _RecordPath_}`. The extractor resolves it to the stable `className`:

```
ingredientClassName = _strip_type_prefix(ref["_RecordName_"])   # e.g. "Resource_Iron_Raw"
```

That `className` is the **same key** used in `codex_items` / `codex_components` / `codex_weapons` / (raw resources likely land in `codex_items`). So the UI deep-links `/codex/item/:className` directly.

**Per-ingredient shape (hypothesis names → confirm in Wave 1):**

```ts
interface BlueprintIngredient {
  className: string | null;   // resolved join key → codex_items/components/weapons; null = unresolved
  guid: string | null;        // raw GUID (kept even when className unresolved)
  name: LocalizedText | null; // resolved via the target entity's loc key (best-effort)
  quantity: number | null;    // recipe quantity (units or SCU — Wave-1 confirm semantics)
  minQuality: number | null;  // required input quality (nullable; many ingredients have none)
  role: "primary" | "secondary" | null; // SC's two-part recipe (primary drives output quality)
  raw: Record<string, unknown>; // full resolved entry — nothing dropped
}
```

**Output shape** = same as ingredient minus `minQuality`/`role`, plus `quantity` (yield).

**Unresolved-reference handling** (mirrors `codex-research.md` Q5 / default-loadout policy): if a GUID does not resolve to a known className, **keep the row** with `className = null` and the raw GUID preserved. Never drop an ingredient — the recipe structure matters even when a referenced resource isn't yet projected. Emit a warning count (`on_log`) like the loadout resolver does.

**Resource items note:** raw crafting resources (iron, carbon, etc.) may be `EntityClassDefinition`s with an `AttachDef` (→ already in `codex_items`) OR a dedicated resource record type. Wave 1 must confirm which table the ingredient `className` lands in; the JOIN is by `class_name` regardless of table, so the UI does a per-table lookup (same multi-table search already used for global search in §6.3 of the existing contract).

---

## 5. Quality model

The pieces and how they would combine for a full simulator:

1. **`CraftingGameplayPropertyDef`** (29) — defines the output stats that quality can move (the slider *targets*).
2. **`CraftingQualityDistributionRecord`** (10) — maps an aggregate input-quality value to an output-quality distribution (the curve shape).
3. **`CraftingQualityQuantizationRecord`** (38) — quantizes the continuous output quality into discrete bands/grades shown to the player.
4. **Recipe `role`** — the VERIFIED community description: a **primary** ingredient drives output quality 1:1 (750-quality iron → 750-quality steel); **secondary** ingredients contribute on a **quantity curve** (lower quality → more volume needed). This is the sc-craft.tools slider behaviour.

**v1 decision (defer the simulator):** Storing and *running* this math client-side is too deep for v1 and the exact record interlinks are unconfirmed. **v1 stores the raw refs** (`qualityRefs.distribution`, `qualityRefs.quantization`, `gameplayProperties[]`) in the JSONB payload, plus per-ingredient `minQuality`/`role`, and exposes a **static** quality summary (which stats are affected, primary vs secondary ingredients). The interactive slider simulator is a **v2** feature once Wave 1 has confirmed the curve record structure. Document the deferred scope so Wave 3 doesn't promise sliders. (Marked R3, MED.)

To later reproduce sc-craft.tools' live sliders, v2 needs: the distribution curve sample points, the quantization band thresholds, and the property-def mapping — all already captured in the generic `records/` dump, so **no extraction rework**, only a v2 typed projection + a client math module.

---

## 6. Output JSON contract

`blueprints/<className>.json` — consistent with `BaseEntity`/`LocalizedText`/`Source`. Note: a blueprint is **not** an `EntityClassDefinition`, so it does **not** carry `manufacturer`/`itemPorts`/`previewImage` (those stay absent or null). It introduces `entityKind: "blueprint"`.

```ts
interface BlueprintPayload {
  className: string;            // stable key, e.g. "BP_Armor_Heavy_Foo"
  guid: string;
  type: string;                 // "CraftingBlueprintRecord"
  recordTag: string | null;
  name: LocalizedText;
  description: LocalizedText;
  entityKind: "blueprint";

  category: string | null;          // BlueprintCategoryRecord className
  categoryLabel: LocalizedText | null;
  tier: number | null;
  craftTimeSeconds: number | null;  // normalized from TimeValue_Partitioned
  dismantleTimeSeconds: number | null;
  dismantleEfficiency: number | null;

  ingredients: BlueprintIngredient[];  // see §4 (also flattened into child table)
  outputs: BlueprintOutput[];

  qualityRefs: {
    distribution: string | null;     // CraftingQualityDistributionRecord className
    quantization: string | null;     // CraftingQualityQuantizationRecord className
  };
  gameplayProperties: string[];       // CraftingGameplayPropertyDef classNames

  poolClassName: string | null;       // BlueprintPoolRecord className
  isDefault: boolean | null;          // available by default (default pool membership)

  missionSource: null;                // OUT OF SCOPE (R5) — always null in pure-P4K v1
  tags: string[];
  raw: Record<string, unknown>;       // full resolved record — nothing lost (like ammo.raw)
  source: Source;
}

interface BlueprintIngredient {       // §4
  className: string | null; guid: string | null; name: LocalizedText | null;
  quantity: number | null; minQuality: number | null;
  role: "primary" | "secondary" | null;
  raw: Record<string, unknown>;
}
interface BlueprintOutput {
  className: string | null; guid: string | null; name: LocalizedText | null;
  quantity: number | null;
  raw: Record<string, unknown>;
}
```

Directory: add `blueprints/<className>.json` to the output layout (§1 of the existing contract). `manifest.entity_counts.blueprints` added.

---

## 7. DB-schema spec — `00010_codex_blueprints.sql`

> Wave 1b: confirm the next free migration number against `supabase/migrations/` before naming (codex series is 00008/00009; date-prefixed migrations coexist). `00010_codex_blueprints.sql` assumed.

### 7.1 Child table vs JSONB array — DECISION: child table

**Decision: a child table `codex_blueprint_ingredients` AND keep the full array in the payload JSONB** (denormalized, like `codex_item_ports` coexisting with `payload.itemPorts`).

Justification:
- **Reverse query is a first-class UX need.** sc-craft.tools' headline filter is *"filter by required resource"* → "which blueprints use Iron?". That is `SELECT blueprint_class_name FROM codex_blueprint_ingredients WHERE ingredient_class_name = 'Resource_Iron'`. A JSONB-array-only model forces a containment scan over every blueprint payload — slow and unindexable on the join key. A child table with a btree index on `ingredient_class_name` makes it instant.
- **Consistency:** exactly mirrors the existing `codex_item_ports` pattern (parent by `(build_id, parent_class_name)`, ordered by index, RLS identical). Waves 2/3 already know this shape.
- Outputs are few (usually 1) and not a reverse-query target → keep outputs in the payload JSONB only (no child table). Asymmetry is intentional and documented.

### 7.2 Tables

```sql
-- codex_blueprints — one row per CraftingBlueprintRecord
create table public.codex_blueprints (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  class_name text not null,
  guid text,
  entity_kind text not null default 'blueprint',
  category text,                      -- BlueprintCategoryRecord className (promoted, indexed)
  tier int,                           -- promoted facet (nullable)
  craft_time_seconds numeric,         -- normalized; promoted for sort
  output_class_name text,             -- primary output className (promoted for join/search)
  is_default boolean,                 -- default-pool membership
  is_variant boolean not null default false,  -- reserved; blueprints unlikely to have AI variants
  name_localized text,                -- en+de for trigram search
  payload jsonb not null,             -- full BlueprintPayload (ingredients[], qualityRefs, raw, ...)
  created_at timestamptz not null default now(),
  constraint codex_blueprints_natkey
    unique (channel, patch_version, build_number, class_name)
);

-- codex_blueprint_ingredients — flattened recipe inputs (parent by build_id + class_name)
create table public.codex_blueprint_ingredients (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  blueprint_class_name text not null,     -- parent blueprint
  ingredient_class_name text,             -- resolved join → codex_items/components/weapons (nullable)
  ingredient_guid text,                   -- raw GUID, kept even when className unresolved
  quantity numeric,
  min_quality numeric,
  role text,                              -- 'primary' | 'secondary' | null
  ingredient_index int not null default 0,
  created_at timestamptz not null default now()
);
```

### 7.3 Indexes

```sql
create index codex_blueprints_build_idx    on public.codex_blueprints (build_id);
create index codex_blueprints_filter_idx    on public.codex_blueprints (build_id, category, tier);
create index codex_blueprints_class_trgm    on public.codex_blueprints using gin (class_name extensions.gin_trgm_ops);
create index codex_blueprints_name_trgm     on public.codex_blueprints using gin (name_localized extensions.gin_trgm_ops);

-- forward: "ingredients of this blueprint"
create index codex_bp_ing_parent_idx  on public.codex_blueprint_ingredients (build_id, blueprint_class_name);
-- reverse (the differentiator): "which blueprints use this resource"
create index codex_bp_ing_ingredient_idx on public.codex_blueprint_ingredients (build_id, ingredient_class_name);
```

### 7.4 RLS — identical to `00008`

Add both tables to the `00008` RLS pattern: `enable row level security`; `for select to authenticated using (true)`; `revoke insert, update, delete, truncate ... from authenticated, anon`. Writes go through `ingest-catalog` / `seed-codex.mjs` (service-role) only. Verify with `get_advisors(security)` post-migration (no findings, like the existing tables).

### 7.5 supabase-js read queries (Wave 3 style, mirrors §6.3)

```ts
// list by category (paged)
const { data, count } = await sb.client
  .from('codex_blueprints')
  .select('class_name, name_localized, category, tier, craft_time_seconds, output_class_name', { count: 'exact' })
  .eq('build_id', buildId)
  .eq('category', categoryClassName)   // optional facet
  .order('name_localized', { ascending: true })
  .range(0, 49);

// fuzzy search over localized name AND className (GIN trigram backs both)
const { data } = await sb.client
  .from('codex_blueprints')
  .select('class_name, name_localized, category')
  .eq('build_id', buildId)
  .or(`name_localized.ilike.%${q}%,class_name.ilike.%${q}%`)
  .limit(25);

// detail: blueprint + its ingredients (ordered)
const cn = 'BP_Armor_Heavy_Foo';
const [{ data: bp }, { data: ingredients }] = await Promise.all([
  sb.client.from('codex_blueprints').select('*').eq('build_id', buildId).eq('class_name', cn).single(),
  sb.client.from('codex_blueprint_ingredients').select('*')
    .eq('build_id', buildId).eq('blueprint_class_name', cn).order('ingredient_index'),
]);
// bp.payload has outputs[], qualityRefs, raw; ingredient_class_name joins to codex_items/components.

// REVERSE — "which blueprints need this resource" (the sc-craft.tools differentiator)
const { data: usedIn } = await sb.client
  .from('codex_blueprint_ingredients')
  .select('blueprint_class_name, quantity, min_quality, role')
  .eq('build_id', buildId).eq('ingredient_class_name', 'Resource_Iron_Raw');

// VERSION DIFF (free, no extraction): query the same blueprint under two build_ids and diff client-side.
```

---

## 8. Wave-1 / Wave-2 / Wave-3 notes

**Wave 1 — extend `CodexExtractor` (`dataforge_extract.py`):**
1. **First, dump ground truth.** Run the generic dump (already does this) and inspect `records/CraftingBlueprintRecord/*.json` for 2–3 records. Grep for the recipe-entries array name, ingredient quantity/quality leaf names, output ref, the craft-process struct sibling of `GenericCraftingProcess_Dismantle`, and the category/quality GUID refs. Reconcile §3/§4 hypotheses → fill a `_BP_FIELDS` candidate-list (same pattern as `_FLIGHT_FIELDS`/`_weapon_params`). **NOTE for the build agent:** the live `Data.p4k` is NOT available in the sandbox — write the extractor name-agnostically (candidate-field lists, graceful nulls) and cover it with a synthetic-fixture test; the live confirmation happens on the user's machine.
2. Add `extract_blueprints()` (model on `extract_ammunition()`): iterate `df.records_by_type_name("CraftingBlueprintRecord")`, `record_to_dict(max_depth=16)`, project to `BlueprintPayload`, write `blueprints/<className>.json`, `_bump("blueprints", n)`. Call it from `run()`.
3. Build a GUID→className cache (like `_manu_cache`) covering category, quality, pool records; resolve ingredient/output GUID stubs to classNames; keep unresolved as `className=null`+guid (warn-count).
4. Normalize `TimeValue_Partitioned` → seconds (VERIFIED field names `@days/@hours/@minutes/@seconds`).
5. Emit blueprint name/description into the **`localization`** dump path so Wave-2 can populate `codex_entity_strings` for `entity_kind='blueprint'` (reuse existing string flow).
6. Leave `missionSource` null (R5). Ignore `Legacy*` types.

**Wave 2 — migration + ingest:**
1. New migration `supabase/migrations/00010_codex_blueprints.sql` per §7 (additive, drops nothing).
2. Extend `ingest-catalog` edge function + `supabase/scripts/seed-codex.mjs` to upsert `codex_blueprints` (one row/blueprint) and `codex_blueprint_ingredients` (one row/ingredient, `ingredient_index` preserves order), plus `codex_entity_strings` rows for blueprint name/description. Add `blueprints` to `manifest.entity_counts`. **Also lift the per-kind 400-row caps in the seed path** (the user chose full-catalog seeding).
3. Regenerate `src/app/core/database.types.ts`; add `BlueprintPayload`, `CodexBlueprint`, `CodexBlueprintIngredient`, `BlueprintIngredient`, `BlueprintOutput` to `src/app/codex/codex.types.ts`; add `blueprint: 'codex_blueprints'` to `CODEX_ENTITY_TABLES` and `'blueprint'` to `EntityKind`.

**Wave 3 — Angular UI (consistency only; visuals out of scope here):**
1. List/detail routes `/codex/blueprint` and `/codex/blueprint/:className` (`authGuard`, mirroring other codex tabs). All strings via ngx-translate; add i18n keys to `public/i18n/{de,en}.json`.
2. Facets: category, tier, craft-time sort; fuzzy search over name+className. Reverse "used-in" panel on resource detail pages. Version-diff via two `build_id`s.
3. Deep-link ingredient/output classNames to their existing codex detail pages.
4. Static quality summary only (v1) — no slider simulator (R3).

---

## 9. Open questions / risks

| ID | Severity | Risk / open question | Mitigation |
|---|---|---|---|
| R1 | **HIGH** | Raw DataForge leaf names of `CraftingBlueprintRecord` (recipe array, ingredient quantity, min-quality, output ref) are UNCONFIRMED — not publicly documented. | Wave-1 step 1: dump 2–3 records and grep before committing the mapping. Contract shape is name-agnostic. |
| R2 | **HIGH** | The fabrication craft-process struct name is unknown (only `GenericCraftingProcess_Dismantle` is verified). `craftTimeSeconds` may stay null until confirmed. | Generic time-struct scan for any `TimeValue_Partitioned` under `processSpecificData`; document-null if not found. |
| R3 | **MED** | Quality simulator math (distribution × quantization × property-def) is too deep for v1 and interlinks unconfirmed. | v1 stores raw refs + static summary; defer sliders to v2. Already captured in generic dump → no rework. |
| R4 | **MED** | Ingredient `className` may resolve into different tables (`codex_items` vs a resource type). Quantity units (count vs SCU) unconfirmed. | Multi-table className lookup (already used for global search). Confirm unit semantics in Wave 1; store raw. |
| R5 | **MED** | Mission/contractor/drop provenance is NOT in the blueprint record (user's pure-P4K boundary). | Document `missionSource = null`; out of scope. A partial reward-pool link via `BlueprintPoolRecord`/`blueprintrewards` may be added later, still P4K-only. |
| R6 | LOW | Pool→blueprint membership direction (blueprint refs pool, or pool lists blueprints) unknown → `isDefault`/`poolClassName` may need a reverse index built from `BlueprintPoolRecord`. | Build the membership map up-front in Wave 1 (cheap; 116 pools). |
| R7 | LOW | 1561 blueprints × deep `record_to_dict` adds extraction time. | `max_depth=16`, memoize resolved category/quality sub-records (small fixed set). |
| R8 | LOW | `is_variant` likely meaningless for blueprints. | Keep column for schema symmetry; default false. |

---

## 10. Fact Verification

| # | Claim | Source | Verified | Confidence |
|---|---|---|---|---|
| 1 | Crafting record TYPES + counts (`CraftingBlueprintRecord`=1561, pools=116, categories=20, quality dist=10, quant=38, etc.) | Local `datacore_schema.json` (read on disk) | ✅ Read directly | High |
| 2 | `datacore_schema.json` has type names + histograms only, NO property/field structures | Read file structure (top-level keys + grep) | ✅ Confirmed — field set is cross-referenced, not from this file | High |
| 3 | Blueprint records live under `Data/Libs/Foundry/Records/crafting/blueprints` (+ `blueprintrewards`, `globalparams/craftingglobalparams.xml`) | ScDataDumper `BlueprintService` source (string literals) | ✅ Verbatim path literals | High |
| 4 | Craft/dismantle time is `TimeValue_Partitioned` with `@days/@hours/@minutes/@seconds`; dismantle struct `GenericCraftingProcess_Dismantle@efficiency` | ScDataDumper `BlueprintService` source | ✅ Verbatim literals | High |
| 5 | sc-craft.tools facets: ingredients+quantities, quality simulator (sliders), craft time, category, mission/contractor/location/lawfulness sources, version diffs | RSI Community-Hub post + search summary | ✅ 2 sources | Medium |
| 6 | SC crafting: primary ingredient drives output quality 1:1 (750 iron→750 steel); secondaries on a quantity curve | The Impound / MMOPIXEL 4.7 crafting guides (search summary) | ✅ 2 community sources | Medium |
| 7 | Star-Citizen-Wiki API blueprint fields: `ingredients`, `output.name/type_label`, `craft_time_seconds`, `ingredient_count`, `unlocking_missions_count`, `is_available_by_default`, `uuid` | api.star-citizen.wiki/blueprints | ✅ Fetched | Medium (normalized projection, not raw DataForge names) |
| 8 | Raw `CraftingBlueprintRecord` typed field set is NOT publicly documented by any loader | Multiple GitHub/web searches (ScDataDumper, StarBreaker, scunpacked all dump generic) | ⚠️ Negative result — basis for R1; treat all field names as Wave-1 hypotheses | High |
| 9 | `CraftingBlueprintRecord` is a standalone record type (not `EntityClassDefinition`) → needs a new extractor path | Type appears in `record_types`, not in entity classification; extractor reads other standalone types (`AmmoParams`, `SCItemManufacturer`) by `records_by_type_name` | ✅ Cross-referenced with `dataforge_extract.py` | High |
| 10 | `Legacy*` crafting records are deprecated → ignore for typed projection | CIG "Legacy" naming convention + active `CraftingBlueprintRecord` system | ⚠️ Inference (naming + active-system corroboration) | Medium |
| 11 | DataForge reader API (`records_by_type_name`, `record_to_dict`, `record.name/guid/type/tag`, `record_types`) | Read `dataforge.py` + `dataforge_extract.py` on disk | ✅ Read directly | High |
| 12 | Existing `codex_*` RLS = authenticated-read / service-role-write; child-table-by-`(build_id, parent_class_name)` pattern | Read `00008_codex_catalog.sql` on disk | ✅ Read directly | High |

## Sources
- [SC-Craft.Tools — Community Hub post (data model description)](https://robertsspaceindustries.com/community-hub/post/sc-craft-tools-the-complete-crafting-database-XXVPC6JqS5s6K)
- [octfx/ScDataDumper (current SC DataCore loader; verified blueprint paths + TimeValue_Partitioned)](https://github.com/octfx/ScDataDumper)
- [Star Citizen Wiki API — blueprints (normalized field set)](https://api.star-citizen.wiki/blueprints)
- [Star Citizen Wiki — Blueprint](https://starcitizen.tools/Blueprint)
- [The Impound — Alpha 4.7 Crafting Guide (primary/secondary quality mechanic)](https://theimpound.com/blogs/guides/star-citizen-alpha-4-7-introduces-crafting)
- [MMOPIXEL — SC Complete Crafting Guide](https://www.mmopixel.com/news/star-citizen-complete-crafting-guide)
- [diogotr7/StarBreaker (alt DataCore toolkit)](https://github.com/diogotr7/StarBreaker)

**Recency flag:** all sources are within the last ~12 months (SC crafting shipped in Alpha 4.7, late 2025/early 2026); the feature is actively churning patch-to-patch, so field names will drift — reinforcing the Wave-1-confirm posture.
