// Energy model for the ship page's power dock (MASTER §8 / §8a).
// -----------------------------------------------------------------------------
// PURE DOMAIN MODULE — no Angular, no templates, no i18n strings (label KEYS
// only). Everything here is derived from the extractor's flat
// `ItemResourceComponentParams` stats group (see codex.types.ts). The hard rule
// of this codebase applies: a number the game files do not carry comes back
// `null` / a gap key, NEVER a zero and never an estimate.
//
// ── The formulas, in one place ────────────────────────────────────────────────
// F1  Group allocation (segments)
//        alloc(g) = Σ_items ( consumeSegments × count )
//                 + ceil( Σ_items ( consumeUnits × count ) )
//     Items that draw `SStandardResourceUnit` power (weapons: 1.0 units each)
//     occupy no whole segment on their own. They are folded into their group by
//     summing the standard units of the WHOLE group and rounding UP once — a
//     group of three 1.0-unit repeaters costs 3 segments, a single one costs 1.
//     Rounding once per group (not per item) is what keeps the dock's segment
//     sum equal to the reactor budget instead of inflating it.
// F2  Group minimum (the gold pips)
//        min(g) = ceil( Σ_items ( consumeSegments × minFraction × count ) )
//     Standard-unit consumers have no `minimumConsumptionFraction` in the P4K,
//     so they contribute no floor — a group made only of them has minimum 0.
// F3  Reactor budget
//        budget = Σ_items ( generateSegments × count )        [power plants]
//     `null` when no item in the loadout generates power → the sheet reports
//     `available:false` with `codex.energy.gap.noReactor`.
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
// Presets: `auto` = every group at its full allocation (F1); `stealth` = every
// group at its minimum (F2); `reset` = auto, no cuts, SCM.
// Flight modes: SCM gives the quantum drive no channel; NAV powers the quantum
// drive and drops the shield channel (B-C4, tooltip part-07:253). If a build
// carries no per-state data at all we still apply that channel rule — it is a
// game rule, not a number — but we never invent per-mode magnitudes.

import { findStat } from '../hangar/loadout-stats';
import { crossSectionAxes } from './codex-loadout-stats';
import type { SummaryOccupant } from './ship-summary-panels';
import { RESOURCE_STATS_GROUP, resourceKey } from './codex.types';

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

function resourceStat(payload: unknown, field: string, state = 'online'): number | null {
  const stats = statsOf(payload);
  if (!stats) return null;
  return findStat(stats, RESOURCE_STATS_GROUP, [resourceKey(field, state), field]);
}

/** Everything the model reads off ONE occupant, already scaled by its count. */
export interface OccupantDraw {
  group: PowerGroup | null;
  count: number;
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
  emNominal: number;
  irNominal: number;
  /** true when the item carries no ItemResourceComponentParams at all */
  missing: boolean;
}

/** Read one occupant's resource draw. Absent fields read as 0, but `missing`
 * records that the item had no resource group at all so the sheet can tell
 * "genuinely draws nothing" from "the extract never looked". */
export function occupantDraw(occupant: SummaryOccupant, state = 'online'): OccupantDraw {
  const p = occupant.payload;
  const count = Math.max(1, occupant.count || 1);
  const read = (f: string): number | null => resourceStat(p, f, state);
  const fields = {
    consumeSegments: read('power.consumeSegments'),
    consumeUnits: read('power.consumeUnits'),
    generateSegments: read('power.generateSegments'),
    minFraction: read('power.minFraction'),
    coolantConsume: read('coolant.consume'),
    coolantGenerate: read('coolant.generate'),
    emNominal: read('em.nominal'),
    irNominal: read('ir.nominal'),
  };
  const missing = Object.values(fields).every((v) => v === null);
  return {
    group: classifyPowerGroup(occupant),
    count,
    consumeSegments: (fields.consumeSegments ?? 0) * count,
    consumeUnits: (fields.consumeUnits ?? 0) * count,
    generateSegments: (fields.generateSegments ?? 0) * count,
    minFraction: fields.minFraction ?? 0,
    coolantConsume: (fields.coolantConsume ?? 0) * count,
    coolantGenerate: (fields.coolantGenerate ?? 0) * count,
    emNominal: (fields.emNominal ?? 0) * count,
    irNominal: (fields.irNominal ?? 0) * count,
    missing,
  };
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
  tooltipTitleKey: string;
  tooltipBodyKey: string;
  /** segments this group occupies right now (0 when cut/no channel). */
  allocated: number;
  /** gold floor (F2). */
  minimum: number;
  /** pip stack length = the group's full (auto) allocation, ≥ minimum. */
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
  value: number | null;
  /** value under the PREVIOUS allocation this sheet was diffed against. */
  previous: number | null;
  /** current − previous; null when unchanged or when either side is a gap. */
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
  /** Σ allocated segments over all groups. */
  budgetUsed: number;
  groups: PowerGroupRow[];
  facts: PowerFact[];
  coolant: { used: number | null; total: number | null; percent: number | null };
  /** true when the reactor can hold every group's minimum and coolant suffices. */
  ready: boolean;
  readinessKey: string;
  /** the weapons group draws nothing → sustained DPS is 0 (R-B15). */
  weaponsCut: boolean;
}

