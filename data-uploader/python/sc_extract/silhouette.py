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
# A foreground blob under this many px^2 stays out of the emitted path — it is
# denoise debris, not a wingtip/nacelle/arm the open() erosion pass severed
# from the main hull. Blobs at or above this size are kept as their OWN
# subpath (should-fix "components", wave1-redteam.md) instead of being
# dropped just for not being the single biggest blob.
MIN_COMPONENT_AREA_PX = 64
# Adaptive Douglas-Peucker tolerance (should-fix "tolerance", wave1-redteam.md):
# a flat 0.15 m floor is fine for a fighter but lets a capital ship's hull blow
# through the SVG path length budget. tol_m = max(floor, % of span, px floor).
TOLERANCE_SPAN_FRACTION = 0.003  # 0.3% of the hull's own longer span
TOLERANCE_MIN_PX = 1.5


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


def _row_runs(row: np.ndarray) -> List[Tuple[int, int]]:
    """``[(c0, c1_exclusive), ...]`` contiguous True runs of a 1D bool row,
    found with one `np.diff` call instead of a per-pixel Python scan."""
    if not row.any():
        return []
    padded = np.concatenate(([False], row, [False]))
    edges = np.flatnonzero(padded[1:] != padded[:-1])
    return [(int(edges[i]), int(edges[i + 1])) for i in range(0, len(edges), 2)]


