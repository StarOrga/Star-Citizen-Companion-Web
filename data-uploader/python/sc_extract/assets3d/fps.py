"""FPS (personal) weapon wiring for the generic entity package.

An FPS weapon is not a ``.cga`` like a ship item: its ``SGeometryResourceParams``
points at a ``.cdf`` (CharacterDefinition) = a skeleton ``.chr`` + ``CA_SKIN``
meshes (the body) + ``CA_BONE`` ``.cgf`` s hung on bones. The attachment
ports' helpers (``sight_attachment``, ``magAttach``, ``barrel_attachment``,
``underbarrel_attachment``) are BONES of that skeleton — the converter's node
tree of the ``.skin`` only carries the bones that deform vertices, so they are
read straight from the ``.chr`` (``#ivo`` ``CompiledBones`` chunk).

Everything else is the generic pipeline: the body is one content-addressed part
in the shared ``_parts/`` store (:meth:`PartStore.export_composite`), the
attachments are ordinary ``.cgf`` parts (one per geometry, reused by every
weapon), RESOLVE/ENRICH/PACKAGE are unchanged.

On disk: ``<out>/_fps/<WeaponClassName>/package.json``.
"""
from __future__ import annotations

import io
import re
import struct
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..dataforge_extract import _dig, _find_component, _is_catalog_entity
from .entity import EntityDef, PortDef
from .transforms import Mat4, cry_to_gltf, from_pos_quat, matmul, to_pos_quat

FPS_DIR = "_fps"
PACKAGE_FILE = "package.json"
# #ivo CompiledBones chunk (format 0x900): u32 count, count x 68-byte records
# {u32 controllerId, u32 limbId, i16 parent, i16 _, f32[4] relQuat xyzw,
#  f32[3] relPos, f32[4] worldQuat xyzw, f32[3] worldPos}, then the names as
# NUL-separated strings. Verified on LIVE 4.x against the converter's own
# bone nodes (P4-AR bolt/trigger/coverPlate agree to 0.01 mm).
IVO_COMPILED_BONES = 0xC2011111
_BONE_RECORD = 68
# Records live under scitem/weapons/fps_weapons; melee/throwable/mines sit in
# sibling folders and are not "weapons with attachments". dev/ = test rigs.
_FPS_RECORD_DIR = "/scitem/weapons/fps_weapons/"
_FPS_EXCLUDED_DIRS = ("/dev/",)
# CA_BONE bindings that are not part of the body silhouette (the chambered
# round sits inside the receiver; shells are ejected effects).
_SKIP_BONE_BINDING = re.compile(r"(^|/)(ammo|shells?)/", re.IGNORECASE)


def _data_path(p: Optional[str], ext: Optional[str] = None) -> Optional[str]:
    if not isinstance(p, str) or not p.strip():
        return None
    p = p.strip().replace("\\", "/").lstrip("/")
    if ext and not p.lower().endswith(ext):
        p += ext
    return p if p.lower().startswith("data/") else "Data/" + p


# ---- skeleton -------------------------------------------------------------------
def bones_from_chr(blob: bytes) -> Dict[str, Dict[str, List[float]]]:
    """``bone name -> {position, rotation}`` in glTF space (Y-up metres,
    ``[x,y,z,w]``), model-space bind pose. ``{}`` for anything unrecognised."""
    if len(blob) < 16 or blob[:4] != b"#ivo":
        return {}
    _, _, n_chunks, table = struct.unpack_from("<4sIII", blob, 0)
    for i in range(n_chunks):
        if table + i * 16 + 16 > len(blob):
            break
        ctype, _ver, coff = struct.unpack_from("<IIQ", blob, table + i * 16)
        if ctype == IVO_COMPILED_BONES:
            return _parse_ivo_bones(blob, coff)
    return {}


def _parse_ivo_bones(blob: bytes, off: int) -> Dict[str, Dict[str, List[float]]]:
    try:
        (n,) = struct.unpack_from("<I", blob, off)
        if not 0 < n < 4096:
            return {}
        names_at = off + 4 + n * _BONE_RECORD
        names = blob[names_at:].split(b"\0")[:n]
        if len(names) < n:
            return {}
        out: Dict[str, Dict[str, List[float]]] = {}
        for i in range(n):
            rec = off + 4 + i * _BONE_RECORD
            wq = struct.unpack_from("<4f", blob, rec + 40)
            wp = struct.unpack_from("<3f", blob, rec + 56)
            name = names[i].decode("utf-8", "replace")
            if not name or name in out:
                continue
            pos, quat = to_pos_quat(cry_to_gltf(from_pos_quat(wp, wq)))
            out[name] = {"position": [round(v, 5) + 0.0 for v in pos],
                         "rotation": [round(v, 7) + 0.0 for v in quat]}
        return out
    except struct.error:
        return {}


