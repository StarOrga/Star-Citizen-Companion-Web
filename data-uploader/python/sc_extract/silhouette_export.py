"""Wiring: P4K mesh -> `silhouette.py` contract row, for ANY entity that has a
readable ``.cga``/``.cgf`` — ships, weapons, components, armor.

This is the "sibling cached step" the mesh -> web-glb build already is
(`hull3d.py` / `ship_export.py`): it reuses the SAME cgf-converter invocation
pattern, but the silhouette needs no textures/paint at all (it only reads
triangle positions), so the conversion here is deliberately the cheap, no
material/no texture path — call it once per DISTINCT mesh, not once per skin.

Caching: converting a mesh through cgf-converter is the expensive part (one
external process per mesh). Every result is cached under
``<cache_dir>/<sha256(mesh + cgam + tuning)>-<algo>.json``, where ``algo`` is a
hash of this module and `silhouette.py` themselves — so the cache survives
uploader releases that did not touch the silhouette code, and is dropped the
moment one does. The host keeps the cache dir OUTSIDE the per-run extract dir
(which is purged before every extraction), so the next patch — which leaves
most meshes untouched — only pays one hash + one cache read per mesh.

Not a byte-for-byte building block for tests: this module talks to a real
P4K + a real `cgf-converter` binary, so it is exercised by
`test_silhouette_export.py` only with cgf-converter/​triangle-reading stubbed;
the actual geometry math lives in `silhouette.py` and is unit-tested there
without any of this.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import struct
import subprocess
import time
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


def _gltf_to_cry(p: Tuple[float, float, float]) -> Tuple[float, float, float]:
    """glTF Y-up ``(x, y, z)`` -> CryEngine ``(x, -z, y)`` — blocker 1
    (wave1-redteam.md): cgf-converter emits Y-up glTF, but `silhouette.py`'s
    whole pipeline (top-down projection, anchors) is documented and written
    in CryEngine axes (+X right, +Y nose, +Z up). This is the exact inverse
    of the mapping `src/app/codex/glb-hardpoints.ts` documents for the other
    direction (Cry -> glTF reads as ``(X, Z, -Y)``): given glTF ``(x, y, z)``,
    Cry ``x = x``, ``y = -z`` (nose), ``z = y`` (up)."""
    x, y, z = p
    return (x, -z, y)


def world_triangles_from_glb(gltf: dict, binary: bytes) -> List[Triangle]:
    """Every triangle of every mesh-carrying node, in WORLD (model) space,
    converted to CryEngine axes (+X right, +Y nose, +Z up) — see
    `_gltf_to_cry`.

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
                triangles.append((
                    _gltf_to_cry(positions[a]),
                    _gltf_to_cry(positions[b]),
                    _gltf_to_cry(positions[c]),
                ))
    return triangles


def algo_tag() -> str:
    """Short hash of the code that turns a mesh into a silhouette blob.

    Part of every cache key: a change to the raster/trace/simplify code (or to
    this wiring) invalidates the cache by itself — no hand-maintained version
    constant to forget — while a release that left them alone keeps every
    cached mesh."""
    h = hashlib.sha256()
    here = Path(__file__).resolve().parent
    for name in ("silhouette.py", "silhouette_export.py"):
        try:
            h.update((here / name).read_bytes())
        except OSError:
            h.update(name.encode())
    return h.hexdigest()[:12]