def _flood_label(mask: np.ndarray, value: bool) -> List[List[Tuple[int, int]]]:
    """4-connected components of cells equal to ``value``, in row-major
    discovery order (deterministic — no set/dict iteration order dependence).

    Vectorised (numpy-only, no scipy, see module docstring): each ROW is
    reduced to a handful of contiguous runs via `np.diff` (one call per row,
    not one Python step per pixel), and components are the union of runs that
    touch a run in the row above (classic two-pass run-length labelling via
    union-find over runs, not over individual pixels). A silhouette mask is
    almost always a handful of runs per row, so this is O(rows + runs)
    Python-level work instead of O(pixels) — the same result, dramatically
    fewer interpreted steps for a 1024x1024 mask.
    """
    target = mask if value else ~mask
    h, w = target.shape
    runs: List[Tuple[int, int, int]] = []  # (row, c0, c1_exclusive)
    row_run_idx: List[List[int]] = [[] for _ in range(h)]
    for r in range(h):
        for c0, c1 in _row_runs(target[r]):
            row_run_idx[r].append(len(runs))
            runs.append((r, c0, c1))
    if not runs:
        return []

    parent = list(range(len(runs)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    for r in range(1, h):
        if not row_run_idx[r] or not row_run_idx[r - 1]:
            continue
        for ci in row_run_idx[r]:
            _, c0, c1 = runs[ci]
            for pi in row_run_idx[r - 1]:
                _, pc0, pc1 = runs[pi]
                if pc0 < c1 and c0 < pc1:  # column ranges overlap -> 4-connected
                    union(ci, pi)

    groups: Dict[int, List[int]] = {}
    for i in range(len(runs)):
        groups.setdefault(find(i), []).append(i)

    comps: List[List[Tuple[int, int]]] = []
    for root in sorted(groups.keys()):
        pts: List[Tuple[int, int]] = []
        for i in groups[root]:
            r, c0, c1 = runs[i]
            pts.extend((r, c) for c in range(c0, c1))
        comps.append(pts)
    return comps


def _component_holes(mask: np.ndarray, comp: Sequence[Tuple[int, int]],
                      min_hole_area_px: int) -> List[List[Tuple[int, int]]]:
    """Holes of ONE component, isolated to that component's own bounding box
    so a different (also-kept) foreground component elsewhere in the mask can
    never be mistaken for one of this component's holes (should-fix
    "components", wave1-redteam.md — the old whole-image ``~biggest_mask``
    complement broke exactly this way once more than one blob is kept)."""
    rs = [p[0] for p in comp]
    cs = [p[1] for p in comp]
    r0, c0, r1, c1 = min(rs), min(cs), max(rs), max(cs)
    comp_mask = np.zeros((r1 - r0 + 1, c1 - c0 + 1), dtype=bool)
    for r, c in comp:
        comp_mask[r - r0, c - c0] = True
    sh, sw = comp_mask.shape
    holes: List[List[Tuple[int, int]]] = []
    for hole in _flood_label(~comp_mask, True):
        if len(hole) < min_hole_area_px:
            continue
        touches_border = any(r in (0, sh - 1) or c in (0, sw - 1) for r, c in hole)
        if touches_border:
            continue
        # Trace the hole from the FOREGROUND side (this component), so its
        # winding follows the same convention as the outer contour's
        # neighbour scan — `_trace_blob` walks whichever mask it is given.
        hole_mask = np.zeros_like(comp_mask)
        for r, c in hole:
            hole_mask[r, c] = True
        start_h = min(hole, key=lambda p: (p[0], p[1]))
        ring = _trace_blob(hole_mask, start_h)
        holes.append([(r + r0, c + c0) for r, c in ring])
    return holes


def trace_contours(mask: np.ndarray, min_hole_area_px: int = MIN_HOLE_AREA_PX,
                    min_component_area_px: int = MIN_COMPONENT_AREA_PX) -> Dict[str, Any]:
    """``{"outer", "holes", "components", "dropped_area"}`` in pixel (row, col).

    ``components`` holds EVERY foreground blob at or above
    ``min_component_area_px`` (should-fix "components": the open() denoise
    pass can sever a nacelle/wingtip/arm from the main hull onto its own
    blob — keeping only the single biggest blob silently drops it), largest
    first. ``outer``/``holes`` stay as a backward-compatible view of the
    FIRST (biggest) component only. ``dropped_area`` sums the pixel area of
    blobs below the threshold (raster/converter debris).

    A "hole" is a background component that (a) does not touch its owning
    component's own bounding box border (so it is enclosed, not the
    surrounding void) and (b) is at least ``min_hole_area_px`` — canopies,
    engine bells, intake grilles are real holes; single stray background
    pixels inside the hull are not.
    """
    fg_comps = _flood_label(mask, True)
    if not fg_comps:
        return {"outer": None, "holes": [], "components": [], "dropped_area": 0}

    kept = [c for c in fg_comps if len(c) >= min_component_area_px]
    dropped_area = sum(len(c) for c in fg_comps if len(c) < min_component_area_px)
    if not kept:
        kept = [max(fg_comps, key=len)]  # never emit nothing when there IS foreground
        dropped_area = 0
    kept.sort(key=len, reverse=True)

    components: List[Dict[str, Any]] = []
    for comp in kept:
        comp_mask = np.zeros_like(mask)
        for r, c in comp:
            comp_mask[r, c] = True
        start = min(comp, key=lambda p: (p[0], p[1]))
        outer = _trace_blob(comp_mask, start)
        holes = _component_holes(mask, comp, min_hole_area_px)
        components.append({"outer": outer, "holes": holes})

    return {
        "outer": components[0]["outer"],
        "holes": components[0]["holes"],
        "components": components,
        "dropped_area": dropped_area,
    }


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


def _ring_to_path(ring: Sequence[Vec2], *, reverse: bool = False) -> str:
    """Should-fix "hole winding" (wave1-redteam.md): a hole ring is emitted
    with ``reverse=True`` so its winding is the OPPOSITE of the outer/other
    component rings — required for `fill-rule="nonzero"` to actually punch
    the hole (the tracer's own winding convention is identical for outer and
    hole rings, see `_component_holes`'s docstring, so without this the fill
    rule renders a hole as solid)."""
    if not ring:
        return ""
    pts = list(reversed(ring)) if reverse else list(ring)
    cmds = [f"M {pts[0][0]} {pts[0][1]}"]
    for x, y in pts[1:]:
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
    min_component_area_px: int = MIN_COMPONENT_AREA_PX,
    chaikin_iterations: int = CHAIKIN_ITERATIONS,
    on_log: Optional[Any] = None,
) -> Optional[Dict[str, Any]]:
    """Triangles -> the contract's ``silhouette`` object, or None (no usable
    geometry — e.g. an entity whose mesh has no surface, never invented).

    ``on_log(level, msg)``, if given, gets one line with the point count
    (should-fix "tolerance") and one with any dropped-component area
    (should-fix "components") — both wave1-redteam.md. Purely diagnostic,
    never affects the returned object.
    """
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
    contours = trace_contours(mask, min_hole_area_px, min_component_area_px)
    components_px = [
        comp for comp in contours["components"]
        if comp["outer"] and len(comp["outer"]) >= MIN_CONTOUR_POINTS
    ]
    if not components_px:
        return None
    if on_log and contours["dropped_area"]:
        on_log("info", f"silhouette: dropped {contours['dropped_area']} px^2 of "
                       f"sub-{min_component_area_px}px^2 debris across "
                       f"{len(contours['components'])} kept component(s)")

    min_x, min_y, _max_x, _max_y = bounds
    span_x_m0 = width / px_per_m
    span_y_m0 = height / px_per_m
    span_m = max(span_x_m0, span_y_m0)
    # Adaptive DP tolerance (should-fix "tolerance"): the flat metric floor
    # alone lets a capital ship's hull blow through the SVG path length
    # budget; scale with the hull's own span and the raster's own pixel size,
    # never going BELOW the metric floor.
    tolerance_m = max(tolerance_m, TOLERANCE_SPAN_FRACTION * span_m, TOLERANCE_MIN_PX / px_per_m)

    def polygon(ring_px: Sequence[Tuple[int, int]]) -> List[Vec2]:
        world = [_to_world(p, min_x, min_y, px_per_m) for p in ring_px]
        smoothed = chaikin_smooth(world, chaikin_iterations)
        return simplify_closed(smoothed, tolerance_m)

    span_x_m = span_x_m0
    span_y_m = span_y_m0
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

    path_parts: List[str] = []
    point_count = 0
    for comp in components_px:
        outer_vb = to_vb(polygon(comp["outer"]))
        holes_vb = [to_vb(polygon(h)) for h in comp["holes"] if len(h) >= MIN_CONTOUR_POINTS]
        path_parts.append(_ring_to_path(outer_vb))
        point_count += len(outer_vb)
        for hole_vb in holes_vb:
            # Should-fix "hole winding": reversed relative to the outer ring
            # so `fill-rule="nonzero"` actually renders the hole as a hole.
            path_parts.append(_ring_to_path(hole_vb, reverse=True))
            point_count += len(hole_vb)
    path = " ".join(p for p in path_parts if p)
    if on_log:
        on_log("info", f"silhouette: {point_count} point(s), "
                       f"{len(components_px)} component(s), tol={tolerance_m:.4f}m")

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
        "simplifyToleranceM": round(tolerance_m, 6),
        # Internal — NOT part of the wave-0 §C1 contract; popped by
        # `build_entity_silhouette`/`silhouette_export.export_entity` before
        # the row is written, so anchors can be projected through the SAME
        # min/scale/offset transform as this path (should-fix "anchor space",
        # blocker 2, wave1-redteam.md). Harmless if it ever reaches the
        # uploader's `mapSilhouettes` — pinned-column mapping ignores it.
        "_transform": {
            "minX": min_x, "minY": min_y, "scale": scale,
            "offsetX": offset_x, "offsetY": offset_y, "spanYM": span_y_m,
        },
    }


