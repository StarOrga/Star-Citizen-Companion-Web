import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { environment } from '../../environments/environment';
import { isCatalogStale, comparePatchVersion } from './codex-format';
import { PolySearchHit, rankPolyHits, toPolyHit, toUpcomingHit } from './codex-poly-search';
import { UpcomingShipsService } from './upcoming-ships.service';
import { ShipStatDelta, computeShipRowDeltas } from './codex-build-diff';
import { PatchTimelineEntry, buildPatchTimeline } from './codex-patch-timeline';
import { skinQueryPrefix } from './codex-skin-group';
import { editionQueryPrefix } from './codex-edition-group';
import { WeaponFacetRow } from './codex-weapon-taxonomy';
import {
  CODEX_ENTITY_TABLES,
  BlueprintIngredientPayload,
  CodexAmmunitionRow,
  CodexBuild,
  CodexBlueprintIngredient,
  CodexComponentRow,
  CodexEntityString,
  CodexKeybind,
  CodexItemPort,
  CodexItemRow,
  CodexManufacturerRow,
  CodexShipRow,
  CodexWeaponRow,
  Lang,
  LocalizedText,
} from './codex.types';

// The entity kinds the Codex catalog browses. `manufacturer` and `ammunition`
// are first-class kinds in the UI even though the EntityKind union (in
// codex.types) only covers ship/weapon/component/item.
export type CodexKind =
  | 'ship'
  | 'weapon'
  | 'component'
  | 'item'
  | 'ammunition'
  | 'manufacturer'
  | 'blueprint';

export const CODEX_KINDS: readonly CodexKind[] = [
  'ship',
  'weapon',
  'component',
  'item',
  'ammunition',
  'manufacturer',
  'blueprint',
] as const;

// One generic list row — the columns common enough to render a browse card.
// `payload` carries the heterogeneous per-kind JSON (typed in codex.types).
export interface CodexListRow {
  classNameSlug: string;
  nameLocalized: string | null;
  manufacturerCode: string | null;
  // promoted facet columns (present depending on kind)
  size: number | null;
  grade: string | null;
  role: string | null;
  crewSize: number | null;
  weaponClass: string | null;
  componentKind: string | null;
  subType: string | null;
  attachType: string | null;
  speed: number | null;
  isVariant: boolean;
  payload: unknown;
  // blueprint-specific (null for all other kinds)
  blueprintCategory: string | null;
  blueprintTier: number | null;
  craftTimeSec: number | null;
}

export interface CodexListResult {
  rows: CodexListRow[];
  count: number;
}

export interface CodexListFilters {
  search?: string;
  manufacturer?: string;
  size?: number;
  grade?: string;
  componentKind?: string;
  weaponClass?: string;
  // sub_type facet — shared column across weapon/component/item (e.g. FPS
  // weapon sub_type Rifle/Pistol/…, armor item sub_type Helmet/Undersuit/…).
  subType?: string;
  // sub_type set / complement — the weapon browse taxonomy's FPS sub-categories
  // ('Small'/'Medium'/… → sidearms/primaries/…). The `NotIn` variant also keeps
  // rows whose sub_type is NULL, so it is a true "everything else" bucket.
  subTypeIn?: string[];
  subTypeNotIn?: string[];
  // attach_type facet — used to scope `item` rows to a single category / slot
  // (e.g. a specific personal-armor slot 'Char_Armor_Helmet').
  attachType?: string;
  // attach_type set — scope `item` rows to several categories at once, e.g. all
  // personal-armor slots (Char_Armor_Helmet/Torso/Arms/Legs/Undersuit/Backpack),
  // or the weapon taxonomy's ship sub-categories (WeaponGun/Turret/…).
  attachTypeIn?: string[];
  // attach_type complement — "everything else", NULLs included. See above.
  attachTypeNotIn?: string[];
  // include AI/template variants (default: buyable-only)
  includeVariants?: boolean;
  // blueprint-only facet — raw CIG bucket from codex_blueprints.category
  // (e.g. 'FPSArmours', 'VehicleComponentS1'). Ignored for other kinds.
  category?: string;
  // blueprint-only facet — several categories at once (the "Zu Fuß"/"Fahrzeug"
  // group sub-filter). Intersects with `category` when both are set — the
  // single-category select stays authoritative for its own value, this only
  // widens/narrows the group around it. Ignored for other kinds.
  blueprintCategoryIn?: string[];
  limit?: number;
  offset?: number;
}

export interface BlueprintListFilters {
  search?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface BlueprintListResult {
  rows: CodexListRow[];
  count: number;
}

export interface BlueprintDetail {
  classNameSlug: string;
  row: Record<string, unknown>;
  ingredients: CodexBlueprintIngredient[];
}

/** Shape returned by blueprintsUsingIngredient — slim list rows. */
export interface BlueprintRef {
  classNameSlug: string;
  nameLocalized: string | null;
  tier: number | null;
  craftTimeSec: number | null;
}

export interface CodexDetail {
  classNameSlug: string;
  kind: CodexKind;
  row: Record<string, unknown>;
  payload: unknown;
  ports: CodexItemPort[];
  strings: CodexEntityString[];
}

// A class name resolved to its kind + display fields (for loadout rendering).
export interface ResolvedEntity {
  kind: CodexKind;
  className: string;
  nameLocalized: string | null;
  manufacturerCode: string | null;
  size: number | null;
  grade: string | null;
}

// One item that fits a given hardpoint (returned by the codex_compatible_items
// RPC). `kind` is always a mountable kind (weapon/component/item).
export interface CompatibleItem {
  kind: CodexKind;
  classNameSlug: string;
  nameLocalized: string | null;
  manufacturerCode: string | null;
  size: number | null;
  subType: string | null;
  grade: string | null;
}

// The accepted-types + size-range shape the compatibility RPC needs.
export interface PortQuery {
  types: string[];
  minSize: number | null;
  maxSize: number | null;
}

const PAGE_SIZE = 60;
const SEARCH_LIMIT = 60;
// Ceiling for the livery-/edition-sibling reads. The largest family in build
// 4.9.0 is the LH86 pistol at 14 records (ships top out at the Cutlass Black's
// seven); the prefix also catches unrelated neighbours, so this sits well above
// the real group size and only guards a pathological prefix from pulling a
// whole table into the detail view.
const SKIN_SIBLING_LIMIT = 200;

// How far back the patch switch can reach. ingest-catalog never prunes builds,
// so this is a window, not the whole history: the switch pages through it five
// at a time and nobody scrolls past a couple of patches in practice.
const PATCH_TIMELINE_LIMIT = 40;

// Facet scan for blueprint categories: PostgREST caps a response at 1000 rows,
// so the column is paged. The cap bounds a pathological build (10k blueprints)
// instead of looping forever.
const CATEGORY_PAGE_SIZE = 1000;
const CATEGORY_MAX_PAGES = 10;

// Keybinds hit the same 1000-row cap: a build's default profile is already
// ~1.1k actions, so an unpaged select silently drops the tail (it comes back
// short, not as an error). The cap bounds a pathological profile (10k actions)
// instead of looping forever.
const KEYBIND_PAGE_SIZE = 1000;
const KEYBIND_MAX_PAGES = 10;

// Locale lookups filter with PostgREST's `key=in.(…)`, which rides in the URL.
// The Supabase edge answers a bare `400 Bad Request` — no PostgREST error body —
// once the request line passes ~25 300 characters (measured 2026-07-30 against
// the live project: 819 keybind keys = 25 264 chars → 200, 820 = 25 303 → 400).
// 7 000 encoded characters per batch keeps a whole request below the 8 000-char
// mark postgrest-js itself flags as "may exceed server limits", with ~3.5x
// headroom to the real ceiling. Anything but /codex/keybinds fits in one batch.
const LOCALE_KEY_URL_BUDGET = 7000;
// A batch must also stay under PostgREST's 1000-row response cap: keys short
// enough to pack >1000 into one budget would come back silently truncated
// rather than erroring.
const LOCALE_KEY_BATCH_MAX = 500;

/**
 * Split locale keys into batches whose encoded `in.(…)` list fits the URL
 * budget. Cost per key is its percent-encoded length plus the `%2C` separator.
 */
function batchLocaleKeys(keys: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const key of keys) {
    const cost = encodeURIComponent(key).length + 3;
    if (current.length && (length + cost > LOCALE_KEY_URL_BUDGET || current.length >= LOCALE_KEY_BATCH_MAX)) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(key);
    length += cost;
  }
  if (current.length) batches.push(current);
  return batches;
}

