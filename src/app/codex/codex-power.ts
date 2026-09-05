// Energy model for the ship page's power dock (MASTER §8 / §8a).
// -----------------------------------------------------------------------------
// PURE DOMAIN MODULE — no Angular, no templates, no i18n strings (label KEYS
// only). Everything here is derived from the extractor's flat
// `ItemResourceComponentParams` stats group (see codex.types.ts). The hard rule
// of this codebase applies: a number the game files do not carry comes back
// `null` / a gap key, NEVER a zero and never an estimate.
//
// ── The formulas, in one place ────────────────────────────────────────────────
// F1  Group CAPACITY (segments the group can occupy at full tilt)
//        capacity(g) = Σ_items ( consumeSegments × count )
//                    + ceil( Σ_items ( consumeUnits × count ) − 1e-6 )
//     Items that draw `SStandardResourceUnit` power (weapons: 1.0 units each)
//     occupy no whole segment on their own. They are folded into their group by
//     summing the standard units of the WHOLE group and rounding UP once — a
//     group of three 1.0-unit repeaters costs 3 segments, a single one costs 1.
// F2  Group MINIMUM (the gold pips)
//        min(g) = ceil( Σ_items ( consumeSegments × minFraction × count ) − 1e-6 )
//     `minFraction` is stored rounded to 4 dp, so 3 × 0.6667 = 2.0001 would ceil
//     to 3 without the epsilon (R6). Standard-unit consumers carry no
//     `minimumConsumptionFraction`, so a group made only of them has minimum 0.
// F3  Reactor budget
//        budget = Σ_items ( generateSegments × count )        [power plants]
//     `null` when no item in the loadout generates power → the sheet reports
//     `available:false` with `codex.energy.gap.noReactorData`.
// F1b ALLOCATION — the distribution (R1). Capacity is what a group WANTS, the
//     reactor decides what it GETS. Σ allocated is never allowed to exceed the
//     budget, because the dock prints `used / total` and `17 / 14 Seg` is a lie:
//       1. every eligible group (has a channel in this mode, not cut) is seeded
//          with its minimum (F2);
//       2. the remainder `budget − Σ minimum` is handed out in
//          POWER_GROUP_ORDER — weapons first — in WHOLE segments, each group
//          capped at its capacity, until the budget is spent;
//       3. `stealth` skips step 2 entirely: minimums only;
//       4. if `Σ minimum > budget` the sheet flips `overBudget:true`,
//          `ready:false`, `codex.energy.readiness.no` and LEAVES the groups at
//          their minimum — the dock then prints a deficit instead of hiding it.
// F4  Coolant
//        used  = Σ_powered items ( coolant.consume × count )
//        total = Σ_powered items ( coolant.generate × count )
//        percent = round(used / total × 100)
//     Only the numerator moves when a group is cut; the denominator is fixed by
//     the installed coolers (B-C3).
// F5  Signatures
//        EM = Σ_powered items ( em.nominal × count )
//        IR = Σ_powered items ( ir.nominal × count )
//     "powered" = the item's group is neither cut nor unavailable in the active
//     flight mode. The cross-section (CS) is hull geometry and NEVER changes
//     with the allocation (B-C3).
//
// Presets: `auto` = minimums first, then the surplus by group order (F1b);
// `stealth` = every group at its minimum (F2); `reset` = auto, no cuts, SCM.
// Flight modes: SCM gives the quantum drive no channel; NAV powers the quantum
// drive and drops the shield channel (B-C4, tooltip part-07:253). If a build
// carries no per-state data at all we still apply that channel rule — it is a
// game rule, not a number — but we never invent per-mode magnitudes.

import { findStat } from '../hangar/loadout-stats';
import { crossSectionAxes } from './codex-loadout-stats';
import type { SummaryOccupant } from './ship-summary-panels';
import { RESOURCE_DEFAULT_STATE, RESOURCE_STATS_GROUP, resourceKey } from './codex.types';

/** The extractor `schema_version` the energy model needs (schema 3 added the
 * flat `ItemResourceComponentParams` group). A build below this cannot be
 * modelled — the sheet reports `available:false` + `reExtractPending`. */
export const POWER_REQUIRED_SCHEMA = 3;

