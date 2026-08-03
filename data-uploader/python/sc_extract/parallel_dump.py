"""Process-pool driver for the exhaustive record dump.

WHY PROCESSES, NOT THREADS
    The dump's cost is ``DataForge.record_to_dict`` — pure-Python graph
    resolution over every record of every type. That is GIL-bound, so threads
    buy nothing; only separate interpreters do.

WHY THIS STAGE
    ``CodexExtractor.dump_all_records`` is the one stage that touches neither
    the open P4K handle nor any of the extractor's lazily-built caches
    (``_assets``, ``_dim_cache``, ``_helper_cache``, ``_manu_cache``,
    ``_skin_disco``). It reads ``self.df`` and writes one JSON file per record
    into a per-type directory. That makes it embarrassingly parallel by record
    TYPE: no shared mutable state, no two workers writing the same path.

WHY SHARED MEMORY
    Under the ``spawn`` start method — the only one Windows has — a worker
    inherits nothing. ``DataForge`` holds a ``memoryview``, which is not
    picklable, and the open ``P4KFile`` sits on a ~157 GB archive, so neither
    the parsed container nor the archive can be handed to a worker directly.
    What CAN cross is the raw DataCore blob, and only once: the parent publishes
    it in a ``SharedMemory`` segment and each worker maps that segment and
    re-parses it locally. Re-parsing is header/struct-table work proportional to
    the type tables, not to the ~115k records, so it is cheap next to the dump
    itself — and it means the raw blob exists once in RAM no matter how many
    workers run. What does NOT get shared is the parsed Python object graph;
    that is per-worker, and it is what the memory budget has to size against.

WHY THE PARENT KEEPS STDOUT
    Workers never write to stdout — see ``events.set_event_sink``. They push
    events onto a queue and the parent re-emits them, because two processes
    sharing one pipe tear each other's JSON lines apart and the Electron bridge
    silently drops what it cannot parse.
"""

from __future__ import annotations

import json
import multiprocessing as mp
import os
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from multiprocessing.shared_memory import SharedMemory
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import events

#: How many records a worker writes before it reports a delta upstream. Small
#: enough that a 40k-record type still moves the bar, large enough that the
#: queue does not become the bottleneck.
DELTA_EVERY = 250

#: Conservative per-worker resident-memory estimate for the parsed DataForge
#: object graph, used only to clamp the worker count against ``--mem-cap-mb``.
#: Deliberately a guess, and named as one: it is the number to re-measure once
#: a real run has been profiled. Too high only costs parallelism; too low would
#: cost the user their machine, so it errs high.
EST_WORKER_MB = 450

# ── Worker-local state ──────────────────────────────────────────────────────
# Rebuilt once per worker process by _init and never mutated afterwards. A
# module global is the only way to keep it across tasks: ProcessPoolExecutor
# gives no per-worker object, and re-parsing per task would dwarf the work.
_W: Dict[str, Any] = {}


