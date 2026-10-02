"""Entity package builder: resolve -> export parts -> enrich -> manifest.

Generic over ``kind`` ("ship" | "fps_weapon"). Ship-only extras (interior,
vehicle-XML ports) are wired in :mod:`sc_extract.assets3d.ships`.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from .. import glb_materials
from .enrich import enrich
from .entity import EntityDef, EntitySource, LoadoutEntry, PortDef, ResolvedPort, resolve_entity
from .manifest import (COORDINATE_SYSTEM, SCHEMA_VERSION, BlobRef, Kind, Manifest,
                       validate_manifest)
from .parts import PartRef, PartStore, glb_bounds, sha256_file

GENERATOR = "sc_extract.assets3d"
LOCATOR_TOLERANCE_M = 0.01


@dataclass
class PackageResult:
    manifest: Manifest
    resolved: List[ResolvedPort]
    part_refs: List[PartRef] = field(default_factory=list)
    root_bytes: int = 0
    interior_bytes: int = 0
    locators: Optional[dict] = None
    manifest_bytes: int = 0

    @property
    def unique_part_bytes(self) -> int:
        return sum(p["bytes"] for p in self.manifest["parts"].values())


def blob_ref(path: Optional[Path]) -> Optional[BlobRef]:
    if path is None or not path.exists():
        return None
    return {"sha256": sha256_file(path), "bytes": path.stat().st_size}


def export_parts(resolved: Sequence[ResolvedPort], store: PartStore) -> Dict[str, PartRef]:
    """One :class:`PartRef` per distinct geometry among PLACEABLE installed items."""
    refs: Dict[str, PartRef] = {}
    for rp in resolved:
        item = rp.item
        if item is None or not item.geometry_path or rp.world is None:
            continue
        if item.geometry_path not in refs:
            refs[item.geometry_path] = store.export(item.geometry_path, item.material_path)
    return refs


def build_manifest(kind: Kind, root: EntityDef, resolved: List[ResolvedPort],
                   parts: Dict[str, PartRef], root_ref: Optional[BlobRef],
                   root_bounds: Optional[dict] = None, interior: Optional[BlobRef] = None,
                   generator: Optional[dict] = None) -> Manifest:
    placements = enrich(resolved, root, {g: r.sha256 for g, r in parts.items()})
    used = {p["partSha256"] for p in placements if p["partSha256"]}
    part_info = {}
    for ref in parts.values():
        if ref.sha256 in used and ref.sha256 not in part_info:
            part_info[ref.sha256] = {"bytes": ref.bytes, "geometryPath": ref.geometry_path,
                                     "bounds": ref.bounds}
    root_out = None
    if root_ref:
        root_out = {**root_ref, "bounds": root_bounds}
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": kind,
        "coordinateSystem": COORDINATE_SYSTEM,
        "entity": {"className": root.class_name, "guid": root.guid},
        "root": root_out,
        "interior": interior,
        "parts": part_info,
        "placements": placements,
        "generator": {"name": GENERATOR, **(generator or {})},
    }


def check_locators(manifest: Manifest, root_glb: Path,
                   tolerance: float = LOCATOR_TOLERANCE_M) -> dict:
    """Compare root-level placements against the root GLB's own locator nodes
    (``scenes[].extras.hardpoints``, written by hull3d from the converter's
    output). They are two independent derivations of the same point — DataCore
    + .cga matrices vs. cgf-converter's node tree — so agreement proves the
    axis conversion."""
    gltf, _ = glb_materials.read_glb(root_glb)
    scenes = gltf.get("scenes") or [{}]
    locs = (scenes[gltf.get("scene", 0)].get("extras") or {}).get("hardpoints") or {}
    low = {k.lower(): v for k, v in locs.items()}
    checked, worst, failures = 0, 0.0, []
    for p in manifest["placements"]:
        if p["parentPort"] is not None or p["position"] is None or not p["helperName"]:
            continue
        ref = low.get(p["helperName"].lower())
        if ref is None:
            continue
        d = math.dist(ref, p["position"])
        checked += 1
        worst = max(worst, d)
        if d > tolerance:
            failures.append({"id": p["id"], "error_m": round(d, 4)})
    return {"checked": checked, "max_error_m": round(worst, 5), "tolerance_m": tolerance,
            "failures": failures[:20], "ok": checked > 0 and not failures}


def build_package(kind: Kind, root: EntityDef, loadout: Sequence[LoadoutEntry],
                  source: EntitySource, store: PartStore, root_glb: Optional[Path],
                  extra_ports: Sequence[PortDef] = (), interior_glb: Optional[Path] = None,
                  generator: Optional[dict] = None) -> PackageResult:
    """The whole pipeline for one entity. Raises ``ValueError`` on an invalid
    manifest (a bug, never data-dependent)."""
    resolved = resolve_entity(root, loadout, source, extra_ports)
    parts = export_parts(resolved, store)
    root_ref = blob_ref(root_glb)
    interior = blob_ref(interior_glb)
    manifest = build_manifest(kind, root, resolved, parts, root_ref,
                              glb_bounds(root_glb) if root_ref else None, interior, generator)
    errors = validate_manifest(manifest)
    if errors:
        raise ValueError("invalid manifest: " + "; ".join(errors[:5]))
    return PackageResult(
        manifest=manifest, resolved=resolved, part_refs=list(parts.values()),
        root_bytes=root_ref["bytes"] if root_ref else 0,
        interior_bytes=interior["bytes"] if interior else 0,
        locators=check_locators(manifest, root_glb) if root_ref else None,
    )
