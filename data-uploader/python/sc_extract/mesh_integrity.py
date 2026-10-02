"""Hole/gap metrics for an exported hull glb.

A hull can come out of the pipeline with see-through gaps in its outer skin
(missing panels, torn seams) without any step raising. This module measures
that, so the export can refuse such a hull instead of uploading it:

* ``mesh_stats`` — triangle count, surface area, open boundary edges and
  non-manifold edges after welding coincident vertices. CryEngine hulls are
  built from overlapping panels and are never watertight, so the absolute
  number means little; the ratio against the raw converter output is the
  signal (simplification tearing a seam shows up as new boundary edges).
* ``coverage_loss`` — the gate metric. The reference (raw, unsimplified,
  unstripped mesh minus never-visible proxies) and the candidate are splatted
  into first-hit depth maps from a fixed set of view directions around the
  ship. A pixel where the reference shows a surface and the candidate shows
  nothing, or shows a surface clearly *behind* it, is a hole in the outer
  skin: exactly what a viewer sees as a gap. Interior geometry that was
  stripped legitimately never shows up, because the exterior covers it in
  both maps.

Everything is plain numpy; no renderer, no GPU. Meshopt-compressed glbs
(``EXT_meshopt_compression``) cannot be read — measure the uncompressed
optimize output instead (`hull3d` does).
"""
from __future__ import annotations

import math
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np

from . import glb_materials

MaterialFilter = Callable[[str], bool]

# Gate defaults. Calibrated on the LIVE fighters (see HULL3D.md "Hull
# integrity"): a clean export stays far below 0.5 %, the gappy hulls of the
# feedback screenshot were well above 2 %.
DEFAULT_MAX_HOLE_RATIO = 0.01
DEFAULT_RESOLUTION = 384
# A candidate surface may sit this far (fraction of the bbox diagonal) behind
# the reference before the pixel counts as a hole: simplification moves
# vertices by up to its error budget, a missing panel exposes the interior.
DEFAULT_DEPTH_TOL = 0.01
SAMPLES_PER_PIXEL = 12.0
MAX_SAMPLES = 6_000_000

_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
_DTYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16,
           5125: np.uint32, 5126: np.float32}
_NORM_DIV = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}


class HullIntegrityError(RuntimeError):
    """The exported hull lost visible exterior surface vs. the raw mesh."""


@dataclass
class MeshStats:
    triangles: int
    area: float
    boundary_edges: int
    nonmanifold_edges: int
    bbox_min: Tuple[float, float, float]
    bbox_max: Tuple[float, float, float]

    def as_dict(self) -> dict:
        return {"triangles": self.triangles, "area": round(self.area, 3),
                "boundary_edges": self.boundary_edges,
                "nonmanifold_edges": self.nonmanifold_edges}


@dataclass
class CoverageReport:
    hole_ratio: float                     # eroded hole pixels / reference pixels
    hole_pixels: int
    reference_pixels: int
    per_view: List[float] = field(default_factory=list)

    @property
    def worst_view(self) -> float:
        return max(self.per_view) if self.per_view else 0.0


# ---- glb -> world-space triangles -------------------------------------------
def _read_accessor(gltf: dict, binary: bytes, index: int) -> np.ndarray:
    acc = gltf["accessors"][index]
    if "sparse" in acc:
        raise ValueError("sparse accessors are not supported")
    ncomp = _COMPONENTS[acc["type"]]
    ctype = acc["componentType"]
    dtype = np.dtype(_DTYPES[ctype]).newbyteorder("<")
    count = acc["count"]
    if "bufferView" not in acc:
        return np.zeros((count, ncomp), dtype=np.float64)
    view = gltf["bufferViews"][acc["bufferView"]]
    if "EXT_meshopt_compression" in (view.get("extensions") or {}):
        raise ValueError("meshopt-compressed glb — measure the uncompressed output")
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    item = dtype.itemsize * ncomp
    stride = view.get("byteStride") or item
    if stride == item:
        arr = np.frombuffer(binary, dtype=dtype, count=count * ncomp, offset=base)
        arr = arr.reshape(count, ncomp)
    else:
        raw = np.frombuffer(binary, dtype=np.uint8, count=stride * (count - 1) + item,
                            offset=base)
        rows = np.lib.stride_tricks.as_strided(raw, shape=(count, item), strides=(stride, 1))
        arr = np.ascontiguousarray(rows).view(dtype).reshape(count, ncomp)
    out = arr.astype(np.float64)
    if acc.get("normalized") and ctype in _NORM_DIV:
        out = np.maximum(out / _NORM_DIV[ctype], -1.0)
    return out


