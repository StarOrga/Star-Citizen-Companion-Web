// Folded-module preview chips ("fold-peek", MASTER §6 / B-C8).
// -----------------------------------------------------------------------------
// PURE DOMAIN MODULE. A folded `<details>` summary shows the module's content as
// value chips — `2× S1 WEB aktiv · 4.320 HP` — plus one aggregate chip and the
// "zum Ändern aufklappen" lock hint. No controls, no strings: the model emits
// numbers and i18n KEYS, the component renders them.
//
// One builder per section kind, because the interesting figure differs: shields
// show HP (and the pool), weapons show alpha damage (and the sum), missiles show
// damage, power plants show generated segments, coolers coolant output, quantum
// the jump range. Anything else falls back to a bare census chip — never an
// invented figure.

import { alphaDamage, damagePerSecond, EquippedStatFormat } from './codex-equipped-stats';
import { humanizeClassName } from './codex-format';
import { findStat, toFiniteNumber } from '../hangar/loadout-stats';
import { isPassiveShield, occupantDraw } from './codex-power';
import type { SummaryOccupant } from './ship-summary-panels';
import type { ShipModuleSection } from './ship-module-sections';

export interface FoldPeekChip {
  /** stable id (dedupe key) — `<className>:<role>`. */
  id: string;
  /** how many identical hardpoints this chip stands for. */
  count: number;
  /** hardpoint size, null when the payload carries none. */
  size: number | null;
  /** short display name, already humanized when the extract has no localized one. */
  name: string;
  /** `codex.module.role.*` — "aktiv" / "passiv" / null when the kind has no role split. */
  roleKey: string | null;
  /** the chip's number (already ×count), null = the module carries no figure. */
  figure: number | null;
  format: EquippedStatFormat;
  /** unit label key, e.g. `codex.equipped.shieldHp`. */
  unitKey: string | null;
  /** set on the aggregate chip instead of name/role, e.g. `codex.module.peek.pool`. */
  labelKey: string | null;
}

export interface FoldPreview {
  section: ShipModuleSection;
  chips: FoldPeekChip[];
  /** the module aggregate ("Pool 6.480"), null when nothing sums honestly. */
  aggregate: FoldPeekChip | null;
  /** always the same hint — kept in the model so every module says it once. */
  lockKey: string;
  /** census for the summary's right slot: `3 Slots · 2 aktiv · 1 passiv`. */
  census: { slots: number; active: number; passive: number };
}

export const FOLD_PEEK_LOCK_KEY = 'codex.module.peekChange';

function statsOf(payload: unknown): Record<string, Record<string, unknown>> | undefined {
  const s = (payload as { stats?: unknown } | null | undefined)?.stats;
  return s && typeof s === 'object' ? (s as Record<string, Record<string, unknown>>) : undefined;
}

function nameOf(payload: unknown): string {
  const p = payload as
    | { name?: { de?: string; en?: string }; className?: string }
    | null
    | undefined;
  const localized = p?.name?.de || p?.name?.en || '';
  if (localized.trim()) return localized.trim();
  return p?.className ? humanizeClassName(p.className) : '';
}

function sizeOf(payload: unknown): number | null {
  return toFiniteNumber((payload as { size?: unknown } | null | undefined)?.size ?? null);
}

function classOf(payload: unknown): string {
  return ((payload as { className?: string } | null | undefined)?.className ?? '').trim();
}

// The passive-shield rule lives in `codex-power.ts` so the dock and this
// preview can never disagree about which generator is on the net (R2).
// Re-exported here because the fold preview is where callers first meet it.
export { isPassiveShield };

function chip(
  occupant: SummaryOccupant,
  roleKey: string | null,
  figure: number | null,
  format: EquippedStatFormat,
  unitKey: string | null,
): FoldPeekChip {
  return {
    id: `${classOf(occupant.payload)}:${roleKey ?? ''}`,
    count: Math.max(1, occupant.count || 1),
    size: sizeOf(occupant.payload),
    name: nameOf(occupant.payload),
    roleKey,
    figure,
    format,
    unitKey,
    labelKey: null,
  };
}

