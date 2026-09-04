// KPI band + offensive/defensive analysis math for the ship analysis page (PR C).
// -----------------------------------------------------------------------------
// Same hard rule as `ship-summary-panels.ts` and `codex-equipped-stats.ts`:
// NEVER invent a number. Every figure here is read straight out of a resolved
// occupant's payload or derived by one documented formula; a stat the extract
// does not carry comes back `null` and the caller renders a gap, not a zero.
//
// This module is intentionally payload-agnostic about WHICH loadout it reads —
// the ship page calls `computeKpiSheet` once for the STOCK occupants and once
// for the DRAFT-resolved occupants, and diffs the two sheets for the KPI band's
// delta chips (03-rules §3.5).

import {
  alphaDamage,
  damagePerSecond,
  impactDamageChannels,
  projectileRange,
  EquippedStatFormat,
} from './codex-equipped-stats';
import { equippedMass, itemMass, SummaryOccupant } from './ship-summary-panels';
import { findStat, toFiniteNumber } from '../hangar/loadout-stats';
import { KpiKey, MissionDef } from './codex-mission';

export type { SummaryOccupant };

const FLT_MAX_SENTINEL = 1e30;

function usable(v: number | null): number | null {
  if (v === null || !Number.isFinite(v) || v <= 0) return null;
  return v >= FLT_MAX_SENTINEL ? null : v;
}

function statsOf(payload: unknown): Record<string, Record<string, unknown>> | undefined {
  const s = (payload as { stats?: unknown } | undefined)?.stats;
  return s && typeof s === 'object' ? (s as Record<string, Record<string, unknown>>) : undefined;
}

function componentKindOf(payload: unknown): string {
  return ((payload as { kind?: string } | undefined)?.kind ?? '').trim();
}

function entityKindOf(o: SummaryOccupant): string {
  return (o.payload as { entityKind?: string } | null | undefined)?.entityKind ?? o.kind ?? '';
}

function classNameOf(payload: unknown): string {
  return ((payload as { className?: string } | null | undefined)?.className ?? '').trim();
}

// ── KPI sheet ─────────────────────────────────────────────────────────────────

/** Minimal ship-level shape the KPI sheet reads beyond the loadout occupants. */
export interface KpiShipInput {
  flight?: {
    scmSpeed: number | null;
    maxSpeed: number | null;
    // schema 3 (MASTER §14): forward boost and the three angular rates. All
    // optional — a pre-schema-3 payload simply leaves the KPIs as gaps.
    boostSpeed?: number | null;
    pitch?: number | null;
    yaw?: number | null;
    roll?: number | null;
  } | null;
  /** schema 3: hull HP + hull mass from the vehicle XML. */
  hull?: { hp: number | null; mass: number | null } | null;
  /** schema 3: `ARMR_<Ship>` armour HP. */
  armorHp?: number | null;
  /** schema 3: cargo grid capacity in SCU. */
  cargoScu?: number | null;
  /** Ship-level whitelisted stats (currently just SSCSignatureSystemParams, when present). */
  stats?: Record<string, Record<string, unknown>> | null;
}

export type KpiSheet = Record<KpiKey, number | null>;

const EMPTY_SHEET: KpiSheet = {
  alpha: null,
  burstDps: null,
  sustainedDps: null,
  missiles: null,
  shieldHp: null,
  shieldRegen: null,
  hullHp: null,
  effectiveHp: null,
  cargo: null,
  mass: null,
  scm: null,
  maxSpeed: null,
  boost: null,
  agility: null,
  armorHp: null,
  quantumSpeed: null,
  quantumRange: null,
  spool: null,
  ir: null,
  emIdle: null,
  emMax: null,
  crossSection: null,
};

// Field-name candidates for the ship's signature struct.
//
// VERIFIED against the live Nomad (`SSCSignatureSystemParams`): the struct
// carries NO scalar IR/EM fields at all — `baseSignatureParams` and
// `emissionModifierParams` are null. IR/EM stay permanent gaps (there is no
// field name to fix, unlike the earlier "unverified guess" state); the
// candidate lists below are kept only so a future patch that DOES add real
// scalars here starts working without a code change.
const IR_FIELDS = ['infrared', 'infraredEmittance', 'baseInfraredValue', 'infraredSignature'];
const EM_IDLE_FIELDS = ['electromagneticIdle', 'emIdle', 'electromagneticEmittanceIdle', 'idleElectromagnetic'];
const EM_MAX_FIELDS = ['electromagneticMax', 'emMax', 'electromagneticEmittanceMax', 'maxElectromagnetic'];
// The one real signature value: the radar cross-section Vec3, projected by
// the extractor as `crossSection.x/y/z` (see dataforge_extract.py
// `_add_cross_section`). One axis per candidate list.
const CROSS_SECTION_X_FIELDS = ['crossSection.x'];
const CROSS_SECTION_Y_FIELDS = ['crossSection.y'];
const CROSS_SECTION_Z_FIELDS = ['crossSection.z'];

