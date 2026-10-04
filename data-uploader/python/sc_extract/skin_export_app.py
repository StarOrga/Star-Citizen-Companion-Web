"""Events-emitting CLI for the 3D hull export (one geometry-only glb per ship
+ paint icons) — consumed by the Electron
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

    # driven by the metadata extract's build manifest (normal flow):
    python -m sc_extract.skin_export_app --p4k <Data.p4k> --out <skins-cache> \\
        --converter <cgf-converter.exe> --manifest <out>/skins/_build_manifest.json \\
        [--skip-existing]

    # --workers N builds N ships at once in spawned processes (default: auto
    # from cores and RAM); each worker opens its own P4K + DataCore.

    # standalone packages (docs/asset-package.md), with or without ships:
    python -m sc_extract.skin_export_app --p4k <Data.p4k> --out <dir> \
        --converter <cgf-converter.exe> --fps [--weapon <class|glob>] \
        --items [--item <class|glob>] [--max-packages N]
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import stage_timing
from .events import count, done, error, log, phase, progress
from .hull3d import EXPORT_FORMAT, Hull3DExporter, HullExportConfig
from .ship_discovery import ShipDiscovery, ShipRef
from .ship_export import parse_ship


def _common_reason(reasons: list[str]) -> str:
    """The most frequent per-skin failure for one ship, trimmed for a log line."""
    counts: dict[str, int] = {}
    for r in reasons:
        key = r.split(":")[0].strip()[:80] or "unknown"
        counts[key] = counts.get(key, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0]


def _group_reasons(barren: list[dict]) -> dict[str, list[str]]:
    """Ship ids grouped by why they produced nothing, biggest bucket first."""
    out: dict[str, list[str]] = {}
    for b in barren:
        out.setdefault(b["reason"], []).append(b["ship_id"])
    return dict(sorted(out.items(), key=lambda kv: -len(kv[1])))


def _refs_from_manifest(path: Path) -> list[ShipRef]:
    """Load ShipRefs from an extract's skins/_build_manifest.json."""
    data = json.loads(path.read_text(encoding="utf-8"))
    out: list[ShipRef] = []
    for s in data.get("ships", []):
        out.append(ShipRef(
            ship_id=s["ship_id"], mfr=s["mfr"],
            ship=s["ship"], series_token=s.get("series_token", s["ship"]),
        ))
    return out


