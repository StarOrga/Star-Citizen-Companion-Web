"""Streaming event emission to stdout — consumed by Electron main process.

One JSON line per event. flush after each line so Electron sees them in real time.
"""

import json
import sys
from typing import Any, Dict, Literal, Optional

EventType = Literal["phase", "file", "count", "log", "warning", "done", "error"]
LogLevel = Literal["info", "warn", "error"]
Phase = Literal["discover", "plan", "extract", "validate", "bundle"]


def emit_event(event_type: EventType, **payload: Any) -> None:
    """Emit one JSON event line + flush."""
    event: Dict[str, Any] = {"type": event_type}
    event.update(payload)
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


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