function aggregateChip(labelKey: string, figure: number, format: EquippedStatFormat): FoldPeekChip {
  return {
    id: labelKey,
    count: 0,
    size: null,
    name: '',
    roleKey: null,
    figure,
    format,
    unitKey: null,
    labelKey,
  };
}

function empty(section: ShipModuleSection): FoldPreview {
  return {
    section,
    chips: [],
    aggregate: null,
    lockKey: FOLD_PEEK_LOCK_KEY,
    census: { slots: 0, active: 0, passive: 0 },
  };
}

/** Shields: one chip per generator (active/passive), aggregate = the HP pool. */
export function buildShieldPreview(occupants: readonly SummaryOccupant[]): FoldPreview {
  const out = empty('shields');
  let pool = 0;
  let poolKnown = false;
  for (const o of occupants) {
    const count = Math.max(1, o.count || 1);
    const passive = isPassiveShield(o);
    const hpEach = findStat(statsOf(o.payload), 'shield', ['MaxShieldHealth']);
    const total = hpEach != null ? hpEach * count : null;
    if (total != null) {
      pool += total;
      poolKnown = true;
    }
    out.chips.push(
      chip(
        o,
        passive ? 'codex.module.badge.passive' : 'codex.module.badge.active',
        total,
        'int',
        'codex.equipped.shieldHp',
      ),
    );
    out.census.slots += count;
    if (passive) out.census.passive += count;
    else out.census.active += count;
  }
  out.aggregate = poolKnown ? aggregateChip('codex.module.badge.pool', pool, 'int') : null;
  return out;
}

/** Fire rate the extract carries on a gun payload, read the same way the KPI
 * sheet does (`codex-loadout-stats.ts`) — so the peek and the KPI band can
 * never disagree about which weapons already have a computable DPS. */
function fireRateOf(payload: unknown): number | null {
  return toFiniteNumber(
    (payload as { weaponParams?: Record<string, unknown> } | null | undefined)?.weaponParams?.['fireRate'] ?? null,
  );
}

/** One-shot alpha-sum preview (missiles: the salvo, not a rate). */
function buildAlphaPreview(
  occupants: readonly SummaryOccupant[],
  section: ShipModuleSection,
  aggregateLabelKey: string,
): FoldPreview {
  const out = empty(section);
  let sum = 0;
  let known = false;
  for (const o of occupants) {
    const count = Math.max(1, o.count || 1);
    const alpha = alphaDamage(o.ammoPayload) ?? alphaDamage(o.payload);
    const total = alpha != null ? Math.round(alpha * count * 100) / 100 : null;
    if (total != null) {
      sum += total;
      known = true;
    }
    out.chips.push(chip(o, null, total, 'dec', 'codex.equipped.alphaDamage'));
    out.census.slots += count;
    out.census.active += count;
  }
  out.aggregate = known ? aggregateChip(aggregateLabelKey, Math.round(sum * 100) / 100, 'dec') : null;
  return out;
}

/**
 * Weapons / remote turrets: sustained DPS per chip, aggregate = Σ Dauer-DPS —
 * the same headline figure the concept's fold-peek and expanded row both
 * quote ("837 Dauer-DPS", concept/part-06.html:316 + :324). A salvo's alpha
 * answers "how much does one shot do"; the concept peek answers "how hard
 * does this ship hit over a fight", which is the fire-rate-derived rate.
 */
export function buildWeaponPreview(
  occupants: readonly SummaryOccupant[],
  section: ShipModuleSection = 'weapons',
): FoldPreview {
  const out = empty(section);
  let sum = 0;
  let known = false;
  for (const o of occupants) {
    const count = Math.max(1, o.count || 1);
    const alpha = alphaDamage(o.ammoPayload) ?? alphaDamage(o.payload);
    const dps = alpha != null ? damagePerSecond(alpha, fireRateOf(o.ammoPayload) ?? fireRateOf(o.payload)) : null;
    const total = dps != null ? Math.round(dps * count * 100) / 100 : null;
    if (total != null) {
      sum += total;
      known = true;
    }
    out.chips.push(chip(o, null, total, 'dec', 'codex.equipped.sustainedDps'));
    out.census.slots += count;
    out.census.active += count;
  }
  out.aggregate = known
    ? aggregateChip('codex.module.peek.sustainedDpsTotal', Math.round(sum * 100) / 100, 'dec')
    : null;
  return out;
}

