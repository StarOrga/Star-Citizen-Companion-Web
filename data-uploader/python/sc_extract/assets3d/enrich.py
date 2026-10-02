"""Stage 3 — ENRICH: resolved ports + exported parts -> manifest placements.

Pure. Takes stage-1 :class:`~.entity.ResolvedPort` (CryEngine space) and the
stage-2 part map (geometry path -> :class:`~.parts.PartRef`) and produces the
final, web-ready :class:`~.manifest.Placement` rows: glTF-space transforms,
a display group, codex refs (class name, GUID, parent class) and port
metadata. The only place the axis conversion happens.
"""
from __future__ import annotations

from typing import Dict, List, Mapping, Optional

from .entity import EntityDef, ResolvedPort
from .manifest import Group, Placement, PortMeta
from .transforms import cry_to_gltf, rounded, to_pos_quat

# AttachDef.Type -> display group. Unknown types inherit the parent's group
# (a gimbal's gun is a weapon) and fall back to "other".
_TYPE_GROUP: Dict[str, Group] = {
    **{t: "weapons" for t in (
        "weapongun", "weaponmining", "weapondefensive", "turret", "turretbase",
        "weaponpersonal", "towingbeam", "tractorbeam", "salvagehead", "miningmodifier",
    )},
    **{t: "missiles" for t in ("missile", "missilelauncher", "bomb", "bomblauncher", "torpedo")},
    **{t: "components" for t in (
        "shield", "powerplant", "cooler", "quantumdrive", "jumpdrive", "radar",
        "lifesupportgenerator", "fuelintake", "fueltank", "quantumfueltank",
        "emp", "quantuminterdictiongenerator", "selfdestruct", "scanner", "transponder",
        "armor", "flightcontroller", "battery",
    )},
    **{t: "attachments" for t in (
        "weaponattachment", "ironsight", "barrel", "bottomattachment", "magazine",
        "light", "utility",
    )},
    **{t: "interior" for t in (
        "seat", "seataccess", "usable", "door", "bed", "display", "container",
        "cargo", "cargogrid", "seatdashboard", "doorpanel",
    )},
}


def group_of(item: Optional[EntityDef], port_types: List[str], parent: Optional[Group]) -> Group:
    """Display group from the installed item's type, else the port's accepted
    types, else the parent's group, else ``other``."""
    candidates = [item.item_type] if item and item.item_type else []
    candidates += port_types
    for t in candidates:
        g = _TYPE_GROUP.get((t or "").split(".")[0].lower())
        if g:
            return g
    return parent or "other"


def port_meta(rp: ResolvedPort) -> Optional[PortMeta]:
    p = rp.port
    if p is None:
        return None
    return {"minSize": p.min_size, "maxSize": p.max_size, "types": list(p.types),
            "flags": list(p.flags), "editable": p.editable}


def enrich(resolved: List[ResolvedPort], root: EntityDef,
           parts: Mapping[str, Optional[str]]) -> List[Placement]:
    """Manifest rows, in stage-1 order (parents before children).

    ``parts`` maps a geometry path to the part's sha256 (``None`` = that item
    has no exportable geometry). A child of an unplaceable parent stays
    unplaceable; a part never gets a sha without a transform.
    """
    out: List[Placement] = []
    groups: Dict[str, Group] = {}
    classes: Dict[str, str] = {}
    for rp in resolved:
        parent_group = groups.get(rp.parent_path or "")
        group = group_of(rp.item, rp.port.types if rp.port else [], parent_group)
        groups[rp.path] = group
        if rp.item_class:
            classes[rp.path] = rp.item_class
        pos = rot = None
        if rp.world is not None:
            p, q = to_pos_quat(cry_to_gltf(rp.world))
            pos, rot = rounded(p, 4), rounded(q, 6)
        geo = rp.item.geometry_path if rp.item else None
        sha = parts.get(geo) if geo and pos is not None else None
        out.append({
            "id": rp.path,
            "portName": rp.port_name,
            "helperName": rp.helper_name,
            "parentPort": rp.parent_path,
            "group": group,
            "itemClass": rp.item_class,
            "itemGuid": rp.item.guid if rp.item else None,
            "itemType": rp.item.item_type if rp.item else None,
            "itemSubType": rp.item.item_sub_type if rp.item else None,
            "itemSize": rp.item.size if rp.item else None,
            "parentClass": classes.get(rp.parent_path or "", root.class_name),
            "port": port_meta(rp),
            "loadout": "default" if rp.item_class else "empty",
            "partSha256": sha,
            "position": pos,
            "rotation": rot,
        })
    return out
