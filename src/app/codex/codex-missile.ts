// Missile detail page: what a missile, torpedo or rocket record really carries,
// the comparison against its peers and the keyword chips derived from both.
// -----------------------------------------------------------------------------
// PURE DOMAIN MODULE. Nothing here invents a value: a metric the extract does
// not carry stays absent, its axis, chip and stat row simply do not exist.
//
// What the extract has (LIVE 4.10.2, tool 0.67.1): name, manufacturer, size,
// sub_type, the tracking signal in the class name and the silhouette's real
// measurements. The flight and warhead numbers sit in the game's
// SCItemMissileParams, which the uploader does not export yet — `readCombatMetrics`
// picks them up as soon as it does, without another web change.

import type { RankProfile, RankResult, RankScope, RankShipInput } from './codex-rank';
import { filterCohort, percentileOf, rankShip, rankScopeAvailability } from './codex-rank';

export type MissileSignal = 'ir' | 'em' | 'cs';
export type MissileCategory = 'missile' | 'torpedo' | 'rocket' | 'ground';

/** The axes a missile can be compared on, in radar order. */
export type MissileMetric =
  | 'damage'
  | 'speed'
  | 'agility'
  | 'range'
  | 'lockTime'
  | 'lifetime'
  | 'size'
  | 'length'
  | 'width';

export type MissileMetrics = Partial<Record<MissileMetric, number>>;

export interface MissileRecord {
  className: string;
  name: string | null;
  size: number | null;
  category: MissileCategory | null;
  signal: MissileSignal | null;
  metrics: MissileMetrics;
}

const ATTACH_TYPE = 'Missile';

/** A record the missile layout applies to: the extract files them all under this attach type. */
export function isMissileRow(row: { attach_type?: unknown } | null | undefined): boolean {
  return row?.attach_type === ATTACH_TYPE;
}

/**
 * The tracking signal as CIG's class name states it (`MISL_S02_IR_NOVP_Rattler`,
 * `NOVP_Rocket_Venom_S1_Strike_TL_IR`). Checked against the description line
 * "Tracking Signal: …" of all 66 records in LIVE 4.10.2; a name without the
 * token has no known signal.
 */
export function trackingSignalOf(className: string | null | undefined): MissileSignal | null {
  const match = /(?:^|_)(IR|EM|CS)(?:_|$)/.exec(className ?? '');
  return match ? (match[1].toLowerCase() as MissileSignal) : null;
}

export function missileCategoryOf(subType: unknown): MissileCategory | null {
  switch (subType) {
    case 'Missile':
      return 'missile';
    case 'Torpedo':
      return 'torpedo';
    case 'Rocket':
      return 'rocket';
    case 'GroundVehicleMissile':
      return 'ground';
    default:
      return null;
  }
}

/** A silhouette's bounding box in metres; `scaleMPerUnit` is the extract's own factor. */
export function missileMeasures(
  silhouette: { bbox: { w: number; h: number }; scaleMPerUnit: number | null } | null | undefined,
): Pick<MissileMetrics, 'length' | 'width'> {
  const scale = silhouette?.scaleMPerUnit;
  if (!silhouette || !scale || scale <= 0) return {};
  const metres = (units: number) => Math.round(units * scale * 100) / 100;
  const { w, h } = silhouette.bbox;
  return { ...(h > 0 ? { length: metres(h) } : {}), ...(w > 0 ? { width: metres(w) } : {}) };
}

/**
 * Where each combat metric is expected inside `payload.stats.SCItemMissileParams`
 * (`_component_stats` flattens one struct level to `sub.field`). Not yet proven
 * against a real export: a name that turns out different yields no value, never
 * a wrong one.
 */
const COMBAT_PATHS: Readonly<Partial<Record<MissileMetric, string>>> = {
  speed: 'GCSParams.linearSpeed',
  agility: 'GCSParams.turnRate',
  range: 'targetingParams.lockRangeMax',
  lockTime: 'targetingParams.lockTime',
  lifetime: 'maxLifetime',
};

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** The combat numbers of a payload; none of them is in the extract yet (see the header). */
export function readCombatMetrics(payload: unknown): MissileMetrics {
  const stats = (payload as { stats?: { SCItemMissileParams?: Record<string, unknown> } } | null | undefined)?.stats
    ?.SCItemMissileParams;
  if (!stats) return {};
  const out: MissileMetrics = {};
  for (const [metric, path] of Object.entries(COMBAT_PATHS) as [MissileMetric, string][]) {
    const value = positive(stats[path]);
    if (value != null) out[metric] = value;
  }
  // The warhead: its damage types add up, a type the record lacks adds nothing.
  const damage = Object.entries(stats)
    .filter(([key]) => key.startsWith('explosionParams.damage.'))
    .reduce((sum, [, value]) => sum + (positive(value) ?? 0), 0);
  if (damage > 0) out.damage = damage;
  return out;
}

