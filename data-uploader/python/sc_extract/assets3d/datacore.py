"""EXTRACT: DataCore + P4K -> typed :class:`~.entity.EntityDef` facts.

The production :class:`~.entity.EntitySource`. Reuses the projections the
codex extract already uses (default loadout, port types, helper names), so a
placement's ``itemClass``/``portName`` are the exact keys of ``codex_items`` /
``codex_item_ports``.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from .. import stage_timing
from ..dataforge import DataForge
from ..dataforge_extract import (_as_list, _components_of, _default_loadout_of, _dig,
                                 _find_component, _find_geometry_path, _port_types, _to_int)
from ..geometry import helpers_from_cga_bytes, normalize_geometry_path
from ..hardpoints import port_helper_name
from .entity import EntityDef, LoadoutEntry, PortDef, loadout_from_dicts
from .transforms import cry_to_gltf, from_pos_quat, to_pos_quat


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
        with stage_timing.timed("~p4k-read"):
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
                           types=port_types_with_subtypes(p), flags=_as_list(p.get("Flags"))))
    return out


def port_types_with_subtypes(p: Dict[str, Any]) -> List[str]:
    """Accepted types as ``Type.SubType`` (one per subtype, bare ``Type`` when
    none) — the format :func:`~.ships.vehicle_ports` already emits. The codex's
    ``_port_types`` drops subtypes, which loses e.g. optic vs. magazine on an
    FPS weapon (every one of those ports is ``WeaponAttachment``)."""
    out: List[str] = []
    types = p.get("Types") or p.get("types")
    for t in types if isinstance(types, list) else []:
        if not isinstance(t, dict):
            continue
        ty = t.get("Type") or t.get("type")
        if not ty:
            continue
        subs = t.get("SubTypes") or t.get("subTypes") or []
        subs = subs.split(",") if isinstance(subs, str) else subs
        subs = [x.strip() for x in subs if isinstance(x, str) and x.strip()
                and x.strip().upper() != "UNDEFINED"]
        out += [f"{ty}.{x}" for x in subs] or [str(ty)]
    return out or _port_types(p)


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

    def __init__(self, df: DataForge, reader: P4KReader,
                 node_helpers: Optional[Callable[..., Dict[str, Dict[str, Any]]]] = None) -> None:
        """``node_helpers`` (normally ``PartStore.helpers``) supplies helper
        transforms from the converter's node tree — the tree the published
        GLBs come from, so it stays the primary source here (its conversion is
        reused by ``PartStore.export``). The ``.cga`` chunk scan is the
        fallback; since #643 it reads LIVE 4.x node names again and agrees
        with the converter to 5e-5 m on all 273 AEGS_Gladius nodes."""
        self.df, self.reader = df, reader
        self.node_helpers = node_helpers
        self._by_name = {rec.name.split(".", 1)[1].lower(): rec
                         for rec in df.records_by_type_name("EntityClassDefinition")
                         if "." in rec.name}
        self._entities: Dict[str, Optional[EntityDef]] = {}
        self._comps: Dict[str, List[Dict[str, Any]]] = {}
        self._helpers: Dict[str, Dict[str, Dict[str, Any]]] = {}
        # geometry -> its entity's material, so `node_helpers` can run the
        # conversion `PartStore.export` will need anyway (one convert, not two).
        self._mtl_by_geo: Dict[str, Optional[str]] = {}

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
            if geo:
                self._mtl_by_geo.setdefault(geo.lower(), mtl)
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
        """Helper transforms in glTF space (the space every stage after
        RESOLVE works in)."""
        key = geometry_path.lower()
        if key not in self._helpers:
            out: Dict[str, Dict[str, Any]] = {}
            if self.node_helpers is not None:
                mtl = self._mtl_by_geo.get(key)
                out = self.node_helpers(geometry_path, mtl) if mtl else \
                    self.node_helpers(geometry_path)
            if not out:
                try:
                    cry = helpers_from_cga_bytes(self.reader.read(geometry_path))
                except Exception:  # noqa: BLE001 — unreadable mesh = no helpers
                    cry = {}
                out = {name: _cry_helper_to_gltf(h) for name, h in cry.items()}
            self._helpers[key] = out
        return self._helpers[key]


def _cry_helper_to_gltf(h: Dict[str, Any]) -> Dict[str, Any]:
    m = cry_to_gltf(from_pos_quat(h["position"], h.get("rotation")))
    pos, quat = to_pos_quat(m)
    return {"position": pos, "rotation": quat}
