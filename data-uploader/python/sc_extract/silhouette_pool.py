"""Silhouette meshes in worker PROCESSES.

Threads did not get past about one core: after cgf-converter returns, everything
— glb parse, the triangle lists, the pure-Python contour trace — needs the GIL.
Measured on 120 real LIVE 4.10 meshes with 8 workers: 2.5 meshes/s on threads
with 2600 s of booked step time (the steps mostly waiting for each other), 5.0
meshes/s on processes with 155 s. That is why a run sat far below the CPU limit.

The P4K stays with the one reader thread of the parent: a mesh is 2.8 ms to read
and hash there, and concurrent reads got SLOWER (13 ms each on 8 threads), so
that thread is not the bottleneck. Only `compute` moves here. The build's dispatch
threads stay as they are and just wait on the process, so the time budget, the
LOD1 retry and the skip accounting in `silhouette_build` do not change.

Processes start on demand up to ``max_workers`` (`ProcessPoolExecutor` on spawn)
and only as many jobs as the live worker target are ever in flight, so a run
started at a low limit costs one process until the operator opens it up.
"""
from __future__ import annotations

import multiprocessing as mp
import os
import threading
import time
from concurrent.futures import BrokenExecutor, ProcessPoolExecutor
from dataclasses import asdict
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import events, gpu_share, stage_timing
from .silhouette_export import (SKIP_CONVERT_FAILED, MeshSource, SilhouetteExportConfig,
                                SilhouetteExporter, SilhouetteSkip, deadline_remaining,
                                set_deadline)

#: A dead worker takes every in-flight job of the pool with it; those get one
#: more try. After this many deaths the run stops using processes altogether:
#: slow beats failing every mesh that is left.
MAX_POOL_DEATHS = 8

_W: Dict[str, Any] = {"exporter": None, "logs": []}


class _DropEvents:
    """Only the parent owns stdout: two writers tear each other's JSON lines."""

    def put(self, event: Dict[str, Any]) -> None:
        pass


def _init_worker() -> None:
    from . import silhouette_gpu
    events.set_event_sink(_DropEvents())
    silhouette_gpu.set_disable_hook(lambda reason: _W["logs"].append(
        ("warn", f"silhouette raster: GPU failed ({reason}) — CPU from here on")))


def _job(cfg: Dict[str, Any], src: MeshSource, mesh_id: str, tolerance_m: float,
         budget_s: Optional[float], env: Dict[str, str]) -> Tuple[Tuple[Any, ...], List[Tuple[str, str]], Any]:
    os.environ.update(env)
    logs: List[Tuple[str, str]] = []
    _W["logs"] = logs
    exporter = _W["exporter"]
    if exporter is None:
        exporter = _W["exporter"] = SilhouetteExporter(None, SilhouetteExportConfig(**cfg))
    exporter.cfg.on_log = lambda level, msg: logs.append((level, msg))
    set_deadline(time.monotonic() + budget_s if budget_s is not None else None)
    before = stage_timing.snapshot()
    outcome: Tuple[Any, ...]
    try:
        outcome = ("ok", exporter.compute_local(src, mesh_id, tolerance_m))
    # Tagged instead of raised: an exception crossing the pool is rebuilt from its
    # args, which would scramble SilhouetteSkip's reason/detail.
    except SilhouetteSkip as exc:
        outcome = ("skip", exc.reason, exc.detail)
    except Exception as exc:  # noqa: BLE001 — one bad mesh must not take the worker
        outcome = ("error", f"{type(exc).__name__}: {exc}")
    finally:
        set_deadline(None)
    return outcome, logs, stage_timing.since(before)


class ProcessCompute:
    def __init__(self, cfg: SilhouetteExportConfig, max_workers: int,
                 live_workers: Callable[[], int]) -> None:
        fields = asdict(cfg)
        fields.pop("on_log", None)
        self._cfg = fields
        self._max = max(1, int(max_workers))
        self._live = live_workers
        self._log = cfg.on_log
        self._lock = threading.Lock()
        self._pool: Optional[ProcessPoolExecutor] = None
        self._generation = 0
        self._deaths = 0
        self._disabled = False

    def _current(self) -> Tuple[Optional[ProcessPoolExecutor], int]:
        with self._lock:
            if self._disabled:
                return None, self._generation
            if self._pool is None:
                try:
                    self._pool = ProcessPoolExecutor(max_workers=self._max, mp_context=mp.get_context("spawn"),
                                                     initializer=_init_worker)
                except Exception as exc:  # noqa: BLE001 — locked-down machine: threads still work
                    self._disabled = True
                    self._log("warn", f"silhouette workers: no process pool ({exc}) — on threads")
                    return None, self._generation
            return self._pool, self._generation

    def _on_death(self, generation: int) -> None:
        with self._lock:
            if generation != self._generation:
                return  # another thread already replaced this pool
            self._generation += 1
            self._deaths += 1
            pool, self._pool = self._pool, None
            if self._deaths >= MAX_POOL_DEATHS:
                self._disabled = True
        if pool is not None:
            pool.shutdown(wait=False, cancel_futures=True)
        self._log("warn", f"silhouette worker process died ({self._deaths}/{MAX_POOL_DEATHS})"
                  + (" — on threads from here on" if self._disabled else ""))

    def _env(self) -> Dict[str, str]:
        return {
            "SC_USE_GPU": os.environ.get("SC_USE_GPU", "0"),
            "SC_GPU_SHARE": os.environ.get(gpu_share.ENV, "100"),
            gpu_share.WORKERS_ENV: str(max(1, self._live())),
        }

    def compute(self, exporter: SilhouetteExporter, src: MeshSource, mesh_id: str,
                tolerance_m: float) -> Optional[Dict[str, Any]]:
        for _attempt in range(2):
            pool, generation = self._current()
            if pool is None:
                return exporter.compute_local(src, mesh_id, tolerance_m)
            try:
                fut = pool.submit(_job, self._cfg, src, mesh_id, tolerance_m,
                                  deadline_remaining(), self._env())
                outcome, logs, booked = fut.result()
            except BrokenExecutor:
                self._on_death(generation)
                continue
            for level, msg in logs:
                self._log(level, msg)
            stage_timing.absorb(booked)
            if outcome[0] == "ok":
                return outcome[1]
            if outcome[0] == "skip":
                raise SilhouetteSkip(outcome[1], outcome[2])
            raise RuntimeError(outcome[1])
        # Two pools died under this mesh — retrying it would take a third.
        raise SilhouetteSkip(SKIP_CONVERT_FAILED, "worker process died on this mesh")

    def close(self, kill: bool = False) -> None:
        """``kill``: a worker may be stuck on an abandoned mesh, do not wait for it."""
        with self._lock:
            pool, self._pool = self._pool, None
            self._disabled = True
        if pool is None:
            return
        procs = list((getattr(pool, "_processes", None) or {}).values()) if kill else []
        pool.shutdown(wait=not kill, cancel_futures=True)
        for p in procs:
            try:
                p.kill()
            except Exception:  # noqa: BLE001 — already gone
                pass
