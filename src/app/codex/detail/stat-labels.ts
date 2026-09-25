import { StatGroup, StatRow } from '../codex-format';

/**
 * AUD-060 — the curated stat grids (`curateComponentStats` / `meaningfulRows`
 * in codex-format.ts) humanize an engine field name generically (camelCase /
 * underscore split, acronym list) but never translate it: on the German UI a
 * "Radiation Resistance.Maximum Radiation Capacity" tile still reads in
 * English, and a handful of engine-internal fields slip past the upstream
 * noise filter because they arrive as a single lower-case token with no case
 * boundary to split on (`animspeed` humanizes to the innocuous-looking
 * "Animspeed" instead of tripping `isNoiseKey`'s word-list match).
 *
 * This module adds a translation + a second, stricter noise filter on TOP of
 * the already-humanized `StatRow.key` — it never re-parses the raw payload,
 * so it works for every kind (component / weapon / armour) that flows
 * through `codex-detail.component.ts`'s three stat grids without touching
 * codex-format.ts (out of scope for this change).
 */

/**
 * Known stat labels, keyed by their LEAF text — the part of an already
 * humanized `StatRow.key` after the last "." (e.g. "Radiation
 * Resistance.Maximum Radiation Capacity" → "Maximum Radiation Capacity").
 * Keying on the leaf means one entry covers the stat under every struct
 * prefix it can appear behind (an armour resistance, a component health
 * block, …) instead of enumerating every dotted path CIG's data happens to
 * produce. Value is the suffix under the `codex.stat.*` i18n namespace.
 *
 * Unknown keys are NOT dropped — `toDisplayStatRows` keeps the existing
 * humanized string as a fallback so an uncatalogued stat still shows
 * something instead of silently disappearing.
 */
const STAT_LABEL_KEYS: Record<string, string> = {
  Health: 'health',
  'Distortion Capacity': 'distortionCapacity',
  'Max Shield Health': 'maxShieldHealth',
  'Max Shield Regen': 'maxShieldRegen',
  'SCM Speed': 'scmSpeed',
  'Max Speed': 'maxSpeed',
  'Boost Speed': 'boostSpeed',
  'Fire Rate': 'fireRate',
  'Rounds Per Minute': 'roundsPerMinute',
  'Muzzle Velocity': 'muzzleVelocity',
  'Projectile Speed': 'projectileSpeed',
  Lifetime: 'lifetime',
  'Maximum Radiation Capacity': 'radiationCapacityMax',
  'Radiation Resistance': 'radiationResistance',
  'Puncture Resistance': 'punctureResistance',
  'Impact Resistance': 'impactResistance',
  'Energy Resistance': 'energyResistance',
  'Explosive Resistance': 'explosiveResistance',
  'Cold Resistance': 'coldResistance',
  'Heat Resistance': 'heatResistance',
  'Biochemical Resistance': 'biochemicalResistance',
  'Temperature Resistance': 'temperatureResistance',
  Weight: 'weight',
  Durability: 'durability',
  'Cargo Grid': 'cargoGrid',
  'Ammo Capacity': 'ammoCapacity',
  'Magazine Size': 'magazineSize',
  Damage: 'damage',
  Range: 'range',
  'Effective Range': 'effectiveRange',
};

const STAT_LABEL_LOOKUP = new Map<string, string>(
  Object.entries(STAT_LABEL_KEYS).map(([k, v]) => [k.toLowerCase(), v]),
);

/**
 * Engine/asset plumbing that occasionally slips past `isNoiseKey` upstream
 * (codex-format.ts) because it arrives as a single lower-case token with no
 * camelCase boundary ("animspeed" → "Animspeed", not "Anim Speed"). Matched
 * against the FINAL humanized label so both the struct-qualified ("Other
 * Params.Animspeed") and bare forms are caught. Extend THIS list — never the
 * visible dictionary above — when a new internal token turns up on a detail
 * page; each entry documents the concrete finding it was added for.
 */
const ENGINE_INTERNAL_DENYLIST: RegExp[] = [
  /\banim(?:speed|params?)?\b/i, // "Animspeed" / "Anim Params" (AUD-060 finding)
  /\bhit\s*effect\b/i, // "Hit Effect Lib Name" (AUD-060 finding)
  /\beffect\s*lib\b/i,
  /\blib\s*name\b/i,
  /\bgeometry\b/i,
  /\bparticle\b/i,
  /\btexture\b/i,
  /\bmesh\b/i,
  /\baudio\b/i,
  /\bvisual\b/i,
  /\bthumbnail\b/i,
  /\btemplate\b/i,
  /\bnamespace\b/i,
  /\btooltip\b/i,
  /\bbinding\b/i,
  /\bicon\b/i,
];

function leafOf(key: string): string {
  const i = key.lastIndexOf('.');
  return i >= 0 ? key.slice(i + 1).trim() : key;
}

/** Whether a (humanized) stat label is engine/asset internals that must never reach the UI. */
export function isEngineInternalStatLabel(label: string): boolean {
  return ENGINE_INTERNAL_DENYLIST.some((re) => re.test(label));
}

/** i18n key for a known stat label, or undefined if uncatalogued (caller keeps the humanized fallback). */
export function statLabelI18nKey(label: string): string | undefined {
  const suffix =
    STAT_LABEL_LOOKUP.get(label.toLowerCase()) ?? STAT_LABEL_LOOKUP.get(leafOf(label).toLowerCase());
  return suffix ? `codex.stat.${suffix}` : undefined;
}

export interface DisplayStatRow extends StatRow {
  /** Set when `key` maps to a catalogued i18n label; the template shows this (translated) instead of `key`. */
  i18nKey?: string;
}

export interface DisplayStatGroup {
  purpose: StatGroup['purpose'];
  rows: DisplayStatRow[];
}

/**
 * Adapt curated stat rows for display: drop engine-internal rows outright,
 * attach the i18n key for catalogued labels, leave everything else as the
 * existing humanized fallback.
 */
export function toDisplayStatRows(rows: StatRow[]): DisplayStatRow[] {
  const out: DisplayStatRow[] = [];
  for (const r of rows) {
    if (isEngineInternalStatLabel(r.key)) continue;
    const i18nKey = statLabelI18nKey(r.key);
    out.push(i18nKey ? { ...r, i18nKey } : r);
  }
  return out;
}

/** Same adaptation, applied group-wise; a group emptied entirely by the denylist is dropped. */
export function toDisplayStatGroups(groups: StatGroup[]): DisplayStatGroup[] {
  return groups
    .map((g) => ({ purpose: g.purpose, rows: toDisplayStatRows(g.rows) }))
    .filter((g) => g.rows.length > 0);
}
