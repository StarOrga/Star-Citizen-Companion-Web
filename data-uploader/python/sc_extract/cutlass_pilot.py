"""Cutlass pilot driver for the 3D hull + skin export (hull3d.Hull3DExporter).

Builds the DRAK Cutlass Black ShipSpec from real P4K data — paint .mtl files,
store-icons (PaintColorLogos), and official names/descriptions from the
Localization global.ini — then exports one web-ready glb per skin.

CLI:
    python -m sc_extract.cutlass_pilot --p4k "...\\LIVE\\Data.p4k" \\
        --out ./out --converter ./tools/cgf-converter-2.exe [--limit 2]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Dict

from .hull3d import HullExportConfig, Hull3DExporter, Paint, ShipSpec

CUT = "Data/Objects/Spaceships/Ships/DRAK/Cutlass"
PAINTDIR = f"{CUT}/Cutlass_Black"
ICONDIR = "Data/UI/SharedAssets/PaintColorLogos"

# paint .mtl (filename) -> (slug, localization key|None, icon stem|None, source)
# names verified online (theimpound store list) + P4K localization.
PAINTS = [
    ("DRAK_Cutlass_Black.mtl",            "standard",  None,                            None,                                   "factory"),
    ("drak_cutlass_black_blue_gold_gothic.mtl", "elysium", "Blue_Blue_Gold_Gothic",     "Paint_Cutlass_Black_Blue_Gold_Gothic_Icon", "store"),
    ("DRAK_Cutlass_Black_pirate.mtl",     "skull_crossbones", "SkullandCrossbones_Black_Red", "Paint_Cutlass_Black_TLAPD_Black_Red_Icon", "store"),
    ("drak_cutlass_black_pyro_graffiti.mtl", "dying_star", "Beige_Tan_Beige_Pyro_Graffiti", "Paint_Cutlass_Beige_Tan_Beige_Pyro_Graffiti_Icon", "subscriber"),
    ("drak_cutlass_black_camo_digi.mtl",  "cypress",   "Cypress_LightGreen_Camo",       "paint_cutlass_steel_cypress_lightgreen_icon", "store"),
    ("DRAK_Cutlass_Black_Gold_Scale.mtl", "gold_scale", None,                           "Paint_Cutlass_Black_Gold_Scale_Icon",   "pu_npc"),
    ("drak_cutlass_black_rr_graffiti.mtl", "graffiti_rr", None,                          None,                                   "pu_npc"),
]


def _load_paint_names(p4k) -> tuple[Dict[str, str], Dict[str, str]]:
    info = next(i for i in p4k.infolist()
                if i.filename == "Data/Localization/english/global.ini")
    text = p4k.open(info).read().decode("utf-8-sig", errors="replace")
    names, descs = {}, {}
    for ln in text.splitlines():
        if "=" not in ln:
            continue
        k, v = ln.split("=", 1)
        m = re.match(r"item_NameCutlass_Paint_(.+)", k)
        if m:
            names[m.group(1).lower()] = v.strip()
        m = re.match(r"item_DescCutlass_Paint_(.+)", k)
        if m:
            descs[m.group(1).lower()] = v.strip()
    return names, descs


def build_cutlass_spec(p4k, limit: int | None = None) -> ShipSpec:
    names, descs = _load_paint_names(p4k)
    # build a set of existing icon paths (case-insensitive) for resolution
    icons = {i.filename.lower(): i.filename for i in p4k.infolist()
             if "paintcolorlogos" in i.filename.lower() and i.filename.lower().endswith(".dds")}
    paints = []
    for mtl, slug, key, icon_stem, source in (PAINTS[:limit] if limit else PAINTS):
        kl = key.lower() if key else None
        name = names.get(kl) if kl else ("Cutlass Black (Standard)" if slug == "standard" else f"Cutlass {slug.replace('_',' ').title()}")
        desc = descs.get(kl, "") if kl else ("The factory-standard Drake Cutlass Black finish." if slug == "standard" else "")
        icon_path = None
        if icon_stem:
            cand = f"{ICONDIR}/{icon_stem}.dds".lower()
            icon_path = icons.get(cand)
        paints.append(Paint(
            mtl=f"{PAINTDIR}/{mtl}", id=slug, name=name or slug,
            description=desc, icon_dds=icon_path, source=source,
            name_verified=bool(kl and kl in names),
        ))
    return ShipSpec(
        ship_id="DRAK_Cutlass_Black",
        hull_cga=f"{CUT}/DRAK_Cutlass_Black.cga",
        objectdir_anchor="Data",   # cgf-converter -objectdir root (the dir containing Objects/)
        paints=paints,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Cutlass 3D hull+skin pilot export")
    ap.add_argument("--p4k", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--converter", required=True, type=Path)
    ap.add_argument("--work", type=Path, default=None)
    ap.add_argument("--limit", type=int, default=None, help="only first N skins (testing)")
    ap.add_argument("--texture-size", type=int, default=1024)
    ap.add_argument("--max-model-mb", type=float, default=1.0,
                    help="per-skin glb size budget; over-budget skins are re-optimized "
                         "at lower texture size (0 disables)")
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

    spec = build_cutlass_spec(p4k, limit=args.limit)
    log("info", f"cutlass spec: {len(spec.paints)} skins")

    cfg = HullExportConfig(
        cgf_converter=args.converter,
        out_dir=args.out,
        work_dir=args.work or (args.out / "_work"),
        texture_size=args.texture_size,
        max_model_bytes=int(args.max_model_mb * 1e6),
        on_log=log,
        keep_work=args.keep_work,
    )
    exporter = Hull3DExporter(p4k, cfg)
    result = exporter.export_ship(spec)
    ok = sum(1 for s in result["skins"] if s.get("model"))
    log("info", f"DONE: {ok}/{len(result['skins'])} skins -> {result['catalog_path']}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
