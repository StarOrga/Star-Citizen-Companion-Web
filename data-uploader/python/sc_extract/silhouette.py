"""Top-down ship/item SILHOUETTE extraction — mesh triangles -> a smoothed,
simplified 2D outline in the contract's normalised viewBox.

Consumed by the Codex Holotable ship view (every ship, painted or not) and by
the generic catalog tile art (weapons / components / armor with a mesh).
Wave 0 research §C1 defines the exact JSON this module builds; §C3 defines
what the website does when a row is missing — that is the website's job, not
ours: an entity with no mesh gets NO row from us, never a placeholder shape.

Pipeline (this module — pure, deterministic, no P4K/cgf-converter I/O; see
`silhouette_export.py` for the wiring that gets triangles onto this module's
doorstep):

    triangles (world-space metres, CryEngine axes +X right, +Y nose, +Z up)
        -> project to XY (drop Z, top-down)
        -> rasterise into a boolean mask (numpy; aspect-preserving, longer
           span -> `MASK_SIZE` px)
        -> morphological close+open (denoise: fills 1px gaps, drops speckle)
        -> trace the outer contour + interior holes (Moore-neighbour boundary
           following in pure Python — no opencv dependency in the uploader,
           see module docstring below for why)
        -> Chaikin-smooth, then Douglas-Peucker simplify (tolerance in metres,
           converted through the raster scale)
        -> normalise into the shared 0..1000 viewBox, aspect preserved, nose
           pointing up (screen Y grows down, so +Y model is inverted)

No opencv: `data-uploader/python/requirements.txt` pins scdatatools' own
transitive deps and deliberately keeps the uploader's own additions small
(Pillow only, for DDS/icon work); opencv is a large, unrelated native wheel
with no other consumer in this codebase. numpy is already a hard scdatatools
dependency, so the mask + morphology below reuse it rather than adding
anything new. The contour tracer is pure Python (no numpy) — correctness over
micro-performance, since this runs once per entity, not per pixel per frame.

Determinism: same triangles + same tuning constants -> byte-identical path
string. No RNG, no dict/set iteration order dependence in the hot path (mask
labelling below sorts before iterating).
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

Vec2 = Tuple[float, float]
Vec3 = Tuple[float, float, float]
Triangle = Tuple[Vec3, Vec3, Vec3]

MASK_SIZE = 1024
VIEWBOX = 1000
DEFAULT_SIMPLIFY_TOLERANCE_M = 0.15
# Below this pixel area a background pocket is raster noise, not a real hole
# (a 1024px mask: ~0.006% of the frame at this floor).
MIN_HOLE_AREA_PX = 24
CHAIKIN_ITERATIONS = 2
# A contour under this many points after tracing is not worth emitting (a
# handful of stray pixels the morphology pass did not fully clean up).
MIN_CONTOUR_POINTS = 8


# ── 1. project + rasterise ──────────────────────────────────────────────────

def project_topdown(triangles: Sequence[Triangle]) -> List[Tuple[Vec2, Vec2, Vec2]]:
    """Drop Z (up): keep (X, Y) = (starboard, nose) of every vertex."""
    return [((a[0], a[1]), (b[0], b[1]), (c[0], c[1])) for a, b, c in triangles]


def xy_bounds(tris_2d: Sequence[Tuple[Vec2, Vec2, Vec2]]) -> Optional[Tuple[float, float, float, float]]:
    """``(min_x, min_y, max_x, max_y)`` of every triangle vertex, or None."""
    xs: List[float] = []
    ys: List[float] = []
    for tri in tris_2d:
        for x, y in tri:
            if math.isfinite(x) and math.isfinite(y):
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def rasterize_mask(
    tris_2d: Sequence[Tuple[Vec2, Vec2, Vec2]],
    bounds: Tuple[float, float, float, float],
    mask_size: int = MASK_SIZE,
) -> Tuple[np.ndarray, float, int, int]:
    """Fill every triangle's XY projection into a boolean raster mask.

    Returns ``(mask, px_per_m, width, height)``. Aspect-preserving: the LONGER
    world-space span maps to ``mask_size`` pixels; the mask is only as
    wide/tall as the silhouette actually needs, never padded.
    """
    min_x, min_y, max_x, max_y = bounds
    span_x = max(max_x - min_x, 1e-6)
    span_y = max(max_y - min_y, 1e-6)
    px_per_m = mask_size / max(span_x, span_y)
    width = max(1, min(mask_size, round(span_x * px_per_m)))
    height = max(1, min(mask_size, round(span_y * px_per_m)))
    mask = np.zeros((height, width), dtype=bool)
    for a, b, c in tris_2d:
        _fill_triangle(mask, a, b, c, min_x, min_y, px_per_m, width, height)
    return mask, px_per_m, width, height


def _fill_triangle(mask: np.ndarray, a: Vec2, b: Vec2, c: Vec2,
                    min_x: float, min_y: float, px_per_m: float,
                    width: int, height: int) -> None:
    def to_px(p: Vec2) -> Vec2:
        return (p[0] - min_x) * px_per_m, (p[1] - min_y) * px_per_m

    ax, ay = to_px(a)
    bx, by = to_px(b)
    cx, cy = to_px(c)
    x0 = max(0, int(math.floor(min(ax, bx, cx))))
    x1 = min(width - 1, int(math.ceil(max(ax, bx, cx))))
    y0 = max(0, int(math.floor(min(ay, by, cy))))
    y1 = min(height - 1, int(math.ceil(max(ay, by, cy))))
    if x0 > x1 or y0 > y1:
        return
    denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(denom) < 1e-9:
        return  # degenerate (zero-area) triangle in the top-down projection
    xs = np.arange(x0, x1 + 1) + 0.5
    ys = np.arange(y0, y1 + 1) + 0.5
    gx, gy = np.meshgrid(xs, ys)
    w0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / denom
    w1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / denom
    w2 = 1.0 - w0 - w1
    inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
    mask[y0:y1 + 1, x0:x1 + 1] |= inside


# ── 2. morphological denoise ────────────────────────────────────────────────

def _dilate(mask: np.ndarray) -> np.ndarray:
    """One 8-connected dilation step."""
    out = mask.copy()
    out[:-1, :] |= mask[1:, :]
    out[1:, :] |= mask[:-1, :]
    out[:, :-1] |= mask[:, 1:]
    out[:, 1:] |= mask[:, :-1]
    out[:-1, :-1] |= mask[1:, 1:]
    out[1:, 1:] |= mask[:-1, :-1]
    out[:-1, 1:] |= mask[1:, :-1]
    out[1:, :-1] |= mask[:-1, 1:]
    return out


def _erode(mask: np.ndarray) -> np.ndarray:
    return ~_dilate(~mask)


def denoise_mask(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    """Morphological close (fills 1px gaps) then open (drops 1px speckle)."""
    m = mask
    for _ in range(iterations):
        m = _erode(_dilate(m))  # close
    for _ in range(iterations):
        m = _dilate(_erode(m))  # open
    return m


# ── 3. contour tracing (outer + holes) ──────────────────────────────────────

# 8-neighbour offsets in clockwise order, starting due WEST — the classic
# Moore-neighbour tracing convention (Gonzalez & Woods / Wikipedia "Moore
# neighborhood tracing").
_MOORE = [(0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1)]


def _trace_blob(mask: np.ndarray, start: Tuple[int, int]) -> List[Tuple[int, int]]:
    """Moore-neighbour boundary of the foreground blob touching ``start``.

    ``start`` must be the topmost, then leftmost, foreground pixel of the blob
    (so the pixel due west of it is guaranteed background). Returns a closed
    polygon of ``(row, col)`` pixel centres, first point repeated as the last.
    """
    h, w = mask.shape

    def fg(p: Tuple[int, int]) -> bool:
        r, c = p
        return 0 <= r < h and 0 <= c < w and bool(mask[r, c])

    if not fg(start):
        return []
    boundary: List[Tuple[int, int]] = [start]
    current = start
    # We "arrived" from the west (background) — start the neighbour scan there.
    enter_idx = 0
    if not _has_any_neighbor(mask, start):
        return [start, start]  # isolated 1px blob — degenerate but closed
    while True:
        found = None
        found_idx = None
        for step in range(1, 9):
            idx = (enter_idx + step) % 8
            dr, dc = _MOORE[idx]
            cand = (current[0] + dr, current[1] + dc)
            if fg(cand):
                found, found_idx = cand, idx
                break
        if found is None:
            break  # isolated pixel, already emitted
        boundary.append(found)
        # Next scan starts from the neighbour BEHIND the one we just came
        # from, relative to the new current pixel (back-track direction).
        enter_idx = (found_idx + 4 + 1) % 8
        current = found
        if current == start and len(boundary) > 2:
            break
        if len(boundary) > 4 * mask.size:
            break  # pathological safety valve — never spin forever
    if boundary[-1] != boundary[0]:
        boundary.append(boundary[0])
    return boundary


def _has_any_neighbor(mask: np.ndarray, p: Tuple[int, int]) -> bool:
    h, w = mask.shape
    r, c = p
    for dr, dc in _MOORE:
        rr, cc = r + dr, c + dc
        if 0 <= rr < h and 0 <= cc < w and mask[rr, cc]:
            return True
    return False


def _flood_label(mask: np.ndarray, value: bool) -> List[List[Tuple[int, int]]]:
    """4-connected components of cells equal to ``value``, in row-major
    discovery order (deterministic — no set/dict iteration order dependence)."""
    h, w = mask.shape
    seen = np.zeros((h, w), dtype=bool)
    comps: List[List[Tuple[int, int]]] = []
    for r in range(h):
        for c in range(w):
            if seen[r, c] or mask[r, c] != value:
                continue
            stack = [(r, c)]
            seen[r, c] = True
            comp = []
            while stack:
                cr, cc = stack.pop()
                comp.append((cr, cc))
                for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nr, nc = cr + dr, cc + dc
                    if 0 <= nr < h and 0 <= nc < w and not seen[nr, nc] and mask[nr, nc] == value:
                        seen[nr, nc] = True
                        stack.append((nr, nc))
            comps.append(comp)
    return comps


def trace_contours(mask: np.ndarray, min_hole_area_px: int = MIN_HOLE_AREA_PX) -> Dict[str, Any]:
    """``{"outer": [...] | None, "holes": [[...], ...]}`` in pixel (row, col).

    The outer contour is the boundary of the largest foreground component (a
    silhouette is one connected blob after denoising; a mesh that still yields
    several disjoint blobs keeps only the biggest — the others are almost
    always converter debris, not real hull parts). A "hole" is a background
    component that (a) does not touch the mask border (so it is enclosed, not
    the surrounding void) and (b) is at least ``min_hole_area_px`` — canopies,
    engine bells, intake grilles are real holes; single stray background
    pixels inside the hull are not.
    """
    fg_comps = _flood_label(mask, True)
    if not fg_comps:
        return {"outer": None, "holes": []}
    biggest = max(fg_comps, key=len)
    biggest_mask = np.zeros_like(mask)
    for r, c in biggest:
        biggest_mask[r, c] = True
    start = min(biggest, key=lambda p: (p[0], p[1]))
    outer = _trace_blob(biggest_mask, start)

    h, w = mask.shape
    holes: List[List[Tuple[int, int]]] = []
    for comp in _flood_label(~biggest_mask, True):
        if len(comp) < min_hole_area_px:
            continue
        touches_border = any(r in (0, h - 1) or c in (0, w - 1) for r, c in comp)
        if touches_border:
            continue
        # Trace the hole from the FOREGROUND side (the biggest blob), so its
        # winding follows the same convention as the outer contour's
        # neighbour scan — `_trace_blob` walks whichever mask it is given.
        hole_mask = np.zeros_like(mask)
        for r, c in comp:
            hole_mask[r, c] = True
        # Grow the hole mask by one ring of biggest-blob pixels so the tracer
        # (which requires the start pixel's west neighbour to be background)
        # runs on foreground-of-the-hole, i.e. trace the hole boundary as seen
        # FROM inside the hole looking at the surrounding hull, then reverse
        # the winding relative to the outer contour when emitting the path.
        start_h = min(comp, key=lambda p: (p[0], p[1]))
        holes.append(_trace_blob(hole_mask, start_h))
    return {"outer": outer, "holes": holes}


# ── 4. smooth + simplify ────────────────────────────────────────────────────

def chaikin_smooth(points: Sequence[Vec2], iterations: int = CHAIKIN_ITERATIONS) -> List[Vec2]:
    """Chaikin corner-cutting on a CLOSED polyline (first point == last)."""
    pts = list(points)
    if len(pts) < 4:
        return pts
    closed = pts[0] == pts[-1]
    ring = pts[:-1] if closed else pts
    for _ in range(max(0, iterations)):
        if len(ring) < 3:
            break
        out: List[Vec2] = []
        n = len(ring)
        for i in range(n):
            p0 = ring[i]
            p1 = ring[(i + 1) % n]
            out.append((0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]))
            out.append((0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]))
        ring = out
    return ring + [ring[0]] if closed else ring


def _perp_dist(p: Vec2, a: Vec2, b: Vec2) -> float:
    if a == b:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    num = abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0])
    den = math.hypot(b[0] - a[0], b[1] - a[1])
    return num / den


def douglas_peucker(points: Sequence[Vec2], tolerance: float) -> List[Vec2]:
    """Ramer–Douglas–Peucker simplification of an open polyline."""
    if len(points) < 3 or tolerance <= 0:
        return list(points)
    dmax = 0.0
    index = 0
    for i in range(1, len(points) - 1):
        d = _perp_dist(points[i], points[0], points[-1])
        if d > dmax:
            index, dmax = i, d
    if dmax > tolerance:
        left = douglas_peucker(points[: index + 1], tolerance)
        right = douglas_peucker(points[index:], tolerance)
        return left[:-1] + right
    return [points[0], points[-1]]


def simplify_closed(points: Sequence[Vec2], tolerance: float) -> List[Vec2]:
    """Douglas-Peucker on a CLOSED ring (first point == last), re-closed."""
    pts = list(points)
    if len(pts) < 4:
        return pts
    simplified = douglas_peucker(pts, tolerance)
    if simplified[-1] != simplified[0]:
        simplified.append(simplified[0])
    return simplified


# ── 5. normalise + emit the contract ────────────────────────────────────────

def _to_world(p: Tuple[int, int], min_x: float, min_y: float, px_per_m: float) -> Vec2:
    row, col = p
    return (col + 0.5) / px_per_m + min_x, (row + 0.5) / px_per_m + min_y


def _world_to_viewbox(p: Vec2, min_x: float, min_y: float, scale: float,
                       offset_x: float, offset_y: float, span_y: float) -> Vec2:
    # Nose up: model +Y is forward; screen Y grows downward, so invert.
    x = (p[0] - min_x) * scale + offset_x
    y = (span_y - (p[1] - min_y)) * scale + offset_y
    return round(x, 2), round(y, 2)


def _ring_to_path(ring: Sequence[Vec2]) -> str:
    if not ring:
        return ""
    cmds = [f"M {ring[0][0]} {ring[0][1]}"]
    for x, y in ring[1:]:
        cmds.append(f"L {x} {y}")
    cmds.append("Z")
    return " ".join(cmds)


def build_silhouette(
    triangles: Sequence[Triangle],
    *,
    mask_size: int = MASK_SIZE,
    viewbox: int = VIEWBOX,
    tolerance_m: float = DEFAULT_SIMPLIFY_TOLERANCE_M,
    min_hole_area_px: int = MIN_HOLE_AREA_PX,
    chaikin_iterations: int = CHAIKIN_ITERATIONS,
) -> Optional[Dict[str, Any]]:
    """Triangles -> the contract's ``silhouette`` object, or None (no usable
    geometry — e.g. an entity whose mesh has no surface, never invented)."""
    tris_2d = project_topdown(triangles)
    bounds = xy_bounds(tris_2d)
    if bounds is None:
        return None
    mask, px_per_m, width, height = rasterize_mask(tris_2d, bounds, mask_size)
    if not mask.any():
        return None
    mask = denoise_mask(mask, iterations=1)
    if not mask.any():
        return None
    contours = trace_contours(mask, min_hole_area_px)
    outer_px = contours["outer"]
    if not outer_px or len(outer_px) < MIN_CONTOUR_POINTS:
        return None

    min_x, min_y, _max_x, _max_y = bounds
    tol_px = max(tolerance_m * px_per_m, 0.0)

    def polygon(ring_px: Sequence[Tuple[int, int]]) -> List[Vec2]:
        world = [_to_world(p, min_x, min_y, px_per_m) for p in ring_px]
        smoothed = chaikin_smooth(world, chaikin_iterations)
        return simplify_closed(smoothed, tolerance_m)

    outer_world = polygon(outer_px)
    holes_world = [polygon(h) for h in contours["holes"] if len(h) >= MIN_CONTOUR_POINTS]

    span_x_m = width / px_per_m
    span_y_m = height / px_per_m
    scale = viewbox / max(span_x_m, span_y_m)
    box_w = span_x_m * scale
    box_h = span_y_m * scale
    offset_x = (viewbox - box_w) / 2.0
    offset_y = (viewbox - box_h) / 2.0

    def to_vb(ring: Sequence[Vec2]) -> List[Vec2]:
        return [
            _world_to_viewbox(p, min_x, min_y, scale, offset_x, offset_y, span_y_m)
            for p in ring
        ]

    outer_vb = to_vb(outer_world)
    holes_vb = [to_vb(h) for h in holes_world]
    path = " ".join(x for x in [_ring_to_path(outer_vb), *[_ring_to_path(h) for h in holes_vb]] if x)
    point_count = len(outer_vb) + sum(len(h) for h in holes_vb)

    return {
        "viewBox": f"0 0 {viewbox} {viewbox}",
        "noseUp": True,
        "path": path,
        "bbox": {
            "x": round(offset_x, 2), "y": round(offset_y, 2),
            "w": round(box_w, 2), "h": round(box_h, 2),
        },
        "scaleMPerUnit": round(1.0 / scale, 6),
        "pointCount": point_count,
        "simplifyToleranceM": tolerance_m,
    }


# ── 6. anchors (ships only) — reuses hardpoints.py's resolved transforms ────

def project_anchors(
    transforms: Dict[str, Dict[str, Any]],
    frame: Dict[str, Any],
    all_port_names: Sequence[Optional[str]] = (),
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """``(anchors[], unresolved[])`` — the contract's per-port pin list.

    Same projection as the web 2D hull map (`hardpoint-map.ts` `projectHardpoint`):
    ``x=(X-min)/span`` in %, ``y=1-(Y-min)/span`` in %, so the silhouette's pins
    and the existing box-schematic map agree on where a port sits (user decision
    5: the 2D map itself stays untouched, but the maths must not diverge).
    ``depth`` is the same normalisation of the up axis (Z), 0 = keel, 1 = dorsal
    — the website's z-order hint for overlapping pins. ``side`` is derived from
    X against the frame's own centre (CryEngine +X = starboard).
    """
    fmin, fmax = frame.get("min"), frame.get("max")
    if not (_is_vec3(fmin) and _is_vec3(fmax)):
        return [], []
    span = [max(fmax[i] - fmin[i], 1e-6) for i in range(3)]
    mid_x = fmin[0] + span[0] / 2.0

    anchors: List[Dict[str, Any]] = []
    resolved_names = set()
    for port_name, t in sorted(transforms.items()):
        pos = t.get("position")
        if not _is_vec3(pos):
            continue
        u = _clamp01((pos[0] - fmin[0]) / span[0])
        v = _clamp01((pos[1] - fmin[1]) / span[1])
        w = _clamp01((pos[2] - fmin[2]) / span[2])
        clamped = any(
            not (fmin[i] <= pos[i] <= fmax[i]) for i in range(3)
        )
        side = "port" if pos[0] < mid_x else ("starboard" if pos[0] > mid_x else "center")
        anchors.append({
            "portId": port_name,
            "x": round(u * 100, 1),
            "y": round((1 - v) * 100, 1),
            "side": side,
            "depth": round(w, 3),
            "source": t.get("source"),
            "helper": t.get("helper"),
            "clamped": clamped,
        })
        resolved_names.add(port_name)

    unresolved = sorted({
        name for name in all_port_names
        if isinstance(name, str) and name and name not in resolved_names
    })
    return anchors, unresolved


def _is_vec3(value: Any) -> bool:
    return (
        isinstance(value, (list, tuple)) and len(value) == 3
        and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in value)
        and all(v == v for v in value)
    )


def _clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


# ── 7. the full contract row ────────────────────────────────────────────────

def build_entity_silhouette(
    *,
    kind: str,
    class_name: str,
    triangles: Sequence[Triangle],
    hull_cga: str,
    tool_version: str,
    build: Dict[str, Any],
    generated_at: str,
    frame: Optional[Dict[str, Any]] = None,
    frame_source: str = "bbox",
    hardpoint_transforms: Optional[Dict[str, Dict[str, Any]]] = None,
    all_port_names: Sequence[Optional[str]] = (),
    tolerance_m: float = DEFAULT_SIMPLIFY_TOLERANCE_M,
) -> Optional[Dict[str, Any]]:
    """One row of the wave-0 §C1 contract, or None when the mesh has no
    usable top-down surface (never a placeholder — the website renders "ohne
    Geometrie" for a missing row)."""
    silhouette = build_silhouette(triangles, tolerance_m=tolerance_m)
    if silhouette is None:
        return None
    row: Dict[str, Any] = {
        "schema": 1,
        "kind": kind,
        "className": class_name,
        "build": build,
        "generatedAt": generated_at,
        "toolVersion": tool_version,
        "source": {
            "hullCga": hull_cga,
            "method": "cgf-converter-topdown-raster-trace",
            "modelSpace": "cryengine:+X right,+Y nose,+Z up",
            "frame": frame or {"source": frame_source},
        },
        "silhouette": silhouette,
    }
    if kind == "ship":
        anchors, unresolved = project_anchors(
            hardpoint_transforms or {}, frame or {}, all_port_names,
        )
        row["anchors"] = anchors
        row["unresolved"] = unresolved
    return row
