"""Whole-PC load monitor — the numbers Task Manager shows.

Started by the Electron host while the performance dock is visible or a run is
going (``python -m sc_extract.sysmon``). Once a second it writes one JSON line
``{"type":"sample", "cpuPct", "readBps", "writeBps", "iops", "drives", "gpu"}`` with
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

``gpu`` is the graphics card's load in Task Manager's terms plus the share the
uploader causes: ``{"loadPct", "runLoadPct", "vramUsedBytes", "vramRunBytes"}``.
``loadPct`` sums ``GPU Engine(*)\\Utilization Percentage`` per engine type
(3D, Copy, VideoDecode, Compute_0 ...) over every process and takes the busiest
type (each type clamped 0..100) — what Task Manager's "GPU" column shows.
``runLoadPct`` is the same computation over the uploader's pids only (never
above ``loadPct``). ``vramUsedBytes`` is the adapter's ``Dedicated Usage``,
``vramRunBytes`` the uploader pids' ``GPU Process Memory`` dedicated usage
(never above ``vramUsedBytes``). All four figures cover ONE adapter, the
primary one (:func:`pick_luid`): the adapter with the most dedicated memory in
use — an iGPU keeps its memory in shared RAM, so a discrete card wins and the
iGPU's engines never mix into the load. When the GPU counters do not open
(no WDDM GPU, old Windows) ``gpu`` is not sent — never fake zeros.

The uploader pid set comes from the host over stdin, one JSON line per change:
``{"type":"pids","pids":[123,456]}`` replaces the whole set; any other line is
ignored. Until the first such line the set is empty (``runLoadPct`` 0).

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
from typing import Dict, FrozenSet, List, Mapping, Optional, Set, Tuple

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

#: GPU counters, all wildcard arrays; the ``gpu`` block needs all three.
GPU_COUNTERS: List[Tuple[str, str]] = [
    ("engine", r"\GPU Engine(*)\Utilization Percentage"),
    ("adapterMem", r"\GPU Adapter Memory(*)\Dedicated Usage"),
    ("processMem", r"\GPU Process Memory(*)\Dedicated Usage"),
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


_GPU_PID = re.compile(r"(?:^|_)pid_(\d+)(?=_|$)", re.IGNORECASE)
_GPU_LUID = re.compile(r"(?:^|_)luid_(0x[0-9a-f]+_0x[0-9a-f]+)", re.IGNORECASE)
_GPU_ENGTYPE = re.compile(r"_engtype_(.*)$", re.IGNORECASE)


def parse_gpu_instance(name: str) -> dict:
    """Split a GPU counter instance name into ``{"pid", "luid", "engtype"}``.

    ``pid_1234_luid_0x00000000_0x0000D1E2_phys_0_eng_0_engtype_3D`` ->
    ``{"pid": 1234, "luid": "0x00000000_0x0000d1e2", "engtype": "3D"}``.
    A part the name does not carry is ``None`` (adapter instances have no pid,
    memory instances no engtype). The luid is lower-cased so the three counter
    sets match up.
    """
    name = name or ""
    pid = _GPU_PID.search(name)
    luid = _GPU_LUID.search(name)
    eng = _GPU_ENGTYPE.search(name)
    return {
        "pid": int(pid.group(1)) if pid else None,
        "luid": luid.group(1).lower() if luid else None,
        "engtype": (eng.group(1) or None) if eng else None,
    }


def engine_type_sums(engines: Mapping[str, float], luid: Optional[str] = None,
                     pids: Optional[Set[int]] = None) -> Dict[str, float]:
    """Utilization per engine type, summed over instances, each clamped 0..100.

    ``luid`` restricts to one adapter, ``pids`` (when not ``None``) to those
    processes. Glitched values (NaN, negative) count as nothing.
    """
    sums: Dict[str, float] = {}
    for name, value in engines.items():
        v = _num(value)
        if v is None:
            continue
        info = parse_gpu_instance(name)
        if info["engtype"] is None or (luid is not None and info["luid"] != luid):
            continue
        if pids is not None and info["pid"] not in pids:
            continue
        sums[info["engtype"]] = sums.get(info["engtype"], 0.0) + v
    return {k: min(100.0, v) for k, v in sums.items()}


def engine_load(engines: Mapping[str, float], luid: Optional[str] = None,
                pids: Optional[Set[int]] = None) -> float:
    """Task Manager's GPU load: the busiest engine type (0 when nothing ran)."""
    sums = engine_type_sums(engines, luid, pids)
    return max(sums.values()) if sums else 0.0


