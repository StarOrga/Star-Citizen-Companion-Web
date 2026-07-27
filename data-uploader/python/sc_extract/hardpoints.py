"""Hardpoint POSITIONS: item ports -> mesh helper-node transforms.

The DataCore knows *that* a port exists and which mesh helper it attaches to
(``SItemPortDef.AttachmentImplementation.Helper.Helper.Name``); the ``.cga`` mesh
knows *where* that helper sits on the hull (see :mod:`sc_extract.geometry`).
Joining the two is what gives the Codex "this gun sits on the left wing".

Everything here is pure (dict in, dict out) so it can be unit-tested without a
147 GB ``Data.p4k``. Two rules the whole module is built around:

1. **Exact name matches only.** A port resolves to a helper node when the
   DataCore's helper name — or, failing that, the port name itself — equals a
   node name in the mesh (case-insensitively). No fuzzy/prefix matching: a
   near-miss would produce a plausible-looking marker on the WRONG part of the
   hull, which is worse than no marker at all.
2. **Missing data yields nothing.** Every function returns empty/``None``
   instead of guessing, so a ship whose mesh we cannot read simply has no
   positions and the UI keeps its previous behaviour.

Coordinate convention (kept identical end-to-end, documented for the web side):
positions are **metres in the mesh's own model space**, CryEngine axes —
``+X`` = right/starboard, ``+Y`` = forward/nose, ``+Z`` = up. Rotations are
``[x, y, z, w]`` quaternions in the same space. Nothing is re-centred or
rescaled here; the accompanying ``hardpointFrame`` (the ship's bounding box in
that very space) is what lets a consumer normalise to 0..1 without knowing the
absolute units.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

# Node names that are hardpoints by naming convention (CryEngine ship meshes
# prefix them). Used to include mesh helpers no projected port references yet —
# the names are real data, so they are safe to expose.
_HARDPOINT_NAME_RE = re.compile(r"^(?:hardpoint|hp)[_.]", re.IGNORECASE)

# Bound the per-ship transform map so one mesh with thousands of helpers cannot
# bloat the ship payload. Port-referenced entries are kept first (they are what
# the UI looks up); mesh-only extras fill the remainder in name order.
MAX_TRANSFORMS = 512

# How far outside the ship's bounding box a hardpoint may sit before we stop
# trusting that box as a shared frame (fraction of the box's own extent).
_FRAME_TOL_FRACTION = 0.1
_FRAME_TOL_MIN_M = 0.5
# Padding applied when the frame has to be derived from the points themselves.
_FRAME_PAD_FRACTION = 0.05
_FRAME_MIN_SPAN_M = 0.5


def port_helper_name(port: Any) -> Optional[str]:
    """The mesh helper node a raw ``SItemPortDef`` attaches to, if it names one.

    Primary path is the documented nesting
    ``AttachmentImplementation.Helper.Helper.Name``. Because that nesting has
    moved between patches, we fall back to a bounded deep search for a ``Name``
    string underneath any ``Helper``-ish key. A wrong guess cannot introduce a
    wrong coordinate — the caller only accepts names that exist verbatim in the
    mesh's node table.
    """
    if not isinstance(port, dict):
        return None
    direct = _dig(port, "AttachmentImplementation", "Helper", "Helper", "Name")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    found = _helper_name_deep(port, 0)
    return found


def _helper_name_deep(node: Any, depth: int, _max_depth: int = 8) -> Optional[str]:
    """First ``Name``/``name`` string found under a ``Helper``-keyed sub-tree."""
    if depth > _max_depth:
        return None
    if isinstance(node, dict):
        for key, value in node.items():
            if not isinstance(key, str):
                continue
            if "helper" in key.lower():
                name = _first_name(value, 0)
                if name:
                    return name
        for value in node.values():
            found = _helper_name_deep(value, depth + 1, _max_depth)
            if found:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _helper_name_deep(item, depth + 1, _max_depth)
            if found:
                return found
    return None


def _first_name(node: Any, depth: int, _max_depth: int = 4) -> Optional[str]:
    if depth > _max_depth:
        return None
    if isinstance(node, str):
        return node.strip() or None
    if isinstance(node, dict):
        for key in ("Name", "name"):
            val = node.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
        for val in node.values():
            found = _first_name(val, depth + 1, _max_depth)
            if found:
                return found
    return None


def _dig(node: Any, *keys: str) -> Any:
    for key in keys:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def resolve_hardpoint_transforms(
    helpers: Dict[str, Dict[str, Any]],
    item_ports: Iterable[Dict[str, Any]] = (),
    loadout_port_names: Iterable[Optional[str]] = (),
    include_mesh_hardpoints: bool = True,
    max_entries: int = MAX_TRANSFORMS,
) -> Dict[str, Dict[str, Any]]:
    """``portName -> {position, rotation, helper, source}`` for one entity.

    ``helpers`` is :func:`sc_extract.geometry.helpers_from_cga_bytes` output.
    ``item_ports`` are already-projected port dicts (``portName`` + optional
    ``helperName``); ``loadout_port_names`` are the ``itemPortName`` values of
    the default loadout — on ships those are usually the ONLY names the weapon /
    shield / thruster mounts appear under, because the ship entity's own
    ``SItemPortContainerComponentParams`` is structural-only.

    ``source`` records how the match was made and is deliberately part of the
    contract: ``helper`` (DataCore named the node), ``portName`` (the port name
    is itself a node name) or ``mesh`` (a ``hardpoint_*`` node no port
    references — real geometry, no port attached).
    """
    if not helpers:
        return {}
    index = {name.lower(): name for name in helpers}
    out: Dict[str, Dict[str, Any]] = {}

    def take(port_name: Optional[str], helper_name: Optional[str], source: str) -> bool:
        if not port_name or port_name in out:
            return False
        node = index.get((helper_name or "").lower())
        if node is None:
            return False
        entry = helpers.get(node)
        if not isinstance(entry, dict) or not entry.get("position"):
            return False
        out[port_name] = {
            "position": entry["position"],
            "rotation": entry.get("rotation"),
            "helper": node,
            "source": source,
        }
        return True

    ports = [p for p in item_ports if isinstance(p, dict)]
    for port in ports:
        name = _clean(port.get("portName"))
        if not take(name, _clean(port.get("helperName")), "helper"):
            take(name, name, "portName")
    for raw in loadout_port_names:
        name = _clean(raw)
        take(name, name, "portName")

    if include_mesh_hardpoints:
        extras = sorted(n for n in helpers if _HARDPOINT_NAME_RE.match(n) and n not in out)
        for node in extras:
            if len(out) >= max_entries:
                break
            take(node, node, "mesh")

    if len(out) <= max_entries:
        return out
    # Keep the port-referenced entries (they are what the UI resolves) and drop
    # the surplus deterministically rather than truncating an arbitrary slice.
    ranked = sorted(out.items(), key=lambda kv: (kv[1]["source"] == "mesh", kv[0]))
    return dict(ranked[:max_entries])


def _clean(value: Any) -> Optional[str]:
    return value.strip() or None if isinstance(value, str) else None


def hardpoint_frame(
    positions: Sequence[Sequence[float]],
    dims: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """The box the positions should be drawn in — the shared reference frame.

    Prefers the hull's own bounding box (``dims['min']``/``['max']``, parsed from
    the same ``.cga``) so a marker's relative position matches the real hull.
    That box comes from a heuristic chunk scan though, so it is only trusted when
    every hardpoint actually lies inside it (with a small tolerance). Otherwise
    the two are not in a common frame and we fall back to the extent of the
    points themselves, flagged ``source='ports'`` so the UI can say "approximate".
    """
    pts = [p for p in positions if _is_vec3(p)]
    if not pts:
        return None
    pmin = [min(p[i] for p in pts) for i in range(3)]
    pmax = [max(p[i] for p in pts) for i in range(3)]

    bmin, bmax = _box(dims)
    if bmin is not None and bmax is not None:
        tol = [
            max(_FRAME_TOL_MIN_M, _FRAME_TOL_FRACTION * abs(bmax[i] - bmin[i]))
            for i in range(3)
        ]
        inside = all(
            bmin[i] - tol[i] <= pmin[i] and pmax[i] <= bmax[i] + tol[i]
            for i in range(3)
        )
        if inside:
            return {
                "min": [round(v, 4) for v in bmin],
                "max": [round(v, 4) for v in bmax],
                "source": "bbox",
            }

    span = [max(pmax[i] - pmin[i], _FRAME_MIN_SPAN_M) for i in range(3)]
    pad = [s * _FRAME_PAD_FRACTION for s in span]
    return {
        "min": [round(pmin[i] - pad[i], 4) for i in range(3)],
        "max": [round(pmax[i] + pad[i], 4) for i in range(3)],
        "source": "ports",
    }


def _box(dims: Optional[Dict[str, Any]]) -> Tuple[Optional[List[float]], Optional[List[float]]]:
    if not isinstance(dims, dict):
        return None, None
    bmin, bmax = dims.get("min"), dims.get("max")
    if not (_is_vec3(bmin) and _is_vec3(bmax)):
        return None, None
    if any(bmax[i] <= bmin[i] for i in range(3)):
        return None, None
    return [float(v) for v in bmin], [float(v) for v in bmax]


def _is_vec3(value: Any) -> bool:
    return (
        isinstance(value, (list, tuple))
        and len(value) == 3
        and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in value)
        and all(v == v for v in value)  # reject NaN
    )