def _quat_matrices(q: np.ndarray) -> np.ndarray:
    x, y, z, w = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    m = np.empty((len(q), 3, 3))
    m[:, 0, 0] = 1 - 2 * (y * y + z * z); m[:, 0, 1] = 2 * (x * y - z * w); m[:, 0, 2] = 2 * (x * z + y * w)
    m[:, 1, 0] = 2 * (x * y + z * w); m[:, 1, 1] = 1 - 2 * (x * x + z * z); m[:, 1, 2] = 2 * (y * z - x * w)
    m[:, 2, 0] = 2 * (x * z - y * w); m[:, 2, 1] = 2 * (y * z + x * w); m[:, 2, 2] = 1 - 2 * (x * x + y * y)
    return m


def _instance_matrices(gltf: dict, binary: bytes, node: dict) -> Optional[np.ndarray]:
    ext = (node.get("extensions") or {}).get("EXT_mesh_gpu_instancing")
    if not ext:
        return None
    attrs = ext.get("attributes", {})
    cols = [_read_accessor(gltf, binary, attrs[k]) for k in ("TRANSLATION", "ROTATION", "SCALE")
            if k in attrs]
    n = len(cols[0]) if cols else 0
    t = _read_accessor(gltf, binary, attrs["TRANSLATION"]) if "TRANSLATION" in attrs else np.zeros((n, 3))
    r = _read_accessor(gltf, binary, attrs["ROTATION"]) if "ROTATION" in attrs else np.tile([0, 0, 0, 1.0], (n, 1))
    s = _read_accessor(gltf, binary, attrs["SCALE"]) if "SCALE" in attrs else np.ones((n, 3))
    m = np.tile(np.eye(4), (n, 1, 1))
    m[:, :3, :3] = _quat_matrices(r) * s[:, None, :]
    m[:, :3, 3] = t
    return m