// Columns selected per kind for the list view. Keep payload last.
const LIST_SELECT: Record<CodexKind, string> = {
  ship: 'class_name, name_localized, manufacturer_code, role, crew_size, is_variant, payload',
  // `attach_type` rides along for weapons because it is the field the ship-side
  // browse taxonomy cuts its sub-categories from (codex-weapon-taxonomy).
  weapon:
    'class_name, name_localized, manufacturer_code, weapon_class, attach_type, sub_type, size, grade, is_variant, payload',
  component:
    'class_name, name_localized, manufacturer_code, kind, attach_type, sub_type, size, grade, is_variant, payload',
  item: 'class_name, name_localized, manufacturer_code, attach_type, sub_type, size, grade, is_variant, payload',
  ammunition: 'class_name, name_localized, speed, lifetime, size, payload',
  manufacturer: 'class_name, name_localized, manufacturer_code, payload',
  blueprint: 'class_name, name_localized, category, tier, craft_time_seconds, dismantle_time_seconds, payload',
};

/**
 * Upper bound on the paged facet read in {@link CodexService.weaponFacets}.
 * The biggest build ever ingested held ~1.3k weapons; this only exists so a
 * pathological build can never turn the loop into an endless request storm.
 */
const WEAPON_FACET_HARD_CAP = 20000;

@Injectable({ providedIn: 'root' })
export class CodexService {
  private readonly sb = inject(SupabaseClientProvider);
  /**
   * The RSI announcement feed, read-only from here. Injected purely so
   * {@link searchAll} can cover ships that exist on a concept page but not in
   * any build; it holds no reference back to this service, so there is no cycle.
   */
  private readonly upcoming = inject(UpcomingShipsService);

  /** Memoized {@link weaponFacets} read, invalidated by a change of build. */
  private weaponFacetCache: { buildId: string; rows: WeaponFacetRow[] } | null = null;

  /**
   * The build every codex query reads from — the LIVE one by default, or the
   * older patch the reader picked in the landing's patch switch (463872dd).
   */
  readonly build = signal<CodexBuild | null>(null);
  /**
   * The `is_current` LIVE build, kept separately from {@link build} so that
   * viewing an older patch never rewrites what "live" means (the staleness nag
   * and the patch switch both need the real one).
   */
  readonly liveBuild = signal<CodexBuild | null>(null);
  readonly buildLoading = signal(false);
  readonly buildError = signal<string | null>(null);

  /**
   * Newest LIVE patch version anyone has uploaded (from the viewer-safe
   * `p4k_bundles_public_stats` view), or null if unknown. Compared against the
   * current build's patch to detect a stale catalog.
   */
  readonly latestLivePatch = signal<string | null>(null);

  /**
   * True when a newer LIVE patch has been uploaded than the one the current
   * codex build reflects — i.e. the catalog needs a fresh data upload. Drives
   * the provenance-banner "new server version" hint. Fails closed (never nags
   * when either version is unknown).
   */
  readonly stale = computed(() =>
    isCatalogStale(this.latestLivePatch(), (this.liveBuild() ?? this.build())?.patchVersion),
  );

  /**
   * True while the reader is looking at an older patch than the live one. Not a
   * problem state — just a fact the UI has to say out loud, because every count
   * on the page then describes that patch instead of the current one.
   */
  readonly viewingPastPatch = computed(() => {
    const live = this.liveBuild();
    const active = this.build();
    return !!live && !!active && live.id !== active.id;
  });

  /**
   * Selectable patch history for the landing's patch switch. Empty until the
   * switch is opened for the first time — a resting control must cost the page
   * nothing.
   */
  readonly patchTimeline = signal<readonly PatchTimelineEntry[]>([]);

  // Compare tray: pinned `${kind}:${className}` keys (max 4).
  private readonly _compare = signal<string[]>([]);
  readonly compareKeys = this._compare.asReadonly();
  readonly compareCount = computed(() => this._compare().length);
  static readonly COMPARE_MAX = 4;

  // Like-for-like guard feedback: set when a pin was refused because the tray
  // already holds a different kind (ship vs quantum-drive columns would be
  // meaningless). Cleared on the next successful pin / clear. Transient UI hint.
  private readonly _compareRejected = signal<CodexKind | null>(null);
  readonly compareRejectedKind = this._compareRejected.asReadonly();

  private buildPromise: Promise<CodexBuild | null> | null = null;
  private timelinePromise: Promise<readonly PatchTimelineEntry[]> | null = null;

  /** Loads (and caches) the current LIVE build. Idempotent across callers. */
  async loadCurrentBuild(): Promise<CodexBuild | null> {
    if (this.build()) return this.build();
    if (this.buildPromise) return this.buildPromise;
    this.buildPromise = this.fetchCurrentBuild();
    return this.buildPromise;
  }