export interface PowerSheetInput {
  occupants: readonly SummaryOccupant[];
  /** ship-level whitelisted stats — the cross-section lives here. */
  shipStats?: Record<string, Record<string, unknown>> | null;
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
  life: 'codex.energy.group.life',
  quantum: 'codex.energy.group.quantum',
  tractor: 'codex.energy.group.tractor',
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

/**
 * The whole dock in one call. Deterministic and side-effect free — the caller
 * owns the mode/preset/cut signals and re-invokes on every change.
 */
export function computePowerSheet(input: PowerSheetInput): PowerSheet {
  const mode: FlightMode = input.mode ?? 'scm';
  const preset: PowerPreset = input.preset ?? 'auto';
  const cutGroups = new Set<PowerGroup>(input.cutGroups ?? []);
  const draws = input.occupants.map((o) => occupantDraw(o));

  // F3 — reactor budget.
  const generated = draws.reduce((sum, d) => sum + d.generateSegments, 0);
  const anyResourceData = draws.some((d) => !d.missing);
  const budgetTotal = generated > 0 ? generated : null;

  const gapKeys: string[] = [];
  if (!anyResourceData) gapKeys.push('codex.energy.gap.noResourceData');
  else if (budgetTotal === null) gapKeys.push('codex.energy.gap.noReactor');

  // Per-group aggregation (F1/F2).
  const groups: PowerGroupRow[] = [];
  let budgetUsed = 0;
  const poweredGroups = new Set<PowerGroup>();

  for (const group of POWER_GROUP_ORDER) {
    const mine = draws.filter((d) => d.group === group);
    const segments = mine.reduce((s, d) => s + d.consumeSegments, 0);
    const units = mine.reduce((s, d) => s + d.consumeUnits, 0);
    // F1 — whole segments plus ONE ceil over the group's standard units.
    const full = segments + (units > 0 ? Math.ceil(units) : 0);
    // F2 — the gold floor.
    const minimum = Math.min(
      full,
      Math.ceil(mine.reduce((s, d) => s + d.consumeSegments * d.minFraction, 0)),
    );

    const hasChannel = powerGroupHasChannel(group, mode);
    const cut = cutGroups.has(group);
    const allocated = !hasChannel || cut ? 0 : preset === 'stealth' ? minimum : full;

    let state: PowerGroupState;
    if (mine.length === 0) state = 'absent';
    else if (!hasChannel) state = 'noChannel';
    else if (cut) state = 'off';
    else if (allocated === 0) state = IDLE_GROUPS.has(group) || full === 0 ? 'idle' : 'off';
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
    const capacity = Math.max(full, mine.length > 0 ? 1 : 0);

    if (allocated > 0) {
      budgetUsed += allocated;
      poweredGroups.add(group);
    } else if (state === 'idle' && mine.length > 0 && !cut) {
      // idle hardware still runs (0 segments) — its signature counts.
      poweredGroups.add(group);
    }

    groups.push({
      group,
      labelKey: GROUP_LABEL[group],
      tooltipTitleKey: `codex.energy.tooltip.${group}.title`,
      tooltipBodyKey: `codex.energy.tooltip.${group}.body`,
      allocated,
      minimum,
      capacity,
      pips: pipStack(allocated, minimum, capacity),
      state,
      stateLabelKey,
      cut,
      items: mine.reduce((s, d) => s + d.count, 0),
    });
  }

  // F4/F5 over the powered set. Power plants (group null) always run.
  const powered = draws.filter((d) => d.group === null || poweredGroups.has(d.group));
  const coolantUsedRaw = round(powered.reduce((s, d) => s + d.coolantConsume, 0));
  const coolantTotalRaw = round(draws.reduce((s, d) => s + d.coolantGenerate, 0));
  const hasCoolantData = draws.some((d) => d.coolantGenerate > 0 || d.coolantConsume > 0);
  if (!hasCoolantData && anyResourceData) gapKeys.push('codex.energy.gap.noCoolant');

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
    return { key, value, previous, delta, lowerIsBetter, gapKey: value == null ? gapKey : null };
  };

  const facts: PowerFact[] = [
    fact('ir', hasSignature ? irRaw : null, true, 'codex.energy.gap.noSignature'),
    fact('em', hasSignature ? emRaw : null, true, 'codex.energy.gap.noSignature'),
    fact('crossSection', cs, true, 'codex.summary.gap.noSignature'),
    fact('coolant', coolant.percent, true, 'codex.energy.gap.noCoolant'),
  ];

  const minimumsTotal = groups.reduce((s, g) => s + (g.state === 'noChannel' ? 0 : g.minimum), 0);
  const ready =
    budgetTotal !== null &&
    budgetTotal >= minimumsTotal &&
    (coolant.used === null || coolant.total === null || coolant.used <= coolant.total);

  return {
    available: budgetTotal !== null,
    gapKeys,
    mode,
    preset,
    cutGroups,
    budgetTotal,
    budgetUsed,
    groups,
    facts,
    coolant,
    ready,
    readinessKey: ready ? 'codex.energy.ready.yes' : 'codex.energy.ready.no',
    weaponsCut: (groups.find((g) => g.group === 'weapons')?.allocated ?? 0) === 0,
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
