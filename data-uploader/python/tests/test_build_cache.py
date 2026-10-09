"""Cross-patch reuse of 3D build output (sc_extract.build_cache).

A new patch's ``skins-<patch>`` dir starts from the previous patch's stores,
and only byte-identical inputs are ever reused.
"""
from __future__ import annotations

import json
from pathlib import Path

from sc_extract import build_cache
from sc_extract.assets3d import ships
from sc_extract.assets3d.parts import PartRef, PartStore
from sc_extract.hull3d import EXPORT_FORMAT, Hull3DExporter, HullExportConfig, Paint, ShipSpec


def _store(root: Path, files: dict, pipeline: str = "p1") -> PartStore:
    return PartStore(root / "_parts", lambda p: files[p], lambda p: p in files, Path("conv.exe"),
                     lambda *a: None, root / "w", pipeline=pipeline)


def _fake_build(built):
    def fake_build(self, geo, mtl):
        built.append(geo)
        sha = (geo.encode().hex() * 64)[:64]
        self.path_of(sha).write_bytes(b"glb")
        return PartRef(sha, 3, geo)
    return fake_build


def test_part_rows_are_reused_only_for_identical_inputs(tmp_path, monkeypatch):
    built: list = []
    monkeypatch.setattr(PartStore, "_build", _fake_build(built))
    files = {"Data/gun.cgf": b"v1", "Data/hull.cga": b"h"}
    old = tmp_path / "skins-4.2"
    s = _store(old, files)
    s.export("Data/gun.cgf")
    s.export("Data/hull.cga")
    s.save_index()

    new = tmp_path / "skins-4.3"
    assert build_cache.seed_from_previous(new) == old.resolve()
    files2 = {"Data/gun.cgf": b"v2 changed", "Data/hull.cga": b"h"}
    s2 = _store(new, files2)
    assert s2.export("Data/hull.cga").cached          # unchanged → reused
    assert not s2.export("Data/gun.cgf").cached       # changed → rebuilt
    assert built == ["Data/gun.cgf", "Data/hull.cga", "Data/gun.cgf"]


def test_a_pipeline_change_rebuilds_everything(tmp_path, monkeypatch):
    built: list = []
    monkeypatch.setattr(PartStore, "_build", _fake_build(built))
    files = {"Data/gun.cgf": b"v1"}
    s = _store(tmp_path, files, pipeline="p1")
    s.export("Data/gun.cgf")
    s.save_index()
    assert not _store(tmp_path, files, pipeline="p2").export("Data/gun.cgf").cached


def test_helpers_follow_the_mesh_content(tmp_path, monkeypatch):
    calls: list = []

    def fake_convert(self, geo, mtl, scratch):
        calls.append(geo)
        scratch.mkdir(parents=True, exist_ok=True)
        (scratch / "raw.glb").write_bytes(b"raw")
        return scratch / "raw.glb"

    monkeypatch.setattr(PartStore, "convert_raw", fake_convert)
    monkeypatch.setattr("sc_extract.assets3d.parts.glb_materials.read_glb", lambda p: ({}, b""))
    monkeypatch.setattr("sc_extract.assets3d.parts.glb_node_transforms", lambda g: {"a": {}})
    files = {"Data/t.cga": b"1"}
    s = _store(tmp_path, files)
    s.helpers("Data/t.cga")
    s.helpers("Data/t.cga")
    assert calls == ["Data/t.cga"]
    s.save_index()
    files["Data/t.cga"] = b"2"
    _store(tmp_path, files).helpers("Data/t.cga")
    assert calls == ["Data/t.cga", "Data/t.cga"]


def test_interior_is_reused_for_the_same_hull_and_paint(tmp_path, monkeypatch):
    files = {"Data/h.cga": b"h", "Data/p.mtl": b"m"}
    store = _store(tmp_path, files)
    converted: list = []

    def fake_convert(geo, mtl, scratch):
        converted.append(geo)
        scratch.mkdir(parents=True, exist_ok=True)
        (scratch / "raw.glb").write_bytes(b"raw")
        return scratch / "raw.glb"

    monkeypatch.setattr(store, "convert_raw", fake_convert)
    monkeypatch.setattr(ships, "keep_only_interior", lambda raw, log: 1)
    monkeypatch.setattr(ships.glb_materials, "strip_to_geometry", lambda raw, log: None)

    def optimize(raw, out, size, err):
        out.write_bytes(b"interior")

    out = tmp_path / "_interiors"
    first = ships.export_interior(store, "Data/h.cga", "Data/p.mtl", out, optimize)
    second = ships.export_interior(store, "Data/h.cga", "Data/p.mtl", out, optimize)
    assert first == second and first is not None and first.exists()
    assert converted == ["Data/h.cga"]