  private async fetchCurrentBuild(): Promise<CodexBuild | null> {
    this.buildLoading.set(true);
    this.buildError.set(null);
    try {
      const { data, error } = await this.sb.client
        .from('codex_builds')
        .select(
          'id, channel, patch_version, build_number, schema_version, quality_score, tool_version, entity_counts, is_current, extracted_at',
        )
        .eq('channel', 'LIVE')
        .eq('is_current', true)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        this.build.set(null);
        return null;
      }
      const mapped = mapBuild(data);
      this.build.set(mapped);
      this.liveBuild.set(mapped);
      // Fire-and-forget: freshness check must never block or fail the build load.
      void this.loadLatestLivePatch();
      return mapped;
    } catch (err) {
      this.buildError.set((err as Error).message ?? 'Unknown error');
      return null;
    } finally {
      this.buildLoading.set(false);
    }
  }

  /**
   * Load the newest uploaded LIVE patch from the viewer-safe public-stats view
   * and store it. Picks the max by tolerant patch comparison (lexical order is
   * wrong: "4.8.0" vs "4.10.0"). Best-effort: any failure leaves it null, which
   * simply means "no staleness nag" rather than surfacing an error.
   */
  private async loadLatestLivePatch(): Promise<void> {
    const uploaded = await this.uploadedLivePatches();
    const newest = uploaded.reduce((max, p) => (comparePatchVersion(p, max) > 0 ? p : max), '');
    if (newest) this.latestLivePatch.set(newest);
  }

  /**
   * Every LIVE patch anybody uploaded a bundle for, from the viewer-safe
   * public-stats view (one row per patch, so this stays a tiny request).
   * Best-effort: any failure yields an empty list.
   */
  private async uploadedLivePatches(): Promise<string[]> {
    try {
      const { data, error } = await this.sb.client
        .from('p4k_bundles_public_stats')
        .select('patch_version')
        .eq('channel', 'live');
      if (error || !data?.length) return [];
      return data
        .map((r) => r.patch_version as string | null)
        .filter((p): p is string => !!p);
    } catch {
      /* freshness is advisory — never surface an error for it */
      return [];
    }
  }

  /**
   * Patch history for the landing's patch switch: the recent LIVE catalog
   * builds merged with every uploaded patch, so the list can mark which patches
   * we actually hold data for (admin feedback 463872dd). Loaded once, on the
   * first open of the switch — never on page load. No new backend surface: both
   * sources are tables the app already reads.
   */
  async loadPatchTimeline(): Promise<readonly PatchTimelineEntry[]> {
    if (this.timelinePromise) return this.timelinePromise;
    this.timelinePromise = this.fetchPatchTimeline();
    return this.timelinePromise;
  }

  private async fetchPatchTimeline(): Promise<readonly PatchTimelineEntry[]> {
    const [builds, uploaded] = await Promise.all([
      this.recentLiveBuilds(PATCH_TIMELINE_LIMIT),
      this.uploadedLivePatches(),
    ]);
    const entries = buildPatchTimeline(builds, uploaded);
    this.patchTimeline.set(entries);
    return entries;
  }

  /**
   * Switch every following codex query to another uploaded build — `null` puts
   * the reader back on the live patch. Session-scoped on purpose: a reload
   * lands on live again, so nobody can get permanently stranded in an old
   * patch. Callers reload their own view afterwards; already-rendered data is
   * not retro-actively rewritten.
   *
   * @returns true when the active build actually changed.
   */
  selectBuild(build: CodexBuild | null): boolean {
    const target = build ?? this.liveBuild();
    if (!target || target.id === this.build()?.id) return false;
    this.build.set(target);
    // Keep the memoised loader in sync — `loadCurrentBuild` short-circuits on
    // the signal, but a caller holding the old promise must not resurrect it.
    this.buildPromise = Promise.resolve(target);
    this.blueprintCategoryCache = null;
    return true;
  }

  /**
   * Server-side filtered + paged list for one kind in the current build.
   * Fuzzy search runs over BOTH name_localized AND class_name (per the read
   * contract — trigram-backed `.or(ilike)`), so power users can search
   * `AEGS_*` classNames directly.
   */
  async listByKind(kind: CodexKind, filters: CodexListFilters = {}): Promise<CodexListResult> {
    const build = await this.loadCurrentBuild();
    if (!build) return { rows: [], count: 0 };

    const table = CODEX_ENTITY_TABLES[kind];
    const limit = filters.limit ?? PAGE_SIZE;
    const offset = filters.offset ?? 0;

    let query = this.sb.client
      .from(table)
      .select(LIST_SELECT[kind], { count: 'exact' })
      .eq('build_id', build.id);

    // Buyable-only by default. ammunition/manufacturer/blueprint tables have no
    // is_variant column — skip the filter for them.
    if (kind !== 'ammunition' && kind !== 'manufacturer' && kind !== 'blueprint' && !filters.includeVariants) {
      query = query.eq('is_variant', false);
    }

    if (filters.manufacturer) query = query.eq('manufacturer_code', filters.manufacturer);
    if (filters.size != null) query = query.eq('size', filters.size);
    if (filters.grade) query = query.eq('grade', filters.grade);
    if (filters.componentKind && kind === 'component')
      query = query.eq('kind', filters.componentKind);
    if (filters.weaponClass && kind === 'weapon')
      query = query.eq('weapon_class', filters.weaponClass);
    if (filters.subType) query = query.eq('sub_type', filters.subType);
    if (filters.subTypeIn?.length) query = query.in('sub_type', filters.subTypeIn);
    if (filters.subTypeNotIn?.length)
      query = query.or(notInOrNull('sub_type', filters.subTypeNotIn));
    if (filters.attachType && (kind === 'item' || kind === 'weapon'))
      query = query.eq('attach_type', filters.attachType);
    if (filters.attachTypeIn?.length && (kind === 'item' || kind === 'weapon'))
      query = query.in('attach_type', filters.attachTypeIn);
    if (filters.attachTypeNotIn?.length && (kind === 'item' || kind === 'weapon'))
      query = query.or(notInOrNull('attach_type', filters.attachTypeNotIn));
    if (filters.category && kind === 'blueprint') query = query.eq('category', filters.category);
    if (filters.blueprintCategoryIn?.length && kind === 'blueprint')
      query = query.in('category', filters.blueprintCategoryIn);

    const q = filters.search?.trim();
    if (q) {
      const safe = escapeIlike(q);
      // manufacturer/ammunition still have name_localized + class_name.
      query = query.or(`name_localized.ilike.%${safe}%,class_name.ilike.%${safe}%`);
    }

    query = query
      .order('name_localized', { ascending: true, nullsFirst: false })
      .order('class_name', { ascending: true })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    const rows = ((data ?? []) as unknown[]).map((r) => mapListRow(kind, r as Record<string, unknown>));
    return { rows, count: count ?? rows.length };
  }

  /**
   * Bridge landing data (Slice-1 "The Bridge"): a single query for the ship
   * lane content. Returns up to `limit` buyable ships of the current build,
   * ordered by name — reused as both the "Fresh this patch" lane source and the
   * featured-hero fallback. No schema change: this is `listByKind('ship')` with
   * a ship-focused default, surfaced as a named read helper so the Bridge
   * component stays declarative.
   */
  async listBridgeShips(limit = 24): Promise<CodexListRow[]> {
    const res = await this.listByKind('ship', { limit, offset: 0 });
    return res.rows;
  }

  /**
   * Facet columns of EVERY weapon in the current build — the source the browse
   * taxonomy counts its categories from (codex-weapon-taxonomy).
   *
   * Deliberately not a per-bucket `count` query: that would be one round trip
   * per category (14 of them) instead of the two paged reads it takes to pull
   * three tiny columns for ~1.3k rows. Cached per build id, because the build
   * only changes when a new catalog is ingested.
   */
  async weaponFacets(): Promise<WeaponFacetRow[]> {
    const build = await this.loadCurrentBuild();
    if (!build) return [];
    if (this.weaponFacetCache?.buildId === build.id) return this.weaponFacetCache.rows;

    const page = 1000; // PostgREST caps a response at 1000 rows
    const out: WeaponFacetRow[] = [];
    for (let offset = 0; offset < WEAPON_FACET_HARD_CAP; offset += page) {
      const { data, error } = await this.sb.client
        .from(CODEX_ENTITY_TABLES['weapon'])
        .select('weapon_class, attach_type, sub_type, is_variant')
        .eq('build_id', build.id)
        .order('class_name', { ascending: true })
        .range(offset, offset + page - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      for (const r of rows) {
        out.push({
          weaponClass: (r['weapon_class'] as string | null) ?? null,
          attachType: (r['attach_type'] as string | null) ?? null,
          subType: (r['sub_type'] as string | null) ?? null,
          isVariant: r['is_variant'] === true,
        });
      }
      if (rows.length < page) break;
    }
    this.weaponFacetCache = { buildId: build.id, rows: out };
    return out;
  }

  /**
   * FPS Codex section (#251): on-foot weapons — `codex_weapons` scoped to
   * `weapon_class = 'FPS'`. Reuses the same buyable-only / variant filtering
   * as every other kind (is_variant = false by default), which is also what
   * drops the huge pile of `@LOC_PLACEHOLDER` / NPC test rows in this table.
   */
  async listFpsWeapons(filters: Omit<CodexListFilters, 'weaponClass'> = {}): Promise<CodexListResult> {
    return this.listByKind('weapon', { ...filters, weaponClass: 'FPS' });
  }

  /**
   * FPS Codex section (#251): on-foot / CHARACTER armor — `codex_items` scoped
   * to the personal-armor slots (`Char_Armor_*`). NB: `attach_type = 'Armor'`
   * (no `Char_` prefix) is SHIP hull armor (ARMR_* classes) — a different thing
   * entirely; do not confuse the two. Personal armor carries no rich stat block
   * in the extract yet (tracked separately, blocked issue #253); the list/detail
   * degrade gracefully to name/grade/size/slot/manufacturer only. A caller may
   * additionally pass `attachType` to narrow to one slot (e.g. Char_Armor_Helmet).
   */
  async listFpsArmor(filters: Omit<CodexListFilters, 'attachTypeIn'> = {}): Promise<CodexListResult> {
    return this.listByKind('item', { ...filters, attachTypeIn: [...FPS_ARMOR_ATTACH_TYPES] });
  }

  /**
   * Candidate livery siblings of one entity, for the detail view's skin picker
   * (feedback d5e39f86). Reads the current build by class-name PREFIX — the
   * first three underscore segments, `gmni_pistol_ballistic` for
   * `gmni_pistol_ballistic_01_cen01` — which is a cheap superset of the family;
   * `resolveSkinGroup` decides what actually belongs to it, so an over-wide
   * match costs nothing (`_` is a single-character wildcard in `ilike`, which
   * only ever widens it further).
   *
   * Kinds without liveries return an empty list without a round trip. Ship
   * liveries are a separate pipeline entirely (`ship_skins` / the Showroom),
   * and neither manufacturers, ammunition nor blueprints are painted.
   */
  async listSkinSiblings(kind: CodexKind, classNameSlug: string): Promise<CodexListRow[]> {
    if (kind !== 'weapon' && kind !== 'item' && kind !== 'component') return [];
    const build = await this.loadCurrentBuild();
    if (!build) return [];

    const { data, error } = await this.sb.client
      .from(CODEX_ENTITY_TABLES[kind])
      .select(LIST_SELECT[kind])
      .eq('build_id', build.id)
      .ilike('class_name', `${escapeIlike(skinQueryPrefix(classNameSlug))}%`)
      .order('class_name', { ascending: true })
      .limit(SKIN_SIBLING_LIMIT);
    if (error) throw error;
    return ((data ?? []) as unknown[]).map((r) => mapListRow(kind, r as Record<string, unknown>));
  }

  /**
   * Candidate edition siblings of one ship, for the detail view's variant
   * picker (feedback 77ecad2a). Reads the current build by class-name PREFIX —
   * manufacturer + model, `AEGS_Idris` for `AEGS_Idris_P_Collector_Military` —
   * which is a cheap superset of the family; `resolveEditionGroup` decides what
   * actually belongs to it, so an over-wide match costs nothing.
   *
   * Ships only: the edition rule reads a class-name lineage that only the
   * vehicle catalog carries. Weapon liveries are `listSkinSiblings`.
   */
  async listEditionSiblings(kind: CodexKind, classNameSlug: string): Promise<CodexListRow[]> {
    if (kind !== 'ship') return [];
    const build = await this.loadCurrentBuild();
    if (!build) return [];

    const { data, error } = await this.sb.client
      .from(CODEX_ENTITY_TABLES[kind])
      .select(LIST_SELECT[kind])
      .eq('build_id', build.id)
      .ilike('class_name', `${escapeIlike(editionQueryPrefix(classNameSlug))}%`)
      .order('class_name', { ascending: true })
      .limit(SKIN_SIBLING_LIMIT);
    if (error) throw error;
    return ((data ?? []) as unknown[]).map((r) => mapListRow(kind, r as Record<string, unknown>));
  }

  /** Entity row + its hardpoints + its localized strings, for the detail view. */
  async getDetail(kind: CodexKind, classNameSlug: string): Promise<CodexDetail | null> {
    const build = await this.loadCurrentBuild();
    if (!build) return null;

    const table = CODEX_ENTITY_TABLES[kind];
    const [rowRes, portsRes, stringsRes] = await Promise.all([
      this.sb.client
        .from(table)
        .select('*')
        .eq('build_id', build.id)
        .eq('class_name', classNameSlug)
        .maybeSingle(),
      this.sb.client
        .from('codex_item_ports')
        .select('*')
        .eq('build_id', build.id)
        .eq('parent_class_name', classNameSlug)
        .order('port_index', { ascending: true }),
      this.sb.client
        .from('codex_entity_strings')
        .select('entity_class_name, entity_kind, lang, field, value, loc_key')
        .eq('build_id', build.id)
        .eq('entity_class_name', classNameSlug),
    ]);

    if (rowRes.error) throw rowRes.error;
    if (!rowRes.data) return null;

    const row = rowRes.data as Record<string, unknown>;
    return {
      classNameSlug,
      kind,
      row,
      payload: row['payload'],
      ports: ((portsRes.data ?? []) as unknown[]).map((p) => mapPort(p as Record<string, unknown>)),
      strings: ((stringsRes.data ?? []) as unknown[]).map((s) =>
        mapString(s as Record<string, unknown>),
      ),
    };
  }

  /**
   * Resolve a default-loadout `entityClassName` to its kind, so the detail
   * view can deep-link. Looks the className up across weapon/component/item
   * tables (cheap: indexed exact match, head-only). Returns null if unknown.
   */
  async resolveKind(className: string): Promise<CodexKind | null> {
    const build = await this.loadCurrentBuild();
    if (!build) return null;
    const candidates: CodexKind[] = ['weapon', 'component', 'item', 'ship', 'ammunition'];
    for (const kind of candidates) {
      const { count, error } = await this.sb.client
        .from(CODEX_ENTITY_TABLES[kind])
        .select('class_name', { count: 'exact', head: true })
        .eq('build_id', build.id)
        .eq('class_name', className);
      if (!error && (count ?? 0) > 0) return kind;
    }
    return null;
  }

  /**
   * Batch-resolve a set of class names to their kind + display fields, for the
   * default-loadout view. One query per entity table (`.in(class_name, …)`)
   * instead of N×5 head-count probes — first table that owns a class name wins.
   * Names that resolve to none are simply absent from the map.
   */
  async resolveEntities(classNames: string[]): Promise<Map<string, ResolvedEntity>> {
    const out = new Map<string, ResolvedEntity>();
    const build = await this.loadCurrentBuild();
    const names = Array.from(new Set(classNames.filter(Boolean)));
    if (!build || names.length === 0) return out;

    // Column set per table — only columns that exist on each table.
    const selects: Partial<Record<CodexKind, string>> = {
      weapon: 'class_name, name_localized, manufacturer_code, size, grade',
      component: 'class_name, name_localized, manufacturer_code, size, grade',
      item: 'class_name, name_localized, manufacturer_code, size, grade',
      ship: 'class_name, name_localized, manufacturer_code',
      ammunition: 'class_name, name_localized, size',
    };

    await Promise.all(
      (Object.keys(selects) as CodexKind[]).map(async (kind) => {
        const { data, error } = await this.sb.client
          .from(CODEX_ENTITY_TABLES[kind])
          .select(selects[kind]!)
          .eq('build_id', build.id)
          .in('class_name', names);
        if (error || !data) return;
        for (const r of data as unknown as Record<string, unknown>[]) {
          const cn = r['class_name'] as string;
          if (out.has(cn)) continue; // first owner wins
          out.set(cn, {
            kind,
            className: cn,
            nameLocalized: (r['name_localized'] as string | null) ?? null,
            manufacturerCode: (r['manufacturer_code'] as string | null) ?? null,
            size: (r['size'] as number | null) ?? null,
            grade: (r['grade'] as string | null) ?? null,
          });
        }
      }),
    );
    return out;
  }

  /**
   * Batch-fetch full payloads for a set of class names across the mountable
   * entity tables (weapon/component/item) — the hangar's loadout-stats input.
   * First table that owns a class name wins (mirrors resolveEntities).
   */
  async getEntityPayloads(
    classNames: string[],
  ): Promise<Map<string, { kind: CodexKind; payload: unknown }>> {
    const out = new Map<string, { kind: CodexKind; payload: unknown }>();
    const build = await this.loadCurrentBuild();
    const names = Array.from(new Set(classNames.filter(Boolean)));
    if (!build || names.length === 0) return out;

    await Promise.all(
      (['weapon', 'component', 'item'] as CodexKind[]).map(async (kind) => {
        const { data, error } = await this.sb.client
          .from(CODEX_ENTITY_TABLES[kind])
          .select('class_name, payload')
          .eq('build_id', build.id)
          .in('class_name', names);
        if (error || !data) return;
        for (const r of data as unknown as Record<string, unknown>[]) {
          const cn = r['class_name'] as string;
          if (!out.has(cn)) out.set(cn, { kind, payload: r['payload'] });
        }
      }),
    );
    return out;
  }

  /**
   * Batch-fetch ammunition payloads by class name. Guns carry no resolved
   * ammoContainerRecord in the extract, so their projectile stats (damage,
   * speed, lifetime) are only reachable via CIG's `<weaponClass>_AMMO` naming
   * convention — see `ammoClassNameFor`. Missing names simply don't come back;
   * the caller renders no projectile stats for those.
   */
  async getAmmoPayloads(classNames: string[]): Promise<Map<string, unknown>> {
    const out = new Map<string, unknown>();
    const build = await this.loadCurrentBuild();
    const names = Array.from(new Set(classNames.filter(Boolean)));
    if (!build || names.length === 0) return out;
    const { data, error } = await this.sb.client
      .from('codex_ammunition')
      .select('class_name, payload')
      .eq('build_id', build.id)
      .in('class_name', names);
    if (error || !data) return out;
    for (const r of data as unknown as Record<string, unknown>[]) {
      out.set(r['class_name'] as string, r['payload']);
    }
    return out;
  }

  /**
   * Hangar dashboard cards: codex ship rows (promoted columns + payload) for
   * a set of class names in the current build. Map keyed by class_name.
   */
  async getShipsByClassNames(classNames: string[]): Promise<Map<string, CodexListRow>> {
    const out = new Map<string, CodexListRow>();
    const build = await this.loadCurrentBuild();
    const names = Array.from(new Set(classNames.filter(Boolean)));
    if (!build || names.length === 0) return out;
    const { data, error } = await this.sb.client
      .from('codex_ships')
      .select(LIST_SELECT.ship)
      .eq('build_id', build.id)
      .in('class_name', names);
    if (error || !data) return out;
    for (const r of (data ?? []) as unknown[]) {
      const row = mapListRow('ship', r as Record<string, unknown>);
      out.set(row.classNameSlug, row);
    }
    return out;
  }

  /**
   * Poly-entity Codex search: query EVERY kind (not ships-only) with the same
   * trigram-backed `.or(ilike)` list search, merge the rows into scope-tinted
   * cross-entity hits, and rank them deterministically (see codex-poly-search).
   * Zero model calls — server-ranked from our own data. A kind that errors is
   * skipped rather than failing the whole search.
   *
   * The build is not the whole truth about ships, so the RSI announcement feed
   * is searched as an eighth source (admin feedback 7b91c5ae: "Arrastra" is a
   * concept hull, present in the upcoming feed and in no `codex_ships` row, and
   * the terminal answered with nothing at all). Those hits carry the `upcoming`
   * pseudo-kind and are tinted + badged apart from anything you can fly today.
   */
  async searchAll(query: string, perKindLimit = 6): Promise<PolySearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const sources: Promise<PolySearchHit[]>[] = CODEX_KINDS.map(async (kind) => {
      try {
        const res = await this.listByKind(kind, { search: q, limit: perKindLimit });
        return res.rows.map((r) => toPolyHit(kind, r));
      } catch {
        return [] as PolySearchHit[];
      }
    });
    sources.push(
      (async () => {
        try {
          return (await this.upcoming.searchShips(q, perKindLimit)).map(toUpcomingHit);
        } catch {
          return [] as PolySearchHit[];
        }
      })(),
    );
    const results = await Promise.all(sources);
    return rankPolyHits(q, results.flat());
  }

  /**
   * The most recent LIVE codex builds, newest first (current build is index 0).
   * ingest-catalog never prunes old builds, so the two newest are the current +
   * previous patch — the free basis for the inline patch-diff. Best-effort: any
   * error yields an empty list (no diff, no thrown error).
   */
  async recentLiveBuilds(limit = 2): Promise<CodexBuild[]> {
    try {
      const { data, error } = await this.sb.client
        .from('codex_builds')
        .select(
          'id, channel, patch_version, build_number, schema_version, quality_score, tool_version, entity_counts, is_current, extracted_at',
        )
        .eq('channel', 'LIVE')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      return (data as Record<string, unknown>[]).map(mapBuild);
    } catch {
      return [];
    }
  }

  /**
   * Inline patch-diff for the user's owned fleet: for each ship class name, the
   * numeric deltas between the two most recent LIVE builds (green = better, red
   * = worse — see codex-build-diff). Degrades gracefully: fewer than two
   * retained builds, or no comparable movement, yields an empty map — the fleet
   * simply renders no deltas, never an error. Keyed by class_name.
   */
  async ownedFleetDeltas(classNames: string[]): Promise<Map<string, ShipStatDelta[]>> {
    const out = new Map<string, ShipStatDelta[]>();
    const names = Array.from(new Set(classNames.filter(Boolean)));
    if (names.length === 0) return out;
    const builds = await this.recentLiveBuilds(2);
    if (builds.length < 2) return out; // need a previous build to diff against
    const [current, previous] = builds;
    const [curRows, prevRows] = await Promise.all([
      this.shipRowsForBuild(current.id, names),
      this.shipRowsForBuild(previous.id, names),
    ]);
    for (const [cn, cur] of curRows) {
      const prev = prevRows.get(cn);
      if (!prev) continue;
      const deltas = computeShipRowDeltas(cur, prev);
      if (deltas.length) out.set(cn, deltas);
    }
    return out;
  }

  /** Ship list rows for an ARBITRARY build id (the diff needs both builds). */
  private async shipRowsForBuild(
    buildId: string,
    classNames: string[],
  ): Promise<Map<string, CodexListRow>> {
    const out = new Map<string, CodexListRow>();
    const { data, error } = await this.sb.client
      .from('codex_ships')
      .select(LIST_SELECT.ship)
      .eq('build_id', buildId)
      .in('class_name', classNames);
    if (error || !data) return out;
    for (const r of (data ?? []) as unknown[]) {
      const row = mapListRow('ship', r as Record<string, unknown>);
      out.set(row.classNameSlug, row);
    }
    return out;
  }

  /**
   * Resolve which buyable weapons/components/items fit a hardpoint, via the
   * codex_compatible_items RPC (matches the port's accepted `types` + size
   * range against each item's attach_type + size). Empty `types` ⇒ no result.
   */
  async getCompatibleItems(port: PortQuery): Promise<CompatibleItem[]> {
    const build = await this.loadCurrentBuild();
    if (!build || !port.types?.length) return [];
    const { data, error } = await this.sb.client.rpc('codex_compatible_items', {
      p_build_id: build.id,
      p_types: port.types,
      p_min: port.minSize,
      p_max: port.maxSize,
    });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      kind: r['kind'] as CodexKind,
      classNameSlug: r['class_name'] as string,
      nameLocalized: (r['name_localized'] as string | null) ?? null,
      manufacturerCode: (r['manufacturer_code'] as string | null) ?? null,
      size: (r['size'] as number | null) ?? null,
      subType: (r['sub_type'] as string | null) ?? null,
      grade: (r['grade'] as string | null) ?? null,
    }));
  }

  /**
   * Resolve raw global.ini @-keys (roles, port labels, …) to their localized
   * value in the current build, from codex_locale_strings. The leading `@` is
   * stripped to match the table's key form. Returns a key→value map keyed by
   * the ORIGINAL input string.
   *
   * The key list travels in the URL as PostgREST's `key=in.(…)`, so it is sent
   * in batches (see LOCALE_KEY_URL_BUDGET) rather than one request — /codex/
   * keybinds asks for ~1 250 keys at once, which overran the edge's request-line
   * limit and 400'd on every load. Batches run concurrently, so the extra
   * requests cost roughly one round-trip on HTTP/2.
   */
  async resolveLocaleKeys(keys: string[], lang: Lang): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const build = await this.loadCurrentBuild();
    const wanted = keys.filter((k) => k && k.startsWith('@'));
    if (!build || wanted.length === 0) return out;
    const norm = new Map(wanted.map((k) => [k.slice(1), k])); // stripped -> original

    const batches = await Promise.all(
      batchLocaleKeys([...norm.keys()]).map((batch) =>
        this.sb.client
          .from('codex_locale_strings')
          .select('key, value')
          .eq('build_id', build.id)
          .eq('lang', lang)
          .in('key', batch),
      ),
    );
    for (const { data, error } of batches) {
      // Localization is a nice-to-have — never block the view. A batch that
      // fails just leaves its keys unresolved; the caller falls back to English
      // or to the raw key.
      if (error) continue;
      for (const r of (data ?? []) as { key: string; value: string }[]) {
        const original = norm.get(r.key);
        if (original) out.set(original, r.value);
      }
    }
    return out;
  }

  /**
   * All default keybindings for the current build, in document order (the
   * global `sort` reproduces the profile's actionmap → action order, so callers
   * can group consecutive rows by `actionmap`). Labels stay as @-keys — resolve
   * them in a batch via resolveLocaleKeys. Empty array when no build is live.
   */
  async listKeybinds(): Promise<CodexKeybind[]> {
    const build = await this.loadCurrentBuild();
    if (!build) return [];
    const rows: Record<string, unknown>[] = [];
    for (let page = 0; page < KEYBIND_MAX_PAGES; page++) {
      const from = page * KEYBIND_PAGE_SIZE;
      const { data, error } = await this.sb.client
        .from('codex_keybinds')
        .select(
          'actionmap, action_name, label_key, description_key, category_label_key, ' +
            'activation_mode, binding_keyboard, binding_mouse, binding_gamepad, binding_joystick, sort',
        )
        .eq('build_id', build.id)
        // `sort` is the extractor's global document-order counter and unique
        // within a build, so it is already a total order; `action_name` only
        // guards against a future extractor emitting ties, which would let
        // paging repeat or skip rows.
        .order('sort', { ascending: true })
        .order('action_name', { ascending: true })
        .range(from, from + KEYBIND_PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as unknown as Record<string, unknown>[];
      rows.push(...batch);
      if (batch.length < KEYBIND_PAGE_SIZE) break;
    }
    return rows.map((r) => ({
      actionmap: (r['actionmap'] as string) ?? '',
      actionName: (r['action_name'] as string) ?? '',
      labelKey: (r['label_key'] as string | null) ?? null,
      descriptionKey: (r['description_key'] as string | null) ?? null,
      categoryLabelKey: (r['category_label_key'] as string | null) ?? null,
      activationMode: (r['activation_mode'] as string | null) ?? null,
      bindings: {
        keyboard: (r['binding_keyboard'] as string | null) ?? null,
        mouse: (r['binding_mouse'] as string | null) ?? null,
        gamepad: (r['binding_gamepad'] as string | null) ?? null,
        joystick: (r['binding_joystick'] as string | null) ?? null,
      },
      sort: (r['sort'] as number | null) ?? 0,
    }));
  }

  /**
   * Public URL of a preview image (WebP) in the codex-previews storage bucket,
   * for the current build. `previewImage` is the bare filename from the entity
   * payload; returns null when the entity has no art.
   */
  previewUrl(previewImage: string | null | undefined): string | null {
    const build = this.build();
    if (!previewImage || !build) return null;
    return `${environment.supabase.url}/storage/v1/object/public/codex-previews/` +
      `${encodeURIComponent(build.buildNumber)}/${encodeURIComponent(previewImage)}`;
  }

  // ── compare tray ───────────────────────────────────────────────────────────
  static compareKey(kind: CodexKind, className: string): string {
    return `${kind}:${className}`;
  }

  isPinned(kind: CodexKind, className: string): boolean {
    return this._compare().includes(CodexService.compareKey(kind, className));
  }

  togglePin(kind: CodexKind, className: string): void {
    const key = CodexService.compareKey(kind, className);
    const cur = this._compare();
    if (cur.includes(key)) {
      this._compare.set(cur.filter((k) => k !== key));
      return;
    }
    // Like-for-like only: mixed kinds produce meaningless columns — refuse
    // and surface the tray's current kind so the UI can explain.
    const trayKind = cur.length > 0 ? (cur[0].slice(0, cur[0].indexOf(':')) as CodexKind) : null;
    if (trayKind && trayKind !== kind) {
      this._compareRejected.set(trayKind);
      return;
    }
    this._compareRejected.set(null);
    // Adding a 5th bumps the oldest pin (FIFO) instead of silently refusing.
    const next = cur.length >= CodexService.COMPARE_MAX ? cur.slice(1) : cur;
    this._compare.set([...next, key]);
  }

  unpin(key: string): void {
    this._compare.set(this._compare().filter((k) => k !== key));
  }

  clearCompare(): void {
    this._compare.set([]);
    this._compareRejected.set(null);
  }

  // ── Blueprint-specific queries ─────────────────────────────────────────────

  /** Cached distinct categories, keyed by the build they were derived from. */
  private blueprintCategoryCache: { buildId: string; values: string[] } | null = null;
  private blueprintCategoryPromise: Promise<string[]> | null = null;

  /**
   * Distinct blueprint categories present in the current build, sorted.
   *
   * These are CIG's own bucket names and change between patches, so they MUST
   * come from the data — a hardcoded list silently filters everything to zero
   * the moment the extractor emits a bucket nobody predicted.
   *
   * PostgREST has no DISTINCT, so this pages the `category` column (one small
   * column, server max-rows is 1000) and dedupes client-side. Cached per build,
   * and single-flighted so a facet + list render can't double-fetch.
   */
  async blueprintCategories(): Promise<string[]> {
    const build = await this.loadCurrentBuild();
    if (!build) return [];
    if (this.blueprintCategoryCache?.buildId === build.id) {
      return this.blueprintCategoryCache.values;
    }
    if (this.blueprintCategoryPromise) return this.blueprintCategoryPromise;
    this.blueprintCategoryPromise = this.fetchBlueprintCategories(build.id).finally(() => {
      this.blueprintCategoryPromise = null;
    });
    return this.blueprintCategoryPromise;
  }

  private async fetchBlueprintCategories(buildId: string): Promise<string[]> {
    const seen = new Set<string>();
    for (let page = 0; page < CATEGORY_MAX_PAGES; page++) {
      const from = page * CATEGORY_PAGE_SIZE;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (this.sb.client as any)
        .from('codex_blueprints')
        .select('category')
        .eq('build_id', buildId)
        // Deterministic total order — paging without it can repeat/skip rows.
        .order('category', { ascending: true, nullsFirst: false })
        .order('class_name', { ascending: true })
        .range(from, from + CATEGORY_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as { category: string | null }[];
      for (const r of rows) {
        if (r.category) seen.add(r.category);
      }
      if (rows.length < CATEGORY_PAGE_SIZE) break;
    }
    const values = [...seen].sort((a, b) => a.localeCompare(b));
    this.blueprintCategoryCache = { buildId, values };
    return values;
  }

  /**
   * Paged list of blueprints in the current build.
   * Fuzzy search runs over BOTH name_localized AND class_name (ilike, same
   * pattern as listByKind). Optional category facet.
   */
  async listBlueprints(filters: BlueprintListFilters = {}): Promise<BlueprintListResult> {
    const build = await this.loadCurrentBuild();
    if (!build) return { rows: [], count: 0 };

    const limit = filters.limit ?? PAGE_SIZE;
    const offset = filters.offset ?? 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (this.sb.client as any)
      .from('codex_blueprints')
      .select('class_name, name_localized, category, tier, craft_time_seconds, dismantle_time_seconds, payload', { count: 'exact' })
      .eq('build_id', build.id);

    if (filters.category) {
      query = query.eq('category', filters.category);
    }

    const q = filters.search?.trim();
    if (q) {
      const safe = escapeIlike(q);
      query = query.or(`name_localized.ilike.%${safe}%,class_name.ilike.%${safe}%`);
    }

    query = query
      .order('name_localized', { ascending: true, nullsFirst: false })
      .order('class_name', { ascending: true })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    const rows = ((data ?? []) as unknown[]).map((r) =>
      mapListRow('blueprint', r as Record<string, unknown>),
    );
    return { rows, count: count ?? rows.length };
  }

  /**
   * Detail for a single blueprint: row + ordered ingredients.
   * Ingredients are ordered by ingredient_index ascending (the extractor
   * preserves recipe order).
   */
  async getBlueprint(className: string): Promise<BlueprintDetail | null> {
    const build = await this.loadCurrentBuild();
    if (!build) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = this.sb.client as any;

    const [rowRes, ingredientsRes] = await Promise.all([
      sb
        .from('codex_blueprints')
        .select('*')
        .eq('build_id', build.id)
        .eq('class_name', className)
        .maybeSingle(),
      sb
        .from('codex_blueprint_ingredients')
        .select('*')
        .eq('build_id', build.id)
        .eq('blueprint_class_name', className)
        .order('ingredient_index', { ascending: true }),
    ]);

    if (rowRes.error) throw rowRes.error;
    if (!rowRes.data) return null;

    const row = rowRes.data as Record<string, unknown>;
    const ingredients = ((ingredientsRes.data ?? []) as unknown[]).map((i) =>
      mapIngredient(i as Record<string, unknown>),
    );

    return { classNameSlug: className, row, ingredients };
  }

  /**
   * Forward query: HOW is this item crafted? Resolves the blueprint that
   * PRODUCES `outputClassName` and returns it with its ordered ingredients.
   *
   * This is the complement of `blueprintsUsingIngredient` (which answers "what
   * can I build WITH this"). The FPS codex needs the forward direction — "which
   * materials does this helmet cost" — which is what issue #187 asks for.
   * Returns null when no blueprint produces the class (most catalog items are
   * not craftable).
   */
  async getCraftingRecipe(outputClassName: string): Promise<BlueprintDetail | null> {
    const build = await this.loadCurrentBuild();
    if (!build) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = this.sb.client as any;
    const { data, error } = await sb
      .from('codex_blueprints')
      .select('*')
      .eq('build_id', build.id)
      .eq('output_class_name', outputClassName)
      .order('tier', { ascending: true, nullsFirst: true })
      .limit(1);
    if (error || !data?.length) return null;

    const row = data[0] as Record<string, unknown>;
    const className = row['class_name'] as string;
    const { data: ingRows } = await sb
      .from('codex_blueprint_ingredients')
      .select('*')
      .eq('build_id', build.id)
      .eq('blueprint_class_name', className)
      .order('ingredient_index', { ascending: true });

    return {
      classNameSlug: className,
      row,
      ingredients: ((ingRows ?? []) as unknown[]).map((i) =>
        mapIngredient(i as Record<string, unknown>),
      ),
    };
  }

  /**
   * Reverse query: which blueprints use a given resource/item as an ingredient?
   * Used to surface a "used in N blueprints" panel on item detail pages.
   * Returns slim blueprint refs, ordered by name.
   */
  async blueprintsUsingIngredient(ingredientClassName: string): Promise<BlueprintRef[]> {
    const build = await this.loadCurrentBuild();
    if (!build) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = this.sb.client as any;

    // Get blueprint class names that use this ingredient
    const { data: ingRows, error: ingErr } = await sb
      .from('codex_blueprint_ingredients')
      .select('blueprint_class_name')
      .eq('build_id', build.id)
      .eq('ingredient_class_name', ingredientClassName);

    if (ingErr || !ingRows?.length) return [];

    const blueprintClassNames = Array.from(
      new Set((ingRows as { blueprint_class_name: string }[]).map((r) => r.blueprint_class_name)),
    );

    const { data, error } = await sb
      .from('codex_blueprints')
      .select('class_name, name_localized, tier, craft_time_seconds')
      .eq('build_id', build.id)
      .in('class_name', blueprintClassNames)
      .order('name_localized', { ascending: true, nullsFirst: false });

    if (error) return [];

    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      classNameSlug: r['class_name'] as string,
      nameLocalized: (r['name_localized'] as string | null) ?? null,
      tier: (r['tier'] as number | null) ?? null,
      craftTimeSec: (r['craft_time_seconds'] as number | null) ?? null,
    }));
  }
}

