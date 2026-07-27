// The comparison table behind the weapon/module swap picker.
// -----------------------------------------------------------------------------
// Admin request 461288f9, second pass: clicking a configurable module opens a
// "Swap weapon"-style picker — a searchable, filterable, sortable table of
// everything that fits the hardpoint, one row per candidate, the installed item
// marked EQUIPPED. This module is the pure half of it (no Angular, no I/O) so
// the column set, the facets and the sort are unit-testable on their own.
//
// HARD RULE, inherited from codex-equipped-stats: never invent a number. Every
// column here is a stat the extract actually carries for at least one candidate
// in the set — nothing is padded with zeros to make the table look like the
// reference screenshot. What the 4.9.0 extract does NOT carry for ship weapons
// (re-verified against the live catalog on 2026-07-27, build b77f1586, over all
// 97 size-3 ship weapons):
//   * fireRate is 0 on every row  → no RATE column, and therefore no DPS
//   * ammoContainerRecord is null → no magazine / AMMO column
//   * no spread, no power draw, no EM signature, no per-weapon health
// so a gun table shows ALPHA / PEN / RANGE / SPEED and honestly omits the rest,
// and each of those columns starts working by itself the day the extract grows
// the field — the column set is derived from the data, not hardcoded.

import { CodexKind } from './codex.service';
import {
  EquippedStatFormat,
  damageChannelsOf,
  equippedStats,
  equippedTypeLabel,
  formatEquippedStat,
} from './codex-equipped-stats';
import { StatRow, humanizeClassName } from './codex-format';

// ── candidates ───────────────────────────────────────────────────────────────

/** One stat of a candidate, keyed in {@link SwapCandidate.stats} by i18n key. */
export interface SwapStatValue {
  value: number;
  format: EquippedStatFormat;
  /** True when the number was computed rather than read verbatim. */
  derived?: boolean;
}

/** One row of the picker table. */
export interface SwapCandidate {
  className: string;
  kind: CodexKind;
  /** Localized name, or a humanized class name when the extract has none. */
  name: string;
  manufacturerCode: string | null;
  size: number | null;
  grade: string | null;
  /** "Laser Cannon", "Quantum Drive" — what the thing IS, read from the data. */
  typeLabel: string | null;
  /** Facet value for the type filter ("Cannon", "Repeater", …); null = unclassified. */
  archetype: string | null;
  /** Damage channels it deals, strongest first (usually exactly one). */
  damageChannels: string[];
  /** Curated stats by i18n label key — the table's cells. */
  stats: Record<string, SwapStatValue>;
  /** This is what sits on the hardpoint right now. */
  equipped: boolean;
}

/** The raw inputs a candidate row is assembled from. */
export interface SwapCandidateInput {
  className: string;
  kind: CodexKind;
  nameLocalized: string | null;
  manufacturerCode: string | null;
  size: number | null;
  grade: string | null;
  subType: string | null;
  /** Full entity payload; null when the build has no row for the class. */
  payload: unknown;
  /** Matching `<class>_AMMO` payload for guns, when one exists. */
  ammoPayload?: unknown;
  equipped?: boolean;
}

/**
 * Weapon archetypes CIG spells out in the class name (`AMRS_LaserCannon_S3`)
 * and/or the localized name ("Omnisky IX Cannon"). Matched against both, with
 * separators stripped, so `APAR_BallisticScatterGun_S3` and "Predator
 * Scattergun" both resolve to the same facet.
 *
 * This is a RECOGNITION vocabulary, not the filter's option list: the picker
 * only ever offers the archetypes that actually occur in the current result
 * set, and a candidate nothing here matches falls back to its `subType`.
 * Ordered most-specific first — "Scattergun" must win over "Gun".
 */
const ARCHETYPES: [needle: string, label: string][] = [
  ['scattergun', 'Scattergun'],
  ['gatling', 'Gatling'],
  ['repeater', 'Repeater'],
  ['massdriver', 'Mass Driver'],
  ['cannon', 'Cannon'],
  ['mininglaser', 'Mining Laser'],
  ['tractorbeam', 'Tractor Beam'],
  ['salvagebeam', 'Salvage Beam'],
  ['missilerack', 'Missile Rack'],
  ['missilelauncher', 'Missile Launcher'],
  ['rocketpod', 'Rocket Pod'],
  ['turret', 'Turret'],
];

