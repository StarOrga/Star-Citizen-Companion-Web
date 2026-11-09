"""Item silhouettes (components, weapons, ammo — not ships): proxy filter,
largest-outline view, relative tolerance, inner edges.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/test_silhouette_items.py
"""
from __future__ import annotations

import math
import struct
from typing import List, Tuple

import numpy as np

from sc_extract.silhouette import (
    build_edges_path,
    build_entity_silhouette,
    build_silhouette,
    choose_item_view,
    feature_edge_segments,
)
from sc_extract.silhouette_export import is_hidden_node_name, world_triangles_from_glb

Tri = Tuple[Tuple[float, float, float], Tuple[float, float, float], Tuple[float, float, float]]


def _box(cx: float, cy: float, cz: float, hx: float, hy: float, hz: float) -> List[Tri]:
    v = [(cx + sx * hx, cy + sy * hy, cz + sz * hz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    out: List[Tri] = []
    for a, b, c, d in faces:
        out.append((v[a], v[b], v[c]))
        out.append((v[a], v[c], v[d]))
    return out


def _glb(nodes: List[Tuple[str, List[Tri]]]):
    """A minimal glTF dict + binary: one mesh node per ``(name, cry-space triangles)``
    (cry (x, y, z) is written as glTF (x, z, -y), the inverse of `_gltf_to_cry`)."""
    binary = b""
    gltf = {"scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": [], "meshes": [],
            "accessors": [], "bufferViews": []}
    for i, (name, tris) in enumerate(nodes):
        flat = [p for t in tris for p in t]
        data = b"".join(struct.pack("<3f", x, z, -y) for x, y, z in flat)
        gltf["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)})
        binary += data
        gltf["accessors"].append({"bufferView": i, "componentType": 5126, "count": len(flat), "type": "VEC3"})
        gltf["meshes"].append({"primitives": [{"attributes": {"POSITION": i}, "mode": 4}]})
        gltf["nodes"].append({"name": name, "mesh": i})
    return gltf, binary


def _bbox_h(sil) -> Tuple[float, float]:
    return sil["bbox"]["w"], sil["bbox"]["h"]


def test_box_with_proxy_node_is_not_the_outline() -> None:
    """A small part plus a huge physics box: the box must not become the quad."""
    body = _box(0, 0, 0, 0.2, 0.3, 0.1) + _box(0.0, 0.0, 0.0, 0.05, 0.45, 0.05)  # body + a long pipe
    proxy = _box(0, 0, 0, 0.6, 0.6, 0.6)
    gltf, binary = _glb([("cooler_body", body), ("$physics_proxy0", proxy)])

    tris = world_triangles_from_glb(gltf, binary)
    assert len(tris) == len(body)  # the proxy node is gone before rasterising
    unfiltered = world_triangles_from_glb(gltf, binary, drop_hidden=False)
    assert len(unfiltered) == len(body) + len(proxy)

    sil = build_silhouette(tris, item=True)
    assert sil is not None
    w, h = _bbox_h(sil)
    # the 1.2 m proxy would make a square; the real part is a 0.9 m tall cross
    assert abs(w - h) > 100


def test_hidden_node_names_and_all_hidden_fallback() -> None:
    for name in ("$physics_proxy0", "hull_collision", "mesh_lod2", "phys_box", "col01", "Proxy"):
        assert is_hidden_node_name(name), name
    for name in ("missile_body", "thruster_left", "cool_aegs_s01_pl04", "color_plate", "collar", None, ""):
        assert not is_hidden_node_name(name), name
    # a hull whose ONLY geometry is named like a proxy keeps it (never lose the part)
    gltf, binary = _glb([("proxy_hull", _box(0, 0, 0, 0.2, 0.3, 0.1))])
    assert len(world_triangles_from_glb(gltf, binary)) == 12


def test_elongated_ammo_body_uses_its_profile_view_and_keeps_detail() -> None:
    """A round lying along Z (up) with fins: top-down is a thin dot-sized blob,
    the front/side view shows the long profile with the fins."""
    body = _box(0, 0, 0, 0.1, 0.1, 1.0)
    fins = _box(0, 0, -0.8, 0.3, 0.02, 0.15) + _box(0, 0, 0.9, 0.05, 0.05, 0.1)
    tris = body + fins
    assert choose_item_view(tris) in ("front", "side")
    sil = build_silhouette(tris, item=True)
    assert sil is not None and sil["view"] in ("front", "side")
    w, h = _bbox_h(sil)
    assert h > w  # long axis stays the tall one
    # more than the 4-point quad the old 0.15 m floor produced (fins are 0.3 m)
    assert sil["pointCount"] >= 8
    # ships keep the top-down view and never carry the item keys
    ship = build_silhouette(tris)
    assert ship is not None and "view" not in ship and "edges" not in ship


def test_flat_top_view_is_kept_for_a_part_that_is_already_wide() -> None:
    tris = _box(0, 0, 0, 0.4, 0.3, 0.05)
    assert choose_item_view(tris) == "top"


def test_edges_are_open_polylines_in_the_same_viewbox_and_budgeted() -> None:
    tris = _box(0, 0, 0, 0.4, 0.25, 0.1) + _box(0.15, 0.0, 0.1, 0.1, 0.1, 0.05)
    sil = build_silhouette(tris, item=True)
    assert sil is not None and sil["edges"]
    d = sil["edges"]
    assert d.startswith("M ") and "Z" not in d
    nums = [float(t) for t in d.replace("M", " ").replace("L", " ").split()]
    assert all(0.0 <= n <= 1000.0 for n in nums)
    assert d.count("M") >= 1
    assert len(nums) // 2 <= 600  # point budget
    # box edges are creases: 12 per box, each box adds its own outline
    assert len(d) < 4000


def test_smooth_surface_has_no_creases_but_boundary_edges() -> None:
    # a flat plate: only its four outline edges are features
    plate = [((0, 0, 0), (1, 0, 0), (1, 1, 0)), ((0, 0, 0), (1, 1, 0), (0, 1, 0))]
    segs = feature_edge_segments(plate, "top")
    assert segs.shape[0] == 4  # the diagonal is coplanar -> no crease
    # a cylinder-like fan of 24 slices: the side seams are shallow, no crease edges there
    n = 24
    ring = [(math.cos(2 * math.pi * i / n), math.sin(2 * math.pi * i / n)) for i in range(n + 1)]
    tris: List[Tri] = []
    for (x0, y0), (x1, y1) in zip(ring[:-1], ring[1:]):
        tris.append(((x0, y0, 0), (x1, y1, 0), (x1, y1, 1)))
        tris.append(((x0, y0, 0), (x1, y1, 1), (x0, y0, 1)))
    segs = feature_edge_segments(tris, "front")
    assert segs.shape[0] == 2 * n  # only the open top and bottom rims


def test_edges_path_drops_short_chains_and_respects_max_points() -> None:
    long_chain = np.array([[[10 + i * 5, 10], [15 + i * 5, 10]] for i in range(40)], dtype=float)
    speck = np.array([[[500, 500], [501, 500]]], dtype=float)
    d, used = build_edges_path(np.concatenate([long_chain, speck]), max_points=100)
    assert used == 2 and d.count("M") == 1  # one straight chain, simplified to its ends; speck dropped
    assert build_edges_path(np.zeros((0, 2, 2)))[0] == ""


def test_entity_row_carries_edges_only_for_items() -> None:
    tris = _box(0, 0, 0, 0.4, 0.25, 0.1) + _box(0.15, 0.0, 0.1, 0.1, 0.1, 0.05)
    common = dict(class_name="X", triangles=tris, hull_cga="a.cga", tool_version="t", build={}, generated_at="now")
    item = build_entity_silhouette(kind="component", **common)
    ship = build_entity_silhouette(kind="ship", **common)
    assert item is not None and "edges" in item["silhouette"]
    assert ship is not None and "edges" not in ship["silhouette"]
