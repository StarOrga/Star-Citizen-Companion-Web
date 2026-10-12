"""Whole-PC load monitor — the numbers Task Manager shows.

Started by the Electron host while the performance dock is visible or a run is
going (``python -m sc_extract.sysmon``). Once a second it writes one JSON line
``{"type":"sample", "cpuPct", "readBps", "writeBps", "iops"}`` with the load of
the whole machine, everything included — games, browsers, this app, the run.
stdin closing means the host is gone: the monitor exits.

Windows only, via the Performance Data Helper with the *English* counter
names (``PdhAddEnglishCounterW``), so a German or any other localized Windows
reads the same counters. CPU is ``% Processor Utility`` — the value Task
Manager's "CPU" column uses, which accounts for turbo clocks — with
``% Processor Time`` as the fallback on systems that lack it.
"""

from __future__ import annotations

import json
import os
import sys
import threading
from typing import Dict, List, Optional, Tuple

SAMPLE_S = 1.0

#: (key, English counter path candidates — the first one that opens wins).
COUNTERS: List[Tuple[str, Tuple[str, ...]]] = [
    ("cpuPct", (
        r"\Processor Information(_Total)\% Processor Utility",
        r"\Processor(_Total)\% Processor Time",
    )),
    ("readBps", (r"\PhysicalDisk(_Total)\Disk Read Bytes/sec",)),
    ("writeBps", (r"\PhysicalDisk(_Total)\Disk Write Bytes/sec",)),
    ("iops", (r"\PhysicalDisk(_Total)\Disk Transfers/sec",)),
]

PDH_FMT_DOUBLE = 0x00000200
PDH_FMT_NOCAP100 = 0x00008000


def emit(obj: dict) -> None:
    try:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()
    except Exception:  # noqa: BLE001 — host gone; the stdin watcher ends us
        pass


def clean(key: str, value: float) -> float:
    """Round a raw counter value for the wire; CPU stays within 0..100."""
    if value != value or value < 0:  # NaN or a counter glitch
        return 0.0
    if key == "cpuPct":
        return round(min(100.0, value), 1)
    return float(round(value))


class Pdh:  # pragma: no cover - Windows only
    def __init__(self) -> None:
        import ctypes
        from ctypes import wintypes as wt

        class FMT_VALUE(ctypes.Structure):
            _fields_ = [("CStatus", wt.DWORD), ("pad", wt.DWORD), ("doubleValue", ctypes.c_double)]

        self.ctypes = ctypes
        self.FMT_VALUE = FMT_VALUE
        pdh = ctypes.WinDLL("pdh")
        pdh.PdhOpenQueryW.argtypes = [wt.LPCWSTR, ctypes.c_size_t, ctypes.POINTER(wt.HANDLE)]
        pdh.PdhAddEnglishCounterW.argtypes = [wt.HANDLE, wt.LPCWSTR, ctypes.c_size_t, ctypes.POINTER(wt.HANDLE)]
        pdh.PdhCollectQueryData.argtypes = [wt.HANDLE]
        pdh.PdhGetFormattedCounterValue.argtypes = [wt.HANDLE, wt.DWORD, ctypes.c_void_p, ctypes.c_void_p]
        pdh.PdhCloseQuery.argtypes = [wt.HANDLE]
        self.pdh = pdh
        self.query = wt.HANDLE()
        if pdh.PdhOpenQueryW(None, 0, ctypes.byref(self.query)) != 0:
            raise OSError("PdhOpenQuery failed")
        self.counters: Dict[str, "wt.HANDLE"] = {}
        for key, paths in COUNTERS:
            for path in paths:
                h = wt.HANDLE()
                if pdh.PdhAddEnglishCounterW(self.query, path, 0, ctypes.byref(h)) == 0:
                    self.counters[key] = h
                    break
        if not self.counters:
            raise OSError("no performance counter available")
        # Rate counters need two collections before the first value.
        pdh.PdhCollectQueryData(self.query)

    def read(self) -> Optional[Dict[str, float]]:
        if self.pdh.PdhCollectQueryData(self.query) != 0:
            return None
        out: Dict[str, float] = {}
        for key, h in self.counters.items():
            v = self.FMT_VALUE()
            if self.pdh.PdhGetFormattedCounterValue(
                h, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, None, self.ctypes.byref(v)
            ) == 0:
                out[key] = clean(key, v.doubleValue)
        return out

    def close(self) -> None:
        self.pdh.PdhCloseQuery(self.query)


def main() -> int:
    if os.name != "nt":
        emit({"type": "unsupported", "platform": sys.platform})
        return 0
    closed = threading.Event()

    def watch_stdin() -> None:
        try:
            for _ in sys.stdin:
                pass
        finally:
            closed.set()

    threading.Thread(target=watch_stdin, daemon=True).start()
    try:
        mon = Pdh()
    except OSError as e:
        emit({"type": "error", "message": str(e)})
        return 1
    emit({"type": "ready", "counters": sorted(mon.counters)})
    try:
        while not closed.wait(SAMPLE_S):
            values = mon.read()
            if values is not None:
                emit({"type": "sample", **values})
    finally:
        mon.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
