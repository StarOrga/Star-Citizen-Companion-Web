"""The asset-package manifest: typed shape, JSON (de)serialisation, validation.

One small JSON per entity (ship or FPS weapon) that lets a viewer show the
whole thing by loading GLBs and applying transforms verbatim — no geometry
math, no name matching. The canonical contract is ``manifest.schema.json``
next to this file; :func:`validate_manifest` enforces the same rules without a
``jsonschema`` dependency, and ``tests/test_asset_package.py`` keeps the two in
step. Bump :data:`SCHEMA_VERSION` on any breaking change.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, TypedDict

SCHEMA_VERSION = 1
SCHEMA_PATH = Path(__file__).with_name("manifest.schema.json")

Kind = Literal["ship", "fps_weapon"]
KINDS = ("ship", "fps_weapon")
Group = Literal["weapons", "missiles", "components", "attachments", "interior", "other"]
GROUPS = ("weapons", "missiles", "components", "attachments", "interior", "other")
COORDINATE_SYSTEM = "gltf-y-up-metres"


class BlobRef(TypedDict):
    sha256: str
    bytes: int


class Bounds(TypedDict):
    min: List[float]
    max: List[float]


class RootRef(BlobRef, total=False):
    bounds: Optional[Bounds]


class PartInfo(TypedDict):
    bytes: int
    geometryPath: str
    bounds: Optional[Bounds]


class PortMeta(TypedDict):
    minSize: Optional[int]
    maxSize: Optional[int]
    types: List[str]          # what the port accepts ("compatible")
    flags: List[str]
    editable: bool


class Placement(TypedDict):
    id: str                   # port path, unique: "hardpoint_x/hardpoint_class_2"
    portName: str
    helperName: Optional[str]
    parentPort: Optional[str]  # id of the parent placement, None at the root
    group: Group
    itemClass: Optional[str]   # codex_items.class_name; None = empty port
    itemGuid: Optional[str]    # DataCore record GUID
    itemType: Optional[str]
    itemSubType: Optional[str]
    itemSize: Optional[int]
    parentClass: str           # codex_item_ports.parent_class_name of this port
    port: Optional[PortMeta]   # None when the parent declares no metadata
    loadout: Literal["default", "empty"]
    partSha256: Optional[str]  # key into Manifest.parts; None = no own geometry
    position: Optional[List[float]]   # glTF space, root-relative; None = unplaceable
    rotation: Optional[List[float]]   # [x, y, z, w]


class EntityRef(TypedDict):
    className: str
    guid: Optional[str]


class Manifest(TypedDict):
    schemaVersion: int
    kind: Kind
    coordinateSystem: str
    entity: EntityRef
    root: Optional[RootRef]          # hull / weapon body GLB
    interior: Optional[BlobRef]      # ships only; lazy-loaded layer
    parts: Dict[str, PartInfo]       # sha256 -> info, unique parts this entity uses
    placements: List[Placement]
    generator: Dict[str, Any]


def to_json(manifest: Manifest) -> str:
    return json.dumps(manifest, indent=1, ensure_ascii=False, sort_keys=False) + "\n"


def write_manifest(manifest: Manifest, path: Path) -> int:
    errors = validate_manifest(manifest)
    if errors:
        raise ValueError("invalid manifest: " + "; ".join(errors[:5]))
    data = to_json(manifest).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return len(data)


def _vec(v: Any, n: int) -> bool:
    return (isinstance(v, list) and len(v) == n
            and all(isinstance(x, (int, float)) and not isinstance(x, bool)
                    and math.isfinite(x) for x in v))


def _sha(v: Any) -> bool:
    return isinstance(v, str) and len(v) == 64 and all(c in "0123456789abcdef" for c in v)


def _blob(v: Any, where: str, errs: List[str]) -> None:
    if not isinstance(v, dict) or not _sha(v.get("sha256")) or not isinstance(v.get("bytes"), int):
        errs.append(f"{where}: needs sha256 (64 hex) + bytes (int)")


def _bounds(v: Any, where: str, errs: List[str]) -> None:
    if v is None:
        return
    if not isinstance(v, dict) or not _vec(v.get("min"), 3) or not _vec(v.get("max"), 3):
        errs.append(f"{where}: bounds needs min/max [x,y,z]")


def validate_manifest(m: Any) -> List[str]:
    """Human-readable violations; ``[]`` means valid. Mirrors the JSON Schema."""
    errs: List[str] = []
    if not isinstance(m, dict):
        return ["manifest is not an object"]
    if m.get("schemaVersion") != SCHEMA_VERSION:
        errs.append(f"schemaVersion must be {SCHEMA_VERSION}")
    if m.get("kind") not in KINDS:
        errs.append(f"kind must be one of {KINDS}")
    if m.get("coordinateSystem") != COORDINATE_SYSTEM:
        errs.append(f"coordinateSystem must be {COORDINATE_SYSTEM}")
    ent = m.get("entity")
    if not isinstance(ent, dict) or not isinstance(ent.get("className"), str):
        errs.append("entity.className required")
    if m.get("root") is not None:
        _blob(m["root"], "root", errs)
        _bounds(m["root"].get("bounds") if isinstance(m["root"], dict) else None, "root", errs)
    if m.get("interior") is not None:
        _blob(m["interior"], "interior", errs)
    parts = m.get("parts")
    if not isinstance(parts, dict):
        errs.append("parts must be an object")
        parts = {}
    for sha, info in parts.items():
        if not _sha(sha) or not isinstance(info, dict) or not isinstance(info.get("bytes"), int) \
                or not isinstance(info.get("geometryPath"), str):
            errs.append(f"parts[{sha!r}]: needs bytes + geometryPath")
        else:
            _bounds(info.get("bounds"), f"parts[{sha}]", errs)
    pls = m.get("placements")
    if not isinstance(pls, list):
        return errs + ["placements must be an array"]
    ids = set()
    for i, p in enumerate(pls):
        w = f"placements[{i}]"
        if not isinstance(p, dict):
            errs.append(f"{w}: not an object")
            continue
        pid = p.get("id")
        if not isinstance(pid, str) or not pid or pid in ids:
            errs.append(f"{w}: id missing or duplicate")
        parent = p.get("parentPort")
        if parent is not None and parent not in ids:
            errs.append(f"{w}: parentPort {parent!r} must reference an EARLIER placement")
        ids.add(pid)
        if not isinstance(p.get("portName"), str) or not isinstance(p.get("parentClass"), str):
            errs.append(f"{w}: portName + parentClass required")
        if p.get("group") not in GROUPS:
            errs.append(f"{w}: group must be one of {GROUPS}")
        if p.get("loadout") not in ("default", "empty"):
            errs.append(f"{w}: loadout must be default|empty")
        if (p.get("loadout") == "empty") != (p.get("itemClass") is None):
            errs.append(f"{w}: loadout 'empty' <=> itemClass null")
        sha = p.get("partSha256")
        if sha is not None and sha not in parts:
            errs.append(f"{w}: partSha256 not listed in parts")
        pos, rot = p.get("position"), p.get("rotation")
        if (pos is None) != (rot is None):
            errs.append(f"{w}: position and rotation are both set or both null")
        if pos is not None and (not _vec(pos, 3) or not _vec(rot, 4)):
            errs.append(f"{w}: position [x,y,z] / rotation [x,y,z,w] malformed")
        if sha is not None and pos is None:
            errs.append(f"{w}: a part without a transform cannot be shown")
        port = p.get("port")
        if port is not None and (not isinstance(port, dict) or not isinstance(port.get("types"), list)
                                 or not isinstance(port.get("editable"), bool)):
            errs.append(f"{w}: port metadata malformed")
    return errs