// Type discriminators the extract fills with a placeholder rather than a value.
const PLACEHOLDER_SUBTYPE = new Set(['undefined', 'unknown', 'none', 'other', '']);

/** Letters only, lower-cased — `APAR_BallisticScatterGun_S3` → `aparballisticscattergun…`. */
function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * The filter facet for a candidate: a recognised weapon archetype when the
 * class or display name spells one out, otherwise the humanized `subType`
 * (which is a real extractor field — `GunTurret`, `MissileRack`, `Rocket`).
 * `null` only when the data offers neither; such a candidate carries no type
 * tag and shows up only under "All".
 */
export function swapArchetype(
  className: string,
  name: string | null,
  subType: string | null,
): string | null {
  const hay = `${normalize(className)}|${normalize(name)}`;
  for (const [needle, label] of ARCHETYPES) {
    if (hay.includes(needle)) return label;
  }
  const st = (subType ?? '').trim();
  return st && !PLACEHOLDER_SUBTYPE.has(st.toLowerCase()) ? humanizeClassName(st) : null;
}

// A class-name segment that spells out what the item is: ≥2 CamelCase words and
// no digits — `LaserCannon`, `BallisticGatling`, `NeutronRepeater`. The
// manufacturer prefix (`AMRS`), the size token (`S3`) and edition suffixes
// (`Bespoke`, `Shark`) are all single words and never match.
const DESCRIPTOR_SEGMENT = /^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/;

/**
 * "Laser Cannon" / "Ballistic Gatling" — the sub-line under a candidate's name,
 * read out of the class name the same way the reference tools do. Falls back to
 * the entity's own type discriminator ("Gun", "Quantum Drive") when the class
 * name spells nothing out. Never translated: like every catalog value on the
 * page these are engine identifiers rendered readably, not UI copy.
 */
export function swapTypeLabel(
  className: string,
  kind: CodexKind,
  payload: unknown,
): string | null {
  for (const seg of className.split('_')) {
    if (DESCRIPTOR_SEGMENT.test(seg)) return humanizeClassName(seg);
  }
  return equippedTypeLabel({ kind, payload });
}

/** Assemble one table row from a compatibility hit plus its resolved payloads. */
export function buildSwapCandidate(input: SwapCandidateInput): SwapCandidate {
  const stats: Record<string, SwapStatValue> = {};
  for (const st of equippedStats(
    { kind: input.kind, payload: input.payload, ammoPayload: input.ammoPayload },
    Infinity,
  )) {
    stats[st.labelKey] = { value: st.value, format: st.format, derived: st.derived };
  }
  const name = (input.nameLocalized ?? '').trim() || humanizeClassName(input.className);
  return {
    className: input.className,
    kind: input.kind,
    name,
    manufacturerCode: input.manufacturerCode,
    size: input.size,
    grade: input.grade,
    typeLabel: swapTypeLabel(input.className, input.kind, input.payload),
    archetype: swapArchetype(input.className, name, input.subType),
    damageChannels: damageChannelsOf(input.payload, input.ammoPayload),
    stats,
    equipped: input.equipped === true,
  };
}

// ── columns ──────────────────────────────────────────────────────────────────

/** One sortable numeric column of the table. */
export interface SwapColumn {
  /** i18n key under `codex.equipped.*` — also the sort key and the stats key. */
  key: string;
  format: EquippedStatFormat;
  /** At least one candidate's value for this column is a derived number. */
  derived: boolean;
}

/** The sort key of the (non-numeric) NAME column. */
export const NAME_SORT_KEY = 'name';

// Preferred left-to-right order, mirroring the reference screenshot's reading
// order (the decisive offensive numbers first) and then the component stats.
// Anything the extract grows later that is not listed here still shows up — it
// is simply appended in the order the stat pickers emit it.
const COLUMN_ORDER: readonly string[] = [
  'codex.equipped.dps',
  'codex.equipped.alphaDamage',
  'codex.equipped.penetration',
  'codex.equipped.fireRate',
  'codex.equipped.range',
  'codex.equipped.projectileSpeed',
  'codex.equipped.shieldHp',
  'codex.equipped.shieldRegen',
  'codex.equipped.regenDelay',
  'codex.equipped.downedDelay',
  'codex.equipped.jumpRange',
  'codex.equipped.driveSpeed',
  'codex.equipped.spoolTime',
  'codex.equipped.cooldown',
  'codex.equipped.thrust',
  'codex.equipped.fuelCapacity',
  'codex.equipped.fuelRate',
  'codex.equipped.distortion',
  'codex.equipped.health',
];

