/**
 * Two-level browse taxonomy for the Codex "weapons" category.
 *
 * The weapons table is ONE flat catalog that mixes personal (FPS) gear and
 * ship hardpoint weapons — 1312 records in the current LIVE build, ~2/3 of them
 * ship-side (admin feedback 7897bcb0 asked which of the two the tab shows: the
 * answer is "both"). A single alphabetical grid is unbrowsable at that size, so
 * this module folds the catalog into super-categories that break down into
 * smaller ones.
 *
 * Nothing here is invented data. Every bucket is a projection of columns the
 * ingest-catalog pipeline already promotes on `codex_weapons`:
 *
 * - `weapon_class` ('FPS' | 'Ship') → the SUPER category.
 * - `sub_type`     → the FPS sub-categories (CIG's own hand-class tokens
 *                    Small/Medium/Large/Knife/Grenade/Gadget).
 * - `attach_type`  → the ship sub-categories (the hardpoint contract the item
 *                    mounts to: WeaponGun/Turret/MissileLauncher/…).
 *
 * Each sub-category maps to a plain server-side filter (`in` / `not in`), so
 * picking one narrows the SQL query rather than the loaded page — the grid stays
 * paged exactly as before. The catch-all bucket of each super category also
 * matches rows whose field is NULL, so no record can fall out of the taxonomy.
 */

/** The two super categories, keyed by the `weapon_class` they project. */
export type WeaponSuperGroupId = 'fps' | 'ship';

/** Which promoted column a super category cuts its sub-categories from. */
export type WeaponGroupField = 'subType' | 'attachType';

export interface WeaponSubGroup {
  /** Stable id — i18n key is `codex.weaponGroup.<superId>.<id>`. */
  readonly id: string;
  /** Raw values of the super category's field that land in this bucket. */
  readonly values: readonly string[];
  /** True for the single catch-all bucket (everything unmapped, incl. NULL). */
  readonly rest?: boolean;
}

export interface WeaponSuperGroup {
  readonly id: WeaponSuperGroupId;
  /** The `weapon_class` value this super category selects. */
  readonly weaponClass: 'FPS' | 'Ship';
  readonly field: WeaponGroupField;
  readonly subGroups: readonly WeaponSubGroup[];
}

/**
 * The mapping. Order is the display order of the rail.
 *
 * FPS `sub_type` is CIG's carry class, not a genre: 'Small' is what a player
 * calls a sidearm (pistols, the medgun), 'Medium' the two-handed primaries
 * (rifles, SMGs, shotguns, grenade launchers), 'Large' the heavy weapons
 * (HMGs). 'Grenade' additionally holds the non-explosive throwables (flares,
 * glowsticks), which is why the label says "throwables" rather than "grenades".
 *
 * Ship `attach_type` is the hardpoint contract, which is the distinction that
 * actually matters when shopping for a mount: a gun goes on a gun hardpoint, a
 * turret on a turret hardpoint. `sub_type` is deliberately NOT used here — it
 * splits turrets into a dozen mount-shape tokens (Ball/Top/Canard/PDC/…) that
 * are a detail of the hull, not a shopping category.
 */
export const WEAPON_SUPER_GROUPS: readonly WeaponSuperGroup[] = [
  {
    id: 'fps',
    weaponClass: 'FPS',
    field: 'subType',
    subGroups: [
      { id: 'sidearm', values: ['Small'] },
      { id: 'primary', values: ['Medium'] },
      { id: 'heavy', values: ['Large'] },
      { id: 'melee', values: ['Knife'] },
      { id: 'throwable', values: ['Grenade'] },
      { id: 'gadget', values: ['Gadget'] },
      { id: 'other', values: [], rest: true },
    ],
  },
  {
    id: 'ship',
    weaponClass: 'Ship',
    field: 'attachType',
    subGroups: [
      { id: 'gun', values: ['WeaponGun'] },
      { id: 'turret', values: ['Turret'] },
      { id: 'missile', values: ['MissileLauncher'] },
      { id: 'countermeasure', values: ['WeaponDefensive'] },
      { id: 'mining', values: ['WeaponMining'] },
      { id: 'utility', values: ['TractorBeam', 'TowingBeam', 'SalvageHead'] },
      { id: 'other', values: [], rest: true },
    ],
  },
] as const;

