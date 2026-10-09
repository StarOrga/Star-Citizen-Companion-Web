"""Resource governor — keeps a running sidecar inside the operator's limits.

Started by the Electron host next to every sidecar (extract, silhouette build,
3D export) as ``python -m sc_extract.governor --pid <sidecar pid>``. It is a
separate process on purpose: the sidecar's own loops (and the converter tools
it shells out to) cannot be asked to slow down, but the operating system can
schedule, cap and pause them from the outside without their cooperation.

What it does, Windows only (elsewhere it reports ``unsupported`` and exits):

* **Job Object.** The sidecar is put into a fresh job. Every process it starts
  afterwards (dump workers, cgf-converter, the Node glTF worker) is born inside
  the same job, so one limit covers the whole tree. The job carries a
  **hard CPU cap** (``JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP``) at the share of
  the whole machine the operator allowed.
* **Priorities.** Every process in the tree runs at Idle / BelowNormal CPU
  priority, very low / low **I/O priority** and low memory priority — a game's
  disk reads and its pages always win.
* **Disk budgets.** Read MB/s, write MB/s and operations/s are measured from the
  job's I/O accounting. When the tree went over a budget, all of its processes
  are suspended for exactly as long as the budget needs to catch up, then
  resumed (:class:`Budget`). Suspending a process cannot corrupt what it is
  doing; it just stops the clock for it.

Limits arrive as JSON lines on stdin and can change at any time; stdin closing
means the host is gone, so the governor resumes everything and exits — it must
never leave a suspended tree behind. Telemetry goes out as JSON lines on stdout
once a second: ``{"type":"sample", "cpuPct", "memMb", "readBps", "writeBps",
"iops", "heldBack", "procs", "hardCap"}``.

The memory budget is not enforced here: a commit limit on the job would make
allocations fail and crash the run. The host sizes the worker count by it; the
governor only measures what the tree actually uses.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

#: Control-loop period. Short enough that a pause never exceeds a frame the
#: operator would notice in a game, long enough to cost nothing.
TICK_S = 0.25
#: Longest single pause. A budget that is far behind catches up over several
#: ticks rather than freezing the tree for seconds at a time.
MAX_HOLD_S = 0.75
#: Burst a budget may bank while the tree is quiet (seconds of budget).
BURST_S = 1.0
#: Telemetry period.
SAMPLE_S = 1.0


@dataclass
class Limits:
    cpu_pct: float = 0.0
    read_bps: float = 0.0
    write_bps: float = 0.0
    iops: float = 0.0
    priority: str = "below_normal"

    @staticmethod
    def parse(obj: dict) -> "Limits":
        def num(key: str) -> float:
            v = obj.get(key)
            return float(v) if isinstance(v, (int, float)) and v > 0 else 0.0

        prio = obj.get("priority")
        return Limits(
            cpu_pct=min(100.0, num("cpuPct")),
            read_bps=num("readBps"),
            write_bps=num("writeBps"),
            iops=num("iops"),
            priority=prio if prio in ("idle", "below_normal") else "below_normal",
        )


@dataclass
class Budget:
    """Token buckets for the disk (and, without a hard cap, CPU) budgets.

    ``observe`` is fed what the tree used since the last call and returns how
    long the tree must be held so every budget is back in credit. Pure — no
    clocks, no OS — so the arithmetic is unit-tested on any platform.
    """

    credit: Dict[str, float] = field(default_factory=dict)

    def observe(self, dt: float, used: Dict[str, float], rates: Dict[str, float]) -> float:
        hold = 0.0
        for key, rate in rates.items():
            if rate <= 0:
                self.credit.pop(key, None)
                continue
            c = self.credit.get(key, rate * BURST_S)
            c = min(c + rate * max(0.0, dt), rate * BURST_S)
            c -= max(0.0, used.get(key, 0.0))
            self.credit[key] = c
            if c < 0:
                hold = max(hold, -c / rate)
        return min(hold, MAX_HOLD_S)


def emit(obj: dict) -> None:
    try:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()
    except Exception:  # noqa: BLE001 — host gone; the stdin watcher ends us
        pass


class LimitsInbox:
    """Reads limit updates from stdin on a thread; EOF = host gone."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest: Optional[Limits] = None
        self.closed = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        try:
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                try:
                    lim = Limits.parse(json.loads(line))
                except (ValueError, TypeError, AttributeError):
                    continue
                with self._lock:
                    self._latest = lim
        finally:
            self.closed.set()

    def take(self) -> Optional[Limits]:
        with self._lock:
            lim, self._latest = self._latest, None
            return lim