/**
 * The columns this candidate set can actually fill, in display order. A stat no
 * candidate carries yields NO column — an all-"—" column is noise, and the
 * honest signal ("this extract has no fire rate") belongs in the footer note,
 * not in twelve empty cells. Candidates that lack a column the OTHERS have do
 * render "—" for that cell.
 */
export function swapColumns(candidates: readonly SwapCandidate[]): SwapColumn[] {
  const seen = new Map<string, SwapColumn>();
  for (const c of candidates) {
    for (const [key, v] of Object.entries(c.stats)) {
      const hit = seen.get(key);
      if (hit) {
        hit.derived ||= v.derived === true;
      } else {
        seen.set(key, { key, format: v.format, derived: v.derived === true });
      }
    }
  }
  const ordered: SwapColumn[] = [];
  for (const key of COLUMN_ORDER) {
    const col = seen.get(key);
    if (col) {
      ordered.push(col);
      seen.delete(key);
    }
  }
  return [...ordered, ...seen.values()];
}

/** Rendered cell text for a candidate/column pair — "—" when it has no value. */
export function swapCell(candidate: SwapCandidate, column: SwapColumn): string {
  const v = candidate.stats[column.key];
  if (!v) return '—';
  return formatEquippedStat({ labelKey: column.key, value: v.value, format: v.format });
}

/**
 * Per-candidate bar width (% of the column maximum) for ONE column — the
 * magnitude cue the reference paints onto its DPS column. Only produced when
 * the column has ≥2 values with a real spread; otherwise every entry is null
 * and the UI paints nothing. Keyed by class name.
 */
export function swapColumnBars(
  candidates: readonly SwapCandidate[],
  key: string,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const values = candidates
    .map((c) => c.stats[key]?.value)
    .filter((v): v is number => typeof v === 'number');
  const max = values.length > 0 ? Math.max(...values) : 0;
  const min = values.length > 0 ? Math.min(...values) : 0;
  const spread = values.length >= 2 && max > min && max > 0;
  for (const c of candidates) {
    const v = c.stats[key]?.value;
    out.set(c.className, spread && typeof v === 'number' ? Math.max(0, Math.round((v / max) * 100)) : null);
  }
  return out;
}

// ── sorting ──────────────────────────────────────────────────────────────────

export interface SwapSort {
  key: string;
  dir: 'asc' | 'desc';
}

/** How many sort keys stay useful before the table stops being explainable. */
const MAX_SORTS = 3;

/** A column's natural first direction: names read A→Z, numbers best-first. */
function defaultDir(key: string): 'asc' | 'desc' {
  return key === NAME_SORT_KEY ? 'asc' : 'desc';
}

/**
 * Apply a header click. A plain click replaces the sort (or inverts it when the
 * column already IS the primary); a Ctrl/⌘-click appends the column as a
 * secondary sort, or inverts it when it is already in the chain.
 */
export function toggleSwapSort(
  sorts: readonly SwapSort[],
  key: string,
  additive = false,
): SwapSort[] {
  const flip = (s: SwapSort): SwapSort => ({ key: s.key, dir: s.dir === 'asc' ? 'desc' : 'asc' });
  if (!additive) {
    const primary = sorts[0];
    return primary?.key === key ? [flip(primary), ...sorts.slice(1)] : [{ key, dir: defaultDir(key) }];
  }
  const at = sorts.findIndex((s) => s.key === key);
  if (at >= 0) return sorts.map((s, i) => (i === at ? flip(s) : s));
  return [...sorts, { key, dir: defaultDir(key) }].slice(0, MAX_SORTS);
}

/** The sort a fresh table opens with: the leading column, best value first. */
export function defaultSwapSort(columns: readonly SwapColumn[]): SwapSort[] {
  return columns.length > 0
    ? [{ key: columns[0].key, dir: 'desc' }]
    : [{ key: NAME_SORT_KEY, dir: 'asc' }];
}

