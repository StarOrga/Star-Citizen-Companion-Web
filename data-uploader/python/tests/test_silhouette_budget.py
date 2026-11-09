"""Silhouette build: shared-accessor decode, per-mesh time budget, LOD1 retry events.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/test_silhouette_budget.py
"""

from __future__ import annotations

import json
import random
import struct
import threading
import time
from pathlib import Path

import pytest

from sc_extract import silhouette_export as se
from sc_extract.silhouette_build import build_rows
from sc_extract.silhouette_export import MeshSource, SilhouetteSkip, world_triangles_from_glb

from test_silhouette_build_rows import SIL, FakeExporter


def _old_world_triangles(gltf: dict, binary: bytes):
    """The per-primitive, per-vertex implementation this module replaced (kept
    verbatim as the reference the numpy path must match bit for bit)."""
    nodes = gltf.get("nodes", [])
    scenes = gltf.get("scenes") or [{}]
    world = {}
    stack = [(i, list(se._IDENTITY)) for i in scenes[gltf.get("scene", 0)].get("nodes", [])]
    seen = set()
    while stack:
        idx, parent = stack.pop()
        if idx in seen or idx >= len(nodes):
            continue
        seen.add(idx)
        m = se._mat_mul(parent, se._local_matrix(nodes[idx]))
        world[idx] = m
        for child in nodes[idx].get("children", []):
            stack.append((child, m))
    out = []
    for idx, node in enumerate(nodes):
        if node.get("mesh") is None or idx not in world:
            continue
        m = world[idx]
        for prim in gltf["meshes"][node["mesh"]].get("primitives", []):
            if prim.get("mode", 4) != 4:
                continue
            pos_idx = prim.get("attributes", {}).get("POSITION")
            if pos_idx is None:
                continue
            positions = [se._apply(m, tuple(p)) for p in se._read_accessor(gltf, binary, pos_idx)]
            indices = (se._read_accessor(gltf, binary, prim["indices"]) if "indices" in prim
                       else list(range(len(positions))))
            for i in range(0, len(indices) - 2, 3):
                a, b, c = indices[i], indices[i + 1], indices[i + 2]
                if a >= len(positions) or b >= len(positions) or c >= len(positions):
                    continue
                out.append((se._gltf_to_cry(positions[a]), se._gltf_to_cry(positions[b]),
                            se._gltf_to_cry(positions[c])))
    return out


def _shared_mesh(n_prims: int, n_verts: int, seed: int = 1):
    """`n_prims` primitives over ONE POSITION accessor (interleaved, strided),
    with 16-bit indices, a ragged tail and some out-of-range triangles."""
    rnd = random.Random(seed)
    stride = 16  # 12 bytes of position + 4 bytes of padding
    pos = b"".join(struct.pack("<3f", *(rnd.uniform(-50, 50) for _ in range(3))) + b"\0" * 4
                   for _ in range(n_verts))
    pos = b"\0" * 8 + pos
    idx_blobs, accessors = [], [{"bufferView": 0, "byteOffset": 8 - 8, "componentType": 5126,
                                 "count": n_verts, "type": "VEC3"}]
    views = [{"byteOffset": 8, "byteLength": len(pos) - 8, "byteStride": stride}]
    prims = []
    blob = bytearray(pos)
    for _ in range(n_prims):
        k = rnd.randint(3, 40)
        ids = [rnd.randrange(0, n_verts + 3) for _ in range(k)]  # +3: out of range now and then
        while len(blob) % 4:
            blob.append(0)
        views.append({"byteOffset": len(blob), "byteLength": 2 * k})
        blob += struct.pack(f"<{k}H", *ids)
        accessors.append({"bufferView": len(views) - 1, "componentType": 5123, "count": k, "type": "SCALAR"})
        prims.append({"attributes": {"POSITION": 0}, "indices": len(accessors) - 1, "mode": 4})
    prims.append({"attributes": {"POSITION": 0}, "mode": 4})  # non-indexed
    gltf = {
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"children": [1, 2], "translation": [1.5, -2.25, 3.0], "rotation": [0.1, 0.7, -0.3, 0.64],
                   "scale": [1.1, 0.9, 2.0]},
                  {"mesh": 0, "matrix": [0.5, 0.1, 0.0, 0.0, -0.2, 0.9, 0.3, 0.0, 0.0, 0.4, 1.3, 0.0, 7.0, 8.0, 9.0, 1.0]},
                  {"mesh": 0, "translation": [0.3, 0.2, 0.1]}],
        "meshes": [{"primitives": prims}],
        "accessors": accessors, "bufferViews": views,
    }
    return gltf, bytes(blob)


def test_numpy_decode_matches_old_implementation_exactly() -> None:
    gltf, binary = _shared_mesh(n_prims=25, n_verts=300)
    new, old = world_triangles_from_glb(gltf, binary), _old_world_triangles(gltf, binary)
    assert len(old) > 100
    assert new == old  # same triangles, same order, same float values
    assert all(type(c) is float for t in new[:20] for v in t for c in v)
    assert all(type(v) is tuple for t in new[:20] for v in t)


def test_many_primitives_sharing_one_accessor_decode_it_once(monkeypatch: pytest.MonkeyPatch) -> None:
    gltf, binary = _shared_mesh(n_prims=600, n_verts=20000)
    calls = []
    real = se._read_accessor_np
    monkeypatch.setattr(se, "_read_accessor_np", lambda g, b, i: (calls.append(i), real(g, b, i))[1])
    t0 = time.perf_counter()
    tris = world_triangles_from_glb(gltf, binary)
    assert calls.count(0) == 2  # the shared POSITION accessor: once per node (2 nodes use the mesh)
    assert len(tris) > 1000
    # The old per-vertex code needed ~24M Python-level decodes for this; generous bound.
    assert time.perf_counter() - t0 < 5.0


