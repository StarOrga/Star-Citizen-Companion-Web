"""Raster equivalence: vectorised CPU scanline == the original per-triangle
loop (bit for bit, final path byte for byte), and the optional OpenGL paths
(`SC_USE_GPU=1`) stay within edge-pixel noise of the CPU.

GPU cases skip with the probe's reason when no hardware OpenGL 3.3 context
exists (CI runners, sessions without a driver).
"""
from __future__ import annotations

import io
import json
import math
from contextlib import redirect_stdout

import numpy as np
import pytest

from sc_extract import silhouette as S
from sc_extract import silhouette_gpu
from silhouette_reference import reference_rasterize_mask


def _random_hull(n: int, seed: int) -> list:
    rng = np.random.default_rng(seed)
    c = rng.uniform(-1, 1, (n * 2, 2)) * [12.0, 30.0]
    c = c[(c[:, 0] / 12) ** 2 + (c[:, 1] / 30) ** 2 < 1][:n]
    tris = c[:, None, :] + rng.normal(0, 0.8, (len(c), 3, 2))
    return [tuple((float(p[0]), float(p[1]), 0.0) for p in t) for t in tris]


def _grid_hull() -> list:
    """Axis-aligned unit quads on integer metres: many edges land EXACTLY on
    pixel centres / borders — the tie cases the barycentric slack decides."""
    tris = []
    for x in range(-8, 8):
        for y in range(0, 32):
            if (x * x) / 64 + ((y - 16) ** 2) / 256 > 1.0:
                continue
            a, b, c, d = (x, y, 0.0), (x + 1, y, 0.0), (x + 1, y + 1, 0.0), (x, y + 1, 0.0)
            tris += [(a, b, c), (a, c, d)]
    return tris


def _slivers() -> list:
    thin = [((0.0, 0.0, 0.0), (40.0, 1e-4 * i, 0.0), (40.0, 1e-4 * i + 1e-3, 0.0))
            for i in range(50)]
    return thin + _random_hull(500, 3)


FIXTURES = {
    "random-2k": lambda: _random_hull(2000, 1),
    "random-20k": lambda: _random_hull(20000, 2),
    "grid": _grid_hull,
    "slivers": _slivers,
}


@pytest.mark.parametrize("name", sorted(FIXTURES))
@pytest.mark.parametrize("mask_size", [64, 333, 1024])
def test_cpu_scanline_matches_the_original_loop_bit_for_bit(name: str, mask_size: int) -> None:
    tris_2d = S.project_topdown(FIXTURES[name]())
    bounds = S.xy_bounds(tris_2d)
    ref, ref_ppm, ref_w, ref_h = reference_rasterize_mask(tris_2d, bounds, mask_size)
    new, ppm, w, h = S.rasterize_mask(tris_2d, bounds, mask_size, backend="cpu")
    assert (ppm, w, h) == (ref_ppm, ref_w, ref_h)
    assert np.array_equal(new, ref)


@pytest.mark.parametrize("name", sorted(FIXTURES))
def test_path_string_is_byte_identical_to_the_original_raster(name: str, monkeypatch) -> None:
    tris = FIXTURES[name]()
    monkeypatch.setenv("SC_USE_GPU", "0")
    new = S.build_silhouette(tris)
    monkeypatch.setattr(S, "rasterize_mask",
                        lambda t, b, m=S.MASK_SIZE, backend=None: reference_rasterize_mask(t, b, m))
    old = S.build_silhouette(tris)
    assert new == old


def test_non_finite_triangles_are_dropped_not_fatal() -> None:
    tris = _random_hull(200, 4) + [((math.nan, 0.0, 0.0), (1.0, 1.0, 0.0), (2.0, 0.0, 0.0))]
    assert S.build_silhouette(tris) is not None


def test_backend_follows_the_env(monkeypatch) -> None:
    monkeypatch.setenv("SC_USE_GPU", "0")
    assert S.raster_backend() == "cpu"
    monkeypatch.delenv("SC_USE_GPU")
    assert S.raster_backend() == "cpu"


def test_probe_prints_the_contract() -> None:
    from sc_extract import gpu_probe
    buf = io.StringIO()
    with redirect_stdout(buf):
        assert gpu_probe.main() == 0
    out = json.loads(buf.getvalue())
    assert set(out) == {"available", "name", "reason"}
    assert isinstance(out["available"], bool)
    assert (out["reason"] is None) == out["available"]


def _need_gpu() -> None:
    st = silhouette_gpu.status()
    if not st["available"]:
        pytest.skip(f"no GPU OpenGL context: {st['reason']}")


@pytest.mark.parametrize("name", sorted(FIXTURES))
def test_gpu_mask_is_within_edge_noise_of_the_cpu(name: str) -> None:
    _need_gpu()
    tris_2d = S.project_topdown(FIXTURES[name]())
    bounds = S.xy_bounds(tris_2d)
    cpu = S.rasterize_mask(tris_2d, bounds, backend="cpu")[0]
    gpu = S.rasterize_mask(tris_2d, bounds, backend="gpu")[0]
    assert gpu.shape == cpu.shape
    # GL samples the same pixel centres; float32 math and the top-left tie
    # rule only move pixels that sit on an edge.
    assert int((gpu ^ cpu).sum()) <= max(8, int(cpu.sum()) // 1000)


@pytest.mark.parametrize("name", ["random-20k", "grid"])
def test_gpu_silhouette_is_equivalent(name: str, monkeypatch) -> None:
    _need_gpu()
    tris = FIXTURES[name]()
    monkeypatch.setenv("SC_USE_GPU", "0")
    cpu = S.build_silhouette(tris)
    monkeypatch.setenv("SC_USE_GPU", "1")
    gpu = S.build_silhouette(tris)
    assert gpu["bbox"] == cpu["bbox"] and gpu["scaleMPerUnit"] == cpu["scaleMPerUnit"]
    assert abs(gpu["pointCount"] - cpu["pointCount"]) <= max(2, cpu["pointCount"] // 20)


def test_gpu_hole_gate_matches_the_numpy_splat(monkeypatch) -> None:
    _need_gpu()
    from sc_extract import mesh_integrity as M
    rng = np.random.default_rng(5)
    c = rng.normal(size=(30000, 3))
    c = c / np.linalg.norm(c, axis=1)[:, None] * [4.0, 10.0, 2.0]
    ref = c[:, None, :] + rng.normal(0, 0.08, (len(c), 3, 3))
    cand = ref[rng.random(len(ref)) > 0.05]
    monkeypatch.setenv("SC_USE_GPU", "0")
    cpu = M.coverage_loss(ref, cand, resolution=128)
    monkeypatch.setenv("SC_USE_GPU", "1")
    gpu = M.coverage_loss(ref, cand, resolution=128)
    assert abs(gpu.reference_pixels - cpu.reference_pixels) <= cpu.reference_pixels // 1000 + 2
    assert abs(gpu.hole_ratio - cpu.hole_ratio) <= 0.0005 + 0.02 * cpu.hole_ratio