// ── groups ───────────────────────────────────────────────────────────────────

export type PowerGroup =
  | 'weapons'
  | 'shields'
  | 'thrusters'
  | 'coolers'
  | 'radar'
  | 'life'
  | 'quantum'
  | 'tractor';

/** Dock column order (MASTER §8). */
export const POWER_GROUP_ORDER: readonly PowerGroup[] = [
  'weapons',
  'shields',
  'thrusters',
  'coolers',
  'radar',
  'life',
  'quantum',
  'tractor',
] as const;

export type FlightMode = 'scm' | 'nav';
export type PowerPreset = 'auto' | 'stealth';
export type DockPosition = 'left' | 'center' | 'right';

/**
 * Occupant → power group. Three ordered signals, most reliable first:
 *   1. codex entity kind — anything the extract calls a `weapon` is a weapon;
 *   2. `ComponentPayload.kind` (PowerPlant/Shield/Cooler/QuantumDrive/Thruster);
 *   3. the module section the port was bucketed into, then finally the port /
 *      attach-type name (radar, life support, tractor beam have no dedicated
 *      ComponentKind, so the port name is the only handle the data gives us).
 * Power plants map to NO group: they fund the budget, they do not spend it.
 * Anything unrecognised returns `null` and is excluded from the dock entirely
 * rather than being dumped into a catch-all column.
 */
export function classifyPowerGroup(occupant: SummaryOccupant): PowerGroup | null {
  const payload = occupant.payload as
    | { entityKind?: string; kind?: string; attachType?: string; subType?: string; className?: string }
    | null
    | undefined;
  if (!payload) return null;

  const entityKind = payload.entityKind ?? occupant.kind ?? '';
  if (entityKind === 'weapon') {
    const hay = `${payload.className ?? ''} ${payload.subType ?? ''} ${payload.attachType ?? ''}`.toLowerCase();
    if (hay.includes('tractor') || hay.includes('tow')) return 'tractor';
    return 'weapons';
  }

  const kind = (payload.kind ?? '').trim();
  switch (kind) {
    case 'PowerPlant':
      return null;
    case 'Shield':
      return 'shields';
    case 'Cooler':
      return 'coolers';
    case 'QuantumDrive':
      return 'quantum';
    case 'Thruster':
      return 'thrusters';
    default:
      break;
  }

  switch (occupant.section) {
    case 'weapons':
    case 'remoteTurrets':
    case 'missiles':
      return 'weapons';
    case 'shields':
      return 'shields';
    case 'coolers':
      return 'coolers';
    case 'quantum':
      return 'quantum';
    case 'radar':
      return 'radar';
    case 'lifeSupport':
      return 'life';
    case 'powerPlants':
      return null;
    default:
      break;
  }

  const hay = `${payload.className ?? ''} ${payload.attachType ?? ''} ${payload.subType ?? ''}`.toLowerCase();
  if (hay.includes('radar') || hay.includes('scanner') || hay.includes('ping')) return 'radar';
  if (hay.includes('life') || hay.includes('oxygen')) return 'life';
  if (hay.includes('tractor') || hay.includes('towing')) return 'tractor';
  if (hay.includes('thruster') || hay.includes('maneuver')) return 'thrusters';
  if (hay.includes('quantum')) return 'quantum';
  return null;
}

// ── reading the resource stats group ─────────────────────────────────────────

function statsOf(payload: unknown): Record<string, Record<string, unknown>> | undefined {
  const s = (payload as { stats?: unknown } | null | undefined)?.stats;
  return s && typeof s === 'object' ? (s as Record<string, Record<string, unknown>>) : undefined;
}

/** Case-insensitive lookup of ONE raw field inside the resource stats group. */
function resourceRaw(payload: unknown, field: string): unknown {
  const stats = statsOf(payload);
  if (!stats) return undefined;
  for (const [structName, fields] of Object.entries(stats)) {
    if (!structName.toLowerCase().includes(RESOURCE_STATS_GROUP.toLowerCase())) continue;
    if (!fields || typeof fields !== 'object') continue;
    for (const [k, v] of Object.entries(fields)) {
      if (k.toLowerCase() === field.toLowerCase()) return v;
    }
  }
  return undefined;
}

