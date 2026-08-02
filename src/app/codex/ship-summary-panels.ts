// The three headline panels above a ship's module list: Damage, Defence and
// Power Management (admin request 461288f9).
// -----------------------------------------------------------------------------
// Everything here is AGGREGATED from the ship's stock loadout — the same
// payloads the per-hardpoint rows read — so the panels can never disagree with
// the list below them. The hard rule from `codex-equipped-stats` still stands:
// NEVER invent a number. A stat the 4.9.0 extract does not carry is not
// emitted; instead the panel names the gap through a `gapKeys` entry, so a
// pilot reads "the catalog has no hull HP" rather than a confident "0".
//
// What the extract carries today (re-verified against build b77f1586 / 4.9.0):
//   * shields → MaxShieldHealth, MaxShieldRegen, regen delays, DecayRatio
//   * every item → SHealthComponentParams.Health, SDistortionParams.Maximum,
//     SEntityPhysicsControllerParams.PhysType.Mass
//   * guns → alpha damage via the `<class>_AMMO` projectile join
// What it does NOT carry (checked, not assumed):
//   * ship hull HP and per-channel damage resistances (no field anywhere)
//   * power output / power draw (`ItemResourceComponentParams` has priority and
//     self-repair only; `EntityComponentPowerConnection` exists on exactly one
//     non-ship entity in the whole catalog)
//   * weapon fireRate → therefore no aggregate DPS
//   * ship flight characteristics (`payload.flight` is all-null on every ship)

import { EquippedStat, alphaDamage, damagePerSecond } from './codex-equipped-stats';
import { findStat, toFiniteNumber } from '../hangar/loadout-stats';
import { ShipModuleSection } from './ship-module-sections';

/** CryEngine's "unset" sentinel — mirrors codex-equipped-stats. */
const FLT_MAX_SENTINEL = 1e30;

function usable(v: number | null): number | null {
  if (v === null || !Number.isFinite(v) || v <= 0) return null;
  return v >= FLT_MAX_SENTINEL ? null : v;
}

/** One resolved hardpoint occupant, already collapsed to a count. */
export interface SummaryOccupant {
  section: ShipModuleSection;
  /** codex entity kind of the installed item ('weapon' | 'component' | 'item'). */
  kind: string | null;
  /** the installed entity's payload, or null when the port is empty. */
  payload: unknown;
  /** matching `<class>_AMMO` payload for guns, when one exists. */
  ammoPayload?: unknown;
  /** how many identical hardpoints this occupant stands for (≥1). */
  count: number;
}

/** A headline panel: a few aggregate stats plus the gaps it had to admit. */
export interface ShipSummaryPanel {
  key: 'damage' | 'defence' | 'power';
  rows: EquippedStat[];
  /** i18n keys under `codex.summary.gap.*` naming what the extract lacks. */
  gapKeys: string[];
}

function push(
  out: EquippedStat[],
  labelKey: string,
  raw: number | null,
  format: EquippedStat['format'],
  derived = false,
): void {
  const v = usable(raw);
  if (v === null) return;
  out.push(derived ? { labelKey, value: v, format, derived } : { labelKey, value: v, format });
}

function statsOf(payload: unknown): Record<string, Record<string, unknown>> | undefined {
  const s = (payload as { stats?: unknown } | undefined)?.stats;
  return s && typeof s === 'object' ? (s as Record<string, Record<string, unknown>>) : undefined;
}

function componentKindOf(payload: unknown): string {
  return ((payload as { kind?: string } | undefined)?.kind ?? '').trim();
}

function entityKindOf(occupant: SummaryOccupant): string {
  return (
    (occupant.payload as { entityKind?: string } | null | undefined)?.entityKind ??
    occupant.kind ??
    ''
  );
}

/** Per-item mass in kg, as physicalised by the engine. */
export function itemMass(payload: unknown): number | null {
  return usable(findStat(statsOf(payload), 'physics', ['PhysType.Mass']));
}

/** Distortion (EMP) capacity an item can soak before it browns out. */
function distortionPool(payload: unknown): number | null {
  return usable(findStat(statsOf(payload), 'distortion', ['Maximum']));
}

/**
 * Aggregate offence. Sums the alpha damage of every gun the stock loadout
 * actually installs (per-shot, all channels), scaled by hardpoint count, plus
 * the DPS that follows from it — the latter only once the extract carries a
 * real fireRate, which 4.9.0 does not, so it is absent rather than zero.
 */
