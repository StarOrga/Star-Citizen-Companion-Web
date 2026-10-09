"""Governor control arithmetic — the platform-independent part of governor.py."""

from sc_extract.governor import BURST_S, MAX_HOLD_S, Budget, Limits, main


def test_within_budget_never_holds():
    b = Budget()
    for _ in range(20):
        assert b.observe(0.25, {"read": 10e6 * 0.25}, {"read": 10e6}) == 0.0


def test_over_budget_holds_until_credit_is_back():
    b = Budget()
    # 1 s of budget is banked; 3 s worth used in one tick -> 2 s behind. Each
    # hold is capped, so the debt is paid off over several ticks.
    hold = b.observe(0.25, {"read": 30e6}, {"read": 10e6})
    assert hold == MAX_HOLD_S
    ticks = 0
    while hold > 0:
        hold = b.observe(hold, {}, {"read": 10e6})  # the held time refills credit
        ticks += 1
        assert ticks < 10
    assert b.credit["read"] >= 0


def test_hold_is_proportional_to_debt():
    b = Budget()
    b.credit["write"] = 0.0
    hold = b.observe(0.0, {"write": 2e6}, {"write": 10e6})
    assert abs(hold - 0.2) < 1e-9


def test_worst_budget_wins_and_unlimited_is_ignored():
    b = Budget(credit={"read": 0.0, "ops": 0.0})
    hold = b.observe(0.0, {"read": 1e6, "ops": 50, "write": 1e12}, {"read": 10e6, "ops": 100, "write": 0})
    assert abs(hold - 0.5) < 1e-9  # ops: 50 / 100


def test_credit_never_banks_more_than_burst():
    b = Budget()
    b.observe(100.0, {}, {"read": 10e6})
    assert b.credit["read"] == 10e6 * BURST_S


def test_limits_parse_is_defensive():
    lim = Limits.parse({"cpuPct": 250, "readBps": -5, "writeBps": "x", "iops": 300, "priority": "high"})
    assert lim.cpu_pct == 100.0
    assert lim.read_bps == 0.0 and lim.write_bps == 0.0
    assert lim.iops == 300.0
    assert lim.priority == "below_normal"


def test_non_windows_reports_unsupported(capsys, monkeypatch):
    import os

    if os.name == "nt":  # pragma: no cover
        return
    assert main(["--pid", "1"]) == 0
    assert '"unsupported"' in capsys.readouterr().out