/**
 * Sort candidates by the (possibly multi-key) sort chain. Missing values ALWAYS
 * sort last, in both directions — a "—" cell floating to the top of a
 * descending column would read as the best option. Ties fall through to the
 * next key and finally to the name, so the order is deterministic.
 */
export function sortSwapCandidates(
  candidates: readonly SwapCandidate[],
  sorts: readonly SwapSort[],
): SwapCandidate[] {
  const cmp = (a: SwapCandidate, b: SwapCandidate): number => {
    for (const s of sorts) {
      if (s.key === NAME_SORT_KEY) {
        const d = a.name.localeCompare(b.name);
        if (d !== 0) return s.dir === 'asc' ? d : -d;
        continue;
      }
      const av = a.stats[s.key]?.value;
      const bv = b.stats[s.key]?.value;
      if (av == null && bv == null) continue;
      if (av == null) return 1; // no value → last, whatever the direction
      if (bv == null) return -1;
      if (av !== bv) return s.dir === 'asc' ? av - bv : bv - av;
    }
    return a.name.localeCompare(b.name);
  };
  return [...candidates].sort(cmp);
}

// ── filtering ────────────────────────────────────────────────────────────────

export interface SwapFilters {
  /** Free text over name, manufacturer, type label and class name. */
  query: string;
  /** Selected damage channel, or null for "all". */
  damage: string | null;
  /** Selected archetype, or null for "all". */
  type: string | null;
}

export const EMPTY_SWAP_FILTERS: SwapFilters = { query: '', damage: null, type: null };

/** Whether one candidate survives the current filters. */
function matches(c: SwapCandidate, f: SwapFilters): boolean {
  if (f.damage && !c.damageChannels.includes(f.damage)) return false;
  if (f.type && c.archetype !== f.type) return false;
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [c.name, c.manufacturerCode, c.typeLabel, c.className, c.grade]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  // Every whitespace-separated term must appear — "kla repeater" narrows.
  return q.split(/\s+/).every((term) => hay.includes(term));
}

export function filterSwapCandidates(
  candidates: readonly SwapCandidate[],
  filters: SwapFilters,
): SwapCandidate[] {
  return candidates.filter((c) => matches(c, filters));
}

/** One selectable pill in a filter group. */
export interface SwapFacet {
  value: string;
  count: number;
}

/**
 * The distinct values of a facet across the FULL candidate set, most common
 * first. A group with fewer than two distinct values tells the user nothing —
 * the picker hides it rather than offering a filter that cannot narrow.
 */
function facet(values: (string | null)[]): SwapFacet[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size < 2) return [];
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** The two pill groups of the picker, derived from the actual result set. */
export function swapFacets(candidates: readonly SwapCandidate[]): {
  damage: SwapFacet[];
  type: SwapFacet[];
} {
  return {
    // A weapon deals one channel in practice; take the strongest as its facet.
    damage: facet(candidates.map((c) => c.damageChannels[0] ?? null)),
    type: facet(candidates.map((c) => c.archetype)),
  };
}

/** Drop a filter selection that the current facets no longer offer. */
export function pruneSwapFilters(
  filters: SwapFilters,
  facets: { damage: SwapFacet[]; type: SwapFacet[] },
): SwapFilters {
  const keep = (v: string | null, opts: SwapFacet[]): string | null =>
    v && opts.some((o) => o.value === v) ? v : null;
  return {
    query: filters.query,
    damage: keep(filters.damage, facets.damage),
    type: keep(filters.type, facets.type),
  };
}

// ── delta preview baseline ───────────────────────────────────────────────────

/**
 * A candidate's stats as `StatRow`s keyed by their i18n key, so the existing
 * `computeStatDeltas` can join installed against candidate and the UI can
 * translate the resulting `key` back into a label. Values are pre-formatted
 * (with their unit) exactly as the table cells render them.
 */
export function swapStatRows(candidate: SwapCandidate | undefined): StatRow[] {
  if (!candidate) return [];
  return Object.entries(candidate.stats).map(([labelKey, v]) => ({
    key: labelKey,
    value: formatEquippedStat({ labelKey, value: v.value, format: v.format }),
  }));
}
