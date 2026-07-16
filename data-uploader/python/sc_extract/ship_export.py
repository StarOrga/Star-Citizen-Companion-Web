"""Generic, ship-agnostic 3D hull + skin exporter.

Combines `ship_discovery.ShipDiscovery` (auto-find hull + paints) with
`hull3d.Hull3DExporter` (build web glbs + catalog) for ANY ship in the P4K.

Cutlass remains the manually-verified anchor (`cutlass_pilot.py`) — its paint
names/materials are hand-checked. This generic path is best-effort auto-discovery:
hull + 3D-capable paints are reliable; the icon↔material↔name binding is fuzzy
(the authoritative binding lives in the DataCore — a follow-up). `name_verified`
flags which names came straight from Localization.

CLI:
    python -m sc_extract.ship_export --p4k "...\\Data.p4k" --out ./out \\
        --converter ./tools/cgf-converter-2.exe \\
        --ship DRAK_Cutlass_Black:DRAK:Cutlass:Cutlass [--ship AEGS_Gladius:AEGS:Gladius:Gladius] \\
        [--limit-skins 3] [--catalog-only]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .hull3d import HullExportConfig, Hull3DExporter
from .ship_discovery import ShipDiscovery, ShipRef

# known ships (ship_id : mfr : ship-folder : series-token). Extend freely.
KNOWN = {
    "DRAK_Cutlass_Black": ShipRef("DRAK_Cutlass_Black", "DRAK", "Cutlass", "Cutlass"),
    "AEGS_Gladius":       ShipRef("AEGS_Gladius", "AEGS", "Gladius", "Gladius"),
    "ANVL_Hornet_F7C":    ShipRef("ANVL_Hornet_F7C", "ANVL", "Hornet", "Hornet"),
}


def parse_ship(arg: str) -> ShipRef:
    if arg in KNOWN:
        return KNOWN[arg]
    parts = arg.split(":")
    if len(parts) != 4:
        raise SystemExit(f"--ship must be 'ship_id:MFR:Ship:SeriesToken' or a known id; got {arg!r}")
    return ShipRef(*parts)


def main() -> int:
    ap = argparse.ArgumentParser(description="Generic 3D hull+skin exporter")
    ap.add_argument("--p4k", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--converter", required=True, type=Path)
    ap.add_argument("--ship", action="append", required=True,
                    help="ship_id:MFR:Ship:SeriesToken (repeatable) or a known ship_id")
    ap.add_argument("--limit-skins", type=int, default=None)
    ap.add_argument("--texture-size", type=int, default=1024)
    ap.add_argument("--max-model-mb", type=float, default=1.0,
                    help="per-skin glb size budget; over-budget skins are re-optimized "
                         "at lower texture size (0 disables)")
    ap.add_argument("--catalog-only", action="store_true",
                    help="discover + write catalog JSON only (skip the slow glb build)")
    ap.add_argument("--keep-work", action="store_true")
    args = ap.parse_args()

    from .p4k_compat import apply_p4k_compat
    apply_p4k_compat()
    from scdatatools.p4k import P4KFile

    def log(level, msg):
        print(f"[{level}] {msg}", flush=True)

    log("info", f"opening {args.p4k}")
    p4k = P4KFile(str(args.p4k))
    log("info", f"opened: {len(p4k.namelist())} entries")
    disco = ShipDiscovery(p4k)

    cfg = HullExportConfig(
        cgf_converter=args.converter, out_dir=args.out,
        work_dir=args.out / "_work", texture_size=args.texture_size,
        max_model_bytes=int(args.max_model_mb * 1e6),
        on_log=log, keep_work=args.keep_work,
    )
    exporter = Hull3DExporter(p4k, cfg)

    overall_ok = True
    for ship_arg in args.ship:
        ref = parse_ship(ship_arg)
        spec = disco.discover(ref)
        if args.limit_skins:
            spec.paints = spec.paints[:args.limit_skins]
        n3d = sum(1 for p in spec.paints if p.mtl)
        log("info", f"{ref.ship_id}: hull={'yes' if spec.hull_cga else 'MISSING'} "
                    f"{len(spec.paints)} paints ({n3d} with 3D material)")
        if not spec.hull_cga:
            log("warn", f"{ref.ship_id}: no hull mesh found — skipping")
            overall_ok = False
            continue
        if args.catalog_only:
            import json
            ship_out = cfg.out_dir / ref.ship_id
            ship_out.mkdir(parents=True, exist_ok=True)
            cat = [{"id": p.id, "name": p.name, "description": p.description,
                    "source": p.source, "name_verified": p.name_verified,
                    "has_material": bool(p.mtl)} for p in spec.paints]
            (ship_out / "skins_preview.json").write_text(
                json.dumps({"ship": ref.ship_id, "skins": cat}, indent=2, ensure_ascii=False),
                encoding="utf-8")
            log("info", f"{ref.ship_id}: catalog-only -> {ship_out/'skins_preview.json'}")
            continue
        result = exporter.export_ship(spec)
        ok = sum(1 for s in result["skins"] if s.get("model"))
        log("info", f"{ref.ship_id}: {ok}/{len(result['skins'])} skins exported")
        overall_ok = overall_ok and ok > 0

    return 0 if overall_ok else 1


if __name__ == "__main__":
    sys.exit(main())
