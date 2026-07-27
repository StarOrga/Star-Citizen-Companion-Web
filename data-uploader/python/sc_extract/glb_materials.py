"""Repair a raw cgf-converter glb before the web `optimize` pass.

Two independent defects of the CryEngine -> glTF conversion make a correctly
*extracted* hull render wrong in a spec-compliant viewer (three.js /
<model-viewer>). Both were measured against the LIVE `DRAK_Cutlass_Black.cga`
and are what admin feedback d7f44a41 reported as "das 3d modell ist kaputt".

Defect A — no-op rigid skin (geometry)
--------------------------------------
cgf-converter turns the `.cga` node hierarchy into a *skinned* mesh: all 19 mesh
nodes carry `skin=0`, and the skin's inverse bind matrix for each joint is the
exact inverse of that joint's global transform, so every joint matrix
(`global(joint) @ ibm`) evaluates to the identity. glTF 2.0 §3.7.4 says a
skinned mesh node's own transform MUST be ignored — so a compliant renderer
draws every sub-object at the scene origin. Wings, tail and thrusters collapse
into the fuselage and small parts stick out as detached slivers: the "white
box + floating fragment" in the feedback screenshot. The vertex data is fine;
only the placement is lost, which is why a naive offline dump of the glb looks
correct and only the browser shows the defect. `strip_noop_skins` removes the
skin so the (correct) node hierarchy places the parts again.

Defect B — untextured paint materials (colour)
----------------------------------------------
A Star Citizen ship hull does NOT carry its paint in texture slots. The painted
panels use the ``HardSurface`` shader, whose visible appearance lives in a
``<MatLayers>`` block::

    <Material Name="Paint_Secondary" Shader="HardSurface" Diffuse="1,1,1" ...>
      <Textures />                                   <!-- empty! -->
      <MatLayers>
        <Layer Name="Primary" Path="Materials/vehicles/manufacturer/DRAK/
               drak_lf_paintedpanels_a_clean.mtl"
               TintColor="0.012983,0.012983,0.012983" GlossMult="0.548" .../>
        <Layer Name="Wear"    Path="..._wear.mtl" TintColor="1,1,1" .../>
      </MatLayers>
    </Material>

``cgf-converter`` ignores ``MatLayers`` completely: it sees a submaterial with no
texture and emits ``baseColorFactor = [1,1,1,1]``. On the DRAK Cutlass Black
those layered submaterials (Paint_*/Metal_*) cover **~42 % of the hull
triangles**, so the whole exported ship rendered as a featureless WHITE blob —
which is exactly what the Showroom shipped (admin feedback d7f44a41).

This module reads the paint ``.mtl`` that the skin is built from and folds the
layer values back into standard glTF PBR:

  * ``baseColorFactor`` = ``Diffuse`` x Primary-layer ``TintColor``  (linear,
    which is the space glTF factors use and the space CryEngine stores)
  * ``roughnessFactor`` = ``1 - GlossMult`` (fallback: ``1 - Shininess/255``)
  * ``metallicFactor``  = 1 when the *layer material path* is a metal-panel
    library (``..._metalpanels_...``), else 0 — the panel library is P4K data,
    not a guess from our own naming
  * ``alphaMode/baseColorFactor.a`` from ``Opacity``

It also drops ``KHR_materials_pbrSpecularGlossiness``. That extension was
archived by Khronos and three.js removed support in r165, so <model-viewer> 4.x
(the Showroom viewer) ignores it entirely — it is dead payload that only bloats
the glb, and leaving it in hides the fact that ``pbrMetallicRoughness`` is the
block that actually renders. Where a material has spec-gloss textures but no
base-color texture, the spec-gloss ``diffuseTexture`` is promoted into
``baseColorTexture`` first so nothing is lost.

Everything here is derived from the P4K: the ``.mtl`` is a P4K file and the
numbers are CIG's own material values.
"""
from __future__ import annotations

import io
import json
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

LogFn = Callable[[str, str], None]

_GLB_MAGIC = b"glTF"
_CHUNK_JSON = 0x4E4F534A
_CHUNK_BIN = 0x004E4942

