/**
 * Pure mapping of the extractor's typed JSON entities onto the codex_* table
 * row shapes the `ingest-catalog` edge function expects.
 *
 * This is a faithful TypeScript port of the row-building logic in
 * `supabase/scripts/seed-codex.mjs` (the reference client). Keeping it pure +
 * separate makes it unit-testable and keeps the exact schema mapping in one
 * place, so a Data-Uploader upload produces byte-identical codex rows to the
 * seed script.
 *
 * No I/O here — `catalog-bridge.ts` reads the files and drives the network.
 */

export interface Nat {
  channel: string;
  patch_version: string;
  build_number: string;
}

/** A localized `{ en, de, key }` blob as emitted by the extractor. */
export interface Loc {
  en?: string;
  de?: string;
  key?: string;
}

export interface EntityRow {
  build_id: string;
  channel: string;
  patch_version: string;
  build_number: string;
  class_name: string;
  [k: string]: unknown;
}

export interface StringRow {
  build_id: string;
  channel: string;
  patch_version: string;
  build_number: string;
  entity_class_name: string;
  entity_kind: string;
  lang: string;
  field: string;
  value: string;
  loc_key: string | null;
}

export interface PortRow {
  build_id: string;
  channel: string;
  patch_version: string;
  build_number: string;
  parent_class_name: string;
  parent_kind: string;
  port_name: string | null;
  min_size: number | null;
  max_size: number | null;
  types: string[];
  flags: string[];
  port_index: number;
}

export interface IngredientRow {
  build_id: string;
  channel: string;
  patch_version: string;
  build_number: string;
  blueprint_class_name: string;
  ingredient_class_name: string | null;
  ingredient_guid: string | null;
  quantity: number | null;
  min_quality: number | null;
  role: string | null;
  ingredient_index: number;
}

/** Prefer EN, fall back to DE; drop unresolved `@…` keys so the UI uses the class name. */
export function localizedName(name: unknown): string | null {
  if (!name || typeof name !== 'object') return null;
  const n = name as Loc;
  const clean = (v?: string): string => {
    const s = (v || '').trim();
    return s && !s.startsWith('@') ? s : '';
  };
  return clean(n.en) || clean(n.de) || null;
}

const VARIANT_RE = /(_PU_AI_|_AI_|_Template$|^MASTER_|_Unmanned_|_Renegade$)/i;
export const isVariant = (cn: string | undefined): boolean => VARIANT_RE.test(cn || '');

export const manuCode = (e: { manufacturer?: unknown }): string | null =>
  e.manufacturer && typeof e.manufacturer === 'object'
    ? ((e.manufacturer as { code?: string }).code ?? null)
    : null;

/** Bind build_id + natural key so every row carries its build coordinates. */
export function makeTagger(buildId: string, nat: Nat) {
  return (extra: Record<string, unknown>): EntityRow =>
    ({ build_id: buildId, ...nat, ...extra }) as EntityRow;
}

/** Collect en/de entity strings for the given (className, kind) + fields. */
export function collectStrings(
  out: StringRow[],
  buildId: string,
  nat: Nat,
  entityClassName: string,
  entityKind: string,
  fields: { field: string; loc: unknown }[],
): void {
  for (const { field, loc } of fields) {
    if (!loc || typeof loc !== 'object') continue;
    const l = loc as Loc;
    for (const lang of ['en', 'de'] as const) {
      const value = l[lang];
      if (value == null || value === '') continue;
      out.push({
        build_id: buildId,
        ...nat,
        entity_class_name: entityClassName,
        entity_kind: entityKind,
        lang,
        field,
        value,
        loc_key: l.key ?? null,
      });
    }
  }
}

/** Collect item-port rows for a parent entity. */
export function collectPorts(
  out: PortRow[],
  buildId: string,
  nat: Nat,
  parentClassName: string,
  parentKind: string,
  itemPorts: unknown,
): void {
  if (!Array.isArray(itemPorts)) return;
  itemPorts.forEach((p, idx) => {
    const port = p as {
      portName?: string; minSize?: number; maxSize?: number; types?: string[]; flags?: string[];
    };
    out.push({
      build_id: buildId,
      ...nat,
      parent_class_name: parentClassName,
      parent_kind: parentKind,
      port_name: port.portName ?? null,
      min_size: port.minSize ?? null,
      max_size: port.maxSize ?? null,
      types: Array.isArray(port.types) ? port.types : [],
      flags: Array.isArray(port.flags) ? port.flags : [],
      port_index: idx,
    });
  });
}

