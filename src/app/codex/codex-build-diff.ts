// Build-scoped patch-diff — pure ship-row delta math.
// -----------------------------------------------------------------------------
// Every codex_* table is FK'd to codex_builds and ingest-catalog never prunes
// old builds, so a diff between the two most recent LIVE builds is a plain SQL
// read (CodexService.ownedFleetDeltas). This module owns the framework-free math
// that turns two versions of the SAME ship row into inline green/red deltas.
//
// SCOPE: ship-ROW numerics only (flight speeds + crew). The extractor currently
// ships flight stats as null (see ShipPayload docs), so real deltas appear only
// once those resolve — the mechanism is correct now and simply renders nothing
// until then. Per-component "Schild +700 / Kuehler -0.3" deltas need a two-build
// default-loadout component join and are intentionally out of scope here.

import type { CodexListRow } from './codex.service';

/** A single changed numeric on a ship between two builds. */
export interface ShipStatDelta {
  /** i18n key for the stat label. */
  labelKey: string;
  from: number;
  to: number;
  /** to - from (signed). */
  delta: number;
  /**
   * Colour semantics: `up` = improved (green), `down` = worse (red),
   * `neutral` = changed but no better/worse polarity (rendered without colour).
   */
  direction: 'up' | 'down' | 'neutral';
  unit?: string;
}

interface ShipDiffField {
  labelKey: string;
  /** true = higher is better (green when it rises); null = no polarity. */
  higherIsBetter: boolean | null;
  unit?: string;
  /** Extract the comparable number from a ship list row, or null if absent. */
  get: (row: CodexListRow) => number | null;
}

function flightStat(row: CodexListRow, key: string): number | null {
  const payload = row.payload as { flight?: Record<string, unknown> } | null | undefined;
  const v = payload?.flight?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * The curated, comparable ship-row fields. Kept small and explicit: only fields
 * with a real numeric and a defensible polarity. Extend as the extractor
 * resolves more stable ship stats.
 */
export const SHIP_DIFF_FIELDS: readonly ShipDiffField[] = [
  {
    labelKey: 'codex.landing.diff.scm',
    higherIsBetter: true,
    unit: 'm/s',
    get: (r) => flightStat(r, 'scmSpeed'),
  },
  {
    labelKey: 'codex.landing.diff.max',
    higherIsBetter: true,
    unit: 'm/s',
    get: (r) => flightStat(r, 'maxSpeed'),
  },
  {
    labelKey: 'codex.landing.diff.boost',
    higherIsBetter: true,
    unit: 'm/s',
    get: (r) => flightStat(r, 'boostSpeed'),
  },
  {
    // Crew size has no "better" direction — a change is informational only.
    labelKey: 'codex.landing.diff.crew',
    higherIsBetter: null,
    get: (r) => (typeof r.crewSize === 'number' && Number.isFinite(r.crewSize) ? r.crewSize : null),
  },
];

function directionFor(higherIsBetter: boolean | null, from: number, to: number): ShipStatDelta['direction'] {
  if (higherIsBetter == null) return 'neutral';
  const improved = higherIsBetter ? to > from : to < from;
  return improved ? 'up' : 'down';
}

/**
 * Diff the same ship across two builds (`current` vs `previous`). Emits one
 * ShipStatDelta per curated field whose value is present on BOTH sides and
 * changed. A field missing on either side, or unchanged, yields nothing — so a
 * ship with no comparable movement produces an empty array (render nothing,
 * never a "no change" row).
 */
export function computeShipRowDeltas(
  current: CodexListRow,
  previous: CodexListRow,
  fields: readonly ShipDiffField[] = SHIP_DIFF_FIELDS,
): ShipStatDelta[] {
  const out: ShipStatDelta[] = [];
  for (const field of fields) {
    const to = field.get(current);
    const from = field.get(previous);
    if (from == null || to == null || from === to) continue;
    out.push({
      labelKey: field.labelKey,
      from,
      to,
      delta: to - from,
      direction: directionFor(field.higherIsBetter, from, to),
      unit: field.unit,
    });
  }
  return out;
}