SPEC_GLOSS = "KHR_materials_pbrSpecularGlossiness"

_IDENTITY = (1.0, 0.0, 0.0, 0.0,
             0.0, 1.0, 0.0, 0.0,
             0.0, 0.0, 1.0, 0.0,
             0.0, 0.0, 0.0, 1.0)
# How far a joint matrix may drift from the identity and still count as "no-op".
# The inverse bind matrices are float32 inverses of the node transforms, so the
# residual is rounding noise; 1e-3 is far below any real bind pose.
_IDENTITY_TOL = 1e-3

# A layer .mtl from one of the manufacturers' *metal panel* libraries means the
# surface is bare metal; the painted-panel libraries are dielectric paint.
_METAL_LAYER_HINTS = ("metalpanels", "metal_panels", "baremetal", "bare_metal")


def _floats(value: Optional[str], count: int) -> Optional[List[float]]:
    """Parse a CryEngine ``"r,g,b"`` attribute into floats."""
    if not value:
        return None
    parts = [p.strip() for p in value.split(",")]
    if len(parts) < count:
        return None
    try:
        return [float(p) for p in parts[:count]]
    except ValueError:
        return None


def _clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


@dataclass
class SubMaterial:
    """One resolved submaterial appearance, in glTF PBR terms."""
    name: str
    base_color: Tuple[float, float, float] = (1.0, 1.0, 1.0)
    alpha: float = 1.0
    roughness: Optional[float] = None
    metallic: Optional[float] = None
    layered: bool = False       # appearance came from <MatLayers>
    has_texture: bool = False   # the submaterial itself references a texture


def parse_paint_mtl(raw: bytes) -> Dict[str, SubMaterial]:
    """Parse a CryXML ``.mtl`` into ``{submaterial name: SubMaterial}``.

    Names are keyed lower-case because the glb material names come back from
    cgf-converter with the .mtl's own casing, which we should not depend on.
    """
    from scdatatools.engine.chunkfile import etree_from_cryxml_file

    root = etree_from_cryxml_file(io.BytesIO(raw)).getroot()
    out: Dict[str, SubMaterial] = {}
    for el in root.findall(".//Material"):
        name = el.get("Name")
        if not name:
            continue
        diffuse = _floats(el.get("Diffuse"), 3) or [1.0, 1.0, 1.0]
        sub = SubMaterial(name=name)
        sub.has_texture = any((t.get("File") or t.get("file") or "").strip()
                              and not (t.get("File") or t.get("file") or "").startswith("$")
                              for t in el.findall(".//Texture"))

        primary = None
        for layer in el.findall(".//Layer"):
            if (layer.get("Name") or "").lower() == "primary":
                primary = layer
                break
        if primary is None:
            # Some materials list layers without naming one "Primary" — the
            # first layer is the base coat in CryEngine's layer order.
            layers = el.findall(".//Layer")
            primary = layers[0] if layers else None

        if primary is not None:
            sub.layered = True
            tint = _floats(primary.get("TintColor"), 3) or [1.0, 1.0, 1.0]
            sub.base_color = tuple(_clamp01(diffuse[i] * tint[i]) for i in range(3))
            gloss = primary.get("GlossMult")
            try:
                if gloss is not None:
                    sub.roughness = _clamp01(1.0 - float(gloss))
            except ValueError:
                pass
            path = (primary.get("Path") or "").lower()
            sub.metallic = 1.0 if any(h in path for h in _METAL_LAYER_HINTS) else 0.0
        else:
            sub.base_color = tuple(_clamp01(c) for c in diffuse)

        if sub.roughness is None:
            try:
                shininess = float(el.get("Shininess") or 0.0)
                if shininess > 0:
                    sub.roughness = _clamp01(1.0 - shininess / 255.0)
            except ValueError:
                pass

        try:
            opacity = float(el.get("Opacity") or 1.0)
            sub.alpha = _clamp01(opacity)
        except ValueError:
            pass

        out[name.lower()] = sub
    return out


