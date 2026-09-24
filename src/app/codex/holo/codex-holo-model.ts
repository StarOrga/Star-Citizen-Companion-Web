// Shared shapes of the Holotable stage and its two presentational children
// (`sc-codex-holo-table`, `sc-codex-holo-inspector`). The stage owns every
// computation; the children only render what these types carry.
import type { LayoutSlot } from '../codex-hardpoint-layout.component';
import type { ShipModuleSection } from '../ship-module-sections';

/** The arrival choreography (concept hv3-s1), one phase at a time:
 * `wait` — the hero art is being fetched (≤ a few hundred ms, the canvas holds);
 * `hero` — the art is on the table; `reveal` — it dissolves while the outline
 * draws, the pins pop in and the panels rise; `done` — the static table.
 * Reduced motion and a repeat visit in the session go straight to `done`. */
export type HoloPhase = 'wait' | 'hero' | 'reveal' | 'done';

/** One pin on the silhouette: an anchored port, or one placed on the fallback
 * ring (dashed — its position is estimated). Numbered in ports-list order so
 * the legend, the inspector counter and the digit hotkeys mean the same pin. */
export interface StagePin {
  portName: string;
  index: number;
  x: number;
  y: number;
  resolved: boolean;
  /** Where the label sits relative to the dot — chosen so ring neighbours
   * never run into each other (top/bottom pins stack vertically). */
  side: 'right' | 'left' | 'above' | 'below';
  /** What sits in the port (occupant name, else the humanized port label). */
  label: string;
  /** Short value shown on hover ("Hover = Kurzwerte"): the row's first stat. */
  short: string | null;
  /** Missile racks pin gold (concept legend), everything else accent. */
  tone: 'accent' | 'gold';
  slot: LayoutSlot | null;
  /** The loadout block the port belongs to; null for a raw extract port. */
  section: ShipModuleSection | null;
}

/** The ellipse the un-anchored pins sit on, in % of the square pin canvas. */
export interface PinRing {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** The inspector's hardpoint list: the pins of one loadout block. */
export interface PinGroup {
  key: string;
  labelKey: string;
  pins: readonly StagePin[];
}

/** One journal row — a single draft-changed hardpoint, sourced straight off
 * the same `LayoutSlot.draftState`/`draftPaths` the ports list renders. */
export interface JournalEntry {
  port: string;
  label: string;
  state: 'changed' | 'pending' | 'unresolved';
  paths: string[];
}

/**
 * `n` points on the ring, equally spaced ALONG ITS OUTLINE — starting at the
 * nose (top centre) and running clockwise.
 *
 * Equal ANGLE steps bunch the points at the narrow ends of an elongated ring:
 * a capital ship's ring is tall and thin, and its nose/tail pins sat on top of
 * each other while the flanks stayed sparse. Walking a sampled perimeter keeps
 * every neighbour the same distance apart, whatever the ring's aspect.
 */
export function ringPositions(ring: PinRing, n: number): { x: number; y: number }[] {
  if (n <= 0) return [];
  const samples = 360;
  const pts: { x: number; y: number }[] = [];
  const cum: number[] = [0];
  for (let i = 0; i <= samples; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / samples;
    pts.push({ x: ring.cx + ring.rx * Math.cos(a), y: ring.cy + ring.ry * Math.sin(a) });
    if (i > 0) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[samples];
  const out: { x: number; y: number }[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / n;
    while (j < samples - 1 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (target - cum[j]) / seg));
    out.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * t, y: pts[j].y + (pts[j + 1].y - pts[j].y) * t });
  }
  return out;
}

/**
 * The ship name without the maker's own first word when the display name
 * repeats it ("Aegis Avenger Stalker" under "Aegis Dynamics" → "Avenger
 * Stalker") — the maker is printed right above it. Names that do not start
 * with that word ("RSI Polaris" under "Roberts Space Industries") stay whole.
 */
export function shipNameWithoutMaker(displayName: string, manufacturer: string | null): string {
  const name = displayName.trim();
  const first = (manufacturer ?? '').trim().split(/\s+/)[0];
  if (!first) return name;
  const prefix = `${first.toLowerCase()} `;
  if (!name.toLowerCase().startsWith(prefix)) return name;
  return name.slice(prefix.length).trim() || name;
}