# ── Windows ─────────────────────────────────────────────────────────────────

def _win() -> "object":  # pragma: no cover - Windows only
    import ctypes
    from ctypes import wintypes as wt

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    ntdll = ctypes.WinDLL("ntdll")

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class BASIC_ACCOUNTING(ctypes.Structure):
        _fields_ = [
            ("TotalUserTime", ctypes.c_longlong),
            ("TotalKernelTime", ctypes.c_longlong),
            ("ThisPeriodTotalUserTime", ctypes.c_longlong),
            ("ThisPeriodTotalKernelTime", ctypes.c_longlong),
            ("TotalPageFaultCount", wt.DWORD),
            ("TotalProcesses", wt.DWORD),
            ("ActiveProcesses", wt.DWORD),
            ("TotalTerminatedProcesses", wt.DWORD),
        ]

    class BASIC_AND_IO_ACCOUNTING(ctypes.Structure):
        _fields_ = [("BasicInfo", BASIC_ACCOUNTING), ("IoInfo", IO_COUNTERS)]

    class CPU_RATE(ctypes.Structure):
        _fields_ = [("ControlFlags", wt.DWORD), ("CpuRate", wt.DWORD)]

    class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("cb", wt.DWORD), ("PageFaultCount", wt.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wt.DWORD), ("cntUsage", wt.DWORD), ("th32ProcessID", wt.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wt.DWORD),
            ("cntThreads", wt.DWORD), ("th32ParentProcessID", wt.DWORD),
            ("pcPriClassBase", ctypes.c_long), ("dwFlags", wt.DWORD),
            ("szExeFile", ctypes.c_wchar * 260),
        ]

    k32.CreateJobObjectW.restype = wt.HANDLE
    k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wt.LPCWSTR]
    k32.OpenProcess.restype = wt.HANDLE
    k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    k32.AssignProcessToJobObject.argtypes = [wt.HANDLE, wt.HANDLE]
    k32.SetInformationJobObject.argtypes = [wt.HANDLE, ctypes.c_int, ctypes.c_void_p, wt.DWORD]
    k32.QueryInformationJobObject.argtypes = [wt.HANDLE, ctypes.c_int, ctypes.c_void_p, wt.DWORD, ctypes.c_void_p]
    k32.CloseHandle.argtypes = [wt.HANDLE]
    k32.WaitForSingleObject.argtypes = [wt.HANDLE, wt.DWORD]
    k32.WaitForSingleObject.restype = wt.DWORD
    k32.SetPriorityClass.argtypes = [wt.HANDLE, wt.DWORD]
    k32.SetProcessInformation.argtypes = [wt.HANDLE, ctypes.c_int, ctypes.c_void_p, wt.DWORD]
    k32.K32GetProcessMemoryInfo.argtypes = [wt.HANDLE, ctypes.c_void_p, wt.DWORD]
    k32.CreateToolhelp32Snapshot.restype = wt.HANDLE
    k32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
    k32.Process32FirstW.argtypes = [wt.HANDLE, ctypes.c_void_p]
    k32.Process32NextW.argtypes = [wt.HANDLE, ctypes.c_void_p]
    ntdll.NtSuspendProcess.argtypes = [wt.HANDLE]
    ntdll.NtResumeProcess.argtypes = [wt.HANDLE]
    ntdll.NtSetInformationProcess.argtypes = [wt.HANDLE, ctypes.c_int, ctypes.c_void_p, wt.ULONG]

    ns = type("Win", (), {})()
    ns.ctypes, ns.wt, ns.k32, ns.ntdll = ctypes, wt, k32, ntdll
    ns.IO_COUNTERS, ns.BASIC_AND_IO_ACCOUNTING = IO_COUNTERS, BASIC_AND_IO_ACCOUNTING
    ns.CPU_RATE, ns.PMC, ns.PE32 = CPU_RATE, PROCESS_MEMORY_COUNTERS, PROCESSENTRY32W
    return ns