// ── pure mappers / helpers ────────────────────────────────────────────────────

function mapBuild(r: Record<string, unknown>): CodexBuild {
  const counts = (r['entity_counts'] ?? {}) as CodexBuild['entityCounts'];
  return {
    id: r['id'] as string,
    channel: r['channel'] as string,
    patchVersion: r['patch_version'] as string,
    buildNumber: r['build_number'] as string,
    schemaVersion: (r['schema_version'] as number) ?? 0,
    qualityScore: (r['quality_score'] as number | null) ?? null,
    toolVersion: (r['tool_version'] as string | null) ?? null,
    entityCounts: counts,
    isCurrent: (r['is_current'] as boolean) ?? false,
    extractedAt: (r['extracted_at'] as string | null) ?? null,
  };
}

function mapListRow(kind: CodexKind, r: Record<string, unknown>): CodexListRow {
  return {
    classNameSlug: r['class_name'] as string,
    nameLocalized: (r['name_localized'] as string | null) ?? null,
    manufacturerCode: (r['manufacturer_code'] as string | null) ?? null,
    size: (r['size'] as number | null) ?? null,
    grade: (r['grade'] as string | null) ?? null,
    role: (r['role'] as string | null) ?? null,
    crewSize: (r['crew_size'] as number | null) ?? null,
    weaponClass: (r['weapon_class'] as string | null) ?? null,
    componentKind: (r['kind'] as string | null) ?? null,
    subType: (r['sub_type'] as string | null) ?? null,
    attachType: (r['attach_type'] as string | null) ?? null,
    speed: (r['speed'] as number | null) ?? null,
    isVariant: (r['is_variant'] as boolean) ?? false,
    payload: r['payload'],
    // Blueprint-specific promoted columns (null for other kinds)
    blueprintCategory: kind === 'blueprint' ? ((r['category'] as string | null) ?? null) : null,
    blueprintTier: kind === 'blueprint' ? ((r['tier'] as number | null) ?? null) : null,
    craftTimeSec: kind === 'blueprint' ? ((r['craft_time_seconds'] as number | null) ?? null) : null,
  };
}

