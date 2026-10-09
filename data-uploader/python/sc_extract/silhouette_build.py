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
from typing import Any, Callable, Dict, List, Optional

# Note I (wave1-redteam.md): reuse the ONE `_safe_filename` `dataforge_extract.py`
# already writes ships/weapons/components/items with — a second, differently
# behaved implementation here meant a class name with a `.` in it (or any
# other char outside dataforge_extract's own keep-set) resolved to a
# DIFFERENT filename than the one the entity's own JSON was written under,
# so `_ship_anchor_inputs` silently read back no anchors/unresolved for it.
from .constellation import constellation_from_path
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


def cache_dir_for(out_dir: Path) -> Path:
    """Where the silhouette cache lives for an extract `out_dir`.

    The extract dir is purged before every extraction, so a cache inside it
    never survived to the next patch — where nearly every mesh is unchanged.
    Next to the extract dirs (the `.sc-companion-extracts` root) it does; the
    host's cleanup keeps `silhouette-cache` like the livery build cache.
    """
    parent = out_dir.resolve().parent
    if parent.name == ".sc-companion-extracts":
        return parent / "silhouette-cache"
    return out_dir / "silhouette_cache"


Hook = Optional[Callable[..., None]]


def build_rows(
    exporter: Any,
    entities: List[Dict[str, Any]],
    *,
    out_dir: Path,
    build: Dict[str, Any],
    tolerance_m: float = 0.15,
    workers: int = 1,
    log: Callable[[str, str], None] = lambda level, msg: None,
    on_progress: Hook = None,
    on_count: Hook = None,
) -> Dict[str, Any]:
    """Build every silhouette row of a manifest.

    Work is done per DISTINCT mesh, exactly once: its bytes are read from the
    P4K once, hashed once, and — on a cache miss — converted once, however
    many entities (ship editions, item variants) share it. Misses are
    converted on `workers` threads: cgf-converter is an external process and
    the raster/trace is numpy, so the threads overlap; the P4K itself is only
    ever read from this thread.

    Writes ``<out_dir>/silhouettes/rows/<kind>__<class>.json`` and returns the
    counts the host reports.
    """
    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

    rows_dir = out_dir / "silhouettes" / "rows"
    rows_dir.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    by_mesh: Dict[str, List[Dict[str, Any]]] = {}
    for e in entities:
        by_mesh.setdefault(e["mesh"], []).append(e)

    total = len(entities)
    stats = {"written": 0, "skipped": 0, "cached": 0, "ships": 0, "shipsWithoutAnchors": 0}
    no_anchor: List[str] = []
    done_entities = 0
    per_kind: Dict[str, int] = {}

    def finish(mesh: str, silhouette: Optional[Dict[str, Any]], from_cache: bool) -> None:
        nonlocal done_entities
        for e in by_mesh[mesh]:
            kind, class_name = e["kind"], e["class_name"]
            done_entities += 1
            if on_progress:
                on_progress(done_entities, total, f"{kind}/{class_name}")
            if silhouette is None:
                stats["skipped"] += 1
                continue
            anchor_in = (_ship_anchor_inputs(out_dir, class_name)
                         if kind == "ship" else {"frame": None, "transforms": {}, "port_names": ()})
            try:
                row = exporter.row(
                    kind=kind, class_name=class_name, mesh_path=mesh, build=build,
                    generated_at=generated_at, silhouette=silhouette,
                    frame=anchor_in["frame"], hardpoint_transforms=anchor_in["transforms"],
                    all_port_names=anchor_in["port_names"],
                )
            except Exception as exc:  # noqa: BLE001 — one bad entity must not kill the run
                log("warn", f"{kind}/{class_name}: {type(exc).__name__}: {exc}")
                stats["skipped"] += 1
                continue
            if kind == "ship":
                # Verse-hub constellation: 7 stars from this hull's top view,
                # precomputed here so the website never runs geometry. The
                # edge function picks the patch's newest vehicle among these.
                stars = constellation_from_path((row.get("silhouette") or {}).get("path") or "")
                if stars:
                    row["constellation"] = stars
                row["ground"] = bool(e.get("ground"))
            fname = f"{kind}__{_safe_filename(class_name)}.json"
            (rows_dir / fname).write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
            stats["written"] += 1
            if from_cache:
                stats["cached"] += 1
            per_kind[kind] = per_kind.get(kind, 0) + 1
            if on_count:
                on_count(kind, per_kind[kind])
            if kind == "ship":
                stats["ships"] += 1
                if not row.get("anchors"):
                    stats["shipsWithoutAnchors"] += 1
                    no_anchor.append(class_name)

    workers = max(1, int(workers))
    pending: Dict[Any, str] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for mesh in by_mesh:
            try:
                src = exporter.source(mesh, tolerance_m)
            except FileNotFoundError:
                finish(mesh, None, False)
                continue
            except Exception as exc:  # noqa: BLE001
                log("warn", f"{mesh}: {type(exc).__name__}: {exc}")
                finish(mesh, None, False)
                continue
            hit = exporter.cached(src)
            if hit is not None:
                finish(mesh, hit, True)
                continue
            mesh_id = _safe_filename(Path(mesh).stem)
            pending[pool.submit(exporter.compute, src, mesh_id, tolerance_m)] = mesh
            # Bounded in flight: each queued job holds its mesh bytes (a big
            # hull + .cgam is tens of MB), so never read far ahead of the pool.
            while len(pending) >= workers * 2:
                done_set, _ = wait(list(pending), return_when=FIRST_COMPLETED)
                for fut in done_set:
                    _collect(fut, pending, finish, log)
        while pending:
            done_set, _ = wait(list(pending), return_when=FIRST_COMPLETED)
            for fut in done_set:
                _collect(fut, pending, finish, log)

    log("info", f"silhouette build: {stats['written']} written ({stats['cached']} from cache), "
                f"{stats['skipped']} skipped (no usable geometry), "
                f"{len(by_mesh)} distinct mesh(es) on {workers} worker(s)")
    if stats["shipsWithoutAnchors"]:
        log("warn", f"{stats['shipsWithoutAnchors']}/{stats['ships']} ship silhouettes without anchors: "
                    + ", ".join(sorted(no_anchor)[:40]) + (" …" if len(no_anchor) > 40 else ""))
    return stats


def _collect(fut: Any, pending: Dict[Any, str], finish: Callable[..., None],
             log: Callable[[str, str], None]) -> None:
    mesh = pending.pop(fut)
    try:
        silhouette = fut.result()
    except Exception as exc:  # noqa: BLE001 — one bad mesh must not abort the run
        log("warn", f"{mesh}: {type(exc).__name__}: {exc}")
        silhouette = None
    finish(mesh, silhouette, False)


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
    ap.add_argument("--workers", type=int, default=1)
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
        cache_dir=cache_dir_for(args.out),
        tool_version=args.tool_version,
        on_log=log, keep_work=args.keep_work,
    )
    exporter = SilhouetteExporter(p4k, cfg)
    exporter.prune_cache()
    stats = build_rows(exporter, entities, out_dir=args.out, build=build,
                       tolerance_m=args.tolerance_m, workers=args.workers, log=log)
    log("info", f"anchor coverage: {stats['ships'] - stats['shipsWithoutAnchors']}/{stats['ships']} "
                f"ship silhouettes with anchors, {stats['shipsWithoutAnchors']} without")
    return 0


if __name__ == "__main__":
    sys.exit(main())