class _PackageBuilder:
    """--package: the entity package per ship (sc_extract.assets3d). Loads the
    DataCore once; parts dedup across every ship of the run (and across runs,
    via <out>/_parts/index*.json). A package failure never costs the hull."""

    def __init__(self, p4k, args, exporter, on_log, worker: str = "") -> None:
        from .assets3d.datacore import DataCoreSource, P4KReader, load_datacore
        from .assets3d.parts import PartStore
        phase("datacore")
        self.reader = P4KReader(p4k)
        log("info", "package: parsing DataCore")
        self.optimize = exporter._optimize
        self.out = args.out.resolve()
        self.interior = args.interior
        self.store = PartStore(self.out / "_parts", self.reader.read, self.reader.exists,
                               args.converter, self.optimize,
                               self.out / f"_work_parts{worker}", on_log=on_log,
                               index_name=f"index.{worker.strip('_')}.json" if worker
                               else "index.json")
        self.source = DataCoreSource(load_datacore(self.reader), self.reader,
                                     node_helpers=self.store.helpers)
        self.rows: list[dict] = []
        # The hull exporter hands over its raw, un-rigged hull: its node tree
        # places the ship's ports and (with --interior) it IS the interior's
        # source — without it the same hull is converted twice more.
        self._hull_nodes: dict[str, dict] = {}
        self._interior_raw: Optional[Path] = None
        exporter.raw_hook = self._on_raw_hull

    def _on_raw_hull(self, spec, raw_glb: Path) -> None:
        from . import glb_materials
        from .assets3d.parts import glb_node_transforms
        nodes = glb_node_transforms(glb_materials.read_glb(raw_glb)[0])
        if nodes:
            self._hull_nodes[_geo_key(spec.hull_cga)] = nodes
        if self.interior:
            self.store.work.mkdir(parents=True, exist_ok=True)
            dest = self.store.work / "hull_raw_for_interior.glb"
            shutil.copyfile(raw_glb, dest)
            self._interior_raw = dest

    def build(self, ship_id: str, spec, hull_glb):
        from .assets3d.ships import build_ship_package, export_interior
        from .hull3d import hull_paint
        res = None
        try:
            if spec is not None:
                key = _geo_key(spec.hull_cga)
                nodes = self._hull_nodes.get(key)
                if nodes and not isinstance(self.store.index.get("helpers:" + key), dict):
                    self.store.index["helpers:" + key] = nodes
            interior = None
            if self.interior and spec is not None:
                paint = hull_paint(spec.paints)
                interior = export_interior(self.store, spec.hull_cga,
                                           paint.mtl if paint else None,
                                           self.out / "_interiors", self.optimize,
                                           raw_glb=self._interior_raw)
            res = build_ship_package(ship_id, self.source, self.reader, self.store,
                                     hull_glb, self.out / ship_id, interior)
            self.store.save_index()
        except Exception as exc:  # noqa: BLE001 — the hull still ships
            log("warn", f"{ship_id}: package failed: {type(exc).__name__}: {exc}")
            return {"error": str(exc)[:300]}
        finally:
            self.store.release_raw()
            self._hull_nodes.clear()
            if self._interior_raw is not None:
                self._interior_raw.unlink(missing_ok=True)
                self._interior_raw = None
        if res is None:
            log("warn", f"{ship_id}: package skipped — no DataCore entity")
            return {"error": "no DataCore entity"}
        pl = res.manifest["placements"]
        row = {
            "ship_id": ship_id,
            "manifest": f"{ship_id}/package.json",
            "manifest_bytes": res.manifest_bytes,
            "root_bytes": res.root_bytes,
            "interior_bytes": res.interior_bytes,
            "part_bytes": res.unique_part_bytes,
            "parts": sorted(res.manifest["parts"]),
            "placements": len(pl),
            "placed": sum(1 for p in pl if p["position"] is not None),
            "with_part": sum(1 for p in pl if p["partSha256"]),
            "locators": res.locators,
        }
        row["total_bytes"] = (row["manifest_bytes"] + row["root_bytes"]
                              + row["interior_bytes"] + row["part_bytes"])
        self.rows.append(row)
        loc = res.locators or {}
        log("info", f"{ship_id}: package {row['total_bytes'] / 1e6:.2f} MB "
                    f"({len(row['parts'])} part(s), {row['with_part']}/{len(pl)} placements "
                    f"with geometry; locators {loc.get('checked', 0)} checked, "
                    f"max {loc.get('max_error_m')} m)")
        return {k: v for k, v in row.items() if k != "parts"}

    def standalone(self, kind: str, patterns: list[str], limit) -> list[dict]:
        """--fps / --items: one package per class into <out>/_fps|_items/<class>/.
        ``patterns`` = exact class names or fnmatch globs (empty = every class
        the kind's enumeration rule admits). A failure skips the class."""
        from .assets3d import fps as fps_mod
        from .assets3d import items as items_mod
        if kind == "fps":
            src = getattr(self, "_fps_source", None) or fps_mod.FpsSource(self.source, self.reader)
            self._fps_source = src
            enumerate_all = lambda: fps_mod.fps_weapon_classes(src)  # noqa: E731
            build = lambda c: fps_mod.build_fps_package(c, src, self.store, self.out)  # noqa: E731
            folder = fps_mod.FPS_DIR
        else:
            src = self.source
            enumerate_all = lambda: items_mod.item_classes(src)  # noqa: E731
            build = lambda c: items_mod.build_item_package(c, src, self.store, self.out)  # noqa: E731
            folder = items_mod.ITEMS_DIR
        phase(f"package-{kind}")
        globs = [p for p in patterns if any(ch in p for ch in "*?[")]
        classes = [p for p in patterns if p not in globs]
        if globs or not patterns:
            log("info", f"{kind}: enumerating classes")
            pool = enumerate_all()
            if not patterns:
                classes = pool[: limit or None]
            for g in globs:  # the cap applies per glob, so every pattern is represented
                hits = [c for c in pool if fnmatch.fnmatch(c.lower(), g.lower())]
                classes += hits[: limit or None]
        classes = list(dict.fromkeys(classes))
        log("info", f"{kind}: {len(classes)} package(s) to build")
        rows: list[dict] = []
        for i, cls in enumerate(classes):
            progress(f"{kind}-packages", current=i + 1, total=len(classes))
            try:
                res = build(cls)
                self.store.save_index()
            except Exception as exc:  # noqa: BLE001 — one class never costs the run
                log("warn", f"{cls}: {kind} package failed: {type(exc).__name__}: {exc}")
                continue
            if res is None:
                log("warn", f"{cls}: {kind} package skipped — no record or no geometry")
                continue
            m = res.manifest
            pl = m["placements"]
            row = {
                "className": m["entity"]["className"],
                "manifestPath": f"{folder}/{m['entity']['className']}/package.json",
                "bytes": res.manifest_bytes,
                "rootSha256": (m["root"] or {}).get("sha256"),
                "rootBytes": res.root_bytes,
                "partBytes": res.unique_part_bytes,
                "parts": len(m["parts"]),
                "placements": len(pl),
                "withPart": sum(1 for x in pl if x["partSha256"]),
            }
            rows.append(row)
            self.rows.append({"parts": sorted(m["parts"]) + ([row["rootSha256"]]
                              if row["rootSha256"] else [])})
            log("info", f"{cls}: {kind} package root {row['rootBytes'] / 1e3:.0f} kB, "
                        f"{row['parts']} part(s), {row['withPart']}/{len(pl)} placements "
                        f"with geometry")
        return rows

    def summary(self) -> dict:
        return package_summary([r["parts"] for r in self.rows if "parts" in r],
                               sum(1 for r in self.rows if "ship_id" in r), len(self.rows),
                               self.store.dir, self.store.hits, self.store.misses)


