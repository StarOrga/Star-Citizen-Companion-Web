"""Stage 2 — EXPORT: one shared, content-addressed, geometry-only GLB per
distinct item geometry.

A part is keyed by its P4K geometry path (``Data/Objects/.../gun.cga``) and
stored as ``<store>/<sha256>.glb``: one Behring gun model is converted once
and reused by every ship (and every run, via ``index.json``). The GLB origin
is the item's own model origin, which in CryEngine is its attach point, so a
manifest placement transform positions it directly.

Same publication policy as the hull: geometry only — no CIG texture ever
leaves the P4K (``glb_materials.strip_to_geometry`` raises rather than ship a
textured part). Then ``gltf-transform optimize`` (simplify + meshopt).
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional

from .. import glb_materials

LogFn = Callable[[str, str], None]
# (in_glb, out_glb, texture_size, simplify_error) -> None; raises on failure.
OptimizeFn = Callable[[Path, Path, int, float], None]

# Bump when the part pipeline changes output; older index rows are rebuilt.
PART_FORMAT = "part-geometry-v1"


@dataclass
class PartRef:
    sha256: Optional[str]          # None = this geometry yields no part
    bytes: int = 0
    geometry_path: str = ""
    bounds: Optional[dict] = None
    error: Optional[str] = None
    cached: bool = False


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def glb_bounds(path: Path) -> Optional[dict]:
    """World-space AABB (glTF space) of every mesh in a GLB, from accessor
    min/max through the node hierarchy — no vertex decoding, so it works on
    meshopt-compressed files."""
    gltf, _ = glb_materials.read_glb(path)
    worlds = glb_materials._global_matrices(gltf)  # column-major
    accs = gltf.get("accessors", [])
    lo, hi = [float("inf")] * 3, [float("-inf")] * 3
    for ni, node in enumerate(gltf.get("nodes", [])):
        mesh = node.get("mesh")
        if mesh is None or mesh >= len(gltf.get("meshes", [])):
            continue
        m = worlds[ni]
        for prim in gltf["meshes"][mesh].get("primitives", []):
            a = prim.get("attributes", {}).get("POSITION")
            acc = accs[a] if isinstance(a, int) and a < len(accs) else {}
            amin, amax = acc.get("min"), acc.get("max")
            if not (isinstance(amin, list) and isinstance(amax, list) and len(amin) == 3):
                continue
            for cx in (amin[0], amax[0]):
                for cy in (amin[1], amax[1]):
                    for cz in (amin[2], amax[2]):
                        w = [m[r] * cx + m[4 + r] * cy + m[8 + r] * cz + m[12 + r] for r in range(3)]
                        for k in range(3):
                            lo[k], hi[k] = min(lo[k], w[k]), max(hi[k], w[k])
    if lo[0] == float("inf"):
        return None
    return {"min": [round(v, 4) + 0.0 for v in lo], "max": [round(v, 4) + 0.0 for v in hi]}


def keep_only_interior(glb: Path, on_log: Optional[LogFn] = None) -> int:
    """Inverse of ``glb_materials.drop_interior_geometry``: keep the primitives
    whose material is interior, drop the rest. Returns primitives kept.
    Orphaned buffers/accessors are left for ``optimize``'s prune."""
    gltf, binary = glb_materials.read_glb(glb)
    mats = gltf.get("materials", [])

    def interior(prim: dict) -> bool:
        mi = prim.get("material")
        name = mats[mi].get("name", "") if isinstance(mi, int) and mi < len(mats) else ""
        return glb_materials.is_interior_material(name)

    kept, remap, meshes = 0, {}, []
    for i, mesh in enumerate(gltf.get("meshes", [])):
        prims = [p for p in mesh.get("primitives", []) if interior(p)]
        if prims:
            remap[i] = len(meshes)
            meshes.append({**mesh, "primitives": prims})
            kept += len(prims)
    for node in gltf.get("nodes", []):
        if "mesh" in node:
            if node["mesh"] in remap:
                node["mesh"] = remap[node["mesh"]]
            else:
                del node["mesh"]
                node.pop("skin", None)
    gltf["meshes"] = meshes
    glb_materials.write_glb(glb, gltf, binary)
    if on_log:
        on_log("info", f"  interior: kept {kept} primitive(s)")
    return kept


