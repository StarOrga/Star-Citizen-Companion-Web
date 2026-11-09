/**
 * Screen-space geometry of the asset package viewer's overlay: where the
 * component label sits relative to the projected hull, the leader line to it,
 * the empty-slot ring's animation pose, and slot cycling. Pure (no three.js,
 * no DOM) so the specs pin it without WebGL.
 */

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

/** Screen rectangle in CSS pixels. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Where the label went: beside the hull (left/right), above/below it, or over it as a last resort. */
export type LabelSide = 'left' | 'right' | 'top' | 'bottom' | 'over';

export interface LabelPlacement {
  /** Label box top-left, CSS px inside the viewer. */
  readonly left: number;
  readonly top: number;
  readonly side: LabelSide;
  /** Leader line: from the (viewport-clamped) anchor to the nearest point of the label box. */
  readonly line: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
}

/** Gap between the hull silhouette and the label. */
export const LABEL_GAP = 28;
/** Minimum distance of the label from the viewer's edges. */
export const LABEL_MARGIN = 8;

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(Math.max(v, lo), hi));

/**
 * Place the component label outside the hull silhouette.
 *
 * Beside the hull on the side of the anchor first (the other side when that
 * one has no room), then above/below it, and only when the hull fills the
 * whole viewer clamped over it. The label is always fully inside the viewer,
 * so it stays readable at any rotation; the anchor of the leader line is
 * clamped too, so a component behind the camera edge still points somewhere
 * sensible.
 */
export function placeLabel(
  anchor: Pt,
  silhouette: Rect | null,
  label: Size,
  viewport: Size,
  gap = LABEL_GAP,
  margin = LABEL_MARGIN,
): LabelPlacement {
  const a: Pt = { x: clamp(anchor.x, 0, viewport.w), y: clamp(anchor.y, 0, viewport.h) };
  const s: Rect = silhouette ?? { left: a.x, top: a.y, right: a.x, bottom: a.y };
  const maxLeft = viewport.w - label.w - margin;
  const maxTop = viewport.h - label.h - margin;
  const besideTop = clamp(a.y - label.h / 2, margin, maxTop);
  const stackLeft = clamp(a.x - label.w / 2, margin, maxLeft);

  const right = { left: s.right + gap, top: besideTop, side: 'right' as const };
  const left = { left: s.left - gap - label.w, top: besideTop, side: 'left' as const };
  const top = { left: stackLeft, top: s.top - gap - label.h, side: 'top' as const };
  const bottom = { left: stackLeft, top: s.bottom + gap, side: 'bottom' as const };
  const fits = (c: { left: number; top: number }) =>
    c.left >= margin && c.left <= maxLeft && c.top >= margin && c.top <= maxTop;

  const cx = (s.left + s.right) / 2;
  const cy = (s.top + s.bottom) / 2;
  const horizontal = a.x >= cx ? [right, left] : [left, right];
  const vertical = a.y >= cy ? [bottom, top] : [top, bottom];
  const pick = [...horizontal, ...vertical].find(fits);
  const box = pick ?? {
    // No free side: beside the anchor, clamped into the viewer.
    left: clamp(a.x >= cx ? a.x + gap : a.x - gap - label.w, margin, maxLeft),
    top: besideTop,
    side: 'over' as const,
  };
  return {
    left: box.left,
    top: box.top,
    side: box.side,
    line: {
      x1: a.x,
      y1: a.y,
      x2: clamp(a.x, box.left, box.left + label.w),
      y2: clamp(a.y, box.top, box.top + label.h),
    },
  };
}

