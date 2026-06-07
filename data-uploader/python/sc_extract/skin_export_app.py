"""Events-emitting CLI for the 3D ship-skin export — consumed by the Electron
data-uploader (see src/main/skin-bridge.ts). Wraps ShipDiscovery +
Hull3DExporter and streams JSON-line events (events.py contract) on stdout so
the renderer shows live progress, exactly like sc_extract.extract.

Data is 100% from the P4K; build tools (cgf-converter + gltf-transform) are
resolved/provided by the host. The optimizer can run through the host's bundled
Node via the SC_GLTF_TRANSFORM_ARGV env var (see hull3d._optimize), so the
packaged app needs no global npx.

CLI:
    python -m sc_extract.skin_export_app --p4k <Data.p4k> --out <dir> \\
        --converter <cgf-converter.exe> --ship DRAK_Cutlass_Black [--ship ...] \\
        [--texture-size 1024] [--limit-skins N]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .events import count, done, error, log, phase
from .hull3d import Hull3DExporter, HullExportConfig
from .ship_discovery import ShipDiscovery
from .ship_export import parse_ship


def main() -> int:
    ap = argparse.ArgumentParser(description="Events-emitting 3D ship-skin exporter")
    ap.add_argument("--p4k", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--converter", required=True, type=Path)
    ap.add_argument("--ship", action="append", required=True,
                    help="ship_id (known) or ship_id:MFR:Ship:SeriesToken (repeatable)")
    ap.add_argument("--texture-size", type=int, default=1024)
    ap.add_argument("--limit-skins", type=int, default=None)
    args = ap.parse_args()

    # UTF-8 stdout is forced centrally in events.py (imported above) for every
    # sidecar entrypoint — the host launches us with `-E`, so PYTHONIOENCODING
    # can't fix Windows' cp1252 stdout; see events.py for the full rationale.

    def on_log(level: str, msg: str) -> None:
        log(level if level in ("info", "warn", "error") else "info", msg)

    try:
        from .p4k_compat import apply_p4k_compat
        apply_p4k_compat()
        from scdatatools.p4k import P4KFile

        phase("discover")
        log("info", f"opening {args.p4k}")
        p4k = P4KFile(str(args.p4k))
        log("info", f"opened: {len(p4k.namelist())} entries")
        disco = ShipDiscovery(p4k)

        cfg = HullExportConfig(
            cgf_converter=args.converter, out_dir=args.out,
            work_dir=args.out / "_work", texture_size=args.texture_size,
            on_log=on_log,
        )
        exporter = Hull3DExporter(p4k, cfg)

        refs = [parse_ship(s) for s in args.ship]
        ships_out: list[dict] = []
        for si, ref in enumerate(refs):
            phase("extract", pct=int(si / max(len(refs), 1) * 100))
            spec = disco.discover(ref)
            if args.limit_skins:
                spec.paints = spec.paints[: args.limit_skins]
            if not spec.hull_cga:
                log("warn", f"{ref.ship_id}: no hull mesh found — skipping")
                continue
            log("info", f"{ref.ship_id}: {len(spec.paints)} paints — building glbs")
            result = exporter.export_ship(spec)
            skins, n_ok = [], 0
            for s in result["skins"]:
                has_model = bool(s.get("model"))
                n_ok += 1 if has_model else 0
                skins.append({
                    "skin_id": s["id"],
                    "name": s.get("name") or s["id"],
                    "description": s.get("description", ""),
                    "source": s.get("source", "store"),
                    "name_verified": bool(s.get("name_verified")),
                    "has_model": has_model,
                    "has_icon": bool(s.get("icon")),
                    "model_bytes": int((s.get("model_mb") or 0) * 1e6) or None,
                })
            count(ref.ship_id, n_ok)
            ships_out.append({
                "ship_id": ref.ship_id,
                "export_dir": str((cfg.out_dir / ref.ship_id).resolve()),
                "skins": skins,
            })
            log("info", f"{ref.ship_id}: {n_ok}/{len(skins)} skins exported")

        if not ships_out:
            error("no ships exported (no hull mesh found for any requested ship)")
            return 1
        done(result={"ships": ships_out})
        return 0
    except Exception as exc:  # noqa: BLE001 — surface as a structured error event
        error(f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