function mapPort(p: Record<string, unknown>): CodexItemPort {
  return {
    parentClassName: p['parent_class_name'] as string,
    parentKind: p['parent_kind'] as string,
    portName: (p['port_name'] as string | null) ?? null,
    minSize: (p['min_size'] as number | null) ?? null,
    maxSize: (p['max_size'] as number | null) ?? null,
    types: (p['types'] as string[] | null) ?? [],
    flags: (p['flags'] as string[] | null) ?? [],
    portIndex: (p['port_index'] as number) ?? 0,
    // Hardpoint position on the hull (#137 part 3). NULL on every row ingested
    // before the uploader could read the hull mesh — a missing coordinate is
    // "unknown", never zero.
    helperName: (p['helper_name'] as string | null) ?? null,
    position: numericVector(p['position'], 3),
    rotation: numericVector(p['rotation'], 4),
  };
}

/**
 * A jsonb coordinate column as a finite numeric tuple, else null. The column is
 * jsonb, so anything could technically be in there; a half-valid vector must not
 * reach the projection math.
 */
function numericVector(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  return value.every((v) => typeof v === 'number' && Number.isFinite(v))
    ? (value as number[])
    : null;
}

function mapString(s: Record<string, unknown>): CodexEntityString {
  return {
    entityClassName: (s['entity_class_name'] as string) ?? '',
    entityKind: (s['entity_kind'] as string) ?? '',
    lang: (s['lang'] as Lang) ?? 'en',
    field: (s['field'] as string) ?? '',
    value: (s['value'] as string | null) ?? null,
    locKey: (s['loc_key'] as string | null) ?? null,
  };
}

