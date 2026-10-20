"""Whole-PC monitor — the platform-independent part of sysmon.py."""

from sc_extract import sysmon
from sc_extract.sysmon import COUNTERS, DRIVE_COUNTERS, build_drives, clean, instance_letters


def test_cpu_is_rounded_and_capped_at_100():
    # % Processor Utility can exceed 100 with turbo clocks; Task Manager caps it.
    assert clean("cpuPct", 37.26) == 37.3
    assert clean("cpuPct", 131.0) == 100.0


def test_rates_are_whole_numbers():
    assert clean("readBps", 1234567.8) == 1234568.0
    assert clean("iops", 0.4) == 0.0


def test_glitches_read_as_zero():
    assert clean("readBps", float("nan")) == 0.0
    assert clean("writeBps", -5.0) == 0.0


def test_counters_use_english_names_with_a_cpu_fallback():
    paths = dict(COUNTERS)
    assert set(paths) == {"cpuPct", "readBps", "writeBps", "iops"}
    assert paths["cpuPct"][0].endswith("% Processor Utility")
    assert len(paths["cpuPct"]) == 2


def test_drive_counters_are_english_physical_disk_wildcards():
    paths = dict(DRIVE_COUNTERS)
    assert set(paths) == {"idlePct", "secPerTransfer", "readBps", "writeBps", "iops"}
    assert all(p.startswith(r"\PhysicalDisk(*)" + "\\") for p in paths.values())


def test_instance_letters():
    assert instance_letters("0 C: D:") == ["C", "D"]
    assert instance_letters("1 e:") == ["E"]
    assert instance_letters("2") == []
    assert instance_letters("") == []


def test_build_drives_maps_each_physical_disk():
    drives = build_drives({
        "idlePct": {"0 C:": 88.0, "1 D: E:": 0.0, "_Total": 44.0},
        "secPerTransfer": {"0 C:": 0.0004, "1 D: E:": 0.0123},
        "readBps": {"0 C:": 1048576.4, "1 D: E:": 30e6},
        "writeBps": {"0 C:": 6e6, "1 D: E:": 0.0},
        "iops": {"0 C:": 56.2, "1 D: E:": 650.0},
    })
    assert [d["instance"] for d in drives] == ["0 C:", "1 D: E:"]
    c, d = drives
    assert c == {"instance": "0 C:", "letters": ["C"], "activePct": 12.0, "responseMs": 0.4,
                 "readBps": 1048576.0, "writeBps": 6e6, "iops": 56.0}
    assert d["letters"] == ["D", "E"]
    assert d["activePct"] == 100.0
    assert d["responseMs"] == 12.3


def test_active_time_is_clamped():
    # % Idle Time read with NOCAP100 can overshoot 100 on an idle disk.
    (d,) = build_drives({"idlePct": {"0 C:": 104.0}})
    assert d["activePct"] == 0.0


def test_missing_counters_are_omitted_not_zero():
    (d,) = build_drives({"readBps": {"0 C:": 5.0}, "idlePct": {}})
    assert d == {"instance": "0 C:", "letters": ["C"], "readBps": 5.0}
    assert build_drives({}) == []
    (g,) = build_drives({"iops": {"0 C:": float("nan")}})
    assert "iops" not in g


def test_non_windows_reports_unsupported(monkeypatch, capsys):
    monkeypatch.setattr(sysmon.os, "name", "posix")
    assert sysmon.main() == 0
    assert '"unsupported"' in capsys.readouterr().out


# -- appIo: the Electron main process's own file I/O --------------------------

def test_io_pids_come_from_the_pids_line():
    assert sysmon.parse_io_pids('{"type":"pids","pids":[1,2],"ioPids":[2,0,-3,"x",true]}') == frozenset({2})


def test_io_pids_absent_or_garbage_keep_the_current_set():
    assert sysmon.parse_io_pids('{"type":"pids","pids":[1]}') is None
    assert sysmon.parse_io_pids('{"type":"pids","pids":[1],"ioPids":7}') is None
    assert sysmon.parse_io_pids('{"type":"other","ioPids":[1]}') is None
    assert sysmon.parse_io_pids("not json") is None


class FakeIo:
    def __init__(self):
        self.totals = {}

    def read(self, pid):
        return self.totals.get(pid)


def test_io_meter_rates_from_deltas():
    io = FakeIo()
    meter = sysmon.IoMeter(io.read)
    io.totals = {7: (1000.0, 500.0, 10.0)}
    assert meter.sample(frozenset({7}), 10.0) is None  # first reading: no rate yet
    io.totals = {7: (1000.0 + 4 * 2**20, 500.0 + 2**20, 30.0)}
    assert meter.sample(frozenset({7}), 12.0) == {"readBps": 2.0 * 2**20, "writeBps": 0.5 * 2**20, "iops": 10.0}


def test_io_meter_never_books_a_new_pids_lifetime():
    io = FakeIo()
    meter = sysmon.IoMeter(io.read)
    io.totals = {7: (0.0, 0.0, 0.0)}
    meter.sample(frozenset({7}), 1.0)
    # pid 8 joins with gigabytes already behind it: counted from its next reading on.
    io.totals = {7: (100.0, 0.0, 1.0), 8: (9e9, 9e9, 9e6)}
    assert meter.sample(frozenset({7, 8}), 2.0) == {"readBps": 100.0, "writeBps": 0.0, "iops": 1.0}


def test_io_meter_reused_pid_counts_nothing_and_unreadable_pids_send_nothing():
    io = FakeIo()
    meter = sysmon.IoMeter(io.read)
    io.totals = {7: (5000.0, 5000.0, 50.0)}
    meter.sample(frozenset({7}), 1.0)
    io.totals = {7: (10.0, 10.0, 1.0)}  # counter went backwards: a new process got pid 7
    assert meter.sample(frozenset({7}), 2.0) == {"readBps": 0.0, "writeBps": 0.0, "iops": 0.0}
    io.totals = {}
    assert meter.sample(frozenset({7}), 3.0) is None