def _prim_indices(gltf: dict, binary: bytes, prim: dict, nverts: int) -> Optional[np.ndarray]:
    mode = prim.get("mode", 4)
    idx = (_read_accessor(gltf, binary, prim["indices"])[:, 0].astype(np.int64)
           if "indices" in prim else np.arange(nverts, dtype=np.int64))
    if mode == 4:
        return idx[: len(idx) // 3 * 3].reshape(-1, 3)
    if mode == 5:  # strip
        if len(idx) < 3:
            return None
        tri = np.stack([idx[:-2], idx[1:-1], idx[2:]], axis=1)
        odd = np.arange(len(tri)) % 2 == 1
        tri[odd] = tri[odd][:, [1, 0, 2]]
        return tri
    if mode == 6:  # fan
        if len(idx) < 3:
            return None
        return np.stack([np.full(len(idx) - 2, idx[0]), idx[1:-1], idx[2:]], axis=1)
    return None  # points / lines carry no surface


def load_triangles(glb: Path, include_material: Optional[MaterialFilter] = None,
                   with_materials: bool = False):
    """All triangles of the active scene in world space, shape ``(N, 3, 3)``.

    ``include_material(name)`` filters primitives by material name (a primitive
    without a material is passed ``""``). Degenerate triangles are kept — they
    have zero area and never splat. A node whose world transform mirrors
    (negative determinant) gets its winding reversed, as glTF 2.0 §3.7.4
    requires of a renderer — so the winding here is the one a viewer culls by.
    ``with_materials=True`` also returns the material index per triangle (-1
    for a primitive without one).
    """
    gltf, binary = glb_materials.read_glb(Path(glb))
    worlds = glb_materials._global_matrices(gltf)
    mats = gltf.get("materials", [])
    nodes = gltf.get("nodes", [])
    scenes = gltf.get("scenes") or [{}]
    reachable, stack = set(), list(scenes[gltf.get("scene", 0)].get("nodes", []))
    while stack:
        i = stack.pop()
        if i in reachable or not isinstance(i, int) or i >= len(nodes):
            continue
        reachable.add(i)
        stack.extend(nodes[i].get("children", []))

    parts: List[np.ndarray] = []
    owners: List[np.ndarray] = []
    for ni in sorted(reachable):
        node = nodes[ni]
        if "mesh" not in node:
            continue
        world = np.array(worlds[ni], dtype=np.float64).reshape(4, 4).T  # column-major
        inst = _instance_matrices(gltf, binary, node)
        xforms = [world] if inst is None else [world @ m for m in inst]
        for prim in gltf["meshes"][node["mesh"]].get("primitives", []):
            name = mats[prim["material"]].get("name", "") if "material" in prim else ""
            if include_material is not None and not include_material(name):
                continue
            pos_i = prim.get("attributes", {}).get("POSITION")
            if pos_i is None:
                continue
            pos = _read_accessor(gltf, binary, pos_i)[:, :3]
            tri = _prim_indices(gltf, binary, prim, len(pos))
            if tri is None or not len(tri):
                continue
            tri = tri[(tri < len(pos)).all(axis=1)]
            homo = np.c_[pos, np.ones(len(pos))]
            for xf in xforms:
                wp = (homo @ xf.T)[:, :3]
                t = tri[:, [0, 2, 1]] if np.linalg.det(xf[:3, :3]) < 0 else tri
                parts.append(wp[t])
                owners.append(np.full(len(t), prim.get("material", -1), dtype=np.int64))
    tris = np.concatenate(parts) if parts else np.zeros((0, 3, 3))
    if with_materials:
        return tris, (np.concatenate(owners) if owners else np.zeros(0, dtype=np.int64))
    return tris


# ---- topology ---------------------------------------------------------------
def mesh_stats(tris: np.ndarray, weld: float = 1e-4) -> MeshStats:
    """Counts after welding vertices closer than ``weld`` (metres)."""
    if not len(tris):
        return MeshStats(0, 0.0, 0, 0, (0.0,) * 3, (0.0,) * 3)
    cross = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    areas = 0.5 * np.linalg.norm(cross, axis=1)
    keep = areas > 0
    t = tris[keep]
    keys = np.round(t.reshape(-1, 3) / weld).astype(np.int64)
    _, vid = np.unique(keys, axis=0, return_inverse=True)
    vid = vid.reshape(-1, 3)
    edges = np.concatenate([vid[:, [0, 1]], vid[:, [1, 2]], vid[:, [2, 0]]])
    edges.sort(axis=1)
    edges = edges[edges[:, 0] != edges[:, 1]]
    _, counts = np.unique(edges, axis=0, return_counts=True)
    flat = tris.reshape(-1, 3)
    return MeshStats(
        triangles=int(len(t)), area=float(areas.sum()),
        boundary_edges=int((counts == 1).sum()),
        nonmanifold_edges=int((counts > 2).sum()),
        bbox_min=tuple(float(v) for v in flat.min(axis=0)),
        bbox_max=tuple(float(v) for v in flat.max(axis=0)))


# ---- coverage ---------------------------------------------------------------
def view_directions() -> np.ndarray:
    """6 axis + 8 diagonal + 12 edge-midpoint directions (unit vectors)."""
    dirs = []
    for x in (-1, 0, 1):
        for y in (-1, 0, 1):
            for z in (-1, 0, 1):
                if (x, y, z) != (0, 0, 0):
                    dirs.append((x, y, z))
    d = np.array(dirs, dtype=np.float64)
    return d / np.linalg.norm(d, axis=1, keepdims=True)


def _basis(d: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    helper = np.array([0.0, 0.0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(helper, d); u /= np.linalg.norm(u)
    return u, np.cross(d, u)


def _sample(tris: np.ndarray, density: float, rng: np.random.Generator) -> np.ndarray:
    if not len(tris):
        return np.zeros((0, 3))
    areas = 0.5 * np.linalg.norm(np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]), axis=1)
    expect = areas * density
    n = np.floor(expect).astype(np.int64)
    n += rng.random(len(n)) < (expect - n)
    # every triangle that covers a meaningful area gets its centroid at least
    owner = np.repeat(np.arange(len(tris)), n)
    r1, r2 = rng.random(len(owner)), rng.random(len(owner))
    flip = r1 + r2 > 1
    r1[flip], r2[flip] = 1 - r1[flip], 1 - r2[flip]
    t = tris[owner]
    pts = t[:, 0] + r1[:, None] * (t[:, 1] - t[:, 0]) + r2[:, None] * (t[:, 2] - t[:, 0])
    cent = tris.mean(axis=1)
    return np.concatenate([pts, cent])


def _depth_map(pts: np.ndarray, d, u, v, origin, pix: float, res: int) -> np.ndarray:
    depth = np.full(res * res, np.inf)
    if not len(pts):
        return depth.reshape(res, res)
    rel = pts - origin
    x = np.floor(rel @ u / pix).astype(np.int64)
    y = np.floor(rel @ v / pix).astype(np.int64)
    ok = (x >= 0) & (x < res) & (y >= 0) & (y < res)
    np.minimum.at(depth, (y[ok] * res + x[ok]), rel[ok] @ d)
    return depth.reshape(res, res)


def _erode(mask: np.ndarray) -> np.ndarray:
    """Keep a pixel only if it and its 4 neighbours are set."""
    m = mask.copy()
    m[1:, :] &= mask[:-1, :]; m[:-1, :] &= mask[1:, :]
    m[:, 1:] &= mask[:, :-1]; m[:, :-1] &= mask[:, 1:]
    m[0, :] = m[-1, :] = False; m[:, 0] = m[:, -1] = False
    return m


def coverage_loss(reference: np.ndarray, candidate: np.ndarray,
                  resolution: int = DEFAULT_RESOLUTION,
                  depth_tol: float = DEFAULT_DEPTH_TOL,
                  directions: Optional[np.ndarray] = None,
                  seed: int = 0) -> CoverageReport:
    """Share of the reference's visible exterior that the candidate lost."""
    if not len(reference):
        return CoverageReport(0.0, 0, 0, [])
    flat = reference.reshape(-1, 3)
    lo, hi = flat.min(axis=0), flat.max(axis=0)
    center, diag = (lo + hi) / 2, float(np.linalg.norm(hi - lo)) or 1.0
    pix = diag / resolution
    ref_area = 0.5 * np.linalg.norm(np.cross(reference[:, 1] - reference[:, 0],
                                             reference[:, 2] - reference[:, 0]), axis=1).sum()
    cand_area = 0.5 * np.linalg.norm(np.cross(candidate[:, 1] - candidate[:, 0],
                                              candidate[:, 2] - candidate[:, 0]), axis=1).sum() \
        if len(candidate) else 0.0
    density = SAMPLES_PER_PIXEL / (pix * pix)
    biggest = max(ref_area, cand_area, 1e-9)
    if biggest * density > MAX_SAMPLES:
        density = MAX_SAMPLES / biggest
    rng = np.random.default_rng(seed)
    ref_pts = _sample(reference, density, rng)
    cand_pts = _sample(candidate, density, rng)
    tol = depth_tol * diag
    holes = refs = 0
    per_view: List[float] = []
    for d in (view_directions() if directions is None else directions):
        u, v = _basis(d)
        origin = center - (u + v) * diag / 2 - d * diag
        rd = _depth_map(ref_pts, d, u, v, origin, pix, resolution)
        cd = _depth_map(cand_pts, d, u, v, origin, pix, resolution)
        ref_hit = np.isfinite(rd)
        # Only pixels inside the reference silhouette count: simplification
        # moves the outline by a pixel, a crack or missing panel sits inside it.
        hole = _erode(ref_hit) & (cd > rd + tol)
        h, r = int(hole.sum()), int(ref_hit.sum())
        holes += h; refs += r
        per_view.append(h / r if r else 0.0)
    return CoverageReport(holes / refs if refs else 0.0, holes, refs, per_view)


def _sample_owned(tris: np.ndarray, density: float, rng: np.random.Generator):
    areas = 0.5 * np.linalg.norm(np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]), axis=1)
    expect = areas * density
    n = np.floor(expect).astype(np.int64)
    n += rng.random(len(n)) < (expect - n)
    owner = np.concatenate([np.repeat(np.arange(len(tris)), n), np.arange(len(tris))])
    r1, r2 = rng.random(len(owner)), rng.random(len(owner))
    flip = r1 + r2 > 1
    r1[flip], r2[flip] = 1 - r1[flip], 1 - r2[flip]
    r1[-len(tris):] = r2[-len(tris):] = 1 / 3  # centroids
    t = tris[owner]
    return t[:, 0] + r1[:, None] * (t[:, 1] - t[:, 0]) + r2[:, None] * (t[:, 2] - t[:, 0]), owner