/** The three raw cross-section axes (metres², CryEngine units), each `null`
 * when absent. Exported so the Schiff panel can show all three honestly
 * instead of collapsing them into one number. */
export function crossSectionAxes(
  shipStats: Record<string, Record<string, unknown>> | null | undefined,
): { x: number | null; y: number | null; z: number | null } {
  return {
    x: usable(findStat(shipStats ?? undefined, 'signature', CROSS_SECTION_X_FIELDS)),
    y: usable(findStat(shipStats ?? undefined, 'signature', CROSS_SECTION_Y_FIELDS)),
    z: usable(findStat(shipStats ?? undefined, 'signature', CROSS_SECTION_Z_FIELDS)),
  };
}

// The KPI band and swap-comparison columns need ONE comparable number per
// ship, not three. We use the MAXIMUM of the three axes — the largest
// visible profile a detector could pick up from its worst angle — rather
// than an average or the "depth" axis alone, since neither of those is a
// meaningful "how stealthy is this ship" figure on its own.
function crossSectionMax(axes: { x: number | null; y: number | null; z: number | null }): number | null {
  const vals = [axes.x, axes.y, axes.z].filter((v): v is number => v !== null);
  return vals.length > 0 ? Math.max(...vals) : null;
}

/** Aggregate the six-cell KPI raw values from one resolved loadout. */
export function computeKpiSheet(
  occupants: readonly SummaryOccupant[],
  ship: KpiShipInput | null | undefined,
): KpiSheet {
  const sheet: KpiSheet = { ...EMPTY_SHEET };

  let totalAlpha = 0;
  let totalDps = 0;
  let gunCount = 0;
  let missileDamage = 0;
  let missileCount = 0;
  let shieldHp = 0;
  let shieldRegen = 0;
  let shieldCount = 0;

  for (const o of occupants) {
    if ((o.section === 'weapons' || o.section === 'remoteTurrets') && entityKindOf(o) === 'weapon') {
      const alpha = alphaDamage(o.ammoPayload) ?? alphaDamage(o.payload);
      if (alpha !== null) {
        gunCount += o.count;
        totalAlpha += alpha * o.count;
        const fireRate = toFiniteNumber(
          (o.payload as { weaponParams?: Record<string, unknown> } | undefined)?.weaponParams?.[
            'fireRate'
          ] ?? null,
        );
        const dps = damagePerSecond(alpha, fireRate);
        if (dps !== null) totalDps += dps * o.count;
      }
    }
    if (o.section === 'missiles') {
      const alpha = alphaDamage(o.ammoPayload) ?? alphaDamage(o.payload);
      if (alpha !== null) {
        missileDamage += alpha * o.count;
        missileCount += o.count;
      }
    }
    if (componentKindOf(o.payload) === 'Shield') {
      shieldCount += o.count;
      const stats = statsOf(o.payload);
      const hp = usable(findStat(stats, 'shield', ['MaxShieldHealth']));
      if (hp !== null) shieldHp += hp * o.count;
      const regen = usable(findStat(stats, 'shield', ['MaxShieldRegen']));
      if (regen !== null) shieldRegen += regen * o.count;
    }
    if (componentKindOf(o.payload) === 'QuantumDrive') {
      const stats = statsOf(o.payload);
      sheet.quantumSpeed = usable(findStat(stats, 'quantum', ['params.driveSpeed', 'driveSpeed']));
      sheet.quantumRange = usable(findStat(stats, 'quantum', ['jumpRange']));
      sheet.spool = usable(findStat(stats, 'quantum', ['params.spoolUpTime', 'spoolUpTime']));
    }
  }

  sheet.alpha = gunCount > 0 ? usable(totalAlpha) : null;
  // The extract does not distinguish a "burst" fire rate from the sustained
  // one — a weapon fires at its one documented `fireRate` until it stops, so
  // both KPI cells show the SAME derived continuous-fire number rather than
  // inventing a separate burst figure.
  sheet.burstDps = totalDps > 0 ? usable(totalDps) : null;
  sheet.sustainedDps = sheet.burstDps;
  sheet.missiles = missileCount > 0 ? usable(missileDamage) : null;
  sheet.shieldHp = shieldCount > 0 ? usable(shieldHp) : null;
  sheet.shieldRegen = shieldCount > 0 ? usable(shieldRegen) : null;
  sheet.mass = equippedMass(occupants);
  sheet.scm = usable(toFiniteNumber(ship?.flight?.scmSpeed ?? null));
  sheet.maxSpeed = usable(toFiniteNumber(ship?.flight?.maxSpeed ?? null));
  sheet.boost = usable(toFiniteNumber(ship?.flight?.boostSpeed ?? null));
  // Agility = the mean of the three angular rates (deg/s). One comparable
  // number for the ranking radar; the Schiff panel still shows all three.
  const rates = [ship?.flight?.pitch, ship?.flight?.yaw, ship?.flight?.roll]
    .map((v) => usable(toFiniteNumber(v ?? null)))
    .filter((v): v is number => v !== null);
  sheet.agility = rates.length > 0 ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : null;
  sheet.armorHp = usable(toFiniteNumber(ship?.armorHp ?? null));
  sheet.cargo = usable(toFiniteNumber(ship?.cargoScu ?? null));
  sheet.hullHp = usable(toFiniteNumber(ship?.hull?.hp ?? null));
  if (sheet.hullHp !== null && sheet.shieldHp !== null) sheet.effectiveHp = sheet.hullHp + sheet.shieldHp;

  const shipStats = ship?.stats ?? undefined;
  sheet.ir = usable(findStat(shipStats, 'signature', IR_FIELDS));
  sheet.emIdle = usable(findStat(shipStats, 'signature', EM_IDLE_FIELDS));
  sheet.emMax = usable(findStat(shipStats, 'signature', EM_MAX_FIELDS));
  sheet.crossSection = crossSectionMax(crossSectionAxes(shipStats));

  // hullHp, effectiveHp and cargo have no source in the 4.9.0 extract — stay
  // gaps (null) rather than guessed zeros. effectiveHp only ever fills in once
  // BOTH hull and shield HP exist; see `computeKpiSheet` callers.
  return sheet;
}

