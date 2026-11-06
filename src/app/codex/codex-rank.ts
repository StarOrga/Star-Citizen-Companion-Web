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
import type { KpiShipInput, KpiSheet } from './codex-loadout-stats';

/** The seven ship classes: a class gives the default axis list. */
export type RankClassId = 'combat' | 'transport' | 'exploration' | 'resources' | 'support' | 'multirole' | 'competition';
/** Class ids plus the lists only an Einsatz picks (travel, stealth) and the
 * classic card's 'defence'. ONE list per id: Kampf and Transport are shared
 * between class and Einsatz, there is no parallel system. */
export type RankProfileId = RankClassId | 'travel' | 'stealth' | 'defence';
export type RankScope = 'sizeClass' | 'all' | 'career' | 'role';

export interface RankAxis<K extends string = KpiKey> {
  key: K;
  labelKey: string;
  /** IR/EM/cross-section/mass: a smaller number ranks HIGHER. */
  lowerIsBetter: boolean;
}

export interface RankProfile<K extends string = KpiKey> {
  id: RankProfileId;
  labelKey: string;
  axes: readonly RankAxis<K>[];
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

/** The classic card's three chips (MASTER §3). Unchanged, so the classic view
 * and `codex-missile.ts` keep their behaviour. */
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

const profile = (id: RankProfileId, axes: RankAxis[]): RankProfile => ({
  id,
  labelKey: `codex.rank.profile.${id}`,
  axes,
});

/** Holotable axis lists (briefs/03.md): one list per class and per Einsatz,
 * only KPI that exist. Mining/salvage have no value in the data, see
 * `rankMissionNoteKey`. */
export const RANK_AXIS_PROFILES: readonly RankProfile[] = [
  RANK_PROFILES[0],
  RANK_PROFILES[2],
  profile('exploration', [
    axis('quantumRange'),
    axis('quantumSpeed'),
    axis('spool', true),
    axis('cargo'),
    axis('shieldHp'),
    axis('crossSection', true),
  ]),
  profile('resources', [
    axis('cargo'),
    axis('quantumRange'),
    axis('scm'),
    axis('hullHp'),
    axis('shieldHp'),
    axis('mass', true),
  ]),
  profile('support', [
    axis('hullHp'),
    axis('shieldHp'),
    axis('shieldRegen'),
    axis('quantumRange'),
    axis('scm'),
    axis('cargo'),
  ]),
  profile('multirole', [
    axis('sustainedDps'),
    axis('shieldHp'),
    axis('cargo'),
    axis('agility'),
    axis('quantumRange'),
    axis('hullHp'),
  ]),
  profile('competition', [
    axis('boost'),
    axis('maxSpeed'),
    axis('scm'),
    axis('agility'),
    axis('mass', true),
    axis('spool', true),
  ]),
  profile('travel', [
    axis('scm'),
    axis('maxSpeed'),
    axis('boost'),
    axis('quantumSpeed'),
    axis('quantumRange'),
    axis('spool', true),
  ]),
  profile('stealth', [
    axis('ir', true),
    axis('emIdle', true),
    axis('emMax', true),
    axis('crossSection', true),
    axis('agility'),
    axis('scm'),
  ]),
  RANK_PROFILES[1],
] as const;

export function rankProfileById(id: string | null | undefined): RankProfile {
  return RANK_AXIS_PROFILES.find((p) => p.id === id) ?? RANK_PROFILES[0];
}

// ── class and Einsatz → axis list ───────────────────────────────────────────

const CLASS_BY_CAREER_SUFFIX: Readonly<Record<string, RankClassId>> = {
  combat: 'combat',
  transporter: 'transport',
  transport: 'transport',
  exploration: 'exploration',
  resources: 'resources',
  support: 'support',
  multirole: 'multirole',
  competition: 'competition',
  // Strays. Judgement calls, flagged in the handoff: capital ships, gunships,
  // destroyers and snubfighters are fighting hulls; a starter and a ground
  // vehicle are generalists.
  capitalship: 'combat',
  gunship: 'combat',
  destroyer: 'combat',
  snubfighter: 'combat',
  starter: 'multirole',
  ground: 'multirole',
};

/** Class used when a career is missing or not in the table: the Kampf list,
 * what every ship showed before classes existed. */
export const RANK_DEFAULT_CLASS: RankClassId = 'combat';

function careerSuffix(career: string | null | undefined): string {
  return (career ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/^(vehicle_focus_|item_shipfocus_|vehicle_class_)/, '');
}

/** The class of a raw career key (`@vehicle_focus_Combat`, `@item_ShipFocus_Gunship`,
 * `@vehicle_class_destroyer` ...). Case and the leading `@` do not matter. */
export function rankClassOfCareer(career: string | null | undefined): RankClassId {
  return CLASS_BY_CAREER_SUFFIX[careerSuffix(career)] ?? RANK_DEFAULT_CLASS;
}

/** True when the career key is in the table (false = the fallback was used). */
export function rankCareerIsMapped(career: string | null | undefined): boolean {
  return Object.hasOwn(CLASS_BY_CAREER_SUFFIX, careerSuffix(career));
}

/** i18n key of the class's name, e.g. "Kampfschiff" (the strip's default label). */
export function rankClassLabelKey(c: RankClassId): string {
  return `codex.rank.class.${c}`;
}
/** i18n key of the plural, e.g. "Kampfschiffe" (the group selector). */
export function rankClassPluralKey(c: RankClassId): string {
  return `codex.rank.classPlural.${c}`;
}

/** Einsatz → axis list. `all` (the default) uses the class's list; a picked
 * Einsatz overrides it. `mining`/`salvage` use the Ressourcen list. */
export function rankProfileForMission(missionId: string, shipClass: RankClassId): RankProfileId {
  switch (missionId) {
    case 'combat':
      return 'combat';
    case 'transport':
      return 'transport';
    case 'travel':
      return 'travel';
    case 'stealth':
      return 'stealth';
    case 'mining':
    case 'salvage':
      return 'resources';
    default:
      return shipClass;
  }
}

/** The honest line for Einsaetze whose value does not exist in the data. */
export function rankMissionNoteKey(missionId: string): string | null {
  return missionId === 'mining' || missionId === 'salvage' ? 'codex.rank.noMiningData' : null;
}

// ── group names ─────────────────────────────────────────────────────────────

/** A group smaller than this does not give a fair median: the role group falls
 * back to the career group, that one to all ships. Measured group sizes:
 * Leichte Jaeger 26, Mittlere Frachter 21 (briefs/03.md). */
export const RANK_MIN_GROUP = 8;

/**
 * The group name from a ship's role label, to read after "Alle":
 * "Leichter Jäger" → "Leichten Jäger", "Light Fighter" → "Light Fighters".
 * A one-word label stays. German adjective endings are a rule of thumb.
 */
export function rankGroupName(roleLabel: string, lang: string): string {
  const label = roleLabel.trim();
  if (label === '') return label;
  const words = label.split(/\s+/);
  if (lang.startsWith('de')) {
    if (words.length > 1 && /er$/.test(words[0])) words[0] = words[0].replace(/er$/, 'en');
    return words.join(' ');
  }
  const last = words[words.length - 1];
  if (!/s$/i.test(last)) words[words.length - 1] = last + 's';
  return words.join(' ');
}

/** One cohort member — the ranking never sees payloads, only sheets. */
export interface RankShipInput<K extends string = KpiKey> {
  className: string;
  /** The ship's localized display name, when the cohort read carried one —
   * lists that name cohort ships (the Holotable top-3) show it instead of a
   * humanized class name. Optional: cached cohorts from before it existed. */
  name?: string | null;
  /** ship size class (1..5) — the default scope groups by it. */
  sizeClass: number | null;
  career: string | null;
  /** The ship's role (`ships.role`, raw localisation key) — the third
   * comparison group. Optional: cohorts cached before it existed. */
  role?: string | null;
  sheet: [K] extends [KpiKey] ? Partial<KpiSheet> : Partial<Record<K, number | null>>;
}

export interface RankAxisResult<K extends string = KpiKey> {
  key: K;
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
  /**
   * The radar's scale: this ship's value as a share of the best value in the
   * chosen comparison group — 0 at the centre, the group's best ship at the
   * rim (100), linear, so the rings read 33 / 67 / 100 %.
   */
  norm: number | null;
  /** The comparison group's median value on the same group scale. */
  compareNorm: number | null;
  /** `norm - compareNorm`, rounded; positive = this ship is better. */
  delta: number | null;
}

/** Matches the authored keys `codex.rank.band.low|mid|high` (R4). */
export type RankBand = 'low' | 'mid' | 'high';

export interface RankResult<K extends string = KpiKey> {
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
  axes: RankAxisResult<K>[];
  /** the same axes sorted by percentile desc (gaps last) — drives the bar list only. */
  bars: RankAxisResult<K>[];
  /** mean of the ranked axes' percentiles, null when no axis could be ranked. */
  overall: number | null;
  band: RankBand | null;
  bandKey: string | null;
  /** Which comparison groups the target can actually be put in — a scope
   * whose discriminator the ship lacks is offered disabled, never silently
   * widened behind the user's back. */
  scopeAvailable: Record<RankScope, boolean>;
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
export function filterCohort<K extends string = KpiKey>(
  target: RankShipInput<K>,
  cohort: readonly RankShipInput<K>[],
  scope: RankScope,
  options: { careerByClass?: boolean } = {},
): RankShipInput<K>[] {
  const withTarget = cohort.some((c) => c.className === target.className)
    ? [...cohort]
    : [target, ...cohort];
  if (scope === 'all') return withTarget;
  if (scope === 'sizeClass') {
    if (target.sizeClass == null) return withTarget;
    return withTarget.filter((c) => c.sizeClass === target.sizeClass);
  }
  if (scope === 'role') {
    if (!target.role) return withTarget;
    return withTarget.filter((c) => c.role === target.role);
  }
  if (!target.career) return withTarget;
  if (options.careerByClass) {
    // The holo group "Alle Kampfschiffe": strays (Gunship, Destroyer ...) join their class.
    const cls = rankClassOfCareer(target.career);
    return withTarget.filter((c) => !!c.career && rankClassOfCareer(c.career) === cls);
  }
  return withTarget.filter((c) => c.career === target.career);
}

/** Which scopes can filter anything for `target` (see `RankResult.scopeAvailable`). */
export function rankScopeAvailability<K extends string = KpiKey>(target: RankShipInput<K>): Record<RankScope, boolean> {
  return {
    all: true,
    career: !!target.career,
    role: !!target.role,
    sizeClass: target.sizeClass != null,
  };
}

/** Where the radar's rim sits: the group's best value, or its 95th percentile. */
export type RankRim = 'best' | 'p95';

/** Linear-interpolated quantile of an ascending-sorted array, q in 0..1. */
function quantileSorted(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Place `value` on the 0..100 scale of the comparison `group`: 0 is a value
 * of 0 (the centre), 100 the rim, linear in between — so the radar's rings mean
 * 33 / 67 / 100 % of the rim. The rim is the group's best value (`rim='best'`,
 * the default every other caller keeps) or its 95th percentile (`'p95'`): one
 * outlier no longer pushes the rest of the group to the centre, values beyond
 * the rim clamp at 100. Lower-is-better axes mirror it: the rim is the smallest
 * value (or the 5th percentile) and the scale is rim / value, so "further out"
 * always reads "better". A p95 of 0 (a group that is mostly zero) falls back to
 * the best value rather than dividing by it.
 */
export function groupScale(
  value: number,
  group: readonly number[],
  lowerIsBetter: boolean,
  rim: RankRim = 'best',
): number | null {
  if (group.length === 0) return null;
  const sorted = [...group].sort((a, b) => a - b);
  const best = lowerIsBetter ? sorted[0] : sorted[sorted.length - 1];
  let edge = best;
  if (rim === 'p95') {
    const q = lowerIsBetter ? quantileSorted(sorted, 0.05) : quantileSorted(sorted, 0.95);
    if (!lowerIsBetter ? q > 0 : q >= 0) edge = q;
  }
  let t: number;
  if (lowerIsBetter) t = value <= 0 ? 1 : Math.max(0, edge) / value;
  else t = edge <= 0 ? 0 : value / edge;
  return Math.round(Math.max(0, Math.min(1, t)) * 1000) / 10;
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

/**
 * Rank one ship against a cohort under one profile + scope. The maths knows
 * nothing about ships: a caller with its own axes (missiles, codex-missile.ts)
 * passes a profile object over its own key type.
 */
export function rankShip<K extends string = KpiKey>(
  target: RankShipInput<K>,
  cohort: readonly RankShipInput<K>[],
  options: {
    profile?: RankProfileId | RankProfile<K>;
    scope?: RankScope;
    /** Radar rim; the default `best` keeps every existing caller's numbers. */
    rim?: RankRim;
    /** Group the career scope by class (strays join their class). Holo only. */
    careerByClass?: boolean;
    /** A group smaller than this widens role -> career -> all
     * (`RANK_MIN_GROUP`); unset = never. */
    minGroup?: number;
  } = {},
): RankResult<K> {
  const profile = (
    typeof options.profile === 'object' ? options.profile : rankProfileById(options.profile ?? 'combat')
  ) as RankProfile<K>;
  const requested = options.scope ?? 'sizeClass';
  // Rank hygiene: a scope whose discriminator the target does not carry cannot
  // filter anything. Report `all` + the reason rather than pretending the
  // cohort was narrowed.
  const scopeAvailable = rankScopeAvailability(target);
  const degraded = !scopeAvailable[requested];
  let scope: RankScope = degraded ? 'all' : requested;
  let scopeFallbackKey = degraded ? 'codex.rank.disabled.noData' : null;
  const groupOpts = { careerByClass: options.careerByClass };
  let set = filterCohort(target, cohort, scope, groupOpts);
  if (options.minGroup != null && scope !== 'all' && scope !== 'sizeClass') {
    const chain: RankScope[] = scope === 'role' ? ['career', 'all'] : ['all'];
    for (const next of chain) {
      if (set.length >= options.minGroup) break;
      if (!scopeAvailable[next]) continue;
      scope = next;
      set = filterCohort(target, cohort, scope, groupOpts);
      scopeFallbackKey = 'codex.rank.disabled.smallGroup';
    }
  }
  const rim = options.rim ?? 'best';
  const valueOf = (ship: RankShipInput<K>, key: K): number | null =>
    (ship.sheet as Partial<Record<K, number | null>>)[key] ?? null;
  const numbersOf = (ships: readonly RankShipInput<K>[], key: K): number[] =>
    ships
      .map((c) => valueOf(c, key))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const axes: RankAxisResult<K>[] = profile.axes.map((a) => {
    const values = numbersOf(set, a.key);
    const value = valueOf(target, a.key);
    const usable = typeof value === 'number' && Number.isFinite(value);
    const percentile = usable ? percentileOf(value, values, a.lowerIsBetter) : null;
    const groupMedian = median(values);
    const norm = usable ? groupScale(value, values, a.lowerIsBetter, rim) : null;
    const compareNorm = groupMedian != null ? groupScale(groupMedian, values, a.lowerIsBetter, rim) : null;
    return {
      key: a.key,
      labelKey: a.labelKey,
      lowerIsBetter: a.lowerIsBetter,
      value: usable ? value : null,
      percentile,
      medianValue: groupMedian,
      cohortCount: values.length,
      weak: percentile != null && percentile < WEAK_THRESHOLD,
      // ONE authored gap string for every axis — there is no per-axis copy (R4).
      gapKey: usable ? null : RANK_AXIS_GAP_KEY,
      norm,
      compareNorm,
      delta: norm != null && compareNorm != null ? Math.round(norm - compareNorm) : null,
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
    scopeAvailable,
  };
}

/**
 * The ship input the PAGE's own KPI sheet must be computed from for the
 * ranking. It has to carry the same fields the cohort sheets are built from
 * (hull, armor, cargo): the page's strip input only had flight + stats, so the
 * target's `cargo` was always null, "Transport" was reported as disabled for
 * EVERY hull and a Caterpillar on Einsatz Transport kept the Kampf axes (D3).
 */
export function rankTargetShipInput(payload: {
  flight?: unknown;
  hull?: unknown;
  armorHp?: number | null;
  cargoScu?: number | null;
  stats?: unknown;
} | null | undefined): Pick<KpiShipInput, 'flight' | 'hull' | 'armorHp' | 'cargoScu' | 'stats'> | null {
  if (!payload) return null;
  return {
    flight: (payload.flight ?? null) as KpiShipInput['flight'],
    hull: (payload.hull ?? null) as KpiShipInput['hull'],
    armorHp: payload.armorHp ?? null,
    cargoScu: payload.cargoScu ?? null,
    stats: (payload.stats ?? null) as KpiShipInput['stats'],
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

// ── remembered comparison group ──────────────────────────────────────────────
// An essential functional preference like `ComposerPrefsService`'s: no
// personal data, persisted unconditionally, failing open to "Alle Schiffe".
// localStorage is the instant, signed-out copy; a signed-in account also keeps
// it in `profiles.ui_prefs` under RANK_SCOPE_ACCOUNT_KEY (AccountPrefsService),
// which wins once loaded so the choice follows the user to another browser.

const RANK_SCOPE_PREF_KEY = 'sc.codex.rankScope';
export const RANK_SCOPE_ACCOUNT_KEY = 'codex.rankScope';
const PICKABLE_SCOPES: readonly RankScope[] = ['all', 'career', 'role'];

/** A stored value as a pickable group, or null for anything else. */
export function parseRankScopePref(v: unknown): RankScope | null {
  return typeof v === 'string' && (PICKABLE_SCOPES as readonly string[]).includes(v) ? (v as RankScope) : null;
}

/** `fallback`: the group before the user ever picked one ("all" for the classic
 * card, "role" in the Holotable). */
export function readRankScopePref(fallback: RankScope = 'all'): RankScope {
  try {
    return parseRankScopePref(localStorage.getItem(RANK_SCOPE_PREF_KEY)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeRankScopePref(scope: RankScope): void {
  try {
    localStorage.setItem(RANK_SCOPE_PREF_KEY, scope);
  } catch {
    /* private mode / quota — the choice still holds for this page */
  }
}

// ── cohort cache ─────────────────────────────────────────────────────────────
// localStorage (not IndexedDB): the payload is a few hundred small sheets, the
// API is synchronous — which keeps the ranking a pure computed() — and a quota
// failure is recoverable by simply recomputing. Keyed by build id + scope so a
// new extract never serves stale numbers. Every access is try/catch'd because
// Safari private mode throws on `localStorage` access itself.

// v2: the cohort drops salvage wrecks, sentries, probes and nameless records
// (archive audit 2026-09-25) — a v1 entry holds the old fleet.
// v3: every member carries its `role` (the third comparison group).
// v4: a cohort with a failed payload chunk is never cached (holodeck polish 2026-10-08) —
// a v3 entry may hold such a half-fleet.
const COHORT_CACHE_PREFIX = 'scc-codex-rank:v4';

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
      // Older cache versions go too, whatever their build.
      if (k?.startsWith('scc-codex-rank:') && !k.startsWith(`${COHORT_CACHE_PREFIX}:${buildId}:`)) {
        doomed.push(k);
      }
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* storage unavailable — nothing to prune */
  }
}