PROCESS_TERMINATE = 0x0001
PROCESS_SET_INFORMATION = 0x0200
PROCESS_SET_QUOTA = 0x0100
PROCESS_SUSPEND_RESUME = 0x0800
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_VM_READ = 0x0010
SYNCHRONIZE = 0x00100000
PROC_ACCESS = (PROCESS_TERMINATE | PROCESS_SET_INFORMATION | PROCESS_SET_QUOTA
               | PROCESS_SUSPEND_RESUME | PROCESS_QUERY_LIMITED_INFORMATION
               | PROCESS_VM_READ | SYNCHRONIZE)

JobObjectBasicProcessIdList = 3
JobObjectBasicAndIoAccountingInformation = 8
JobObjectCpuRateControlInformation = 15
CPU_RATE_ENABLE = 0x1
CPU_RATE_HARD_CAP = 0x4
ProcessIoPriority = 33
ProcessMemoryPriority = 0
IO_PRIORITY_VERY_LOW = 0
IO_PRIORITY_LOW = 1
MEMORY_PRIORITY_LOW = 2
PRIORITY_CLASS = {"idle": 0x40, "below_normal": 0x4000}
TH32CS_SNAPPROCESS = 0x2
WAIT_TIMEOUT = 0x102


class WinGovernor:  # pragma: no cover - Windows only, exercised on the release check
    def __init__(self, root_pid: int) -> None:
        self.w = _win()
        self.root_pid = root_pid
        self.handles: Dict[int, int] = {}
        self.prepared: Dict[int, str] = {}
        self.suspended: List[int] = []
        self.priority = "below_normal"
        self.cpu_cap = 0.0
        self.hard_cap = False
        self.job = self.w.k32.CreateJobObjectW(None, None)
        self.job_ok = False
        self.root = self._open(root_pid)
        if not self.root:
            raise OSError(f"cannot open pid {root_pid}")
        if self.job and self.w.k32.AssignProcessToJobObject(self.job, self.root):
            self.job_ok = True
        # Children started before we got here are not in the job yet: put them in.
        for pid in self._descendants():
            h = self._open(pid)
            if h and self.job_ok:
                self.w.k32.AssignProcessToJobObject(self.job, h)

    # -- process set --------------------------------------------------------
    def _open(self, pid: int) -> int:
        if pid in self.handles:
            return self.handles[pid]
        h = self.w.k32.OpenProcess(PROC_ACCESS, False, pid)
        if h:
            self.handles[pid] = h
        return h or 0

    def _descendants(self) -> List[int]:
        w = self.w
        snap = w.k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        if not snap or snap == w.wt.HANDLE(-1).value:
            return []
        parent: Dict[int, int] = {}
        try:
            pe = w.PE32()
            pe.dwSize = w.ctypes.sizeof(w.PE32)
            ok = w.k32.Process32FirstW(snap, w.ctypes.byref(pe))
            while ok:
                parent[int(pe.th32ProcessID)] = int(pe.th32ParentProcessID)
                ok = w.k32.Process32NextW(snap, w.ctypes.byref(pe))
        finally:
            w.k32.CloseHandle(snap)
        out: List[int] = []
        frontier = {self.root_pid}
        while frontier and len(out) < 256:
            nxt = {pid for pid, pp in parent.items() if pp in frontier and pid not in out and pid != self.root_pid}
            out.extend(nxt)
            frontier = nxt
        return out

    def _job_pids(self) -> List[int]:
        w = self.w
        if not self.job_ok:
            return [self.root_pid, *self._descendants()]
        n = 1024
        buf = (w.ctypes.c_byte * (8 + n * w.ctypes.sizeof(w.ctypes.c_size_t)))()
        if not w.k32.QueryInformationJobObject(
            self.job, JobObjectBasicProcessIdList, w.ctypes.byref(buf), len(buf), None
        ):
            return [self.root_pid]
        count = w.wt.DWORD.from_buffer(buf, 4).value
        ids = (w.ctypes.c_size_t * n).from_buffer(buf, 8)
        return [int(ids[i]) for i in range(min(count, n))]

    def alive(self) -> bool:
        return self.w.k32.WaitForSingleObject(self.root, 0) == WAIT_TIMEOUT

    def refresh(self) -> List[int]:
        pids = self._job_pids()
        live = set(pids)
        for pid in list(self.handles):
            if pid not in live and pid != self.root_pid:
                self.w.k32.CloseHandle(self.handles.pop(pid))
                self.prepared.pop(pid, None)
        for pid in pids:
            h = self._open(pid)
            if h and self.prepared.get(pid) != self.priority:
                self._prepare(h)
                self.prepared[pid] = self.priority
        return pids

    def _prepare(self, h: int) -> None:
        w = self.w
        w.k32.SetPriorityClass(h, PRIORITY_CLASS[self.priority])
        # Very low (background) I/O while gaming; low otherwise — still behind
        # every normal-priority read, but never starved for minutes.
        io = w.wt.ULONG(IO_PRIORITY_VERY_LOW if self.priority == "idle" else IO_PRIORITY_LOW)
        w.ntdll.NtSetInformationProcess(h, ProcessIoPriority, w.ctypes.byref(io), 4)
        mem = w.wt.ULONG(MEMORY_PRIORITY_LOW)
        w.k32.SetProcessInformation(h, ProcessMemoryPriority, w.ctypes.byref(mem), 4)

    # -- limits -------------------------------------------------------------
    def apply(self, lim: Limits) -> None:
        if lim.priority != self.priority:
            self.priority = lim.priority  # refresh() re-prepares every process
        if lim.cpu_pct == self.cpu_cap or not self.job_ok:
            return
        w = self.w
        info = w.CPU_RATE()
        if lim.cpu_pct > 0:
            info.ControlFlags = CPU_RATE_ENABLE | CPU_RATE_HARD_CAP
            info.CpuRate = max(1, min(10000, int(round(lim.cpu_pct * 100))))
        self.hard_cap = bool(w.k32.SetInformationJobObject(
            self.job, JobObjectCpuRateControlInformation, w.ctypes.byref(info), w.ctypes.sizeof(info)
        )) and lim.cpu_pct > 0
        self.cpu_cap = lim.cpu_pct

    # -- measuring ----------------------------------------------------------
    def counters(self) -> Optional[Dict[str, float]]:
        """Cumulative CPU seconds and I/O of the whole job (exited processes included)."""
        if not self.job_ok:
            return None
        w = self.w
        acc = w.BASIC_AND_IO_ACCOUNTING()
        if not w.k32.QueryInformationJobObject(
            self.job, JobObjectBasicAndIoAccountingInformation, w.ctypes.byref(acc), w.ctypes.sizeof(acc), None
        ):
            return None
        return {
            "cpu": (acc.BasicInfo.TotalUserTime + acc.BasicInfo.TotalKernelTime) / 1e7,
            "read": float(acc.IoInfo.ReadTransferCount),
            "write": float(acc.IoInfo.WriteTransferCount),
            "ops": float(acc.IoInfo.ReadOperationCount + acc.IoInfo.WriteOperationCount),
        }

    def memory_mb(self, pids: List[int]) -> float:
        w = self.w
        total = 0
        for pid in pids:
            h = self.handles.get(pid)
            if not h:
                continue
            pmc = w.PMC()
            pmc.cb = w.ctypes.sizeof(w.PMC)
            if w.k32.K32GetProcessMemoryInfo(h, w.ctypes.byref(pmc), pmc.cb):
                total += pmc.WorkingSetSize
        return total / (1024 * 1024)

    # -- holding ------------------------------------------------------------
    def hold(self, pids: List[int]) -> None:
        for pid in pids:
            h = self.handles.get(pid)
            if h and self.w.ntdll.NtSuspendProcess(h) == 0:
                self.suspended.append(pid)

    def release(self) -> None:
        while self.suspended:
            pid = self.suspended.pop()
            h = self.handles.get(pid)
            if h:
                self.w.ntdll.NtResumeProcess(h)

    def close(self) -> None:
        self.release()
        for h in self.handles.values():
            self.w.k32.CloseHandle(h)
        self.handles.clear()
        # Not KILL_ON_JOB_CLOSE: if the governor dies, the run must go on.
        if self.job:
            self.w.k32.CloseHandle(self.job)


