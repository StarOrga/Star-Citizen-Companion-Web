"""CLI driver for the silhouette build — the sibling cached step to the ship
3D-hull build (`ship_export.py`), but for EVERY entity kind that gets a
silhouette (ship / weapon / component / armor).

Reads the manifest `dataforge_extract.py` writes (`silhouettes/_build_manifest.json`,
via `_write_silhouette_manifest`), converts each distinct mesh once through
`SilhouetteExporter` (cached by mesh content hash + tool version — a re-run
after a patch that touched nothing about the mesh only pays a hash lookup),
and writes one contract-shaped JSON row per entity to
`<out>/silhouettes/<kind>__<class_name>.json`, which `catalog-bridge.ts`'s
`codex_silhouettes` phase then uploads.

CLI:
    python -m sc_extract.silhouette_build --p4k "...\\Data.p4k" --out ./out \\
        --converter ./tools/cgf-converter-2.exe --tool-version 0.31.0 \\
        --build-json '{"channel":"LIVE","patchVersion":"4.9.0","buildNumber":"123"}'
"""
from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path
from typing import Any, Dict

# Note I (wave1-redteam.md): reuse the ONE `_safe_filename` `dataforge_extract.py`
# already writes ships/weapons/components/items with — a second, differently
# behaved implementation here meant a class name with a `.` in it (or any
# other char outside dataforge_extract's own keep-set) resolved to a
# DIFFERENT filename than the one the entity's own JSON was written under,
# so `_ship_anchor_inputs` silently read back no anchors/unresolved for it.
from .dataforge_extract import _safe_filename


def _ship_anchor_inputs(out_dir: Path, class_name: str) -> Dict[str, Any]:
    """Pull `hardpointTransforms` / `hardpointFrame` / port names back out of
    the already-written `ships/<class>.json` — the extractor resolved these
    from the SAME hull mesh via `hardpoints.py` already; the silhouette build
    only re-projects them onto the raster frame, it does not re-derive them."""
    path = out_dir / "ships" / f"{_safe_filename(class_name)}.json"
    if not path.exists():
        return {"frame": None, "transforms": {}, "port_names": ()}
    try:
        ship = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — missing anchor inputs, not a fatal error
        return {"frame": None, "transforms": {}, "port_names": ()}
    port_names = [p.get("portName") for p in (ship.get("itemPorts") or [])]
    port_names += [e.get("itemPortName") for e in (ship.get("defaultLoadout") or [])]
    return {
        "frame": ship.get("hardpointFrame"),
        "transforms": ship.get("hardpointTransforms") or {},
        "port_names": tuple(port_names),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Silhouette build for ships/weapons/components/armor")
    ap.add_argument("--p4k", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path,
                    help="extractor out_dir (reads silhouettes/_build_manifest.json, "
                         "writes silhouettes/<kind>__<class>.json)")
    ap.add_argument("--converter", required=True, type=Path)
    ap.add_argument("--tool-version", required=True)
    ap.add_argument("--build-json", required=True,
                    help='{"channel":"LIVE","patchVersion":"4.9.0","buildNumber":"..."}')
    ap.add_argument("--tolerance-m", type=float, default=0.15)
    ap.add_argument("--keep-work", action="store_true")
    args = ap.parse_args()

    def log(level: str, msg: str) -> None:
        print(f"[{level}] {msg}", flush=True)

    manifest_path = args.out / "silhouettes" / "_build_manifest.json"
    if not manifest_path.exists():
        log("warn", f"no silhouette manifest at {manifest_path} — nothing to build")
        return 0
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entities = manifest.get("entities", [])
    if not entities:
        log("info", "silhouette manifest is empty — nothing to build")
        return 0
    build: Dict[str, Any] = json.loads(args.build_json)

    from .p4k_compat import apply_p4k_compat
    apply_p4k_compat()
    from scdatatools.p4k import P4KFile
    from .silhouette_export import SilhouetteExportConfig, SilhouetteExporter

    log("info", f"opening {args.p4k}")
    p4k = P4KFile(str(args.p4k))
    log("info", f"opened: {len(p4k.namelist())} entries; {len(entities)} entities to silhouette")

    cfg = SilhouetteExportConfig(
        cgf_converter=args.converter,
        work_dir=args.out / "_silhouette_work",
        cache_dir=args.out / "silhouette_cache",
        tool_version=args.tool_version,
        on_log=log, keep_work=args.keep_work,
    )
    exporter = SilhouetteExporter(p4k, cfg)

    # Rows live in a `rows/` subdir, sibling to `_build_manifest.json` — so a
    # directory-wide `*.json` read (see `catalog-bridge.ts` `readJsonDir`)
    # never picks up the manifest itself as a row.
    out_dir = args.out / "silhouettes" / "rows"
    out_dir.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    ok = skipped = 0
    # One cgf-converter run per DISTINCT mesh: entities sharing a hull (ship
    # editions) or an item mesh (variants) are deduped up front.
    by_mesh: Dict[str, list] = {}
    for e in entities:
        by_mesh.setdefault(e["mesh"], []).append(e)

    for mesh, refs in by_mesh.items():
        mesh_id = _safe_filename(Path(mesh).stem)
        for e in refs:
            kind, class_name = e["kind"], e["class_name"]
            anchor_in = (_ship_anchor_inputs(args.out, class_name)
                        if kind == "ship" else {"frame": None, "transforms": {}, "port_names": ()})
            try:
                row = exporter.export_entity(
                    kind=kind, class_name=class_name, mesh_path=mesh, mesh_id=mesh_id,
                    build=build, generated_at=generated_at, tolerance_m=args.tolerance_m,
                    frame=anchor_in["frame"], hardpoint_transforms=anchor_in["transforms"],
                    all_port_names=anchor_in["port_names"],
                )
            except Exception as exc:  # noqa: BLE001 — one bad entity must not kill the run
                log("warn", f"{kind}/{class_name}: {type(exc).__name__}: {exc}")
                row = None
            if row is None:
                skipped += 1
                continue
            fname = f"{kind}__{_safe_filename(class_name)}.json"
            (out_dir / fname).write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
            ok += 1
        log("info", f"{mesh}: {len(refs)} entit(y/ies) sharing this mesh done")

    log("info", f"silhouette build: {ok} written, {skipped} skipped (no usable geometry)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
