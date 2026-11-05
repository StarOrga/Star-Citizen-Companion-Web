"""Silhouette export wiring: glTF node/accessor walking (the part that does
NOT need a real P4K or cgf-converter binary — those are exercised manually
against a live extract, see the wave-1 handoff doc).

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/
"""

from __future__ import annotations

import hashlib
import io
import os
import struct
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

from sc_extract import silhouette_export
from sc_extract.glb_materials import write_glb
from sc_extract.silhouette_export import SilhouetteExportConfig, SilhouetteExporter, world_triangles_from_glb


def _positions_binary(positions: list) -> bytes:
    return b"".join(struct.pack("<3f", *p) for p in positions)


def _gltf_one_triangle(node_extra: dict) -> tuple:
    positions = [(-1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 2.0, 0.0)]
    binary = _positions_binary(positions)
    gltf = {
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, **node_extra}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "mode": 4}]}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
        "bufferViews": [{"byteOffset": 0, "byteLength": len(binary)}],
    }
    return gltf, binary


class TestWorldTriangles:
    def test_identity_node_keeps_local_positions(self) -> None:
        # glTF Y-up (x, y, z) -> CryEngine (x, -z, y) (blocker 1): the source
        # positions are glTF-space; the mesh's "nose" vertex (0, 2, 0) — 2 m
        # along glTF +Y — becomes 2 m along Cry +Z (up), i.e. (0, 0, 2), not
        # a top-down XY offset.
        gltf, binary = _gltf_one_triangle({})
        tris = world_triangles_from_glb(gltf, binary)
        assert tris == [((-1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 2.0))]

    def test_translation_is_applied(self) -> None:
        gltf, binary = _gltf_one_triangle({"translation": [0.0, 5.0, 0.0]})
        tris = world_triangles_from_glb(gltf, binary)
        assert tris == [((-1.0, 0.0, 5.0), (1.0, 0.0, 5.0), (0.0, 0.0, 7.0))]

    def test_nested_node_composes_parent_transform(self) -> None:
        positions = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)]
        binary = _positions_binary(positions)
        gltf = {
            "scene": 0,
            "scenes": [{"nodes": [0]}],
            "nodes": [
                {"translation": [10.0, 0.0, 0.0], "children": [1]},
                {"mesh": 0, "translation": [0.0, 1.0, 0.0]},
            ],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "mode": 4}]}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
            "bufferViews": [{"byteOffset": 0, "byteLength": len(binary)}],
        }
        tris = world_triangles_from_glb(gltf, binary)
        assert tris == [((10.0, 0.0, 1.0), (11.0, 0.0, 1.0), (10.0, 0.0, 2.0))]

    def test_non_triangle_mode_is_skipped(self) -> None:
        gltf, binary = _gltf_one_triangle({})
        gltf["meshes"][0]["primitives"][0]["mode"] = 1  # LINES
        assert world_triangles_from_glb(gltf, binary) == []

    def test_indexed_geometry_uses_index_buffer(self) -> None:
        positions = [(-1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 2.0, 0.0), (0.0, 2.0, 0.0)]
        pos_binary = _positions_binary(positions)
        indices = [0, 1, 2]
        idx_binary = struct.pack("<3H", *indices)
        binary = pos_binary + idx_binary
        gltf = {
            "scene": 0,
            "scenes": [{"nodes": [0]}],
            "nodes": [{"mesh": 0}],
            "meshes": [{"primitives": [
                {"attributes": {"POSITION": 0}, "indices": 1, "mode": 4},
            ]}],
            "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"},
            ],
            "bufferViews": [
                {"byteOffset": 0, "byteLength": len(pos_binary)},
                {"byteOffset": len(pos_binary), "byteLength": len(idx_binary)},
            ],
        }
        tris = world_triangles_from_glb(gltf, binary)
        assert tris == [((-1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 2.0))]

    def test_node_without_mesh_index_is_ignored(self) -> None:
        gltf, binary = _gltf_one_triangle({})
        gltf["scenes"][0]["nodes"] = [0, 1]
        gltf["nodes"].append({"translation": [99.0, 99.0, 99.0]})  # no "mesh" key
        tris = world_triangles_from_glb(gltf, binary)
        assert len(tris) == 1  # the mesh-less node contributes nothing