def test_deadline_stops_the_decode_loop() -> None:
    gltf, binary = _shared_mesh(n_prims=5, n_verts=50)
    se.set_deadline(time.monotonic() - 1)
    try:
        with pytest.raises(se.MeshBudgetExceeded):
            world_triangles_from_glb(gltf, binary)
    finally:
        se.set_deadline(None)


def test_main_pass_budget_exceeded_ends_in_skip(tmp_path: Path) -> None:
    release = threading.Event()

    class Hangs(FakeExporter):
        def compute(self, src, mesh_id, tolerance_m):
            if "stuck" in src.path:  # LOD0 and its LOD1 retry
                release.wait(30)  # ignores the cooperative deadline, like a stuck external call
                return dict(SIL)
            return super().compute(src, mesh_id, tolerance_m)

    ents = [{"kind": "ship", "class_name": "STUCK", "mesh": "s/stuck.cga"},
            {"kind": "weapon", "class_name": "GUN", "mesh": "w/gun.cgf"}]
    t0 = time.monotonic()
    try:
        stats = build_rows(Hangs(), ents, out_dir=tmp_path, build={}, workers=2,
                           budget_s=0.2, grace_s=0.2)
        elapsed = time.monotonic() - t0
    finally:
        release.set()
    assert elapsed < 10  # returned while the worker was still stuck
    skips = json.loads((tmp_path / "silhouettes" / "skips.json").read_text())["skips"]
    stuck = [s for s in skips if s["className"] == "STUCK"]
    assert stuck and stuck[0]["reason"] == "convert_failed"
    assert "time budget exceeded" in stuck[0]["detail"]
    assert (tmp_path / "silhouettes" / "rows" / "weapon__GUN.json").exists()
    assert stats["abandoned"] >= 1


def test_single_stuck_worker_does_not_hold_the_queued_meshes(tmp_path: Path) -> None:
    release = threading.Event()

    class Hangs(FakeExporter):
        def compute(self, src, mesh_id, tolerance_m):
            if "stuck" in src.path:
                release.wait(30)
                return dict(SIL)
            return super().compute(src, mesh_id, tolerance_m)

    ents = [{"kind": "ship", "class_name": "STUCK", "mesh": "s/stuck.cga"},
            {"kind": "weapon", "class_name": "GUN", "mesh": "w/gun.cgf"}]
    t0 = time.monotonic()
    try:
        build_rows(Hangs(), ents, out_dir=tmp_path, build={}, workers=1,
                   budget_s=0.2, grace_s=0.2)
        elapsed = time.monotonic() - t0
    finally:
        release.set()
    assert elapsed < 10  # the queue behind the only worker was given up, not waited for
    skips = json.loads((tmp_path / "silhouettes" / "skips.json").read_text())["skips"]
    assert {s["className"] for s in skips} == {"STUCK", "GUN"}


def test_lod1_retry_budget_exceeded_ends_in_skip(tmp_path: Path) -> None:
    release = threading.Event()

    class Lod1Hangs(FakeExporter):
        def source(self, mesh, tolerance_m, item=False):
            return MeshSource(mesh, b"x", None, mesh)

        def compute(self, src, mesh_id, tolerance_m):
            if src.path == "s/big.cga":
                raise SilhouetteSkip("convert_failed", "OverflowException")
            release.wait(30)
            return dict(SIL)

    try:
        build_rows(Lod1Hangs(), [{"kind": "ship", "class_name": "BIG", "mesh": "s/big.cga"}],
                   out_dir=tmp_path, build={}, workers=1, budget_s=0.2, grace_s=0.2)
    finally:
        release.set()
    skips = json.loads((tmp_path / "silhouettes" / "skips.json").read_text())["skips"]
    assert [(s["className"], s["reason"]) for s in skips] == [("BIG", "convert_failed")]
    assert "time budget exceeded" in skips[0]["detail"]


def test_lod1_retry_emits_start_and_finish_events(tmp_path: Path) -> None:
    class Lod0Breaks(FakeExporter):
        def source(self, mesh, tolerance_m, item=False):
            return MeshSource(mesh, b"x", None, mesh)

        def compute(self, src, mesh_id, tolerance_m):
            if src.path in ("s/big.cga", "s/huge.cga"):
                raise SilhouetteSkip("convert_failed", "OverflowException")
            return super().compute(src, mesh_id, tolerance_m)

    logs, progress = [], []
    ents = [{"kind": "ship", "class_name": "BIG", "mesh": "s/big.cga"},
            {"kind": "ship", "class_name": "HUGE", "mesh": "s/huge.cga"}]
    build_rows(Lod0Breaks(), ents, out_dir=tmp_path, build={}, workers=2,
               log=lambda level, msg: logs.append(msg),
               on_progress=lambda cur, tot, detail: progress.append(detail))
    retry_progress = [d for d in progress if d.startswith("LOD1 retry")]
    assert retry_progress == ["LOD1 retry 1/2: big", "LOD1 retry 2/2: huge"]
    assert any("LOD1 retry 1/2: big started" in m for m in logs)
    assert any("LOD1 retry 2/2: huge started" in m for m in logs)
    assert any("big: LOD0 failed to convert, used big_lod1.cga" in m for m in logs)
