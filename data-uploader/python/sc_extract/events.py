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

EventType = Literal["phase", "file", "count", "log", "warning", "done", "error"]
LogLevel = Literal["info", "warn", "error"]
Phase = Literal["discover", "plan", "extract", "validate", "bundle"]


def emit_event(event_type: EventType, **payload: Any) -> None:
    """Emit one JSON event line + flush.

    The UTF-8 reconfigure at import makes the ensure_ascii=False write safe in
    every realistic case. The fallback exists only for a pathological stdout
    that refused reconfigure AND is not UTF-8: re-encode as pure-ASCII JSON
    (ensure_ascii=True can never raise UnicodeEncodeError) and push the bytes
    straight to the binary buffer, so the load-bearing 'done'/'error' events
    ALWAYS reach the Electron bridge instead of crashing the run.
    """
    event: Dict[str, Any] = {"type": event_type}
    event.update(payload)
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


def phase(name: Phase, pct: Optional[int] = None) -> None:
    emit_event("phase", phase=name, **({"pct": pct} if pct is not None else {}))


def log(level: LogLevel, message: str) -> None:
    emit_event("log", level=level, message=message)


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
