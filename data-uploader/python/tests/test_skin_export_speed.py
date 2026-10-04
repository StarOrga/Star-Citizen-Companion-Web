"""3D export speed-ups: parallel workers, one conversion per mesh, the shared
optimizer process, and the per-step timing that makes a slow run explain
itself."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from sc_extract import gltf_worker, stage_timing
from sc_extract.assets3d.parts import PartRef, PartStore, publish_blob
from sc_extract.skin_export_app import auto_workers, package_summary


# ---- worker count ----------------------------------------------------------
@pytest.mark.parametrize("jobs,cpu,ram,expected", [
    (271, 12, 32, 4),   # the dev box: 12 threads, 32 GB
    (271, 4, 32, 1),    # few cores
    (271, 16, 8, 1),    # little RAM: each worker holds ~3 GB of P4K index + DataCore
    (271, 32, 64, 4),   # capped
    (2, 12, 32, 2),     # never more workers than ships
    (0, 12, 32, 1),
])
def test_auto_workers(jobs, cpu, ram, expected):
    assert auto_workers(jobs, cpu=cpu, ram_gb=ram) == expected


# ---- part store: one conversion per mesh -----------------------------------
def _store(tmp_path, **kw):
    return PartStore(tmp_path / "_parts", lambda p: b"mesh", lambda p: True, Path("conv.exe"),
                     lambda *a: None, tmp_path / "w", **kw)


def test_helpers_conversion_is_reused_by_export(tmp_path, monkeypatch):
    converted = []

    def fake_convert(self, geo, mtl, scratch):
        converted.append((geo, mtl))
        scratch.mkdir(parents=True, exist_ok=True)
        raw = scratch / "raw.glb"
        raw.write_bytes(b"raw")
        return raw

    published = []

    def fake_publish(self, raw, scratch, geo):
        published.append(raw.read_bytes())
        return PartRef("a" * 64, 3, geo)

    monkeypatch.setattr(PartStore, "convert_raw", fake_convert)
    monkeypatch.setattr(PartStore, "_publish", fake_publish)
    monkeypatch.setattr("sc_extract.assets3d.parts.glb_materials.read_glb", lambda p: ({}, b""))
    monkeypatch.setattr("sc_extract.assets3d.parts.glb_node_transforms",
                        lambda g: {"hardpoint_a": {"position": [0, 0, 0]}})
    store = _store(tmp_path)
    assert store.helpers("Data/turret.cga", "Data/turret.mtl") == \
        {"hardpoint_a": {"position": [0, 0, 0]}}
    store.export("Data/turret.cga", "Data/turret.mtl")
    assert converted == [("Data/turret.cga", "Data/turret.mtl")]  # ONE conversion
    assert published == [b"raw"]
    store.release_raw()
    assert not any((tmp_path / "w").glob("part_*")), "scratch is cleaned up"


def test_helpers_raw_not_reused_for_another_material(tmp_path, monkeypatch):
    converted = []

    def fake_convert(self, geo, mtl, scratch):
        converted.append(mtl)
        scratch.mkdir(parents=True, exist_ok=True)
        (scratch / "raw.glb").write_bytes(b"raw")
        return scratch / "raw.glb"

    monkeypatch.setattr(PartStore, "convert_raw", fake_convert)
    monkeypatch.setattr(PartStore, "_publish", lambda self, raw, scratch, geo: PartRef("b" * 64, 1, geo))
    monkeypatch.setattr("sc_extract.assets3d.parts.glb_materials.read_glb", lambda p: ({}, b""))
    monkeypatch.setattr("sc_extract.assets3d.parts.glb_node_transforms", lambda g: {})
    store = _store(tmp_path)
    store.helpers("Data/rack.cga", "Data/a.mtl")
    store.export("Data/rack.cga", "Data/b.mtl")
    assert converted == ["Data/a.mtl", "Data/b.mtl"]


def test_unclaimed_helper_raw_is_released(tmp_path, monkeypatch):
    def fake_convert(self, geo, mtl, scratch):
        scratch.mkdir(parents=True, exist_ok=True)
        (scratch / "raw.glb").write_bytes(b"raw")
        return scratch / "raw.glb"

    monkeypatch.setattr(PartStore, "convert_raw", fake_convert)
    monkeypatch.setattr("sc_extract.assets3d.parts.glb_materials.read_glb", lambda p: ({}, b""))
    monkeypatch.setattr("sc_extract.assets3d.parts.glb_node_transforms", lambda g: {})
    store = _store(tmp_path)
    store.helpers("Data/unplaced.cga", "Data/unplaced.mtl")
    assert any((tmp_path / "w").glob("part_*"))
    store.release_raw()
    assert not any((tmp_path / "w").glob("part_*"))


# ---- part store: parallel workers -------------------------------------------
def test_worker_indexes_are_merged_on_load(tmp_path, monkeypatch):
    def fake_build(self, geo, mtl):
        sha = ("1" if "a" in geo else "2") * 64
        self.path_of(sha).write_bytes(b"glb")
        return PartRef(sha, 3, geo)

    monkeypatch.setattr(PartStore, "_build", fake_build)
    w0 = _store(tmp_path, index_name="index.w0.json")
    w1 = _store(tmp_path, index_name="index.w1.json")
    w0.export("Data/a.cga")
    w1.export("Data/b.cga")
    w0.save_index()
    w1.save_index()
    assert sorted(p.name for p in (tmp_path / "_parts").glob("index*.json")) == \
        ["index.w0.json", "index.w1.json"]
    later = _store(tmp_path)  # next run, serial: sees both workers' parts
    assert later.export("Data/a.cga").cached and later.export("Data/b.cga").cached


def test_publish_blob_tolerates_a_concurrent_publish(tmp_path):
    dest = tmp_path / "abc.glb"
    first, second = tmp_path / "1.tmp", tmp_path / "2.tmp"
    first.write_bytes(b"same")
    second.write_bytes(b"same")
    publish_blob(first, dest)
    publish_blob(second, dest)  # the other worker lost the race: no error
    assert dest.read_bytes() == b"same" and not first.exists() and not second.exists()


def test_package_summary_merges_worker_rows(tmp_path):
    (tmp_path / ("a" * 64 + ".glb")).write_bytes(b"x" * 10)
    (tmp_path / ("b" * 64 + ".glb")).write_bytes(b"x" * 5)
    s = package_summary([["a" * 64, "b" * 64], ["a" * 64]], 2, 2, tmp_path, 3, 4)
    assert s["unique_parts"] == 2 and s["part_bytes_naive"] == 25
    assert s["part_bytes_deduped"] == 15 and s["cache_hits"] == 3 and s["cache_misses"] == 4


# ---- per-step timing ---------------------------------------------------------
def test_stage_timing_summary_excludes_nested_steps():
    before = stage_timing.snapshot()
    stage_timing.add("convert", 10.0)
    stage_timing.add("convert", 2.0)
    stage_timing.add("hole-gate", 5.0)
    stage_timing.add("~p4k-read", 4.0)  # nested inside convert: not top-level
    booked = stage_timing.since(before)
    assert booked["convert"] == (12.0, 2)
    text = stage_timing.summary(booked, 20.0)
    assert text.startswith("convert 12.0s/2 · hole-gate 5.0s/1 · ~p4k-read 4.0s/1")
    assert text.endswith("other 3.0s")


def test_stage_timing_merge():
    assert stage_timing.merge({"a": (1.0, 1)}, {"a": (2.0, 3), "b": (1.0, 1)}) == \
        {"a": (3.0, 4), "b": (1.0, 1)}


# ---- shared optimizer process -------------------------------------------------
NODE = shutil.which("node")
CLI = Path(__file__).resolve().parents[2] / "node_modules/@gltf-transform/cli/bin/cli.js"


def test_worker_unavailable_without_cli_path():
    with pytest.raises(gltf_worker.WorkerUnavailable):
        gltf_worker.GltfWorker(["node"])


def test_worker_disabled_by_env(monkeypatch):
    monkeypatch.setenv("SC_GLTF_WORKER", "0")
    assert gltf_worker.worker_disabled()


@pytest.mark.skipif(not NODE or not CLI.exists(), reason="needs node + data-uploader/node_modules")
def test_worker_output_matches_the_cli(tmp_path):
    """Byte-identical to one Node per call — the reason it may replace it."""
    src = tmp_path / "in.gltf"
    src.write_text(json.dumps(_triangle_gltf()), encoding="utf-8")
    w = gltf_worker.GltfWorker([NODE, str(CLI)])
    try:
        ok, err = w.run(["optimize", str(src), str(tmp_path / "w.glb"), "--simplify", "false",
                         "--palette", "false", "--compress", "false",
                         "--texture-compress", "webp", "--texture-size", "256"])
        assert ok, err
        ok, err = w.run(["meshopt", str(tmp_path / "w.glb"), str(tmp_path / "w2.glb")])
        assert ok, err
        bad_ok, bad_err = w.run(["meshopt", str(tmp_path / "missing.glb"),
                                 str(tmp_path / "x.glb")])
        assert not bad_ok and bad_err
        ok, _ = w.run(["meshopt", str(tmp_path / "w.glb"), str(tmp_path / "w3.glb")])
        assert ok, "a failed command leaves the worker usable"
    finally:
        w.close()
    for cmd in (["optimize", str(src), str(tmp_path / "c.glb"), "--simplify", "false",
                 "--palette", "false", "--compress", "false",
                 "--texture-compress", "webp", "--texture-size", "256"],
                ["meshopt", str(tmp_path / "c.glb"), str(tmp_path / "c2.glb")]):
        subprocess.run([NODE, str(CLI), *cmd], capture_output=True, check=True, timeout=120)
    assert (tmp_path / "w.glb").read_bytes() == (tmp_path / "c.glb").read_bytes()
    assert (tmp_path / "w2.glb").read_bytes() == (tmp_path / "c2.glb").read_bytes()


def _triangle_gltf() -> dict:
    import base64
    import struct
    pos = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    pos2 = struct.pack("<9f", 0, 0, 1, 1, 0, 1, 0, 1, 1)
    data = pos + pos2
    uri = "data:application/octet-stream;base64," + base64.b64encode(data).decode()
    acc = lambda off: {"bufferView": 0, "byteOffset": off, "componentType": 5126,  # noqa: E731
                       "count": 3, "type": "VEC3", "min": [0, 0, off // 36],
                       "max": [1, 1, off // 36]}
    return {
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": len(data), "uri": uri}],
        "bufferViews": [{"buffer": 0, "byteLength": len(data)}],
        "accessors": [acc(0), acc(36)],
        "materials": [{"name": "hull"}, {"name": "glass"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "material": 0}]},
                   {"primitives": [{"attributes": {"POSITION": 1}, "material": 1}]}],
        "nodes": [{"mesh": 0, "name": "a"}, {"mesh": 1, "name": "b", "translation": [2, 0, 0]}],
        "scenes": [{"nodes": [0, 1]}], "scene": 0,
    }
