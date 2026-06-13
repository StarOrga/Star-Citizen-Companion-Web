import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { environment } from '../../environments/environment';
import {
  CODEX_ENTITY_TABLES,
  BlueprintIngredientPayload,
  CodexAmmunitionRow,
  CodexBuild,
  CodexBlueprintIngredient,
  CodexComponentRow,
  CodexEntityString,
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
  // include AI/template variants (default: buyable-only)
  includeVariants?: boolean;
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

// Columns selected per kind for the list view. Keep payload last.
const LIST_SELECT: Record<CodexKind, string> = {
  ship: 'class_name, name_localized, manufacturer_code, role, crew_size, is_variant, payload',
  weapon:
    'class_name, name_localized, manufacturer_code, weapon_class, sub_type, size, grade, is_variant, payload',
  component:
    'class_name, name_localized, manufacturer_code, kind, attach_type, sub_type, size, grade, is_variant, payload',
  item: 'class_name, name_localized, manufacturer_code, attach_type, sub_type, size, grade, is_variant, payload',
  ammunition: 'class_name, name_localized, speed, lifetime, size, payload',
  manufacturer: 'class_name, name_localized, manufacturer_code, payload',
  blueprint: 'class_name, name_localized, category, tier, craft_time_seconds, dismantle_time_seconds, payload',
};

@Injectable({ providedIn: 'root' })
export class CodexService {
  private readonly sb = inject(SupabaseClientProvider);

  readonly build = signal<CodexBuild | null>(null);
  readonly buildLoading = signal(false);
  readonly buildError = signal<string | null>(null);

  // Compare tray: pinned `${kind}:${className}` keys (max 4).
  private readonly _compare = signal<string[]>([]);
  readonly compareKeys = this._compare.asReadonly();
  readonly compareCount = computed(() => this._compare().length);
  static readonly COMPARE_MAX = 4;

  private buildPromise: Promise<CodexBuild | null> | null = null;

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
      return mapped;
    } catch (err) {
      this.buildError.set((err as Error).message ?? 'Unknown error');
      return null;
    } finally {
      this.buildLoading.set(false);
    }
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
   */
  async resolveLocaleKeys(keys: string[], lang: Lang): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const build = await this.loadCurrentBuild();
    const wanted = keys.filter((k) => k && k.startsWith('@'));
    if (!build || wanted.length === 0) return out;
    const norm = new Map(wanted.map((k) => [k.slice(1), k])); // stripped -> original
    const { data, error } = await this.sb.client
      .from('codex_locale_strings')
      .select('key, value')
      .eq('build_id', build.id)
      .eq('lang', lang)
      .in('key', [...norm.keys()]);
    if (error) return out; // localization is a nice-to-have — never block the view
    for (const r of (data ?? []) as { key: string; value: string }[]) {
      const original = norm.get(r.key);
      if (original) out.set(original, r.value);
    }
    return out;
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
    } else if (cur.length < CodexService.COMPARE_MAX) {
      this._compare.set([...cur, key]);
    }
  }

  unpin(key: string): void {
    this._compare.set(this._compare().filter((k) => k !== key));
  }

  clearCompare(): void {
    this._compare.set([]);
  }

  // ── Blueprint-specific queries ─────────────────────────────────────────────

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
  };
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
    return s && !s.startsWith('@') ? s : '';
  };
  const primary = lang === 'de' ? clean(text.de) : clean(text.en);
  return primary || clean(text.en) || clean(text.de) || fallback;
}

// Re-export row aliases so consuming components can type narrowly if needed.
export type {
  CodexShipRow,
  CodexWeaponRow,
  CodexComponentRow,
  CodexItemRow,
  CodexAmmunitionRow,
  CodexManufacturerRow,
};
