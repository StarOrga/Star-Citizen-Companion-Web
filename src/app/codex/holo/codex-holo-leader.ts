// Leader-line layout of the Holotable (#642): every pin's dot sits on its
// hull anchor, its label in the nearest free slot of a label column left or
// right of the hull, joined by a thin leader line. Pure geometry: the table
// measures its frame, this function decides where everything goes — or that
// it does not fit and the numbered key stays (returns null).

/** One pin as the layout sees it: where its dot sits, in % of the hull square. */
export interface LeaderPinInput {
  portName: string;
  index: number;
  /** 0..100, % of the hull square's width (the dot). */
  x: number;
  /** 0..100, % of the hull square's height (the dot). */
  y: number;
}

/** The measured projection surface (`.silhouette-frame`), in CSS px. */
export interface LeaderFrame {
  width: number;
  height: number;
  /** Touch pointer: every label is a 48px tap target, the slot pitch grows with it. */
  coarse?: boolean;
  /** Horizontal extent of the drawn hull inside its square, in % (the
   * silhouette's bbox) — the columns hug the outline, not the square. */
  hullSpan?: { x0: number; x1: number };
}

export interface LeaderRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LeaderLabel {
  portName: string;
  index: number;
  side: 'left' | 'right';
  /** The label button, in frame px. */
  rect: LeaderRect;
  /** The dot, in frame px. */
  dot: { x: number; y: number };
  /** SVG path: dot → elbow at the label's height → the label's inner edge. */
  path: string;
}

export interface LeaderLayout {
  /** The hull square (the table's `.shipwrap`), in frame px — centred. */
  hull: LeaderRect;
  /** The band between the two columns that the outline and every dot use. */
  body: LeaderRect;
  /** Label slots per column; the layout holds at most twice this many pins. */
  slotsPerColumn: number;
  labels: LeaderLabel[];
}

/** Label box height on a fine pointer, and the gap between two slots. */
export const LEADER_LABEL_H = 22;
export const LEADER_SLOT_GAP = 4;
/** On a touch pointer every label is a 48px tap target (`--sc-tap-min`). */
export const LEADER_LABEL_H_COARSE = 48;
/** Column width: a label of ~20 uppercase characters fits at the max; below
 * the min a label is mostly ellipsis, so the key is the better read. */
export const LEADER_COL_MAX_W = 176;
export const LEADER_COL_MIN_W = 112;
/** Between the hull and a column: the dot's halo, the leader's elbow and an
 * un-anchored ring pin (the ring stays inside the hull square in this mode). */
export const LEADER_COL_GAP = 28;
/** Outer margin of a column to the frame edge, and the hull's vertical inset. */
export const LEADER_EDGE = 8;
export const LEADER_V_INSET = 16;
/** The hull square: the same 560px cap as the ring mode; below the min the
 * outline is too small to tell where a dot sits — the key reads better. The
 * columns grow toward their max only while the hull keeps the preferred size. */
export const LEADER_HULL_MAX = 560;
export const LEADER_HULL_MIN = 240;
export const LEADER_HULL_PREF = 320;
/** Length of the horizontal run into the label. */
const ELBOW = 12;

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Lay out leader labels for `pins` on a frame of the given size.
 *
 * Returns null (the caller keeps the numbered key) when there is nothing to
 * label, when the frame cannot hold a {@link LEADER_HULL_MIN} hull plus two
 * {@link LEADER_COL_MIN_W} columns (phones: a 390px frame never can), or when
 * there are more pins than slots. The slot count is the threshold: a column
 * spans the frame's height up to the 560px hull cap, so it holds
 * `floor((span + gap) / pitch)` labels — at most 21 per side with a 26px
 * pitch (42 in all; 20 with 48px touch labels). A Javelin's 47 pins never fit
 * and keep the key at every width.
 *
 * Guarantees, pinned by the spec: no two label rects overlap, no label
 * overlaps the outline's band or a dot, every label lies inside the frame, and within a
 * column the labels keep their dots' top-to-bottom order (the horizontal
 * runs of two leaders never cross).
 */