class _Info:
    def __init__(self, filename):
        self.filename = filename


class _P4K:
    def __init__(self, files):
        self.files = files

    def infolist(self):
        return [_Info(n) for n in self.files]

    def open(self, info):
        data = self.files[info.filename]

        class R:
            def read(self_inner):
                return data
        return R()


def test_an_unchanged_hull_is_taken_from_the_previous_patch(tmp_path):
    files = {"Data/Ships/h.cga": b"hull", "Data/Ships/p.mtl": b"paint"}
    prev = tmp_path / "skins-4.2"
    cfg = HullExportConfig(cgf_converter=Path("c.exe"), out_dir=tmp_path / "skins-4.3",
                           work_dir=tmp_path / "w", reuse_dirs=[prev], pipeline="p1")
    exp = Hull3DExporter(_P4K(files), cfg)
    spec = ShipSpec("AEGS_Gladius", "Data/Ships/h.cga", "Data", [Paint("Data/Ships/p.mtl", "standard")])
    src = exp.hull_src(spec, spec.paints[0])
    (prev / "AEGS_Gladius" / "models").mkdir(parents=True)
    (prev / "AEGS_Gladius" / "models" / "AEGS_Gladius_standard.glb").write_bytes(b"glb")
    (prev / "AEGS_Gladius" / "skins.json").write_text(json.dumps({
        "ship": "AEGS_Gladius", "format": EXPORT_FORMAT,
        "skins": [{"id": "standard", "model": "models/AEGS_Gladius_standard.glb",
                   "model_mb": 0.5, "hull_src": src}]}))
    out = cfg.out_dir / "AEGS_Gladius"
    (out / "models").mkdir(parents=True)
    got = exp._export_hull(spec, spec.paints[0], out)
    assert got["reused"] and got["hull_src"] == src and got["model_mb"] == 0.5
    assert (out / "models" / "AEGS_Gladius_standard.glb").read_bytes() == b"glb"


def test_a_changed_hull_is_not_taken_from_the_previous_patch(tmp_path):
    files = {"Data/Ships/h.cga": b"hull v2", "Data/Ships/p.mtl": b"paint"}
    prev = tmp_path / "skins-4.2"
    cfg = HullExportConfig(cgf_converter=Path("c.exe"), out_dir=tmp_path / "o",
                           work_dir=tmp_path / "w", reuse_dirs=[prev], pipeline="p1")
    exp = Hull3DExporter(_P4K(files), cfg)
    spec = ShipSpec("S", "Data/Ships/h.cga", "Data", [Paint("Data/Ships/p.mtl", "standard")])
    (prev / "S" / "models").mkdir(parents=True)
    (prev / "S" / "models" / "S_standard.glb").write_bytes(b"glb")
    (prev / "S" / "skins.json").write_text(json.dumps({
        "format": EXPORT_FORMAT,
        "skins": [{"id": "standard", "model": "models/S_standard.glb", "hull_src": "stale"}]}))
    assert exp._reuse_hull(spec, spec.paints[0], tmp_path / "o" / "S",
                           exp.hull_src(spec, spec.paints[0])) is None


def test_seed_links_stores_and_ignores_unrelated_dirs(tmp_path):
    root = tmp_path / ".sc-companion-extracts"
    (root / "skins-4.2" / "_parts").mkdir(parents=True)
    (root / "skins-4.2" / "_parts" / "abc.glb").write_bytes(b"x")
    (root / "skins-4.2" / "_parts" / "index.json").write_text("{}")
    assert build_cache.seed_from_previous(root / "LIVE-4.3") is None
    new = root / "skins-4.3"
    assert build_cache.seed_from_previous(new) == (root / "skins-4.2").resolve()
    assert (new / "_parts" / "abc.glb").read_bytes() == b"x"
    assert (new / "_parts" / "index.json").read_text() == "{}"


def test_content_key_distinguishes_absent_from_empty():
    files = {"a": b""}
    k1 = build_cache.content_key(lambda p: files[p], lambda p: p in files, ["a"], "t")
    k2 = build_cache.content_key(lambda p: files[p], lambda p: p in files, ["b"], "t")
    k3 = build_cache.content_key(lambda p: files[p], lambda p: p in files, ["a"], "u")
    assert len({k1, k2, k3}) == 3