# ---- character definition --------------------------------------------------------
@dataclass
class CdfAttachment:
    type: str                      # CA_SKIN | CA_BONE | ...
    name: str
    binding: Optional[str]         # Data/-rooted mesh path
    material: Optional[str]        # Data/-rooted .mtl
    bone: Optional[str] = None
    rel_position: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    rel_rotation: Tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)  # xyzw


@dataclass
class CharacterDef:
    model: Optional[str]           # Data/-rooted .chr
    material: Optional[str]
    attachments: List[CdfAttachment] = field(default_factory=list)


def _floats(s: Optional[str], n: int) -> Optional[List[float]]:
    try:
        v = [float(x) for x in (s or "").split(",")]
    except ValueError:
        return None
    return v if len(v) == n else None


def parse_cdf(blob: bytes) -> Optional[CharacterDef]:
    """CryXmlB or text ``<CharacterDefinition>`` -> :class:`CharacterDef`."""
    try:
        if blob[:7] == b"CryXmlB":
            from scdatatools.engine.cryxml import etree_from_cryxml_file
            root = etree_from_cryxml_file(io.BytesIO(blob)).getroot()
        else:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(blob)
    except Exception:  # noqa: BLE001 — unreadable definition = no body
        return None
    model = root.find("Model")
    cd = CharacterDef(model=_data_path(model.get("File")) if model is not None else None,
                      material=_data_path(model.get("Material"), ".mtl") if model is not None else None)
    for a in root.iter("Attachment"):
        rot = _floats(a.get("RelRotation"), 4)  # CryEngine order: w,x,y,z
        cd.attachments.append(CdfAttachment(
            type=a.get("Type") or "", name=a.get("AName") or "",
            binding=_data_path(a.get("Binding")),
            material=_data_path(a.get("Material"), ".mtl"),
            bone=a.get("BoneName") or None,
            rel_position=tuple(_floats(a.get("RelPosition"), 3) or (0.0, 0.0, 0.0)),
            rel_rotation=(rot[1], rot[2], rot[3], rot[0]) if rot else (0.0, 0.0, 0.0, 1.0),
        ))
    return cd


def body_sources(cd: CharacterDef, bones: Dict[str, Dict[str, List[float]]]
                 ) -> List[Tuple[str, Optional[str], Optional[Mat4]]]:
    """The meshes that make up the weapon body, glTF-space matrices.
    ``CA_SKIN`` meshes are already in model space (identity); a ``CA_BONE``
    mesh sits at its bone's bind pose times its relative offset. Ammo / shell
    bindings are skipped; a bone attachment whose bone is unknown is dropped
    rather than guessed."""
    out: List[Tuple[str, Optional[str], Optional[Mat4]]] = []
    for a in cd.attachments:
        if not a.binding:
            continue
        low = a.binding.lower()
        if a.type == "CA_SKIN" and low.endswith(".skin"):
            out.append((a.binding, a.material or cd.material, None))
        elif a.type == "CA_BONE" and low.endswith((".cgf", ".cga")) \
                and not _SKIP_BONE_BINDING.search(low):
            b = bones.get(a.bone or "")
            if b is None:
                continue
            rel = cry_to_gltf(from_pos_quat(a.rel_position, a.rel_rotation))
            out.append((a.binding, a.material, matmul(from_pos_quat(b["position"], b["rotation"]), rel)))
    return out


# ---- DataCore ------------------------------------------------------------------
def body_path(comps: List[Dict[str, Any]]) -> Optional[str]:
    """``SGeometryResourceParams`` geometry — ``.cdf`` for guns, ``.cga``/``.cgf``
    for simple items (knives, gadgets). Data/-rooted."""
    for c in comps:
        g = c.get("Geometry")
        if isinstance(g, dict):
            p = _dig(g, "Geometry", "Geometry", "path")
            if isinstance(p, str) and p.lower().endswith((".cdf", ".cga", ".cgf")):
                return _data_path(p)
    return None


def is_attachment_port(p: PortDef) -> bool:
    """Real attachment slots. ``item_grab`` & co. (no types, size 0) are
    interaction helpers, not something a UI should list as a free slot."""
    return bool(p.types) or bool(p.max_size)