export function missileRecordOf(
  row: Record<string, unknown>,
  payload: unknown,
  silhouette: Parameters<typeof missileMeasures>[0],
): MissileRecord {
  const size = typeof row['size'] === 'number' && row['size'] > 0 ? row['size'] : null;
  const name = row['name_localized'];
  return {
    className: String(row['class_name'] ?? ''),
    name: typeof name === 'string' && name ? name : null,
    size,
    category: missileCategoryOf(row['sub_type']),
    signal: trackingSignalOf(row['class_name'] as string | null),
    metrics: {
      ...readCombatMetrics(payload),
      ...(size != null ? { size } : {}),
      ...missileMeasures(silhouette),
    },
  };
}

// ── comparison ───────────────────────────────────────────────────────────────

const AXES: readonly { key: MissileMetric; lowerIsBetter: boolean }[] = [
  { key: 'damage', lowerIsBetter: false },
  { key: 'speed', lowerIsBetter: false },
  { key: 'agility', lowerIsBetter: false },
  { key: 'range', lowerIsBetter: false },
  { key: 'lockTime', lowerIsBetter: true },
  { key: 'lifetime', lowerIsBetter: false },
  { key: 'size', lowerIsBetter: false },
  { key: 'length', lowerIsBetter: false },
  { key: 'width', lowerIsBetter: false },
];

/** The four things a missile can be compared by, as the rank engine's scopes. */
function asRankInput(m: MissileRecord): RankShipInput<MissileMetric> {
  return {
    className: m.className,
    name: m.name,
    sizeClass: m.size,
    career: m.category,
    role: m.signal,
    sheet: m.metrics,
  } as RankShipInput<MissileMetric>;
}

const MIN_GROUP = 3;

/**
 * The group a missile opens on: its own kind, because "S2 rocket vs. S12
 * torpedo" mostly measures the size gap. A kind too small to compare with
 * (the one rocket) falls back to everything.
 */
export function defaultMissileScope(target: MissileRecord, cohort: readonly MissileRecord[]): RankScope {
  const sameKind = filterCohort(asRankInput(target), cohort.map(asRankInput), 'career');
  return target.category != null && sameKind.length >= MIN_GROUP ? 'career' : 'all';
}

/**
 * Rank one missile. An axis exists only where the target has a value and the
 * group actually differs on it — inside "same size" the size axis would read
 * 50 % for everyone. A group of one is no comparison, so it is offered disabled.
 * `null` = nothing to compare at all: the card shows its gap state.
 */
export function rankMissile(
  target: MissileRecord,
  cohort: readonly MissileRecord[],
  requested: RankScope,
): RankResult<MissileMetric> | null {
  const self = asRankInput(target);
  const peers = cohort.map(asRankInput);
  const available = rankScopeAvailability(self);
  for (const scope of Object.keys(available) as RankScope[]) {
    available[scope] &&= filterCohort(self, peers, scope).length >= 2;
  }
  const scope = available[requested] ? requested : 'all';
  const group = filterCohort(self, peers, scope);
  const axes = AXES.filter((axis) => {
    if (target.metrics[axis.key] == null) return false;
    const values = group
      .map((m) => (m.sheet as MissileMetrics)[axis.key])
      .filter((v): v is number => v != null);
    return new Set(values).size >= 2;
  });
  if (axes.length === 0) return null;
  const profile: RankProfile<MissileMetric> = {
    id: 'combat',
    labelKey: '',
    axes: axes.map((axis) => ({ ...axis, labelKey: `codex.missile.axis.${axis.key}` })),
  };
  return { ...rankShip(self, peers, { profile, scope }), scopeAvailable: available };
}

// ── keywords ─────────────────────────────────────────────────────────────────

export interface MissileKeyword {
  /** Stable id; also the i18n leaf under `codex.missile.keyword` / `.keywordTip`. */
  id: string;
  labelKey: string;
  tipKey: string;
}

const keyword = (id: string): MissileKeyword => ({
  id,
  labelKey: `codex.missile.keyword.${id}`,
  tipKey: `codex.missile.keywordTip.${id}`,
});

/** Below/above these sizes CIG's own racks stop mixing: S1–3 fighters, S7+ capital ordnance. */
const LIGHT_MAX_SIZE = 3;
const HEAVY_MIN_SIZE = 7;
/** A peer-relative word needs a real field and a clear position in it. */
const MIN_PEERS = 3;
const TOP_QUARTILE = 75;
const BOTTOM_QUARTILE = 25;

const COMBAT_KEYWORDS: readonly { metric: MissileMetric; id: string; lowerIsBetter?: boolean }[] = [
  { metric: 'damage', id: 'hardHitting' },
  { metric: 'speed', id: 'fast' },
  { metric: 'agility', id: 'agile' },
  { metric: 'range', id: 'longRange' },
  { metric: 'lockTime', id: 'quickLock', lowerIsBetter: true },
];