/** De-duplicate entity strings by (class, lang, field) — last write wins. */
export function dedupeStrings(strings: StringRow[]): StringRow[] {
  const seen = new Map<string, StringRow>();
  for (const s of strings) seen.set(`${s.entity_class_name}|${s.lang}|${s.field}`, s);
  return [...seen.values()];
}

// ── per-kind row builders (mirror seed-codex.mjs) ──────────────────────────

type Tag = ReturnType<typeof makeTagger>;

export function mapManufacturers(list: Record<string, unknown>[], tag: Tag): EntityRow[] {
  return list.map((m) =>
    tag({
      class_name: m.className,
      guid: m.guid ?? null,
      manufacturer_code: (m as { code?: string }).code ?? null,
      name_localized: localizedName(m.name),
      payload: m,
    }),
  );
}

export function mapShips(list: Record<string, unknown>[], tag: Tag): EntityRow[] {
  return list.map((s) =>
    tag({
      class_name: s.className,
      guid: s.guid ?? null,
      entity_kind: 'ship',
      manufacturer_code: manuCode(s),
      role: s.role ?? null,
      crew_size: (s as { crew?: { size?: number } }).crew?.size ?? null,
      is_variant: isVariant(s.className as string),
      name_localized: localizedName(s.name),
      payload: s,
    }),
  );
}

export function mapWeapons(list: Record<string, unknown>[], tag: Tag): EntityRow[] {
  return list.map((w) =>
    tag({
      class_name: w.className,
      guid: w.guid ?? null,
      entity_kind: 'weapon',
      weapon_class: (w as { weaponClass?: string }).weaponClass ?? null,
      attach_type: (w as { attachType?: string }).attachType ?? null,
      sub_type: (w as { subType?: string }).subType ?? null,
      size: w.size ?? null,
      grade: w.grade ?? null,
      manufacturer_code: manuCode(w),
      is_variant: isVariant(w.className as string),
      name_localized: localizedName(w.name),
      payload: w,
    }),
  );
}

export function mapComponents(list: Record<string, unknown>[], tag: Tag): EntityRow[] {
  return list.map((c) =>
    tag({
      class_name: c.className,
      guid: c.guid ?? null,
      entity_kind: 'component',
      kind: c.kind ?? null,
      attach_type: (c as { attachType?: string }).attachType ?? null,
      sub_type: (c as { subType?: string }).subType ?? null,
      size: c.size ?? null,
      grade: c.grade ?? null,
      manufacturer_code: manuCode(c),
      is_variant: isVariant(c.className as string),
      name_localized: localizedName(c.name),
      payload: c,
    }),
  );
}

export function mapItems(list: Record<string, unknown>[], tag: Tag): EntityRow[] {
  return list.map((it) =>
    tag({
      class_name: it.className,
      guid: it.guid ?? null,
      entity_kind: 'item',
      attach_type: (it as { attachType?: string }).attachType ?? null,
      sub_type: (it as { subType?: string }).subType ?? null,
      size: it.size ?? null,
      grade: it.grade ?? null,
      manufacturer_code: manuCode(it),
      is_variant: isVariant(it.className as string),
      name_localized: localizedName(it.name),
      payload: it,
    }),
  );
}

export function mapAmmunition(list: Record<string, unknown>[], tag: Tag): EntityRow[] {
  return list.map((a) =>
    tag({
      class_name: a.className,
      guid: a.guid ?? null,
      speed: (a as { speed?: number }).speed ?? null,
      lifetime: (a as { lifetime?: number }).lifetime ?? null,
      size: a.size ?? null,
      name_localized: null,
      payload: a,
    }),
  );
}

export function mapBlueprints(list: Record<string, unknown>[], tag: Tag): EntityRow[] {
  return list.map((bp) => {
    const outputs = bp.outputs as { className?: string }[] | undefined;
    const outputClassName =
      Array.isArray(outputs) && outputs.length > 0 ? (outputs[0].className ?? null) : null;
    return tag({
      class_name: bp.className,
      guid: bp.guid ?? null,
      entity_kind: 'blueprint',
      category: bp.category ?? null,
      tier: bp.tier ?? null,
      craft_time_seconds: (bp as { craftTimeSeconds?: number }).craftTimeSeconds ?? null,
      dismantle_time_seconds: (bp as { dismantleTimeSeconds?: number }).dismantleTimeSeconds ?? null,
      dismantle_efficiency: (bp as { dismantleEfficiency?: number }).dismantleEfficiency ?? null,
      output_class_name: outputClassName,
      is_default: (bp as { isDefault?: boolean }).isDefault ?? null,
      is_variant: false,
      name_localized: localizedName(bp.name),
      payload: bp,
    });
  });
}