// ── deltas (03-rules §3.5) ────────────────────────────────────────────────────

export interface KpiDelta {
  direction: 'up' | 'down';
  /** True when this direction is an improvement for the stat (mass down = better). */
  good: boolean;
  /** "+12%" / "-4%" — null when the change is under 0.5% (dropped, not rounded to 0%). */
  pctText: string | null;
  raw: number;
}

/**
 * KPIs where a SMALLER number is the better outcome: mass, spool-up time and
 * every signature (a stealthier ship emits LESS). MASTER §12 asks for exactly
 * one named decider for the up/down colour — this set is it, exposed through
 * {@link kpiLowerIsBetter} for the dock facts and the picker columns.
 */
const LOWER_IS_BETTER: ReadonlySet<KpiKey> = new Set<KpiKey>([
  'mass',
  'spool',
  'ir',
  'emIdle',
  'emMax',
  'crossSection',
]);

export function kpiLowerIsBetter(key: KpiKey): boolean {
  return LOWER_IS_BETTER.has(key);
}

/**
 * The delta chip for one KPI: stock → current. Returns null when either side
 * is a gap, or when the two sides are numerically equal — "±0 renders nothing"
 * is the rule, not "renders a flat/neutral chip" (03-rules §3.5).
 */
export function computeKpiDelta(
  key: KpiKey,
  stock: number | null,
  current: number | null,
): KpiDelta | null {
  if (stock == null || current == null) return null;
  const diff = current - stock;
  if (diff === 0) return null;
  const direction: 'up' | 'down' = diff > 0 ? 'up' : 'down';
  const downIsBetter = LOWER_IS_BETTER.has(key);
  const good = downIsBetter ? direction === 'down' : direction === 'up';
  const pct = stock !== 0 ? (Math.abs(diff) / Math.abs(stock)) * 100 : null;
  const pctText = pct != null && pct >= 0.5 ? `${diff > 0 ? '+' : '-'}${Math.round(pct)}%` : null;
  return { direction, good, pctText, raw: diff };
}