class PartStore:
    """Converts + dedups item geometry into ``store_dir/<sha>.glb``."""

    def __init__(self, store_dir: Path, read: Callable[[str], bytes], exists: Callable[[str], bool],
                 converter: Path, optimize: OptimizeFn, work_dir: Path,
                 on_log: LogFn = lambda lvl, m: None, simplify_error: float = 0.002,
                 keep_work: bool = False) -> None:
        self.dir = store_dir.resolve()
        self.dir.mkdir(parents=True, exist_ok=True)
        self.read, self.exists = read, exists
        self.converter = converter.resolve()
        self.optimize = optimize
        self.work = work_dir.resolve()
        self.log = on_log
        self.simplify_error = simplify_error
        self.keep_work = keep_work
        self.index_path = self.dir / "index.json"
        try:
            idx = json.loads(self.index_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 — missing/corrupt index = cold cache
            idx = {}
        self.index: Dict[str, dict] = idx if idx.get("_format") == PART_FORMAT else {}
        self.index["_format"] = PART_FORMAT
        self.hits = self.misses = 0

    def save_index(self) -> None:
        self.index_path.write_text(json.dumps(self.index, indent=1, sort_keys=True), encoding="utf-8")

    def path_of(self, sha: str) -> Path:
        return self.dir / f"{sha}.glb"

    def export(self, geometry_path: str, material_path: Optional[str] = None) -> PartRef:
        """Part for one geometry path; cached by path, deduped by content."""
        key = geometry_path.lower()
        row = self.index.get(key)
        if isinstance(row, dict) and (row.get("sha256") is None
                                      or self.path_of(row["sha256"]).exists()):
            self.hits += 1
            return PartRef(sha256=row.get("sha256"), bytes=row.get("bytes", 0),
                           geometry_path=geometry_path, bounds=row.get("bounds"),
                           error=row.get("error"), cached=True)
        self.misses += 1
        try:
            ref = self._build(geometry_path, material_path)
        except Exception as exc:  # noqa: BLE001 — a part failure never costs the package
            ref = PartRef(sha256=None, geometry_path=geometry_path,
                          error=f"{type(exc).__name__}: {exc}"[:300])
            self.log("warn", f"  part {geometry_path}: {ref.error}")
        self.index[key] = {"sha256": ref.sha256, "bytes": ref.bytes,
                           "bounds": ref.bounds, "error": ref.error}
        return ref

    # ---- conversion ------------------------------------------------------
    def convert_raw(self, geometry_path: str, material_path: Optional[str], scratch: Path) -> Path:
        """P4K mesh (+ companion data + optional .mtl) -> raw, un-rigged glb."""
        from ..hull3d import _safe_join
        mesh = _safe_join(scratch, geometry_path)
        mesh.parent.mkdir(parents=True, exist_ok=True)
        mesh.write_bytes(self.read(geometry_path))
        companion = geometry_path + "m"  # .cgam / .cgfm
        if self.exists(companion):
            _safe_join(scratch, companion).write_bytes(self.read(companion))
        cmd = [str(self.converter), mesh.name, "-glb", "-objectdir", str(scratch / "Data"),
               "-loglevel", "Error"]
        if material_path and self.exists(material_path):
            mtl = _safe_join(scratch, material_path)
            mtl.parent.mkdir(parents=True, exist_ok=True)
            mtl.write_bytes(self.read(material_path))
            import os
            cmd += ["-mtl", os.path.relpath(mtl, mesh.parent).replace("\\", "/")]
        produced = mesh.with_suffix(".glb")
        produced.unlink(missing_ok=True)
        r = subprocess.run(cmd, cwd=str(mesh.parent), capture_output=True, timeout=600)
        if not produced.exists() or produced.stat().st_size < 256:
            raise RuntimeError(f"cgf-converter produced no glb (rc={r.returncode})")
        gltf, binary = glb_materials.read_glb(produced)
        if glb_materials.strip_noop_skins(gltf, binary, self.log)["stripped"]:
            glb_materials.write_glb(produced, gltf, binary)
        return produced

    def _build(self, geometry_path: str, material_path: Optional[str]) -> PartRef:
        scratch = self.work / f"part_{hashlib.sha1(geometry_path.lower().encode()).hexdigest()[:12]}"
        shutil.rmtree(scratch, ignore_errors=True)
        try:
            raw = self.convert_raw(geometry_path, material_path, scratch)
            glb_materials.strip_to_geometry(raw, self.log)
            out = scratch / "opt.glb"
            self.optimize(raw, out, 256, self.simplify_error)
            gltf, _ = glb_materials.read_glb(out)
            if not any(m.get("primitives") for m in gltf.get("meshes", [])):
                return PartRef(sha256=None, geometry_path=geometry_path, error="no geometry")
            sha = sha256_file(out)
            dest = self.path_of(sha)
            if not dest.exists():
                shutil.move(str(out), dest)
            return PartRef(sha256=sha, bytes=dest.stat().st_size, geometry_path=geometry_path,
                           bounds=glb_bounds(dest))
        finally:
            if not self.keep_work:
                shutil.rmtree(scratch, ignore_errors=True)


def unique_bytes(refs: List[PartRef]) -> int:
    seen: Dict[str, int] = {}
    for r in refs:
        if r.sha256:
            seen[r.sha256] = r.bytes
    return sum(seen.values())
