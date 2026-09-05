// "Einordnung" — percentile ranking of one ship inside a cohort (MASTER §3).
// -----------------------------------------------------------------------------
// PURE DOMAIN MODULE. The page computes every cohort ship's `KpiSheet` from its
// STOCK loadout with the existing `computeKpiSheet`, hands the array in here and
// gets back per-axis percentiles, the median polygon and a verdict band.
//
// Philosophy (concept wording): "Beschreiben, nicht vorschreiben" — a percentile
// is a POSITION in a field, not a score. A ship that lacks a value on an axis is
// excluded from that axis (it does not count as 0), and the axis renders a gap.
//
// Percentile definition (documented once, used everywhere):
//   pct(v) = ( |{c : c worse than v}| + 0.5 · |{c : c == v}| ) / n · 100
// where "worse" is `<` for higher-is-better axes and `>` for lower-is-better
// ones. The mid-rank half-credit is what keeps a field of identical ships at
// 50 % instead of 0 % or 100 %. The target itself IS part of its cohort.

import type { KpiKey } from './codex-mission';
import type { KpiSheet } from './codex-loadout-stats';

export type RankProfileId = 'combat' | 'defence' | 'transport';
export type RankScope = 'sizeClass' | 'all' | 'career';

export interface RankAxis {
  key: KpiKey;
  labelKey: string;
  /** IR/EM/cross-section/mass: a smaller number ranks HIGHER. */
  lowerIsBetter: boolean;
}

export interface RankProfile {
  id: RankProfileId;
  labelKey: string;
  axes: readonly RankAxis[];
}

// The designer authored the axis labels under short slugs, not under the raw
// KpiKey — `armorHp` is `codex.rank.axis.armor` (R4). Anything not listed here
// uses its KpiKey verbatim, which is what the other twelve axes are named.
const AXIS_LABEL_SLUG: Readonly<Partial<Record<KpiKey, string>>> = {
  armorHp: 'armor',
};

export function rankAxisLabelKey(key: KpiKey): string {
  return `codex.rank.axis.${AXIS_LABEL_SLUG[key] ?? key}`;
}

const axis = (key: KpiKey, lowerIsBetter = false): RankAxis => ({
  key,
  labelKey: rankAxisLabelKey(key),
  lowerIsBetter,
});

/** The three profiles of MASTER §3 (the concept authored only the Kampf axes;
 * Verteidigung/Transport are the orchestrator's decision, §15). */
export const RANK_PROFILES: readonly RankProfile[] = [
  {
    id: 'combat',
    labelKey: 'codex.rank.profile.combat',
    axes: [axis('alpha'), axis('sustainedDps'), axis('missiles'), axis('shieldHp'), axis('agility'), axis('boost')],
  },
  {
    id: 'defence',
    labelKey: 'codex.rank.profile.defense',
    axes: [
      axis('shieldHp'),
      axis('shieldRegen'),
      axis('hullHp'),
      axis('armorHp'),
      axis('agility'),
      axis('crossSection', true),
    ],
  },
  {
    id: 'transport',
    labelKey: 'codex.rank.profile.transport',
    axes: [
      axis('cargo'),
      axis('quantumRange'),
      axis('scm'),
      axis('mass', true),
      axis('hullHp'),
      axis('shieldHp'),
    ],
  },
] as const;

export function rankProfileById(id: string | null | undefined): RankProfile {
  return RANK_PROFILES.find((p) => p.id === id) ?? RANK_PROFILES[0];
}

/** One cohort member — the ranking never sees payloads, only sheets. */
export interface RankShipInput {
  className: string;
  /** ship size class (1..5) — the default scope groups by it. */
  sizeClass: number | null;
  career: string | null;
  sheet: Partial<KpiSheet>;
}

export interface RankAxisResult {
  key: KpiKey;
  labelKey: string;
  lowerIsBetter: boolean;
  /** this ship's raw value; null = gap, the axis is not ranked. */
  value: number | null;
  /** 0..100, null when the axis is a gap or nobody in the cohort has data. */
  percentile: number | null;
  /** the cohort's median RAW value on this axis (for the tooltip). */
  medianValue: number | null;
  /** how many cohort ships carry a value on this axis. */
  cohortCount: number;
  /** true when the bar should paint red (MASTER §3: below 45 %). */
  weak: boolean;
  gapKey: string | null;
}

