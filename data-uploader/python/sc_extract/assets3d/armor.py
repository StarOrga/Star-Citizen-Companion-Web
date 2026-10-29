"""Personal armor + clothing packages (``kind: "armor"``).

Same geometry path as FPS weapons (:mod:`.fps`): an armor piece's
``SGeometryResourceParams`` points at a ``.cdf`` (skeleton ``.chr`` + ``CA_SKIN``
body meshes + ``CA_BONE`` attachments) or at a plain ``.cga``/``.cgf``. The body
is one content-addressed part in the shared ``_parts/`` store, built by
:func:`.fps.export_body`; RESOLVE/ENRICH/PACKAGE are the generic pipeline.

Which entities: every ``AttachDef.Type`` of ``Char_Armor_*`` (helmet, torso,
arms, legs, undersuit, backpack) and ``Char_Clothing_*``. The record folder is
NOT hard-wired (CIG files them under several ``scitem`` sub-folders); the type
is the rule and the ship/weapon/vehicle item folders are skipped up front so the
enumeration resolves a fraction of the records.

On disk: ``<out>/_armor/<ClassName>/package.json``.
"""
from __future__ import annotations

from pathlib import Path
from typing import List, Optional

from ..dataforge_extract import _is_catalog_entity
from .fps import FpsSource, export_body

ARMOR_DIR = "_armor"
PACKAGE_FILE = "package.json"
ARMOR_TYPE_PREFIXES = ("Char_Armor_", "Char_Clothing_")
# Item folders that can never hold personal armor (own package kinds / vehicles).
_SKIP_RECORD_DIRS = ("/scitem/ships/", "/scitem/weapons/", "/scitem/vehicles/", "/dev/")


def is_armor_type(item_type: Optional[str]) -> bool:
    return bool(item_type) and item_type.startswith(ARMOR_TYPE_PREFIXES)


def is_armor_record(filename: str, class_name: str) -> bool:
    """Record-level rule (no resolve needed): an item record outside the
    ship/weapon/vehicle/dev folders with a player-facing class name."""
    f = filename.replace("\\", "/").lower()
    return ("/scitem/" in f and not any(d in f for d in _SKIP_RECORD_DIRS)
            and _is_catalog_entity(class_name))


def armor_classes(source: FpsSource) -> List[str]:
    """Every armor / clothing piece with exportable geometry, sorted."""
    out = []
    for rec in source.base._by_name.values():
        cls = rec.name.split(".", 1)[1]
        if not is_armor_record(str(getattr(rec, "filename", "") or ""), cls):
            continue
        e = source.weapon(cls)  # root with body = .cdf / mesh (generic, not weapon-only)
        if e is None or not is_armor_type(e.item_type) or not e.geometry_path:
            continue
        if not source.reader.exists(e.geometry_path):
            continue
        out.append(cls)
    return sorted(out, key=str.lower)


def build_armor_package(class_name: str, source: FpsSource, store, out_dir: Path,
                        generator: Optional[dict] = None):
    """Build + write ``<out_dir>/_armor/<class>/package.json``. ``None`` when
    the class is no armor/clothing record or has no convertible body geometry
    (a ``.cdf`` without ``CA_SKIN``/``CA_BONE`` mesh we can convert)."""
    from .manifest import write_manifest
    from .package import build_package
    piece = source.weapon(class_name)
    if piece is None or not is_armor_type(piece.item_type):
        return None
    body = export_body(source, store, piece)
    if body is None or not body.sha256:
        return None
    res = build_package("armor", piece, source.default_loadout(class_name), source,
                        store, store.path_of(body.sha256), generator=generator)
    res.locators = None  # bones are the placement source — nothing to cross-check
    res.manifest_bytes = write_manifest(
        res.manifest, out_dir / ARMOR_DIR / piece.class_name / PACKAGE_FILE)
    return res


__all__ = ["ARMOR_DIR", "is_armor_type", "is_armor_record", "armor_classes",
           "build_armor_package"]
