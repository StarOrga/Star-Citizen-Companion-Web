"""The silhouette build does its per-mesh work exactly once.

`build_rows` is driven with fake exporters/P4Ks — the converter and the
raster/trace are covered elsewhere; this is about what runs how often.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from sc_extract import silhouette_export
from sc_extract.silhouette_build import build_rows, cache_dir_for
from sc_extract.silhouette_export import MeshSource, SilhouetteExportConfig, SilhouetteExporter

SIL = {"path": "M0 0L10 0L10 20L0 20Z", "viewBox": "0 0 1000 1000", "bbox": [0, 0, 10, 20],
       "_transform": {"minX": 0, "minY": 0, "scale": 1, "offX": 0, "offY": 0}}


class FakeExporter:
    def __init__(self, cached=()):
        self.sources: list = []
        self.computes: list = []
        self.cached_keys = set(cached)
        self.lock = threading.Lock()

    def source(self, mesh, tolerance_m):
        self.sources.append(mesh)
        if mesh.endswith("missing.cgf"):
            raise FileNotFoundError(mesh)
        return MeshSource(mesh, b"x", None, mesh)

    def cached(self, src):
        return dict(SIL) if src.key in self.cached_keys else None

    def compute(self, src, mesh_id, tolerance_m):
        with self.lock:
            self.computes.append(src.path)
        return None if src.path.endswith("empty.cgf") else dict(SIL)

    def row(self, **kw):
        exp = SilhouetteExporter.__new__(SilhouetteExporter)
        exp.cfg = SilhouetteExportConfig(cgf_converter=Path("c"), work_dir=Path("w"), cache_dir=Path("k"),
                                         tool_version="t")
        return SilhouetteExporter.row(exp, **kw)


def entities():
    return [
        {"kind": "ship", "class_name": "AEGS_Gladius", "mesh": "ships/gladius.cga", "ground": False},
        {"kind": "ship", "class_name": "AEGS_Gladius_Valiant", "mesh": "ships/gladius.cga"},
        {"kind": "weapon", "class_name": "GUN_A", "mesh": "w/gun.cgf"},
        {"kind": "weapon", "class_name": "GUN_B", "mesh": "w/gun.cgf"},
        {"kind": "component", "class_name": "SHLD", "mesh": "c/shield.cgf"},
        {"kind": "item", "class_name": "GONE", "mesh": "i/missing.cgf"},
        {"kind": "item", "class_name": "EMPTY", "mesh": "i/empty.cgf"},
    ]


def test_each_distinct_mesh_is_read_and_converted_once(tmp_path):
    exp = FakeExporter(cached={"c/shield.cgf"})
    stats = build_rows(exp, entities(), out_dir=tmp_path, build={}, workers=3)
    assert sorted(exp.sources) == sorted(set(e["mesh"] for e in entities()))
    # Shield came from the cache; the missing mesh never reached the converter.
    assert sorted(exp.computes) == ["i/empty.cgf", "ships/gladius.cga", "w/gun.cgf"]
    assert stats["written"] == 5
    assert stats["cached"] == 1
    assert stats["skipped"] == 2
    rows = sorted(p.name for p in (tmp_path / "silhouettes" / "rows").iterdir())
    assert "ship__AEGS_Gladius.json" in rows and "weapon__GUN_B.json" in rows


def test_ship_rows_carry_constellation_ground_and_no_private_transform(tmp_path):
    build_rows(FakeExporter(), entities()[:2], out_dir=tmp_path, build={"channel": "LIVE"})
    row = json.loads((tmp_path / "silhouettes" / "rows" / "ship__AEGS_Gladius.json").read_text())
    assert row["ground"] is False
    assert "_transform" not in row["silhouette"]
    assert "anchors" in row
    # Shared blob was copied, not mutated, so the second edition still projects.
    row2 = json.loads((tmp_path / "silhouettes" / "rows" / "ship__AEGS_Gladius_Valiant.json").read_text())
    assert row2["silhouette"]["path"] == SIL["path"]


def test_progress_reaches_every_entity(tmp_path):
    seen = []
    build_rows(FakeExporter(), entities(), out_dir=tmp_path, build={}, workers=2,
               on_progress=lambda c, t, d: seen.append((c, t)))
    assert seen[-1] == (7, 7)
    assert [c for c, _ in seen] == list(range(1, 8))


def test_cache_lives_outside_the_purged_extract_dir(tmp_path):
    out = tmp_path / ".sc-companion-extracts" / "LIVE-4.3"
    assert cache_dir_for(out) == (tmp_path / ".sc-companion-extracts" / "silhouette-cache").resolve()
    assert cache_dir_for(tmp_path / "x") == tmp_path / "x" / "silhouette_cache"


class FakeInfo:
    def __init__(self, filename):
        self.filename = filename


class FakeP4K:
    def __init__(self, files):
        self.files = files
        self.opens: list = []

    def infolist(self):
        return [FakeInfo(n) for n in self.files]

    def open(self, info):
        self.opens.append(info.filename)
        data = self.files[info.filename]

        class R:
            def read(self_inner):
                return data
        return R()


def _exporter(tmp_path, files):
    p4k = FakeP4K(files)
    cfg = SilhouetteExportConfig(cgf_converter=tmp_path / "c.exe", work_dir=tmp_path / "w",
                                 cache_dir=tmp_path / "cache", tool_version="0.0.0")
    return SilhouetteExporter(p4k, cfg), p4k


def test_source_reads_mesh_and_cgam_once_case_insensitively(tmp_path):
    exp, p4k = _exporter(tmp_path, {"Data/Ships/Hull.cga": b"mesh", "Data/Ships/Hull.cgam": b"payload"})
    src = exp.source("data/ships/hull.cga", 0.15)
    assert src.mesh == b"mesh" and src.cgam == b"payload"
    assert p4k.opens == ["Data/Ships/Hull.cga", "Data/Ships/Hull.cgam"]


def test_cache_key_covers_cgam_and_is_reused_across_code_versions_only_when_equal(tmp_path, monkeypatch):
    exp, _ = _exporter(tmp_path, {"a.cga": b"mesh", "a.cgam": b"1", "b.cga": b"mesh"})
    a, b = exp.source("a.cga", 0.15), exp.source("b.cga", 0.15)
    assert a.key != b.key
    monkeypatch.setattr(exp, "_triangles", lambda src, mesh_id: [((0, 0, 0), (1, 0, 0), (0, 1, 0))])
    monkeypatch.setattr(silhouette_export, "_noop", lambda *a: None)
    first = exp.compute(a, "a", 0.15)
    assert first is not None
    assert exp.cached(a) == first
    # A different silhouette code version cannot hit — and prune drops its leftovers.
    exp.algo = "other"
    assert exp.cached(a) is None
    assert exp.prune_cache() == 1
