"""Whole-PC monitor — the platform-independent part of sysmon.py."""

from sc_extract.sysmon import COUNTERS, clean


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