/** True when the payload carries an `ItemResourceComponentParams` group at all. */
export function hasResourceGroup(payload: unknown): boolean {
  const stats = statsOf(payload);
  if (!stats) return false;
  return Object.keys(stats).some((k) =>
    k.toLowerCase().includes(RESOURCE_STATS_GROUP.toLowerCase()),
  );
}

/**
 * The resource states a record carries, in extractor order. Schema 3 writes
 * them `|`-joined into `stateNames`; an empty list means the group is absent.
 */
export function resourceStateNames(payload: unknown): string[] {
  const raw = resourceRaw(payload, 'stateNames');
  if (typeof raw !== 'string') return [];
  return raw
    .split('|')
    .map((n) => n.trim())
    .filter((n) => n !== '');
}

/**
 * Which state's numbers to read (R8). The extractor ALWAYS prefixes its keys
 * with the lower-cased state name, so there is no bare-key fallback to try:
 * prefer `online`, otherwise the first state the record lists. `null` when the
 * record carries no resource group at all — that is `missing`, not a zero.
 */
export function resolveResourceState(payload: unknown): string | null {
  const names = resourceStateNames(payload).map((n) => n.toLowerCase());
  if (names.length === 0) return hasResourceGroup(payload) ? RESOURCE_DEFAULT_STATE : null;
  if (names.includes(RESOURCE_DEFAULT_STATE)) return RESOURCE_DEFAULT_STATE;
  return names[0];
}

function resourceStat(payload: unknown, field: string, state: string): number | null {
  const stats = statsOf(payload);
  if (!stats) return null;
  return findStat(stats, RESOURCE_STATS_GROUP, [resourceKey(field, state)]);
}

/** Everything the model reads off ONE occupant, already scaled by its count. */
export interface OccupantDraw {
  group: PowerGroup | null;
  count: number;
  /** the resource state the numbers were read from (R8); null = no group. */
  state: string | null;
  /** whole power segments consumed (SPowerSegmentResourceUnit) */
  consumeSegments: number;
  /** fractional standard units consumed (SStandardResourceUnit) */
  consumeUnits: number;
  /** whole power segments generated (reactors) */
  generateSegments: number;
  /** minimumConsumptionFraction, 0..1; 0 when the item carries none */
  minFraction: number;
  coolantConsume: number;
  coolantGenerate: number;
  /** SRU/s of shield regen produced (passive generators contribute too). */
  shieldGenerate: number;
  emNominal: number;
  irNominal: number;
  /** true when the item carries no ItemResourceComponentParams at all */
  missing: boolean;
}

/** Read one occupant's resource draw. Absent fields read as 0, but `missing`
 * records that the item had no resource group at all so the sheet can tell
 * "genuinely draws nothing" from "the extract never looked". */
export function occupantDraw(occupant: SummaryOccupant, state?: string): OccupantDraw {
  const p = occupant.payload;
  const count = Math.max(1, occupant.count || 1);
  const resolved = state ?? resolveResourceState(p);
  const read = (f: string): number | null =>
    resolved === null ? null : resourceStat(p, f, resolved);
  const fields = {
    consumeSegments: read('power.consumeSegments'),
    consumeUnits: read('power.consumeUnits'),
    generateSegments: read('power.generateSegments'),
    minFraction: read('power.minFraction'),
    coolantConsume: read('coolant.consume'),
    coolantGenerate: read('coolant.generate'),
    shieldGenerate: read('shield.generate'),
    emNominal: read('em.nominal'),
    irNominal: read('ir.nominal'),
  };
  const missing = resolved === null || Object.values(fields).every((v) => v === null);
  return {
    group: classifyPowerGroup(occupant),
    count,
    state: resolved,
    consumeSegments: (fields.consumeSegments ?? 0) * count,
    consumeUnits: (fields.consumeUnits ?? 0) * count,
    generateSegments: (fields.generateSegments ?? 0) * count,
    minFraction: fields.minFraction ?? 0,
    coolantConsume: (fields.coolantConsume ?? 0) * count,
    coolantGenerate: (fields.coolantGenerate ?? 0) * count,
    shieldGenerate: (fields.shieldGenerate ?? 0) * count,
    emNominal: (fields.emNominal ?? 0) * count,
    irNominal: (fields.irNominal ?? 0) * count,
    missing,
  };
}

