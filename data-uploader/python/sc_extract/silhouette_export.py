"""Wiring: P4K mesh -> `silhouette.py` contract row, for ANY entity that has a
readable ``.cga``/``.cgf`` — ships, weapons, components, armor.

This is the "sibling cached step" the mesh -> web-glb build already is
(`hull3d.py` / `ship_export.py`): it reuses the SAME cgf-converter invocation
pattern, but the silhouette needs no textures/paint at all (it only reads
triangle positions), so the conversion here is deliberately the cheap, no
material/no texture path — call it once per DISTINCT mesh, not once per skin.

Caching: converting a mesh through cgf-converter is the expensive part (one
external process per entity). Every result is cached under
``<out_dir>/silhouette_cache/<sha256(mesh bytes)>-<tool_version>.json`` — a
ship's hull is shared by every livery/edition, an item's mesh is shared by
every variant that points at the same ``.cga``, so a full re-run after a
patch that touched nothing about the mesh costs one hash + one cache read per
entity, not one cgf-converter subprocess.

Not a byte-for-byte building block for tests: this module talks to a real
P4K + a real `cgf-converter` binary, so it is exercised by
`test_silhouette_export.py` only with cgf-converter/​triangle-reading stubbed;
the actual geometry math lives in `silhouette.py` and is unit-tested there
without any of this.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .glb_materials import read_glb, strip_noop_skins
from .hull3d import _safe_join, safe_id
from .silhouette import Triangle

LogFn = Callable[[str, str], None]


def _noop(level: str, msg: str) -> None:
    pass


# glTF accessor componentType -> (struct format char, byte size)
_COMPONENT_TYPES = {
    5121: ("B", 1),  # UNSIGNED_BYTE
    5123: ("H", 2),  # UNSIGNED_SHORT
    5125: ("I", 4),  # UNSIGNED_INT
    5126: ("f", 4),  # FLOAT
}
_TYPE_COUNTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def _read_accessor(gltf: dict, binary: bytes, accessor_index: int) -> List[Any]:
    acc = gltf["accessors"][accessor_index]
    count = acc["count"]
    comp_fmt, comp_size = _COMPONENT_TYPES[acc["componentType"]]
    n = _TYPE_COUNTS[acc["type"]]
    view = gltf["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or (comp_size * n)
    fmt = f"<{n}{comp_fmt}"
    out: List[Any] = []
    for i in range(count):
        off = base + i * stride
        vals = struct.unpack_from(fmt, binary, off)
        out.append(vals[0] if n == 1 else vals)
    return out


def _node_mesh_positions(gltf: dict, binary: bytes) -> List[Tuple[int, List[Tuple[float, float, float]]]]:
    """``[(mesh_index, [pos...])]`` — decoded POSITION accessor per primitive."""
    out = []
    for mesh_index, mesh in enumerate(gltf.get("meshes", [])):
        for prim in mesh.get("primitives", []):
            pos_idx = prim.get("attributes", {}).get("POSITION")
            if pos_idx is None:
                continue
            out.append((mesh_index, _read_accessor(gltf, binary, pos_idx)))
    return out


def _mat_mul(a: List[float], b: List[float]) -> List[float]:
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = (a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
                              + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3])
    return out


_IDENTITY = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]


def _local_matrix(node: dict) -> List[float]:
    if "matrix" in node:
        return list(node["matrix"])
    x, y, z, w = node.get("rotation", (0.0, 0.0, 0.0, 1.0))
    sx, sy, sz = node.get("scale", (1.0, 1.0, 1.0))
    tx, ty, tz = node.get("translation", (0.0, 0.0, 0.0))
    return [
        (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0.0,
        (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0.0,
        (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0.0,
        tx, ty, tz, 1.0,
    ]


def _apply(m: List[float], p: Tuple[float, float, float]) -> Tuple[float, float, float]:
    x, y, z = p
    return (
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    )


def world_triangles_from_glb(gltf: dict, binary: bytes) -> List[Triangle]:
    """Every triangle of every mesh-carrying node, in WORLD (model) space.

    Walks the node hierarchy from the active scene's roots (same as
    `glb_materials._global_matrices`, re-derived here rather than importing a
    private helper across modules) so a hull's wings/engines/turrets — each
    its own node — land in their correct place, exactly like the web glb.
    """
    nodes = gltf.get("nodes", [])
    scenes = gltf.get("scenes") or [{}]
    world: Dict[int, List[float]] = {}
    stack = [(i, list(_IDENTITY)) for i in scenes[gltf.get("scene", 0)].get("nodes", [])]
    seen = set()
    while stack:
        idx, parent = stack.pop()
        if idx in seen or idx >= len(nodes):
            continue
        seen.add(idx)
        m = _mat_mul(parent, _local_matrix(nodes[idx]))
        world[idx] = m
        for child in nodes[idx].get("children", []):
            stack.append((child, m))

    accessors = gltf.get("accessors", [])
    triangles: List[Triangle] = []
    for idx, node in enumerate(nodes):
        mesh_idx = node.get("mesh")
        if mesh_idx is None or idx not in world:
            continue
        m = world[idx]
        mesh = gltf["meshes"][mesh_idx]
        for prim in mesh.get("primitives", []):
            if prim.get("mode", 4) != 4:  # TRIANGLES only
                continue
            pos_idx = prim.get("attributes", {}).get("POSITION")
            if pos_idx is None:
                continue
            positions = [
                _apply(m, tuple(p)) for p in _read_accessor(gltf, binary, pos_idx)
            ]
            if "indices" in prim:
                indices = _read_accessor(gltf, binary, prim["indices"])
            else:
                indices = list(range(len(positions)))
            for i in range(0, len(indices) - 2, 3):
                a, b, c = indices[i], indices[i + 1], indices[i + 2]
                if a >= len(positions) or b >= len(positions) or c >= len(positions):
                    continue
                triangles.append((positions[a], positions[b], positions[c]))
    return triangles


@dataclass
class SilhouetteExportConfig:
    cgf_converter: Path
    work_dir: Path
    cache_dir: Path
    tool_version: str
    on_log: LogFn = _noop
    keep_work: bool = False


class SilhouetteExporter:
    """Converts a hull/item mesh -> triangles -> a cached silhouette geometry
    blob (the `silhouette` sub-object only; anchors are re-derived per call,
    cheap and always fresh)."""

    def __init__(self, p4k, cfg: SilhouetteExportConfig) -> None:
        self.p4k = p4k
        self.cfg = cfg
        self.cfg.cgf_converter = cfg.cgf_converter.resolve()
        self.cfg.work_dir = cfg.work_dir.resolve()
        self.cfg.cache_dir = cfg.cache_dir.resolve()
        self.cfg.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cfg.work_dir.mkdir(parents=True, exist_ok=True)
        self._byname = {i.filename.replace("\\", "/"): i for i in p4k.infolist()}

    def _read(self, p4k_path: str) -> bytes:
        info = self._byname.get(p4k_path.replace("\\", "/"))
        if not info:
            low = p4k_path.lower().replace("\\", "/")
            for fn, i in self._byname.items():
                if fn.lower() == low:
                    info = i
                    break
        if not info:
            raise FileNotFoundError(p4k_path)
        return self.p4k.open(info).read()

    def _cache_path(self, mesh_hash: str) -> Path:
        return self.cfg.cache_dir / f"{mesh_hash}-{self.cfg.tool_version}.json"

    def triangles_for_mesh(self, mesh_path: str, mesh_id: str) -> Optional[List[Triangle]]:
        """Raw-convert one ``.cga``/``.cgf`` and return its world-space
        triangles, or None when the P4K entry/converter output is missing."""
        safe_id(mesh_id, "mesh_id")  # flows into filenames + cmdline
        mirror = self.cfg.work_dir / mesh_id
        if mirror.exists():
            shutil.rmtree(mirror, ignore_errors=True)
        try:
            mesh_disk = _safe_join(mirror, mesh_path.replace("\\", "/"))
            mesh_disk.parent.mkdir(parents=True, exist_ok=True)
            mesh_disk.write_bytes(self._read(mesh_path))
            cgam = mesh_path[:-4] + ".cgam"
            try:
                cgam_disk = _safe_join(mirror, cgam.replace("\\", "/"))
                cgam_disk.write_bytes(self._read(cgam))
            except FileNotFoundError:
                pass
            raw_glb = mirror / f"{mesh_id}.glb"
            self._cgf_to_glb(mesh_disk, mirror / "Data", raw_glb)
            gltf, binary = read_glb(raw_glb)
            strip_noop_skins(gltf, binary, self.cfg.on_log)
            return world_triangles_from_glb(gltf, binary)
        except Exception as exc:  # noqa: BLE001 — one bad mesh must not abort the run
            self.cfg.on_log("warn", f"silhouette mesh {mesh_id}: {type(exc).__name__}: {exc}")
            return None
        finally:
            if not self.cfg.keep_work:
                shutil.rmtree(mirror, ignore_errors=True)

    def _cgf_to_glb(self, mesh_disk: Path, objectdir: Path, out_glb: Path) -> None:
        produced = mesh_disk.with_suffix(".glb")
        produced.unlink(missing_ok=True)
        cmd = [str(self.cfg.cgf_converter), mesh_disk.name, "-glb",
               "-objectdir", str(objectdir), "-loglevel", "Error"]
        r = subprocess.run(cmd, cwd=str(mesh_disk.parent), capture_output=True, timeout=600)
        if not produced.exists() or produced.stat().st_size < 256:
            raise RuntimeError(
                f"cgf-converter produced no usable glb for {mesh_disk.name} (rc={r.returncode})")
        produced.replace(out_glb)

    def silhouette_for_mesh(self, mesh_path: str, mesh_id: str, mesh_bytes: bytes,
                            tolerance_m: float) -> Optional[Dict[str, Any]]:
        """The ``silhouette`` sub-object for one mesh, cached by content hash."""
        from .silhouette import build_silhouette

        mesh_hash = hashlib.sha256(mesh_bytes).hexdigest()
        cache_file = self._cache_path(mesh_hash)
        if cache_file.exists():
            try:
                return json.loads(cache_file.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001 — corrupt cache entry, rebuild
                pass
        triangles = self.triangles_for_mesh(mesh_path, mesh_id)
        if not triangles:
            return None
        silhouette = build_silhouette(triangles, tolerance_m=tolerance_m)
        if silhouette is not None:
            try:
                cache_file.write_text(json.dumps(silhouette, ensure_ascii=False), encoding="utf-8")
            except Exception as exc:  # noqa: BLE001 — cache is an optimization, not required
                self.cfg.on_log("warn", f"silhouette cache write failed for {mesh_id}: {exc}")
        return silhouette

    def export_entity(
        self, *, kind: str, class_name: str, mesh_path: str, mesh_id: str,
        build: Dict[str, Any], generated_at: str,
        frame: Optional[Dict[str, Any]] = None,
        hardpoint_transforms: Optional[Dict[str, Dict[str, Any]]] = None,
        all_port_names: Tuple[Optional[str], ...] = (),
        tolerance_m: float = 0.15,
    ) -> Optional[Dict[str, Any]]:
        """The full §C1 contract row for one entity, or None (no mesh / no
        usable geometry — never a placeholder)."""
        try:
            mesh_bytes = self._read(mesh_path)
        except FileNotFoundError:
            return None
        silhouette = self.silhouette_for_mesh(mesh_path, mesh_id, mesh_bytes, tolerance_m)
        if silhouette is None:
            return None
        # The silhouette geometry is already resolved (fresh or from the mesh
        # cache) — assemble the row directly rather than re-deriving it from
        # triangles through `build_entity_silhouette` a second time.
        row: Dict[str, Any] = {
            "schema": 1, "kind": kind, "className": class_name, "build": build,
            "generatedAt": generated_at, "toolVersion": self.cfg.tool_version,
            "source": {
                "hullCga": mesh_path, "method": "cgf-converter-topdown-raster-trace",
                "modelSpace": "cryengine:+X right,+Y nose,+Z up",
                "frame": frame or {"source": "bbox"},
            },
            "silhouette": silhouette,
        }
        if kind == "ship":
            from .silhouette import project_anchors
            anchors, unresolved = project_anchors(
                hardpoint_transforms or {}, frame or {}, all_port_names,
            )
            row["anchors"] = anchors
            row["unresolved"] = unresolved
        return row
