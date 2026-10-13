"""Test-only reference: the ORIGINAL per-triangle silhouette rasteriser.

`silhouette.rasterize_px_cpu` replaced this loop (one meshgrid per triangle,
~0.1 ms of Python per triangle — seconds for a 200k-triangle hull). It stays
here verbatim so the equivalence test can prove the replacement selects
exactly the same pixels. Not imported by production code.
"""
from __future__ import annotations

import math
from typing import Sequence, Tuple

import numpy as np

Vec2 = Tuple[float, float]


def reference_rasterize_mask(tris_2d: Sequence[Tuple[Vec2, Vec2, Vec2]],
                             bounds: Tuple[float, float, float, float],
                             mask_size: int = 1024):
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
        return
    xs = np.arange(x0, x1 + 1) + 0.5
    ys = np.arange(y0, y1 + 1) + 0.5
    gx, gy = np.meshgrid(xs, ys)
    w0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / denom
    w1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / denom
    w2 = 1.0 - w0 - w1
    inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
    mask[y0:y1 + 1, x0:x1 + 1] |= inside
