/**
 * Types shared by codex-detail and its sub-components in detail/ and holo/.
 * They live here, not in codex-detail.component.ts, so nothing has to import
 * the page component itself (AUD-177, import cycle 4).
 */
import type { CodexItemPort, CodexBlueprintIngredient } from '../codex.types';
import type { CodexKind, CompatibleItem } from '../codex.service';
import type { HardpointCategory } from '../codex-format';
import type { QuantumStats } from '../../hangar/loadout-stats';
import type { ShipModuleGroup } from '../ship-module-sections';

/** One census chip on the stage: a loadout block, its count, an optional detail. */
export interface StageCountChip {
  group: ShipModuleGroup;
  count: number;
  labelKey: string;
  /** i18n key taking `{ n: detailCount }`, or null when the count says it all. */
  detailKey: string | null;
  detailCount: number;
}

// Lazy-loaded compatible-items state per hardpoint (keyed by port_index).
export interface PortCompat {
  loading: boolean;
  error: string | null;
  items: CompatibleItem[];
}

// A compact hero fact chip (manufacturer, role, crew, size, …).
export interface Fact {
  label: string;
  value: string;
  accent?: boolean;
}

// Hardpoints grouped by functional category for display.
export interface PortGroup {
  category: HardpointCategory;
  ports: CodexItemPort[];
}

// Tech spec facts derived from the stock loadout's component payloads (#137):
// quantum drive numbers plus summed hydrogen / quantum fuel tank capacities.
export interface ShipTechStats {
  quantum: QuantumStats;
  quantumDriveClassName: string | null;
  hydrogenCapacity: number | null;
  quantumFuelCapacity: number | null;
}

export interface LoadoutItem {
  port: string;
  className: string | null;
  kind: CodexKind | null;
  name: string | null; // friendly name (falls back to className)
  size: number | null;
  grade: string | null;
  manufacturerCode: string | null;
  /**
   * Sub-port name → the class the stock loadout installs there, for the item on
   * THIS hardpoint. Empty when the extract carries no nested fit for it.
   */
  carried: ReadonlyMap<string, string>;
}
// What an occupied hardpoint proves about the bay it sits in (see portFitIndex).
export interface PortFit {
  attachType: string;
  size: number | null;
}

// What may go into an UNFITTED hardpoint, and where that answer came from.
export interface EmptyFit {
  types: string[];
  size: number | null;
  /** true = borrowed from an identical fitted bay, not read off this port. */
  inferred: boolean;
}

// The recipe that PRODUCES this entity (#187: "which materials do I need").
export interface GearRecipe {
  classNameSlug: string;
  craftTimeSec: number | null;
  ingredients: CodexBlueprintIngredient[];
}