def _per_luid(values: Mapping[str, float]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for name, value in values.items():
        luid = parse_gpu_instance(name)["luid"]
        v = _num(value)
        if luid is not None and v is not None:
            out[luid] = out.get(luid, 0.0) + v
    return out


def pick_luid(adapter_mem: Mapping[str, float], engines: Mapping[str, float]) -> Optional[str]:
    """The primary adapter: most dedicated memory in use, else most engine load.

    Dedicated usage decides because an iGPU keeps (almost) nothing in dedicated
    memory while a discrete card driving a desktop holds hundreds of MB —
    engine load alone would flip to the iGPU whenever it decodes a video.
    Ties (e.g. all zero) fall back to the summed engine load, then the luid.
    """
    mem = _per_luid(adapter_mem)
    load = _per_luid(engines)
    candidates = sorted(set(mem) | set(load))
    if not candidates:
        return None
    return max(candidates, key=lambda k: (mem.get(k, 0.0), load.get(k, 0.0)))


def build_gpu(engines: Mapping[str, float], adapter_mem: Mapping[str, float],
              process_mem: Mapping[str, float], pids: Set[int]) -> Optional[dict]:
    """The ``gpu`` block of a sample, or ``None`` when there is no adapter data.

    Needs engine instances and adapter memory instances; without them the
    block is left out rather than reported as zeros.
    """
    if not engines or not adapter_mem:
        return None
    luid = pick_luid(adapter_mem, engines)
    if luid is None:
        return None
    pid_set = set(pids)
    load = engine_load(engines, luid)
    run_load = min(load, engine_load(engines, luid, pid_set))
    used = _per_luid(adapter_mem).get(luid, 0.0)
    run = 0.0
    for name, value in process_mem.items():
        info = parse_gpu_instance(name)
        v = _num(value)
        if v is not None and info["luid"] == luid and info["pid"] in pid_set:
            run += v
    return {
        "loadPct": round(load, 1),
        "runLoadPct": round(run_load, 1),
        "vramUsedBytes": int(round(used)),
        "vramRunBytes": int(round(min(run, used))),
    }


def parse_control_line(line: str) -> Optional[FrozenSet[int]]:
    """The new uploader pid set from a host stdin line, or ``None`` to ignore it.

    Only ``{"type":"pids","pids":[...]}`` counts; entries that are not positive
    integers are dropped. Garbage, another type or a non-list ``pids`` -> None.
    """
    try:
        msg = json.loads(line)
    except (ValueError, TypeError):
        return None
    if not isinstance(msg, dict) or msg.get("type") != "pids" or not isinstance(msg.get("pids"), list):
        return None
    return frozenset(p for p in msg["pids"] if isinstance(p, int) and not isinstance(p, bool) and p > 0)


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
        gpu: Dict[str, "wt.HANDLE"] = {}
        for key, path in GPU_COUNTERS:
            h = wt.HANDLE()
            if pdh.PdhAddEnglishCounterW(self.query, path, 0, ctypes.byref(h)) == 0:
                gpu[key] = h
        # All three or none: a half-open set cannot give the uploader's share.
        self.gpu_counters: Dict[str, "wt.HANDLE"] = gpu if len(gpu) == len(GPU_COUNTERS) else {}
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

    def read(self, pids: FrozenSet[int] = frozenset()) -> Optional[dict]:
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
        if self.gpu_counters:
            try:
                gpu = build_gpu(
                    self._array(self.gpu_counters["engine"]),
                    self._array(self.gpu_counters["adapterMem"]),
                    self._array(self.gpu_counters["processMem"]),
                    set(pids),
                )
                if gpu is not None:
                    out["gpu"] = gpu
            except Exception:  # noqa: BLE001 — GPU detail is optional, like the drives
                pass
        return out

    def close(self) -> None:
        self.pdh.PdhCloseQuery(self.query)


def main() -> int:
    if os.name != "nt":
        emit({"type": "unsupported", "platform": sys.platform})
        return 0
    closed = threading.Event()
    pids: List[FrozenSet[int]] = [frozenset()]  # slot replaced whole, never mutated

    def watch_stdin() -> None:
        try:
            for line in sys.stdin:
                new = parse_control_line(line)
                if new is not None:
                    pids[0] = new
        finally:
            closed.set()

    threading.Thread(target=watch_stdin, daemon=True).start()
    try:
        mon = Pdh()
    except OSError as e:
        emit({"type": "error", "message": str(e)})
        return 1
    emit({"type": "ready", "counters": sorted(mon.counters), "driveCounters": sorted(mon.drive_counters),
          "gpuCounters": sorted(mon.gpu_counters)})
    try:
        while not closed.wait(SAMPLE_S):
            values = mon.read(pids[0])
            if values is not None:
                emit({"type": "sample", **values})
    finally:
        mon.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