class TestBlocker1ProjectionAxis:
    """Blocker 1 (wave1-redteam.md): cgf-converter emits Y-up glTF; the
    silhouette pipeline is CryEngine-axed. A hull shaped like a real ship —
    longer along glTF -Z ("forward") than along X — must come out of
    `world_triangles_from_glb` longer along Cry +Y (nose) than Cry +X, and a
    silhouette built from it must be taller than it is wide with the nose
    (glTF -Z end) at the TOP of the viewBox — not a front cross-section."""

    def test_yup_hull_produces_a_taller_than_wide_nose_up_silhouette(self) -> None:
        # Flat in glTF's XZ plane (Y = 0, i.e. Cry's up axis after
        # conversion): 2 m wide (X), 8 m long, extending along glTF -Z (the
        # glTF "forward" convention) from the tail (Z=0) to the nose (Z=-8).
        positions = [
            (-1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 0.0, -8.0), (-1.0, 0.0, -8.0),
        ]
        binary = _positions_binary(positions)
        indices = [0, 1, 2, 0, 2, 3]
        idx_binary = struct.pack("<6H", *indices)
        gltf = {
            "scene": 0,
            "scenes": [{"nodes": [0]}],
            "nodes": [{"mesh": 0}],
            "meshes": [{"primitives": [
                {"attributes": {"POSITION": 0}, "indices": 1, "mode": 4},
            ]}],
            "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5123, "count": 6, "type": "SCALAR"},
            ],
            "bufferViews": [
                {"byteOffset": 0, "byteLength": len(binary)},
                {"byteOffset": len(binary), "byteLength": len(idx_binary)},
            ],
        }
        tris = world_triangles_from_glb(gltf, binary + idx_binary)

        # Longer along Cry +Y (nose) than Cry +X (starboard) — the projection
        # axis is now correct, not a front cross-section.
        ys = [v[1] for tri in tris for v in tri]
        xs = [v[0] for tri in tris for v in tri]
        assert (max(ys) - min(ys)) > (max(xs) - min(xs))

        from sc_extract.silhouette import build_silhouette
        sil = build_silhouette(tris)
        assert sil is not None
        assert sil["bbox"]["h"] > sil["bbox"]["w"]  # taller than wide

        import re
        coords = [tuple(map(float, m.split()))
                 for m in re.findall(r"-?\d+\.?\d* -?\d+\.?\d*", sil["path"])]
        pys = [y for _x, y in coords]
        # nose = glTF Z=-8 -> Cry Y=8 (max) -> viewBox top (smaller y).
        assert min(pys) < 500 < max(pys)


# ---- scratch layout: a deep P4K path must not reach the converter's cwd ------

class _DeepP4K:
    """Just enough P4K for `SilhouetteExporter`: name -> bytes."""

    def __init__(self, files: dict) -> None:
        self.files = files

    def infolist(self) -> list:
        return [SimpleNamespace(filename=name) for name in self.files]

    def open(self, info):
        return io.BytesIO(self.files[info.filename])


# Depth of the longest real mesh directories in LIVE (122 chars), and deep
# enough that the old mirrored `<work>/<id>-<key>/<P4K path>` is over Windows'
# 258-char limit on a current directory wherever pytest's tmp dir happens to be.
_DEEP_DIR = "Data/Objects/" + "/".join(["buildingsets_human_hightech_loc_stanton"] * 7)
_DEEP_MESH = f"{_DEEP_DIR}/orison_hosp_int_hway_door_single_a.cga"


