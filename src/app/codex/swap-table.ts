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
import { findStat, toFiniteNumber } from '../hangar/loadout-stats';
import { resolveResourceState } from './codex-power';
import { RESOURCE_STATS_GROUP, resourceKey } from './codex.types';

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
  /**
   * The port-attach discriminator the item's own payload declares
   * (`AttachDef.Type`, e.g. `WeaponGun`, `MissileLauncher`). `null` when the
   * payload carries none. Restores main's part-type filter (E-main-gap #40)
   * for ports that accept more than one type — missile racks, utility bays.
   */
  attachType?: string | null;
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

// ── picker-only columns (R7) ─────────────────────────────────────────────────
// `SWAP_VALUE_CATALOGUE` advertises Power / Min-Power / EM / IR / Coolant / HP /
// Distortion / Masse columns, but `equippedStats` never produced them — the
// columns existed with no data source and every cell read `noSource`. These
// come out of the same schema-3 `ItemResourceComponentParams` group the energy
// dock reads, plus the two component structs the extract has always carried.
//
// Units, so the column header and the dock agree:
//   power    — SEGMENTS as a decimal. A gun that draws 1.0 standard units is
//              0.75 of a segment (4 standard units = 3 segments, the ratio the
//              reactor's own conversion uses), a cooler that draws 3 whole
//              segments is 3. `dec`, lower is better.
//   minPower — `minimumConsumptionFraction`, 0..1, verbatim.
//   em / ir  — nominal signature of the resolved state.
//   coolant  — SRU/s CONSUMED (a cooler's output is not a picker column).
//   hp       — `SHealthComponentParams.Health`.
//   distortion — `SDistortionParams.Maximum` (the pool, matching the summary).
//   mass     — whatever the payload carries as its mass, in kg.

/** Standard resource units per whole power segment (see `power` above). */
export const STANDARD_UNITS_PER_SEGMENT = 4 / 3;

function statsRecord(payload: unknown): Record<string, Record<string, unknown>> | undefined {
  const s = (payload as { stats?: unknown } | null | undefined)?.stats;
  return s && typeof s === 'object' ? (s as Record<string, Record<string, unknown>>) : undefined;
}

function massOf(payload: unknown): number | null {
  const p = payload as { mass?: unknown } | null | undefined;
  const direct = toFiniteNumber(p?.mass ?? null);
  if (direct !== null) return direct;
  // weapons carry it as `SEntityPhysicsControllerParams.PhysType.Mass`
  return findStat(statsRecord(payload), null, ['PhysType.Mass', 'mass', 'Mass']);
}

/**
 * The picker's resource/component columns for ONE payload. Pure: the component
 * only forwards the payload it already resolved. Every value is `null` when the
 * extract does not carry it — a `null` never becomes a 0.
 */
export function swapResourceStats(payload: unknown): Record<string, SwapStatValue> {
  const out: Record<string, SwapStatValue> = {};
  const stats = statsRecord(payload);
  const state = resolveResourceState(payload);
  const put = (key: string, value: number | null, format: EquippedStatFormat, derived = false): void => {
    if (value === null) return;
    out[key] = derived ? { value, format, derived: true } : { value, format };
  };
  const res = (field: string): number | null =>
    state === null ? null : findStat(stats, RESOURCE_STATS_GROUP, [resourceKey(field, state)]);

  const segments = res('power.consumeSegments');
  const units = res('power.consumeUnits');
  if (segments !== null || units !== null) {
    const total = (segments ?? 0) + (units ?? 0) / STANDARD_UNITS_PER_SEGMENT;
    // derived: standard units were converted into segments to make the column
    // comparable across a gun and a cooler.
    put('codex.picker.col.power', Math.round(total * 100) / 100, 'dec', units !== null && units > 0);
  }
  put('codex.picker.col.minPower', res('power.minFraction'), 'dec');
  put('codex.picker.col.em', res('em.nominal'), 'int');
  put('codex.picker.col.ir', res('ir.nominal'), 'int');
  put('codex.picker.col.coolant', res('coolant.consume'), 'perSec');
  // HP and Distortion are catalogued under the shared `codex.equipped.*` keys
  // (the picker reuses the equipped-stat vocabulary for both).
  put('codex.equipped.health', findStat(stats, 'SHealthComponentParams', ['Health']), 'int');
  put(
    'codex.equipped.distortion',
    findStat(stats, 'SDistortionParams', ['Maximum', 'MaximumDistortion']),
    'int',
  );
  put('codex.picker.col.mass', massOf(payload), 'int');
  return out;
}

