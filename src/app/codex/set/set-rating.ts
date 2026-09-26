// "Einordnung" (percentile rating) + "Einsatz" (lens) for an on-foot armour
// SET on the codex set page — mirrors the ship page's rank card (codex-rank.ts)
// for a fundamentally different cohort shape: a ship's KPIs come from ONE
// stock loadout, an armour set's come from up to six independently-ranked
// PARTS (helmet/core/arms/legs/undersuit/backpack), each already percentiled
// against its own slot cohort server-side (`codex_armor_rating`, migration
// 20260926140000_codex_armor_rating.sql). This module is PURE: it never talks
// to Supabase, it only turns `ArmorRatingRow[]` (what codex.service.ts
// `armorRating()` returns) into the card's axes and the lens strip's values.
//
// Philosophy carried over from codex-rank.ts: "Beschreiben, nicht vorschreiben"
// — a percentile is a POSITION, not a score, and a missing value is a GAP, not
// a 0. Two axes have NO data at all in our extract (stealth: no EM/IR
// signature; activeScan/EVA: no such stats) — they stay permanent gaps.
//
// "Weakest link" axes (heat/cold): a set's cold resistance is only as good as
// its worst part — wearing a +115 °C core over a +40 °C undersuit does not
// make the SET good in heat, the undersuit still cooks first. So unlike the
// mean-of-parts axes, heat/cold read the single limiting part's raw value and
// percentile, and flag which part that is when it trails the rest by a wide
// margin (≥10 °C — a small spread is normal manufacturing variance, not a
// bottleneck worth calling out).

import { formatNumber } from '../codex-format';

// ── shared armour rating shape (mirrors codex.service.ts ArmorRatingRow) ────

export type ArmorSlot = 'helmet' | 'core' | 'arms' | 'legs' | 'undersuit' | 'backpack';

export interface ArmorRatingValues {
  damageReduction: number | null;
  tempMin: number | null;
  tempMax: number | null;
  radCapacity: number | null;
  radRate: number | null;
  gForce: number | null;
  mass: number | null;
  carryMicroScu: number | null;
}

export interface ArmorRatingPct {
  protection: number | null;
  mobility: number | null;
  gForce: number | null;
  heat: number | null;
  cold: number | null;
  radiation: number | null;
  scrub: number | null;
  carry: number | null;
}

export interface ArmorRatingRow {
  className: string;
  slot: ArmorSlot;
  itemType: string | null;
  values: ArmorRatingValues;
  pct: ArmorRatingPct;
}

const ATTACH_TYPE_SLOT: Readonly<Record<string, ArmorSlot>> = {
  Char_Armor_Helmet: 'helmet',
  Char_Armor_Torso: 'core',
  Char_Armor_Arms: 'arms',
  Char_Armor_Legs: 'legs',
  Char_Armor_Undersuit: 'undersuit',
  Char_Armor_Backpack: 'backpack',
};

export function armorSlotFromAttachType(attachType: string | null | undefined): ArmorSlot | null {
  if (!attachType) return null;
  return ATTACH_TYPE_SLOT[attachType] ?? null;
}

// ── rating card ──────────────────────────────────────────────────────────────

export type SetRankProfileId = 'cig' | 'env';

export interface SetRankAxis {
  key: string;
  labelKey: string;
  /** 0..100, null when the axis is a gap. */
  percentile: number | null;
  /** the human-readable figure for this axis, or null when there is nothing to show. */
  value: string | null;
  gap: boolean;
  gapReasonKey: string | null;
  /** true when the bar should paint as a weakness — either a low percentile,
   * or (heat/cold only) a single part dragging the whole set down. */
  weak: boolean;
  /** heat/cold only: the className of the part that limits the axis, when one
   * part trails the rest by ≥10 °C. Null otherwise. */
  limitedBy: string | null;
}

export interface SetRankResult {
  profile: SetRankProfileId;
  axes: SetRankAxis[];
  overall: number | null;
  bandKey: string | null;
  cohortKey: string;
  noteKey: string | null;
  noteParams: Record<string, string>;
}

export const SET_RANK_PROFILES: readonly { id: SetRankProfileId; labelKey: string }[] = [
  { id: 'cig', labelKey: 'codex.setRank.profile.cig' },
  { id: 'env', labelKey: 'codex.setRank.profile.env' },
];

const GAP_REASON_KEY = 'codex.setRank.gap.noData';
/** Below this percentile a bar paints as a weakness — same threshold codex-rank uses. */
const WEAK_THRESHOLD = 45;
/** A part's temp reading counts as "limiting" once it trails the rest by this much. */
const WEAKEST_LINK_SPREAD = 10;

