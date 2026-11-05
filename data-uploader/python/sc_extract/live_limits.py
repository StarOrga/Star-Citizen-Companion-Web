"""What the host wants from a RUNNING sidecar — the limits that the governor cannot apply.

The governor (`governor.py`) caps a process tree from the outside, but it can
only take away: a stage started with one worker stays on one worker however far
the operator opens the limits afterwards. So the host also writes a small JSON
file (``main/resources.ts``) and passes its path as ``--live-limits``::

    {"workers": 8, "useGpu": true, "gpuShare": 80}

A file on purpose, not a line on stdin. On Windows a thread blocked in a
synchronous ``ReadFile`` on the stdin pipe holds that file object's lock, and
every child that inherits the handle (cgf-converter, the Node glTF worker) stops
in its own runtime start-up at ``GetFileType`` until the read returns — a hang
that only shows in a real run. Polling a file cannot do that. The host replaces
it atomically; a missing or half-readable file just keeps the last values.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Callable, Dict, MutableMapping, Optional

POLL_S = 1.0


class LiveLimits:
    def __init__(self, workers: int, path: Optional[Path] = None,
                 env: Optional[MutableMapping[str, str]] = None) -> None:
        self._workers = max(1, int(workers))
        self._path = Path(path) if path else None
        self._env = os.environ if env is None else env
        self._seen: Any = None

    @property
    def workers(self) -> int:
        return self._workers

    def apply(self, obj: Dict[str, Any]) -> None:
        n = obj.get("workers")
        if isinstance(n, (int, float)) and not isinstance(n, bool) and n >= 1:
            self._workers = int(n)
        # Read by the GPU stages per unit (`silhouette.raster_backend`,
        # `gpu_share`), so a GPU limit changed mid-run reaches the next mesh.
        if isinstance(obj.get("useGpu"), bool):
            self._env["SC_USE_GPU"] = "1" if obj["useGpu"] else "0"
        share = obj.get("gpuShare")
        if isinstance(share, (int, float)) and not isinstance(share, bool):
            self._env["SC_GPU_SHARE"] = str(int(share))

    def poll_once(self) -> bool:
        """Re-read the file if it changed. True when new values were taken."""
        if self._path is None:
            return False
        try:
            st = self._path.stat()
            stamp = (st.st_mtime_ns, st.st_size)
            if stamp == self._seen:
                return False
            obj = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return False
        self._seen = stamp
        if not isinstance(obj, dict):
            return False
        self.apply(obj)
        return True

    def start(self) -> "LiveLimits":
        if self._path is not None:
            self.poll_once()
            threading.Thread(target=self._run, name="live-limits", daemon=True).start()
        return self

    def _run(self) -> None:
        stop = threading.Event()
        while not stop.wait(POLL_S):
            self.poll_once()


class SlotGate:
    """A semaphore whose size can change while threads wait on it."""

    def __init__(self, limit: Callable[[], int]) -> None:
        self._limit = limit
        self._cond = threading.Condition()
        self._busy = 0
        self._closed = False
        self.peak = 0

    def acquire(self) -> bool:
        """Wait for a slot. False = the gate was closed, do not start the work."""
        with self._cond:
            while not self._closed and self._busy >= max(1, self._limit()):
                # Timed: the limit is a plain read, nothing notifies when it grows.
                self._cond.wait(0.25)
            if self._closed:
                return False
            self._busy += 1
            self.peak = max(self.peak, self._busy)
            return True

    def release(self) -> None:
        with self._cond:
            self._busy -= 1
            self._cond.notify()

    def close(self) -> None:
        with self._cond:
            self._closed = True
            self._cond.notify_all()