export function buildDamagePanel(occupants: readonly SummaryOccupant[]): ShipSummaryPanel {
  let totalAlpha = 0;
  let totalDps = 0;
  let gunCount = 0;
  let mountCount = 0;
  let ordnanceCount = 0;

  for (const o of occupants) {
    if (o.section === 'weapons' || o.section === 'remoteTurrets') mountCount += o.count;
    // Countermeasures moved into their own block (1add86a4) but are still
    // ordnance hardpoints — the headline count must not silently shrink.
    if (o.section === 'missiles' || o.section === 'countermeasures') ordnanceCount += o.count;
    if (entityKindOf(o) !== 'weapon') continue;
    const alpha = alphaDamage(o.ammoPayload) ?? alphaDamage(o.payload);
    if (alpha === null) continue;
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

  const rows: EquippedStat[] = [];
  push(rows, 'codex.summary.alphaDamage', totalAlpha, 'dec', true);
  push(rows, 'codex.summary.dps', totalDps, 'dec', true);
  push(rows, 'codex.summary.weaponMounts', mountCount, 'int');
  push(rows, 'codex.summary.ordnanceMounts', ordnanceCount, 'int');

  const gapKeys: string[] = [];
  if (gunCount === 0) gapKeys.push('codex.summary.gap.noStockGuns');
  else if (totalDps === 0) gapKeys.push('codex.summary.gap.noFireRate');
  return { key: 'damage', rows, gapKeys };
}

/**
 * Aggregate survivability: total shield pool and regeneration across every
 * installed generator, the slowest regen delay (the one that actually decides
 * when you are safe again), and the distortion pool. Hull HP and per-channel
 * resistances are NOT in the extract — the panel says so instead of guessing.
 */
export function buildDefencePanel(occupants: readonly SummaryOccupant[]): ShipSummaryPanel {
  let shieldHp = 0;
  let shieldRegen = 0;
  let regenDelay = 0;
  let downedDelay = 0;
  let distortion = 0;
  let hullHp = 0;
  let shieldCount = 0;

  for (const o of occupants) {
    const stats = statsOf(o.payload);
    const dist = distortionPool(o.payload);
    if (dist !== null) distortion += dist * o.count;
    if (componentKindOf(o.payload) !== 'Shield') continue;
    shieldCount += o.count;
    const hp = usable(findStat(stats, 'shield', ['MaxShieldHealth']));
    if (hp !== null) shieldHp += hp * o.count;
    const regen = usable(findStat(stats, 'shield', ['MaxShieldRegen']));
    if (regen !== null) shieldRegen += regen * o.count;
    regenDelay = Math.max(regenDelay, usable(findStat(stats, 'shield', ['DamagedRegenDelay'])) ?? 0);
    downedDelay = Math.max(downedDelay, usable(findStat(stats, 'shield', ['DownedRegenDelay'])) ?? 0);
  }

  const rows: EquippedStat[] = [];
  push(rows, 'codex.summary.shieldHp', shieldHp, 'int', true);
  push(rows, 'codex.summary.shieldRegen', shieldRegen, 'perSec', true);
  push(rows, 'codex.summary.regenDelay', regenDelay, 'seconds');
  push(rows, 'codex.summary.downedDelay', downedDelay, 'seconds');
  push(rows, 'codex.summary.hullHp', hullHp, 'int');
  push(rows, 'codex.summary.distortionPool', distortion, 'int', true);

  const gapKeys: string[] = [];
  if (shieldCount === 0) gapKeys.push('codex.summary.gap.noShields');
  gapKeys.push('codex.summary.gap.noHullHp');
  gapKeys.push('codex.summary.gap.noResistances');
  return { key: 'defence', rows, gapKeys };
}

/**
 * Power management, as far as the catalog allows: how much generation is
 * bolted on (plants, their combined size class), how much of the grid can be
 * knocked offline by distortion, and the durability of the generators. The
 * per-item draw/output numbers a real power triangle needs are not extracted —
 * named as a gap rather than faked.
 */
export function buildPowerPanel(occupants: readonly SummaryOccupant[]): ShipSummaryPanel {
  let plants = 0;
  let plantSize = 0;
  let plantHealth = 0;
  let plantDistortion = 0;
  let poweredItems = 0;
  let powerDraw = 0;

  for (const o of occupants) {
    if (!o.payload) continue;
    poweredItems += o.count;
    const draw = usable(
      findStat(statsOf(o.payload), 'power', ['PowerDraw', 'PowerBase']),
    );
    if (draw !== null) powerDraw += draw * o.count;
    if (componentKindOf(o.payload) !== 'PowerPlant') continue;
    plants += o.count;
    const size = usable(toFiniteNumber((o.payload as { size?: unknown }).size));
    if (size !== null) plantSize += size * o.count;
    const health = usable(findStat(statsOf(o.payload), 'health', ['Health']));
    if (health !== null) plantHealth += health * o.count;
    const dist = distortionPool(o.payload);
    if (dist !== null) plantDistortion += dist * o.count;
  }

  const rows: EquippedStat[] = [];
  push(rows, 'codex.summary.powerPlants', plants, 'int');
  push(rows, 'codex.summary.powerPlantSize', plantSize, 'int', true);
  push(rows, 'codex.summary.powerDraw', powerDraw, 'dec', true);
  push(rows, 'codex.summary.poweredItems', poweredItems, 'int');
  push(rows, 'codex.summary.plantDurability', plantHealth, 'int', true);
  push(rows, 'codex.summary.plantDistortion', plantDistortion, 'int', true);

  const gapKeys: string[] = [];
  if (plants === 0) gapKeys.push('codex.summary.gap.noPowerPlant');
  if (powerDraw === 0) gapKeys.push('codex.summary.gap.noPowerDraw');
  return { key: 'power', rows, gapKeys };
}

/** All three headline panels, in display order. */
export function buildShipSummaryPanels(
  occupants: readonly SummaryOccupant[],
): ShipSummaryPanel[] {
  return [
    buildDamagePanel(occupants),
    buildDefencePanel(occupants),
    buildPowerPanel(occupants),
  ];
}

/**
 * Combined mass of everything the stock loadout installs, in kg. Derived (a
 * sum), and explicitly NOT the ship's mass — the extract carries no hull mass,
 * so the UI must label this as the equipment total it is.
 */
export function equippedMass(occupants: readonly SummaryOccupant[]): number | null {
  let total = 0;
  for (const o of occupants) {
    const m = itemMass(o.payload);
    if (m !== null) total += m * o.count;
  }
  return total > 0 ? total : null;
}