function axisLabelKey(key: string): string {
  return `codex.setRank.axis.${key}`;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function meanPct(rows: readonly ArmorRatingRow[], key: keyof ArmorRatingPct): number | null {
  const values = rows.map((r) => r.pct[key]).filter((v): v is number => v != null);
  const m = mean(values);
  return m == null ? null : Math.round(m * 10) / 10;
}

function formatPercent(v: number, lang: string, decimals = 0): string {
  return `${formatNumber(v, lang, decimals)} %`;
}

function formatSignedPercent(fraction: number, lang: string): string {
  const sign = fraction < 0 ? '-' : '+';
  return `${sign}${formatNumber(Math.abs(fraction) * 100, lang, 0)} %`;
}

function formatTemp(v: number, lang: string): string {
  return `${formatNumber(v, lang, 0)} °C`;
}

function formatCarry(microScu: number, lang: string): string {
  return microScu >= 1000 ? `${formatNumber(microScu / 1000, lang, 1)}K µSCU` : `${formatNumber(microScu, lang, 1)} µSCU`;
}

function sumOf<T extends keyof ArmorRatingValues>(
  rows: readonly ArmorRatingRow[],
  key: T,
): number | null {
  const values = rows.map((r) => r.values[key]).filter((v): v is number => v != null);
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0);
}

function minOf<T extends keyof ArmorRatingValues>(
  rows: readonly ArmorRatingRow[],
  key: T,
): number | null {
  const values = rows.map((r) => r.values[key]).filter((v): v is number => v != null);
  return values.length === 0 ? null : Math.min(...values);
}

/** The core's weight-class word ("Heavy" out of "Heavy Armor"), or the raw
 * item type when it does not follow that "<class> Armor" shape. Null when the
 * set carries no core or the core's item type is unknown (a text-only gap —
 * the mobility axis itself may still rank on mass alone). */
function coreWeightClass(rows: readonly ArmorRatingRow[]): string | null {
  const core = rows.find((r) => r.slot === 'core');
  const itemType = core?.itemType ?? null;
  if (!itemType) return null;
  const m = /^(.*)\s+Armor$/i.exec(itemType.trim());
  return m ? m[1] : itemType;
}

interface WeakestLink {
  row: ArmorRatingRow;
  value: number;
  weak: boolean;
}

/** The part that decides the set's heat ceiling: the LOWEST temp_max (a
 * hotter environment cooks that part first regardless of the others). */
function heatWeakestLink(rows: readonly ArmorRatingRow[]): WeakestLink | null {
  const withTemp = rows.filter((r) => r.values.tempMax != null) as (ArmorRatingRow & {
    values: { tempMax: number };
  })[];
  if (withTemp.length === 0) return null;
  const values = withTemp.map((r) => r.values.tempMax);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const row = withTemp.find((r) => r.values.tempMax === min)!;
  return { row, value: min, weak: withTemp.length > 1 && max - min >= WEAKEST_LINK_SPREAD };
}

/** The part that decides the set's cold ceiling: the HIGHEST (least negative)
 * temp_min — the first part that stops protecting as it gets colder. */
function coldWeakestLink(rows: readonly ArmorRatingRow[]): WeakestLink | null {
  const withTemp = rows.filter((r) => r.values.tempMin != null) as (ArmorRatingRow & {
    values: { tempMin: number };
  })[];
  if (withTemp.length === 0) return null;
  const values = withTemp.map((r) => r.values.tempMin);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const row = withTemp.find((r) => r.values.tempMin === max)!;
  return { row, value: max, weak: withTemp.length > 1 && max - min >= WEAKEST_LINK_SPREAD };
}

function gapAxis(key: string): SetRankAxis {
  return {
    key,
    labelKey: axisLabelKey(key),
    percentile: null,
    value: null,
    gap: true,
    gapReasonKey: GAP_REASON_KEY,
    weak: false,
    limitedBy: null,
  };
}

function dataAxis(key: string, percentile: number | null, value: string | null): SetRankAxis {
  return {
    key,
    labelKey: axisLabelKey(key),
    percentile,
    value,
    gap: percentile == null,
    gapReasonKey: percentile == null ? GAP_REASON_KEY : null,
    weak: percentile != null && percentile < WEAK_THRESHOLD,
    limitedBy: null,
  };
}

