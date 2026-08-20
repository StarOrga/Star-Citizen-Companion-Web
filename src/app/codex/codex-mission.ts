// Mission profiles ("Einsatzprofile") for the ship analysis page (PR C).
// -----------------------------------------------------------------------------
// A mission is a lens on the SAME loadout: it reorders the module blocks
// (what a pilot flying that profile cares about first), folds away the blocks
// that don't matter to it, and picks the six KPI-band cells that matter most.
// Nothing here reads or writes the loadout itself — this module only maps a
// mission id to display preferences, plus the pure capability checks that
// decide whether a ship can even fly a given profile.

import { ShipModuleSection } from './ship-module-sections';

export type MissionId = 'all' | 'combat' | 'transport' | 'travel' | 'stealth' | 'mining' | 'salvage';

export type KpiKey =
  | 'alpha'
  | 'burstDps'
  | 'sustainedDps'
  | 'missiles'
  | 'shieldHp'
  | 'shieldRegen'
  | 'hullHp'
  | 'effectiveHp'
  | 'cargo'
  | 'mass'
  | 'scm'
  | 'maxSpeed'
  | 'quantumSpeed'
  | 'quantumRange'
  | 'spool'
  | 'ir'
  | 'emIdle'
  | 'emMax'
  | 'crossSection';

export interface MissionDef {
  id: MissionId;
  labelKey: string;
  /** i18n key for the chip icon glyph (kept as a short symbol, not an image). */
  iconGlyph: string;
  order: readonly ShipModuleSection[];
  fold: readonly ShipModuleSection[];
  kpis: readonly KpiKey[];
}

// The prototype's four loadout groups, expanded to this app's finer-grained
// `ShipModuleSection` taxonomy (04-rules-v2 §7.1: weapons/missiles/shields/power).
const GROUP_SECTIONS: Readonly<Record<string, readonly ShipModuleSection[]>> = {
  weapons: ['weapons', 'remoteTurrets'],
  offense: ['weapons', 'remoteTurrets'],
  missiles: ['missiles'],
  shields: ['shields'],
  power: ['powerPlants', 'quantum', 'coolers', 'radar', 'lifeSupport', 'pod'],
};

