// KPI strip: the six-cell set per lens, its tooltips, and the live power hook.
// -----------------------------------------------------------------------------
// PURE DOMAIN MODULE (MASTER §4/§12). `codex-loadout-stats.ts` keeps the math
// (`computeKpiSheet`, `buildKpiCells`); this module owns the *presentation
// contract* around it: which six KPIs a lens shows, which of them read
// better-when-lower, which carry an ⓘ tooltip, and how the energy dock rewrites
// the sheet before the cells are built.

import { computeKpiDelta, KpiCell, KpiSheet, buildKpiCells, kpiLowerIsBetter } from './codex-loadout-stats';
import type { KpiDelta } from './codex-loadout-stats';
import { KpiKey, MissionDef, MissionId, missionById } from './codex-mission';
import type { PowerSheet } from './codex-power';

/** The six cells a lens shows, in display order (MASTER §4). */
export function kpiSetFor(mission: MissionId | MissionDef | string | null | undefined): readonly KpiKey[] {
  const def = typeof mission === 'object' && mission ? mission : missionById(mission as string | null);
  return def.kpis;
}

// MASTER §12 wants ONE named decider for the up/down colour. It lives in
// `codex-loadout-stats.ts` next to the delta math; re-exported here so the
// strip, the dock facts and the picker columns all import it from one place.
export { kpiLowerIsBetter };

/** Tooltip body keys — only the two DPS cells carry one (MASTER §4). */
const KPI_TOOLTIP: Partial<Record<KpiKey, string>> = {
  burstDps: 'codex.kpi.tooltipBurstDps',
  sustainedDps: 'codex.kpi.tooltipSustainedDps',
};

export function kpiTooltipKey(key: KpiKey): string | null {
  return KPI_TOOLTIP[key] ?? null;
}

/**
 * The delta chip's value: `null` for "unchanged" — the strip renders NOTHING,
 * never a `±0` chip (MASTER §4). Thin wrapper over `computeKpiDelta` so callers
 * that only need the raw difference do not re-implement the ±0 rule.
 */
export function kpiDelta(key: KpiKey, base: number | null, current: number | null): KpiDelta | null {
  return computeKpiDelta(key, base, current);
}

export interface KpiStripCell extends KpiCell {
  lowerIsBetter: boolean;
  tooltipKey: string | null;
  /** true when the energy dock (not the loadout) is what changed this value. */
  fromPower: boolean;
}

/**
 * The energy dock's override on the KPI sheet (R-B15). Cutting the weapons
 * group takes the guns off the net, so both DPS figures become a hard 0 —
 * alpha stays untouched because it is a per-shot property of the gun, not of
 * the power state. Nothing else in the sheet is touched: HP, mass and the
 * cross-section do not care about the allocation.
 *
 * Returns the SAME object when nothing changes, so a signal graph can cheap-
 * compare identity.
 */
export function applyPowerEffects(sheet: KpiSheet, power: PowerSheet | null | undefined): KpiSheet {
  if (!power || !power.available || !power.weaponsCut) return sheet;
  if (sheet.sustainedDps === null && sheet.burstDps === null) return sheet;
  return { ...sheet, sustainedDps: 0, burstDps: 0 };
}

/** Which KPI keys the power sheet is allowed to rewrite (for the `fromPower` flag). */
const POWER_DRIVEN: ReadonlySet<KpiKey> = new Set<KpiKey>(['burstDps', 'sustainedDps']);

/**
 * The full strip: baseline sheet (factory loadout) vs. the current draft, with
 * the dock's effects applied on top of the current side only. The delta chip
 * therefore reads `−837` when the pilot cuts the weapons group, exactly as the
 * concept's screen `#h1` shows it.
 */
export function buildKpiStrip(
  mission: MissionDef,
  factory: KpiSheet,
  current: KpiSheet,
  power?: PowerSheet | null,
): KpiStripCell[] {
  const effective = applyPowerEffects(current, power);
  const changedByPower = effective !== current;
  return buildKpiCells(mission, factory, effective).map((cell) => ({
    ...cell,
    lowerIsBetter: kpiLowerIsBetter(cell.key),
    tooltipKey: kpiTooltipKey(cell.key),
    fromPower: changedByPower && POWER_DRIVEN.has(cell.key),
  }));
}