/** PostgREST `or=ilike` is comma/paren-delimited — neutralise those chars. */
function escapeIlike(input: string): string {
  return input.replace(/[%,()]/g, ' ').trim();
}

/**
 * PostgREST `or` clause for "column is none of these values" that ALSO keeps
 * NULL rows. `not.in` alone drops them (SQL three-valued logic), which would
 * quietly hide records from the taxonomy's catch-all bucket. Values are the
 * taxonomy's own hardcoded tokens, but they get quoted anyway so a future entry
 * with a comma or space cannot break the filter grammar.
 */
function notInOrNull(column: string, values: readonly string[]): string {
  const list = values.map((v) => `"${v.replace(/"/g, '')}"`).join(',');
  return `${column}.is.null,${column}.not.in.(${list})`;
}

function mapIngredient(i: Record<string, unknown>): CodexBlueprintIngredient {
  return {
    blueprintClassName: (i['blueprint_class_name'] as string) ?? '',
    ingredientIndex: (i['ingredient_index'] as number) ?? 0,
    ingredientClassName: (i['ingredient_class_name'] as string | null) ?? null,
    quantity: (i['quantity'] as number) ?? 1,
    minQuality: (i['min_quality'] as number | null) ?? null,
    role: (i['role'] as string) ?? 'primary',
    nameLocalized: (i['name_localized'] as string | null) ?? null,
    entityKind: (i['entity_kind'] as string | null) ?? null,
  };
}

