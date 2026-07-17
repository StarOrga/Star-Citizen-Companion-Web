// Pure aggregate-stats functions over a ship config's resolved loadout.
// -----------------------------------------------------------------------------
// Inputs are the codex payloads of the items assigned to ports (plus the
// stock defaultLoadout for unassigned ports). The component `stats` JSON is
// heterogeneous — keyed by the LIVE struct name with per-patch field churn —
// so every lookup here is defensive: struct matched by name substring,
// fields matched case-insensitively, values coerced to finite numbers.
// Anything unresolvable simply doesn't contribute (never NaN in the output).

import type { ComponentPayload, ShipPayload, WeaponPayload } from '../codex/codex.types';

/** One resolved loadout line: what hangs on a port right now. */
export interface ResolvedLoadoutLine {
  portName: string | null;
  className: string;
  kind: string; // 'weapon' | 'component' | 'item' (codex kind)
  payload: unknown | null; // the codex payload when resolved, else null
}

export interface QuantumStats {
  jumpRangeMm: number | null; // raw jumpRange values are metres — shown as Mkm in UI
  fuelCapacity: number | null;
  driveSpeedMs: number | null;
}

export interface LoadoutStats {
  /** items assigned (resolved or not) */
  totalAssigned: number;
  /** per-kind counts (weapon/component/item) */
  countsByKind: Record<string, number>;
  /** ship weapons grouped by size, e.g. {3: 2, 2: 2} */
  weaponsBySize: Record<string, number>;
  weaponCount: number;
  shieldHp: number | null;
  shieldRegen: number | null;
  quantum: QuantumStats;
}

const EMPTY_QUANTUM: QuantumStats = { jumpRangeMm: null, fuelCapacity: null, driveSpeedMs: null };

/** Coerce a heterogeneous scalar to a finite number, else null. */
export function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Find a numeric field across a component's heterogeneous stats structs.
 * `structHint` narrows to structs whose name contains the hint
 * (case-insensitive); `fieldNames` are tried in order, case-insensitive.
 */
export function findStat(
  stats: Record<string, Record<string, unknown>> | null | undefined,
  structHint: string | null,
  fieldNames: string[],
): number | null {
  if (!stats) return null;
  const wantedFields = fieldNames.map((f) => f.toLowerCase());
  for (const [structName, fields] of Object.entries(stats)) {
    if (structHint && !structName.toLowerCase().includes(structHint.toLowerCase())) continue;
    if (!fields || typeof fields !== 'object') continue;
    const byLower = new Map(Object.keys(fields).map((k) => [k.toLowerCase(), k]));
    for (const wanted of wantedFields) {
      const actual = byLower.get(wanted);
      if (actual !== undefined) {
        const n = toFiniteNumber((fields as Record<string, unknown>)[actual]);
        if (n !== null) return n;
      }
    }
  }
  return null;
}

/**
 * CryEngine emits FLT_MAX (~3.4e38) for "unset/unlimited" numeric params —
 * observed live on quantum-drive jumpRange (renders as "∞ Gm"). Treat any
 * absurdly large value as absent so the UI omits the stat instead of showing
 * infinity. 1e30 is far above every real jump range (metres) and far below
 * FLT_MAX, so it cleanly separates data from sentinel.
 */
const FLT_MAX_SENTINEL_THRESHOLD = 1e30;
function dropFltMaxSentinel(v: number | null): number | null {
  return v !== null && v >= FLT_MAX_SENTINEL_THRESHOLD ? null : v;
}

// Struct-field candidates, shared by the aggregate stats and the per-component
// key-stat readout so both dig the same fields out of the heterogeneous stats.
const QD_JUMP_RANGE_FIELDS = ['jumpRange', 'JumpRange'];
const QD_DRIVE_SPEED_FIELDS = ['driveSpeed', 'DriveSpeed'];
const QD_FUEL_FIELDS = ['quantumFuelRequirement', 'QuantumFuelRequirement'];
const SHIELD_HP_FIELDS = ['MaxShieldHealth', 'ShieldHealth', 'Health'];
const SHIELD_REGEN_FIELDS = ['MaxShieldRegen', 'ShieldRegen', 'RegenRate'];

function isComponentPayload(p: unknown): p is ComponentPayload {
  return !!p && typeof p === 'object' && (p as { entityKind?: string }).entityKind === 'component';
}

function isWeaponPayload(p: unknown): p is WeaponPayload {
  return !!p && typeof p === 'object' && (p as { entityKind?: string }).entityKind === 'weapon';
}