/**
 * THE shared passive rule (R2). A shield generator whose resource state draws
 * neither whole segments nor standard units is the ship's PASSIVE unit: it is
 * "nicht am Netz", contributes its shield HP and its EM signature, and costs
 * the reactor nothing. Both the dock (this module) and the fold preview
 * (`codex-fold-preview` re-exports this very symbol) use this one function —
 * counting the passive generator as a consumer inflated the Nomad's 3-slot
 * shield bay to 6 segments of capacity instead of 4.
 *
 * Decided from the resource data, never from the port name. Without resource
 * data we cannot claim "passive", so the answer is `false`.
 */
export function isPassiveShield(occupant: SummaryOccupant): boolean {
  const draw = occupantDraw(occupant);
  if (draw.missing) return false;
  return draw.consumeSegments === 0 && draw.consumeUnits === 0;
}

// ── sheet shapes ─────────────────────────────────────────────────────────────

export type PowerPipKind = 'on' | 'min' | 'empty';

export interface PowerPip {
  kind: PowerPipKind;
  /** The allocated count, printed on the topmost occupied pip only. */
  numeral: number | null;
}

export type PowerGroupState =
  /** drawing power right now */
  | 'active'
  /** cut by the user */
  | 'off'
  /** has hardware but draws nothing until used (tractor beam) */
  | 'idle'
  /** no channel in the active flight mode (quantum in SCM, shields in NAV) */
  | 'noChannel'
  /** the ship has no item in this group at all */
  | 'absent';

export interface PowerGroupRow {
  group: PowerGroup;
  labelKey: string;
  /** the tooltip's heading — the group label itself (the designer authored no
   * separate `.title` string; the body lives under a FLAT tooltip key). */
  tooltipTitleKey: string;
  /** `codex.energy.tooltip.<groupSlug>` — flat, body only (R4). */
  tooltipBodyKey: string;
  /** segments the reactor actually gave this group (0 when cut/no channel). */
  allocated: number;
  /** gold floor (F2) — the group cannot run below this. */
  minimum: number;
  /** what the group would draw at full tilt (F1) = the pip stack length. */
  capacity: number;
  pips: PowerPip[];
  state: PowerGroupState;
  /** i18n key for the text under the pips (`aus`, `—`, `0`, or the numeral). */
  stateLabelKey: string | null;
  cut: boolean;
  /** how many hardpoints/items feed this group. */
  items: number;
}

export type PowerFactKey = 'ir' | 'em' | 'crossSection' | 'coolant';

export interface PowerFact {
  key: PowerFactKey;
  /** the authored label key — the component NEVER builds one from `key` (R4). */
  labelKey: string;
  /** the authored ⓘ body key. */
  tooltipKey: string;
  value: number | null;
  /** value under the PREVIOUS allocation this sheet was diffed against. */
  previous: number | null;
  /** current − previous; null when unchanged or when either side is a gap —
   * a fact with `delta:null` renders NO chip (R9: with the live data a weapons
   * cut moves neither EM nor IR nor the cooling load). */
  delta: number | null;
  /** Inside the dock a rising signature/heat load is bad (MASTER §12). */
  lowerIsBetter: boolean;
  gapKey: string | null;
}

export interface PowerSheet {
  /** false when the build carries no reactor data — render gaps, not zeros. */
  available: boolean;
  gapKeys: string[];
  mode: FlightMode;
  preset: PowerPreset;
  cutGroups: ReadonlySet<PowerGroup>;
  /** Σ generated segments (F3), null when nothing generates. */
  budgetTotal: number | null;
  /** Σ allocated segments over all groups — never greater than `budgetTotal`. */
  budgetUsed: number;
  /** Σ of every eligible group's minimum — what the ship needs just to run. */
  budgetMinimum: number;
  /** true when `budgetMinimum > budgetTotal`: the reactor cannot even hold the
   * minimums. Allocations stay AT the minimum so the dock can print the
   * deficit honestly instead of silently trimming a group (R1). */
  overBudget: boolean;
  groups: PowerGroupRow[];
  facts: PowerFact[];
  coolant: { used: number | null; total: number | null; percent: number | null };
  /** true when the reactor can hold every group's minimum and coolant suffices. */
  ready: boolean;
  readinessKey: string;
  /** the pilot CUT the weapons group. Not "weapons got 0 segments": a
   * ballistic-only or resource-less weapons group legitimately allocates 0 and
   * must never zero the DPS (R3). */
  weaponsCut: boolean;
}