/**
 * The personal-armor `attach_type` values that make up the FPS armor section.
 * (`attach_type = 'Armor'` — no prefix — is SHIP hull armor, deliberately excluded.)
 */
export const FPS_ARMOR_ATTACH_TYPES = [
  'Char_Armor_Helmet',
  'Char_Armor_Torso',
  'Char_Armor_Arms',
  'Char_Armor_Legs',
  'Char_Armor_Undersuit',
  'Char_Armor_Backpack',
] as const;

/** Human slot token for a personal-armor attach_type ('Char_Armor_Helmet' → 'Helmet'). */
export function fpsArmorSlot(attachType: string | null | undefined): string | null {
  if (!attachType) return null;
  return attachType.startsWith('Char_Armor_') ? attachType.slice('Char_Armor_'.length) : attachType;
}

/** Reverse of fpsArmorSlot: a slot token back to its attach_type ('Helmet' → 'Char_Armor_Helmet'). */
export function fpsArmorAttachType(slot: string | null | undefined): string | null {
  return slot ? `Char_Armor_${slot}` : null;
}

/** Pick the active-language string out of a LocalizedText, with fallbacks. */
export function pickLocalized(
  text: LocalizedText | null | undefined,
  lang: Lang,
  fallback = '',
): string {
  if (!text) return fallback;
  // Drop unresolved global.ini keys ('@...') so a missing translation falls
  // back to the other language or the caller's fallback, never a raw key.
  const clean = (v: string | undefined): string => {
    const s = (v ?? '').trim();
    // Drop unresolved '@'-keys AND Star-Citizen's untranslated-LOCID marker
    // ("! … TRANSLATION NOT FOUND FOR LOCID: … !"), which ships as a real value.
    return s && !s.startsWith('@') && !/translation not found/i.test(s) ? s : '';
  };
  const primary = lang === 'de' ? clean(text.de) : clean(text.en);
  return primary || clean(text.en) || clean(text.de) || fallback;
}