function expand(groups: readonly string[]): ShipModuleSection[] {
  const out: ShipModuleSection[] = [];
  const seen = new Set<ShipModuleSection>();
  for (const g of groups) {
    for (const s of GROUP_SECTIONS[g] ?? []) {
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out;
}

const COMBAT_ORDER = expand(['weapons', 'missiles', 'shields', 'power']);
const UTILITY_ORDER = expand(['shields', 'power', 'weapons', 'missiles']);
const POWER_FIRST_ORDER = expand(['power', 'shields', 'weapons', 'missiles']);

const COMBAT_KPIS: readonly KpiKey[] = [
  'alpha',
  'burstDps',
  'sustainedDps',
  'missiles',
  'shieldHp',
  'shieldRegen',
];

/** All seven mission profiles, in display (chip) order. */
export const MISSIONS: readonly MissionDef[] = [
  {
    id: 'all',
    labelKey: 'codex.mission.all',
    iconGlyph: '✱',
    order: COMBAT_ORDER,
    fold: [],
    kpis: COMBAT_KPIS,
  },
  {
    id: 'combat',
    labelKey: 'codex.mission.combat',
    iconGlyph: '⚔',
    order: COMBAT_ORDER,
    fold: [],
    kpis: COMBAT_KPIS,
  },
  {
    id: 'transport',
    labelKey: 'codex.mission.transport',
    iconGlyph: '▤',
    order: UTILITY_ORDER,
    fold: expand(['missiles', 'offense']),
    kpis: ['cargo', 'hullHp', 'shieldHp', 'quantumRange', 'scm', 'mass'],
  },
  {
    id: 'travel',
    labelKey: 'codex.mission.travel',
    iconGlyph: '✈',
    order: POWER_FIRST_ORDER,
    fold: expand(['missiles', 'offense']),
    kpis: ['quantumSpeed', 'quantumRange', 'spool', 'maxSpeed', 'hullHp', 'mass'],
  },
  {
    id: 'stealth',
    labelKey: 'codex.mission.stealth',
    iconGlyph: '◑',
    order: POWER_FIRST_ORDER,
    fold: expand(['missiles', 'offense']),
    kpis: ['ir', 'emIdle', 'emMax', 'crossSection', 'shieldHp', 'scm'],
  },
  {
    id: 'mining',
    labelKey: 'codex.mission.mining',
    iconGlyph: '⛏',
    order: POWER_FIRST_ORDER,
    fold: expand(['weapons', 'missiles', 'offense']),
    kpis: ['cargo', 'hullHp', 'shieldHp', 'ir', 'scm', 'mass'],
  },
  {
    id: 'salvage',
    labelKey: 'codex.mission.salvage',
    iconGlyph: '⚙',
    order: POWER_FIRST_ORDER,
    fold: expand(['weapons', 'missiles', 'offense']),
    kpis: ['cargo', 'hullHp', 'shieldHp', 'ir', 'scm', 'mass'],
  },
] as const;

const MISSION_BY_ID = new Map(MISSIONS.map((m) => [m.id, m]));

export function missionById(id: string | null | undefined): MissionDef {
  return (id && MISSION_BY_ID.get(id as MissionId)) || MISSIONS[0];
}

export function foldedSectionsFor(mission: MissionDef): ReadonlySet<ShipModuleSection> {
  return new Set(mission.fold);
}

// ── capability detection ─────────────────────────────────────────────────────

export interface ShipCapabilities {
  hasCargo: boolean;
  hasQuantum: boolean;
  hasMining: boolean;
  hasSalvage: boolean;
}

const MINING_RE = /mining|extract(?!ion\s*point)/i;
const SALVAGE_RE = /salvage/i;
const CARGO_RE = /cargo/i;
const QUANTUM_RE = /quantum/i;

/** Minimal port shape the capability scan needs. */
export interface CapabilityPort {
  portName: string | null;
  types: readonly string[];
}

/**
 * What a hull can even attempt, read from its ports + stock loadout class
 * names (loose regexes — a false negative just disables a mission chip with a
 * reason, never breaks the page; a false positive is caught the moment the
 * pilot tries the profile and finds nothing to show).
 */
export function detectShipCapabilities(
  ports: readonly CapabilityPort[],
  loadoutClassNames: readonly (string | null | undefined)[],
): ShipCapabilities {
  const haystack = [
    ...ports.flatMap((p) => [p.portName ?? '', ...(p.types ?? [])]),
    ...loadoutClassNames.filter((c): c is string => !!c),
  ].join(' ');
  return {
    hasCargo: CARGO_RE.test(haystack),
    hasQuantum: QUANTUM_RE.test(haystack),
    hasMining: MINING_RE.test(haystack),
    hasSalvage: SALVAGE_RE.test(haystack),
  };
}

/** i18n key naming why a mission chip is disabled for this hull, or null when it isn't. */
export function missionDisabledReasonKey(mission: MissionId, caps: ShipCapabilities): string | null {
  if (mission === 'mining' && !caps.hasMining) return 'codex.mission.disabled.noMining';
  if (mission === 'salvage' && !caps.hasSalvage) return 'codex.mission.disabled.noSalvage';
  if (mission === 'transport' && !caps.hasCargo) return 'codex.mission.disabled.noCargo';
  if (mission === 'travel' && !caps.hasQuantum) return 'codex.mission.disabled.noQuantum';
  return null;
}

// ── persistence (per-ship, localStorage) ────────────────────────────────────

const STORAGE_PREFIX = 'scc-codex-mission:v1';

export function missionStorageKey(shipClassName: string): string {
  return `${STORAGE_PREFIX}:${shipClassName}`;
}

/** Reads the pilot's last mission choice for this hull, or null on any failure. */
export function loadStoredMission(shipClassName: string): MissionId | null {
  try {
    const raw = localStorage.getItem(missionStorageKey(shipClassName));
    return raw && MISSION_BY_ID.has(raw as MissionId) ? (raw as MissionId) : null;
  } catch {
    return null;
  }
}

/** Best-effort persistence — a blocked/full localStorage never breaks the page. */
export function storeMission(shipClassName: string, mission: MissionId): void {
  try {
    localStorage.setItem(missionStorageKey(shipClassName), mission);
  } catch {
    // ignore — storage is a convenience, not a requirement
  }
}
