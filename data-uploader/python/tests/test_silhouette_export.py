"""Silhouette export wiring: glTF node/accessor walking (the part that does
NOT need a real P4K or cgf-converter binary — those are exercised manually
against a live extract, see the wave-1 handoff doc).

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/
"""

from __future__ import annotations

import struct

from sc_extract.silhouette_export import world_triangles_from_glb


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
