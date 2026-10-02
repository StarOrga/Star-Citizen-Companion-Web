"""EXTRACT: DataCore + P4K -> typed :class:`~.entity.EntityDef` facts.

The production :class:`~.entity.EntitySource`. Reuses the projections the
codex extract already uses (default loadout, port types, helper names), so a
placement's ``itemClass``/``portName`` are the exact keys of ``codex_items`` /
``codex_item_ports``.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..dataforge import DataForge
from ..dataforge_extract import (_as_list, _components_of, _default_loadout_of, _dig,
                                 _find_component, _find_geometry_path, _port_types, _to_int)
from ..geometry import helpers_from_cga_bytes, normalize_geometry_path
from ..hardpoints import port_helper_name
from .entity import EntityDef, LoadoutEntry, PortDef, loadout_from_dicts


class P4KReader:
    """Case-insensitive byte reads from an open ``scdatatools`` P4K."""

    def __init__(self, p4k) -> None:
        self.p4k = p4k
        self._idx = {i.filename.replace("\\", "/").lower(): i for i in p4k.infolist()}

    def exists(self, path: str) -> bool:
        return path.replace("\\", "/").lower() in self._idx

    def read(self, path: str) -> bytes:
        info = self._idx.get(path.replace("\\", "/").lower())
        if info is None:
            raise FileNotFoundError(path)
        return self.p4k.open(info).read()


def load_datacore(reader: P4KReader) -> DataForge:
    name = next(n for n in reader._idx if n.endswith(".dcb"))
    return DataForge(reader.read(name))


def ports_from_components(comps: List[Dict[str, Any]]) -> List[PortDef]:
    ipc = _find_component(comps, "SItemPortContainerComponentParams")
    ports = ipc.get("Ports") if ipc else None
    out: List[PortDef] = []
    for p in ports if isinstance(ports, list) else []:
        if not isinstance(p, dict):
            continue
        name = p.get("Name") or p.get("name")
        if not isinstance(name, str) or not name:
            continue
        out.append(PortDef(name=name, helper_name=port_helper_name(p),
                           min_size=_to_int(p.get("MinSize")), max_size=_to_int(p.get("MaxSize")),
                           types=_port_types(p), flags=_as_list(p.get("Flags"))))
    return out


def geometry_of(comps: List[Dict[str, Any]]) -> tuple:
    """``(geometry_path, material_path)`` — same lookup order as the codex's
    ``_hull_path`` (documented nesting first, then any .cga/.cgf on a component)."""
    geo = mtl = None
    for c in comps:
        g = c.get("Geometry")
        if isinstance(g, dict):
            p = _dig(g, "Geometry", "Geometry", "path")
            if isinstance(p, str) and p.lower().endswith((".cga", ".cgf")):
                geo = p
                m = _dig(g, "Geometry", "Material", "path")
                mtl = m if isinstance(m, str) and m.lower().endswith(".mtl") else None
                break
    if geo is None:
        for c in comps:
            geo = _find_geometry_path(c)
            if geo:
                break
    geo = normalize_geometry_path(geo)
    if mtl:
        mtl = mtl.replace("\\", "/").lstrip("/")
        mtl = mtl if mtl.lower().startswith("data/") else "Data/" + mtl
    elif geo:
        mtl = geo.rsplit(".", 1)[0] + ".mtl"
    return geo, mtl


class DataCoreSource:
    """:class:`~.entity.EntitySource` over a parsed DataCore + the P4K."""

    def __init__(self, df: DataForge, reader: P4KReader) -> None:
        self.df, self.reader = df, reader
        self._by_name = {rec.name.split(".", 1)[1].lower(): rec
                         for rec in df.records_by_type_name("EntityClassDefinition")
                         if "." in rec.name}
        self._entities: Dict[str, Optional[EntityDef]] = {}
        self._comps: Dict[str, List[Dict[str, Any]]] = {}
        self._helpers: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def components(self, class_name: str) -> List[Dict[str, Any]]:
        key = class_name.lower()
        if key not in self._comps:
            rec = self._by_name.get(key)
            try:
                self._comps[key] = _components_of(self.df.record_to_dict(rec, max_depth=10)) \
                    if rec else []
            except Exception:  # noqa: BLE001 — unresolvable record = no facts
                self._comps[key] = []
        return self._comps[key]

    def entity(self, class_name: str) -> Optional[EntityDef]:
        key = class_name.lower()
        if key in self._entities:
            return self._entities[key]
        rec = self._by_name.get(key)
        ent = None
        if rec is not None:
            comps = self.components(class_name)
            geo, mtl = geometry_of(comps)
            if geo and not self.reader.exists(geo):
                geo = None
            ad = (_find_component(comps, "SAttachableComponentParams") or {}).get("AttachDef") or {}
            ent = EntityDef(class_name=rec.name.split(".", 1)[1], guid=str(rec.guid),
                            geometry_path=geo, material_path=mtl,
                            item_type=ad.get("Type") or None, item_sub_type=ad.get("SubType") or None,
                            size=_to_int(ad.get("Size")), ports=ports_from_components(comps))
        self._entities[key] = ent
        return ent

    def default_loadout(self, class_name: str) -> List[LoadoutEntry]:
        return loadout_from_dicts(_default_loadout_of(self.components(class_name)))

    def helpers(self, geometry_path: str) -> Dict[str, Dict[str, Any]]:
        key = geometry_path.lower()
        if key not in self._helpers:
            try:
                self._helpers[key] = helpers_from_cga_bytes(self.reader.read(geometry_path))
            except Exception:  # noqa: BLE001 — unreadable mesh = no helpers
                self._helpers[key] = {}
        return self._helpers[key]
