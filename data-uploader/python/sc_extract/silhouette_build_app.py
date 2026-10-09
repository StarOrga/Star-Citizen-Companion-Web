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
import json
import sys
from pathlib import Path
from typing import Any, Dict

from .events import count, done, error, log, phase, progress
from .silhouette_build import build_rows, cache_dir_for


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
    ap.add_argument("--workers", type=int, default=1,
                    help="meshes converted at once (threads; the host sizes it from the resource limits)")
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

        cfg = SilhouetteExportConfig(
            cgf_converter=args.converter, work_dir=args.out / "_silhouette_work",
            cache_dir=cache_dir_for(args.out), tool_version=args.tool_version, on_log=on_log,
        )
        exporter = SilhouetteExporter(p4k, cfg)
        pruned = exporter.prune_cache()
        if pruned:
            log("info", f"silhouette cache: dropped {pruned} entr(y/ies) of older silhouette code")

        phase("extract", pct=0)
        last_pct = -1

        def on_progress(current: int, total: int, detail: str) -> None:
            nonlocal last_pct
            pct = int(current / max(total, 1) * 100)
            if pct != last_pct:
                last_pct = pct
                phase("extract", pct=pct)
            progress("entities", current=current, total=total, detail=detail)

        stats = build_rows(
            exporter, entities, out_dir=args.out, build=build, tolerance_m=args.tolerance_m,
            workers=args.workers, log=on_log, on_progress=on_progress, on_count=count,
        )
        done(result=stats)
        return 0
    except Exception as exc:  # noqa: BLE001 — surface as a structured error event
        error(f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