class FpsSource:
    """:class:`~.entity.EntitySource` over a :class:`~.datacore.DataCoreSource`
    that also understands ``.cdf`` bodies: helpers of a ``.cdf`` = the bones of
    its ``.chr``."""

    def __init__(self, base, reader) -> None:
        self.base, self.reader = base, reader
        self._cdf: Dict[str, Optional[CharacterDef]] = {}
        self._bones: Dict[str, Dict[str, Dict[str, List[float]]]] = {}

    def entity(self, class_name: str) -> Optional[EntityDef]:
        return self.base.entity(class_name)

    def default_loadout(self, class_name: str):
        return self.base.default_loadout(class_name)

    def components(self, class_name: str):
        return self.base.components(class_name)

    def cdf(self, path: str) -> Optional[CharacterDef]:
        key = path.lower()
        if key not in self._cdf:
            try:
                self._cdf[key] = parse_cdf(self.reader.read(path))
            except Exception:  # noqa: BLE001
                self._cdf[key] = None
        return self._cdf[key]

    def bones(self, cdf_path: str) -> Dict[str, Dict[str, List[float]]]:
        key = cdf_path.lower()
        if key not in self._bones:
            cd = self.cdf(cdf_path)
            try:
                blob = self.reader.read(cd.model) if cd and cd.model else b""
            except Exception:  # noqa: BLE001
                blob = b""
            self._bones[key] = bones_from_chr(blob)
        return self._bones[key]

    def helpers(self, geometry_path: str) -> Dict[str, Dict[str, Any]]:
        if geometry_path.lower().endswith(".cdf"):
            return self.bones(geometry_path)
        return self.base.helpers(geometry_path)

    def weapon(self, class_name: str) -> Optional[EntityDef]:
        """The weapon as a package root: body = its ``.cdf`` (or mesh), ports =
        attachment slots only."""
        e = self.base.entity(class_name)
        if e is None:
            return None
        body = body_path(self.base.components(class_name))
        if body is None or not self.reader.exists(body):
            body = e.geometry_path
        return replace(e, geometry_path=body,
                       material_path=None if body and body.lower().endswith(".cdf") else e.material_path,
                       ports=[p for p in e.ports if is_attachment_port(p)])


def is_fps_weapon_record(filename: str, class_name: str) -> bool:
    """Record-level rule (no resolve needed): a personal weapon record folder,
    not a dev rig, and a player-facing class name (the codex's
    ``_is_catalog_entity`` — drops template/test/placeholder/AI/NPC tokens)."""
    f = filename.replace("\\", "/").lower()
    return (_FPS_RECORD_DIR in f and not any(d in f for d in _FPS_EXCLUDED_DIRS)
            and _is_catalog_entity(class_name))


def fps_weapon_classes(source: FpsSource) -> List[str]:
    """Every personal weapon with exportable geometry (``AttachDef.Type ==
    WeaponPersonal``), sorted. Paint/tint variants are separate classes and get
    their own (tiny) manifest; their geometry dedups in ``_parts``."""
    out = []
    for key, rec in source.base._by_name.items():
        cls = rec.name.split(".", 1)[1]
        if not is_fps_weapon_record(str(getattr(rec, "filename", "") or ""), cls):
            continue
        w = source.weapon(cls)
        if w is None or w.item_type != "WeaponPersonal" or not w.geometry_path:
            continue
        if not source.reader.exists(w.geometry_path):
            continue
        out.append(cls)
    return sorted(out, key=str.lower)


def export_body(source: FpsSource, store, weapon: EntityDef):
    """Root part for a weapon: composite of the ``.cdf`` pieces, or the plain
    mesh for single-mesh items."""
    geo = weapon.geometry_path
    if not geo:
        return None
    if not geo.lower().endswith(".cdf"):
        return store.export(geo, weapon.material_path)
    cd = source.cdf(geo)
    if cd is None:
        return None
    sources = body_sources(cd, source.bones(geo))
    if not sources:
        return None
    return store.export_composite(geo, sources, extra_files=[cd.model] if cd.model else [])


def build_fps_package(class_name: str, source: FpsSource, store, out_dir: Path,
                      generator: Optional[dict] = None):
    """Build + write ``<out_dir>/_fps/<class>/package.json``. ``None`` when the
    class has no DataCore record or no body geometry."""
    from .manifest import write_manifest
    from .package import build_package
    weapon = source.weapon(class_name)
    if weapon is None:
        return None
    body = export_body(source, store, weapon)
    if body is None or not body.sha256:
        # A weapon without a body is not displayable; LIVE 4.x: 27 of 387
        # (.cdf with no CA_SKIN/CA_BONE mesh we can convert).
        return None
    root_glb = store.path_of(body.sha256)
    res = build_package("fps_weapon", weapon, source.default_loadout(class_name), source,
                        store, root_glb, generator=generator)
    # The root GLB carries no independent locator set (hull3d writes those for
    # hulls only) — bones ARE the placement source, so there is nothing to
    # cross-check; report "not applicable" instead of a failed check.
    res.locators = None
    res.manifest_bytes = write_manifest(
        res.manifest, out_dir / FPS_DIR / weapon.class_name / PACKAGE_FILE)
    return res


__all__ = ["FPS_DIR", "bones_from_chr", "parse_cdf", "body_sources", "body_path",
           "is_attachment_port", "FpsSource", "is_fps_weapon_record", "fps_weapon_classes",
           "export_body", "build_fps_package"]