/**
 * One-word chips, each traceable to one attribute of THIS record: its signal,
 * its kind, its size, then its place among peers. Peer-relative words are
 * measured against the same size (a compact S2 is compact among S2s) or, for
 * combat numbers, the same kind; no field, no word.
 */
export function missileKeywords(target: MissileRecord, cohort: readonly MissileRecord[]): MissileKeyword[] {
  const out: MissileKeyword[] = [];
  if (target.signal) out.push(keyword(target.signal));
  if (target.category) out.push(keyword(target.category));
  if (target.size != null) {
    if (target.size <= LIGHT_MAX_SIZE) out.push(keyword('light'));
    else if (target.size >= HEAVY_MIN_SIZE) out.push(keyword('heavy'));
    else out.push(keyword('medium'));
  }

  const positionIn = (
    peers: readonly MissileRecord[],
    metric: MissileMetric,
    lowerIsBetter: boolean,
  ): number | null => {
    const value = target.metrics[metric];
    if (value == null) return null;
    const self = peers.some((p) => p.className === target.className) ? [] : [target];
    const values = [...peers, ...self]
      .map((p) => p.metrics[metric])
      .filter((v): v is number => v != null);
    return values.length >= MIN_PEERS && new Set(values).size >= 2 ? percentileOf(value, values, lowerIsBetter) : null;
  };

  const sameKind = cohort.filter((m) => m.category === target.category);
  for (const { metric, id, lowerIsBetter } of COMBAT_KEYWORDS) {
    const position = positionIn(sameKind, metric, lowerIsBetter ?? false);
    if (position != null && position >= TOP_QUARTILE) out.push(keyword(id));
  }

  const sameSize = sameKind.filter((m) => m.size === target.size);
  const length = positionIn(sameSize, 'length', false);
  if (length != null && length <= BOTTOM_QUARTILE) out.push(keyword('compact'));
  else if (length != null && length >= TOP_QUARTILE) out.push(keyword('long'));

  return out;
}

// ── the data card ────────────────────────────────────────────────────────────

export type MissileStatGroupId = 'warhead' | 'flight' | 'guidance' | 'build';

export interface MissileStatRow {
  key: string;
  labelKey: string;
  /** A number to format, or the i18n key of a word. */
  value: number | null;
  valueKey: string | null;
  unit: string | null;
}

export interface MissileStatGroup {
  id: MissileStatGroupId;
  rows: MissileStatRow[];
}

const METRIC_ROWS: Readonly<Record<MissileStatGroupId, readonly { metric: MissileMetric; unit: string | null }[]>> = {
  warhead: [{ metric: 'damage', unit: null }],
  flight: [
    { metric: 'speed', unit: 'm/s' },
    { metric: 'agility', unit: '°/s' },
    { metric: 'range', unit: 'm' },
    { metric: 'lifetime', unit: 's' },
  ],
  guidance: [{ metric: 'lockTime', unit: 's' }],
  build: [
    { metric: 'length', unit: 'm' },
    { metric: 'width', unit: 'm' },
  ],
};

const COMBAT_METRICS: readonly MissileMetric[] = ['damage', 'speed', 'agility', 'range', 'lockTime', 'lifetime'];

/** Everything the record carries, grouped; a group without a value is absent. */
export function missileStatGroups(target: MissileRecord): MissileStatGroup[] {
  const word = (key: string, labelKey: string, valueKey: string): MissileStatRow => ({
    key,
    labelKey,
    value: null,
    valueKey,
    unit: null,
  });
  const leading: Partial<Record<MissileStatGroupId, MissileStatRow[]>> = {
    guidance: target.signal ? [word('signal', 'codex.missile.stat.signal', `codex.missile.signal.${target.signal}`)] : [],
    build: [
      ...(target.category ? [word('category', 'codex.missile.stat.category', `codex.missile.category.${target.category}`)] : []),
      ...(target.size != null
        ? [{ key: 'size', labelKey: 'codex.missile.stat.size', value: target.size, valueKey: null, unit: null }]
        : []),
    ],
  };
  const ids: readonly MissileStatGroupId[] = ['warhead', 'flight', 'guidance', 'build'];
  return ids
    .map((id) => ({
      id,
      rows: [
        ...(leading[id] ?? []),
        ...METRIC_ROWS[id].flatMap(({ metric, unit }) => {
          const value = target.metrics[metric];
          return value == null
            ? []
            : [{ key: metric, labelKey: `codex.missile.stat.${metric}`, value, valueKey: null, unit }];
        }),
      ],
    }))
    .filter((group) => group.rows.length > 0);
}

/** True once any flight or warhead number exists; until then the card says they are missing. */
export function hasCombatMetrics(target: MissileRecord): boolean {
  return COMBAT_METRICS.some((metric) => target.metrics[metric] != null);
}
