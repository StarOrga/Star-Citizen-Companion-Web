import type { StepKind } from '../../../shared/step/sc-step.component';

/**
 * Contract between Planen (`sc-hq-plan`) and its map (`sc-hq-plan-map`), plan
 * D27–D30: the plan decides WHAT is visible, the map only draws it.
 */

/** Where a need can be met: a node of the schematic System › Planet › Ort tree. */
export interface MapPlace {
  /** Stable id, `system/planet/location` slugs (`stanton/hurston/lorville`). */
  id: string;
  system: string;
  planet: string | null;
  location: string;
}

/** Need colour bucket = the set (or note) the need belongs to (D29: colour = need). */
export interface MapNeed {
  /** Supply id (`hq_supplies.id`). */
  id: string;
  label: string;
  kind: StepKind;
  qty: number;
  /** Fill = status (D29). */
  status: 'open' | 'partial' | 'done';
  /** Groups needs by colour; the set id or `note`. */
  colorKey: string;
  place: MapPlace | null;
}

/** One stop of a route ("Wie" view). Transport legs are their own steps (D17). */
export interface RouteStep {
  ord: number;
  kind: StepKind;
  label: string;
  place: MapPlace;
  needIds: string[];
  /** Leg from the previous stop: plain travel (dashed) or a transport leg (thick line). */
  leg: 'travel' | 'transport' | null;
}

export type PlanView = 'what' | 'how';