function cigProfileAxes(rows: readonly ArmorRatingRow[], lang: string): SetRankAxis[] {
  const protectionPct = meanPct(rows, 'protection');
  const highestDr = rows.map((r) => r.values.damageReduction).filter((v): v is number => v != null);
  const protection = dataAxis(
    'protection',
    protectionPct,
    highestDr.length ? formatPercent(Math.max(...highestDr), lang) : null,
  );

  const mobilityPct = meanPct(rows, 'mobility');
  const weightClass = coreWeightClass(rows);
  const mobility = dataAxis('mobility', mobilityPct, weightClass);

  const gForcePct = meanPct(rows, 'gForce');
  const gForceSum = sumOf(rows, 'gForce');
  const gForce = dataAxis('gForce', gForcePct, gForceSum == null ? null : formatSignedPercent(gForceSum, lang));

  return [protection, mobility, gapAxis('stealth'), gapAxis('activeScan'), gForce, gapAxis('eva')];
}

function envProfileAxes(rows: readonly ArmorRatingRow[], lang: string): SetRankAxis[] {
  const heatLink = heatWeakestLink(rows);
  const heat: SetRankAxis = heatLink
    ? {
        key: 'heat',
        labelKey: axisLabelKey('heat'),
        percentile: heatLink.row.pct.heat,
        value: formatTemp(heatLink.value, lang),
        gap: heatLink.row.pct.heat == null,
        gapReasonKey: heatLink.row.pct.heat == null ? GAP_REASON_KEY : null,
        weak: heatLink.weak,
        limitedBy: heatLink.weak ? heatLink.row.className : null,
      }
    : gapAxis('heat');

  const coldLink = coldWeakestLink(rows);
  const cold: SetRankAxis = coldLink
    ? {
        key: 'cold',
        labelKey: axisLabelKey('cold'),
        percentile: coldLink.row.pct.cold,
        value: formatTemp(coldLink.value, lang),
        gap: coldLink.row.pct.cold == null,
        gapReasonKey: coldLink.row.pct.cold == null ? GAP_REASON_KEY : null,
        weak: coldLink.weak,
        limitedBy: coldLink.weak ? coldLink.row.className : null,
      }
    : gapAxis('cold');

  const radiationPct = meanPct(rows, 'radiation');
  const radSum = sumOf(rows, 'radCapacity');
  const radiation = dataAxis('radiation', radiationPct, radSum == null ? null : `${formatNumber(radSum, lang, 0)} REM`);

  const scrubPct = meanPct(rows, 'scrub');
  const scrubMin = minOf(rows, 'radRate');
  const scrub = dataAxis('scrub', scrubPct, scrubMin == null ? null : `${formatNumber(scrubMin, lang, 1)} REM/s`);

  const carryPct = meanPct(rows, 'carry');
  const carrySum = sumOf(rows, 'carryMicroScu');
  const carry = dataAxis('carry', carryPct, carrySum == null ? null : formatCarry(carrySum, lang));

  return [heat, cold, radiation, scrub, carry];
}

function limitingNoteParams(axes: readonly SetRankAxis[]): { item: string; range: string } | null {
  const limiting = axes.find((a) => a.limitedBy != null);
  if (!limiting) return null;
  return { item: limiting.limitedBy!, range: limiting.value ?? '' };
}

/**
 * The set's percentile rating for one profile — 'cig' (the CitizenCon 2954
 * grid: Schutz/Mobilität/Tarnung/Aktiv-Scan/G-Kraft/EVA) or 'env' (Umwelt &
 * Traglast: Hitze/Kälte/Strahlung/Abbau/Traglast). `rows` is every armour
 * part the player has worn on this set, already percentiled against its own
 * slot cohort by `codex_armor_rating` — this function never re-ranks, it only
 * aggregates parts into axes.
 */
export function rankSet(rows: readonly ArmorRatingRow[], profile: SetRankProfileId, lang: string): SetRankResult {
  const axes = profile === 'cig' ? cigProfileAxes(rows, lang) : envProfileAxes(rows, lang);
  const ranked = axes.map((a) => a.percentile).filter((p): p is number => p != null);
  const overall = ranked.length > 0 ? Math.round(ranked.reduce((s, p) => s + p, 0) / ranked.length) : null;
  const bandKey = overall == null ? null : overall < 25 ? 'codex.rank.band.low' : overall > 75 ? 'codex.rank.band.high' : 'codex.rank.band.mid';

  const noteParams = limitingNoteParams(axes);

  return {
    profile,
    axes,
    overall,
    bandKey,
    cohortKey: 'codex.setRank.cohort',
    noteKey: noteParams ? 'codex.setRank.note.limited' : null,
    noteParams: noteParams ?? {},
  };
}

