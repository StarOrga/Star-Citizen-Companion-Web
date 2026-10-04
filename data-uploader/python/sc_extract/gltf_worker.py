"""Client for ``gltf_worker.mjs`` — one long-lived Node process that runs the
gltf-transform CLI commands of a 3D export instead of one Node per call.

A ship's parts cost two optimizer calls each, and a fresh Node spent ~0.6 s of
its ~0.65 s per call starting up (measured on LIVE 4.10: 90 calls ≈ 60 s for a
45-part ship). The worker runs the CLI's own command table, so its output is
byte-identical to the per-call CLI (checked file by file for optimize,
simplify and meshopt).

Strictly an accelerator: if the worker cannot start, stalls or dies, the
caller falls back to the per-call CLI for the rest of the run.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
from pathlib import Path
from typing import List, Optional

WORKER_SCRIPT = Path(__file__).with_name("gltf_worker.mjs")
START_TIMEOUT_S = 120
CALL_TIMEOUT_S = 900
# Restart now and then: thousands of documents through one V8 heap is an
# untested load, and a restart costs one Node start.
MAX_CALLS = 400


class WorkerUnavailable(RuntimeError):
    pass


class GltfWorker:
    """``run(args)`` -> ``(ok, error)``; thread-safe, restarts itself."""

    def __init__(self, host_argv: List[str], env: Optional[dict] = None) -> None:
        # host_argv = [node-or-electron, ".../@gltf-transform/cli/bin/cli.js"]
        if len(host_argv) < 2 or not WORKER_SCRIPT.exists():
            raise WorkerUnavailable("no worker script or CLI path")
        self.cmd = [*host_argv[:-1], str(WORKER_SCRIPT), host_argv[-1]]
        self.env = env
        self._lock = threading.Lock()
        self._proc: Optional[subprocess.Popen] = None
        self._lines: "queue.Queue[Optional[str]]" = queue.Queue()
        self._calls = 0

    # ---- process lifecycle ---------------------------------------------
    def _start(self) -> None:
        self._lines = queue.Queue()
        self._proc = subprocess.Popen(
            self.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, encoding="utf-8", errors="replace",
            env=self.env, bufsize=1,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        lines = self._lines
        out = self._proc.stdout

        def pump() -> None:
            try:
                for line in out:  # type: ignore[union-attr]
                    lines.put(line)
            finally:
                lines.put(None)

        threading.Thread(target=pump, daemon=True).start()
        msg = self._next(START_TIMEOUT_S)
        if not msg.get("ready"):
            self.close()
            raise WorkerUnavailable(f"worker did not start: {msg}")
        self._calls = 0

    def _next(self, timeout: float) -> dict:
        while True:
            try:
                line = self._lines.get(timeout=timeout)
            except queue.Empty:
                raise WorkerUnavailable(f"no reply within {timeout:.0f} s") from None
            if line is None:
                raise WorkerUnavailable("worker exited")
            try:
                msg = json.loads(line)
            except ValueError:
                continue  # never expected (the CLI's output goes to stderr)
            if isinstance(msg, dict):
                return msg

    def close(self) -> None:
        proc, self._proc = self._proc, None
        if proc is None:
            return
        try:
            proc.stdin.close()  # type: ignore[union-attr]
            proc.wait(timeout=5)
        except Exception:  # noqa: BLE001
            proc.kill()

    # ---- calls -----------------------------------------------------------
    def run(self, args: List[str]) -> "tuple[bool, str]":
        """Raises WorkerUnavailable when the worker itself failed (the caller
        then falls back); a command failure comes back as ``(False, error)``."""
        with self._lock:
            if self._proc is None or self._proc.poll() is not None or self._calls >= MAX_CALLS:
                self.close()
                self._start()
            self._calls += 1
            try:
                self._proc.stdin.write(json.dumps(args) + "\n")  # type: ignore[union-attr]
                self._proc.stdin.flush()  # type: ignore[union-attr]
                msg = self._next(CALL_TIMEOUT_S)
            except (OSError, WorkerUnavailable):
                self.close()
                raise WorkerUnavailable("worker died mid-call") from None
            return bool(msg.get("ok")), str(msg.get("error") or "")


def worker_disabled() -> bool:
    return os.environ.get("SC_GLTF_WORKER", "1") == "0"
