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
from typing import Any, Callable, Dict, List, Optional, Tuple

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


def write_skips(out_dir: Path, skips: List[Dict[str, Any]]) -> Path:
    """Write ``<out_dir>/silhouettes/skips.json`` — one entry per entity that
    got no silhouette row, with the reason (#842). The host uploads it next to
    the rows, so the admin coverage tile can say why a hull has no outline."""
    d = out_dir / "silhouettes"
    d.mkdir(parents=True, exist_ok=True)
    path = d / "skips.json"
    path.write_text(json.dumps({"skips": skips}, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def lod1_sibling(mesh: str) -> Optional[str]:
    """``…/hull.cga`` -> ``…/hull_lod1.cga`` (None for a mesh that already is a LOD).

    cgf-converter 2.0.0 dies with an int overflow while writing the glb of a
    dozen large LIVE 4.10 hulls (Polaris, Perseus, Ironclad, Hull B, the
    Constellations, San'tok.yāi …, #842). Their LOD1 converts fine, and a
    1024 px top-down outline cannot tell the two apart."""
    stem, dot, ext = mesh.rpartition(".")
    if not dot or ext.lower() not in ("cga", "cgf") or stem.lower().rsplit("_", 1)[-1].startswith("lod"):
        return None
    return f"{stem}_lod1.{ext}"


def _skip_entry(kind: str, class_name: str, reason: str, detail: str) -> Dict[str, Any]:
    # Detail is a log line, not a document: keep it short for the admin tile.
    return {"kind": kind, "className": class_name, "reason": reason, "detail": (detail or "")[:300]}


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
    manifest_skips: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Build every silhouette row of a manifest.

    Work is done per DISTINCT mesh, exactly once: its bytes are read from the
    P4K once, hashed once, and — on a cache miss — converted once, however
    many entities (ship editions, item variants) share it. Misses are
    converted on `workers` threads: cgf-converter is an external process and
    the raster/trace is numpy, so the threads overlap; the P4K itself is only
    ever read from this thread.

    Writes ``<out_dir>/silhouettes/rows/<kind>__<class>.json`` and returns the
    counts the host reports. Every entity without a row — plus the extractor's
    own ``manifest_skips`` (hulls with no mesh path at all) — lands in
    ``silhouettes/skips.json`` with its reason.
    """
    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
    from .silhouette_export import (SKIP_CONVERT_FAILED, SKIP_EMPTY, SKIP_NO_MESH,
                                    SilhouetteSkip)

    rows_dir = out_dir / "silhouettes" / "rows"
    rows_dir.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    by_mesh: Dict[str, List[Dict[str, Any]]] = {}
    for e in entities:
        by_mesh.setdefault(e["mesh"], []).append(e)

    total = len(entities)
    stats = {"written": 0, "skipped": 0, "cached": 0, "ships": 0, "shipsWithoutAnchors": 0}
    no_anchor: List[str] = []
    skips: List[Dict[str, Any]] = [dict(e) for e in (manifest_skips or [])]
    done_entities = 0
    per_kind: Dict[str, int] = {}

    def finish(mesh: str, silhouette: Optional[Dict[str, Any]], from_cache: bool,
               skip: Optional[Tuple[str, str]] = None, used_mesh: Optional[str] = None) -> None:
        nonlocal done_entities
        for e in by_mesh[mesh]:
            kind, class_name = e["kind"], e["class_name"]
            done_entities += 1
            if on_progress:
                on_progress(done_entities, total, f"{kind}/{class_name}")
            if silhouette is None:
                stats["skipped"] += 1
                reason, detail = skip or (SKIP_EMPTY, "trace found no outline")
                skips.append(_skip_entry(kind, class_name, reason, detail))
                continue
            anchor_in = (_ship_anchor_inputs(out_dir, class_name)
                         if kind == "ship" else {"frame": None, "transforms": {}, "port_names": ()})
            try:
                row = exporter.row(
                    kind=kind, class_name=class_name, mesh_path=used_mesh or mesh, build=build,
                    generated_at=generated_at, silhouette=silhouette,
                    frame=anchor_in["frame"], hardpoint_transforms=anchor_in["transforms"],
                    all_port_names=anchor_in["port_names"],
                )
            except Exception as exc:  # noqa: BLE001 — one bad entity must not kill the run
                log("warn", f"{kind}/{class_name}: {type(exc).__name__}: {exc}")
                stats["skipped"] += 1
                skips.append(_skip_entry(kind, class_name, SKIP_CONVERT_FAILED,
                                         f"row: {type(exc).__name__}: {exc}"))
                continue
            if used_mesh:
                row["source"]["lodFallback"] = 1
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

    # A failed conversion gets one more try on the hull's LOD1 (see
    # `lod1_sibling`), after the main pass so the P4K stays single-threaded.
    retry: List[Tuple[str, Tuple[str, str]]] = []

    def settle(mesh: str, silhouette: Optional[Dict[str, Any]], from_cache: bool,
               skip: Optional[Tuple[str, str]] = None) -> None:
        if silhouette is None and skip and skip[0] == SKIP_CONVERT_FAILED and lod1_sibling(mesh):
            retry.append((mesh, skip))
            return
        finish(mesh, silhouette, from_cache, skip)

    workers = max(1, int(workers))
    pending: Dict[Any, str] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for mesh in by_mesh:
            try:
                src = exporter.source(mesh, tolerance_m)
            except FileNotFoundError:
                finish(mesh, None, False, (SKIP_NO_MESH, f"not in archive: {mesh}"))
                continue
            except Exception as exc:  # noqa: BLE001
                log("warn", f"{mesh}: {type(exc).__name__}: {exc}")
                finish(mesh, None, False, (SKIP_NO_MESH, f"unreadable: {type(exc).__name__}: {exc}"))
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
                    _collect(fut, pending, settle, log, SilhouetteSkip)
        while pending:
            done_set, _ = wait(list(pending), return_when=FIRST_COMPLETED)
            for fut in done_set:
                _collect(fut, pending, settle, log, SilhouetteSkip)

        # LOD1 retries: read on this thread, convert on the pool.
        lod_jobs: Dict[Any, Tuple[str, str, Tuple[str, str]]] = {}
        for mesh, skip in retry:
            lod = lod1_sibling(mesh) or ""
            try:
                src = exporter.source(lod, tolerance_m)
            except FileNotFoundError:
                finish(mesh, None, False, (skip[0], f"{skip[1]}; no _lod1 sibling"))
                continue
            except Exception as exc:  # noqa: BLE001
                finish(mesh, None, False, (skip[0], f"{skip[1]}; lod1 unreadable: {type(exc).__name__}"))
                continue
            hit = exporter.cached(src)
            if hit is not None:
                finish(mesh, hit, True, used_mesh=lod)
                continue
            mesh_id = _safe_filename(Path(lod).stem)
            lod_jobs[pool.submit(exporter.compute, src, mesh_id, tolerance_m)] = (mesh, lod, skip)
        for fut, (mesh, lod, skip) in lod_jobs.items():
            try:
                sil = fut.result()
            except SilhouetteSkip as exc:
                finish(mesh, None, False, (skip[0], f"{skip[1]}; lod1: {exc.reason}: {exc.detail}"))
                continue
            except Exception as exc:  # noqa: BLE001
                finish(mesh, None, False, (skip[0], f"{skip[1]}; lod1: {type(exc).__name__}: {exc}"))
                continue
            if sil is None:
                finish(mesh, None, False, (SKIP_EMPTY, f"{skip[1]}; lod1 traced no outline"))
                continue
            log("info", f"silhouette {Path(mesh).stem}: LOD0 failed to convert, used {Path(lod).name}")
            finish(mesh, sil, False, used_mesh=lod)

    write_skips(out_dir, skips)
    reasons: Dict[str, int] = {}
    for sk in skips:
        reasons[sk["reason"]] = reasons.get(sk["reason"], 0) + 1
    stats["skipReasons"] = reasons
    ship_skips = [sk for sk in skips if sk["kind"] == "ship"]
    if ship_skips:
        log("warn", f"{len(ship_skips)} ship(s) without a silhouette: "
                    + ", ".join(f"{sk['className']} ({sk['reason']})" for sk in ship_skips[:40])
                    + (" …" if len(ship_skips) > 40 else ""))

    log("info", f"silhouette build: {stats['written']} written ({stats['cached']} from cache), "
                f"{stats['skipped']} skipped (no usable geometry), "
                f"{len(by_mesh)} distinct mesh(es) on {workers} worker(s)")
    if stats["shipsWithoutAnchors"]:
        log("warn", f"{stats['shipsWithoutAnchors']}/{stats['ships']} ship silhouettes without anchors: "
                    + ", ".join(sorted(no_anchor)[:40]) + (" …" if len(no_anchor) > 40 else ""))
    return stats


def _collect(fut: Any, pending: Dict[Any, str], finish: Callable[..., None],
             log: Callable[[str, str], None], skip_type: type) -> None:
    mesh = pending.pop(fut)
    skip: Optional[Tuple[str, str]] = None
    try:
        silhouette = fut.result()
    except skip_type as exc:
        silhouette, skip = None, (exc.reason, exc.detail)
    except Exception as exc:  # noqa: BLE001 — one bad mesh must not abort the run
        log("warn", f"{mesh}: {type(exc).__name__}: {exc}")
        silhouette, skip = None, ("convert_failed", f"{type(exc).__name__}: {exc}")
    finish(mesh, silhouette, False, skip)


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
        write_skips(args.out, list(manifest.get("skips") or []))
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
                       tolerance_m=args.tolerance_m, workers=args.workers, log=log,
                       manifest_skips=manifest.get("skips") or [])
    log("info", f"anchor coverage: {stats['ships'] - stats['shipsWithoutAnchors']}/{stats['ships']} "
                f"ship silhouettes with anchors, {stats['shipsWithoutAnchors']} without")
    return 0


if __name__ == "__main__":
    sys.exit(main())