export interface PowerSheetInput {
  occupants: readonly SummaryOccupant[];
  /** ship-level whitelisted stats — the cross-section lives here. */
  shipStats?: Record<string, Record<string, unknown>> | null;
  /** the loaded build's `schema_version`; below {@link POWER_REQUIRED_SCHEMA}
   * the sheet is unavailable with `codex.energy.gap.reExtractPending` (R5). */
  schemaVersion?: number | null;
  mode?: FlightMode;
  preset?: PowerPreset;
  cutGroups?: Iterable<PowerGroup>;
  /** the allocation the facts' deltas are measured against (usually the last sheet). */
  previous?: PowerSheet | null;
}

const GROUP_LABEL: Readonly<Record<PowerGroup, string>> = {
  weapons: 'codex.energy.group.weapons',
  shields: 'codex.energy.group.shields',
  thrusters: 'codex.energy.group.thrusters',
  coolers: 'codex.energy.group.coolers',
  radar: 'codex.energy.group.radar',
  life: 'codex.energy.group.lifeSupport',
  quantum: 'codex.energy.group.quantum',
  tractor: 'codex.energy.group.tractor',
};

/** Flat tooltip bodies — same slug set as the labels (`life` → `lifeSupport`). */
const GROUP_TOOLTIP: Readonly<Record<PowerGroup, string>> = {
  weapons: 'codex.energy.tooltip.weapons',
  shields: 'codex.energy.tooltip.shields',
  thrusters: 'codex.energy.tooltip.thrusters',
  coolers: 'codex.energy.tooltip.coolers',
  radar: 'codex.energy.tooltip.radar',
  life: 'codex.energy.tooltip.lifeSupport',
  quantum: 'codex.energy.tooltip.quantum',
  tractor: 'codex.energy.tooltip.tractor',
};

/** The authored label/tooltip keys per fact — note `coolant` → `coolingLoad`. */
const FACT_KEYS: Readonly<Record<PowerFactKey, { labelKey: string; tooltipKey: string }>> = {
  ir: { labelKey: 'codex.energy.fact.ir', tooltipKey: 'codex.energy.tooltip.ir' },
  em: { labelKey: 'codex.energy.fact.em', tooltipKey: 'codex.energy.tooltip.em' },
  crossSection: {
    labelKey: 'codex.energy.fact.crossSection',
    tooltipKey: 'codex.energy.tooltip.crossSection',
  },
  coolant: {
    labelKey: 'codex.energy.fact.coolingLoad',
    tooltipKey: 'codex.energy.tooltip.coolingLoad',
  },
};

/** Groups that have no channel in a given flight mode (B-C4). */
const NO_CHANNEL: Readonly<Record<FlightMode, readonly PowerGroup[]>> = {
  scm: ['quantum'],
  nav: ['shields'],
};

/** Groups that sit at 0 until the pilot actually uses them (mock: `0`, not `aus`). */
const IDLE_GROUPS: ReadonlySet<PowerGroup> = new Set<PowerGroup>(['tractor']);

export function powerGroupHasChannel(group: PowerGroup, mode: FlightMode): boolean {
  return !NO_CHANNEL[mode].includes(group);
}