# ── 6. anchors (ships only) — reuses hardpoints.py's resolved transforms ────

def project_anchors(
    transforms: Dict[str, Dict[str, Any]],
    frame: Dict[str, Any],
    all_port_names: Sequence[Optional[str]] = (),
    *,
    transform: Optional[Dict[str, float]] = None,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """``(anchors[], unresolved[])`` — the contract's per-port pin list.

    Blocker 2 (wave1-redteam.md): ``x``/``y`` are pushed through the SAME
    min/scale/offset ``transform`` `build_silhouette` used for the path (its
    ``_transform`` — silhouette/mesh bounds, aspect-preserving, centred in
    the viewBox), never the ``frame``'s (the ``.cga`` AABB's) own box — those
    are two different boxes and mixing them puts a pin somewhere the
    silhouette itself never reaches. Without a ``transform`` (no path was
    built) NOTHING is projected — never a pin in a space nobody can verify.
    ``depth``/``side``/``clamped`` keep using ``frame`` (unaffected by the
    fix — they are not viewBox-space values): ``depth`` normalises the up
    axis (Z), 0 = keel, 1 = dorsal, the website's z-order hint for
    overlapping pins; ``side`` is derived from X against the frame's own
    centre (CryEngine +X = starboard); ``clamped`` flags a hardpoint outside
    the ship's own resolved AABB (a data-quality signal, independent of
    where the mesh silhouette itself happens to be centred).
    """
    fmin, fmax = frame.get("min"), frame.get("max")
    if not (_is_vec3(fmin) and _is_vec3(fmax)) or transform is None:
        return [], []
    span = [max(fmax[i] - fmin[i], 1e-6) for i in range(3)]
    mid_x = fmin[0] + span[0] / 2.0

    anchors: List[Dict[str, Any]] = []
    resolved_names = set()
    for port_name, t in sorted(transforms.items()):
        pos = t.get("position")
        if not _is_vec3(pos):
            continue
        vb_x = (pos[0] - transform["minX"]) * transform["scale"] + transform["offsetX"]
        vb_y = ((transform["spanYM"] - (pos[1] - transform["minY"]))
                * transform["scale"] + transform["offsetY"])
        x_pct = _clamp01(vb_x / VIEWBOX) * 100
        y_pct = _clamp01(vb_y / VIEWBOX) * 100
        w = _clamp01((pos[2] - fmin[2]) / span[2])
        clamped = any(
            not (fmin[i] <= pos[i] <= fmax[i]) for i in range(3)
        )
        side = "port" if pos[0] < mid_x else ("starboard" if pos[0] > mid_x else "center")
        anchors.append({
            "portId": port_name,
            "x": round(x_pct, 1),
            "y": round(y_pct, 1),
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
    on_log: Optional[Any] = None,
) -> Optional[Dict[str, Any]]:
    """One row of the wave-0 §C1 contract, or None when the mesh has no
    usable top-down surface (never a placeholder — the website renders "ohne
    Geometrie" for a missing row)."""
    silhouette = build_silhouette(triangles, tolerance_m=tolerance_m, on_log=on_log)
    if silhouette is None:
        return None
    # Blocker 2: pop the internal path transform BEFORE the silhouette is
    # stored on the row (not part of the §C1 contract) and feed it to
    # `project_anchors` so anchors land in the SAME space as the path.
    path_transform = silhouette.pop("_transform", None)
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
            transform=path_transform,
        )
        row["anchors"] = anchors
        row["unresolved"] = unresolved
    return row
