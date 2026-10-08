"""Verse-hub star constellation — a ship's top-view silhouette reduced to
exactly seven stars.

Each patch line gets one constellation shaped like its newest ship or ground
vehicle. The geometry is precomputed here, next to the silhouette build, and
uploaded with the silhouette rows; the `ingest-catalog` edge function's
`constellation` op picks the newest vehicle of the patch and stores its seven
points in `verse_constellations`.

Pipeline (pure, deterministic, no AI):

    silhouette path (0..1000 viewBox, nose up)
        -> the outer ring with the largest area (the main hull, never a hole)
        -> Douglas-Peucker in priority order until exactly 7 points remain
        -> normalised into 0..1, aspect preserved, shorter axis centred

Why "priority order" instead of a plain epsilon bisection: recursive DP is not
strictly monotonic in epsilon, so a bisection can jump from 6 straight to 8
points and never hit 7. Inserting DP's split points one at a time, always the
point farthest from its current segment, is the same refinement DP performs —
stopped at the epsilon where the seventh point is the last one kept — and it
always lands on exactly seven.

A ring with fewer than seven distinct vertices (a degenerate mesh) is padded
by repeatedly splitting its longest edge at the midpoint (earliest edge wins a
tie), so the output is always seven points for anything with a real extent.
"""
from __future__ import annotations

import math
import re
from typing import List, Optional, Sequence, Tuple

Vec2 = Tuple[float, float]

STAR_COUNT = 7
DECIMALS = 4

_NUM = r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?"
_CMD_RE = re.compile(rf"([ML])\s*({_NUM})\s+({_NUM})")


def rings_from_path(path: str) -> List[List[Vec2]]:
    """Split an `M x y L x y … Z` path (silhouette.py `_ring_to_path`) into rings."""
    rings: List[List[Vec2]] = []
    for sub in (path or "").split("Z"):
        pts = [(float(x), float(y)) for _cmd, x, y in _CMD_RE.findall(sub)]
        if pts:
            rings.append(pts)
    return rings


def _signed_area(ring: Sequence[Vec2]) -> float:
    a = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a / 2.0


def main_ring(path: str) -> Optional[List[Vec2]]:
    """The ring with the largest absolute area — the main hull's outline. A
    hole is always inside its outer ring, so it can never win."""
    best: Optional[List[Vec2]] = None
    best_area = 0.0
    for ring in rings_from_path(path):
        area = abs(_signed_area(ring))
        if area > best_area:  # strict: the earliest ring wins a tie
            best, best_area = ring, area
    if best is None:  # every ring is flat — keep the first one with a vertex
        rings = rings_from_path(path)
        best = rings[0] if rings else None
    return best


def _dedupe(ring: Sequence[Vec2]) -> List[Vec2]:
    """Drop consecutive duplicates and an explicit closing point."""
    out: List[Vec2] = []
    for p in ring:
        if not out or p != out[-1]:
            out.append(p)
    while len(out) > 1 and out[-1] == out[0]:
        out.pop()
    return out


def _seg_dist(p: Vec2, a: Vec2, b: Vec2) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    if l2 == 0.0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def _farthest(ring: Sequence[Vec2], origin: Vec2) -> int:
    best_i, best_d = 0, -1.0
    for i, p in enumerate(ring):
        d = math.hypot(p[0] - origin[0], p[1] - origin[1])
        if d > best_d:  # strict: lowest index wins a tie
            best_i, best_d = i, d
    return best_i


def _dp_reduce(ring: List[Vec2], count: int) -> List[Vec2]:
    """Closed-ring Douglas-Peucker in priority order, stopping at `count`."""
    n = len(ring)
    cx = sum(p[0] for p in ring) / n
    cy = sum(p[1] for p in ring) / n
    a = _farthest(ring, (cx, cy))
    b = _farthest(ring, ring[a])
    kept = sorted({a, b})
    while len(kept) < count:
        best_i, best_d = -1, -1.0
        for k, start in enumerate(kept):
            end = kept[(k + 1) % len(kept)]
            # Indices strictly between start and end, walking the ring forward.
            i = (start + 1) % n
            while i != end:
                d = _seg_dist(ring[i], ring[start], ring[end])
                if d > best_d or (d == best_d and i < best_i):
                    best_i, best_d = i, d
                i = (i + 1) % n
        if best_i < 0:
            break
        kept = sorted(kept + [best_i])
    return [ring[i] for i in kept]


def _pad(ring: List[Vec2], count: int) -> List[Vec2]:
    """Split the longest edge at its midpoint until `count` points exist."""
    pts = list(ring)
    while len(pts) < count:
        best_k, best_l = 0, -1.0
        for k in range(len(pts)):
            p, q = pts[k], pts[(k + 1) % len(pts)]
            length = math.hypot(q[0] - p[0], q[1] - p[1])
            if length > best_l:  # strict: earliest edge wins a tie
                best_k, best_l = k, length
        p, q = pts[best_k], pts[(best_k + 1) % len(pts)]
        pts.insert(best_k + 1, ((p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0))
    return pts


def normalise(points: Sequence[Vec2]) -> Optional[List[List[float]]]:
    """Fit into 0..1 by the longer span; the shorter axis is centred."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, min_y = min(xs), min(ys)
    w, h = max(xs) - min_x, max(ys) - min_y
    span = max(w, h)
    if span <= 0.0:
        return None
    off_x = (1.0 - w / span) / 2.0
    off_y = (1.0 - h / span) / 2.0
    return [
        [round(off_x + (x - min_x) / span, DECIMALS), round(off_y + (y - min_y) / span, DECIMALS)]
        for x, y in points
    ]


def reduce_to_constellation(ring: Sequence[Vec2], count: int = STAR_COUNT) -> Optional[List[List[float]]]:
    """Exactly `count` points in 0..1, in ring order — or None when the ring
    has no extent (empty, a single point, or every vertex identical)."""
    pts = _dedupe([(float(x), float(y)) for x, y in ring])
    if len(set(pts)) < 2:
        return None
    pts = _dp_reduce(pts, count) if len(pts) > count else _pad(pts, count)
    return normalise(pts)


def constellation_from_path(path: str, count: int = STAR_COUNT) -> Optional[List[List[float]]]:
    ring = main_ring(path)
    return reduce_to_constellation(ring, count) if ring else None
