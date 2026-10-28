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

/** Closest two anchored dots may sit, in % of the canvas — a dot is ~18px on
 * a ~400px table, so 5 % keeps every number readable down to phone width. */
export const PIN_MIN_GAP = 5;

/**
 * Anchors that (nearly) coincide — three shield generators on one bulkhead,
 * the coolers stacked over the power plant — drew their dots on top of each
 * other, so only the last number stayed visible (Nomad: 7 of 17). Each such
 * cluster is fanned out on a small circle around its centre, just wide enough
 * that neighbours sit `minGap` apart, in list order starting on the left. A
 * pin that stands alone keeps its anchor exactly; the leader line still
 * points into the cluster, which is where the parts really are.
 */
export function spreadStackedPins(points: readonly { x: number; y: number }[], minGap = PIN_MIN_GAP): { x: number; y: number }[] {
  const parent = points.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < minGap) parent[root(j)] = root(i);
    }
  }
  const clusters = new Map<number, number[]>();
  points.forEach((_, i) => {
    const r = root(i);
    const hit = clusters.get(r);
    if (hit) hit.push(i);
    else clusters.set(r, [i]);
  });
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  for (const members of clusters.values()) {
    const k = members.length;
    if (k < 2) continue;
    const cx = members.reduce((s, i) => s + points[i].x, 0) / k;
    const cy = members.reduce((s, i) => s + points[i].y, 0) / k;
    // Chord between neighbours on a circle of radius r is 2r·sin(π/k).
    const r = minGap / (2 * Math.sin(Math.PI / k));
    members.forEach((i, n) => {
      const a = Math.PI + (2 * Math.PI * n) / k;
      out[i] = { x: clamp(cx + r * Math.cos(a)), y: clamp(cy + r * Math.sin(a)) };
    });
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