/**
 * Like pickLocalized, but the user-language value is used only when it is a
 * GENUINE translation: non-empty, not an unresolved '@'-key, and different
 * from the English copy (the extract ships identical EN text in the de field
 * for the untranslated remainder). Otherwise English (or the caller's
 * fallback) is returned — never a raw key, never a fake "translation". (#50)
 */
export function pickLocalizedDistinct(
  text: LocalizedText | null | undefined,
  lang: Lang,
  fallback = '',
): string {
  if (!text) return fallback;
  const clean = (v: string | undefined): string => {
    const s = (v ?? '').trim();
    // Drop unresolved '@'-keys AND Star-Citizen's untranslated-LOCID marker
    // ("! … TRANSLATION NOT FOUND FOR LOCID: … !"), which ships as a real value.
    return s && !s.startsWith('@') && !/translation not found/i.test(s) ? s : '';
  };
  const en = clean(text.en);
  if (lang !== 'en') {
    const primary = clean(text[lang]);
    if (primary && primary !== en) return primary;
  }
  return en || clean(text.de) || fallback;
}

/**
 * Full manufacturer name for a catalog row, in the app language.
 *
 * The name is REAL extracted game data, never a hand-written expansion table:
 * every entity payload carries `manufacturer.name`, the resolved
 * `@manufacturer_Name…` global.ini string the uploader copies off the record's
 * SCItemManufacturer (see `data-uploader/python/sc_extract/dataforge_extract.py`
 * → `extract_manufacturers` / `_manufacturer_ref`, and the `codex_manufacturers`
 * table that holds the same strings standalone). So "AEG" resolves to
 * "Aegis Dynamics" because the game says so, not because we mapped it.
 *
 * Rows whose payload carries no manufacturer record at all (a handful of
 * non-ship props in the ship table: comms probes, destructible objectives)
 * fall back to the promoted `manufacturer_code` column, and to null when even
 * that is empty — we never invent an expansion for an unknown code.
 */
export function manufacturerLabel(
  row: { payload?: unknown; manufacturerCode?: string | null } | null | undefined,
  lang: Lang,
): string | null {
  if (!row) return null;
  const p = row.payload as { manufacturer?: { name?: LocalizedText } } | undefined;
  return pickLocalized(p?.manufacturer?.name, lang) || row.manufacturerCode || null;
}

/**
 * Manufacturer facet options for a list view: the option VALUE stays the
 * promoted `manufacturer_code` (that is what `listByKind` filters on), only the
 * LABEL is spelled out from the row payload's extracted name. A code whose rows
 * carry no resolvable name keeps the code as its own label. Sorted by what the
 * user actually reads, so the dropdown is alphabetical by manufacturer name.
 */
export function manufacturerFacetOptions(
  rows: readonly { payload?: unknown; manufacturerCode?: string | null }[],
  lang: Lang,
): { code: string; label: string }[] {
  const byCode = new Map<string, string>();
  for (const r of rows) {
    const code = r.manufacturerCode;
    if (!code) continue;
    const label = manufacturerLabel(r, lang) ?? code;
    const existing = byCode.get(code);
    // First resolved name wins; never let a later code-only row overwrite it.
    if (!existing || existing === code) byCode.set(code, label);
  }
  return [...byCode.entries()]
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Map an ngx-translate language code ('de', 'en', 'de-DE', …) to a codex data
 * Lang. SC content exists in both DE and EN (DE is ~97.6% genuinely translated,
 * not an English copy), so catalog content is rendered in the app language with
 * EN as the guaranteed fallback — see pickLocalized's fallback chain. (UC-08)
 */
export function toLang(lang: string | null | undefined): Lang {
  return (lang ?? '').toLowerCase().startsWith('de') ? 'de' : 'en';
}

// Re-export row aliases so consuming components can type narrowly if needed.
export type {
  CodexShipRow,
  CodexWeaponRow,
  CodexComponentRow,
  CodexItemRow,
  CodexAmmunitionRow,
  CodexManufacturerRow,
  LocalizedText,
};