// ── KPI band cells ───────────────────────────────────────────────────────────

interface KpiMeta {
  labelKey: string;
  format: EquippedStatFormat;
  gapKey: string;
}

const KPI_META: Record<KpiKey, KpiMeta> = {
  alpha: { labelKey: 'codex.kpi.alpha', format: 'dec', gapKey: 'codex.summary.gap.noStockGuns' },
  burstDps: { labelKey: 'codex.kpi.burstDps', format: 'perSec', gapKey: 'codex.summary.gap.noFireRate' },
  sustainedDps: {
    labelKey: 'codex.kpi.sustainedDps',
    format: 'perSec',
    gapKey: 'codex.summary.gap.noFireRate',
  },
  missiles: { labelKey: 'codex.kpi.missiles', format: 'dec', gapKey: 'codex.summary.gap.noMissiles' },
  shieldHp: { labelKey: 'codex.kpi.shieldHp', format: 'int', gapKey: 'codex.summary.gap.noShields' },
  shieldRegen: { labelKey: 'codex.kpi.shieldRegen', format: 'perSec', gapKey: 'codex.summary.gap.noShields' },
  hullHp: { labelKey: 'codex.kpi.hullHp', format: 'int', gapKey: 'codex.summary.gap.noHullMass' },
  effectiveHp: { labelKey: 'codex.kpi.effectiveHp', format: 'int', gapKey: 'codex.summary.gap.noHullMass' },
  cargo: { labelKey: 'codex.kpi.cargo', format: 'int', gapKey: 'codex.summary.gap.noCargoCapacity' },
  mass: { labelKey: 'codex.kpi.mass', format: 'int', gapKey: 'codex.summary.gap.noEquipmentMass' },
  scm: { labelKey: 'codex.kpi.scm', format: 'mps', gapKey: 'codex.summary.gap.noFlight' },
  maxSpeed: { labelKey: 'codex.kpi.maxSpeed', format: 'mps', gapKey: 'codex.summary.gap.noFlight' },
  boost: { labelKey: 'codex.kpi.boost', format: 'mps', gapKey: 'codex.summary.gap.noFlight' },
  agility: { labelKey: 'codex.kpi.agility', format: 'dec', gapKey: 'codex.summary.gap.noFlight' },
  armorHp: { labelKey: 'codex.kpi.armor', format: 'int', gapKey: 'codex.summary.gap.noArmorStats' },
  quantumSpeed: { labelKey: 'codex.kpi.quantumSpeed', format: 'kms', gapKey: 'codex.summary.gap.noQuantum' },
  quantumRange: { labelKey: 'codex.kpi.quantumRange', format: 'gm', gapKey: 'codex.summary.gap.noQuantum' },
  spool: { labelKey: 'codex.kpi.spool', format: 'seconds', gapKey: 'codex.summary.gap.noQuantum' },
  // IR/EM: not a missing extract, the game files never carry these scalars
  // (see the CROSS_SECTION_*_FIELDS comment above) — distinct gap wording.
  ir: { labelKey: 'codex.kpi.ir', format: 'int', gapKey: 'codex.summary.gap.noEmissionModel' },
  emIdle: { labelKey: 'codex.kpi.emIdle', format: 'int', gapKey: 'codex.summary.gap.noEmissionModel' },
  emMax: { labelKey: 'codex.kpi.emMax', format: 'int', gapKey: 'codex.summary.gap.noEmissionModel' },
  crossSection: { labelKey: 'codex.kpi.crossSection', format: 'int', gapKey: 'codex.summary.gap.noSignature' },
};

export interface KpiCell {
  key: KpiKey;
  labelKey: string;
  format: EquippedStatFormat;
  value: number | null;
  delta: KpiDelta | null;
  /** The mission's lead metric — the cell the KPI band should visually accent. */
  accent: boolean;
  gapKey: string | null;
}

/** The six KPI-band cells for the active mission, stock vs. current draft. */
export function buildKpiCells(mission: MissionDef, stock: KpiSheet, current: KpiSheet): KpiCell[] {
  return mission.kpis.map((key, i) => {
    const meta = KPI_META[key];
    const value = current[key];
    return {
      key,
      labelKey: meta.labelKey,
      format: meta.format,
      value,
      delta: computeKpiDelta(key, stock[key], value),
      accent: i === 0,
      gapKey: value == null ? meta.gapKey : null,
    };
  });
}

