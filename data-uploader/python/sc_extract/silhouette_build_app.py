"""Events-emitting CLI for the silhouette build — consumed by the Electron
data-uploader (see `src/main/silhouette-bridge.ts`). Same JSON-line events
contract (`events.py`) and the same cgf-converter resolution `skin_export_app.py`
uses; wraps `SilhouetteExporter` (mesh -> cached geometry) instead of
`Hull3DExporter` (mesh -> web glb).

Data is 100% from the P4K; the cgf-converter build tool is resolved/provided by
the host (same binary the skin build already ensured — see
`src/main/skin-bridge.ts` `ensureConverter` / `converterPath`).

CLI:
    python -m sc_extract.silhouette_build_app --p4k <Data.p4k> --out <dir> \\
        --converter <cgf-converter.exe> --tool-version 0.31.0 \\
        --build-json '{"channel":"LIVE","patchVersion":"4.9.0","buildNumber":"..."}'
        [--manifest <out>/silhouettes/_build_manifest.json] [--tolerance-m 0.15]
"""
from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path
from typing import Any, Dict

from .events import count, done, error, log, phase, progress
from .silhouette_build import _safe_filename, _ship_anchor_inputs


def main() -> int:
    ap = argparse.ArgumentParser(description="Events-emitting silhouette build")
    ap.add_argument("--p4k", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path,
                    help="extractor out_dir (reads silhouettes/_build_manifest.json "
                         "by default, writes silhouettes/rows/<kind>__<class>.json)")
    ap.add_argument("--converter", required=True, type=Path)
    ap.add_argument("--tool-version", required=True)
    ap.add_argument("--build-json", required=True,
                    help='{"channel":"LIVE","patchVersion":"4.9.0","buildNumber":"..."}')
    ap.add_argument("--manifest", type=Path, default=None,
                    help="defaults to <out>/silhouettes/_build_manifest.json")
    ap.add_argument("--tolerance-m", type=float, default=0.15)
    args = ap.parse_args()

    def on_log(level: str, msg: str) -> None:
        log(level if level in ("info", "warn", "error") else "info", msg)

    try:
        manifest_path = args.manifest or (args.out / "silhouettes" / "_build_manifest.json")
        if not manifest_path.exists():
            log("warn", f"no silhouette manifest at {manifest_path} — nothing to build")
            done(result={"written": 0, "skipped": 0, "cached": 0})
            return 0
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        entities = manifest.get("entities", [])
        if not entities:
            log("info", "silhouette manifest is empty — nothing to build")
            done(result={"written": 0, "skipped": 0, "cached": 0})
            return 0
        build: Dict[str, Any] = json.loads(args.build_json)

        phase("discover")
        from .p4k_compat import apply_p4k_compat
        apply_p4k_compat()
        from scdatatools.p4k import P4KFile
        from .silhouette_export import SilhouetteExportConfig, SilhouetteExporter

        log("info", f"opening {args.p4k}")
        p4k = P4KFile(str(args.p4k))
        log("info", f"opened: {len(p4k.namelist())} entries; {len(entities)} entities to silhouette")

        cache_dir = args.out / "silhouette_cache"
        cfg = SilhouetteExportConfig(
            cgf_converter=args.converter, work_dir=args.out / "_silhouette_work",
            cache_dir=cache_dir, tool_version=args.tool_version, on_log=on_log,
        )
        exporter = SilhouetteExporter(p4k, cfg)

        out_dir = args.out / "silhouettes" / "rows"
        out_dir.mkdir(parents=True, exist_ok=True)
        generated_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

        by_mesh: Dict[str, list] = {}
        for e in entities:
            by_mesh.setdefault(e["mesh"], []).append(e)

        ok = skipped = cached = 0
        total = len(entities)
        done_so_far = 0
        for mesh, refs in by_mesh.items():
            mesh_id = _safe_filename(Path(mesh).stem)
            for e in refs:
                kind, class_name = e["kind"], e["class_name"]
                phase("extract", pct=int(done_so_far / max(total, 1) * 100))
                progress("entities", current=done_so_far + 1, total=total,
                        detail=f"{kind}/{class_name}")
                anchor_in = (_ship_anchor_inputs(args.out, class_name)
                            if kind == "ship" else {"frame": None, "transforms": {}, "port_names": ()})
                try:
                    cache_hit = exporter.is_cached(exporter.read_mesh_bytes(mesh))
                    row = exporter.export_entity(
                        kind=kind, class_name=class_name, mesh_path=mesh, mesh_id=mesh_id,
                        build=build, generated_at=generated_at, tolerance_m=args.tolerance_m,
                        frame=anchor_in["frame"], hardpoint_transforms=anchor_in["transforms"],
                        all_port_names=anchor_in["port_names"],
                    )
                except Exception as exc:  # noqa: BLE001 — one bad entity must not kill the run
                    log("warn", f"{kind}/{class_name}: {type(exc).__name__}: {exc}")
                    row, cache_hit = None, False
                done_so_far += 1
                if row is None:
                    skipped += 1
                    continue
                if cache_hit:
                    cached += 1
                    log("info", f"{kind}/{class_name}: cached")
                fname = f"{kind}__{_safe_filename(class_name)}.json"
                (out_dir / fname).write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
                ok += 1
                count(kind, ok)

        log("info", f"silhouette build: {ok} written ({cached} from cache), "
                    f"{skipped} skipped (no usable geometry)")
        done(result={"written": ok, "skipped": skipped, "cached": cached})
        return 0
    except Exception as exc:  # noqa: BLE001 — surface as a structured error event
        error(f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
