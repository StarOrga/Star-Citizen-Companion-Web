"""Standalone ship-item packages (``kind: "item"``): a component, ship weapon,
missile, rack or gimbal on its own, for the item detail page.

The root GLB is the item's OWN part from the shared ``_parts/`` store — the
very sha a ship package's placement references for that item (same geometry
path, same :class:`PartStore` cache), so nothing is stored twice and the web
can link "docked in ship" <-> "item page" by ``partSha256`` / ``itemClass``.
Placements are the item's own ports (rack -> missiles, gimbal -> gun).

On disk: ``<out>/_items/<ItemClassName>/package.json``.
"""
from __future__ import annotations

from pathlib import Path
from typing import List, Optional

from ..dataforge_extract import _is_catalog_entity

ITEMS_DIR = "_items"
PACKAGE_FILE = "package.json"
# AttachDef.Type of the ship items that get a standalone package.
ITEM_TYPES = frozenset({
    "WeaponGun", "WeaponMining", "WeaponDefensive", "Turret", "TurretBase",
    "MissileLauncher", "Missile", "Torpedo", "Bomb", "BombLauncher",
    "Shield", "PowerPlant", "Cooler", "QuantumDrive", "JumpDrive", "Radar",
    "QuantumInterdictionGenerator", "EMP", "TractorBeam", "TowingBeam",
    "SalvageHead", "MiningModifier",
})
# Ship items live under scitem/ships (weapons, missiles, components, mounts).
_ITEM_RECORD_DIR = "/scitem/ships/"


def is_item_record(filename: str, class_name: str) -> bool:
    """Record-level rule: a ship-item record folder and a player-facing class
    name (same ``_is_catalog_entity`` filter the codex catalogs use)."""
    f = filename.replace("\\", "/").lower()
    return _ITEM_RECORD_DIR in f and _is_catalog_entity(class_name)


def item_classes(source) -> List[str]:
    """Every ship item of :data:`ITEM_TYPES` with geometry in the P4K, sorted."""
    out = []
    for rec in source._by_name.values():
        cls = rec.name.split(".", 1)[1]
        if not is_item_record(str(getattr(rec, "filename", "") or ""), cls):
            continue
        e = source.entity(cls)
        if e is not None and e.item_type in ITEM_TYPES and e.geometry_path:
            out.append(cls)
    return sorted(out, key=str.lower)


def build_item_package(class_name: str, source, store, out_dir: Path,
                       generator: Optional[dict] = None):
    """Build + write ``<out_dir>/_items/<class>/package.json``; ``None`` when
    the class has no record or no geometry."""
    from .manifest import write_manifest
    from .package import build_package
    item = source.entity(class_name)
    if item is None or not item.geometry_path:
        return None
    part = store.export(item.geometry_path, item.material_path)
    root_glb = store.path_of(part.sha256) if part.sha256 else None
    res = build_package("item", item, source.default_loadout(class_name), source, store,
                        root_glb, generator=generator)
    res.locators = None  # parts carry no hull3d locator set — nothing to cross-check
    res.manifest_bytes = write_manifest(
        res.manifest, out_dir / ITEMS_DIR / item.class_name / PACKAGE_FILE)
    return res


__all__ = ["ITEMS_DIR", "ITEM_TYPES", "is_item_record", "item_classes", "build_item_package"]