function pipStack(allocated: number, minimum: number, capacity: number): PowerPip[] {
  const pips: PowerPip[] = [];
  for (let i = 0; i < capacity; i++) {
    const occupied = i < allocated;
    const kind: PowerPipKind = occupied ? (i < minimum ? 'min' : 'on') : 'empty';
    pips.push({ kind, numeral: occupied && i === allocated - 1 ? allocated : null });
  }
  return pips;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Plain ceil with a float-noise guard — for exact sums (standard units). */
function ceilUnits(n: number): number {
  return Math.ceil(n - 1e-6);
}

/**
 * `ceil` for a segments × minFraction product (R6). The extractor stores
 * `minimumConsumptionFraction` ROUNDED TO 4 dp, so two UltraFlow coolers read
 * 6 × 0.6667 = 4.0002 where the engine means exactly 4 — a naive ceil turns a
 * 4-segment floor into 5 and the dock claims the ship cannot idle. The stored
 * value is off by at most 5e-5, so the product is off by at most
 * `5e-5 × Σ segments`: subtract exactly that much before rounding up, and no
 * more, so a genuine 4.05 still ceils to 5.
 */
function ceilMinimum(product: number, segments: number): number {
  return Math.ceil(product - (5e-5 * Math.abs(segments) + 1e-9));
}

/** What ONE group wants and what it cannot go below, before distribution. */
export interface GroupDemand {
  group: PowerGroup;
  capacity: number;
  minimum: number;
  items: number;
  present: boolean;
}

/**
 * F1b — hand the reactor budget out. Exported so a spec (and a future "what if
 * I add a plant" preview) can exercise the distribution on its own.
 *
 * Contract: the result has one entry per demand, `min ≤ alloc ≤ capacity`, and
 * `Σ alloc ≤ budget` unless `Σ min > budget` — in which case every group sits
 * at its minimum and the caller reports `overBudget`.
 */
export function distributePower(
  demands: readonly GroupDemand[],
  budget: number,
  preset: PowerPreset,
): Map<PowerGroup, number> {
  const out = new Map<PowerGroup, number>();
  for (const d of demands) out.set(d.group, Math.min(d.minimum, d.capacity));
  const minimums = demands.reduce((s, d) => s + Math.min(d.minimum, d.capacity), 0);
  if (preset === 'stealth' || minimums >= budget) return out;

  let remaining = budget - minimums;
  for (const group of POWER_GROUP_ORDER) {
    if (remaining <= 0) break;
    const d = demands.find((x) => x.group === group);
    if (!d) continue;
    const head = Math.max(0, d.capacity - (out.get(group) ?? 0));
    const give = Math.min(head, remaining);
    if (give > 0) {
      out.set(group, (out.get(group) ?? 0) + give);
      remaining -= give;
    }
  }
  return out;
}

/**
 * The whole dock in one call. Deterministic and side-effect free — the caller
 * owns the mode/preset/cut signals and re-invokes on every change.
 */
export function computePowerSheet(input: PowerSheetInput): PowerSheet {
  const mode: FlightMode = input.mode ?? 'scm';
  const preset: PowerPreset = input.preset ?? 'auto';
  const cutGroups = new Set<PowerGroup>(input.cutGroups ?? []);
  const draws = input.occupants.map((o) => occupantDraw(o));

  // R5 — a build below schema 3 has no resource group at all; say so once and
  // stop, rather than rendering a dock full of zeros.
  const schemaTooOld =
    input.schemaVersion != null && input.schemaVersion < POWER_REQUIRED_SCHEMA;

  // F3 — reactor budget.
  const generated = draws.reduce((sum, d) => sum + d.generateSegments, 0);
  const anyResourceData = draws.some((d) => !d.missing);
  const budgetTotal = !schemaTooOld && generated > 0 ? generated : null;

  const gapKeys: string[] = [];
  if (schemaTooOld || !anyResourceData) gapKeys.push('codex.energy.gap.reExtractPending');
  else if (budgetTotal === null) gapKeys.push('codex.energy.gap.noReactorData');

  // Per-group demand (F1/F2) — the passive shield generator draws nothing and
  // therefore adds NOTHING to its group's capacity (R2).
  const demands: GroupDemand[] = [];
  const rowMeta = new Map<PowerGroup, { hasChannel: boolean; cut: boolean; present: boolean }>();
  const rawDemand = new Map<PowerGroup, GroupDemand>();

  for (const group of POWER_GROUP_ORDER) {
    const mine = draws.filter((d) => d.group === group);
    const segments = mine.reduce((s, d) => s + d.consumeSegments, 0);
    const units = mine.reduce((s, d) => s + d.consumeUnits, 0);
    const capacity = segments + (units > 0 ? ceilUnits(units) : 0);
    const minimum = Math.min(
      capacity,
      ceilMinimum(
        mine.reduce((s, d) => s + d.consumeSegments * d.minFraction, 0),
        segments,
      ),
    );
    const hasChannel = powerGroupHasChannel(group, mode);
    const cut = cutGroups.has(group);
    const present = mine.length > 0;
    rowMeta.set(group, { hasChannel, cut, present });
    // NOTE the cut is NOT part of the eligibility test: the distribution is
    // computed once per (mode, preset) so that cutting a group frees EXACTLY
    // that group's segments instead of silently re-dealing them to the next
    // column. `budgetUsed` therefore drops by the cut group's allocation, which
    // is the only reading of the dock a pilot can verify.
    if (present && hasChannel && capacity > 0) {
      demands.push({
        group,
        capacity,
        minimum,
        items: mine.reduce((s, d) => s + d.count, 0),
        present,
      });
    }
    // stash the raw figures for the row build below
    rawDemand.set(group, {
      group,
      capacity,
      minimum,
      items: mine.reduce((s, d) => s + d.count, 0),
      present,
    });
  }

  // What the ship needs just to run: the minimums of the groups that are ON.
  const budgetMinimum = demands
    .filter((d) => !(rowMeta.get(d.group)?.cut ?? false))
    .reduce((s, d) => s + d.minimum, 0);
  const overBudget = budgetTotal !== null && budgetMinimum > budgetTotal;
  const allocation = distributePower(demands, budgetTotal ?? 0, preset);

  const groups: PowerGroupRow[] = [];
  let budgetUsed = 0;
  const poweredGroups = new Set<PowerGroup>();

  for (const group of POWER_GROUP_ORDER) {
    const d = rawDemand.get(group)!;
    const meta = rowMeta.get(group)!;
    const allocated = meta.hasChannel && !meta.cut ? (allocation.get(group) ?? 0) : 0;

    let state: PowerGroupState;
    if (!d.present) state = 'absent';
    else if (!meta.hasChannel) state = 'noChannel';
    else if (meta.cut) state = 'off';
    else if (allocated === 0) state = IDLE_GROUPS.has(group) || d.capacity === 0 ? 'idle' : 'off';
    else state = 'active';

    const stateLabelKey =
      state === 'off'
        ? 'codex.energy.state.off'
        : state === 'noChannel'
          ? 'codex.energy.state.noChannel'
          : state === 'idle'
            ? 'codex.energy.state.idle'
            : state === 'absent'
              ? 'codex.energy.state.absent'
              : null;

    // A group with hardware but no measurable draw still shows one empty pip so
    // the column exists (mock: tractor beam / quantum in SCM).
    const capacity = Math.max(d.capacity, d.present ? 1 : 0);

    if (allocated > 0) {
      budgetUsed += allocated;
      poweredGroups.add(group);
    } else if (state === 'idle' && d.present) {
      // idle hardware still runs (0 segments) — its signature counts.
      poweredGroups.add(group);
    }

    groups.push({
      group,
      labelKey: GROUP_LABEL[group],
      tooltipTitleKey: GROUP_LABEL[group],
      tooltipBodyKey: GROUP_TOOLTIP[group],
      allocated,
      // the floor is a property of the HARDWARE, reported even when the group
      // is off; `state` is what the component styles the column by.
      minimum: meta.hasChannel ? d.minimum : 0,
      capacity,
      pips: pipStack(allocated, meta.hasChannel ? d.minimum : 0, capacity),
      state,
      stateLabelKey,
      cut: meta.cut,
      items: d.items,
    });
  }

  // F4/F5 over the powered set. Power plants (group null) always run, and so
  // does a PASSIVE shield generator — it is not on the net, but it is installed
  // and it radiates (R2).
  const powered = draws.filter((d) => d.group === null || poweredGroups.has(d.group));
  const coolantUsedRaw = round(powered.reduce((s, d) => s + d.coolantConsume, 0));
  const coolantTotalRaw = round(draws.reduce((s, d) => s + d.coolantGenerate, 0));
  const hasCoolantData = draws.some((d) => d.coolantGenerate > 0 || d.coolantConsume > 0);
  if (!hasCoolantData && anyResourceData && !schemaTooOld) {
    gapKeys.push('codex.energy.gap.noCoolingData');
  }

  const coolant = {
    used: hasCoolantData ? coolantUsedRaw : null,
    total: coolantTotalRaw > 0 ? coolantTotalRaw : null,
    percent:
      hasCoolantData && coolantTotalRaw > 0 ? Math.round((coolantUsedRaw / coolantTotalRaw) * 100) : null,
  };

  const emRaw = round(powered.reduce((s, d) => s + d.emNominal, 0));
  const irRaw = round(powered.reduce((s, d) => s + d.irNominal, 0));
  const hasSignature = draws.some((d) => d.emNominal > 0 || d.irNominal > 0);
  const cs = (() => {
    const axes = crossSectionAxes(
      input.shipStats as Record<string, Record<string, unknown>> | null | undefined,
    );
    const vals = [axes.x, axes.y, axes.z].filter((v): v is number => v !== null);
    return vals.length > 0 ? Math.max(...vals) : null;
  })();

  const prevFact = (key: PowerFactKey): number | null =>
    input.previous?.facts.find((f) => f.key === key)?.value ?? null;

  const fact = (
    key: PowerFactKey,
    value: number | null,
    lowerIsBetter: boolean,
    gapKey: string,
  ): PowerFact => {
    const previous = prevFact(key);
    const delta = value != null && previous != null && value !== previous ? round(value - previous) : null;
    return {
      key,
      labelKey: FACT_KEYS[key].labelKey,
      tooltipKey: FACT_KEYS[key].tooltipKey,
      value,
      previous,
      delta,
      lowerIsBetter,
      gapKey: value == null ? gapKey : null,
    };
  };

  const facts: PowerFact[] = [
    fact('ir', hasSignature ? irRaw : null, true, 'codex.energy.gap.noSignatureData'),
    fact('em', hasSignature ? emRaw : null, true, 'codex.energy.gap.noSignatureData'),
    fact('crossSection', cs, true, 'codex.summary.gap.noSignature'),
    fact('coolant', coolant.percent, true, 'codex.energy.gap.noCoolingData'),
  ];

  const ready =
    budgetTotal !== null &&
    !overBudget &&
    (coolant.used === null || coolant.total === null || coolant.used <= coolant.total);

  return {
    available: budgetTotal !== null,
    gapKeys,
    mode,
    preset,
    cutGroups,
    budgetTotal,
    budgetUsed,
    budgetMinimum,
    overBudget,
    groups,
    facts,
    coolant,
    ready,
    readinessKey: ready ? 'codex.energy.readiness.ok' : 'codex.energy.readiness.no',
    weaponsCut: cutGroups.has('weapons'),
  };
}

/** Toggle one group's cut state (the icon button is a toggle — B-C2). */
export function togglePowerGroup(
  cutGroups: ReadonlySet<PowerGroup>,
  group: PowerGroup,
): ReadonlySet<PowerGroup> {
  const next = new Set(cutGroups);
  if (!next.delete(group)) next.add(group);
  return next;
}

/** `Zurücksetzen` — the default dock state (auto, nothing cut, SCM). */
export function resetPowerState(): { cutGroups: ReadonlySet<PowerGroup>; mode: FlightMode; preset: PowerPreset } {
  return { cutGroups: new Set<PowerGroup>(), mode: 'scm', preset: 'auto' };
}

const GROUP_BY_KEY = new Map<string, PowerGroup>(POWER_GROUP_ORDER.map((g) => [g, g]));

/** Tolerant parse of a serialized group list — unknown keys are dropped. */
export function parsePowerGroups(raw: readonly string[] | null | undefined): Set<PowerGroup> {
  const out = new Set<PowerGroup>();
  for (const r of raw ?? []) {
    const g = GROUP_BY_KEY.get(r.trim());
    if (g) out.add(g);
  }
  return out;
}

export function isFlightMode(v: unknown): v is FlightMode {
  return v === 'scm' || v === 'nav';
}

export function isDockPosition(v: unknown): v is DockPosition {
  return v === 'left' || v === 'center' || v === 'right';
}