# ---- GLB container ---------------------------------------------------------
def read_glb(path: Path) -> Tuple[dict, bytes]:
    """Split a .glb into its JSON document and its BIN chunk."""
    raw = path.read_bytes()
    if raw[:4] != _GLB_MAGIC:
        raise ValueError(f"{path.name} is not a binary glTF")
    total = struct.unpack_from("<I", raw, 8)[0]
    gltf: Optional[dict] = None
    binary = b""
    off = 12
    while off + 8 <= min(total, len(raw)):
        length, ctype = struct.unpack_from("<II", raw, off)
        body = raw[off + 8: off + 8 + length]
        if ctype == _CHUNK_JSON and gltf is None:
            gltf = json.loads(body.decode("utf-8"))
        elif ctype == _CHUNK_BIN and not binary:
            binary = body
        off += 8 + length
    if gltf is None:
        raise ValueError(f"{path.name} has no JSON chunk")
    return gltf, binary


def write_glb(path: Path, gltf: dict, binary: bytes) -> None:
    """Write a .glb, padding both chunks to the spec's 4-byte alignment."""
    js = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    js += b" " * (-len(js) % 4)
    chunks = [struct.pack("<II", len(js), _CHUNK_JSON) + js]
    if binary:
        bn = binary + b"\0" * (-len(binary) % 4)
        chunks.append(struct.pack("<II", len(bn), _CHUNK_BIN) + bn)
    body = b"".join(chunks)
    path.write_bytes(_GLB_MAGIC + struct.pack("<II", 2, 12 + len(body)) + body)


# ---- no-op rigid skins -----------------------------------------------------
def _mat_mul(a, b):  # column-major 4x4, glTF order
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = (a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
                              + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3])
    return out


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


def _global_matrices(gltf: dict) -> List[List[float]]:
    """World matrix per node, walked from the active scene's roots."""
    nodes = gltf.get("nodes", [])
    out = [list(_IDENTITY) for _ in nodes]
    scenes = gltf.get("scenes") or [{}]
    stack = [(i, list(_IDENTITY)) for i in scenes[gltf.get("scene", 0)].get("nodes", [])]
    seen = set()
    while stack:
        idx, parent = stack.pop()
        if idx in seen or idx >= len(nodes):
            continue
        seen.add(idx)
        world = _mat_mul(parent, _local_matrix(nodes[idx]))
        out[idx] = world
        for child in nodes[idx].get("children", []):
            stack.append((child, world))
    return out


def _read_mat4(gltf: dict, binary: bytes, accessor: int) -> List[List[float]]:
    acc = gltf["accessors"][accessor]
    if acc.get("type") != "MAT4" or acc.get("componentType") != 5126:
        raise ValueError("inverseBindMatrices must be MAT4/float")
    view = gltf["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return [list(struct.unpack_from("<16f", binary, base + i * 64))
            for i in range(acc["count"])]


def _is_identity(m) -> bool:
    return all(abs(a - b) <= _IDENTITY_TOL for a, b in zip(m, _IDENTITY))


