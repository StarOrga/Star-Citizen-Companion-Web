"""SC_GPU_SHARE parsing and the duty-cycle pause of the GPU stages."""

import pytest

from sc_extract import gpu_share as gs


@pytest.mark.parametrize("raw, want", [
    (None, 100), ("", 100), ("  ", 100), ("abc", 100), ("nan", 100),
    ("100", 100), ("50", 50), (" 25 ", 25), ("33.6", 34),
    ("0", 1), ("-5", 1), ("250", 100), ("inf", 100),
])
def test_share_parses_and_clamps(raw, want):
    env = {} if raw is None else {gs.ENV: raw}
    assert gs.gpu_share(env) == want


def test_share_reads_process_env_by_default(monkeypatch):
    monkeypatch.setenv(gs.ENV, "40")
    assert gs.gpu_share() == 40
    monkeypatch.delenv(gs.ENV)
    assert gs.gpu_share() == 100


def test_pause_is_the_duty_cycle_remainder():
    assert gs.pause_for(0.1, 100) == 0.0
    assert gs.pause_for(0.1, 50) == pytest.approx(0.1)
    assert gs.pause_for(0.1, 25) == pytest.approx(0.3)
    assert gs.pause_for(0.01, 1) == pytest.approx(0.99)


def test_pause_is_capped_and_ignores_empty_units():
    assert gs.pause_for(5.0, 10) == gs.MAX_SLEEP_S
    assert gs.pause_for(1.0, 1, cap_s=0.5) == 0.5
    assert gs.pause_for(0.0, 10) == 0.0
    assert gs.pause_for(-1.0, 10) == 0.0


def test_pace_sleeps_only_below_full_share():
    slept = []
    assert gs.pace(0.2, sleep=slept.append, env={gs.ENV: "100"}) == 0.0
    assert gs.pace(0.2, sleep=slept.append, env={}) == 0.0
    assert slept == []
    assert gs.pace(0.2, sleep=slept.append, env={gs.ENV: "50"}) == pytest.approx(0.2)
    assert slept == [pytest.approx(0.2)]


def test_gpu_rasterize_paces_after_each_unit(monkeypatch):
    """The GPU path calls the pacer once per unit; skipped without a context."""
    from sc_extract import silhouette_gpu
    if not silhouette_gpu.status()["available"]:
        pytest.skip("no OpenGL context on this machine")
    import numpy as np
    calls = []
    monkeypatch.setattr(gs, "pace", lambda t, **_: calls.append(t) or 0.0)
    px = np.array([[[0, 0], [8, 0], [0, 8]]], dtype=np.float64)
    silhouette_gpu.rasterize(px, 8, 8)
    pts = np.random.default_rng(0).random((50, 3))
    view = (np.array([0, 0, 1.0]), np.array([1.0, 0, 0]), np.array([0, 1.0, 0]), np.zeros(3))
    silhouette_gpu.splat_depth_maps(pts, np.zeros(3), [view], 0.1, 16)
    assert len(calls) == 2 and all(t >= 0 for t in calls)