export function layoutLeaderLabels(pins: readonly LeaderPinInput[], frame: LeaderFrame): LeaderLayout | null {
  const n = pins.length;
  if (n === 0) return null;
  const { width: W, height: H } = frame;
  if (!(W > 0) || !(H > 0)) return null;

  const labelH = frame.coarse ? LEADER_LABEL_H_COARSE : LEADER_LABEL_H;
  const pitch = labelH + LEADER_SLOT_GAP;

  // Hull first by height, then the columns take what the width leaves (up to
  // their max); a narrow frame shrinks the columns before it shrinks the hull.
  // The drawn hull (bbox) and every dot, as a half-width around the centre
  // line — the columns may overlap the square's empty margins, never a dot.
  const x0 = Math.min(frame.hullSpan?.x0 ?? 0, ...pins.map((p) => p.x));
  const x1 = Math.max(frame.hullSpan?.x1 ?? 100, ...pins.map((p) => p.x));
  const half = Math.min(0.5, Math.max(0.05, Math.max(50 - x0, x1 - 50) / 100));
  const avail = W - 2 * LEADER_EDGE - 2 * LEADER_COL_GAP;
  const byHeight = Math.min(LEADER_HULL_MAX, H - 2 * LEADER_V_INSET);
  const colW = Math.floor(
    Math.min(LEADER_COL_MAX_W, Math.max(LEADER_COL_MIN_W, (avail - Math.min(byHeight, LEADER_HULL_PREF) * 2 * half) / 2)),
  );
  const size = Math.floor(Math.min(byHeight, (avail - 2 * colW) / (2 * half)));
  if (size < LEADER_HULL_MIN) return null;

  // A column spans the frame's height, but never more than the largest hull:
  // a label further than that from its dot makes a leader nobody follows.
  const span = Math.min(LEADER_HULL_MAX, H - 2 * LEADER_V_INSET);
  const slots = Math.floor((span + LEADER_SLOT_GAP) / pitch);
  if (n > 2 * slots) return null;

  const hull: LeaderRect = { x: round((W - size) / 2), y: round((H - size) / 2), w: size, h: size };
  const body: LeaderRect = { x: round(W / 2 - half * size), y: hull.y, w: round(2 * half * size), h: size };
  const dotOf = (p: LeaderPinInput) => ({ x: hull.x + (p.x / 100) * size, y: hull.y + (p.y / 100) * size });

  // Side: the half of the hull the dot sits in. Centre-line dots (a nose gun,
  // the radar) go to whichever side has fewer so far, top to bottom.
  const byY = [...pins].sort((a, b) => a.y - b.y || a.index - b.index);
  const left: LeaderPinInput[] = [];
  const right: LeaderPinInput[] = [];
  for (const p of byY) {
    if (p.x < 50) left.push(p);
    else if (p.x > 50) right.push(p);
    else (left.length <= right.length ? left : right).push(p);
  }
  // A side over its slot count hands its most central dots across.
  const rebalance = (from: LeaderPinInput[], to: LeaderPinInput[]) => {
    while (from.length > slots) {
      let k = 0;
      for (let i = 1; i < from.length; i++) if (Math.abs(from[i].x - 50) < Math.abs(from[k].x - 50)) k = i;
      to.push(from.splice(k, 1)[0]);
    }
    to.sort((a, b) => a.y - b.y || a.index - b.index);
  };
  rebalance(left, right);
  rebalance(right, left);

  // The slot grid, centred on the frame's height.
  const stack = slots * pitch - LEADER_SLOT_GAP;
  const top0 = (H - stack) / 2;
  const slotTop = (j: number) => top0 + j * pitch;

  const leftX = body.x - LEADER_COL_GAP - colW;
  const rightX = body.x + body.w + LEADER_COL_GAP;

  const labels: LeaderLabel[] = [];
  for (const [list, sideName] of [[left, 'left'], [right, 'right']] as const) {
    const ys = list.map((p) => dotOf(p).y);
    const assigned = assignSlots(ys, slots, (j) => slotTop(j) + labelH / 2);
    list.forEach((p, i) => {
      const dot = dotOf(p);
      const y = slotTop(assigned[i]);
      const rect: LeaderRect = { x: round(sideName === 'left' ? leftX : rightX), y: round(y), w: colW, h: labelH };
      const ly = round(y + labelH / 2);
      const edge = sideName === 'left' ? rect.x + colW : rect.x;
      const elbow = sideName === 'left' ? edge + ELBOW : edge - ELBOW;
      labels.push({
        portName: p.portName,
        index: p.index,
        side: sideName,
        rect,
        dot: { x: round(dot.x), y: round(dot.y) },
        path: `M${round(dot.x)} ${round(dot.y)}L${round(elbow)} ${ly}L${round(edge)} ${ly}`,
      });
    });
  }
  labels.sort((a, b) => a.index - b.index);
  return { hull, body, slotsPerColumn: slots, labels };
}

/**
 * Order-preserving assignment of `ys.length` (sorted) items to `m` slots that
 * minimises the summed distance between an item and its slot's centre — each
 * label lands in the nearest free slot without two labels swapping order.
 * Dynamic programme, O(n·m); n, m ≤ ~21.
 */
function assignSlots(ys: readonly number[], m: number, centre: (j: number) => number): number[] {
  const n = ys.length;
  if (n === 0) return [];
  // cost[i][j]: best cost of placing items 0..i with item i in slot j.
  const cost: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(Infinity));
  const from: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(-1));
  for (let j = 0; j <= m - n; j++) cost[0][j] = Math.abs(ys[0] - centre(j));
  for (let i = 1; i < n; i++) {
    let best = Infinity;
    let bestJ = -1;
    for (let j = i; j <= m - n + i; j++) {
      // best over cost[i-1][0..j-1], carried along as j grows.
      if (cost[i - 1][j - 1] < best) {
        best = cost[i - 1][j - 1];
        bestJ = j - 1;
      }
      cost[i][j] = best + Math.abs(ys[i] - centre(j));
      from[i][j] = bestJ;
    }
  }
  let j = 0;
  for (let k = 1; k < m; k++) if (cost[n - 1][k] < cost[n - 1][j]) j = k;
  const out = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = j;
    j = from[i][j];
  }
  return out;
}

/** Normalised port name for anchor matching: the uploader and the loadout
 * agree on the name, but not always on its case. */
export function anchorKey(name: string): string {
  return name.trim().toLowerCase();
}