/** The subset of `CodexListFilters` a group selection translates into. */
export interface WeaponGroupQuery {
  weaponClass?: string;
  subTypeIn?: string[];
  subTypeNotIn?: string[];
  attachTypeIn?: string[];
  attachTypeNotIn?: string[];
}

/** The facet columns the count pass reads — one narrow row per weapon record. */
export interface WeaponFacetRow {
  weaponClass: string | null;
  attachType: string | null;
  subType: string | null;
  isVariant: boolean;
}

export function weaponSuperGroup(id: string): WeaponSuperGroup | null {
  return WEAPON_SUPER_GROUPS.find((g) => g.id === id) ?? null;
}

/** Every value the super category maps explicitly (i.e. everything not "rest"). */
function mappedValues(sup: WeaponSuperGroup): string[] {
  return sup.subGroups.flatMap((s) => (s.rest ? [] : [...s.values]));
}

/**
 * Server-side filter for a group selection. An empty `superId` means "all
 * weapons" and yields an empty query; an empty/unknown `subId` narrows to the
 * super category only.
 */
export function weaponGroupQuery(superId: string, subId: string): WeaponGroupQuery {
  const sup = weaponSuperGroup(superId);
  if (!sup) return {};
  const q: WeaponGroupQuery = { weaponClass: sup.weaponClass };
  const sub = sup.subGroups.find((s) => s.id === subId);
  if (!sub) return q;
  if (sub.rest) {
    const rest = mappedValues(sup);
    if (sup.field === 'subType') q.subTypeNotIn = rest;
    else q.attachTypeNotIn = rest;
  } else if (sup.field === 'subType') {
    q.subTypeIn = [...sub.values];
  } else {
    q.attachTypeIn = [...sub.values];
  }
  return q;
}

/** The super category a row belongs to, or null when `weapon_class` is unset. */
export function weaponSuperGroupOf(row: Pick<WeaponFacetRow, 'weaponClass'>): WeaponSuperGroup | null {
  return WEAPON_SUPER_GROUPS.find((g) => g.weaponClass === row.weaponClass) ?? null;
}

/** The sub-category id a row falls into within its super category. */
export function weaponSubGroupOf(
  sup: WeaponSuperGroup,
  row: Pick<WeaponFacetRow, 'attachType' | 'subType'>,
): string {
  const value = sup.field === 'subType' ? row.subType : row.attachType;
  const hit = sup.subGroups.find((s) => !s.rest && value != null && s.values.includes(value));
  return hit?.id ?? (sup.subGroups.find((s) => s.rest)?.id ?? 'other');
}

/** Count-map key for a super category, and for one of its sub-categories. */
export function weaponGroupKey(superId: string, subId?: string): string {
  return subId ? `${superId}/${subId}` : superId;
}

/**
 * Bucket counts over the facet rows, keyed by `weaponGroupKey`. Rows whose
 * `weapon_class` matches no super category are simply not counted — they are
 * also not reachable through the rail, and the "all" entry keeps showing the
 * server total, so nothing is silently claimed to be complete that isn't.
 */
export function countWeaponGroups(rows: readonly WeaponFacetRow[]): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (key: string) => out.set(key, (out.get(key) ?? 0) + 1);
  for (const row of rows) {
    const sup = weaponSuperGroupOf(row);
    if (!sup) continue;
    bump(weaponGroupKey(sup.id));
    bump(weaponGroupKey(sup.id, weaponSubGroupOf(sup, row)));
  }
  return out;
}
