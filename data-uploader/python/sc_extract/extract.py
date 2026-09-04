"""Main extractor — streams entities from P4K + DataCore to JSON chunks on disk.

Phase 2 § A1 (scdatatools), § B1 (Embedded Python), § C1 (DDS-direct),
§ D2 (Pure Counter + minimal Heuristik per Iter-3-Comment).

Architecture:
1. Open P4K with scdatatools.p4k.P4KFile (streaming, no full RAM load)
2. Extract Data/Game2.dcb (SC 4.x; Game.dcb on older builds) → enumerate ships/weapons/items/components
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
    dump_generic: bool = True
    tool_version: str = "0.0.0-dev"
    #: Worker processes for the exhaustive record dump. 1 = the serial path.
    #: Always supplied by the host from the chosen performance profile; never
    #: derived here (see parallel_dump.worker_count).
    workers: int = 1
    #: Advisory memory budget in MB — clamps `workers`, nothing more. It cannot
    #: be a hard cap: CPython on Windows has no per-process memory ceiling short
    #: of the Job Object API. 0 = no clamp.
    mem_cap_mb: int = 0


@dataclass
class ExtractResult:
    channel: str
    patch_version: str
    build_number: str
    # v2 (PR A): ship-level `stats` (signature whitelist), vehicle-armor items
    # gain `stats`, weapon `weaponParams.fireRate` derived correctly (was 0 on
    # every ship weapon before this).
    # v3 (energy/hull PR): `ItemResourceComponentParams` resource-network stats
    # on every item, component and weapon (power segments, coolant, shield
    # regen, IR/EM signature, power ranges); weapons gain a `stats` block;
    # ships gain `hull.{hp,mass}`, `armorHp`, `cargoScu` and `career`.
    schema_version: int = 3
    quality_score: float = 0.0
    entity_counts: Dict[str, int] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    manifest_path: str = ""
    output_dir: str = ""
    tool_version: str = ""
    # short codes of every language table discovered in the P4K (en first)
    languages: List[str] = field(default_factory=list)


def _clean_stale_output(out_dir: Path, *, include_records: bool) -> None:
    """Wipe per-run projection dirs so counts/diffs reflect ONLY this run.

    Without this the typed dirs (ships/, weapons/, …) accumulate across runs and
    patches, so a partial/aborted run leaves a misleading mix on disk. Asset
    caches (icons/, previews/) are content-deduped and kept. `records/` is kept
    when --skip-generic is set (that mode deliberately reuses the prior dump).
    """
    import shutil

    subs = ["ships", "weapons", "components", "items", "manufacturers",
            "ammunition", "blueprints", "localization", "keybinds"]
    if include_records:
        subs.append("records")
    for sub in subs:
        d = out_dir / sub
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)


def run_extract(cfg: ExtractConfig) -> ExtractResult:
    """Streaming extractor — see module docstring."""
    cfg.out_dir.mkdir(parents=True, exist_ok=True)
    _clean_stale_output(cfg.out_dir, include_records=cfg.dump_generic)
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

    if scdatatools_available and cfg.p4k_path.exists():
        result = _real_extract(cfg)
    else:
        if not cfg.p4k_path.exists():
            events.log("warn", f"P4K not found at {cfg.p4k_path} — running scaffold-stub mode")
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
        "languages": result.languages,
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
            "languages": result.languages,
            "manifest_path": result.manifest_path,
            "output_dir": result.output_dir,
            "tool_version": result.tool_version,
        },
    )
    return result


def _find_dcb_entry(p4k) -> str:
    """Locate the DataCore entry in the P4K (Game2.dcb in SC 4.x, Game.dcb older)."""
    for name in p4k.namelist():
        if name.lower().endswith(".dcb"):
            return name
    raise RuntimeError("no .dcb entry found in P4K")


def _load_localizer(p4k):
    """Discover + parse EVERY language's global.ini into a Localizer.

    Languages are discovered from the archive (Data/Localization/<x>/global.ini)
    instead of a hardcoded en/de map — new game languages flow through
    automatically. English (the canonical original) is always loaded first;
    the {de, en, key} payload contract is unchanged, additional languages are
    dumped by dump_localization() and land in codex_locale_strings.
    """
    from .localization import Localizer, discover_language_folders, parse_global_ini

    names = p4k.namelist()
    folders = discover_language_folders(names)
    if not folders:
        events.log("warn", "no Data/Localization/*/global.ini entries found in P4K")
    tables = {}
    for short, entry in folders.items():
        try:
            info = p4k.getinfo(entry)
            with p4k.open(info) as f:
                tables[short] = parse_global_ini(f.read())
            events.log("info", f"localization '{short}' <- {entry} "
                               f"({len(tables[short])} keys)")
        except Exception as exc:  # noqa: BLE001
            events.log("warn", f"failed to read localization {entry}: {exc}")
    return Localizer(tables)


def _real_extract(cfg: ExtractConfig) -> ExtractResult:
    """Real extraction path: open P4K (compat-patched) → parse DataForge v8 →
    generic dump + typed projections + localization."""
    from .dataforge import DataForge
    from .dataforge_extract import CodexExtractor
    from .p4k_compat import apply_p4k_compat

    apply_p4k_compat()
    from scdatatools.p4k import P4KFile  # type: ignore[import-not-found]

    events.phase("discover", pct=6)
    # Opening a ~157 GB archive takes ~30–40 s and gives no intermediate count —
    # emit an indeterminate progress (no total) so the UI shows "opening …" with
    # a pulsing bar instead of looking frozen.
    events.progress("open", pct=6, detail=cfg.p4k_path.name)
    events.log("info", "opening P4K (compat-patched for SC 4.x)")
    p4k = P4KFile(str(cfg.p4k_path))
    events.log("info", f"P4K opened: {len(p4k.namelist()):,} entries")

    dcb_entry = _find_dcb_entry(p4k)
    events.log("info", f"datacore entry: {dcb_entry}")

    localizer = _load_localizer(p4k)

    events.phase("extract", pct=10)
    # Decompressing + parsing the DataCore is also unquantifiable up front.
    events.progress("datacore", pct=10)
    events.log("info", "reading + decompressing DataCore (this is the slow part)")
    info = p4k.getinfo(dcb_entry)
    with p4k.open(info) as f:
        raw = f.read()
    events.log("info", f"datacore {len(raw):,} bytes decompressed")

    df = DataForge(raw)
    events.log("info", f"DataForge v{df.version}: {len(df.records):,} records, "
                       f"{len(df.record_types)} types")

    source = {"channel": cfg.channel, "patch": cfg.patch_version,
              "build": cfg.build_number}
    from .parallel_dump import worker_count

    workers = worker_count(cfg.workers, cfg.mem_cap_mb)
    if workers != cfg.workers:
        events.log("info", f"record dump: {cfg.workers} worker(s) requested, "
                           f"{workers} after the {cfg.mem_cap_mb} MB budget clamp")
    extractor = CodexExtractor(
        df, localizer, cfg.out_dir, source,
        on_count=events.count,
        on_log=events.log,
        on_progress=events.progress,
        dump_generic=cfg.dump_generic,
        p4k=p4k,
        extract_assets=True,
        workers=workers,
        raw_dcb=raw,
    )
    counts = extractor.run()

    # Map internal counts to the contract's counter keys (keep extras too).
    entity_counts = {
        "ships": counts.get("ships", 0),
        "weapons": counts.get("weapons", 0),
        "components": counts.get("components", 0),
        "items": counts.get("items", 0),
        "skins": counts.get("skins", 0),
        "manufacturers": counts.get("manufacturers", 0),
        "ammunition": counts.get("ammunition", 0),
        "blueprints": counts.get("blueprints", 0),
        "keybinds": counts.get("keybinds", 0),
        "records_total": counts.get("records_total", 0),
        "strings": sum(len(t) for t in localizer._tables.values()),
    }
    for k, v in entity_counts.items():
        events.count(k, v)

    return ExtractResult(
        channel=cfg.channel,
        patch_version=cfg.patch_version,
        build_number=cfg.build_number,
        entity_counts=entity_counts,
        languages=localizer.languages,
    )


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
    n_ships = len(sample_ships)
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
        events.progress("entities", current=ships_extracted, total=n_ships,
                        pct=10 + int(ships_extracted / n_ships * 70))

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
        languages=["en", "de"],
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
    parser.add_argument(
        "--skip-generic",
        action="store_true",
        help="Skip the exhaustive generic record dump (faster; keeps existing records/ on disk)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Worker processes for the record dump (1 = serial). Set by the host "
             "from the performance profile; NOT auto-detected, because cpu_count "
             "ignores the CPU affinity a throttled run is pinned to.",
    )
    parser.add_argument(
        "--mem-cap-mb",
        type=int,
        default=0,
        dest="mem_cap_mb",
        help="Advisory memory budget in MB. Clamps --workers; it is NOT a hard "
             "cap — Windows CPython cannot enforce one without Job Objects.",
    )
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
        dump_generic=not args.skip_generic,
        tool_version=args.tool_version,
        workers=args.workers,
        mem_cap_mb=args.mem_cap_mb,
    )

    try:
        run_extract(cfg)
        return 0
    except Exception as e:  # noqa: BLE001 — top-level catch for IPC error event
        events.error(str(e), error_type=type(e).__name__)
        return 1


if __name__ == "__main__":
    sys.exit(main())