/** Aimable (gimbal/turret) columns — the picker's `aimYaw` / `aimRate`. */
export function swapAimStats(payload: unknown): Record<string, SwapStatValue> {
  const out: Record<string, SwapStatValue> = {};
  const stats = statsRecord(payload);
  const yaw = findStat(stats, null, ['aimYawRange', 'yawRange', 'maxYaw']);
  const rate = findStat(stats, null, ['aimRate', 'rotationRate', 'turnRate', 'aimSpeed']);
  if (yaw !== null) out['codex.picker.col.aimYaw'] = { value: yaw, format: 'dec' };
  if (rate !== null) out['codex.picker.col.aimRate'] = { value: rate, format: 'dec' };
  return out;
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
  // R7 — the picker-only columns the value catalogue advertises. `equippedStats`
  // wins where both have a value: it reads the curated, sometimes derived
  // number, these are the raw component fields behind it.
  for (const [k, v] of Object.entries({
    ...swapResourceStats(input.payload),
    ...swapAimStats(input.payload),
  })) {
    if (stats[k] === undefined) stats[k] = v;
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
    attachType: (input.payload as { attachType?: string | null } | null | undefined)?.attachType ?? null,
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
  const direct = DIRECT_FIELD[column.key];
  if (direct) {
    const dv = direct(candidate);
    return dv === null ? '—' : String(dv);
  }
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

// ═══════════════════════════════════════════════════════════════════════════
// Redesigned picker model (MASTER §9, iteration 7 `#g3` + values `#h3`).
// Everything below is ADDITIVE — the helpers above keep their behaviour and
// their specs. New concepts: a Δ baseline switch, a three-stage comparison
// scope, the full value catalogue with a column chooser, and per-value bars.
// ═══════════════════════════════════════════════════════════════════════════

/** `Δ gegen`: measure against the component currently fitted, or the factory one. */
export type SwapBaseline = 'fitted' | 'factory';

export interface SwapBaselineInput {
  /** class name of the component on the port right now (the draft). */
  fittedClassName: string | null;
  /** class name the ship ships with from the factory (the stock loadout). */
  factoryClassName: string | null;
}

/** Which row carries the `±0` under the active baseline (B-C14). */
export function baselineClassName(baseline: SwapBaseline, input: SwapBaselineInput): string | null {
  return baseline === 'factory' ? input.factoryClassName : input.fittedClassName;
}

/**
 * The Δ column for one value key. The baseline row gets a literal `0` (rendered
 * `±0`), every other row `value − baselineValue`. `null` when either side has no
 * value — a delta against a gap would be a fabricated number.
 */
export function swapDeltaColumn(
  candidates: readonly SwapCandidate[],
  key: string,
  baseline: string | null,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const base = candidates.find((c) => c.className === baseline)?.stats[key]?.value ?? null;
  for (const c of candidates) {
    const v = c.stats[key]?.value ?? null;
    out.set(c.className, base === null || v === null ? null : Math.round((v - base) * 100) / 100);
  }
  return out;
}

/**
 * Damage channel id → the localized word for it (B-C13). Reuses the weapon
 * detail window's row labels rather than inventing a second vocabulary for
 * the same six channels.
 */
export const DAMAGE_FAMILY_LABEL_KEY: Record<string, string> = {
  physical: 'codex.weaponDetail.row.physical',
  energy: 'codex.weaponDetail.row.energy',
  distortion: 'codex.weaponDetail.row.distortion',
  thermal: 'codex.weaponDetail.row.thermal',
  biochemical: 'codex.weaponDetail.row.biochemical',
  stun: 'codex.weaponDetail.row.stun',
};

/** `Vergleichen mit`, three stages (B-C13 / MASTER §9). */
export type SwapScope = 'sameClass' | 'sameFamily' | 'allSize';

export interface SwapScopeOption {
  scope: SwapScope;
  labelKey: string;
  /** interpolation params: `{class}` for sameClass, `{damage}` / `{size}`. */
  params: Record<string, string | number>;
  /** how many candidates this stage would show. */
  count: number;
  /** false when the fitted component carries no archetype / damage family. */
  available: boolean;
}

function scopePredicate(scope: SwapScope, fitted: SwapCandidate | undefined) {
  return (c: SwapCandidate): boolean => {
    if (scope === 'allSize') return true;
    if (!fitted) return true;
    if (scope === 'sameClass') return fitted.archetype != null && c.archetype === fitted.archetype;
    const family = fitted.damageChannels[0] ?? null;
    return family != null && c.damageChannels.includes(family);
  };
}

export function applySwapScope(
  candidates: readonly SwapCandidate[],
  fitted: SwapCandidate | undefined,
  scope: SwapScope,
): SwapCandidate[] {
  return candidates.filter(scopePredicate(scope, fitted));
}

/** The three segmented buttons with their live counts (`12 von 28`). */
export function swapScopeOptions(
  candidates: readonly SwapCandidate[],
  fitted: SwapCandidate | undefined,
): SwapScopeOption[] {
  const size = fitted?.size ?? null;
  const family = fitted?.damageChannels[0] ?? null;
  const stages: Omit<SwapScopeOption, 'count'>[] = [
    {
      scope: 'sameClass' as const,
      labelKey: 'codex.picker.scope.sameClass',
      params: { class: fitted?.archetype ?? fitted?.typeLabel ?? '' },
      available: !!fitted?.archetype,
    },
    {
      scope: 'sameFamily' as const,
      labelKey: 'codex.picker.scope.sameFamily',
      params: { family: family ?? '' },
      available: !!family,
    },
    {
      scope: 'allSize' as const,
      labelKey: 'codex.picker.scope.sameSize',
      params: { size: size ?? '' },
      available: true,
    },
  ];
  return stages.map((o) => ({ ...o, count: applySwapScope(candidates, fitted, o.scope).length }));
}

// ── the value catalogue (MASTER §9: ~30 values, 17 shown by default) ─────────

export interface SwapValueDef {
  /** i18n key — doubles as the stats key and the sort key. */
  key: string;
  format: EquippedStatFormat;
  /** a smaller number is the better outcome (mass, spread, power draw, EM). */
  lowerIsBetter: boolean;
  /** part of the 17-column default set. */
  byDefault: boolean;
  /** categorical columns are filtered by checkbox facet, not by range. */
  categorical?: boolean;
}

const V = (
  key: string,
  format: EquippedStatFormat,
  byDefault: boolean,
  lowerIsBetter = false,
  categorical = false,
): SwapValueDef => ({ key, format, lowerIsBetter, byDefault, categorical });

/**
 * Every value the picker can show, in the concept's left-to-right order. The
 * 17 flagged `byDefault` are exactly the `#g3` column set:
 * Bauteil · Δ Dauer · DPS · Alpha · PEN · Schussrate · Reichweite · Speed ·
 * Power · EM · HP · Distortion · Masse · Grade · Hersteller · Ammo · Spread.
 */
export const SWAP_VALUE_CATALOGUE: readonly SwapValueDef[] = [
  V(NAME_SORT_KEY, 'int', true, false, true), // Bauteil (the sticky first column)
  V('codex.picker.col.deltaSustained', 'dec', true),
  V('codex.equipped.dps', 'perSec', true),
  V('codex.equipped.alphaDamage', 'dec', true),
  V('codex.equipped.penetration', 'dec', true),
  V('codex.equipped.fireRate', 'dec', true),
  V('codex.equipped.range', 'int', true),
  V('codex.equipped.projectileSpeed', 'mps', true),
  V('codex.picker.col.power', 'dec', true, true),
  V('codex.picker.col.em', 'int', true, true),
  V('codex.equipped.health', 'int', true),
  V('codex.equipped.distortion', 'int', true),
  V('codex.picker.col.mass', 'int', true, true),
  V('codex.picker.col.grade', 'int', true, false, true),
  V('codex.picker.col.manufacturer', 'int', true, false, true),
  V('codex.picker.col.ammo', 'int', true),
  V('codex.picker.col.spread', 'dec', true, true),
  // ── beyond the default 17 (column chooser only) ──
  V('codex.picker.col.size', 'int', false, false, true),
  V('codex.picker.col.damageType', 'int', false, false, true),
  V('codex.picker.col.archetype', 'int', false, false, true),
  V('codex.equipped.burstDps', 'perSec', false),
  V('codex.picker.col.projectilesPerShot', 'int', false),
  V('codex.picker.col.lifetime', 'seconds', false),
  V('codex.picker.col.heat', 'dec', false, true),
  V('codex.picker.col.ir', 'int', false, true),
  V('codex.picker.col.minPower', 'dec', false, true),
  V('codex.picker.col.coolant', 'perSec', false, true),
  V('codex.equipped.shieldHp', 'int', false),
  V('codex.equipped.shieldRegen', 'perSec', false),
  V('codex.equipped.regenDelay', 'seconds', false, true),
  V('codex.equipped.downedDelay', 'seconds', false, true),
  V('codex.equipped.jumpRange', 'gm', false),
  V('codex.equipped.driveSpeed', 'kms', false),
  V('codex.equipped.spoolTime', 'seconds', false, true),
  V('codex.equipped.cooldown', 'seconds', false, true),
  V('codex.equipped.thrust', 'int', false),
  V('codex.equipped.fuelCapacity', 'int', false),
  V('codex.equipped.fuelRate', 'perSec', false, true),
];

/** The 17 columns the picker opens with. */
export const DEFAULT_SWAP_COLUMNS: readonly string[] = SWAP_VALUE_CATALOGUE.filter(
  (v) => v.byDefault,
).map((v) => v.key);

const CATALOGUE_BY_KEY = new Map(SWAP_VALUE_CATALOGUE.map((v) => [v.key, v]));

export function swapValueDef(key: string): SwapValueDef | undefined {
  return CATALOGUE_BY_KEY.get(key);
}

/** `Spalten ▾` state — a chosen key set, kept in catalogue order on read. */
export interface SwapColumnChooser {
  visible: readonly string[];
}

export const DEFAULT_SWAP_COLUMN_CHOOSER: SwapColumnChooser = { visible: DEFAULT_SWAP_COLUMNS };

export function toggleSwapColumn(state: SwapColumnChooser, key: string): SwapColumnChooser {
  // The name column is the row's identity — it cannot be switched off.
  if (key === NAME_SORT_KEY) return state;
  const next = new Set(state.visible);
  if (!next.delete(key)) next.add(key);
  return { visible: SWAP_VALUE_CATALOGUE.filter((v) => next.has(v.key)).map((v) => v.key) };
}

export function resetSwapColumns(): SwapColumnChooser {
  return DEFAULT_SWAP_COLUMN_CHOOSER;
}

/**
 * Why a cell is empty (MASTER §9 / B-C16):
 *   `value`         — it has a number;
 *   `notApplicable` — the concept exists but is genuinely zero/absent for this
 *                     class (Ammo on an energy weapon, Spread on a repeater) →
 *                     render `—` with the explanatory note;
 *   `noSource`      — the extractor has no source for this value at all → the
 *                     column is omitted and named in the footer.
 */
export type SwapCellState = 'value' | 'notApplicable' | 'noSource';

/** Values that do not apply to an energy weapon (they are ballistic concepts). */
const ENERGY_NOT_APPLICABLE = new Set(['codex.picker.col.ammo']);
/** Values the P4K carries only as a modifier, never as a per-weapon number. */
const ALWAYS_NOT_APPLICABLE = new Set(['codex.picker.col.spread']);

function isEnergyWeapon(c: SwapCandidate): boolean {
  return c.damageChannels.length > 0 && c.damageChannels.every((d) => /energy|laser/i.test(d));
}

/**
 * Columns the picker reads straight off a `SwapCandidate` field instead of
 * `.stats` (mirrored by `DIRECT_ACCESSORS` in codex-swap-picker.component.ts —
 * kept here too so `swapCellState`/`swapMissingSourceColumns` know these are
 * never "no source": a `null` grade/manufacturer/etc. is a real per-item gap,
 * not a missing extractor).
 */
const DIRECT_FIELD: Readonly<Record<string, (c: SwapCandidate) => string | number | null>> = {
  [NAME_SORT_KEY]: (c) => c.name,
  'codex.picker.col.grade': (c) => c.grade,
  'codex.picker.col.manufacturer': (c) => c.manufacturerCode,
  'codex.picker.col.damageType': (c) => c.damageChannels[0] ?? null,
  'codex.picker.col.archetype': (c) => c.archetype,
  'codex.picker.col.size': (c) => c.size,
};

export function swapCellState(candidate: SwapCandidate, key: string): SwapCellState {
  const direct = DIRECT_FIELD[key];
  if (direct) return direct(candidate) !== null ? 'value' : 'noSource';
  if (candidate.stats[key] !== undefined) return 'value';
  if (ALWAYS_NOT_APPLICABLE.has(key)) return 'notApplicable';
  if (ENERGY_NOT_APPLICABLE.has(key) && isEnergyWeapon(candidate)) return 'notApplicable';
  return 'noSource';
}

/** Column keys no candidate can fill for any reason other than "not applicable"
 * — the footer's `Nicht in den Spieldateien: …` list. */
export function swapMissingSourceColumns(
  candidates: readonly SwapCandidate[],
  visible: readonly string[],
): string[] {
  return visible.filter(
    (key) =>
      key !== NAME_SORT_KEY &&
      candidates.length > 0 &&
      candidates.every((c) => swapCellState(c, key) === 'noSource'),
  );
}

export interface SwapValueBar {
  /** 0..100 against the best value in the FILTERED set; null = no comparison. */
  percent: number | null;
  /** this row holds the optimum of the UNFILTERED set — the gold mark. */
  optimum: boolean;
}

/**
 * Per-value bars (MASTER §9 / It. 3 `#t4`): the bar is relative to the best
 * value among the rows currently shown, while the gold mark sits on the overall
 * optimum across every candidate — so narrowing the scope never hides the fact
 * that something better exists.
 */
export function swapValueBars(
  filtered: readonly SwapCandidate[],
  all: readonly SwapCandidate[],
  key: string,
): Map<string, SwapValueBar> {
  const def = swapValueDef(key);
  const lower = def?.lowerIsBetter === true;
  const values = filtered
    .map((c) => c.stats[key]?.value)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const allValues = all
    .map((c) => c.stats[key]?.value)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const best = values.length > 0 ? (lower ? Math.min(...values) : Math.max(...values)) : null;
  const worst = values.length > 0 ? (lower ? Math.max(...values) : Math.min(...values)) : null;
  const overall = allValues.length > 0 ? (lower ? Math.min(...allValues) : Math.max(...allValues)) : null;
  const spread = values.length >= 2 && best !== null && worst !== null && best !== worst;
  const out = new Map<string, SwapValueBar>();
  for (const c of filtered) {
    const v = c.stats[key]?.value;
    let percent: number | null = null;
    if (spread && typeof v === 'number' && v > 0 && best !== null) {
      percent = lower
        ? Math.max(0, Math.round((best / v) * 100))
        : Math.max(0, Math.round((v / best) * 100));
    }
    out.set(c.className, { percent, optimum: overall !== null && v === overall });
  }
  return out;
}
