"""Streaming event emission to stdout — consumed by Electron main process.

One JSON line per event. flush after each line so Electron sees them in real time.
"""

import json
import sys
from typing import Any, Dict, Literal, Optional

# The host (Electron data-uploader) launches every sidecar entrypoint with `-E`,
# which makes Python IGNORE PYTHONUTF8 / PYTHONIOENCODING — so on Windows the
# piped stdout defaults to the legacy locale code page (cp1252 on a German box).
# The events below emit ensure_ascii=False JSON (umlauts, em-dashes, "→", "…",
# CJK/Cyrillic localization strings, ship names, output paths). On an
# un-reconfigured cp1252 stdout that raises UnicodeEncodeError mid-stream (the
# run dies, exit 1, opaque message) or emits non-UTF-8 bytes the Node-side
# readline turns into U+FFFD. Force UTF-8 here, ONCE, for every entrypoint that
# imports this module (extract.py, skin_export_app.py, …) — `-X utf8` on the
# spawn is the host-side belt-and-suspenders. errors="replace" is a last-resort
# guard so a stubborn stream can never crash the run. (See skin_export_app.py,
# which previously carried this fix locally; it now lives here for all callers.)
for _std in ("stdout", "stderr"):
    try:
        getattr(sys, _std).reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except Exception:  # noqa: BLE001 — best-effort; pytest-captured / non-reconfigurable streams no-op
        pass

EventType = Literal["phase", "progress", "file", "count", "log", "warning", "done", "error"]
LogLevel = Literal["info", "warn", "error"]
Phase = Literal["discover", "plan", "extract", "validate", "bundle"]

# ── Single-writer discipline ────────────────────────────────────────────────
#
# EXACTLY ONE process may ever write to stdout. Worker processes inherit the
# same stdout pipe handle, and a JSON line longer than the pipe's atomic-write
# boundary is split into several WriteFiles — on a Windows byte-mode pipe two
# writers therefore interleave and produce a torn line. The Electron bridge
# parses stdout line-by-line and DROPS anything that fails JSON.parse
# (`src/main/python-bridge.ts`), so a torn line is silently lost. When the torn
# line is the 'done' event, the bridge sees a clean exit with no result and
# reports a fully successful multi-hour extract as a FAILURE.
#
# So workers never touch stdout: they install a sink that forwards each event
# to the parent, and the parent — the only process that ever calls
# `_write_stdout` — re-emits it. `set_event_sink` is what makes that switch.
_sink: Optional[Any] = None


def _write_stdout(event: Dict[str, Any]) -> None:
    """The one and only stdout write path. Parent process only.

    The UTF-8 reconfigure at import makes the ensure_ascii=False write safe in
    every realistic case. The fallback exists only for a pathological stdout
    that refused reconfigure AND is not UTF-8: re-encode as pure-ASCII JSON
    (ensure_ascii=True can never raise UnicodeEncodeError) and push the bytes
    straight to the binary buffer, so the load-bearing 'done'/'error' events
    ALWAYS reach the Electron bridge instead of crashing the run.
    """
    try:
        sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except UnicodeEncodeError:
        try:
            data = (json.dumps(event, ensure_ascii=True) + "\n").encode("utf-8")
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
        except Exception:  # noqa: BLE001 — nothing more we can do; never mask the real run
            pass


def set_event_sink(sink: Optional[Any]) -> None:
    """Redirect every event away from stdout (worker) or back to it (parent).

    ``sink`` is anything with ``put(dict)`` — in practice a
    ``multiprocessing.Queue`` handed to workers via the pool initializer.
    Passing ``None`` restores direct stdout writing.

    A failing sink must never take the run down with it: if the queue is closed
    (parent already tearing down) the event is dropped, exactly as a torn line
    would have been — but without corrupting the stream for everyone else.
    """
    global _sink
    _sink = sink


def emit_event(event_type: EventType, **payload: Any) -> None:
    """Emit one JSON event — to stdout in the parent, to the sink in a worker."""
    event: Dict[str, Any] = {"type": event_type}
    event.update(payload)
    sink = _sink
    if sink is None:
        _write_stdout(event)
        return
    try:
        sink.put(event)
    except Exception:  # noqa: BLE001 — a dead queue must not kill the worker
        pass


#: Events whose type starts with this are internal worker→parent bookkeeping
#: (progress deltas, tallies) and must never reach stdout — the Electron bridge
#: only knows the types in ``EventType``.
INTERNAL_PREFIX = "__"


def drain_events(
    queue: Any,
    limit: int = 512,
    on_internal: Optional[Any] = None,
) -> int:
    """Re-emit up to ``limit`` queued worker events from the parent. Returns how many.

    Bounded on purpose: the parent calls this between work units, and an
    unbounded drain on a fast queue would starve the actual job. Whatever is
    left stays queued for the next call.

    Events whose ``type`` is internal go to ``on_internal`` instead of stdout,
    which is how a worker reports "I finished N more records" without inventing
    a progress number that could regress — only the parent, which sees every
    worker, can compute a monotonic total.
    """
    n = 0
    while n < limit:
        try:
            event = queue.get_nowait()
        except Exception:  # noqa: BLE001 — Empty, or a queue closed mid-teardown
            break
        if not isinstance(event, dict):
            continue
        n += 1
        if str(event.get("type", "")).startswith(INTERNAL_PREFIX):
            if on_internal is not None:
                try:
                    on_internal(event)
                except Exception:  # noqa: BLE001 — bookkeeping must not kill the run
                    pass
            continue
        _write_stdout(event)
    return n


def phase(name: Phase, pct: Optional[int] = None) -> None:
    emit_event("phase", phase=name, **({"pct": pct} if pct is not None else {}))


def log(level: LogLevel, message: str) -> None:
    emit_event("log", level=level, message=message)


def progress(
    stage: str,
    current: Optional[int] = None,
    total: Optional[int] = None,
    pct: Optional[int] = None,
    detail: Optional[str] = None,
) -> None:
    """Live position WITHIN a phase — drives the run view's "where am I" line.

    ``current``/``total`` answer "how many of how many". ``total`` is omitted
    when the goal isn't known up front (opening the P4K, decompressing the
    DataCore): the UI then shows just a running count with an indeterminate bar
    instead of a fake percentage. ``pct`` is the OVERALL bar position (0–100),
    so a long phase can advance the bar smoothly across its own sub-range.
    ``detail`` is a short free-text hint (e.g. the record type being dumped).
    """
    payload: Dict[str, Any] = {"stage": stage}
    if current is not None:
        payload["current"] = current
    if total is not None:
        payload["total"] = total
    if pct is not None:
        payload["pct"] = pct
    if detail:
        payload["detail"] = detail
    emit_event("progress", **payload)


def file_progress(
    file_name: str,
    pct: int,
    bytes_processed: Optional[int] = None,
    bytes_total: Optional[int] = None,
) -> None:
    payload: Dict[str, Any] = {"fileName": file_name, "pct": pct}
    if bytes_processed is not None:
        payload["bytesProcessed"] = bytes_processed
    if bytes_total is not None:
        payload["bytesTotal"] = bytes_total
    emit_event("file", **payload)


def count(key: str, value: int) -> None:
    emit_event("count", counter={"key": key, "value": value})


def warning(message: str) -> None:
    emit_event("warning", message=message)


def done(pct: int = 100, result: Optional[Dict[str, Any]] = None) -> None:
    emit_event("done", pct=pct, **({"result": result} if result else {}))


def error(message: str, **extra: Any) -> None:
    emit_event("error", message=message, **extra)