def strip_noop_skins(gltf: dict, binary: bytes,
                     on_log: Optional[LogFn] = None) -> dict:
    """Drop skins whose every joint matrix is the identity (defect A above).

    Such a skin deforms nothing; it only *hides* the node hierarchy from the
    renderer, because the spec makes a skinned mesh node's own transform
    inert — which collapses every sub-object onto the origin. A skin with a
    real bind pose is left alone: we never silently rewrite a model we do not
    understand.
    """
    skins = gltf.get("skins") or []
    stats = {"skins": len(skins), "stripped": 0, "nodes": 0, "reason": None}
    if not skins:
        return stats

    worlds = _global_matrices(gltf)
    noop: List[int] = []
    for si, skin in enumerate(skins):
        ibm_acc = skin.get("inverseBindMatrices")
        joints = skin.get("joints") or []
        if ibm_acc is None:
            stats["reason"] = "skin without inverseBindMatrices"
            continue
        try:
            ibms = _read_mat4(gltf, binary, ibm_acc)
        except (ValueError, KeyError, IndexError, struct.error) as exc:
            stats["reason"] = f"unreadable inverseBindMatrices: {exc}"
            continue
        if len(ibms) < len(joints):
            stats["reason"] = "inverseBindMatrices shorter than the joint list"
            continue
        if all(_is_identity(_mat_mul(worlds[j], ibms[k])) for k, j in enumerate(joints)):
            noop.append(si)
        else:
            stats["reason"] = "skin has a real bind pose — kept"

    # Partial removal would renumber the surviving skins and silently rebind the
    # wrong joints, so only an all-or-nothing strip is safe.
    if not noop or len(noop) != len(skins):
        return stats

    touched = 0
    for node in gltf.get("nodes", []):
        if "skin" in node:
            node.pop("skin", None)
            touched += 1
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            attrs = prim.get("attributes", {})
            for key in [k for k in attrs if k.startswith(("JOINTS_", "WEIGHTS_"))]:
                attrs.pop(key)
    gltf.pop("skins", None)

    stats["stripped"] = len(noop)
    stats["nodes"] = touched
    if on_log:
        on_log("info", f"  no-op skin strip: {len(noop)} skin(s) removed from {touched} "
                       f"mesh node(s) — sub-object placement restored")
    return stats


# ---- the patch -------------------------------------------------------------
def _promote_spec_gloss(mat: dict) -> None:
    """Move a spec-gloss diffuse texture/factor into pbrMetallicRoughness.

    Only fills gaps — an existing baseColorTexture always wins.
    """
    sg = (mat.get("extensions") or {}).get(SPEC_GLOSS)
    if not isinstance(sg, dict):
        return
    pbr = mat.setdefault("pbrMetallicRoughness", {})
    if "baseColorTexture" not in pbr and isinstance(sg.get("diffuseTexture"), dict):
        pbr["baseColorTexture"] = sg["diffuseTexture"]
    if "baseColorFactor" not in pbr and isinstance(sg.get("diffuseFactor"), list):
        pbr["baseColorFactor"] = sg["diffuseFactor"]
    if "glossinessFactor" in sg and "roughnessFactor" not in pbr:
        try:
            pbr["roughnessFactor"] = _clamp01(1.0 - float(sg["glossinessFactor"]))
        except (TypeError, ValueError):
            pass


def _strip_spec_gloss(gltf: dict) -> int:
    """Remove the archived spec-gloss extension (unsupported by three.js r165+
    and therefore by <model-viewer> 4.x). Returns how many materials changed."""
    n = 0
    for mat in gltf.get("materials", []):
        ext = mat.get("extensions")
        if isinstance(ext, dict) and SPEC_GLOSS in ext:
            _promote_spec_gloss(mat)
            ext.pop(SPEC_GLOSS, None)
            if not ext:
                mat.pop("extensions", None)
            n += 1
    for key in ("extensionsUsed", "extensionsRequired"):
        if key in gltf:
            gltf[key] = [e for e in gltf[key] if e != SPEC_GLOSS]
            if not gltf[key]:
                gltf.pop(key)
    return n


def patch_glb_materials(glb: Path, submats: Dict[str, SubMaterial],
                        on_log: Optional[LogFn] = None) -> dict:
    """Fold the paint .mtl's layered appearance into a converted glb.

    Only materials that carry NO base-color texture are re-coloured — a material
    cgf-converter textured correctly is never second-guessed. Returns a small
    stats dict (also useful as a regression assertion in tests).
    """
    gltf, binary = read_glb(glb)
    skins = strip_noop_skins(gltf, binary, on_log)
    stripped = _strip_spec_gloss(gltf)

    recoloured = 0
    unmatched: List[str] = []
    still_white = 0
    for mat in gltf.get("materials", []):
        name = (mat.get("name") or "").strip()
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        if "baseColorTexture" in pbr:
            continue  # already textured — cgf-converter got this one right
        sub = submats.get(name.lower())
        if sub is None:
            if name:
                unmatched.append(name)
            still_white += 1
            continue
        pbr["baseColorFactor"] = [sub.base_color[0], sub.base_color[1],
                                  sub.base_color[2], sub.alpha]
        if sub.roughness is not None:
            pbr["roughnessFactor"] = sub.roughness
        if sub.metallic is not None:
            pbr["metallicFactor"] = sub.metallic
        if sub.alpha < 1.0:
            mat.setdefault("alphaMode", "BLEND")
        recoloured += 1

    write_glb(glb, gltf, binary)
    stats = {
        "materials": len(gltf.get("materials", [])),
        "recoloured": recoloured,
        "spec_gloss_stripped": stripped,
        "untextured_unmatched": still_white,
        "skins_stripped": skins["stripped"],
    }
    if on_log:
        on_log("info", f"  materials: {recoloured}/{stats['materials']} re-coloured "
                       f"from paint layers, {stripped} spec-gloss stripped"
                       + (f", {still_white} untextured left at default" if still_white else ""))
        if unmatched:
            on_log("info", f"  no .mtl match for: {', '.join(sorted(set(unmatched))[:8])}")
    return stats


