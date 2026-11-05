"""Worker counts that follow the limits while a stage runs."""
import json
import threading
import time

import pytest

from sc_extract import gpu_share as gs
from sc_extract import stage_timing
from sc_extract.live_limits import LiveLimits, SlotGate
from sc_extract.silhouette_build import build_rows
from sc_extract.silhouette_export import SKIP_CONVERT_FAILED, MeshSource, SilhouetteExportConfig, SilhouetteExporter, SilhouetteSkip

from test_silhouette_build_rows import SIL, FakeExporter


def test_file_changes_reach_workers_and_gpu_env(tmp_path):
    f = tmp_path / "live.json"
    env = {}
    live = LiveLimits(2, f, env=env)
    assert live.poll_once() is False  # no file yet: keep the start value
    assert live.workers == 2

    f.write_text(json.dumps({"workers": 7, "useGpu": True, "gpuShare": 80}), encoding="utf-8")
    assert live.poll_once() is True
    assert live.workers == 7
    assert env == {"SC_USE_GPU": "1", "SC_GPU_SHARE": "80"}
    assert live.poll_once() is False  # unchanged


@pytest.mark.parametrize("text", ["{not json", "[1,2]", '{"workers": 0}', '{"workers": true}', '{"workers": "9"}'])
def test_bad_content_keeps_the_last_values(tmp_path, text):
    f = tmp_path / "live.json"
    f.write_text(text, encoding="utf-8")
    live = LiveLimits(3, f, env={})
    live.poll_once()
    assert live.workers == 3


def test_gate_grows_and_shrinks_while_threads_wait():
    limit = [1]
    gate = SlotGate(lambda: limit[0])
    assert gate.acquire()
    got = threading.Event()

    def waiter():
        assert gate.acquire()
        got.set()

    threading.Thread(target=waiter, daemon=True).start()
    assert not got.wait(0.1)
    limit[0] = 2
    assert got.wait(2)
    assert gate.peak == 2


def test_closed_gate_lets_waiters_go_without_a_slot():
    gate = SlotGate(lambda: 1)
    assert gate.acquire()
    out = []
    t = threading.Thread(target=lambda: out.append(gate.acquire()), daemon=True)
    t.start()
    gate.close()
    t.join(2)
    assert out == [False]


class Tracking(FakeExporter):
    def __init__(self, on_start=None):
        super().__init__()
        self.lock = threading.Lock()
        self.now = 0
        self.peak_by_phase = []
        self.on_start = on_start

    def compute(self, src, mesh_id, tolerance_m):
        with self.lock:
            self.now += 1
            self.peak_by_phase.append(self.now)
            if self.on_start:
                self.on_start(len(self.peak_by_phase))
        time.sleep(0.03)
        with self.lock:
            self.now -= 1
        return SIL


def many(n):
    return [{"kind": "weapon", "class_name": f"W{i}", "mesh": f"w/{i}.cgf"} for i in range(n)]


def test_build_follows_the_live_target_upwards(tmp_path):
    target = [1]

    def open_up(started):
        if started == 5:
            target[0] = 6

    exp = Tracking(open_up)
    stats = build_rows(exp, many(60), out_dir=tmp_path, build={}, workers=1,
                       live_workers=lambda: target[0], max_workers=8)
    assert stats["written"] == 60
    assert max(exp.peak_by_phase[:5]) == 1  # one at a time before the limits opened
    assert stats["peakWorkers"] == 6


def test_build_never_exceeds_the_cap(tmp_path):
    exp = Tracking()
    stats = build_rows(exp, many(30), out_dir=tmp_path, build={}, workers=2,
                       live_workers=lambda: 99, max_workers=3)
    assert stats["peakWorkers"] <= 3


def test_time_since_the_last_unit_counts_as_idle():
    gs.reset()
    t = [100.0]
    slept = []
    env = {gs.ENV: "50"}
    assert gs.pace(0.1, sleep=slept.append, env=env, clock=lambda: t[0]) == pytest.approx(0.1)
    t[0] += 5.0  # a long CPU stretch: nothing owed for the next unit
    assert gs.pace(0.1, sleep=slept.append, env=env, clock=lambda: t[0]) == 0.0
    t[0] += 0.15  # only partly covered (0.05 s idle before this 0.1 s unit)
    assert gs.pace(0.1, sleep=slept.append, env=env, clock=lambda: t[0]) == pytest.approx(0.05)
    gs.reset()


def test_each_worker_takes_its_part_of_the_share():
    gs.reset()
    env = {gs.ENV: "80", gs.WORKERS_ENV: "4"}  # 20 % each -> 4 x the unit
    assert gs.pace(0.1, sleep=lambda s: None, env=env, clock=lambda: 1.0) == pytest.approx(0.4)
    gs.reset()
    assert gs.gpu_workers({gs.WORKERS_ENV: "x"}) == 1


def test_a_skip_crosses_the_process_boundary_with_its_reason(tmp_path):
    """Real spawned worker: the converter is missing, so the mesh is a convert_failed skip."""
    cfg = SilhouetteExportConfig(
        cgf_converter=tmp_path / "missing-converter.exe", work_dir=tmp_path / "w",
        cache_dir=tmp_path / "c", tool_version="t", recipe="t",
    )
    logs = []
    cfg.on_log = lambda level, msg: logs.append(msg)
    exporter = SilhouetteExporter(None, cfg)
    exporter.use_processes(1, lambda: 1)
    try:
        src = MeshSource("objects/a/hull.cga", b"not a mesh", None, "abcd" * 8)
        with pytest.raises(SilhouetteSkip) as e:
            exporter.compute(src, "hull", 0.15)
        assert e.value.reason == SKIP_CONVERT_FAILED
        assert any("silhouette mesh hull" in m for m in logs)  # the worker's log came home
        assert "silhouette.convert" in stage_timing.snapshot()
    finally:
        exporter.close()