def _geo_key(path: str) -> str:
    return path.replace("\\", "/").lower()


def package_summary(part_lists: list, ships: int, entities: int, store_dir: Path,
                    hits: int, misses: int) -> dict:
    """Dedup across the run: bytes if every entity stored its own parts vs. stored once."""
    unique = {sha for parts in part_lists for sha in parts}
    sizes = {sha: ((store_dir / f"{sha}.glb").stat().st_size
                   if (store_dir / f"{sha}.glb").exists() else 0) for sha in unique}
    naive = sum(sizes[sha] for parts in part_lists for sha in parts)
    stored = sum(sizes.values())
    return {
        "ships": ships, "entities": entities,
        "part_refs": sum(len(p) for p in part_lists), "unique_parts": len(unique),
        "part_bytes_naive": naive, "part_bytes_deduped": stored,
        "dedup_ratio": round(naive / max(1, stored), 2),
        "cache_hits": hits, "cache_misses": misses,
    }


def _parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Events-emitting 3D ship-skin exporter")
    ap.add_argument("--p4k", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--converter", required=True, type=Path)
    ap.add_argument("--ship", action="append", default=[],
                    help="ship_id (known) or ship_id:MFR:Ship:SeriesToken (repeatable)")
    ap.add_argument("--manifest", type=Path, default=None,
                    help="skins/_build_manifest.json from the metadata extract "
                         "(alternative to --ship; drives the normal flow)")
    ap.add_argument("--skip-existing", action="store_true",
                    help="patch-version cache: skip ships already built into --out "
                         "(a non-empty <out>/<ship_id>/skins.json exists)")
    ap.add_argument("--texture-size", type=int, default=1024)
    ap.add_argument("--max-model-mb", type=float, default=1.5,
                    help="per-skin glb size budget; over-budget skins are re-optimized "
                         "at lower texture size (0 disables)")
    ap.add_argument("--limit-skins", type=int, default=None)
    ap.add_argument("--package", action="store_true",
                    help="also build the 3D entity package: shared part glbs in "
                         "<out>/_parts + <out>/<ship>/package.json (docs/asset-package.md); "
                         "additive — the hull output contract is unchanged")
    ap.add_argument("--interior", action="store_true",
                    help="with --package: export the interior layer into <out>/_interiors")
    ap.add_argument("--fps", action="store_true",
                    help="build FPS weapon packages into <out>/_fps/<class>/package.json")
    ap.add_argument("--weapon", action="append", default=[],
                    help="with --fps: weapon class or glob (repeatable; default = all)")
    ap.add_argument("--items", action="store_true",
                    help="build standalone ship-item packages into <out>/_items/<class>/package.json")
    ap.add_argument("--item", action="append", default=[],
                    help="with --items: item class or glob (repeatable; default = all)")
    ap.add_argument("--max-packages", type=int, default=None,
                    help="cap for --fps / --items: per glob pattern, or overall "
                         "when no class filter is given")
    ap.add_argument("--workers", type=int, default=0,
                    help="ships built at once in separate processes (0 = auto from "
                         "cores and RAM, 1 = one after another)")
    return ap


def _on_log(level: str, msg: str) -> None:
    log(level if level in ("info", "warn", "error") else "info", msg)


# ---- worker count ----------------------------------------------------------
# One ship at a time left 11 of 12 hardware threads idle: the pipeline is a
# chain of single-threaded steps (converter, Node optimizer, numpy hole gate).
# Each worker holds its own P4K index + DataCore (~3 GB measured on LIVE 4.10),
# so RAM caps the count as much as cores do.
MAX_WORKERS = 4
WORKER_RAM_GB = 6
THREADS_PER_WORKER = 3


def _total_ram_gb() -> float:
    try:
        if sys.platform == "win32":
            import ctypes

            class _MemStatus(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong),
                            ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong),
                            ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong),
                            ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            st = _MemStatus()
            st.dwLength = ctypes.sizeof(_MemStatus)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st)):  # type: ignore[attr-defined]
                return st.ullTotalPhys / 2 ** 30
            return 0.0
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 2 ** 30
    except Exception:  # noqa: BLE001 — unknown RAM = assume the minimum
        return 0.0


