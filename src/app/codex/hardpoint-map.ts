/**
 * Pure projection math for the hardpoint hull map (#137 part 3).
 *
 * The extractor (`data-uploader/python/sc_extract/hardpoints.py`) emits, per
 * ship, a `hardpointTransforms` map plus the `hardpointFrame` those positions
 * live in. Both are **metres in the hull mesh's own model space**, CryEngine
 * axes: `+X` = starboard/right, `+Y` = forward/nose, `+Z` = up. Nothing is
 * pre-normalised there on purpose — the frame is what makes the numbers
 * meaningful, and shipping both keeps the raw coordinates auditable.
 *
 * Here they become two 0..1 orthographic projections:
 *
 *   * **top** — looking down: x = model X (starboard right), y = model Y
 *     inverted so the nose points UP.
 *   * **side** — looking from starboard: x = model Y (nose to the RIGHT),
 *     y = model Z inverted so up is up.
 *
 * Everything validates before it projects: a malformed frame or position yields
 * no marker rather than a dot at 0,0. Positions outside the frame are clamped to
 * the panel edge and flagged, so a marker can never be drawn outside the hull
 * box it is supposed to sit in.
 */

/** The box hardpoint positions live in, as emitted with the ship payload. */
export interface HardpointFrame {
  min: number[];
  max: number[];
  /** `bbox` = the hull's own bounding box; `ports` = derived from the points. */
  source: 'bbox' | 'ports';
}

/** One resolved hardpoint transform from `payload.hardpointTransforms`. */
export interface HardpointTransform {
  position: number[];
  rotation: number[] | null;
  /** Mesh helper node the port resolved to (audit trail). */
  helper: string | null;
  /** How the join was made: `helper` | `portName` | `mesh`. */
  source: string | null;
}

/** A hardpoint the UI has a row for, before projection. */
export interface HardpointMarkerInput {
  /** Raw port name — the key both the list rows and the map highlight by. */
  port: string;
  /** Humanized port label. */
  label: string;
  /** What is installed there, if anything. */
  itemName: string | null;
  position: number[];
}

export interface Point2 {
  x: number;
  y: number;
}

export interface HardpointMarker extends HardpointMarkerInput {
  top: Point2;
  side: Point2;
  /** The position sat outside the frame and was pinned to its edge. */
  clamped: boolean;
}

/** Panel proportions (height per 100 units of width) for the two views. */
export interface HardpointViewBox {
  top: number;
  side: number;
}

const MIN_SPAN_M = 0.001;
// Panel height bounds, in the same 100-wide user space the SVG viewBox uses.
const TOP_MIN_H = 40;
const TOP_MAX_H = 260;
const SIDE_MIN_H = 16;
const SIDE_MAX_H = 160;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A finite numeric triple — anything else is not a coordinate. */
export function isVec3(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

/**
 * Validate a raw `hardpointFrame` from the payload. Rejects a degenerate or
 * inverted box: without a real extent there is nothing to normalise against.
 */
export function readHardpointFrame(raw: unknown): HardpointFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as { min?: unknown; max?: unknown; source?: unknown };
  if (!isVec3(f.min) || !isVec3(f.max)) return null;
  if (f.max.some((v, i) => v <= (f.min as number[])[i])) return null;
  return {
    min: f.min,
    max: f.max,
    source: f.source === 'ports' ? 'ports' : 'bbox',
  };
}

/**
 * Validate a raw `hardpointTransforms` map. Entries without a usable position
 * are dropped — a hardpoint we cannot place must not appear on the map at all.
 */
export function readHardpointTransforms(raw: unknown): Map<string, HardpointTransform> {
  const out = new Map<string, HardpointTransform>();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [port, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!port || !value || typeof value !== 'object') continue;
    const t = value as { position?: unknown; rotation?: unknown; helper?: unknown; source?: unknown };
    if (!isVec3(t.position)) continue;
    out.set(port, {
      position: t.position,
      rotation:
        Array.isArray(t.rotation) && t.rotation.length === 4 && t.rotation.every(isFiniteNumber)
          ? (t.rotation as number[])
          : null,
      helper: typeof t.helper === 'string' ? t.helper : null,
      source: typeof t.source === 'string' ? t.source : null,
    });
  }
  return out;
}

function span(frame: HardpointFrame, axis: number): number {
  return Math.max(frame.max[axis] - frame.min[axis], MIN_SPAN_M);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Panel heights that keep each view in the hull's real proportions. */
export function hardpointViewBox(frame: HardpointFrame): HardpointViewBox {
  const [sx, sy, sz] = [span(frame, 0), span(frame, 1), span(frame, 2)];
  const bound = (v: number, lo: number, hi: number) => Math.round(Math.min(Math.max(v, lo), hi));
  return {
    top: bound((100 * sy) / sx, TOP_MIN_H, TOP_MAX_H),
    side: bound((100 * sz) / sy, SIDE_MIN_H, SIDE_MAX_H),
  };
}

/**
 * Project one model-space position into the two 0..1 views. Returns null for a
 * malformed position; clamps (and reports) one that lies outside the frame.
 */
export function projectHardpoint(
  position: unknown,
  frame: HardpointFrame,
): { top: Point2; side: Point2; clamped: boolean } | null {
  if (!isVec3(position)) return null;
  const [x, y, z] = position;
  const u = (x - frame.min[0]) / span(frame, 0);
  const v = (y - frame.min[1]) / span(frame, 1);
  const w = (z - frame.min[2]) / span(frame, 2);
  const clamped = [u, v, w].some((n) => n < 0 || n > 1);
  return {
    // Nose up: model +Y is forward, screen Y grows downwards.
    top: { x: clamp01(u), y: clamp01(1 - v) },
    // Nose right, up is up.
    side: { x: clamp01(v), y: clamp01(1 - w) },
    clamped,
  };
}

/** Project every hardpoint that has a usable position, preserving input order. */
export function buildHardpointMarkers(
  inputs: readonly HardpointMarkerInput[],
  frame: HardpointFrame | null,
): HardpointMarker[] {
  if (!frame) return [];
  const out: HardpointMarker[] = [];
  for (const input of inputs) {
    const projected = projectHardpoint(input.position, frame);
    if (!projected) continue;
    out.push({ ...input, ...projected });
  }
  return out;
}
