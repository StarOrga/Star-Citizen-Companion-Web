"""Soft GPU share for the GPU stages (``SC_GPU_SHARE``, set by the host).

Windows cannot hard-cap a process's GPU use, so the uploader's ``gpuPct``
limit reaches the sidecar as ``SC_GPU_SHARE=<1..100>`` next to
``SC_USE_GPU=1`` and is applied here as a duty cycle: after a GPU work unit
that took ``t`` seconds the stage idles ``t * (100 / share - 1)`` seconds, so
the GPU is busy roughly ``share`` percent of the wall time this process uses
it. The idle per unit is capped (`MAX_SLEEP_S`) so one huge unit never stalls
the build for long. ``share`` 100 (also: absent or unparsable) = no pause,
the old behaviour.

The GPU stages run one OpenGL context per process under a lock
(`silhouette_gpu`), so there is no GPU concurrency to scale down; the pause
happens while that lock is still held, which keeps other worker threads from
filling the idle gap with GPU work.

Silhouette meshes run in worker processes now, one context each. Two things keep
the share true across them: every worker takes ``share / SC_GPU_WORKERS``, and
the time since its previous unit already counts as idle — a worker that spends
most of a mesh on the CPU owes no pause at all, so pacing never holds a worker
back when the GPU is nowhere near its limit.
"""
from __future__ import annotations

import math
import os
import time
from typing import Callable, Mapping, Optional

ENV = "SC_GPU_SHARE"
WORKERS_ENV = "SC_GPU_WORKERS"
MAX_SLEEP_S = 2.0


def gpu_share(env: Optional[Mapping[str, str]] = None) -> int:
    """The host's GPU share in percent, clamped to 1..100; 100 when unset or
    not a number (the GPU path only runs when the host turned it on, so 0
    would mean "GPU on, never use it" — it clamps to the slowest pace)."""
    raw = (os.environ if env is None else env).get(ENV, "")
    try:
        value = float(str(raw).strip())
    except ValueError:
        return 100
    if not math.isfinite(value):
        return 100
    return int(max(1, min(100, round(value))))


def gpu_workers(env: Optional[Mapping[str, str]] = None) -> int:
    """How many processes share the GPU right now (1 when unset)."""
    try:
        return max(1, int((os.environ if env is None else env).get(WORKERS_ENV, "1")))
    except ValueError:
        return 1


def pause_for(elapsed_s: float, share: float, cap_s: float = MAX_SLEEP_S) -> float:
    """Seconds to idle after a GPU unit of ``elapsed_s`` at ``share`` percent."""
    if share >= 100 or not elapsed_s or elapsed_s <= 0:
        return 0.0
    share = max(0.1, float(share))
    return min(cap_s, elapsed_s * (100.0 / share - 1.0))


#: End of this process's previous paced unit (callers hold the GPU lock).
_last_end: Optional[float] = None


def reset() -> None:
    global _last_end
    _last_end = None


def pace(elapsed_s: float, sleep: Callable[[float], None] = time.sleep,
         env: Optional[Mapping[str, str]] = None,
         clock: Callable[[], float] = time.monotonic) -> float:
    """Idle after a GPU unit per the current share; returns the pause taken."""
    global _last_end
    share = gpu_share(env)
    if share >= 100:
        return 0.0
    now = clock()
    owed = pause_for(elapsed_s, share / gpu_workers(env))
    # `elapsed_s` ended just now, so the idle stretch is what lay before it began.
    idle = max(0.0, now - elapsed_s - _last_end) if _last_end is not None else 0.0
    s = max(0.0, owed - idle)
    if s > 0:
        sleep(s)
    _last_end = now + s
    return s
