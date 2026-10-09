"""Ship wiring for the generic entity package: vehicle-XML ports, interior
layer, on-disk layout.

On disk (all under the export ``--out``):

* ``<ship_id>/models/<ship_id>_<paint>.glb`` — hull, unchanged hull3d contract
* ``_parts/<sha256>.glb``                    — shared parts (+ ``index.json`` cache)
* ``_interiors/<sha256>.glb``                — optional interior layer
* ``<ship_id>/package.json``                 — the manifest
"""
from __future__ import annotations

import io
import os
import shutil
from pathlib import Path
from typing import Any, List, Optional

from .. import glb_materials
from ..dataforge_extract import _find_component
from .datacore import DataCoreSource, P4KReader
from .entity import PortDef
from .package import PackageResult, build_package
from .parts import PartStore, keep_only_interior, publish_blob, sha256_file

PACKAGE_FILE = "package.json"


def vehicle_ports(source: DataCoreSource, reader: P4KReader, class_name: str) -> List[PortDef]:
    """Item ports a ship declares in its vehicle implementation XML
    (``<Part name=…><ItemPort minSize maxSize flags><Types><Type type subtypes>``).
    The ship record's own port container is structural-only, so this is where
    a ship's port sizes/types live. Best-effort: ``[]`` on any failure."""
    vcp = _find_component(source.components(class_name), "VehicleComponentParams") or {}
    path = vcp.get("vehicleDefinition")
    if not isinstance(path, str) or not path:
        return []
    path = path.replace("\\", "/").lstrip("/")
    path = path if path.lower().startswith("data/") else "Data/" + path
    try:
        blob = reader.read(path)
        if blob[:7] == b"CryXmlB":
            from scdatatools.engine.cryxml import etree_from_cryxml_file
            root = etree_from_cryxml_file(io.BytesIO(blob)).getroot()
        else:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(blob)
    except Exception:  # noqa: BLE001
        return []
    out: List[PortDef] = []
    for part in root.iter("Part"):
        ip = next((c for c in part if c.tag == "ItemPort"), None)
        name = part.get("name")
        if ip is None or not name:
            continue
        a = {k.lower(): v for k, v in ip.attrib.items()}
        types = []
        for t in ip.iter("Type"):
            ty = t.get("type")
            if ty:
                subs = [s for s in (t.get("subtypes") or "").split(",") if s.strip()]
                types += [f"{ty}.{s.strip()}" for s in subs] or [ty]
        out.append(PortDef(name=name, helper_name=a.get("helper") or None,
                           min_size=_int(a.get("minsize")), max_size=_int(a.get("maxsize")),
                           types=types, flags=[f for f in (a.get("flags") or "").split() if f]))
    return out


def _int(v: Any) -> Optional[int]:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def export_interior(store: PartStore, hull_cga: str, paint_mtl: Optional[str],
                    out_dir: Path, optimize, simplify_error: float = 0.0,
                    raw_glb: Optional[Path] = None) -> Optional[Path]:
    """The geometry hull3d strips (interior materials), as its own GLB.
    Content-addressed into ``out_dir/<sha>.glb``; ``None`` when the ship has
    no interior geometry. ``raw_glb`` = a copy of the hull's own raw,
    un-rigged converter output (same mesh, same paint) — it is consumed, and
    saves converting the whole hull a second time."""
    # Same mesh, same paint, same pipeline → same interior: reuse it (also
    # across patches, via the primed store index — see build_cache).
    src = store.src_key([hull_cga, hull_cga + "m", paint_mtl], extra=f"interior|{simplify_error}")
    hit, cached = store.cached_blob("interior:" + hull_cga, src, out_dir)
    if hit:
        if raw_glb is not None:
            raw_glb.unlink(missing_ok=True)
        store.log("info", "  interior: reused")
        return cached
    scratch = store.work / "interior"
    shutil.rmtree(scratch, ignore_errors=True)
    result: Optional[Path] = None
    try:
        if raw_glb is not None and raw_glb.exists():
            scratch.mkdir(parents=True, exist_ok=True)
            raw = scratch / "hull_raw.glb"
            os.replace(raw_glb, raw)
        else:
            raw = store.convert_raw(hull_cga, paint_mtl, scratch)
        if keep_only_interior(raw, store.log) == 0:
            store.remember_blob("interior:" + hull_cga, src, None)
            return None
        glb_materials.strip_to_geometry(raw, store.log)
        opt = scratch / "interior_opt.glb"
        optimize(raw, opt, 256, simplify_error)
        sha = sha256_file(opt)
        out_dir.mkdir(parents=True, exist_ok=True)
        dest = out_dir / f"{sha}.glb"
        publish_blob(opt, dest)
        result = dest
        store.remember_blob("interior:" + hull_cga, src, dest)
        return result
    finally:
        if not store.keep_work:
            shutil.rmtree(scratch, ignore_errors=True)


def build_ship_package(ship_id: str, source: DataCoreSource, reader: P4KReader,
                       store: PartStore, hull_glb: Optional[Path], ship_dir: Path,
                       interior_glb: Optional[Path] = None,
                       generator: Optional[dict] = None) -> Optional[PackageResult]:
    """Build + write ``<ship_dir>/package.json``. ``None`` if the DataCore has
    no entity record for ``ship_id``."""
    from .manifest import write_manifest
    root = source.entity(ship_id)
    if root is None:
        return None
    res = build_package("ship", root, source.default_loadout(ship_id), source, store,
                        hull_glb, extra_ports=vehicle_ports(source, reader, ship_id),
                        interior_glb=interior_glb, generator=generator)
    res.manifest_bytes = write_manifest(res.manifest, ship_dir / PACKAGE_FILE)
    return res


__all__ = ["vehicle_ports", "export_interior", "build_ship_package", "PACKAGE_FILE"]