def run(root_pid: int, cores: int) -> int:  # pragma: no cover - Windows only
    inbox = LimitsInbox()
    try:
        gov = WinGovernor(root_pid)
    except OSError as e:
        emit({"type": "error", "message": str(e)})
        return 1
    emit({"type": "ready", "job": gov.job_ok})
    limits = Limits()
    budget = Budget()
    prev = gov.counters()
    last = time.monotonic()
    window: List[tuple] = []  # (t, cpu, read, write, ops, held)
    held_total = 0.0
    last_sample = 0.0
    try:
        while gov.alive() and not inbox.closed.is_set():
            new = inbox.take()
            if new is not None:
                limits = new
                gov.apply(limits)
            pids = gov.refresh()
            now = time.monotonic()
            dt, last = now - last, now
            cur = gov.counters()
            used: Dict[str, float] = {}
            if cur and prev:
                used = {k: max(0.0, cur[k] - prev[k]) for k in cur}
            prev = cur or prev
            rates = {"read": limits.read_bps, "write": limits.write_bps, "ops": limits.iops}
            if not gov.hard_cap and limits.cpu_pct > 0:
                # No job cap (nested-job refusal, old Windows): hold for CPU too.
                rates["cpu"] = limits.cpu_pct / 100.0 * cores
            hold_s = budget.observe(dt, used, rates)
            if hold_s > 0.01:
                gov.hold(pids)
                try:
                    inbox.closed.wait(hold_s)
                finally:
                    gov.release()
                held_total += hold_s
            if cur:
                window.append((now, cur["cpu"], cur["read"], cur["write"], cur["ops"], held_total))
                window = [s for s in window if now - s[0] <= 2.0]
            if now - last_sample >= SAMPLE_S and len(window) >= 2:
                last_sample = now
                a, b = window[0], window[-1]
                span = max(1e-3, b[0] - a[0])
                emit({
                    "type": "sample",
                    "cpuPct": round((b[1] - a[1]) / span / max(1, cores) * 100, 1),
                    "memMb": round(gov.memory_mb(pids)),
                    "readBps": round((b[2] - a[2]) / span),
                    "writeBps": round((b[3] - a[3]) / span),
                    "iops": round((b[4] - a[4]) / span),
                    "heldBack": round(min(1.0, (b[5] - a[5]) / span), 3),
                    "procs": len(pids),
                    "hardCap": gov.hard_cap,
                })
            inbox.closed.wait(TICK_S)
    finally:
        gov.close()
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="SC Companion resource governor")
    ap.add_argument("--pid", type=int, required=True)
    ap.add_argument("--cores", type=int, default=os.cpu_count() or 1)
    args = ap.parse_args(argv)
    if os.name != "nt":
        emit({"type": "unsupported", "platform": sys.platform})
        return 0
    return run(args.pid, max(1, args.cores))


if __name__ == "__main__":
    sys.exit(main())