def auto_workers(jobs: int, cpu: Optional[int] = None, ram_gb: Optional[float] = None) -> int:
    if cpu is None:
        cpu = os.cpu_count() or 1
    ram_gb = _total_ram_gb() if ram_gb is None else ram_gb
    return max(1, min(MAX_WORKERS, cpu // THREADS_PER_WORKER, int(ram_gb // WORKER_RAM_GB), jobs))


# ---- one process's export context -----------------------------------------
class _ShipRun:
    """P4K + discovery + exporters for one process. ``worker`` suffixes every
    scratch dir and the part index, so parallel workers never share a file
    they write to (the content-addressed outputs are race-safe by design)."""

    def __init__(self, args, worker: str = "", many: bool = True) -> None:
        from .p4k_compat import apply_p4k_compat
        apply_p4k_compat()
        from scdatatools.p4k import P4KFile

        self.args = args
        phase("discover")
        log("info", f"opening {args.p4k}")
        self.p4k = P4KFile(str(args.p4k))
        log("info", f"opened: {len(self.p4k.namelist())} entries")
        self.disco = ShipDiscovery(self.p4k)
        self.cfg = HullExportConfig(
            cgf_converter=args.converter, out_dir=args.out,
            work_dir=args.out / f"_work{worker}", texture_size=args.texture_size,
            max_model_bytes=int(args.max_model_mb * 1e6),
            on_log=_on_log,
        )
        self.exporter = Hull3DExporter(self.p4k, self.cfg)
        # Whole-catalog builds go through many ships — pre-bucket icons/materials
        # once so each discover() is cheap instead of re-scanning the archive.
        if many:
            self.disco.build_index()
        self.pkg = _PackageBuilder(self.p4k, args, self.exporter, _on_log, worker) \
            if (args.package or args.fps or args.items) else None

    def build(self, ref: ShipRef) -> Tuple[Optional[dict], Optional[dict]]:
        """(entry, barren) for one ship; entry None = no hull mesh found."""
        args, cfg, pkg = self.args, self.cfg, self.pkg
        t0, before = time.perf_counter(), stage_timing.snapshot()
        if args.skip_existing:
            prev = _cached_catalog(args.out, ref.ship_id)
            if prev is not None:
                log("info", f"{ref.ship_id}: cached — skipping build")
                count(ref.ship_id, _cached_model_count(prev))
                entry = _cached_entry(cfg.out_dir, ref.ship_id)
                if pkg and args.package and not (cfg.out_dir / ref.ship_id / "package.json").exists():
                    model = next((s.get("model") for s in prev.get("skins", [])
                                  if s.get("model")), None)
                    entry["package"] = pkg.build(
                        ref.ship_id, None,
                        cfg.out_dir / ref.ship_id / model if model else None)
                return entry, None
        spec = self.disco.discover(ref)
        if args.limit_skins:
            spec.paints = spec.paints[: args.limit_skins]
        if not spec.hull_cga:
            log("warn", f"{ref.ship_id}: no hull mesh found — skipping")
            return None, None
        log("info", f"{ref.ship_id}: {len(spec.paints)} paints — building glbs")
        result = self.exporter.export_ship(spec)
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
        entry = {
            "ship_id": ref.ship_id,
            "export_dir": str((cfg.out_dir / ref.ship_id).resolve()),
            "skins": skins,
        }
        if pkg and args.package:
            model = next((s.get("model") for s in result["skins"] if s.get("model")), None)
            entry["package"] = pkg.build(
                ref.ship_id, spec, cfg.out_dir / ref.ship_id / model if model else None)
        log("info", f"{ref.ship_id}: 3D model {'exported' if n_ok else 'missing'} "
                    f"({len(skins)} paint(s) listed)")
        wall = time.perf_counter() - t0
        log("info", f"{ref.ship_id}: {wall:.0f}s — "
                    f"{stage_timing.summary(stage_timing.since(before), wall)}")
        barren = None
        if n_ok == 0:
            # Per-skin reasons are already in skins.json; nothing used to
            # aggregate them, so a whole-catalog run reported "done" while
            # 93 % of its ships produced nothing (#512).
            reasons = [str(s.get("error")) for s in result["skins"] if s.get("error")]
            barren = {
                "ship_id": ref.ship_id,
                "paints": len(skins),
                "reason": _common_reason(reasons) if reasons
                          else ("no paints discovered" if not skins else "no model written"),
            }
        return entry, barren


def _cached_catalog(out: Path, ship_id: str) -> Optional[dict]:
    """The ship's skins.json if it is a build of the CURRENT format — a cache
    from the textured per-skin export must be rebuilt, or its textured glbs
    would be uploaded again."""
    try:
        prev = json.loads((out / ship_id / "skins.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — missing/unreadable = not cached
        return None
    return prev if isinstance(prev, dict) and prev.get("format") == EXPORT_FORMAT else None


def _cached_model_count(prev: dict) -> int:
    return sum(1 for s in prev.get("skins", []) if s.get("model") or s.get("has_model"))


def _cached_entry(out: Path, ship_id: str) -> dict:
    return {"ship_id": ship_id, "export_dir": str((out / ship_id).resolve()),
            "skins": [], "cached": True}


def _fully_cached(args, ref: ShipRef) -> Optional[dict]:
    """Entry for a ship the parent can answer without a worker (no P4K)."""
    if not args.skip_existing:
        return None
    prev = _cached_catalog(args.out, ref.ship_id)
    if prev is None:
        return None
    if args.package and not (args.out / ref.ship_id / "package.json").exists():
        return None
    log("info", f"{ref.ship_id}: cached — skipping build")
    count(ref.ship_id, _cached_model_count(prev))
    return _cached_entry(args.out.resolve(), ref.ship_id)


# ---- parallel workers ------------------------------------------------------
class _WorkerSink:
    """A worker's events minus its own phase changes: every worker walks
    discover -> datacore -> extract, and forwarding that would flip the run's
    phase back and forth. The parent owns the phase and the ship counter."""

    def __init__(self, queue) -> None:
        self.queue = queue

    def put(self, event: Dict[str, Any]) -> None:
        if event.get("type") == "phase":
            return
        self.queue.put(event)


def _worker_main(args, wid: int, tasks, events_q) -> None:
    """Spawned process: build ships from the shared queue until the sentinel.
    Its events travel to the parent, which owns stdout."""
    from . import events
    events.set_event_sink(_WorkerSink(events_q))
    try:
        run = _ShipRun(args, worker=f"_w{wid}")
    except Exception as exc:  # noqa: BLE001 — the parent reports it and carries on
        events_q.put({"type": "__fail", "worker": wid, "error": f"{type(exc).__name__}: {exc}"})
        return
    events_q.put({"type": "__ready", "worker": wid})
    while True:
        item = tasks.get()
        if item is None:
            break
        idx, ref_fields = item
        ref = ShipRef(**ref_fields)
        events_q.put({"type": "__start", "worker": wid, "idx": idx})
        try:
            entry, barren = run.build(ref)
        except Exception as exc:  # noqa: BLE001 — one ship never costs the worker
            log("warn", f"{ref.ship_id}: build failed: {type(exc).__name__}: {exc}")
            entry, barren = None, {"ship_id": ref.ship_id, "paints": 0,
                                   "reason": f"build failed: {type(exc).__name__}"}
        events_q.put({"type": "__ship", "worker": wid, "idx": idx,
                      "entry": entry, "barren": barren})
    pkg = run.pkg
    events_q.put({"type": "__exit", "worker": wid,
                  "timing": stage_timing.snapshot(),
                  "parts": [r["parts"] for r in pkg.rows if "parts" in r] if pkg else [],
                  "ships": sum(1 for r in pkg.rows if "ship_id" in r) if pkg else 0,
                  "hits": pkg.store.hits if pkg else 0,
                  "misses": pkg.store.misses if pkg else 0})


def _build_parallel(args, jobs: List[Tuple[int, ShipRef]], workers: int, total: int,
                    done_before: int, results: Dict[int, Tuple[Optional[dict], Optional[dict]]],
                    pkg_parts: list, timing: Dict[str, Any]) -> Dict[str, int]:
    """Fan ``jobs`` out over ``workers`` spawned processes. Fills ``results``
    by index; returns cache hit/miss totals for the package summary."""
    import multiprocessing as mp
    from dataclasses import asdict
    from . import events

    # 'spawn' explicitly (see parallel_dump): a worker inherits NOTHING — it
    # opens its own P4K — so the design holds on every platform.
    ctx = mp.get_context("spawn")
    tasks, events_q = ctx.Queue(), ctx.Queue()
    for idx, ref in jobs:
        tasks.put((idx, asdict(ref)))
    for _ in range(workers):
        tasks.put(None)
    procs = [ctx.Process(target=_worker_main, args=(args, w, tasks, events_q), daemon=True)
             for w in range(workers)]
    for p in procs:
        p.start()
    log("info", f"{len(jobs)} ship(s) on {workers} parallel worker(s)")
    in_flight: Dict[int, int] = {}
    exited: set = set()
    stats = {"hits": 0, "misses": 0, "ships": 0}
    finished = done_before

    def on_internal(ev: Dict[str, Any]) -> None:
        nonlocal finished
        kind, wid = ev.get("type"), ev.get("worker")
        if kind == "__start":
            in_flight[wid] = ev["idx"]
        elif kind == "__ship":
            in_flight.pop(wid, None)
            results[ev["idx"]] = (ev.get("entry"), ev.get("barren"))
            finished += 1
            phase("extract", pct=int(finished / max(total, 1) * 100))
            progress("ships", current=finished, total=total)
        elif kind == "__fail":
            log("warn", f"3D worker {wid} could not start: {ev.get('error')}")
            exited.add(wid)
        elif kind == "__exit":
            exited.add(wid)
            pkg_parts.extend(ev.get("parts") or [])
            for k in stats:
                stats[k] += int(ev.get(k) or 0)
            timing.update(stage_timing.merge(timing, ev.get("timing") or {}))

    def drain() -> int:
        return events.drain_events(events_q, limit=2048, on_internal=on_internal)

    try:
        while True:
            if drain():
                continue
            alive = [w for w, p in enumerate(procs) if p.is_alive()]
            if not alive:
                time.sleep(0.2)
                while drain():
                    pass
                break
            time.sleep(0.1)
    finally:
        for p in procs:
            p.join(timeout=5)
    # A worker that died mid-ship (crash, OOM) leaves its ship unanswered.
    for w, p in enumerate(procs):
        if w in in_flight and in_flight[w] not in results:
            idx = in_flight[w]
            ref = dict(jobs)[idx]
            log("warn", f"{ref.ship_id}: worker {w} died mid-build (exit {p.exitcode})")
            results[idx] = (None, {"ship_id": ref.ship_id, "paints": 0,
                                   "reason": f"worker died (exit {p.exitcode})"})
    if len(exited) < workers or any((p.exitcode or 0) != 0 for p in procs):
        log("warn", "some 3D workers did not finish cleanly — their remaining ships "
                    "were not built")
    return stats


def main() -> int:
    ap = _parser()
    args = ap.parse_args()
    if not args.ship and not args.manifest and not (args.fps or args.items):
        ap.error("provide --ship (repeatable), --manifest, --fps or --items")

    # UTF-8 stdout is forced centrally in events.py (imported above) for every
    # sidecar entrypoint — the host launches us with `-E`, so PYTHONIOENCODING
    # can't fix Windows' cp1252 stdout; see events.py for the full rationale.
    t_run = time.perf_counter()
    try:
        refs = _refs_from_manifest(args.manifest) if args.manifest \
            else [parse_ship(s) for s in args.ship]
        log("info", f"{len(refs)} ship(s) to build"
                    f"{' (manifest)' if args.manifest else ''}")

        results: Dict[int, Tuple[Optional[dict], Optional[dict]]] = {}
        # Patch-version cache: a ship already built into --out is answered
        # without opening the P4K; only the rest needs a worker.
        jobs: List[Tuple[int, ShipRef]] = []
        for i, ref in enumerate(refs):
            entry = _fully_cached(args, ref)
            if entry is not None:
                results[i] = (entry, None)
            else:
                jobs.append((i, ref))
        if args.workers > 0:
            # The host asks per speed profile; RAM still caps it (each worker
            # holds its own P4K index + DataCore).
            ram = _total_ram_gb()
            workers = min(args.workers, max(1, int(ram // WORKER_RAM_GB))) if ram else args.workers
        else:
            workers = auto_workers(len(jobs))
        workers = max(1, min(workers, len(jobs) or 1))

        timing: Dict[str, Any] = {}
        pkg_parts: list = []
        pkg_stats = {"hits": 0, "misses": 0, "ships": 0}
        run: Optional[_ShipRun] = None
        needs_local = (args.fps or args.items) or (jobs and workers == 1)
        if needs_local:
            run = _ShipRun(args, many=len(refs) > 1)
        if jobs and workers > 1:
            phase("discover")
            log("info", f"starting {workers} 3D workers — each opens the P4K and the "
                        "DataCore first (a few minutes)")
            pkg_stats = _build_parallel(args, jobs, workers, len(refs), len(results),
                                        results, pkg_parts, timing)
        elif jobs:
            assert run is not None
            for n, (i, ref) in enumerate(jobs):
                done_now = len(results)
                phase("extract", pct=int(done_now / max(len(refs), 1) * 100))
                # Additive: "ship X / Y" — the renderer previously had no goal to
                # show during this loop (only the phase-level pct above), so a
                # whole-catalog build of many ships looked frozen ship-to-ship.
                progress("ships", current=done_now + 1, total=len(refs))
                results[i] = run.build(ref)

        ships_out: list[dict] = []
        # Ships that were admitted to the manifest but wrote no model (#512).
        barren: list[dict] = []
        for i in sorted(results):
            entry, why = results[i]
            if entry is not None:
                ships_out.append(entry)
            if why is not None:
                barren.append(why)

        if refs and not ships_out:
            error("no ships exported (no hull mesh found for any requested ship)")
            return 1

        # ---- run-level verdict (#512) ---------------------------------------
        # A build that admits N ships and produces models for a handful is a
        # manifest problem, not a per-ship accident. Say so once, out loud, with
        # the reasons grouped — otherwise the only trace is a warn line per skin
        # scrolled off the top of an 11-hour run.
        built = [s for s in ships_out if not s.get("cached") and s.get("skins")
                 and any(k.get("has_model") for k in s["skins"])]
        verdict = {
            "ships_requested": len(ships_out),
            "ships_with_models": len(built),
            "ships_without_models": len(barren),
            "reasons": _group_reasons(barren),
        }
        if barren:
            pct = 100.0 * len(built) / max(1, len(ships_out) - sum(1 for s in ships_out if s.get("cached")))
            log("warn", f"build verdict: {len(built)} ship(s) produced a model, "
                        f"{len(barren)} produced none ({pct:.0f} % yield)")
            for reason, ids in verdict["reasons"].items():
                head = ", ".join(ids[:5]) + (f" … +{len(ids) - 5}" if len(ids) > 5 else "")
                log("warn", f"  {len(ids)}x {reason}: {head}")
        run_result: Dict[str, Any] = {"ships": ships_out, "verdict": verdict}
        if run is not None and run.pkg and args.fps:
            run_result["fpsPackages"] = run.pkg.standalone("fps", args.weapon, args.max_packages)
        if run is not None and run.pkg and args.items:
            run_result["itemPackages"] = run.pkg.standalone("items", args.item, args.max_packages)
        if args.package or args.fps or args.items:
            if run is not None and run.pkg:
                pkg_parts.extend(r["parts"] for r in run.pkg.rows if "parts" in r)
                pkg_stats = {k: pkg_stats[k] + v for k, v in (
                    ("hits", run.pkg.store.hits), ("misses", run.pkg.store.misses),
                    ("ships", sum(1 for r in run.pkg.rows if "ship_id" in r)))}
            run_result["packages"] = package_summary(
                pkg_parts, pkg_stats["ships"], len(pkg_parts), args.out.resolve() / "_parts",
                pkg_stats["hits"], pkg_stats["misses"])
        wall = time.perf_counter() - t_run
        booked = stage_timing.merge(timing, stage_timing.snapshot())
        log("info", f"3D build: {wall / 60:.1f} min on {workers} worker(s) — step time "
                    f"summed over workers: {stage_timing.summary(booked, wall * workers)}")
        done(result=run_result)
        return 0
    except Exception as exc:  # noqa: BLE001 — surface as a structured error event
        error(f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