/** Matches the authored keys `codex.rank.band.low|mid|high` (R4). */
export type RankBand = 'low' | 'mid' | 'high';

export interface RankResult {
  profileId: RankProfileId;
  /** the scope the cohort was ACTUALLY built with — not necessarily the one
   * that was asked for (see `scopeFallbackKey`). */
  scope: RankScope;
  /** set when the requested scope had no discriminator on the target and the
   * cohort silently widened to `all`; the select must say so instead of
   * showing a `career` filter that never filtered anything. */
  scopeFallbackKey: string | null;
  /** ships in the cohort after the scope filter (including the target). */
  cohortSize: number;
  /** fixed profile order — drives the radar's spokes, vertices and captions. */
  axes: RankAxisResult[];
  /** the same axes sorted by percentile desc (gaps last) — drives the bar list only. */
  bars: RankAxisResult[];
  /** mean of the ranked axes' percentiles, null when no axis could be ranked. */
  overall: number | null;
  band: RankBand | null;
  bandKey: string | null;
  /** the dashed reference polygon — the median ship sits at 50 % by definition. */
  medianPolygon: number[];
}

/** Percentile band thresholds (MASTER §3). */
export const RANK_BAND_LOW = 25;
export const RANK_BAND_HIGH = 75;

export function rankBandOf(overall: number | null): RankBand | null {
  if (overall == null) return null;
  if (overall < RANK_BAND_LOW) return 'low';
  if (overall > RANK_BAND_HIGH) return 'high';
  return 'mid';
}

/** Cohort restriction. `all` keeps everything; `sizeClass` / `career` keep the
 * ships sharing the target's value — a target with a null discriminator can
 * only ever be compared against the whole field, so we fall back to `all`
 * rather than returning a cohort of one. */