def first_hits(tris: np.ndarray, resolution: int = 256, seed: int = 0,
               samples_per_pixel: float = 4.0, max_samples: int = 3_000_000):
    """Yield ``(view direction, triangle index of the first hit per covered pixel)``."""
    if not len(tris):
        return
    flat = tris.reshape(-1, 3)
    lo, hi = flat.min(axis=0), flat.max(axis=0)
    center, diag = (lo + hi) / 2, float(np.linalg.norm(hi - lo)) or 1.0
    pix = diag / resolution
    area = 0.5 * np.linalg.norm(np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]), axis=1).sum()
    density = min(samples_per_pixel / (pix * pix), max_samples / max(area, 1e-9))
    pts, owner = _sample_owned(tris, density, np.random.default_rng(seed))
    for d in view_directions():
        u, v = _basis(d)
        rel = pts - (center - (u + v) * diag / 2 - d * diag)
        x = np.floor(rel @ u / pix).astype(np.int64)
        y = np.floor(rel @ v / pix).astype(np.int64)
        ok = np.nonzero((x >= 0) & (x < resolution) & (y >= 0) & (y < resolution))[0]
        key = y[ok] * resolution + x[ok]
        order = np.lexsort((rel[ok] @ d, key))
        ks = key[order]
        yield d, owner[ok[order]][np.r_[True, ks[1:] != ks[:-1]]]