/**
 * Whether a promotion produced enough to safely become the live catalog. A real
 * extract always yields manufacturers + ships; if BOTH are empty the out_dir was
 * partial or corrupt (a changed extractor layout, an interrupted run…), so the
 * caller must NOT flip is_current onto it — the last good build stays live.
 */
export function hasViableCatalog(counts: Record<string, number>): boolean {
  return (counts.ships ?? 0) > 0 || (counts.manufacturers ?? 0) > 0;
}

/** Collect blueprint ingredient rows across all blueprints. */
export function collectIngredients(
  buildId: string,
  nat: Nat,
  list: Record<string, unknown>[],
): IngredientRow[] {
  const out: IngredientRow[] = [];
  for (const bp of list) {
    const ings = bp.ingredients as
      | { className?: string; guid?: string; quantity?: number; minQuality?: number; role?: string }[]
      | undefined;
    if (!Array.isArray(ings)) continue;
    ings.forEach((ing, idx) =>
      out.push({
        build_id: buildId,
        ...nat,
        blueprint_class_name: bp.className as string,
        ingredient_class_name: ing.className ?? null,
        ingredient_guid: ing.guid ?? null,
        quantity: ing.quantity ?? null,
        min_quality: ing.minQuality ?? null,
        role: ing.role ?? null,
        ingredient_index: idx,
      }),
    );
  }
  return out;
}

// ── keybindings ─────────────────────────────────────────────────────────────

export interface KeybindRow {
  build_id: string;
  channel: string;
  patch_version: string;
  build_number: string;
  actionmap: string;
  action_name: string;
  label_key: string | null;
  description_key: string | null;
  category_label_key: string | null;
  activation_mode: string | null;
  binding_keyboard: string | null;
  binding_mouse: string | null;
  binding_gamepad: string | null;
  binding_joystick: string | null;
  payload: unknown;
  sort: number;
}

/** The keybinds.json the extractor writes (keybinds/keybinds.json). */
export interface KeybindData {
  actionmaps?: {
    name?: string;
    labelKey?: string | null;
    categoryKey?: string | null;
    sort?: number;
  }[];
  actions?: {
    actionmap?: string;
    name?: string;
    labelKey?: string | null;
    descriptionKey?: string | null;
    activationMode?: string | null;
    bindings?: {
      keyboard?: string | null; mouse?: string | null;
      gamepad?: string | null; joystick?: string | null;
    };
    sort?: number;
  }[];
}

/**
 * Map the extractor's keybinds.json onto codex_keybinds rows. Each action row
 * carries its actionmap's label @-key (category_label_key) so the reference can
 * render category headings without a second lookup. Labels stay @-keys — they
 * resolve via codex_locale_strings client-side (all languages). Actions missing
 * an actionmap or name are skipped; everything else (incl. unbound) is kept.
 */
export function mapKeybinds(data: KeybindData, buildId: string, nat: Nat): KeybindRow[] {
  const categoryByMap = new Map<string, string | null>();
  for (const am of data.actionmaps ?? []) {
    if (am.name) categoryByMap.set(am.name, am.labelKey ?? null);
  }
  const rows: KeybindRow[] = [];
  for (const a of data.actions ?? []) {
    if (!a.actionmap || !a.name) continue;
    const b = a.bindings ?? {};
    rows.push({
      build_id: buildId,
      ...nat,
      actionmap: a.actionmap,
      action_name: a.name,
      label_key: a.labelKey ?? null,
      description_key: a.descriptionKey ?? null,
      category_label_key: categoryByMap.get(a.actionmap) ?? null,
      activation_mode: a.activationMode ?? null,
      binding_keyboard: b.keyboard ?? null,
      binding_mouse: b.mouse ?? null,
      binding_gamepad: b.gamepad ?? null,
      binding_joystick: b.joystick ?? null,
      payload: a,
      sort: a.sort ?? 0,
    });
  }
  return rows;
}
