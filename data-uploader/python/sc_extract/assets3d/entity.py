"""Stage 1 — RESOLVE: entity definitions + default loadout -> placed ports.

Pure geometry. Input is typed DataCore facts (:class:`EntityDef`,
:class:`LoadoutEntry`) plus a :class:`EntitySource` that answers "what is
class X" and "which helper nodes does mesh Y have". Output is one
:class:`ResolvedPort` per port (filled or empty), with its world transform
composed in CryEngine space through every nesting level (ship -> gimbal ->
gun, rack -> missile, weapon -> optic). No naming heuristics beyond the
exact-match rule of :mod:`sc_extract.hardpoints`; nothing here touches the
P4K, so it is unit-testable with dicts.

Generic over the root: a ship hull and an FPS weapon body are both just an
``EntityDef`` with a geometry path and ports.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, Sequence

from ..hardpoints import resolve_hardpoint_transforms
from .transforms import Mat4, from_pos_quat, identity, matmul

# Nesting cap — matches dataforge_extract._LOADOUT_MAX_DEPTH (measured depth 2).
MAX_DEPTH = 8


@dataclass
class PortDef:
    """One item port as the DataCore (or a vehicle XML) declares it."""
    name: str
    helper_name: Optional[str] = None
    min_size: Optional[int] = None
    max_size: Optional[int] = None
    types: List[str] = field(default_factory=list)
    flags: List[str] = field(default_factory=list)

    @property
    def editable(self) -> bool:
        """CIG marks locked ports with an ``uneditable`` flag token."""
        return not any("uneditable" in f.lower() for f in self.flags)


@dataclass
class EntityDef:
    """What the DataCore says about one entity class (ship, weapon, item)."""
    class_name: str
    guid: Optional[str] = None
    geometry_path: Optional[str] = None   # Data/-rooted .cga/.cgf, or None
    material_path: Optional[str] = None   # Data/-rooted .mtl, or None
    item_type: Optional[str] = None       # AttachDef.Type, e.g. WeaponGun
    item_sub_type: Optional[str] = None
    size: Optional[int] = None
    ports: List[PortDef] = field(default_factory=list)


@dataclass
class LoadoutEntry:
    """One default-loadout entry; ``children`` = the installed item's own fit."""
    port_name: str
    class_name: Optional[str]
    children: List["LoadoutEntry"] = field(default_factory=list)


class EntitySource(Protocol):
    def entity(self, class_name: str) -> Optional[EntityDef]: ...

    def helpers(self, geometry_path: str) -> Dict[str, Dict[str, Any]]: ...


@dataclass
class ResolvedPort:
    """A port after stage 1. ``world`` is CryEngine space, root-relative."""
    path: str                         # "hardpoint_a/hardpoint_class_2" — unique id
    port_name: str
    parent_path: Optional[str]
    depth: int
    port: Optional[PortDef]           # metadata, when the parent declares it
    item: Optional[EntityDef]         # installed default item (None = empty port)
    item_class: Optional[str]         # class name even when the record is unresolvable
    helper_name: Optional[str] = None
    match: Optional[str] = None       # hardpoints.resolve_* source: helper|portName
    world: Optional[Mat4] = None      # None = no helper found -> not placeable


def loadout_from_dicts(entries: Any) -> List[LoadoutEntry]:
    """``dataforge_extract._loadout_entries`` output -> typed entries."""
    out: List[LoadoutEntry] = []
    for e in entries if isinstance(entries, list) else []:
        if not isinstance(e, dict) or not isinstance(e.get("itemPortName"), str):
            continue
        out.append(LoadoutEntry(
            port_name=e["itemPortName"],
            class_name=e.get("entityClassName") or None,
            children=loadout_from_dicts(e.get("entries")),
        ))
    return out


def resolve_entity(root: EntityDef, loadout: Sequence[LoadoutEntry], source: EntitySource,
                   extra_ports: Sequence[PortDef] = ()) -> List[ResolvedPort]:
    """Every port of ``root`` (recursively), placed where the meshes say.

    ``extra_ports`` supplements the root's own DataCore ports — ships declare
    most of theirs in the vehicle implementation XML, not the entity record.
    Ports the loadout fills come first, in loadout order; declared-but-empty
    ports follow (``item=None``) so a UI can still show "free slot, accepts X".
    """
    out: List[ResolvedPort] = []
    _resolve(root, list(root.ports) + list(extra_ports), loadout, source,
             identity(), None, 0, out)
    return out


def _resolve(parent: EntityDef, ports: List[PortDef], loadout: Sequence[LoadoutEntry],
             source: EntitySource, parent_world: Optional[Mat4], parent_path: Optional[str],
             depth: int, out: List[ResolvedPort]) -> None:
    if depth > MAX_DEPTH:
        return
    by_name = {p.name.lower(): p for p in ports if p.name}
    helpers = source.helpers(parent.geometry_path) if parent.geometry_path else {}
    names = [e.port_name for e in loadout] + [p.name for p in ports]
    transforms = resolve_hardpoint_transforms(
        helpers,
        [{"portName": p.name, "helperName": p.helper_name} for p in ports],
        names, include_mesh_hardpoints=False, max_entries=10_000,
    ) if helpers else {}

    def place(port_name: str) -> tuple:
        t = transforms.get(port_name)
        if t is None or parent_world is None:
            return None, None, None
        local = from_pos_quat(t["position"], t.get("rotation"))
        return matmul(parent_world, local), t["helper"], t["source"]

    seen = set()
    for entry in loadout:
        key = entry.port_name.lower()
        if key in seen:
            continue
        seen.add(key)
        path = f"{parent_path}/{entry.port_name}" if parent_path else entry.port_name
        item = source.entity(entry.class_name) if entry.class_name else None
        world, helper, match = place(entry.port_name)
        out.append(ResolvedPort(path=path, port_name=entry.port_name, parent_path=parent_path,
                                depth=depth, port=by_name.get(key), item=item,
                                item_class=entry.class_name, helper_name=helper,
                                match=match, world=world))
        if item is not None:
            _resolve(item, item.ports, entry.children, source, world, path, depth + 1, out)
    for p in ports:
        if p.name.lower() in seen:
            continue
        seen.add(p.name.lower())
        path = f"{parent_path}/{p.name}" if parent_path else p.name
        world, helper, match = place(p.name)
        out.append(ResolvedPort(path=path, port_name=p.name, parent_path=parent_path,
                                depth=depth, port=p, item=None, item_class=None,
                                helper_name=helper, match=match, world=world))
