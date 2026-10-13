"""Whole-PC load monitor — the numbers Task Manager shows.

Started by the Electron host while the performance dock is visible or a run is
going (``python -m sc_extract.sysmon``). Once a second it writes one JSON line
``{"type":"sample", "cpuPct", "readBps", "writeBps", "iops", "drives"}`` with
the load of the whole machine, everything included — games, browsers, this
app, the run. stdin closing means the host is gone: the monitor exits.

``drives`` breaks the disk load down per physical disk — the per-drive graphs
of Task Manager's "Performance" tab:
``[{"instance": "0 C: D:", "letters": ["C", "D"], "activePct", "responseMs",
"readBps", "writeBps", "iops"}]``. ``activePct`` is 100 − ``% Idle Time``
(Task Manager's "Active time", clamped 0..100), ``responseMs`` the average
time one transfer took. A counter that does not open, or has no valid value
for an instance, is left out of that entry (never reported as 0); when no
per-disk counter opens at all, ``drives`` is not sent.

Windows only, via the Performance Data Helper with the *English* counter
names (``PdhAddEnglishCounterW``), so a German or any other localized Windows
reads the same counters. CPU is ``% Processor Utility`` — the value Task
Manager's "CPU" column uses, which accounts for turbo clocks — with
``% Processor Time`` as the fallback on systems that lack it.
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
from typing import Dict, List, Mapping, Optional, Tuple

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

#: Per physical disk: (key, wildcard English counter path), read as arrays.
DRIVE_COUNTERS: List[Tuple[str, str]] = [
    ("idlePct", r"\PhysicalDisk(*)\% Idle Time"),
    ("secPerTransfer", r"\PhysicalDisk(*)\Avg. Disk sec/Transfer"),
    ("readBps", r"\PhysicalDisk(*)\Disk Read Bytes/sec"),
    ("writeBps", r"\PhysicalDisk(*)\Disk Write Bytes/sec"),
    ("iops", r"\PhysicalDisk(*)\Disk Transfers/sec"),
]

PDH_FMT_DOUBLE = 0x00000200
PDH_FMT_NOCAP100 = 0x00008000
PDH_MORE_DATA = 0x800007D2
PDH_CSTATUS_VALID_DATA = 0x0
PDH_CSTATUS_NEW_DATA = 0x1

_LETTER = re.compile(r"\b([A-Za-z]):")


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


def instance_letters(instance: str) -> List[str]:
    """Drive letters of a PhysicalDisk instance name: ``"0 C: D:"`` -> ``["C", "D"]``."""
    return sorted({m.upper() for m in _LETTER.findall(instance or "")})


def _num(v: Optional[float]) -> Optional[float]:
    if v is None or v != v or v < 0:  # missing, NaN, or a counter glitch
        return None
    return float(v)


def build_drives(per_counter: Mapping[str, Mapping[str, float]]) -> List[dict]:
    """Fold the per-counter instance arrays into one entry per physical disk.

    ``per_counter`` maps a :data:`DRIVE_COUNTERS` key to ``{instance: value}``.
    ``_Total`` is skipped (the totals travel separately).
    """
    instances = sorted({name for values in per_counter.values() for name in values if name != "_Total"})
    out: List[dict] = []
    for name in instances:
        entry: dict = {"instance": name, "letters": instance_letters(name)}
        idle = _num(per_counter.get("idlePct", {}).get(name))
        if idle is not None:
            entry["activePct"] = round(max(0.0, min(100.0, 100.0 - idle)), 1)
        spt = _num(per_counter.get("secPerTransfer", {}).get(name))
        if spt is not None:
            entry["responseMs"] = round(spt * 1000.0, 2)
        for key in ("readBps", "writeBps", "iops"):
            v = _num(per_counter.get(key, {}).get(name))
            if v is not None:
                entry[key] = float(round(v))
        out.append(entry)
    return out


class Pdh:  # pragma: no cover - Windows only
    def __init__(self) -> None:
        import ctypes
        from ctypes import wintypes as wt

        class FMT_VALUE(ctypes.Structure):
            _fields_ = [("CStatus", wt.DWORD), ("pad", wt.DWORD), ("doubleValue", ctypes.c_double)]

        class FMT_ITEM(ctypes.Structure):
            _fields_ = [("szName", wt.LPWSTR), ("FmtValue", FMT_VALUE)]

        self.ctypes = ctypes
        self.wt = wt
        self.FMT_VALUE = FMT_VALUE
        self.FMT_ITEM = FMT_ITEM
        pdh = ctypes.WinDLL("pdh")
        pdh.PdhOpenQueryW.argtypes = [wt.LPCWSTR, ctypes.c_size_t, ctypes.POINTER(wt.HANDLE)]
        pdh.PdhAddEnglishCounterW.argtypes = [wt.HANDLE, wt.LPCWSTR, ctypes.c_size_t, ctypes.POINTER(wt.HANDLE)]
        pdh.PdhCollectQueryData.argtypes = [wt.HANDLE]
        pdh.PdhGetFormattedCounterValue.argtypes = [wt.HANDLE, wt.DWORD, ctypes.c_void_p, ctypes.c_void_p]
        pdh.PdhGetFormattedCounterArrayW.argtypes = [
            wt.HANDLE, wt.DWORD, ctypes.POINTER(wt.DWORD), ctypes.POINTER(wt.DWORD), ctypes.c_void_p,
        ]
        pdh.PdhGetFormattedCounterArrayW.restype = wt.DWORD
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
        self.drive_counters: Dict[str, "wt.HANDLE"] = {}
        for key, path in DRIVE_COUNTERS:
            h = wt.HANDLE()
            if pdh.PdhAddEnglishCounterW(self.query, path, 0, ctypes.byref(h)) == 0:
                self.drive_counters[key] = h
        if not self.counters and not self.drive_counters:
            raise OSError("no performance counter available")
        # Rate counters need two collections before the first value.
        pdh.PdhCollectQueryData(self.query)

    def _array(self, h) -> Dict[str, float]:
        """``{instance: value}`` of a wildcard counter; {} when it cannot be read."""
        ctypes, wt = self.ctypes, self.wt
        size = wt.DWORD(0)
        count = wt.DWORD(0)
        fmt = PDH_FMT_DOUBLE | PDH_FMT_NOCAP100
        rc = self.pdh.PdhGetFormattedCounterArrayW(h, fmt, ctypes.byref(size), ctypes.byref(count), None)
        if rc != PDH_MORE_DATA or size.value == 0:
            return {}
        buf = ctypes.create_string_buffer(size.value)
        rc = self.pdh.PdhGetFormattedCounterArrayW(h, fmt, ctypes.byref(size), ctypes.byref(count), buf)
        if rc != 0:
            return {}
        items = ctypes.cast(buf, ctypes.POINTER(self.FMT_ITEM))
        out: Dict[str, float] = {}
        for i in range(count.value):
            item = items[i]
            if item.szName and item.FmtValue.CStatus in (PDH_CSTATUS_VALID_DATA, PDH_CSTATUS_NEW_DATA):
                out[item.szName] = item.FmtValue.doubleValue
        return out

    def read(self) -> Optional[dict]:
        if self.pdh.PdhCollectQueryData(self.query) != 0:
            return None
        out: dict = {}
        for key, h in self.counters.items():
            v = self.FMT_VALUE()
            if self.pdh.PdhGetFormattedCounterValue(
                h, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, None, self.ctypes.byref(v)
            ) == 0:
                out[key] = clean(key, v.doubleValue)
        if self.drive_counters:
            try:
                out["drives"] = build_drives({key: self._array(h) for key, h in self.drive_counters.items()})
            except Exception:  # noqa: BLE001 — per-disk detail is optional; totals still go out
                pass
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
    emit({"type": "ready", "counters": sorted(mon.counters), "driveCounters": sorted(mon.drive_counters)})
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