// ── offensive panel ──────────────────────────────────────────────────────────

export interface WeaponRow {
  className: string;
  size: number | null;
  alpha: number | null;
  sustainedDps: number | null;
  burstDps: number | null;
}

export interface OffensivePanel {
  weaponCount: number;
  weaponRows: WeaponRow[];
  hasAlphaColumn: boolean;
  hasDpsColumn: boolean;
  footerAlpha: number | null;
  footerDps: number | null;
  damageChannelTotals: { channel: string; value: number }[];
  effectiveRange: number | null;
  longestRangeGun: string | null;
  mixedRangeWarning: boolean;
  projectileSpeed: number | null;
  missileCount: number;
  missileSalvoDamage: number | null;
  missileLockTime: number | null;
  missileLockNoteSlowest: boolean;
  missileRange: number | null;
  missileSignalTypes: string[];
  gapKeys: string[];
}

// A mixed-range gun loadout is worth flagging once the longest gun outranges
// the fleet's effective (shortest) range by more than 15% (03-rules §3.1).
const MIXED_RANGE_THRESHOLD = 1.15;

export function buildOffensivePanel(occupants: readonly SummaryOccupant[]): OffensivePanel {
  const rows: WeaponRow[] = [];
  let footerAlpha = 0;
  let footerDps = 0;
  let hasAlpha = false;
  let hasDps = false;
  const channelTotals = new Map<string, number>();
  const ranges: { range: number; className: string }[] = [];
  const speeds: number[] = [];

  for (const o of occupants) {
    if (o.section !== 'weapons' && o.section !== 'remoteTurrets') continue;
    if (entityKindOf(o) !== 'weapon') continue;
    const p = o.payload as { className?: string; size?: number | null; weaponParams?: Record<string, unknown> } | null;
    const alpha = alphaDamage(o.ammoPayload) ?? alphaDamage(o.payload);
    if (alpha === null) continue;
    const fireRate = toFiniteNumber(p?.weaponParams?.['fireRate'] ?? null);
    const dps = damagePerSecond(alpha, fireRate);
    for (let i = 0; i < o.count; i++) {
      rows.push({
        className: classNameOf(p) || 'unknown',
        size: toFiniteNumber(p?.size ?? null),
        alpha,
        sustainedDps: dps,
        burstDps: dps,
      });
    }
    footerAlpha += alpha * o.count;
    hasAlpha = true;
    if (dps !== null) {
      footerDps += dps * o.count;
      hasDps = true;
    }

    for (const c of impactDamageChannels(o.ammoPayload ?? o.payload)) {
      channelTotals.set(c.channel, (channelTotals.get(c.channel) ?? 0) + c.value * o.count);
    }
    const ammo = o.ammoPayload as { speed?: number | null; lifetime?: number | null } | undefined;
    const range = projectileRange(ammo?.speed, ammo?.lifetime);
    if (range !== null) ranges.push({ range, className: classNameOf(p) });
    const speed = usable(toFiniteNumber(ammo?.speed ?? null));
    if (speed !== null) speeds.push(speed);
  }

  const effectiveRange = ranges.length > 0 ? Math.min(...ranges.map((r) => r.range)) : null;
  const maxRange = ranges.length > 0 ? Math.max(...ranges.map((r) => r.range)) : null;
  const longestRangeGun =
    effectiveRange !== null && maxRange !== null && maxRange > effectiveRange
      ? ranges.find((r) => r.range === maxRange)?.className ?? null
      : null;
  const mixedRangeWarning =
    effectiveRange !== null && maxRange !== null && maxRange > effectiveRange * MIXED_RANGE_THRESHOLD;
  const projectileSpeed = speeds.length > 0 ? Math.min(...speeds) : null;

  let missileCount = 0;
  let missileDamage = 0;
  let missileMaxLock: number | null = null;
  let missileMinRange: number | null = null;
  const signalTypes = new Set<string>();
  for (const o of occupants) {
    if (o.section !== 'missiles') continue;
    const p = o.payload as { weaponParams?: Record<string, unknown>; subType?: string | null } | null;
    const alpha = alphaDamage(o.ammoPayload) ?? alphaDamage(o.payload);
    if (alpha !== null) {
      missileDamage += alpha * o.count;
      missileCount += o.count;
    }
    const lock = usable(
      toFiniteNumber(p?.weaponParams?.['lockTime'] ?? p?.weaponParams?.['timeToLock'] ?? null),
    );
    if (lock !== null) missileMaxLock = missileMaxLock === null ? lock : Math.max(missileMaxLock, lock);
    const ammo = o.ammoPayload as { speed?: number | null; lifetime?: number | null } | undefined;
    const range = projectileRange(ammo?.speed, ammo?.lifetime);
    if (range !== null) missileMinRange = missileMinRange === null ? range : Math.min(missileMinRange, range);
    const sig = (p?.subType ?? '').trim();
    if (sig) signalTypes.add(sig);
  }

  const gapKeys: string[] = [];
  if (rows.length === 0) gapKeys.push('codex.summary.gap.noStockGuns');
  else if (!hasDps) gapKeys.push('codex.summary.gap.noFireRate');

  return {
    weaponCount: rows.length,
    weaponRows: rows,
    hasAlphaColumn: hasAlpha,
    hasDpsColumn: hasDps,
    footerAlpha: hasAlpha ? footerAlpha : null,
    footerDps: hasDps ? footerDps : null,
    damageChannelTotals: [...channelTotals.entries()].map(([channel, value]) => ({ channel, value })),
    effectiveRange,
    longestRangeGun,
    mixedRangeWarning,
    projectileSpeed,
    missileCount,
    missileSalvoDamage: missileCount > 0 ? usable(missileDamage) : null,
    missileLockTime: missileMaxLock,
    missileLockNoteSlowest: missileMaxLock !== null,
    missileRange: missileMinRange,
    missileSignalTypes: [...signalTypes],
    gapKeys,
  };
}

