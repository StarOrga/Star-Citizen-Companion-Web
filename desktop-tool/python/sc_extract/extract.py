"""Main extractor — streams entities from P4K + DataCore to JSON chunks on disk.

Phase 2 § A1 (scdatatools), § B1 (Embedded Python), § C1 (DDS-direct),
§ D2 (Pure Counter + minimal Heuristik per Iter-3-Comment).

Architecture:
1. Open P4K with scdatatools.p4k.P4KFile (streaming, no full RAM load)
2. Extract Data/Game.dcb (DataCore) → enumerate ships/weapons/items/components
3. For each entity class: write JSON chunk to disk, emit progress events
4. Extract Data/Textures/UI/Spaceships/*.dds → convert to PNG (DDS-direct, no 3D-render)
5. Run plausibility validator (Pure Counter + minimal per-entity heuristic)
6. Write manifest.json with quality_score + counts + warnings
7. Emit done event with full result

NOTE: scdatatools API calls in this file are SCAFFOLDED with TODOs.
The real API surface may differ per scdatatools version — this needs a real
P4K + a session with the user to wire up correctly (see Phase-2 final report,
Open Question Q1 + Q3).

Usage (CLI for testing):
    python -m sc_extract.extract \\
        --p4k 'C:\\StarCitizen\\LIVE\\Data.p4k' \\
        --out 'C:\\Users\\X\\AppData\\Local\\sc-companion\\extracts\\LIVE-4.0.0' \\
        --channel LIVE --patch 4.0.0 --build 9123456 \\
        --scope hd_icons,render_pngs,component_tree
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from . import events
from .thresholds import aggregate_score, heuristic_check_entity


@dataclass
class ExtractConfig:
    p4k_path: Path
    out_dir: Path
    channel: str
    patch_version: str
    build_number: str
    scope_hd_icons: bool = True
    scope_render_pngs: bool = True
    scope_component_tree: bool = True
    tool_version: str = "0.0.0-dev"


@dataclass
class ExtractResult:
    channel: str
    patch_version: str
    build_number: str
    schema_version: int = 1
    quality_score: float = 0.0
    entity_counts: Dict[str, int] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    manifest_path: str = ""
    output_dir: str = ""
    tool_version: str = ""


def run_extract(cfg: ExtractConfig) -> ExtractResult:
    """Streaming extractor — see module docstring."""
    cfg.out_dir.mkdir(parents=True, exist_ok=True)
    icons_dir = cfg.out_dir / "icons"
    if cfg.scope_hd_icons or cfg.scope_render_pngs:
        icons_dir.mkdir(exist_ok=True)

    events.phase("discover", pct=0)
    events.log("info", f"opening {cfg.p4k_path}")

    # ====== Open P4K via scdatatools ======
    # TODO Phase-2-Finalisation: wire up against real scdatatools version.
    # Pseudocode for the expected API:
    #
    #   from scdatatools.p4k import P4KFile
    #   p4k = P4KFile(str(cfg.p4k_path))
    #   with p4k.open('Data/Game.dcb') as dcb_fp:
    #       datacore = DataCore.from_file(dcb_fp)
    #
    # For autonomous-mode scaffolding we emit a synthetic event sequence so
    # the Electron renderer can be developed in parallel. Replace this block
    # with real scdatatools calls when running against real P4K.
    try:
        from scdatatools.p4k import P4KFile  # noqa: F401  # type: ignore[import-not-found]

        scdatatools_available = True
    except ImportError:
        scdatatools_available = False
        events.log("warn", "scdatatools not installed — running scaffold-stub mode")

    events.phase("plan", pct=4)
    events.log(
        "info",
        f"scope: icons={cfg.scope_hd_icons} renders={cfg.scope_render_pngs} components={cfg.scope_component_tree}",
    )

    if scdatatools_available:
        result = _real_extract(cfg)
    else:
        result = _stub_extract(cfg)

    # ====== Validate ======
    events.phase("validate", pct=85)
    score, warnings = aggregate_score(result.entity_counts)
    result.quality_score = score
    result.warnings.extend(warnings)
    for w in warnings:
        events.log("warn", w)
    events.log("info", f"quality_score = {score:.0f}/100")

    # ====== Bundle (write manifest) ======
    events.phase("bundle", pct=95)
    manifest_path = cfg.out_dir / "manifest.json"
    manifest = {
        "channel": cfg.channel,
        "patch_version": cfg.patch_version,
        "build_number": cfg.build_number,
        "schema_version": result.schema_version,
        "quality_score": result.quality_score,
        "entity_counts": result.entity_counts,
        "warnings": result.warnings,
        "tool_version": cfg.tool_version,
        "scope": {
            "hd_icons": cfg.scope_hd_icons,
            "render_pngs": cfg.scope_render_pngs,
            "component_tree": cfg.scope_component_tree,
        },
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    result.manifest_path = str(manifest_path)
    result.output_dir = str(cfg.out_dir)
    result.tool_version = cfg.tool_version

    events.done(
        100,
        result={
            "channel": result.channel,
            "patch_version": result.patch_version,
            "build_number": result.build_number,
            "schema_version": result.schema_version,
            "quality_score": result.quality_score,
            "entity_counts": result.entity_counts,
            "manifest_path": result.manifest_path,
            "output_dir": result.output_dir,
            "tool_version": result.tool_version,
        },
    )
    return result


def _real_extract(cfg: ExtractConfig) -> ExtractResult:
    """Real extraction path — uses scdatatools when available.

    Phase 2 stub: emit the SAME event sequence as _stub_extract but reading
    from real DataCore. Wire up against scdatatools API in a follow-up session
    with the user (the API surface needs trial-and-error against real Data.p4k).
    """
    events.log("info", "real extraction path — TODO wire up scdatatools API")
    # Until wired up, fall through to stub so the contract is verifiable.
    return _stub_extract(cfg)


def _stub_extract(cfg: ExtractConfig) -> ExtractResult:
    """Scaffolded extract that emits realistic-looking events without real data.

    Lets the Electron renderer + IPC contract be developed/tested without a
    real P4K. Real implementation lives in `_real_extract`.
    """
    import random

    events.phase("extract", pct=8)

    sample_ships = [
        "AEGS_Avenger_Titan", "AEGS_Gladius", "ANVL_Hornet_F7C", "DRAK_Cutlass_Black",
        "MISC_Freelancer", "ORIG_300i", "RSI_Constellation_Andromeda", "CRUS_Mercury_Star_Runner",
    ]
    ships_dir = cfg.out_dir / "ships"
    ships_dir.mkdir(exist_ok=True)
    ships_extracted = 0
    for ship_name in sample_ships:
        ship_data = {"name": ship_name, "mass": random.randint(5000, 80000), "hp_main_hull": random.randint(1000, 50000)}
        heuristic_warnings = heuristic_check_entity("ship", ship_data)
        for w in heuristic_warnings:
            events.log("warn", w)
        (ships_dir / f"{ship_name}.json").write_text(
            json.dumps(ship_data, indent=2), encoding="utf-8"
        )
        events.log("info", f"extracted ship: {ship_name}")
        ships_extracted += 1
        events.count("ships", ships_extracted)

    events.count("weapons", 247)
    events.count("items", 1493)
    events.count("components", 612)
    events.count("strings", 52_341)

    return ExtractResult(
        channel=cfg.channel,
        patch_version=cfg.patch_version,
        build_number=cfg.build_number,
        entity_counts={
            "ships": ships_extracted,
            "weapons": 247,
            "items": 1493,
            "components": 612,
            "strings": 52_341,
        },
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="SC Companion P4K extractor")
    parser.add_argument("--p4k", required=True, type=Path, help="Path to Data.p4k")
    parser.add_argument("--out", required=True, type=Path, help="Output dir")
    parser.add_argument("--channel", required=True)
    parser.add_argument("--patch", required=True, dest="patch_version")
    parser.add_argument("--build", default="", dest="build_number")
    parser.add_argument(
        "--scope",
        default="hd_icons,render_pngs,component_tree",
        help="Comma-separated: hd_icons,render_pngs,component_tree",
    )
    parser.add_argument("--tool-version", default="0.0.0-dev")
    args = parser.parse_args()

    scope = set(args.scope.split(","))
    cfg = ExtractConfig(
        p4k_path=args.p4k,
        out_dir=args.out,
        channel=args.channel,
        patch_version=args.patch_version,
        build_number=args.build_number,
        scope_hd_icons="hd_icons" in scope,
        scope_render_pngs="render_pngs" in scope,
        scope_component_tree="component_tree" in scope,
        tool_version=args.tool_version,
    )

    try:
        run_extract(cfg)
        return 0
    except Exception as e:  # noqa: BLE001 — top-level catch for IPC error event
        events.error(str(e), error_type=type(e).__name__)
        return 1


if __name__ == "__main__":
    sys.exit(main())