# ---- interior strip --------------------------------------------------------
# CryEngine material names mark the ship's *inside* surfaces consistently across
# manufacturers: `internal_structure`, `internal_pom`, `POM_L_INT`,
# `Decal_Text_INT`, `Int_Decal_POM_A`, … The Showroom is an exterior viewer, so
# this geometry is never seen — but on the Cutlass it is a quarter of the
# triangles AND the majority of the texture payload (interior POM/decal atlases
# are the largest images in the file). Dropping it is the single biggest lever
# for the storage budget without touching the visible hull.
_INTERIOR_PREFIXES = ("internal", "int_")
_INTERIOR_SUBSTRINGS = ("_int_", "interior")
_INTERIOR_SUFFIXES = ("_int",)


def is_interior_material(name: str) -> bool:
    n = (name or "").strip().lower()
    if not n:
        return False
    return (n.startswith(_INTERIOR_PREFIXES)
            or n.endswith(_INTERIOR_SUFFIXES)
            or any(s in n for s in _INTERIOR_SUBSTRINGS))


def drop_interior_geometry(glb: Path, on_log: Optional[LogFn] = None) -> dict:
    """Remove primitives painted with an interior material from a converted glb.

    Orphaned accessors/bufferViews/textures are left behind on purpose — the
    `gltf-transform optimize --prune` pass that runs next collects them, which is
    both simpler and safer than re-indexing binary data here.
    """
    gltf, binary = read_glb(glb)
    mats = gltf.get("materials", [])
    interior = {i for i, m in enumerate(mats) if is_interior_material(m.get("name", ""))}
    if not interior:
        return {"dropped_primitives": 0, "dropped_triangles": 0, "interior_materials": 0}

    accessors = gltf.get("accessors", [])

    def _tris(prim: dict) -> int:
        if "indices" in prim:
            return accessors[prim["indices"]].get("count", 0) // 3
        pos = prim.get("attributes", {}).get("POSITION")
        return accessors[pos].get("count", 0) // 3 if pos is not None else 0

    kept_meshes: List[dict] = []
    remap: Dict[int, int] = {}
    dropped_prims = dropped_tris = 0
    for idx, mesh in enumerate(gltf.get("meshes", [])):
        keep = []
        for prim in mesh.get("primitives", []):
            if prim.get("material") in interior:
                dropped_prims += 1
                dropped_tris += _tris(prim)
                continue
            keep.append(prim)
        if keep:
            mesh["primitives"] = keep
            remap[idx] = len(kept_meshes)
            kept_meshes.append(mesh)
    gltf["meshes"] = kept_meshes

    for node in gltf.get("nodes", []):
        if "mesh" not in node:
            continue
        new = remap.get(node["mesh"])
        if new is None:
            node.pop("mesh", None)
        else:
            node["mesh"] = new

    write_glb(glb, gltf, binary)
    stats = {"dropped_primitives": dropped_prims, "dropped_triangles": dropped_tris,
             "interior_materials": len(interior)}
    if on_log:
        on_log("info", f"  interior strip: -{dropped_tris:,} triangles "
                       f"({dropped_prims} primitives, {len(interior)} materials)")
    return stats