// ── defensive panel ──────────────────────────────────────────────────────────

export interface ArmorFacts {
  reductionPhysicalPct: number | null;
  reductionEnergyPct: number | null;
  reductionDistortionPct: number | null;
  /** VERIFIED absolute value (e.g. Nomad `0.2`), NOT a multiplier — no
   * `1 - x` reduction math applied, unlike the `reduction*Pct` fields. */
  penetrationReduction: number | null;
  /** VERIFIED absolute values (e.g. Nomad phys `10.0` / energy `9.0`),
   * NOT multipliers — same as `penetrationReduction`. */
  deflectionPhysical: number | null;
  deflectionEnergy: number | null;
}

export interface DefensivePanel {
  shieldHp: number | null;
  shieldRegen: number | null;
  fullInSeconds: number | null;
  regenDelay: number | null;
  downedDelay: number | null;
  shieldGeneratorCount: number;
  mixedGeneratorNote: boolean;
  resistances: { channel: string; pct: number }[];
  armor: ArmorFacts | null;
  hullHp: number | null;
  effectiveHp: number | null;
  gapKeys: string[];
}

const RESISTANCE_FIELDS: Readonly<Record<string, string[]>> = {
  physical: ['physicalResistance', 'PhysicalResistance'],
  energy: ['energyResistance', 'EnergyResistance'],
  distortion: ['distortionResistance', 'DistortionResistance'],
};

// SCItemVehicleArmorParams field names, VERIFIED against the live
// `ARMR_CNOU_Nomad`: per-channel multipliers under `damageMultiplier.*`
// (reduction % = `(1 - multiplier) * 100`, e.g. 0.7 -> "30% less damage
// taken"), and two ABSOLUTE (not multiplier) sub-structs —
// `armorPenetrationResistance.basePenetrationReduction` and
// `armorDeflection.deflectionValue.{DamagePhysical,DamageEnergy}` — which
// pass through unscaled, never run through the `1 - x` reduction math.
function armorReductionOf(stats: Record<string, Record<string, unknown>> | undefined): ArmorFacts | null {
  if (!stats) return null;
  const physMul = findStat(stats, 'armor', ['damageMultiplier.DamagePhysical']);
  const enMul = findStat(stats, 'armor', ['damageMultiplier.DamageEnergy']);
  const distMul = findStat(stats, 'armor', ['damageMultiplier.DamageDistortion']);
  const penRed = findStat(stats, 'armor', ['armorPenetrationResistance.basePenetrationReduction']);
  const deflPhys = findStat(stats, 'armor', ['armorDeflection.deflectionValue.DamagePhysical']);
  const deflEn = findStat(stats, 'armor', ['armorDeflection.deflectionValue.DamageEnergy']);
  if (
    physMul === null && enMul === null && distMul === null &&
    penRed === null && deflPhys === null && deflEn === null
  ) {
    return null;
  }
  return {
    reductionPhysicalPct: physMul !== null ? (1 - physMul) * 100 : null,
    reductionEnergyPct: enMul !== null ? (1 - enMul) * 100 : null,
    reductionDistortionPct: distMul !== null ? (1 - distMul) * 100 : null,
    penetrationReduction: penRed,
    deflectionPhysical: deflPhys,
    deflectionEnergy: deflEn,
  };
}

