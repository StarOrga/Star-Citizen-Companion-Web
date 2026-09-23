"""The two glb repair steps must fail independently of each other.

`_unrig_hull` (drop the converter's no-op skin) is best-effort: a hull it
cannot fix still ships, because a collapsed hull beats no hull (admin feedback
d7f44a41). `_reduce_to_geometry` (interior + texture strip) is the opposite: it
raises, because a hull that kept CIG's textures must never be published.

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


def test_geometry_reduction_keeps_the_unrigged_placement(tmp_path: Path) -> None:
    ex, _ = _exporter(tmp_path)
    glb = tmp_path / "hull.glb"
    _skinned_glb(glb)

    ex._unrig_hull(Paint(mtl="", id="standard"), glb)
    ex._reduce_to_geometry(glb)

    gltf, _ = glb_materials.read_glb(glb)
    assert "skins" not in gltf
    assert gltf["nodes"][1]["translation"] == [0.0, -0.59, -6.85]
    assert gltf["meshes"][0]["primitives"][0]["material"] == 0   # no default material


def test_geometry_reduction_of_an_unreadable_glb_raises(tmp_path: Path) -> None:
    """Unlike the un-rig, this step must never let a hull through untouched —
    an unstripped hull would publish CIG's textures."""
    ex, _ = _exporter(tmp_path)
    broken = tmp_path / "broken.glb"
    broken.write_bytes(b"not a glb at all")

    try:
        ex._reduce_to_geometry(broken)
    except Exception:  # noqa: BLE001
        return
    raise AssertionError("a glb that cannot be stripped must fail the hull")


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
