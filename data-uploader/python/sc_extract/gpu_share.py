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
"""
from __future__ import annotations

import math
import os
import time
from typing import Callable, Mapping, Optional

ENV = "SC_GPU_SHARE"
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


def pause_for(elapsed_s: float, share: int, cap_s: float = MAX_SLEEP_S) -> float:
    """Seconds to idle after a GPU unit of ``elapsed_s`` at ``share`` percent."""
    if share >= 100 or not elapsed_s or elapsed_s <= 0:
        return 0.0
    share = max(1, int(share))
    return min(cap_s, elapsed_s * (100.0 / share - 1.0))


def pace(elapsed_s: float, sleep: Callable[[float], None] = time.sleep,
         env: Optional[Mapping[str, str]] = None) -> float:
    """Idle after a GPU unit per the current share; returns the pause taken."""
    s = pause_for(elapsed_s, gpu_share(env))
    if s > 0:
        sleep(s)
    return s
