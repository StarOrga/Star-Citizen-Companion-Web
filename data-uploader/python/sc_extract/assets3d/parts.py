"""Stage 2 — EXPORT: one shared, content-addressed, geometry-only GLB per
distinct item geometry.

A part is keyed by its P4K geometry path (``Data/Objects/.../gun.cga``) and
stored as ``<store>/<sha256>.glb``: one Behring gun model is converted once
and reused by every ship (and every run, via ``index.json``). Every index row
also carries ``src`` — the content key of the P4K files the conversion read
plus the pipeline tag (`build_cache`) — and is only reused while it still
matches, which is what lets a new patch start from the previous patch's store
(`build_cache.seed_from_previous`) without ever serving a changed mesh. The GLB origin
is the item's own model origin, which in CryEngine is its attach point, so a
manifest placement transform positions it directly.

Same publication policy as the hull: geometry only — no CIG texture ever
leaves the P4K (``glb_materials.strip_to_geometry`` raises rather than ship a
textured part). Then ``gltf-transform optimize`` (simplify + meshopt).
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from .. import glb_materials, stage_timing

LogFn = Callable[[str, str], None]
# (in_glb, out_glb, texture_size, simplify_error) -> None; raises on failure.
OptimizeFn = Callable[[Path, Path, int, float], None]

# Bump when the part pipeline changes output; older index rows are rebuilt.
# v2: rows carry `src` (content key) — v1 rows had none and are rebuilt once.
PART_FORMAT = "part-geometry-v2"


@dataclass
class PartRef:
    sha256: Optional[str]          # None = this geometry yields no part
    bytes: int = 0
    geometry_path: str = ""
    bounds: Optional[dict] = None
    error: Optional[str] = None
    cached: bool = False


def _mtl_key(material_path: Optional[str]) -> Optional[str]:
    return material_path.replace("\\", "/").lower() if material_path else None


def publish_blob(src: Path, dest: Path) -> None:
    """Move a content-addressed file into place. Parallel workers may publish
    the same hash at once; the content is identical by construction, so the
    loser of the race simply drops its copy."""
    if dest.exists():
        src.unlink(missing_ok=True)
        return
    try:
        os.replace(src, dest)
    except OSError:
        if not dest.exists():
            raise
        src.unlink(missing_ok=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


_NORM_DIV = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}


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
            # meshopt output is KHR_mesh_quantization: positions are normalized
            # integers whose min/max are stored RAW (e.g. 32767); the node's
            # dequantize scale expects the normalized value. Skipping this put
            # the manifest bounds at ~±300 000 instead of metres.
            div = _NORM_DIV.get(acc.get("componentType")) if acc.get("normalized") else None
            if div:
                amin = [max(v / div, -1.0) for v in amin]
                amax = [max(v / div, -1.0) for v in amax]
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
                 on_log: LogFn = lambda lvl, m: None, simplify_error: float = 0.0,
                 keep_work: bool = False, index_name: str = "index.json",
                 pipeline: str = "") -> None:
        self.dir = store_dir.resolve()
        self.dir.mkdir(parents=True, exist_ok=True)
        self.read, self.exists = read, exists
        self.converter = converter.resolve()
        self.optimize = optimize
        self.work = work_dir.resolve()
        self.log = on_log
        self.simplify_error = simplify_error
        self.keep_work = keep_work
        # Parallel workers share the store directory but each writes its OWN
        # index file (``index.w<N>.json``) — one shared file would lose rows to
        # concurrent read-modify-write. Every index file is read on start, so
        # a later run sees what all workers of the previous one built.
        self.index_path = self.dir / index_name
        self.index: Dict[str, dict] = {}
        for path in sorted(self.dir.glob("index*.json")):
            try:
                idx = json.loads(path.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001 — missing/corrupt index = cold cache
                continue
            if isinstance(idx, dict) and idx.get("_format") == PART_FORMAT:
                self.index.update(idx)
        self.index["_format"] = PART_FORMAT
        self.hits = self.misses = 0
        # Pipeline tag folded into every content key (`build_cache.pipeline_tag`).
        self.pipeline = pipeline
        self._src_memo: Dict[Tuple[str, Optional[str]], str] = {}
        # Raw converter output kept between `helpers()` and `export()` of the
        # same geometry: a parent item (turret, rack) is converted once for its
        # node tree and once more as a part otherwise.
        self._raw_cache: Dict[str, Tuple[Path, Optional[str], Path]] = {}

    def save_index(self) -> None:
        tmp = self.index_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self.index, indent=1, sort_keys=True), encoding="utf-8")
        tmp.replace(self.index_path)

    def release_raw(self) -> None:
        """Drop raw glbs `helpers()` kept for an `export()` that never came."""
        for scratch, _mtl, _raw in self._raw_cache.values():
            if not self.keep_work:
                shutil.rmtree(scratch, ignore_errors=True)
        self._raw_cache.clear()

    def path_of(self, sha: str) -> Path:
        return self.dir / f"{sha}.glb"

    def src_key(self, paths: Sequence[Optional[str]], extra: str = "") -> str:
        """Content key of the P4K files one conversion reads (memoized per run)."""
        from ..build_cache import content_key
        memo = ("|".join((p or "").lower() for p in paths), extra)
        key = self._src_memo.get(memo)
        if key is None:
            key = content_key(self.read, self.exists, paths, self.pipeline, extra)
            self._src_memo[memo] = key
        return key

    def part_src(self, geometry_path: str, material_path: Optional[str] = None) -> str:
        return self.src_key([geometry_path, geometry_path + "m", material_path])

    def _hit(self, row: object, src: str) -> bool:
        """A stored row is reusable: same inputs, and its blob is still there."""
        return (isinstance(row, dict) and row.get("src") == src
                and (row.get("sha256") is None or self.path_of(row["sha256"]).exists()))

    def cached_blob(self, name: str, src: str, blob_dir: Path) -> Tuple[bool, Optional[Path]]:
        """(hit, path) for a named content-addressed output outside the part
        store (the interior layer). A hit with ``None`` = "known to be empty"."""
        row = self.index.get("blob:" + name.lower())
        if not (isinstance(row, dict) and row.get("src") == src):
            return False, None
        sha = row.get("sha256")
        if sha is None:
            return True, None
        path = blob_dir / f"{sha}.glb"
        return (True, path) if path.exists() else (False, None)

    def remember_blob(self, name: str, src: str, path: Optional[Path]) -> None:
        self.index["blob:" + name.lower()] = {
            "src": src, "sha256": path.stem if path is not None else None}

    def export(self, geometry_path: str, material_path: Optional[str] = None) -> PartRef:
        """Part for one geometry path; cached by path, deduped by content."""
        key = geometry_path.lower()
        src = self.part_src(geometry_path, material_path)
        row = self.index.get(key)
        if self._hit(row, src):
            assert isinstance(row, dict)
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
                           "bounds": ref.bounds, "error": ref.error, "src": src}
        return ref

    def helpers(self, geometry_path: str, material_path: Optional[str] = None) -> Dict[str, dict]:
        """Named node transforms of a mesh as the CONVERTER places them (glTF
        space) — the same tree the published GLBs come from, so a placement
        built on them coincides with the GLB by construction. Cached in
        ``index.json``; ``export`` fills the cache for free from its own run.

        With ``material_path`` the conversion is the one `export` would run,
        so its raw output is kept for that `export` instead of converting the
        same mesh twice (`release_raw` drops what no export claimed)."""
        key = "helpers:" + geometry_path.lower()
        row = self.index.get(key)
        if isinstance(row, dict) and self.index.get("helpers-src:" + geometry_path.lower()) \
                == self.helpers_src(geometry_path):
            return row
        part_row = self.index.get(geometry_path.lower())
        reuse = material_path is not None and not self._hit(
            part_row, self.part_src(geometry_path, material_path))
        scratch = self._scratch("part" if reuse else "nodes", geometry_path)
        shutil.rmtree(scratch, ignore_errors=True)
        kept = False
        try:
            raw = self.convert_raw(geometry_path, material_path if reuse else None, scratch)
            row = glb_node_transforms(glb_materials.read_glb(raw)[0])
            if reuse:
                self._raw_cache[geometry_path.lower()] = (scratch, _mtl_key(material_path), raw)
                kept = True
        except Exception as exc:  # noqa: BLE001 — no nodes = nothing placeable here
            self.log("warn", f"  nodes {geometry_path}: {type(exc).__name__}: {exc}")
            row = {}
        finally:
            if not kept and not self.keep_work:
                shutil.rmtree(scratch, ignore_errors=True)
        self.set_helpers(geometry_path, row)
        return row

    def helpers_src(self, geometry_path: str) -> str:
        """Node transforms depend on the mesh alone, not on a material."""
        return self.src_key([geometry_path, geometry_path + "m"])

    def set_helpers(self, geometry_path: str, nodes: Dict[str, dict]) -> None:
        """Store a mesh's node tree with the content key it was read from."""
        self.index["helpers:" + geometry_path.lower()] = nodes
        self.index["helpers-src:" + geometry_path.lower()] = self.helpers_src(geometry_path)

    def _scratch(self, prefix: str, geometry_path: str) -> Path:
        return self.work / f"{prefix}_{hashlib.sha1(geometry_path.lower().encode()).hexdigest()[:12]}"

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
        with stage_timing.timed("convert"):
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
        paths: List[Optional[str]] = []
        for geo, mtl, _m in sources:
            paths += [geo, geo + "m", mtl]
        src = self.src_key([*paths, *extra_files],
                           extra=repr([m for _g, _t, m in sources]))
        if self._hit(row, src):
            assert isinstance(row, dict)
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
                         "bounds": ref.bounds, "error": ref.error, "src": src}
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
        publish_blob(out, dest)
        return PartRef(sha256=sha, bytes=dest.stat().st_size, geometry_path=geometry_path,
                       bounds=glb_bounds(dest))

    def _build(self, geometry_path: str, material_path: Optional[str]) -> PartRef:
        cached = self._raw_cache.pop(geometry_path.lower(), None)
        if cached and cached[1] == _mtl_key(material_path) and cached[2].exists():
            scratch, _mtl, raw = cached
            try:
                return self._publish(raw, scratch, geometry_path)
            finally:
                if not self.keep_work:
                    shutil.rmtree(scratch, ignore_errors=True)
        if cached and not self.keep_work:
            shutil.rmtree(cached[0], ignore_errors=True)
        scratch = self._scratch("part", geometry_path)
        shutil.rmtree(scratch, ignore_errors=True)
        try:
            raw = self.convert_raw(geometry_path, material_path, scratch)
            if self.index.get("helpers-src:" + geometry_path.lower()) != self.helpers_src(geometry_path):
                self.set_helpers(geometry_path, glb_node_transforms(glb_materials.read_glb(raw)[0]))
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
