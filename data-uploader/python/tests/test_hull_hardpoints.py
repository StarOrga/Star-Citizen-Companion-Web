"""Hardpoint locators survive the web export as scene extras.

`gltf-transform optimize` prunes every node without a mesh, so the converter's
`hardpoint_*` / `helper_*` / `hp_*` locators would be gone from the published
hull. The exporter reads their world positions from the raw glb and writes them
into the final glb as `scenes[scene].extras.hardpoints`. These tests pin that
contract with synthetic glbs — no P4K, no cgf-converter, no gltf-transform.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import List

from sc_extract import glb_materials as gm
from sc_extract.hull3d import EXPORT_FORMAT, Hull3DExporter, HullExportConfig, Paint


class _FakeP4K:
    def infolist(self) -> list:
        return []


def _exporter(tmp_path: Path, budget: int = 0) -> tuple:
    logs: List[tuple] = []
    cfg = HullExportConfig(cgf_converter=tmp_path / "c.exe", out_dir=tmp_path / "out",
                           work_dir=tmp_path / "work", max_model_bytes=budget,
                           on_log=lambda lvl, msg: logs.append((lvl, msg)))
    return Hull3DExporter(_FakeP4K(), cfg), logs


def _ship_gltf() -> dict:
    """Root moved + rotated 90 deg about Y; locators nested under a mesh part."""
    s = math.sqrt(0.5)
    return {
        "asset": {"version": "2.0"},
        "scene": 1,
        "scenes": [{"nodes": [6]}, {"nodes": [0]}],
        "nodes": [
            {"name": "root", "translation": [0.0, 1.0, 0.0],
             "rotation": [0.0, s, 0.0, s], "children": [1, 2, 5]},
            {"name": "Wing_Left", "mesh": 0, "translation": [2.0, 0.0, 0.0],
             "children": [3, 4]},
            {"name": "HP_Nose", "translation": [0.0, 0.0, 5.0]},
            {"name": "hardpoint_weapon_left", "translation": [1.0, 0.0, 0.0]},
            {"name": "helper.seat", "matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0,
                                               0.5, 0.25, 0, 1]},
            {"name": "hardpointless_part", "translation": [9.0, 9.0, 9.0]},
            # Only in the inactive scene 0 -> must not be listed.
            {"name": "hardpoint_other_scene", "translation": [1.0, 2.0, 3.0]},
        ],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "accessors": [{"componentType": 5126, "count": 3, "type": "VEC3"}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 8}],
        "buffers": [{"byteLength": 8}],
    }


def test_collect_returns_world_positions_of_locators_only() -> None:
    hp = gm.collect_hardpoints(_ship_gltf())
    # rotation 90 deg about Y maps local (x, y, z) -> (z, y, -x), then +1 in Y.
    assert hp == {
        "HP_Nose": [5.0, 1.0, 0.0],
        "hardpoint_weapon_left": [0.0, 1.0, -3.0],
        "helper.seat": [0.0, 1.25, -2.5],
    }


def test_collect_skips_non_finite_and_caps_the_count() -> None:
    gltf = {"scene": 0, "scenes": [{"nodes": list(range(5))}],
            "nodes": [{"name": f"hp_{i}", "translation": [i, 0, 0]} for i in range(4)]
            + [{"name": "hp_bad", "translation": [float("nan"), 0, 0]}]}
    assert "hp_bad" not in gm.collect_hardpoints(gltf)
    assert len(gm.collect_hardpoints(gltf, limit=2)) == 2


def test_embed_writes_scene_extras_and_keeps_the_binary(tmp_path: Path) -> None:
    glb = tmp_path / "web.glb"
    gltf = _ship_gltf()
    gltf["scenes"][1]["extras"] = {"keep": True}
    gm.write_glb(glb, gltf, b"\x01\x02\x03\x04\x05\x06\x07\x08")
    gm.embed_hardpoints(glb, {"hp_a": [1.0, 2.0, 3.0]})
    out, binary = gm.read_glb(glb)
    assert out["scenes"][1]["extras"] == {"keep": True, "hardpoints": {"hp_a": [1.0, 2.0, 3.0]}}
    assert "extras" not in out["scenes"][0]
    assert binary == b"\x01\x02\x03\x04\x05\x06\x07\x08"


def test_every_budget_retry_carries_the_hardpoints(tmp_path: Path) -> None:
    ex, logs = _exporter(tmp_path, budget=1)  # always over budget -> full ladder
    raw = tmp_path / "raw.glb"
    gm.write_glb(raw, _ship_gltf(), b"\0" * 8)
    attempts: List[int] = []

    def fake_optimize(in_glb, out_glb, ts=None, err=None):
        # Like gltf-transform: a fresh file per attempt, locator nodes pruned.
        g, b = gm.read_glb(in_glb)
        g["nodes"] = [n for n in g["nodes"] if "mesh" in n]
        g["scenes"] = [{"nodes": [0]}]
        g["scene"] = 0
        gm.write_glb(out_glb, g, b)
        attempts.append(ts)

    ex._optimize = fake_optimize  # type: ignore[method-assign]
    hp = ex._collect_hardpoints(Paint(mtl="p.mtl", id="standard"), raw)
    web = tmp_path / "web.glb"
    ex._optimize_to_budget(raw, web, "standard", hp)
    assert len(attempts) == len(ex.quality_ladder()) > 1
    out, _ = gm.read_glb(web)
    assert out["scenes"][0]["extras"]["hardpoints"] == hp
    assert len(hp) == 3


def test_unreadable_raw_glb_yields_no_hardpoints_but_no_error(tmp_path: Path) -> None:
    ex, logs = _exporter(tmp_path)
    bad = tmp_path / "bad.glb"
    bad.write_bytes(b"not a glb")
    assert ex._collect_hardpoints(Paint(mtl="p.mtl", id="standard"), bad) == {}
    assert any(lvl == "warn" and "hardpoints" in msg for lvl, msg in logs)


def test_format_bump_forces_a_rebuild() -> None:
    assert EXPORT_FORMAT == "geometry-v2"