@dataclass
class MeshSource:
    """One mesh's bytes and cache key — read from the P4K exactly once."""
    path: str
    mesh: bytes
    cgam: Optional[bytes]
    key: str


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
    cheap and always fresh).

    Split so a build can run conversions in parallel: `source()` touches the
    P4K (call it from ONE thread), `compute()` only touches the bytes it is
    handed, a scratch dir of its own and the cache (safe from worker threads).
    """

    def __init__(self, p4k, cfg: SilhouetteExportConfig) -> None:
        self.p4k = p4k
        self.cfg = cfg
        self.cfg.cgf_converter = cfg.cgf_converter.resolve()
        self.cfg.work_dir = cfg.work_dir.resolve()
        self.cfg.cache_dir = cfg.cache_dir.resolve()
        self.cfg.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cfg.work_dir.mkdir(parents=True, exist_ok=True)
        self._byname = {i.filename.replace("\\", "/"): i for i in p4k.infolist()}
        # Case-insensitive fallback as ONE dict, built once. It used to be a
        # linear scan of every archive entry (1.37M on LIVE) per miss — and a
        # mesh without a `.cgam` (most items) missed three times per entity.
        self._lower: Optional[Dict[str, Any]] = None
        self.algo = algo_tag()

    # ---- P4K (single thread) ------------------------------------------------
    def _info(self, p4k_path: str):
        key = p4k_path.replace("\\", "/")
        info = self._byname.get(key)
        if info is None:
            if self._lower is None:
                self._lower = {}
                for fn, i in self._byname.items():
                    self._lower.setdefault(fn.lower(), i)
            info = self._lower.get(key.lower())
        return info

    def _read(self, p4k_path: str) -> bytes:
        info = self._info(p4k_path)
        if not info:
            raise FileNotFoundError(p4k_path)
        return self.p4k.open(info).read()

    def source(self, mesh_path: str, tolerance_m: float) -> MeshSource:
        """Read a mesh (+ its `.cgam`) once and derive its cache key."""
        mesh = self._read(mesh_path)
        try:
            cgam: Optional[bytes] = self._read(mesh_path[:-4] + ".cgam")
        except FileNotFoundError:
            cgam = None
        return MeshSource(mesh_path, mesh, cgam, self._key(mesh, cgam, tolerance_m))

    def _key(self, mesh: bytes, cgam: Optional[bytes], tolerance_m: float) -> str:
        """Should-fix "cache key" (wave1-redteam.md): the ``.cga`` bytes alone
        are not enough — a ``.cgam`` (the streamable geometry payload a
        ``.cga`` often defers to) or a tuning-constant change (mask size,
        hole-area floor, chaikin iterations, DP tolerance) must not serve a
        STALE cached silhouette. Fold both in."""
        from .silhouette import CHAIKIN_ITERATIONS, MASK_SIZE, MIN_HOLE_AREA_PX, VIEWBOX

        h = hashlib.sha256()
        h.update(mesh)
        if cgam is not None:
            h.update(cgam)
        h.update(f"{MASK_SIZE}|{VIEWBOX}|{MIN_HOLE_AREA_PX}|{CHAIKIN_ITERATIONS}|{tolerance_m}".encode("utf-8"))
        return h.hexdigest()

    # ---- cache --------------------------------------------------------------
    def _cache_path(self, key: str) -> Path:
        return self.cfg.cache_dir / f"{key}-{self.algo}.json"

    def cached(self, src: MeshSource) -> Optional[Dict[str, Any]]:
        """The cached `silhouette` blob for this mesh, or None."""
        f = self._cache_path(src.key)
        if not f.exists():
            return None
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 — corrupt cache entry, rebuild
            return None

    def prune_cache(self) -> int:
        """Drop cache entries written by OTHER versions of the silhouette code —
        they can never be hit again. Returns how many were removed."""
        removed = 0
        suffix = f"-{self.algo}.json"
        try:
            for f in self.cfg.cache_dir.glob("*.json"):
                if not f.name.endswith(suffix):
                    try:
                        f.unlink()
                        removed += 1
                    except OSError:
                        pass
        except OSError:
            pass
        return removed

    # ---- conversion (any thread) --------------------------------------------
    def compute(self, src: MeshSource, mesh_id: str, tolerance_m: float) -> Optional[Dict[str, Any]]:
        """Convert + trace one mesh from its bytes and cache the result. Does
        not touch the P4K, so several can run at once."""
        from .silhouette import build_silhouette

        t0 = time.monotonic()
        triangles = self._triangles(src, mesh_id)
        if not triangles:
            return None
        silhouette = build_silhouette(triangles, tolerance_m=tolerance_m, on_log=self.cfg.on_log)
        # Should-fix "runtime" (wave1-redteam.md): the wall-clock cost of the
        # expensive part per mesh, so a real run's timing is provable.
        self.cfg.on_log("info", f"silhouette {mesh_id}: {time.monotonic() - t0:.2f}s "
                                f"({len(triangles)} triangle(s))")
        if silhouette is not None:
            try:
                tmp = self._cache_path(src.key).with_suffix(f".{os.getpid()}.{id(src)}.tmp")
                tmp.write_text(json.dumps(silhouette, ensure_ascii=False), encoding="utf-8")
                tmp.replace(self._cache_path(src.key))
            except Exception as exc:  # noqa: BLE001 — cache is an optimization, not required
                self.cfg.on_log("warn", f"silhouette cache write failed for {mesh_id}: {exc}")
        return silhouette

    def _triangles(self, src: MeshSource, mesh_id: str) -> Optional[List[Triangle]]:
        safe_id(mesh_id, "mesh_id")  # flows into filenames + cmdline
        mirror = self.cfg.work_dir / f"{mesh_id}-{src.key[:8]}"
        if mirror.exists():
            shutil.rmtree(mirror, ignore_errors=True)
        try:
            mesh_disk = _safe_join(mirror, src.path.replace("\\", "/"))
            mesh_disk.parent.mkdir(parents=True, exist_ok=True)
            mesh_disk.write_bytes(src.mesh)
            if src.cgam is not None:
                _safe_join(mirror, (src.path[:-4] + ".cgam").replace("\\", "/")).write_bytes(src.cgam)
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

    # ---- one-shot conveniences (single thread) ------------------------------
    def read_mesh_bytes(self, mesh_path: str) -> bytes:
        return self._read(mesh_path)

    def is_cached(self, mesh_path: str, mesh_bytes: bytes, tolerance_m: float) -> bool:
        """Whether this mesh already has a cached `silhouette` blob."""
        try:
            cgam: Optional[bytes] = self._read(mesh_path[:-4] + ".cgam")
        except FileNotFoundError:
            cgam = None
        return self._cache_path(self._key(mesh_bytes, cgam, tolerance_m)).exists()

    def silhouette_for_mesh(self, mesh_path: str, mesh_id: str, tolerance_m: float) -> Optional[Dict[str, Any]]:
        """The ``silhouette`` sub-object for one mesh, from the cache or freshly built."""
        src = self.source(mesh_path, tolerance_m)
        return self.cached(src) or self.compute(src, mesh_id, tolerance_m)

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
            silhouette = self.silhouette_for_mesh(mesh_path, mesh_id, tolerance_m)
        except FileNotFoundError:
            return None
        if silhouette is None:
            return None
        return self.row(kind=kind, class_name=class_name, mesh_path=mesh_path, build=build,
                        generated_at=generated_at, silhouette=silhouette, frame=frame,
                        hardpoint_transforms=hardpoint_transforms, all_port_names=all_port_names)

    def row(
        self, *, kind: str, class_name: str, mesh_path: str, build: Dict[str, Any],
        generated_at: str, silhouette: Dict[str, Any],
        frame: Optional[Dict[str, Any]] = None,
        hardpoint_transforms: Optional[Dict[str, Dict[str, Any]]] = None,
        all_port_names: Tuple[Optional[str], ...] = (),
    ) -> Dict[str, Any]:
        """Assemble the contract row from an already-resolved silhouette blob.

        The blob is shared by every entity on the same mesh, so it is copied,
        never mutated. Blocker 2 (wave1-redteam.md): the path's own
        min/scale/offset transform travels INSIDE the blob (`_transform`, see
        `build_silhouette`) so it survives a cache hit too — it is dropped from
        the row (never part of the §C1 contract) and fed to `project_anchors` so
        anchors land in the SAME space as the path."""
        sil = dict(silhouette)
        path_transform = sil.pop("_transform", None)
        row: Dict[str, Any] = {
            "schema": 1, "kind": kind, "className": class_name, "build": build,
            "generatedAt": generated_at, "toolVersion": self.cfg.tool_version,
            "source": {
                "hullCga": mesh_path, "method": "cgf-converter-topdown-raster-trace",
                "modelSpace": "cryengine:+X right,+Y nose,+Z up",
                "frame": frame or {"source": "bbox"},
            },
            "silhouette": sil,
        }
        if kind == "ship":
            from .silhouette import project_anchors
            anchors, unresolved = project_anchors(
                hardpoint_transforms or {}, frame or {}, all_port_names,
                transform=path_transform,
            )
            row["anchors"] = anchors
            row["unresolved"] = unresolved
        return row