def _exporter_with_real_cwd(tmp_path, monkeypatch, files: dict):
    """An exporter whose fake converter really starts a process in the requested
    cwd — on Windows that is what raises WinError 267 for a too-long one."""
    positions = [(-1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 2.0, 0.0)]
    binary = _positions_binary(positions)
    gltf, _ = _gltf_one_triangle({})
    gltf["bufferViews"][0]["byteLength"] = len(binary)
    gltf["asset"] = {"generator": "x" * 256}
    template = tmp_path / "converted.glb"
    write_glb(template, gltf, binary)

    calls = []
    real_run = subprocess.run

    def fake_converter(cmd, cwd=None, **kwargs):
        cwd_files = sorted(os.listdir(cwd))
        objectdir = cmd[cmd.index("-objectdir") + 1]
        calls.append({"cmd": cmd, "cwd": cwd, "files": cwd_files, "objectdir_exists": os.path.isdir(objectdir)})
        out = Path(cmd[1]).stem + ".glb"
        return real_run([sys.executable, "-c", "import shutil,sys; shutil.copy(sys.argv[1], sys.argv[2])",
                         str(template), out], cwd=cwd, capture_output=True, check=True)

    monkeypatch.setattr(silhouette_export.subprocess, "run", fake_converter)
    cfg = SilhouetteExportConfig(cgf_converter=tmp_path / "cgf-converter.exe", work_dir=tmp_path / "w",
                                 cache_dir=tmp_path / "cache", tool_version="0.0.0",
                                 on_log=lambda level, msg: None)
    return SilhouetteExporter(_DeepP4K(files), cfg), calls


def test_a_mesh_deep_in_the_p4k_converts_from_a_cwd_that_ignores_its_depth(tmp_path, monkeypatch):
    # Regression: orison_hosp_int_hway_door_single_a & co. lost their silhouette
    # to `NotADirectoryError: [WinError 267]` — the cwd mirrored the P4K path.
    exp, calls = _exporter_with_real_cwd(tmp_path, monkeypatch, {
        _DEEP_MESH: b"mesh", _DEEP_MESH[:-4] + ".cgam": b"payload"})
    src = exp.source(_DEEP_MESH, 0.15)

    triangles = exp._triangles(src, "orison_hosp_int_hway_door_single_a")

    assert len(triangles) == 1
    call = calls[0]
    work = str(exp.cfg.work_dir)
    # One short directory below the work dir, however deep the mesh sits.
    assert os.path.dirname(call["cwd"]) == work
    assert len(call["cwd"]) <= len(work) + 17
    # What the converter resolves stays reachable: the companion next to the
    # mesh, the mesh by its own name, an object dir that exists.
    assert call["files"] == ["orison_hosp_int_hway_door_single_a.cga", "orison_hosp_int_hway_door_single_a.cgam"]
    assert call["cmd"][1] == "orison_hosp_int_hway_door_single_a.cga"
    assert call["objectdir_exists"]
    # Nothing is left behind.
    assert os.listdir(work) == []


def test_two_entities_on_identical_bytes_never_share_a_scratch_dir(tmp_path, monkeypatch):
    # Parallel conversions: same content under two names must not collide.
    a, b = f"{_DEEP_DIR}/a.cga", f"{_DEEP_DIR}/b.cga"
    exp, calls = _exporter_with_real_cwd(tmp_path, monkeypatch, {a: b"mesh", b: b"mesh"})
    src_a, src_b = exp.source(a, 0.15), exp.source(b, 0.15)
    assert src_a.key == src_b.key
    exp._triangles(src_a, "a")
    exp._triangles(src_b, "b")
    assert calls[0]["cwd"] != calls[1]["cwd"]


def test_cache_key_does_not_depend_on_where_the_mesh_lives(tmp_path, monkeypatch):
    # Pinned: the key must keep hitting caches written before the scratch layout
    # changed. It is built from the bytes and the tuning constants, never the path.
    from sc_extract.silhouette import CHAIKIN_ITERATIONS, MASK_SIZE, MIN_HOLE_AREA_PX, VIEWBOX

    deep, flat = _DEEP_MESH, "a.cga"
    exp, _ = _exporter_with_real_cwd(tmp_path, monkeypatch, {
        deep: b"mesh", deep[:-4] + ".cgam": b"payload", flat: b"mesh", "a.cgam": b"payload"})
    expected = hashlib.sha256(
        b"mesh" + b"payload"
        + f"{MASK_SIZE}|{VIEWBOX}|{MIN_HOLE_AREA_PX}|{CHAIKIN_ITERATIONS}|0.15".encode("utf-8")
    ).hexdigest()
    assert exp.source(deep, 0.15).key == expected
    assert exp.source(flat, 0.15).key == expected