def backface_ratio(tris: np.ndarray, **kw) -> float:
    """Share of visible pixels whose first surface faces AWAY from the viewer.

    A single-sided renderer culls exactly those: the viewer sees through them
    to whatever lies behind — the dark "holes" of a hull with flipped panels.
    """
    normals = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]) if len(tris) else None
    back = total = 0
    for d, hit in first_hits(tris, **kw):
        back += int((normals[hit] @ d > 0).sum())
        total += len(hit)
    return back / total if total else 0.0


def visible_pixels_by_group(tris: np.ndarray, groups: np.ndarray, **kw) -> Dict[int, int]:
    """First-hit pixel count per group id, summed over all outside views."""
    out: Dict[int, int] = {}
    for _, hit in first_hits(tris, **kw):
        ids, counts = np.unique(groups[hit], return_counts=True)
        for i, c in zip(ids.tolist(), counts.tolist()):
            out[i] = out.get(i, 0) + c
    return out


# ---- the gate -----------------------------------------------------------------
@dataclass
class IntegrityReport:
    reference: MeshStats
    candidate: MeshStats
    coverage: CoverageReport
    max_hole_ratio: float

    @property
    def ok(self) -> bool:
        return self.coverage.hole_ratio <= self.max_hole_ratio

    @property
    def boundary_ratio(self) -> float:
        return self.candidate.boundary_edges / max(self.reference.boundary_edges, 1)

    def summary(self) -> str:
        c = self.coverage
        return (f"hole ratio {c.hole_ratio:.2%} (worst view {c.worst_view:.2%}, limit "
                f"{self.max_hole_ratio:.2%}), tris {self.reference.triangles:,} -> "
                f"{self.candidate.triangles:,}, open edges {self.reference.boundary_edges:,} -> "
                f"{self.candidate.boundary_edges:,} ({self.boundary_ratio:.2f}x)")

    def as_dict(self) -> dict:
        return {"hole_ratio": round(self.coverage.hole_ratio, 5),
                "worst_view": round(self.coverage.worst_view, 5),
                "reference": self.reference.as_dict(),
                "candidate": self.candidate.as_dict(),
                "boundary_ratio": round(self.boundary_ratio, 3), "ok": self.ok}


def check_hull(reference: np.ndarray, candidate_glb: Path,
               max_hole_ratio: float = DEFAULT_MAX_HOLE_RATIO,
               include_material: Optional[MaterialFilter] = None,
               **coverage_kw) -> IntegrityReport:
    """Measure ``candidate_glb`` against the reference triangles (no raise)."""
    cand = load_triangles(candidate_glb, include_material)
    return IntegrityReport(mesh_stats(reference), mesh_stats(cand),
                           coverage_loss(reference, cand, **coverage_kw), max_hole_ratio)


def visible_reference_filter(name: str) -> bool:
    """Reference = everything the converter emitted except never-drawn proxies."""
    return not glb_materials.is_hidden_material(name)
