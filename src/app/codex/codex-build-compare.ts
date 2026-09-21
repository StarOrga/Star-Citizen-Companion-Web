// Build-scoped ship-detail Δ (patch selector — concept decision 4: "Patch
// selector + Δ view is IN scope"). PURE MODULE: given two build-scoped KPI
// sheets + port-occupant maps (already resolved by the caller — see
// `CodexService.shipDetailForBuild`), produces the diff the Holotable needs:
// one delta per KPI cell, one delta per port occupant, and the four
// perspective (Offensive/Verteidigung/Bewegung/Signatur&Kühlung) aggregates
// the strip_final layout groups them into (concept decisions it.10).
//
// Reuses `computeKpiDelta` from codex-loadout-stats.ts — the SAME "±0 renders
// nothing" rule the existing KPI band uses — rather than re-implementing the
// up/down/pct math here.

import { computeKpiDelta, KpiDelta, KpiSheet } from './codex-loadout-stats';
import { KpiKey } from './codex-mission';

/** The four analysis perspectives (concept it.9 "Weg B", it.10 strip_final). */
export type Perspective = 'offensive' | 'defensive' | 'movement' | 'signature';

export const PERSPECTIVES: readonly Perspective[] = ['offensive', 'defensive', 'movement', 'signature'];

/**
 * Which KPI keys belong to which perspective tile. Mirrors the grouping
 * `codex-analysis-panels.component.ts` already renders (Offensive/Defensive/
 * Ship-Systems/Signatur), just keyed by the KpiKey the KPI sheet carries
 * rather than re-deriving the numbers from occupants a second time.
 */
export const PERSPECTIVE_KPIS: Readonly<Record<Perspective, readonly KpiKey[]>> = {
  offensive: ['alpha', 'burstDps', 'sustainedDps', 'missiles'],
  defensive: ['shieldHp', 'shieldRegen', 'hullHp', 'effectiveHp', 'armorHp'],
  movement: ['scm', 'maxSpeed', 'boost', 'agility', 'quantumSpeed', 'quantumRange', 'spool', 'mass', 'cargo'],
  signature: ['ir', 'emIdle', 'emMax', 'crossSection'],
};

/** Every KPI key the four perspectives cover — in perspective order. */
export const ALL_KPI_KEYS: readonly KpiKey[] = PERSPECTIVES.flatMap((p) => PERSPECTIVE_KPIS[p]);

export interface KpiCellDelta {
  key: KpiKey;
  from: number | null;
  to: number | null;
  /** null = unchanged or one side is a gap — "renders nothing", never `±0`. */
  delta: KpiDelta | null;
  changed: boolean;
}

export interface PerspectiveDelta {
  perspective: Perspective;
  cells: readonly KpiCellDelta[];
  changedCount: number;
}

/** One port whose occupant differs between the two builds. */
export interface PortOccupantDelta {
  portName: string;
  fromClassName: string | null;
  toClassName: string | null;
}

/** portName -> occupant class name (null = empty bay) for ONE build. */
export type PortOccupantMap = Readonly<Record<string, string | null>>;

export interface BuildRef {
  id: string;
  patchVersion: string;
}

export interface ShipBuildCompareResult {
  fromBuild: BuildRef;
  toBuild: BuildRef;
  kpiCells: readonly KpiCellDelta[];
  perspectives: readonly PerspectiveDelta[];
  ports: readonly PortOccupantDelta[];
}

function cellDelta(key: KpiKey, from: number | null, to: number | null): KpiCellDelta {
  const delta = computeKpiDelta(key, from, to);
  return { key, from, to, delta, changed: delta !== null };
}

/** One delta per KPI key — `keys` defaults to every key the four perspectives cover. */
export function compareKpiSheets(
  from: KpiSheet,
  to: KpiSheet,
  keys: readonly KpiKey[] = ALL_KPI_KEYS,
): KpiCellDelta[] {
  return keys.map((key) => cellDelta(key, from[key] ?? null, to[key] ?? null));
}

/** Groups a flat KPI-cell delta list into the four perspective tiles. */
export function buildPerspectiveDeltas(cells: readonly KpiCellDelta[]): PerspectiveDelta[] {
  return PERSPECTIVES.map((perspective) => {
    const keys = new Set<KpiKey>(PERSPECTIVE_KPIS[perspective]);
    const tileCells = cells.filter((c) => keys.has(c.key));
    return {
      perspective,
      cells: tileCells,
      changedCount: tileCells.filter((c) => c.changed).length,
    };
  });
}

/**
 * Port-by-port occupant diff. A port present on only one side (a hardpoint
 * added/removed between patches) also surfaces — `fromClassName`/
 * `toClassName` is null on the absent side, same as an empty bay.
 */
export function comparePortOccupants(from: PortOccupantMap, to: PortOccupantMap): PortOccupantDelta[] {
  const portNames = new Set([...Object.keys(from), ...Object.keys(to)]);
  const out: PortOccupantDelta[] = [];
  for (const portName of portNames) {
    const fromClassName = from[portName] ?? null;
    const toClassName = to[portName] ?? null;
    if (fromClassName === toClassName) continue;
    out.push({ portName, fromClassName, toClassName });
  }
  return out.sort((a, b) => a.portName.localeCompare(b.portName));
}

/** The full Δ result the Holotable's patch view needs from two build-scoped inputs. */
export function compareShipBuilds(
  from: { build: BuildRef; kpiSheet: KpiSheet; occupants: PortOccupantMap },
  to: { build: BuildRef; kpiSheet: KpiSheet; occupants: PortOccupantMap },
): ShipBuildCompareResult {
  const kpiCells = compareKpiSheets(from.kpiSheet, to.kpiSheet);
  return {
    fromBuild: from.build,
    toBuild: to.build,
    kpiCells,
    perspectives: buildPerspectiveDeltas(kpiCells),
    ports: comparePortOccupants(from.occupants, to.occupants),
  };
}
