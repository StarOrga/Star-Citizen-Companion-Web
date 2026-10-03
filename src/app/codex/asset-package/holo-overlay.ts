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