/** Aggregate display stats for a resolved loadout. */
export function computeLoadoutStats(lines: ResolvedLoadoutLine[]): LoadoutStats {
  const countsByKind: Record<string, number> = {};
  const weaponsBySize: Record<string, number> = {};
  let weaponCount = 0;
  let shieldHp: number | null = null;
  let shieldRegen: number | null = null;
  let quantum: QuantumStats = EMPTY_QUANTUM;

  for (const line of lines) {
    countsByKind[line.kind] = (countsByKind[line.kind] ?? 0) + 1;

    if (isWeaponPayload(line.payload)) {
      weaponCount += 1;
      const size = toFiniteNumber(line.payload.size);
      const key = size === null ? '?' : String(size);
      weaponsBySize[key] = (weaponsBySize[key] ?? 0) + 1;
      continue;
    }

    if (!isComponentPayload(line.payload)) continue;
    const stats = line.payload.stats as Record<string, Record<string, unknown>> | undefined;

    if (line.payload.kind === 'Shield') {
      const hp = findStat(stats, 'shield', SHIELD_HP_FIELDS);
      const regen = findStat(stats, 'shield', SHIELD_REGEN_FIELDS);
      if (hp !== null) shieldHp = (shieldHp ?? 0) + hp;
      if (regen !== null) shieldRegen = (shieldRegen ?? 0) + regen;
    } else if (line.payload.kind === 'QuantumDrive') {
      // Last drive wins (ships have one QD; multiples would be config errors).
      quantum = {
        jumpRangeMm: dropFltMaxSentinel(findStat(stats, 'quantum', QD_JUMP_RANGE_FIELDS)),
        fuelCapacity: findStat(stats, 'quantum', QD_FUEL_FIELDS),
        driveSpeedMs: findStat(stats, 'quantum', QD_DRIVE_SPEED_FIELDS),
      };
    }
  }

  return {
    totalAssigned: lines.length,
    countsByKind,
    weaponsBySize,
    weaponCount,
    shieldHp,
    shieldRegen,
    quantum,
  };
}

/** How a component key-stat's raw value should be rendered by the UI. */
export type ComponentStatFormat = 'gm' | 'kmPerSec' | 'int' | 'intPerSec';

/** One notable stat of a single component, ready to show on its loadout row. */
export interface ComponentKeyStat {
  /** i18n key under `hangar.compStat.*`. */
  labelKey: string;
  /** how the component formats `value` (source units below). */
  format: ComponentStatFormat;
  /** raw value in source units: metres (gm), m/s (kmPerSec), or hp / hp·s⁻¹. */
  value: number;
}

/**
 * The headline technical stats of a *single* component, so the loadout list can
 * show e.g. the quantum drive's jump range right on its row (not only in the
 * aggregate card). Same defensive extraction as `computeLoadoutStats`; returns
 * an empty array for components without curated headline stats.
 */
export function componentKeyStats(payload: unknown): ComponentKeyStat[] {
  if (!isComponentPayload(payload)) return [];
  const stats = payload.stats as Record<string, Record<string, unknown>> | undefined;
  const out: ComponentKeyStat[] = [];

  if (payload.kind === 'QuantumDrive') {
    const jump = dropFltMaxSentinel(findStat(stats, 'quantum', QD_JUMP_RANGE_FIELDS));
    if (jump !== null) out.push({ labelKey: 'hangar.compStat.jumpRange', format: 'gm', value: jump });
    const speed = findStat(stats, 'quantum', QD_DRIVE_SPEED_FIELDS);
    if (speed !== null) {
      out.push({ labelKey: 'hangar.compStat.driveSpeed', format: 'kmPerSec', value: speed });
    }
  } else if (payload.kind === 'Shield') {
    const hp = findStat(stats, 'shield', SHIELD_HP_FIELDS);
    if (hp !== null) out.push({ labelKey: 'hangar.compStat.shieldHp', format: 'int', value: hp });
    const regen = findStat(stats, 'shield', SHIELD_REGEN_FIELDS);
    if (regen !== null) {
      out.push({ labelKey: 'hangar.compStat.shieldRegen', format: 'intPerSec', value: regen });
    }
  }

  return out;
}

/**
 * Merge a ship's stock defaultLoadout with the user's overrides:
 * an override REPLACES the stock entry on the same port; stock entries
 * survive untouched ports; overrides on ports without a stock entry are
 * appended (e.g. an empty-by-default missile rack).
 */
export function mergeLoadout(
  ship: ShipPayload | null,
  overrides: { portName: string; className: string; kind: string }[],
): { portName: string | null; className: string; kind: string | null }[] {
  const byPort = new Map(overrides.map((o) => [o.portName, o]));
  const merged: { portName: string | null; className: string; kind: string | null }[] = [];
  const seenPorts = new Set<string>();

  for (const stock of ship?.defaultLoadout ?? []) {
    const port = stock.itemPortName;
    if (port && byPort.has(port)) {
      const o = byPort.get(port)!;
      merged.push({ portName: port, className: o.className, kind: o.kind });
      seenPorts.add(port);
    } else if (stock.entityClassName) {
      merged.push({ portName: port, className: stock.entityClassName, kind: null });
      if (port) seenPorts.add(port);
    }
  }
  for (const o of overrides) {
    if (!seenPorts.has(o.portName)) {
      merged.push({ portName: o.portName, className: o.className, kind: o.kind });
    }
  }
  return merged;
}
