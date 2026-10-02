"""mesh_integrity: hole/gap metrics on small synthetic hulls."""
from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest

from sc_extract import glb_materials as gm
from sc_extract import mesh_integrity as mi

_FACES = {  # quad per cube face, outward winding
    "-x": [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)],
    "+x": [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
    "-y": [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
    "+y": [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
    "-z": [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)],
    "+z": [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
}


def cube(size=4.0, offset=(0.0, 0.0, 0.0), skip=(), subdiv=4) -> np.ndarray:
    """A cube of `size` metres as triangles; each face split into subdiv^2 quads."""
    tris = []
    off = np.asarray(offset, dtype=float)
    for name, quad in _FACES.items():
        if name in skip:
            continue
        a, b, _, d = (np.asarray(p, dtype=float) for p in quad)
        eu, ev = (b - a) / subdiv, (d - a) / subdiv
        for i in range(subdiv):
            for j in range(subdiv):
                p0 = a + i * eu + j * ev
                p1, p2, p3 = p0 + eu, p0 + eu + ev, p0 + ev
                tris += [(p0, p1, p2), (p0, p2, p3)]
    return np.asarray(tris) * size + off


def write_tris_glb(path: Path, parts, translation=None, instances=None) -> None:
    """parts: [(material name, tris)] -> one node/mesh per part."""
    binary = b""
    gltf = {"asset": {"version": "2.0"}, "scenes": [{"nodes": []}], "scene": 0,
            "nodes": [], "meshes": [], "materials": [], "accessors": [], "bufferViews": []}

    def add(data: bytes, **acc) -> int:
        nonlocal binary
        gltf["bufferViews"].append({"buffer": 0, "byteOffset": len(binary),
                                    "byteLength": len(data)})
        binary += data + b"\0" * (-len(data) % 4)
        gltf["accessors"].append({"bufferView": len(gltf["bufferViews"]) - 1, **acc})
        return len(gltf["accessors"]) - 1

    for name, tris in parts:
        pos = np.asarray(tris, dtype=np.float32).reshape(-1, 3)
        pa = add(pos.tobytes(), componentType=5126, count=len(pos), type="VEC3",
                 min=pos.min(0).tolist(), max=pos.max(0).tolist())
        ia = add(np.arange(len(pos), dtype=np.uint32).tobytes(), componentType=5125,
                 count=len(pos), type="SCALAR")
        gltf["materials"].append({"name": name})
        gltf["meshes"].append({"primitives": [{"attributes": {"POSITION": pa}, "indices": ia,
                                               "material": len(gltf["materials"]) - 1}]})
        node = {"mesh": len(gltf["meshes"]) - 1}
        if translation:
            node["translation"] = list(translation)
        if instances is not None:
            t = np.asarray(instances, dtype=np.float32)
            ta = add(t.tobytes(), componentType=5126, count=len(t), type="VEC3")
            node["extensions"] = {"EXT_mesh_gpu_instancing": {"attributes": {"TRANSLATION": ta}}}
        gltf["nodes"].append(node)
        gltf["scenes"][0]["nodes"].append(len(gltf["nodes"]) - 1)
    gltf["buffers"] = [{"byteLength": len(binary)}]
    gm.write_glb(path, gltf, binary)


def test_closed_cube_has_no_boundary_and_open_cube_does() -> None:
    assert mi.mesh_stats(cube()).boundary_edges == 0
    open_box = mi.mesh_stats(cube(skip=("+z",), subdiv=1))
    assert open_box.boundary_edges == 4
    assert open_box.triangles == 10


def test_identical_mesh_has_no_holes() -> None:
    rep = mi.coverage_loss(cube(), cube(), resolution=96)
    assert rep.hole_ratio == 0.0


def test_missing_panel_is_a_hole() -> None:
    rep = mi.coverage_loss(cube(), cube(skip=("+z",)), resolution=96)
    assert rep.hole_ratio > 0.05
    assert rep.worst_view > 0.5  # straight down the open face


def test_stripping_hidden_interior_is_not_a_hole() -> None:
    hull = cube(size=4.0)
    inner = cube(size=1.0, offset=(1.5, 1.5, 1.5))
    rep = mi.coverage_loss(np.concatenate([hull, inner]), hull, resolution=96)
    assert rep.hole_ratio == 0.0


def test_small_surface_jitter_is_tolerated() -> None:
    rng = np.random.default_rng(1)
    jittered = cube() + rng.normal(0, 0.004, size=cube().shape)  # ~0.06 % of diag
    assert mi.coverage_loss(cube(), jittered, resolution=96).hole_ratio < 0.002


def test_load_triangles_applies_node_transform_and_filter(tmp_path: Path) -> None:
    glb = tmp_path / "h.glb"
    write_tris_glb(glb, [("hull", cube(subdiv=1)), ("proxy_shell", cube(size=8, subdiv=1))],
                   translation=(10, 0, 0))
    tris = mi.load_triangles(glb, mi.visible_reference_filter)
    assert len(tris) == 12
    assert tris.reshape(-1, 3)[:, 0].min() == pytest.approx(10.0)


def test_load_triangles_expands_gpu_instancing(tmp_path: Path) -> None:
    glb = tmp_path / "i.glb"
    write_tris_glb(glb, [("hull", cube(subdiv=1))], instances=[(0, 0, 0), (20, 0, 0)])
    assert len(mi.load_triangles(glb)) == 24


def test_meshopt_compressed_glb_is_refused(tmp_path: Path) -> None:
    glb = tmp_path / "m.glb"
    write_tris_glb(glb, [("hull", cube(subdiv=1))])
    gltf, binary = gm.read_glb(glb)
    gltf["bufferViews"][0]["extensions"] = {"EXT_meshopt_compression": {}}
    gm.write_glb(glb, gltf, binary)
    with pytest.raises(ValueError, match="meshopt"):
        mi.load_triangles(glb)


def test_check_hull_gate(tmp_path: Path) -> None:
    good, bad = tmp_path / "good.glb", tmp_path / "bad.glb"
    write_tris_glb(good, [("hull", cube())])
    write_tris_glb(bad, [("hull", cube(skip=("+z", "-x")))])
    ref = cube()
    ok = mi.check_hull(ref, good, resolution=96)
    ko = mi.check_hull(ref, bad, resolution=96)
    assert ok.ok and ok.coverage.hole_ratio == 0.0
    assert not ko.ok and ko.candidate.boundary_edges > ok.candidate.boundary_edges
    assert "hole ratio" in ko.summary()
    assert struct  # keep import (helper parity with other glb tests)
