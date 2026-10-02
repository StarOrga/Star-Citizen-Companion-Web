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
from typing import Callable, Dict, List, Optional, Sequence, Tuple

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


def glb_node_transforms(gltf: dict) -> Dict[str, dict]:
    """``name -> {position, rotation}`` of every named node, world space of the
    GLB (glTF axes, metres). First node wins on a duplicate name. Scale is
    divided out so the rotation stays a unit quaternion."""
    from .transforms import to_pos_quat
    worlds = glb_materials._global_matrices(gltf)  # column-major 4x4
    out: Dict[str, dict] = {}
    for i, node in enumerate(gltf.get("nodes", [])):
        name = node.get("name")
        if not isinstance(name, str) or not name or name in out:
            continue
        c = worlds[i]
        cols = [c[0:3], c[4:8][:3], c[8:11]]
        norms = [max(sum(v * v for v in col) ** 0.5, 1e-12) for col in cols]
        m = [[cols[k][r] / norms[k] for k in range(3)] + [c[12 + r]] for r in range(3)]
        m.append([0.0, 0.0, 0.0, 1.0])
        pos, quat = to_pos_quat(m)
        if all(abs(v) < 1e6 for v in pos):
            out[name] = {"position": [round(v, 5) + 0.0 for v in pos],
                         "rotation": [round(v, 7) + 0.0 for v in quat]}
    return out


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

    def helpers(self, geometry_path: str) -> Dict[str, dict]:
        """Named node transforms of a mesh as the CONVERTER places them (glTF
        space) — the same tree the published GLBs come from, so a placement
        built on them coincides with the GLB by construction. Cached in
        ``index.json``; ``export`` fills the cache for free from its own run."""
        key = "helpers:" + geometry_path.lower()
        row = self.index.get(key)
        if isinstance(row, dict):
            return row
        scratch = self.work / f"nodes_{hashlib.sha1(key.encode()).hexdigest()[:12]}"
        shutil.rmtree(scratch, ignore_errors=True)
        try:
            raw = self.convert_raw(geometry_path, None, scratch)
            row = glb_node_transforms(glb_materials.read_glb(raw)[0])
        except Exception as exc:  # noqa: BLE001 — no nodes = nothing placeable here
            self.log("warn", f"  nodes {geometry_path}: {type(exc).__name__}: {exc}")
            row = {}
        finally:
            if not self.keep_work:
                shutil.rmtree(scratch, ignore_errors=True)
        self.index[key] = row
        return row

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

    def export_composite(self, key: str,
                         sources: Sequence[Tuple[str, Optional[str], Optional[list]]],
                         extra_files: Sequence[str] = ()) -> PartRef:
        """One part merged from several meshes — an FPS weapon body is a
        ``.cdf`` of skins + bone-attached ``.cgf`` s. ``sources`` =
        ``(geometry_path, material_path, matrix)``; ``matrix`` is a row-major
        glTF-space 4x4 (``None`` = identity). ``extra_files`` (e.g. the
        skeleton ``.chr``) are written next to every mesh before conversion.
        Cached under ``key`` (normally the ``.cdf`` path) exactly like
        :meth:`export`, deduped by content into the same store."""
        k = key.lower()
        row = self.index.get(k)
        if isinstance(row, dict) and (row.get("sha256") is None
                                      or self.path_of(row["sha256"]).exists()):
            self.hits += 1
            return PartRef(sha256=row.get("sha256"), bytes=row.get("bytes", 0),
                           geometry_path=key, bounds=row.get("bounds"),
                           error=row.get("error"), cached=True)
        self.misses += 1
        scratch = self.work / f"comp_{hashlib.sha1(k.encode()).hexdigest()[:12]}"
        shutil.rmtree(scratch, ignore_errors=True)
        try:
            from ..hull3d import _safe_join
            raws = []
            for i, (geo, mtl, matrix) in enumerate(sources):
                sub = scratch / f"s{i}"
                for extra in extra_files:
                    if self.exists(extra):
                        dst = _safe_join(sub, extra)
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        dst.write_bytes(self.read(extra))
                try:
                    raws.append((self.convert_raw(geo, mtl, sub), matrix))
                except Exception as exc:  # noqa: BLE001 — one missing piece != no body
                    self.log("warn", f"  part {key}: {geo}: {type(exc).__name__}: {exc}")
            if not raws:
                raise RuntimeError("no source converted")
            gltf, binary = merge_glbs(raws)
            raw = scratch / "merged.glb"
            glb_materials.write_glb(raw, gltf, binary)
            ref = self._publish(raw, scratch, key)
        except Exception as exc:  # noqa: BLE001 — a part failure never costs the package
            ref = PartRef(sha256=None, geometry_path=key, error=f"{type(exc).__name__}: {exc}"[:300])
            self.log("warn", f"  part {key}: {ref.error}")
        finally:
            if not self.keep_work:
                shutil.rmtree(scratch, ignore_errors=True)
        self.index[k] = {"sha256": ref.sha256, "bytes": ref.bytes,
                         "bounds": ref.bounds, "error": ref.error}
        return ref

    def _publish(self, raw: Path, scratch: Path, geometry_path: str) -> PartRef:
        """Raw converter GLB -> geometry-only, optimized, content-addressed part."""
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

    def _build(self, geometry_path: str, material_path: Optional[str]) -> PartRef:
        scratch = self.work / f"part_{hashlib.sha1(geometry_path.lower().encode()).hexdigest()[:12]}"
        shutil.rmtree(scratch, ignore_errors=True)
        try:
            raw = self.convert_raw(geometry_path, material_path, scratch)
            self.index.setdefault("helpers:" + geometry_path.lower(),
                                  glb_node_transforms(glb_materials.read_glb(raw)[0]))
            return self._publish(raw, scratch, geometry_path)
        finally:
            if not self.keep_work:
                shutil.rmtree(scratch, ignore_errors=True)