def worker_count(requested: int, mem_cap_mb: int = 0) -> int:
    """Resolve the worker count the parent will actually use.

    ``requested`` comes from the host on the command line and is authoritative:
    the sidecar must NEVER infer it from ``os.cpu_count()``. That is not
    pedantry — ``cpu_count`` is affinity-blind on Windows, so a run throttled to
    one core would still spawn one worker per logical processor and they would
    all time-slice that single core, landing far slower than the serial path
    they replaced, at N times the memory.

    ``mem_cap_mb`` clamps the count. It is ADVISORY and cannot be anything else:
    CPython on Windows has no per-process memory ceiling short of the Job Object
    API, so the honest thing it can do is limit how many parsed copies of the
    DataCore exist at once.
    """
    n = max(1, int(requested))
    if mem_cap_mb and mem_cap_mb > 0:
        affordable = max(1, int(mem_cap_mb) // EST_WORKER_MB)
        n = min(n, affordable)
    return n


def _init(shm_name: str, shm_size: int, out_dir: str, queue: Any) -> None:
    """Map the shared DataCore, re-parse it, and divert events to the parent."""
    from .dataforge import DataForge

    events.set_event_sink(queue)
    shm = SharedMemory(name=shm_name)
    try:
        # Copy out of the mapping, then close it immediately. Holding a
        # memoryview into the segment instead would be one allocation cheaper,
        # but SharedMemory.close() raises `BufferError: cannot close exported
        # pointers exist` while any view is alive — and that fires from
        # __del__ at interpreter shutdown, where it becomes an unraisable
        # Traceback on stderr. The Electron bridge classifies any line matching
        # /Traceback/ as an ERROR log, so a healthy run would end by printing
        # errors at the operator. The copy is a memcpy from an already-mapped
        # page; the pickling it avoids (the blob crossing the pool's pipe once
        # per worker) is the expensive part, and that saving stands.
        blob = bytes(shm.buf[:shm_size])
    finally:
        shm.close()
    _W["df"] = DataForge(blob)
    _W["out"] = Path(out_dir)
    _W["queue"] = queue
    _W["pid"] = os.getpid()


def _dump_one_type(type_name: str) -> Tuple[str, int, int, int]:
    """Write every record of one type. Returns (type, written, unwritable, worker pid)."""
    from .dataforge_extract import _safe_filename, _strip_type_prefix

    df = _W["df"]
    queue = _W["queue"]
    tdir = Path(_W["out"]) / _safe_filename(type_name)
    tdir.mkdir(parents=True, exist_ok=True)

    written = 0
    n_fail = 0
    since_report = 0
    for r in df.records_by_type_name(type_name):
        try:
            resolved = df.record_to_dict(r, max_depth=24)
        except Exception as exc:  # noqa: BLE001 — never let one record abort the dump
            resolved = {"_error_": str(exc), "_RecordId_": r.guid, "_RecordName_": r.name}
            events.log("warn", f"record_to_dict failed for {r.name}: {exc}")
        stem = _safe_filename(_strip_type_prefix(r.name))[:96]
        try:
            tdir.joinpath(f"{stem}__{r.guid[:8]}.json").write_text(
                json.dumps(resolved, ensure_ascii=False), encoding="utf-8")
        except OSError as exc:  # noqa: BLE001 — skip, never abort the dump
            n_fail += 1
            events.log("warn", f"write failed for {stem}: {exc}")
            continue
        written += 1
        since_report += 1
        if since_report >= DELTA_EVERY:
            # A DELTA, never an absolute: two workers reporting absolutes would
            # race and the bar would jump backwards. Only the parent, which sees
            # every worker, can hold a monotonic total.
            _report_delta(queue, since_report, type_name)
            since_report = 0
    if since_report:
        _report_delta(queue, since_report, type_name)
    # The pid is returned so the parent can log how many DISTINCT processes did
    # the work. "Maximum throughput" is a claim about parallelism; a run that
    # silently fell back to one worker must be visible in the log, not inferred.
    return type_name, written, n_fail, int(_W.get("pid", 0))


def _report_delta(queue: Any, n: int, type_name: str) -> None:
    try:
        queue.put({"type": f"{events.INTERNAL_PREFIX}delta", "n": n, "detail": type_name})
    except Exception:  # noqa: BLE001 — a dead queue must not kill the worker
        pass


class PoolUnusable(RuntimeError):
    """The worker pool could not be used at all — the caller must run serially.

    Raised INSTEAD of returning empty tallies. That distinction is the whole
    point: a dump that returns ``(Counter(), 0, 0)`` looks exactly like a run
    with nothing to do, so the caller would write an index saying "0 records",
    emit a success event, and ship an empty ``records/`` directory. Every
    catastrophic pool failure (no shared memory, a worker that cannot import
    the package, a frozen build without ``freeze_support``) must surface here
    so the serial path can still produce the data.
    """


def dump_records_parallel(
    df: Any,
    raw_dcb: bytes,
    out_base: Path,
    workers: int,
    on_log: Callable[[str, str], None],
    on_count: Callable[[str, int], None],
    on_progress: Callable[..., None],
    pct_range: Tuple[int, int] = (0, 100),
) -> Tuple[Counter, int, int]:
    """Run the exhaustive dump across ``workers`` processes.

    Returns ``(per_type, total_written, n_unwritable)`` — the same tallies the
    serial path produces, so the caller's index/manifest code is unchanged.

    Raises :class:`PoolUnusable` when the pool could not do the work at all, so
    the caller falls back to the serial dump instead of shipping nothing.
    """
    out_base.mkdir(parents=True, exist_ok=True)
    types = sorted(df.record_types)
    total_records = len(df.records)
    per_type: Counter = Counter()
    total = 0
    n_fail = 0
    completed = 0  # monotonic across all workers — the only progress source

    lo, hi = pct_range
    shm: Optional[SharedMemory] = None
    queue: Any = None
    pool: Optional[ProcessPoolExecutor] = None
    n_type_errors = 0
    worker_pids: set = set()
    try:
        shm = SharedMemory(create=True, size=max(1, len(raw_dcb)))
        shm.buf[: len(raw_dcb)] = raw_dcb
        # 'spawn' explicitly, even though it is already the Windows default:
        # this design assumes a worker inherits NOTHING (it re-parses from the
        # shared segment), and a forked worker silently inheriting a half-built
        # parent state is exactly the bug that would only show on Linux.
        ctx = mp.get_context("spawn")
        queue = ctx.Queue()
        pool = ProcessPoolExecutor(
            max_workers=workers,
            mp_context=ctx,
            initializer=_init,
            initargs=(shm.name, len(raw_dcb), str(out_base), queue),
        )

        def _absorb(ev: Dict[str, Any]) -> None:
            nonlocal completed
            completed += int(ev.get("n", 0))

        futures = {pool.submit(_dump_one_type, t): t for t in types}
        done_types = 0
        n_type_errors = 0
        for fut in _as_completed_draining(futures, queue, _absorb):
            done_types += 1
            try:
                tname, written, failed, wpid = fut.result()
                if wpid:
                    worker_pids.add(wpid)
            except Exception as exc:  # noqa: BLE001 — one type must not kill the dump
                tname = futures[fut]
                written, failed = 0, 0
                n_type_errors += 1
                on_log("error", f"record dump failed for type {tname}: {exc}")
            per_type[tname] += written
            total += written
            n_fail += failed
            # `completed` (worker deltas) is the smooth signal; `total` is the
            # authoritative one. Report the larger so the bar never regresses
            # when a type finishes between two delta reports.
            shown = max(completed, total)
            on_count("records_total", shown)
            on_progress("records", current=min(shown, total_records), total=total_records,
                        pct=_mapped(shown, total_records, lo, hi),
                        detail=f"{done_types}/{len(types)} types")
    except Exception as exc:  # noqa: BLE001 — pool setup / shared memory / spawn
        raise PoolUnusable(f"{type(exc).__name__}: {exc}") from exc
    finally:
        if pool is not None:
            # cancel_futures so a mid-run failure does not sit here waiting for
            # every queued type to finish before it can report the error.
            pool.shutdown(wait=True, cancel_futures=True)
        if queue is not None:
            events.drain_events(queue, limit=4096)  # last words from the workers
            try:
                queue.close()
            except Exception:  # noqa: BLE001
                pass
        if shm is not None:
            try:
                shm.close()
                shm.unlink()
            except Exception:  # noqa: BLE001 — a leaked segment is not worth failing a run
                pass

    # Every type erroring out is not "a dump with no records" — it is a pool
    # that never did any work (a dead worker fails each future in turn rather
    # than raising once). Returning the empty tallies here would write an index
    # claiming 0 records and let the run report success over an empty
    # records/ directory, so say so and let the caller run serially.
    if types and n_type_errors == len(types):
        raise PoolUnusable(f"all {len(types)} record type(s) failed in the worker pool")

    on_log("info", f"record dump: {total:,} records via {len(worker_pids)} worker "
                   f"process(es) (pids {sorted(worker_pids)})")
    on_progress("records", current=total_records, total=total_records, pct=hi)
    return per_type, total, n_fail


def _as_completed_draining(futures: Dict[Any, str], queue: Any, on_internal: Any):
    """``as_completed``, but pumping the worker event queue while it waits.

    Without this the queue only drains when a whole record TYPE finishes, so a
    large type would look frozen for minutes and — worse — a queue that fills up
    blocks the worker that is writing to it.
    """
    from concurrent.futures import wait, FIRST_COMPLETED

    pending = set(futures)
    while pending:
        done, pending = wait(pending, timeout=0.25, return_when=FIRST_COMPLETED)
        events.drain_events(queue, on_internal=on_internal)
        for fut in done:
            yield fut


def _mapped(current: int, total: int, lo: int, hi: int) -> int:
    if total <= 0:
        return lo
    return lo + int((hi - lo) * min(1.0, current / total))
