// Holotisch rail graphs for ship weapons and ship components: where one record ranks among its peers.
// -----------------------------------------------------------------------------
// PURE DOMAIN MODULE, the sibling of codex-missile.ts. Nothing here invents a value: a metric the
// payload does not carry stays absent, its axis does not exist, and an axis nobody in the group
// differs on is dropped too (a ranking of equals says nothing). Never a zero for "unknown".
//
// What is charted per kind (3-4 values each, all read from the payload):
//   weapon        Burst-DPS, alpha damage, fire rate, projectile speed
//   Shield        shield HP, regen, damaged-regen delay (lower is better), downed-regen delay (lower is better)
//   PowerPlant    power output, health, EM signature (lower is better), IR signature (lower is better)
//   Cooler        cooling rate, health, EM signature (lower is better), IR signature (lower is better)
//   QuantumDrive  drive speed, jump range, spool-up time (lower is better), health

import { findStat, toFiniteNumber } from '../hangar/loadout-stats';
import { alphaDamage, damagePerSecond } from './codex-equipped-stats';
import type { RankProfile, RankResult, RankScope, RankShipInput } from './codex-rank';
import { filterCohort, rankScopeAvailability, rankShip } from './codex-rank';
import { RESOURCE_DEFAULT_STATE, RESOURCE_STATS_GROUP, resourceKey } from './codex.types';

export type ItemRankKind = 'weapon' | 'Shield' | 'PowerPlant' | 'Cooler' | 'QuantumDrive';

export type ItemRankMetric =
  | 'dps' | 'alpha' | 'fireRate' | 'projectileSpeed'
  | 'shieldHp' | 'shieldRegen' | 'damagedDelay' | 'downedDelay'
  | 'powerOutput' | 'coolingRate' | 'health' | 'emSignature' | 'irSignature'
  | 'driveSpeed' | 'jumpRange' | 'spoolTime';

export type ItemRankMetrics = Partial<Record<ItemRankMetric, number>>;

export interface ItemRankRecord {
  className: string;
  name: string | null;
  size: number | null;
  kind: ItemRankKind;
  /** Gun / Beam / … or the component's sub type: the "same type" group. */
  subType: string | null;
  metrics: ItemRankMetrics;
}

interface AxisDef { key: ItemRankMetric; lowerIsBetter: boolean }

/** The axes of each kind, in radar order. */
export const ITEM_RANK_AXES: Readonly<Record<ItemRankKind, readonly AxisDef[]>> = {
  weapon: [
    { key: 'dps', lowerIsBetter: false },
    { key: 'alpha', lowerIsBetter: false },
    { key: 'fireRate', lowerIsBetter: false },
    { key: 'projectileSpeed', lowerIsBetter: false },
  ],
  Shield: [
    { key: 'shieldHp', lowerIsBetter: false },
    { key: 'shieldRegen', lowerIsBetter: false },
    { key: 'damagedDelay', lowerIsBetter: true },
    { key: 'downedDelay', lowerIsBetter: true },
  ],
  PowerPlant: [
    { key: 'powerOutput', lowerIsBetter: false },
    { key: 'health', lowerIsBetter: false },
    { key: 'emSignature', lowerIsBetter: true },
    { key: 'irSignature', lowerIsBetter: true },
  ],
  Cooler: [
    { key: 'coolingRate', lowerIsBetter: false },
    { key: 'health', lowerIsBetter: false },
    { key: 'emSignature', lowerIsBetter: true },
    { key: 'irSignature', lowerIsBetter: true },
  ],
  QuantumDrive: [
    { key: 'driveSpeed', lowerIsBetter: false },
    { key: 'jumpRange', lowerIsBetter: false },
    { key: 'spoolTime', lowerIsBetter: true },
    { key: 'health', lowerIsBetter: false },
  ],
};

/** A radar needs at least three corners; fewer comparable values show the card's gap state. */
const MIN_AXES = 3;
const MIN_GROUP = 3;
/** CryEngine's "unset" sentinel (FLT_MAX); far above any real value. */
const SENTINEL = 1e30;

function positive(v: unknown): number | null {
  const n = toFiniteNumber(v);
  return n !== null && n > 0 && n < SENTINEL ? n : null;
}

type StatsMap = Record<string, Record<string, unknown>>;
function statsOf(payload: unknown): StatsMap | null {
  const s = (payload as { stats?: unknown } | null | undefined)?.stats;
  return s && typeof s === 'object' ? (s as StatsMap) : null;
}

/** Which comparison a record belongs to: a ship weapon, or one of the four component types with a graph. */
export function itemRankKindOf(kind: string, payload: unknown): ItemRankKind | null {
  if (kind === 'weapon') return 'weapon';
  if (kind !== 'component') return null;
  const ck = (payload as { kind?: unknown } | null | undefined)?.kind;
  return ck === 'Shield' || ck === 'PowerPlant' || ck === 'Cooler' || ck === 'QuantumDrive' ? ck : null;
}