/** Bounding rectangle of projected points; null when there are none. */
export function rectOf(points: readonly Pt[]): Rect | null {
  if (points.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  return { left, top, right, bottom };
}

export interface RingPose {
  /** Rotation of the dashed ring (radians). */
  readonly angle: number;
  /** Scale of the pulse (1 = resting size). */
  readonly scale: number;
  /** Opacity of the ring (0..1). */
  readonly alpha: number;
}

/** One pulse of the empty-slot ring, seconds. */
export const RING_PULSE_S = 1.8;
/** Rotation speed of the dashed ring, radians per second (one turn in ~10 s). */
export const RING_SPIN = 0.6;

/**
 * Pose of the empty-slot ring at `seconds`: a slow rotation plus a pulse in
 * size and brightness. Reduced motion: the static resting pose.
 */
export function ringPose(seconds: number, reducedMotion: boolean): RingPose {
  if (reducedMotion) return { angle: 0, scale: 1, alpha: 0.9 };
  const pulse = 0.5 + 0.5 * Math.sin((seconds * 2 * Math.PI) / RING_PULSE_S);
  return { angle: (seconds * RING_SPIN) % (2 * Math.PI), scale: 1 + 0.14 * pulse, alpha: 0.6 + 0.4 * pulse };
}

/** The id after (dir 1) or before (dir -1) `current` in `ids`, wrapping; the first/last when `current` is not in it. */
export function cycleId(ids: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const i = current ? ids.indexOf(current) : -1;
  if (i < 0) return dir === 1 ? ids[0] : ids[ids.length - 1];
  return ids[(i + dir + ids.length) % ids.length];
}

/** Hotspots closer than this on screen (CSS px) count as one stack. */
export const FAN_JOIN_PX = 10;
/** Centre-to-centre distance between fanned-out dots: dot (12 px) plus a hit-area gap. */
export const FAN_SPACING_PX = 18;
/** Radius of the innermost ring of a fan (grows when more dots need room). */
const FAN_R0 = 14;

export interface FanInput extends Pt {
  readonly id: string;
}

/**
 * Pull stacked hotspots apart so each stays individually hoverable. Dots that
 * project within `join` px of each other (chains count: A near B near C is one
 * stack) are laid out on rings around the stack's centroid, `spacing` px apart,
 * in input order starting at 12 o'clock. Depends on screen positions only —
 * hover state never re-lays the fan out. Dots not in a stack keep their place.
 * Only the DOM dot moves; the 3D anchor (and the leader line) stay where they are.
 */
export function fanOut(items: readonly FanInput[], join = FAN_JOIN_PX, spacing = FAN_SPACING_PX): Map<string, Pt> {
  const out = new Map<string, Pt>();
  const n = items.length;
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y) <= join) parent[find(j)] = find(i);
    }
  }
  const stacks = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = stacks.get(r);
    if (list) list.push(i);
    else stacks.set(r, [i]);
  }
  for (const members of stacks.values()) {
    if (members.length === 1) {
      const it = items[members[0]];
      out.set(it.id, { x: it.x, y: it.y });
      continue;
    }
    const cx = members.reduce((a, i) => a + items[i].x, 0) / members.length;
    const cy = members.reduce((a, i) => a + items[i].y, 0) / members.length;
    let placed = 0;
    for (let ring = 0; placed < members.length; ring++) {
      const base = FAN_R0 + ring * spacing;
      // How many dots fit on this ring at `spacing` apart.
      const cap = Math.max(2, Math.floor(Math.PI / Math.asin(Math.min(1, spacing / (2 * base)))));
      const count = Math.min(cap, members.length - placed);
      const radius = Math.max(base, count > 1 ? spacing / (2 * Math.sin(Math.PI / count)) : 0);
      // Ring 0 hugs the chord limit (a pair sits `spacing` apart), outer rings keep their nominal radius.
      const r = ring === 0 ? (count > 1 ? spacing / (2 * Math.sin(Math.PI / count)) : 0) : radius;
      for (let k = 0; k < count; k++) {
        const a = -Math.PI / 2 + (2 * Math.PI * k) / count + (ring % 2 ? Math.PI / count : 0);
        const it = items[members[placed + k]];
        out.set(it.id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
      placed += count;
    }
  }
  relax(items, out, spacing);
  return out;
}

/**
 * Neighbouring fans (and lone dots next to a fan) may still overlap: push every
 * pair closer than `spacing` apart, a few passes, deterministic (input order).
 */
function relax(items: readonly FanInput[], pos: Map<string, Pt>, spacing: number): void {
  const pts = items.map((it) => ({ ...pos.get(it.id)! }));
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        let dx = pts[j].x - pts[i].x;
        let dy = pts[j].y - pts[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= spacing - 0.01) continue;
        if (d < 1e-6) {
          const a = (i * 2.399963) % (2 * Math.PI);
          dx = Math.cos(a);
          dy = Math.sin(a);
          d = 1;
        }
        const push = (spacing - d) / 2 + 0.01;
        const ux = dx / d;
        const uy = dy / d;
        pts[i].x -= ux * push;
        pts[i].y -= uy * push;
        pts[j].x += ux * push;
        pts[j].y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  items.forEach((it, i) => pos.set(it.id, pts[i]));
}

/** Insets in CSS px the model must stay out of (the holotable's callout gutters, the chip row). */
export interface SafeArea {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Air between the model's projected box and the safe area's edge. */
export const FIT_PADDING = 8;
/** The model keeps at least this share of the canvas, however wide the gutters are. */
const MIN_SAFE_SHARE = 0.15;

/** Scale insets down when they would leave the model less than {@link MIN_SAFE_SHARE} of an axis. */
export function usableSafeArea(safe: SafeArea, viewport: Size): SafeArea {
  const axis = (a: number, b: number, size: number): [number, number] => {
    const lo = Math.max(a, 0);
    const hi = Math.max(b, 0);
    const room = size * (1 - MIN_SAFE_SHARE);
    const k = lo + hi > room && lo + hi > 0 ? room / (lo + hi) : 1;
    return [lo * k, hi * k];
  };
  const [left, right] = axis(safe.left, safe.right, viewport.w);
  const [top, bottom] = axis(safe.top, safe.bottom, viewport.h);
  return { left, right, top, bottom };
}

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The camera's unit axes in world space. */
export interface ViewBasis {
  readonly right: Vec3Like;
  readonly up: Vec3Like;
  /** Towards the camera. */
  readonly back: Vec3Like;
}

const dotDiff = (a: Vec3Like, o: Vec3Like, b: Vec3Like) => (a.x - o.x) * b.x + (a.y - o.y) * b.y + (a.z - o.z) * b.z;

/**
 * The smallest camera distance from the pivot along the view axis at which every
 * corner projects inside the safe area, with the pivot on the safe area's
 * centre (the scene shifts it there with a view offset). Exact, not a fixed
 * scale: a corner at (x, y) with depth d - z lands at x * f / (d - z) pixels
 * from the centre, which solves for d per corner and axis.
 */
export function fitDistance(
  corners: readonly Vec3Like[],
  pivot: Vec3Like,
  basis: ViewBasis,
  fovDeg: number,
  viewport: Size,
  safe: SafeArea,
  padding = FIT_PADDING,
): number {
  const f = viewport.h / 2 / Math.tan((fovDeg * Math.PI) / 360);
  const halfW = Math.max((viewport.w - safe.left - safe.right) / 2 - padding, 1);
  const halfH = Math.max((viewport.h - safe.top - safe.bottom) / 2 - padding, 1);
  let d = 0;
  for (const c of corners) {
    const z = dotDiff(c, pivot, basis.back);
    d = Math.max(
      d,
      z + (Math.abs(dotDiff(c, pivot, basis.right)) * f) / halfW,
      z + (Math.abs(dotDiff(c, pivot, basis.up)) * f) / halfH,
    );
  }
  return d;
}

/** Radius of the ring around the selected dot; the leader line stops at it. */
export const MARKER_RADIUS = 13;
/** Gap between the callout and the safe area's edge. */
const CALLOUT_GAP = 12;

/**
 * The callout's fixed size at a window width: 188 x 88 from 1920 up, 165 x 77
 * at 1440, never below 0.8 of it. The viewer's CSS (--co-u) computes the same;
 * a host sizes its gutters with {@link calloutGutter}.
 */
export function calloutSize(windowWidth: number): Size {
  const u = clamp(0.5 + windowWidth / 3840, 0.8, 1);
  return { w: 188 * u, h: 88 * u };
}

/** Gutter width that holds the callout at a window width. */
export function calloutGutter(windowWidth: number): number {
  return Math.ceil(calloutSize(windowWidth).w) + CALLOUT_GAP + LABEL_MARGIN;
}

export interface CalloutPlacement extends LabelPlacement {
  /** Centre of the marker ring (the anchor, clamped into the viewer). */
  readonly anchor: Pt;
}

/**
 * Place the callout inside a reserved gutter: the one on the anchor's side,
 * else the other. Only line and marker reach over the model. Null when neither
 * gutter holds the box (narrow layouts have none: the panel carries it alone).
 */
export function placeCallout(anchor: Pt, box: Size, viewport: Size, safe: SafeArea, margin = LABEL_MARGIN): CalloutPlacement | null {
  const a: Pt = { x: clamp(anchor.x, 0, viewport.w), y: clamp(anchor.y, 0, viewport.h) };
  const fitsLeft = safe.left >= box.w + margin;
  const fitsRight = safe.right >= box.w + margin;
  if (!fitsLeft && !fitsRight) return null;
  const centre = (safe.left + viewport.w - safe.right) / 2;
  const side: 'left' | 'right' = (a.x < centre ? fitsLeft : !fitsRight) ? 'left' : 'right';
  const left =
    side === 'left'
      ? Math.max(safe.left - box.w - CALLOUT_GAP, margin)
      : Math.min(viewport.w - safe.right + CALLOUT_GAP, viewport.w - box.w - margin);
  const top = clamp(a.y - box.h / 2, margin, viewport.h - box.h - margin);
  const x2 = side === 'left' ? left + box.w : left;
  const y2 = top + box.h / 2;
  // The line starts at the marker ring, not under the dot.
  const len = Math.hypot(x2 - a.x, y2 - a.y) || 1;
  const k = Math.min(MARKER_RADIUS / len, 1);
  return {
    left,
    top,
    side,
    anchor: a,
    line: { x1: a.x + (x2 - a.x) * k, y1: a.y + (y2 - a.y) * k, x2, y2 },
  };
}