/**
 * Survivability read-out. `armorPayload` is the ship's ARMR_ item's payload
 * (found by the caller via `defaultLoadout` className prefix) — null when the
 * ship carries no ARMR_ entry or that entry has no stats.
 */
export function buildDefensivePanel(
  occupants: readonly SummaryOccupant[],
  armorPayload: unknown,
): DefensivePanel {
  const shields: {
    hp: number | null;
    regen: number | null;
    delayDamaged: number | null;
    delayDowned: number | null;
    className: string;
    payload: unknown;
  }[] = [];

  for (const o of occupants) {
    if (componentKindOf(o.payload) !== 'Shield') continue;
    const stats = statsOf(o.payload);
    const hp = usable(findStat(stats, 'shield', ['MaxShieldHealth']));
    const regen = usable(findStat(stats, 'shield', ['MaxShieldRegen']));
    const delayDamaged = usable(findStat(stats, 'shield', ['DamagedRegenDelay']));
    const delayDowned = usable(findStat(stats, 'shield', ['DownedRegenDelay']));
    const className = classNameOf(o.payload);
    for (let i = 0; i < o.count; i++) {
      shields.push({ hp, regen, delayDamaged, delayDowned, className, payload: o.payload });
    }
  }

  const shieldHp = shields.reduce((sum, s) => sum + (s.hp ?? 0), 0);
  const shieldRegen = shields.reduce((sum, s) => sum + (s.regen ?? 0), 0);
  const strongest = shields.reduce<(typeof shields)[number] | null>(
    (best, s) => (best === null || (s.hp ?? 0) > (best.hp ?? 0) ? s : best),
    null,
  );
  const fullInSeconds =
    strongest && strongest.hp != null && strongest.regen != null && strongest.regen > 0
      ? strongest.hp / strongest.regen
      : null;
  const distinctClasses = new Set(shields.map((s) => s.className)).size;

  const resistances: { channel: string; pct: number }[] = [];
  if (strongest) {
    const stats = statsOf(strongest.payload);
    for (const [channel, fields] of Object.entries(RESISTANCE_FIELDS)) {
      const v = usable(findStat(stats, 'shield', fields));
      if (v !== null) resistances.push({ channel, pct: v <= 1 ? v * 100 : v });
    }
  }

  const armorStats = statsOf(armorPayload);
  const armor = armorReductionOf(armorStats);

  const gapKeys: string[] = [];
  if (shields.length === 0) gapKeys.push('codex.summary.gap.noShields');
  gapKeys.push('codex.summary.gap.noHullMass');
  if (!armor) gapKeys.push('codex.summary.gap.noArmorStats');

  return {
    shieldHp: shields.length > 0 ? usable(shieldHp) : null,
    shieldRegen: shields.length > 0 ? usable(shieldRegen) : null,
    fullInSeconds,
    regenDelay: strongest?.delayDamaged ?? null,
    downedDelay: strongest?.delayDowned ?? null,
    shieldGeneratorCount: shields.length,
    mixedGeneratorNote: distinctClasses > 1,
    resistances,
    armor,
    hullHp: null, // not in the 4.9.0 extract — always a gap, never guessed
    effectiveHp: null, // requires hull HP, which is always null today
    gapKeys,
  };
}

/** Finds the ship's own ARMR_ item payload among its resolved loadout occupants. */
export function findArmorPayload(occupants: readonly SummaryOccupant[]): unknown | null {
  for (const o of occupants) {
    const className = classNameOf(o.payload);
    if (className.toUpperCase().startsWith('ARMR_')) return o.payload;
  }
  return null;
}

export { itemMass };
