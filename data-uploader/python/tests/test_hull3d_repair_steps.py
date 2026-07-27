"""The two glb repair steps must fail independently of each other.

`_unrig_hull` (drop the converter's no-op skin) and `_apply_paint_materials`
(fold the paint .mtl's layer tints in) fix two unrelated defects of the same
converter output. They are separate steps with separate `try` blocks on
purpose: a ship whose paint `.mtl` will not parse must still get a correctly
*placed* hull, because a white ship is a cosmetic bug while a collapsed one is
the "kaputtes 3D-Modell" of admin feedback d7f44a41.

These tests drive the two steps with stubs — no P4K, no cgf-converter.
"""
from __future__ import annotations

import struct
from pathlib import Path
from typing import List

from sc_extract import glb_materials
from sc_extract.hull3d import Hull3DExporter, HullExportConfig, Paint

IDENTITY = [1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0]


class _FakeP4K:
    """The exporter only indexes infolist() at construction."""

    def infolist(self) -> list:
        return []


def _exporter(tmp_path: Path) -> tuple:
    logs: List[tuple] = []
    cfg = HullExportConfig(
        cgf_converter=tmp_path / "cgf-converter.exe",
        out_dir=tmp_path / "out",
        work_dir=tmp_path / "work",
        on_log=lambda lvl, msg: logs.append((lvl, msg)),
    )
    return Hull3DExporter(_FakeP4K(), cfg), logs


def _skinned_glb(path: Path) -> None:
    """A converter-shaped hull: one mesh node, rigidly bound to itself."""
    offset = (0.0, -0.59, -6.85)
    ibm = list(IDENTITY)
    ibm[12], ibm[13], ibm[14] = (-offset[0], -offset[1], -offset[2])
    binary = struct.pack("<16f", *ibm)
    gltf = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [
            {"name": "root", "children": [1]},
            {"name": "Body", "translation": list(offset), "mesh": 0, "skin": 0},
        ],
        "meshes": [{"primitives": [{
            "attributes": {"POSITION": 0, "JOINTS_0": 1, "WEIGHTS_0": 2},
        }]}],
        "skins": [{"joints": [1], "skeleton": 0, "inverseBindMatrices": 3}],
        "accessors": [
            {"componentType": 5126, "count": 3, "type": "VEC3"},
            {"componentType": 5123, "count": 3, "type": "VEC4"},
            {"componentType": 5126, "count": 3, "type": "VEC4"},
            {"componentType": 5126, "count": 1, "type": "MAT4", "bufferView": 0},
        ],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(binary)}],
        "buffers": [{"byteLength": len(binary)}],
    }
    glb_materials.write_glb(path, gltf, binary)


def test_unrig_removes_the_skin_and_keeps_the_placement(tmp_path: Path) -> None:
    ex, logs = _exporter(tmp_path)
    glb = tmp_path / "hull.glb"
    _skinned_glb(glb)

    ex._unrig_hull(Paint(mtl="", id="standard"), glb)

    gltf, _ = glb_materials.read_glb(glb)
    assert "skins" not in gltf
    assert "skin" not in gltf["nodes"][1]
    # the placement the renderer was ignoring must survive
    assert gltf["nodes"][1]["translation"] == [0.0, -0.59, -6.85]
    assert set(gltf["meshes"][0]["primitives"][0]["attributes"]) == {"POSITION"}
    assert any(lvl == "info" for lvl, _ in logs)


def test_unrig_still_runs_when_the_paint_mtl_is_unusable(tmp_path: Path) -> None:
    """A broken .mtl may cost the colours — never the geometry placement."""
    ex, logs = _exporter(tmp_path)
    glb = tmp_path / "hull.glb"
    _skinned_glb(glb)

    ex._unrig_hull(Paint(mtl="", id="standard"), glb)
    ex._apply_paint_materials(Paint(mtl="does/not/exist.mtl", id="standard"), glb)

    gltf, _ = glb_materials.read_glb(glb)
    assert "skins" not in gltf                       # rig repair survived
    assert any(lvl == "warn" for lvl, _ in logs)     # material failure was reported


def test_unrig_of_an_unreadable_glb_is_reported_not_raised(tmp_path: Path) -> None:
    ex, logs = _exporter(tmp_path)
    broken = tmp_path / "broken.glb"
    broken.write_bytes(b"not a glb at all")

    ex._unrig_hull(Paint(mtl="", id="standard"), broken)

    assert any(lvl == "warn" and "un-rigging failed" in msg for lvl, msg in logs)


def test_unrig_leaves_an_unskinned_glb_byte_identical(tmp_path: Path) -> None:
    ex, _ = _exporter(tmp_path)
    glb = tmp_path / "plain.glb"
    glb_materials.write_glb(glb, {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "Body", "mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "accessors": [{"componentType": 5126, "count": 3, "type": "VEC3"}],
    }, b"")
    before = glb.read_bytes()

    ex._unrig_hull(Paint(mtl="", id="standard"), glb)

    assert glb.read_bytes() == before