/** Missiles: damage per rack, aggregate = Σ salvo damage (concept "Salve gesamt"). */
export function buildMissilePreview(occupants: readonly SummaryOccupant[]): FoldPreview {
  return buildAlphaPreview(occupants, 'missiles', 'codex.module.peek.missileTotal');
}

/** Power plants: generated segments, aggregate = the reactor budget. */
export function buildPowerPlantPreview(occupants: readonly SummaryOccupant[]): FoldPreview {
  const out = empty('powerPlants');
  let sum = 0;
  let known = false;
  for (const o of occupants) {
    const draw = occupantDraw(o);
    const value = draw.missing ? null : draw.generateSegments;
    if (value != null && value > 0) {
      sum += value;
      known = true;
    }
    out.chips.push(chip(o, null, value, 'int', 'codex.energy.unit.segments'));
    out.census.slots += draw.count;
    out.census.active += draw.count;
  }
  out.aggregate = known ? aggregateChip('codex.module.peek.budget', sum, 'int') : null;
  return out;
}

/** Coolers: coolant output, aggregate = total cooling capacity. */
export function buildCoolerPreview(occupants: readonly SummaryOccupant[]): FoldPreview {
  const out = empty('coolers');
  let sum = 0;
  let known = false;
  for (const o of occupants) {
    const draw = occupantDraw(o);
    const value = draw.missing ? null : draw.coolantGenerate;
    if (value != null && value > 0) {
      sum += value;
      known = true;
    }
    out.chips.push(chip(o, null, value, 'perSec', 'codex.energy.unit.coolant'));
    out.census.slots += draw.count;
    out.census.active += draw.count;
  }
  out.aggregate = known
    ? aggregateChip('codex.module.peek.coolingTotal', Math.round(sum * 100) / 100, 'perSec')
    : null;
  return out;
}

/** Quantum drive: jump range per drive, no aggregate (two drives do not add up). */
export function buildQuantumPreview(occupants: readonly SummaryOccupant[]): FoldPreview {
  const out = empty('quantum');
  for (const o of occupants) {
    const count = Math.max(1, o.count || 1);
    const range = findStat(statsOf(o.payload), 'quantum', ['jumpRange']);
    out.chips.push(chip(o, null, range, 'gm', 'codex.equipped.jumpRange'));
    out.census.slots += count;
    out.census.active += count;
  }
  return out;
}

/** Everything else: a census chip with no figure — honest, never invented. */
export function buildGenericPreview(
  occupants: readonly SummaryOccupant[],
  section: ShipModuleSection,
): FoldPreview {
  const out = empty(section);
  for (const o of occupants) {
    const count = Math.max(1, o.count || 1);
    out.chips.push(chip(o, null, null, 'int', null));
    out.census.slots += count;
    out.census.active += count;
  }
  return out;
}

/** Dispatch by section kind — the one entry point the layout component calls. */
export function buildFoldPreview(
  section: ShipModuleSection,
  occupants: readonly SummaryOccupant[],
): FoldPreview {
  switch (section) {
    case 'shields':
      return buildShieldPreview(occupants);
    case 'weapons':
    case 'remoteTurrets':
      return buildWeaponPreview(occupants, section);
    case 'missiles':
      return buildMissilePreview(occupants);
    case 'powerPlants':
      return buildPowerPlantPreview(occupants);
    case 'coolers':
      return buildCoolerPreview(occupants);
    case 'quantum':
      return buildQuantumPreview(occupants);
    default:
      return buildGenericPreview(occupants, section);
  }
}
