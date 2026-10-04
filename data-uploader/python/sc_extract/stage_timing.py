"""Wall-clock accounting for the 3D export's expensive steps.

A whole-catalog 3D build measured ~8 min per ship in the field but 25 s–4 min
for the same ships on an idle machine, and nothing in the log said where the
difference went. Every expensive step now books its time here, and
``skin_export_app`` logs one line per ship plus a run total, so the next slow
run names its own bottleneck (converter, optimizer, hole gate, P4K reads — or
the remainder nobody booked, which is then the thing to look at).

Process-local and thread-safe; cheap enough to stay on in production.
"""
from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from typing import Dict, Iterator, Tuple

_lock = threading.Lock()
_seconds: Dict[str, float] = {}
_calls: Dict[str, int] = {}


@contextmanager
def timed(label: str) -> Iterator[None]:
    t0 = time.perf_counter()
    try:
        yield
    finally:
        add(label, time.perf_counter() - t0)


def add(label: str, seconds: float) -> None:
    with _lock:
        _seconds[label] = _seconds.get(label, 0.0) + seconds
        _calls[label] = _calls.get(label, 0) + 1


Snapshot = Dict[str, Tuple[float, int]]


def snapshot() -> Snapshot:
    with _lock:
        return {k: (v, _calls.get(k, 0)) for k, v in _seconds.items()}


def since(before: Snapshot) -> Snapshot:
    """What was booked after ``before`` was taken."""
    out: Snapshot = {}
    for k, (sec, n) in snapshot().items():
        s0, n0 = before.get(k, (0.0, 0))
        if n - n0 > 0 or sec - s0 > 0.0005:
            out[k] = (sec - s0, n - n0)
    return out


def merge(a: Snapshot, b: Snapshot) -> Snapshot:
    out = dict(a)
    for k, (sec, n) in b.items():
        s0, n0 = out.get(k, (0.0, 0))
        out[k] = (s0 + sec, n0 + n)
    return out


def summary(booked: Snapshot, wall: float) -> str:
    """``convert 12.3s/8 · optimize 5.1s/12 · … · other 3.0s`` — biggest first.
    Labels starting with ``~`` may nest inside other steps (a P4K read inside
    a conversion, a blocked stdout write inside anything), so ``other`` is wall
    time minus the top-level steps only."""
    parts = sorted(booked.items(), key=lambda kv: -kv[1][0])
    top = sum(sec for k, (sec, _n) in booked.items() if not k.startswith("~"))
    text = " · ".join(f"{k} {sec:.1f}s/{n}" for k, (sec, n) in parts if sec >= 0.05)
    other = max(0.0, wall - top)
    return f"{text} · other {other:.1f}s" if text else f"other {other:.1f}s"