// ── lens strip ("Einsatz") ───────────────────────────────────────────────────

export type SetLensId = 'all' | 'combat' | 'stealth' | 'pilot' | 'env' | 'transport' | 'eva' | 'scan';

export interface SetLensDef {
  id: SetLensId;
  labelKey: string;
  iconGlyph: string;
  tipKey: string;
  disabled: boolean;
  disabledReasonKey: string | null;
}

const NO_SIGNATURE_KEY = 'codex.setLens.disabled.noSignature';
const NO_DATA_KEY = 'codex.setLens.disabled.noData';

export const SET_LENSES: readonly SetLensDef[] = [
  { id: 'all', labelKey: 'codex.setLens.all', iconGlyph: '✱', tipKey: 'codex.setLens.tip.all', disabled: false, disabledReasonKey: null },
  { id: 'combat', labelKey: 'codex.setLens.combat', iconGlyph: '⚔', tipKey: 'codex.setLens.tip.combat', disabled: false, disabledReasonKey: null },
  { id: 'stealth', labelKey: 'codex.setLens.stealth', iconGlyph: '◑', tipKey: 'codex.setLens.tip.stealth', disabled: true, disabledReasonKey: NO_SIGNATURE_KEY },
  { id: 'pilot', labelKey: 'codex.setLens.pilot', iconGlyph: '✈', tipKey: 'codex.setLens.tip.pilot', disabled: false, disabledReasonKey: null },
  { id: 'env', labelKey: 'codex.setLens.env', iconGlyph: '☀', tipKey: 'codex.setLens.tip.env', disabled: false, disabledReasonKey: null },
  { id: 'transport', labelKey: 'codex.setLens.transport', iconGlyph: '▤', tipKey: 'codex.setLens.tip.transport', disabled: false, disabledReasonKey: null },
  { id: 'eva', labelKey: 'codex.setLens.eva', iconGlyph: '◌', tipKey: 'codex.setLens.tip.eva', disabled: true, disabledReasonKey: NO_DATA_KEY },
  { id: 'scan', labelKey: 'codex.setLens.scan', iconGlyph: '⌖', tipKey: 'codex.setLens.tip.scan', disabled: true, disabledReasonKey: NO_DATA_KEY },
];

/**
 * The lens strip's per-part readout: what a chosen "Einsatz" (combat/pilot/
 * env/transport) shows for ONE armour part. `rows` is the whole set, needed
 * only so env can tell whether `row` is the part limiting heat/cold (same
 * weakest-link rule as {@link rankSet}'s env profile). All/disabled lenses
 * and a part missing the relevant data return null — a lens never invents a
 * number, it either has one or stays quiet.
 */
export function lensValueFor(
  row: ArmorRatingRow | undefined,
  lens: SetLensId,
  rows: readonly ArmorRatingRow[],
  lang: string,
): { text: string; warn: boolean } | null {
  if (!row) return null;
  switch (lens) {
    case 'combat': {
      const dr = row.values.damageReduction;
      if (dr == null) return null;
      const text = row.itemType ? `${formatPercent(dr, lang)} · ${row.itemType}` : formatPercent(dr, lang);
      return { text, warn: false };
    }
    case 'pilot': {
      const g = row.values.gForce;
      if (g == null) return null;
      return { text: formatSignedPercent(g, lang), warn: false };
    }
    case 'env': {
      const { tempMin, tempMax, radCapacity } = row.values;
      if (tempMin == null && tempMax == null && radCapacity == null) return null;
      const parts: string[] = [];
      if (tempMin != null || tempMax != null) {
        parts.push(`${tempMin != null ? formatNumber(tempMin, lang, 0) : '—'} / ${tempMax != null ? formatNumber(tempMax, lang, 0) : '—'} °C`);
      }
      if (radCapacity != null) parts.push(`${formatNumber(radCapacity, lang, 0)} REM`);
      const heatLink = heatWeakestLink(rows);
      const coldLink = coldWeakestLink(rows);
      const warn = (!!heatLink?.weak && heatLink.row.className === row.className) || (!!coldLink?.weak && coldLink.row.className === row.className);
      return { text: parts.join(' · '), warn };
    }
    case 'transport': {
      const carry = row.values.carryMicroScu;
      if (carry == null) return null;
      return { text: formatCarry(carry, lang), warn: false };
    }
    default:
      return null;
  }
}

/** The set page's per-set localStorage key for the last chosen lens — one key
 * per set id so switching sets does not carry a stale lens over. */
export function setLensStorageKey(setId: string): string {
  return `sc.codex.setLens.${setId}`;
}