export function filterCohort(
  target: RankShipInput,
  cohort: readonly RankShipInput[],
  scope: RankScope,
): RankShipInput[] {
  const withTarget = cohort.some((c) => c.className === target.className)
    ? [...cohort]
    : [target, ...cohort];
  if (scope === 'all') return withTarget;
  if (scope === 'sizeClass') {
    if (target.sizeClass == null) return withTarget;
    return withTarget.filter((c) => c.sizeClass === target.sizeClass);
  }
  if (!target.career) return withTarget;
  return withTarget.filter((c) => c.career === target.career);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The percentile of `value` inside `values` (see the header for the formula). */
export function percentileOf(
  value: number,
  values: readonly number[],
  lowerIsBetter: boolean,
): number | null {
  if (values.length === 0) return null;
  let worse = 0;
  let equal = 0;
  for (const v of values) {
    if (v === value) equal++;
    else if (lowerIsBetter ? v > value : v < value) worse++;
  }
  return Math.round(((worse + 0.5 * equal) / values.length) * 1000) / 10;
}

const WEAK_THRESHOLD = 45;

/** The single authored "this axis has no value" string (R4). */
export const RANK_AXIS_GAP_KEY = 'codex.rank.gapAxis';

/** Rank one ship against a cohort under one profile + scope. */
export function rankShip(
  target: RankShipInput,
  cohort: readonly RankShipInput[],
  options: { profile?: RankProfileId | RankProfile; scope?: RankScope } = {},
): RankResult {
  const profile =
    typeof options.profile === 'object' ? options.profile : rankProfileById(options.profile ?? 'combat');
  const requested = options.scope ?? 'sizeClass';
  // Rank hygiene: a scope whose discriminator the target does not carry cannot
  // filter anything. Report `all` + the reason rather than pretending the
  // cohort was narrowed.
  const degraded =
    (requested === 'career' && !target.career) ||
    (requested === 'sizeClass' && target.sizeClass == null);
  const scope: RankScope = degraded ? 'all' : requested;
  const scopeFallbackKey = degraded ? 'codex.rank.disabled.noData' : null;
  const set = filterCohort(target, cohort, scope);

  const axes: RankAxisResult[] = profile.axes.map((a) => {
    const values = set
      .map((c) => c.sheet[a.key] ?? null)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const value = target.sheet[a.key] ?? null;
    const usable = typeof value === 'number' && Number.isFinite(value);
    const percentile = usable ? percentileOf(value, values, a.lowerIsBetter) : null;
    return {
      key: a.key,
      labelKey: a.labelKey,
      lowerIsBetter: a.lowerIsBetter,
      value: usable ? value : null,
      percentile,
      medianValue: median(values),
      cohortCount: values.length,
      weak: percentile != null && percentile < WEAK_THRESHOLD,
      // ONE authored gap string for every axis — there is no per-axis copy (R4).
      gapKey: usable ? null : RANK_AXIS_GAP_KEY,
    };
  });

  const ranked = axes.map((a) => a.percentile).filter((p): p is number => p != null);
  const overall =
    ranked.length > 0 ? Math.round((ranked.reduce((s, p) => s + p, 0) / ranked.length) * 10) / 10 : null;
  const band = rankBandOf(overall);

  // `axes` stays in the profile's fixed order — it drives the radar's spokes,
  // vertices and captions. Only the bar list is sorted by percentile desc,
  // gaps last (MASTER §3); it must NOT mutate `axes` in place.
  const bars = [...axes].sort((a, b) => (b.percentile ?? -1) - (a.percentile ?? -1));

  return {
    profileId: profile.id,
    scope,
    scopeFallbackKey,
    cohortSize: set.length,
    axes,
    bars,
    overall,
    band,
    bandKey: band ? `codex.rank.band.${band}` : null,
    medianPolygon: profile.axes.map(() => 50),
  };
}

/** Why a profile chip is disabled — the concept's rule is "the hull physically
 * cannot do this role", phrased as a fact about the ship (B-C19). */
export function rankProfileDisabledReason(
  profile: RankProfileId,
  target: RankShipInput,
): string | null {
  if (profile === 'transport') {
    const cargo = target.sheet.cargo ?? null;
    if (cargo == null || cargo <= 0) return 'codex.rank.disabled.noCargo';
  }
  return null;
}

/**
 * The ship's career/role as the data carries it. The extractor emits the RAW
 * localisation key (`@vehicle_focus_Combat`) — we hand it through UNCHANGED and
 * let the component resolve it through the same entity-string path it already
 * uses for `role` in `codex-detail.component.ts`. Inventing a display string
 * here would mean a second, drifting translation of CIG's own vocabulary.
 */
export function resolveCareerLabel(career: string | null | undefined): string | null {
  const c = (career ?? '').trim();
  return c === '' ? null : c;
}

// ── cohort cache ─────────────────────────────────────────────────────────────
// localStorage (not IndexedDB): the payload is a few hundred small sheets, the
// API is synchronous — which keeps the ranking a pure computed() — and a quota
// failure is recoverable by simply recomputing. Keyed by build id + scope so a
// new extract never serves stale numbers. Every access is try/catch'd because
// Safari private mode throws on `localStorage` access itself.

const COHORT_CACHE_PREFIX = 'scc-codex-rank:v1';

export function cohortCacheKey(buildId: string, scope: RankScope, discriminator = ''): string {
  return `${COHORT_CACHE_PREFIX}:${buildId}:${scope}${discriminator ? `:${discriminator}` : ''}`;
}

export function readCohortCache(key: string): RankShipInput[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (e): e is RankShipInput =>
        !!e && typeof e === 'object' && typeof (e as RankShipInput).className === 'string',
    );
  } catch {
    return null;
  }
}

/** Roughly what one origin gets in localStorage; a cohort bigger than this
 * share of it can never be stored, and trying costs a serialise + a throw on
 * every single page view. */
const COHORT_CACHE_MAX_BYTES = 2_000_000;

export function writeCohortCache(key: string, ships: readonly RankShipInput[]): boolean {
  try {
    const blob = JSON.stringify(ships);
    // Two chars per byte is the pessimistic UTF-16 assumption browsers make.
    if (blob.length * 2 > COHORT_CACHE_MAX_BYTES) return false;
    localStorage.setItem(key, blob);
    return true;
  } catch {
    return false;
  }
}

/** Drop every cached cohort that does not belong to `buildId` (called after a
 * build switch so an old extract's sheets cannot linger). */
export function pruneCohortCache(buildId: string): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(`${COHORT_CACHE_PREFIX}:`) && !k.startsWith(`${COHORT_CACHE_PREFIX}:${buildId}:`)) {
        doomed.push(k);
      }
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* storage unavailable — nothing to prune */
  }
}
