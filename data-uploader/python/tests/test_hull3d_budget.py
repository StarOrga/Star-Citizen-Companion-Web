"""Tests for the per-skin glb size budget in `hull3d.py`.

A whole-catalog livery build (~350 skins) has to fit the Supabase storage
quota, so an over-budget skin is re-optimized down a quality ladder instead of
the whole catalog being exported at a blanket-low texture size. These tests
drive the ladder/retry decisions with a stubbed optimizer — no P4K, no
cgf-converter, no gltf-transform.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from typing import List

from sc_extract.hull3d import Hull3DExporter, HullExportConfig


class _FakeP4K:
    """Minimal stand-in — the exporter only indexes infolist() at construction."""

    def infolist(self) -> list:
        return []


def _exporter(tmp_path: Path, sizes: List[int], **cfg_kw) -> tuple:
    """Exporter whose _optimize writes glbs of the given sizes, one per call.

    The ladder tests drive an explicit 1024 / 1 MB quality so they describe the
    *mechanism*, not whatever the shipped catalog-wide defaults happen to be —
    those are pinned separately in `test_shipped_defaults_fit_the_storage_budget`.
    """
    cfg_kw.setdefault("texture_size", 1024)
    cfg_kw.setdefault("max_model_bytes", 1_000_000)
    cfg = HullExportConfig(
        cgf_converter=tmp_path / "cgf-converter.exe",
        out_dir=tmp_path / "out",
        work_dir=tmp_path / "work",
        **cfg_kw,
    )
    ex = Hull3DExporter(_FakeP4K(), cfg)
    calls: List[tuple] = []

    def fake_optimize(in_glb, out_glb, texture_size=None, simplify_error=None, compress=True):
        calls.append((texture_size, simplify_error))
        out_glb.parent.mkdir(parents=True, exist_ok=True)
        out_glb.write_bytes(b"x" * sizes[len(calls) - 1])

    ex._optimize = fake_optimize  # type: ignore[method-assign]
    return ex, calls


def test_quality_ladder_starts_unsimplified_and_walks_the_error_ladder(tmp_path: Path) -> None:
    ex, _ = _exporter(tmp_path, [1])
    assert ex.quality_ladder() == [(1024, 0.0), (1024, 0.0005), (1024, 0.001), (1024, 0.002)]


def test_ladder_never_goes_past_its_top_rung(tmp_path: Path) -> None:
    ex, _ = _exporter(tmp_path, [1], simplify_error=0.001)
    assert [err for _, err in ex.quality_ladder()] == [0.001, 0.002]
    ex, _ = _exporter(tmp_path, [1], simplify_error=0.008)
    assert [err for _, err in ex.quality_ladder()] == [0.008]


def test_skin_within_budget_is_optimized_once_at_full_quality(tmp_path: Path) -> None:
    ex, calls = _exporter(tmp_path, [900_000])
    size = ex._optimize_to_budget(tmp_path / "raw.glb", tmp_path / "web.glb", "pirate")
    assert size == 900_000
    assert calls == [(1024, 0.0)]


def test_over_budget_skin_retries_until_it_fits(tmp_path: Path) -> None:
    ex, calls = _exporter(tmp_path, [1_700_000, 950_000])
    size = ex._optimize_to_budget(tmp_path / "raw.glb", tmp_path / "web.glb", "pirate")
    assert size == 950_000
    assert calls == [(1024, 0.0), (1024, 0.0005)]


def test_ladder_exhausted_keeps_smallest_attempt(tmp_path: Path) -> None:
    ex, calls = _exporter(tmp_path, [4_000_000, 3_000_000, 2_500_000, 2_000_000])
    warnings: List[str] = []
    ex.log = lambda level, msg: warnings.append(msg) if level == "warn" else None
    size = ex._optimize_to_budget(tmp_path / "raw.glb", tmp_path / "web.glb", "pirate")
    # Over budget but exported anyway — a too-big skin beats a missing skin.
    assert size == 2_000_000
    assert calls == [(1024, 0.0), (1024, 0.0005), (1024, 0.001), (1024, 0.002)]
    assert any("still over" in w for w in warnings)


def test_zero_budget_disables_the_retry_ladder(tmp_path: Path) -> None:
    ex, calls = _exporter(tmp_path, [9_000_000], max_model_bytes=0)
    size = ex._optimize_to_budget(tmp_path / "raw.glb", tmp_path / "web.glb", "pirate")
    assert size == 9_000_000
    assert calls == [(1024, 0.0)]


def test_shipped_defaults_fit_the_storage_budget(tmp_path: Path) -> None:
    """The catalog-wide defaults are a storage decision, not a taste one.

    The Supabase free plan leaves ~150 MB for the ship-skins bucket; a
    whole-catalog build is ~800 liveries, so the per-skin ceiling has to stay
    well under 200 kB…600 kB depending on how many ships get built. Pin the
    defaults so a future tweak to `texture_size` has to argue with this test.
    """
    cfg = HullExportConfig(
        cgf_converter=tmp_path / "cgf-converter.exe",
        out_dir=tmp_path / "out",
        work_dir=tmp_path / "work",
    )
    assert cfg.texture_size == 512
    assert cfg.max_model_bytes == 600_000
    assert cfg.strip_interior is True
    ex = Hull3DExporter(_FakeP4K(), cfg)
    assert ex.quality_ladder() == [(512, 0.0), (512, 0.0005), (512, 0.001), (512, 0.002)]
    assert cfg.max_hole_ratio == 0.002


# ---- the hole gate ------------------------------------------------------------
def _gated_exporter(tmp_path: Path, rungs: List[tuple]) -> tuple:
    """rungs: (size, skip faces) per ladder call; writes a real cube glb so the
    gate measures geometry, and a payload of `size` bytes as the "compressed" hull."""
    from test_mesh_integrity import cube, write_tris_glb
    ex, _ = _exporter(tmp_path, [1])
    calls: List[float] = []

    def fake_optimize(in_glb, out_glb, texture_size=None, simplify_error=None, compress=True):
        calls.append(simplify_error)
        out_glb.parent.mkdir(parents=True, exist_ok=True)
        write_tris_glb(out_glb, [("hull", cube(skip=rungs[len(calls) - 1][1]))])

    def fake_compress(in_glb, out_glb):
        out_glb.write_bytes(b"x" * rungs[len(calls) - 1][0])

    ex._optimize = fake_optimize  # type: ignore[method-assign]
    ex.compress = fake_compress  # type: ignore[method-assign]
    from test_mesh_integrity import cube as _c
    return ex, calls, _c()


def test_gate_refuses_a_hull_whose_first_rung_has_holes(tmp_path: Path) -> None:
    from sc_extract.mesh_integrity import HullIntegrityError
    ex, calls, ref = _gated_exporter(tmp_path, [(500_000, ("+z",))])
    with pytest.raises(HullIntegrityError, match="holes"):
        ex._optimize_to_budget(tmp_path / "raw.glb", tmp_path / "web.glb", "standard",
                               reference=ref)
    assert calls == [0.0]
    assert not (tmp_path / "web.glb").exists()


def test_gate_keeps_last_gap_free_rung_when_simplify_tears(tmp_path: Path) -> None:
    ex, calls, ref = _gated_exporter(tmp_path, [(1_500_000, ()), (900_000, ("+z", "-x"))])
    size = ex._optimize_to_budget(tmp_path / "raw.glb", tmp_path / "web.glb", "standard",
                                  reference=ref)
    assert size == 1_500_000  # over budget, but whole
    assert calls == [0.0, 0.0005]
    assert sorted(p.name for p in tmp_path.glob("web*")) == ["web.glb"]


def test_gate_passes_clean_hull_within_budget(tmp_path: Path) -> None:
    ex, calls, ref = _gated_exporter(tmp_path, [(400_000, ())])
    assert ex._optimize_to_budget(tmp_path / "raw.glb", tmp_path / "web.glb", "standard",
                                  reference=ref) == 400_000
    assert ex.last_integrity.ok
