"""Parallel record dump — worker sizing, event routing, and a real pool run.

The pool test runs against the synthetic DCB (tests/dcb_builder.py), so it
proves the PLUMBING — spawn, shared-memory hand-off, queue routing, monotonic
progress, file output — without needing the 157 GB game archive. It cannot
prove a speedup; that needs a real Data.p4k and is a measurement, not a test.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dcb_builder import build_minimal_v8  # noqa: E402
from sc_extract import events  # noqa: E402
from sc_extract.dataforge import DataForge  # noqa: E402
from sc_extract.parallel_dump import (  # noqa: E402
    EST_WORKER_MB,
    dump_records_parallel,
    worker_count,
)


# ── worker sizing ───────────────────────────────────────────────────────────

def test_worker_count_takes_the_hosts_number_verbatim():
    # The host owns this number. Inferring it from os.cpu_count() would ignore
    # the affinity mask a throttled run is pinned to and spawn N processes onto
    # one core — slower than serial, at N times the memory.
    assert worker_count(1) == 1
    assert worker_count(8) == 8
    assert worker_count(32) == 32


def test_worker_count_never_returns_zero_or_negative():
    for bad in (0, -1, -99):
        assert worker_count(bad) == 1


def test_memory_budget_clamps_workers_but_never_below_one():
    # Advisory, not a cap: all it can honestly do is limit how many parsed
    # copies of the DataCore exist at once.
    assert worker_count(16, mem_cap_mb=EST_WORKER_MB * 4) == 4
    assert worker_count(2, mem_cap_mb=EST_WORKER_MB * 16) == 2  # never scales UP
    # A budget smaller than one worker still has to run the job.
    assert worker_count(16, mem_cap_mb=1) == 1
    # 0 = unset, no clamp at all.
    assert worker_count(12, mem_cap_mb=0) == 12


# ── event routing ───────────────────────────────────────────────────────────

class _FakeQueue:
    def __init__(self):
        self.items = []

    def put(self, item):
        self.items.append(item)

    def get_nowait(self):
        if not self.items:
            raise Exception("Empty")
        return self.items.pop(0)


def test_worker_events_go_to_the_sink_not_stdout(capsys):
    q = _FakeQueue()
    events.set_event_sink(q)
    try:
        events.log("info", "from a worker")
    finally:
        events.set_event_sink(None)
    # Nothing on stdout — that pipe belongs to the parent alone. Two processes
    # writing it tear each other's JSON lines apart, and the Electron bridge
    # silently drops what it cannot parse (a torn 'done' turns a successful
    # run into a reported failure).
    assert capsys.readouterr().out == ""
    assert q.items == [{"type": "log", "level": "info", "message": "from a worker"}]


def test_parent_re_emits_queued_events_as_json_lines(capsys):
    q = _FakeQueue()
    q.put({"type": "log", "level": "warn", "message": "hi"})
    q.put({"type": "count", "counter": {"key": "records_total", "value": 7}})
    assert events.drain_events(q) == 2
    lines = [ln for ln in capsys.readouterr().out.splitlines() if ln.strip()]
    assert [json.loads(ln)["type"] for ln in lines] == ["log", "count"]


def test_internal_events_are_routed_away_from_stdout(capsys):
    # Progress deltas are worker->parent bookkeeping. The bridge only knows the
    # public event types, so leaking one would show up as a dropped line.
    q = _FakeQueue()
    q.put({"type": f"{events.INTERNAL_PREFIX}delta", "n": 250})
    q.put({"type": "log", "level": "info", "message": "public"})
    seen = []
    assert events.drain_events(q, on_internal=seen.append) == 2
    lines = [ln for ln in capsys.readouterr().out.splitlines() if ln.strip()]
    assert len(lines) == 1 and json.loads(lines[0])["type"] == "log"
    assert seen == [{"type": f"{events.INTERNAL_PREFIX}delta", "n": 250}]


def test_a_dead_sink_never_kills_the_worker():
    class _Dead:
        def put(self, item):
            raise RuntimeError("queue closed")

    events.set_event_sink(_Dead())
    try:
        events.log("info", "into the void")  # must not raise
    finally:
        events.set_event_sink(None)


def test_dataforge_adopts_a_memoryview_without_copying():
    # Workers map the raw DataCore out of shared memory; copying it per worker
    # would multiply the run's largest allocation by the worker count.
    raw = build_minimal_v8()
    buf = memoryview(bytearray(raw))
    df = DataForge(buf)
    assert df._buf.readonly
    assert len(df.records) == len(DataForge(raw).records)


# ── real pool run ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("workers", [1, 2])
def test_pool_writes_every_record_and_reports_monotonic_progress(tmp_path, workers):
    raw = build_minimal_v8(record_name="TestThing.Sample", value=42)
    df = DataForge(raw)

    progress: list[int] = []
    per_type, total, n_fail = dump_records_parallel(
        df, raw, tmp_path / "records", workers,
        on_log=lambda lvl, m: None,
        on_count=lambda k, v: None,
        on_progress=lambda stage, **kw: progress.append(kw.get("current", 0)),
        pct_range=(55, 84),
    )

    assert total == len(df.records)
    assert n_fail == 0
    assert sum(per_type.values()) == total

    written = list((tmp_path / "records").rglob("*.json"))
    assert len(written) == total
    assert json.loads(written[0].read_text(encoding="utf-8"))

    # The bar must never run backwards — workers finish out of order, so only
    # the parent's running total is a safe progress source.
    assert progress == sorted(progress), progress


def test_pool_survives_a_type_whose_records_cannot_be_written(tmp_path, monkeypatch):
    # A single unwritable record must be counted and skipped, never abort the
    # exhaustive dump — same contract the serial path already honours.
    raw = build_minimal_v8()
    df = DataForge(raw)
    out = tmp_path / "records"
    out.mkdir(parents=True)
    (out / "_index.json").write_text("{}", encoding="utf-8")

    per_type, total, n_fail = dump_records_parallel(
        df, raw, out, 1,
        on_log=lambda lvl, m: None,
        on_count=lambda k, v: None,
        on_progress=lambda *a, **k: None,
    )
    assert total + n_fail == len(df.records)