def merge_glbs(sources: Sequence[Tuple[Path, Optional[list]]]) -> Tuple[dict, bytes]:
    """Merge converter GLBs into one document. Each source's scene roots go
    under a new node carrying its ``matrix`` (row-major glTF 4x4, ``None`` =
    identity). Textures, images, skins, morph targets and animations are
    dropped — the part is geometry-only anyway (``strip_to_geometry`` runs
    afterwards)."""
    out: dict = {"asset": {"version": "2.0", "generator": "sc_extract.assets3d.merge_glbs"},
                 "buffers": [{"byteLength": 0}], "bufferViews": [], "accessors": [],
                 "meshes": [], "materials": [], "nodes": [], "scenes": [{"nodes": []}],
                 "scene": 0}
    blob = bytearray()
    for path, matrix in sources:
        gltf, binary = glb_materials.read_glb(Path(path))
        bv0, acc0, mesh0, mat0, node0 = (len(out[k]) for k in
                                         ("bufferViews", "accessors", "meshes", "materials", "nodes"))
        blob += b"\0" * (-len(blob) % 8)
        base = len(blob)
        blob += binary
        for bv in gltf.get("bufferViews", []):
            out["bufferViews"].append({**bv, "buffer": 0, "byteOffset": base + bv.get("byteOffset", 0)})
        for acc in gltf.get("accessors", []):
            a = {k: v for k, v in acc.items() if k != "sparse"}
            if "bufferView" in a:
                a["bufferView"] += bv0
            out["accessors"].append(a)
        for mat in gltf.get("materials", []):
            m = {k: v for k, v in mat.items() if not k.endswith("Texture") and k != "extensions"}
            pbr = {k: v for k, v in (mat.get("pbrMetallicRoughness") or {}).items()
                   if not k.endswith("Texture")}
            m.pop("pbrMetallicRoughness", None)
            if pbr:
                m["pbrMetallicRoughness"] = pbr
            out["materials"].append(m)
        for mesh in gltf.get("meshes", []):
            prims = []
            for prim in mesh.get("primitives", []):
                pr = {k: v for k, v in prim.items() if k not in ("targets", "extensions")}
                pr["attributes"] = {k: v + acc0 for k, v in prim.get("attributes", {}).items()
                                    if not k.startswith(("JOINTS_", "WEIGHTS_"))}
                if "indices" in pr:
                    pr["indices"] += acc0
                if "material" in pr:
                    pr["material"] += mat0
                prims.append(pr)
            out["meshes"].append({**{k: v for k, v in mesh.items() if k != "weights"},
                                  "primitives": prims})
        for node in gltf.get("nodes", []):
            n = {k: v for k, v in node.items() if k not in ("skin", "camera", "weights")}
            if "mesh" in n:
                n["mesh"] += mesh0
            if "children" in n:
                n["children"] = [c + node0 for c in n["children"]]
            out["nodes"].append(n)
        scenes = gltf.get("scenes") or [{"nodes": list(range(len(gltf.get("nodes", []))))}]
        roots = [r + node0 for r in scenes[gltf.get("scene", 0)].get("nodes", [])]
        wrapper: dict = {"name": Path(path).stem, "children": roots}
        if matrix is not None:
            wrapper["matrix"] = [float(matrix[r][c]) for c in range(4) for r in range(4)]
        out["nodes"].append(wrapper)
        out["scenes"][0]["nodes"].append(len(out["nodes"]) - 1)
    blob += b"\0" * (-len(blob) % 4)
    out["buffers"][0]["byteLength"] = len(blob)
    if not out["materials"]:
        out.pop("materials")
    return out, bytes(blob)


def unique_bytes(refs: List[PartRef]) -> int:
    seen: Dict[str, int] = {}
    for r in refs:
        if r.sha256:
            seen[r.sha256] = r.bytes
    return sum(seen.values())