/** The comparable numbers of one payload; whatever it does not carry is simply not in the result. */
export function readItemRankMetrics(kind: ItemRankKind, payload: unknown): ItemRankMetrics {
  const out: ItemRankMetrics = {};
  const put = (key: ItemRankMetric, value: number | null): void => {
    if (value !== null) out[key] = value;
  };
  if (kind === 'weapon') {
    const wp = (payload as { weaponParams?: Record<string, unknown> } | null | undefined)?.weaponParams;
    const alpha = alphaDamage(payload);
    const fireRate = positive(wp?.['fireRate']);
    put('alpha', alpha);
    put('fireRate', fireRate);
    put('dps', damagePerSecond(alpha, fireRate));
    put('projectileSpeed', positive(wp?.['projectileSpeed']));
    return out;
  }
  const stats = statsOf(payload);
  const res = (field: string): number | null =>
    positive(findStat(stats, RESOURCE_STATS_GROUP, [resourceKey(field, RESOURCE_DEFAULT_STATE)]));
  put('health', positive(findStat(stats, 'SHealthComponentParams', ['Health'])));
  if (kind === 'Shield') {
    put('shieldHp', positive(findStat(stats, 'shield', ['MaxShieldHealth'])));
    put('shieldRegen', positive(findStat(stats, 'shield', ['MaxShieldRegen'])));
    put('damagedDelay', positive(findStat(stats, 'shield', ['DamagedRegenDelay'])));
    put('downedDelay', positive(findStat(stats, 'shield', ['DownedRegenDelay'])));
    delete out.health;
    return out;
  }
  put('emSignature', res('em.nominal'));
  put('irSignature', res('ir.nominal'));
  if (kind === 'PowerPlant') put('powerOutput', res('power.generateSegments'));
  if (kind === 'Cooler') put('coolingRate', res('coolant.generate'));
  if (kind === 'QuantumDrive') {
    delete out.emSignature;
    delete out.irSignature;
    put('driveSpeed', positive(findStat(stats, 'quantum', ['params.driveSpeed', 'driveSpeed'])));
    put('jumpRange', positive(findStat(stats, 'quantum', ['jumpRange'])));
    put('spoolTime', positive(findStat(stats, 'quantum', ['params.spoolUpTime', 'spoolUpTime'])));
  }
  return out;
}

/** One record from a catalog row and its (possibly sliced) payload; null = no graph for this kind. */
export function itemRankRecordOf(entityKind: string, row: Record<string, unknown>, payload: unknown): ItemRankRecord | null {
  const kind = itemRankKindOf(entityKind, payload);
  if (!kind) return null;
  const size = typeof row['size'] === 'number' && row['size'] > 0 ? row['size'] : null;
  const name = row['name_localized'];
  const sub = row['sub_type'];
  return {
    className: String(row['class_name'] ?? ''),
    name: typeof name === 'string' && name ? name : null,
    size,
    kind,
    subType: typeof sub === 'string' && sub ? sub : null,
    metrics: readItemRankMetrics(kind, payload),
  };
}

function asRankInput(m: ItemRankRecord): RankShipInput<ItemRankMetric> {
  return {
    className: m.className,
    name: m.name,
    sizeClass: m.size,
    career: m.subType,
    role: null,
    sheet: m.metrics,
  } as RankShipInput<ItemRankMetric>;
}

/** Same size is the page's default group (a S1 gun against an S3 one mostly measures the size); too few → all. */
export function defaultItemScope(target: ItemRankRecord, cohort: readonly ItemRankRecord[]): RankScope {
  const same = filterCohort(asRankInput(target), cohort.map(asRankInput), 'sizeClass');
  return target.size != null && same.length >= MIN_GROUP ? 'sizeClass' : 'all';
}

/**
 * Rank one weapon or component against its peers (the cohort is already of the same kind). An axis exists only where
 * the target has a value and the group differs on it. `null` = nothing to compare: the card shows its gap state.
 */
export function rankItem(
  target: ItemRankRecord,
  cohort: readonly ItemRankRecord[],
  requested: RankScope,
): RankResult<ItemRankMetric> | null {
  const self = asRankInput(target);
  const peers = cohort.map(asRankInput);
  const available = rankScopeAvailability(self);
  for (const scope of Object.keys(available) as RankScope[]) {
    available[scope] &&= filterCohort(self, peers, scope).length >= 2;
  }
  const scope = available[requested] ? requested : 'all';
  const group = filterCohort(self, peers, scope);
  const axes = ITEM_RANK_AXES[target.kind].filter((axis) => {
    if (target.metrics[axis.key] == null) return false;
    const values = group.map((m) => (m.sheet as ItemRankMetrics)[axis.key]).filter((v): v is number => v != null);
    return new Set(values).size >= 2;
  });
  if (axes.length < MIN_AXES) return null;
  const profile: RankProfile<ItemRankMetric> = {
    id: 'combat',
    labelKey: '',
    axes: axes.map((axis) => ({ ...axis, labelKey: `codex.itemRank.axis.${axis.key}` })),
  };
  return { ...rankShip(self, peers, { profile, scope }), scopeAvailable: available };
}
