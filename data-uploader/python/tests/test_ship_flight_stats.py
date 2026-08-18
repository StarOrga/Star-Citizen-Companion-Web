"""Ship `flight` block: resolved from the FlightController ITEM entity
referenced from the ship's own default loadout, NOT from the ship's own
Components (verified live: CNOU_Nomad / AEGS_Gladius / MISC_Freelancer never
carry scmSpeed etc. on their own record — see
docs/concepts/codex-extraction-output.md §0b).

`_flight_stats()` / `_flight_controller_ifcs()` are pure functions of
`self.df` + `self._flight_cache` + `self.on_log`, so the tests fake a minimal
DataForge stand-in rather than parsing a real DataCore.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from sc_extract.dataforge_extract import CodexExtractor


@dataclass
class _FakeRecord:
    name: str


class _FakeDataForge:
    """Minimal stand-in: `records_by_type_name` + `record_to_dict`."""

    def __init__(self, ecds: Dict[str, Dict[str, Any]]) -> None:
        # bare class name (no "EntityClassDefinition." prefix) -> resolved dict
        self._ecds = ecds
        self._records = [_FakeRecord(f"EntityClassDefinition.{name}") for name in ecds]
        self.record_to_dict_calls = 0

    def records_by_type_name(self, type_name: str) -> List[_FakeRecord]:
        assert type_name == "EntityClassDefinition"
        return self._records

    def record_to_dict(self, record: _FakeRecord, max_depth: int = 64) -> Dict[str, Any]:
        self.record_to_dict_calls += 1
        bare = record.name.split(".", 1)[1]
        return self._ecds[bare]


def _comp(type_name: str, **fields: Any) -> Dict[str, Any]:
    return {"_Type_": type_name, **fields}


def _entity(components: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"_RecordValue_": {"Components": components}}


def _extractor(df: Optional[_FakeDataForge] = None) -> CodexExtractor:
    """Bypass __init__ (needs a real DataForge/Localizer/P4K)."""
    ex = CodexExtractor.__new__(CodexExtractor)
    ex.df = df
    ex._flight_cache = {}
    ex.on_log = lambda level, msg: None
    return ex


def _loadout_entry(port_name: str, class_name: Optional[str]) -> Dict[str, Any]:
    return {"itemPortName": port_name, "entityClassName": class_name}


_ALL_NONE = {"scmSpeed": None, "maxSpeed": None, "boostSpeed": None,
             "pitch": None, "yaw": None, "roll": None}


def test_flight_stats_absent_when_loadout_has_no_flight_controller_port() -> None:
    ex = _extractor(_FakeDataForge({}))
    loadout = [_loadout_entry("hardpoint_seat_pilot", "Some_Seat")]
    assert ex._flight_stats(loadout) == _ALL_NONE


def test_flight_stats_absent_when_flight_controller_entry_has_no_class() -> None:
    ex = _extractor(_FakeDataForge({}))
    loadout = [_loadout_entry("hardpoint_controller_flight", None)]
    assert ex._flight_stats(loadout) == _ALL_NONE


def test_flight_stats_absent_when_flight_controller_record_not_found() -> None:
    ex = _extractor(_FakeDataForge({}))
    loadout = [_loadout_entry("hardpoint_controller_flight", "Controller_Flight_GHOST")]
    assert ex._flight_stats(loadout) == _ALL_NONE


def test_flight_stats_absent_when_no_ifcs_component() -> None:
    df = _FakeDataForge({
        "Controller_Flight_TEST": _entity([_comp("SCItemFlightControllerParams")]),
    })
    ex = _extractor(df)
    loadout = [_loadout_entry("hardpoint_controller_flight", "Controller_Flight_TEST")]
    assert ex._flight_stats(loadout) == _ALL_NONE


def test_flight_stats_resolves_from_ifcs_component() -> None:
    df = _FakeDataForge({
        "Controller_Flight_TEST": _entity([
            _comp("SCItemFlightControllerParams"),
            _comp(
                "IFCSParams",
                scmSpeed=205.0, maxSpeed=1100.0,
                boostSpeedForward=450.0, boostSpeedBackward=230.0,
                maxAngularVelocity={"_Type_": "Vec3", "x": 45.0, "y": 120.0, "z": 45.0},
            ),
        ]),
    })
    ex = _extractor(df)
    loadout = [_loadout_entry("hardpoint_controller_flight", "Controller_Flight_TEST")]
    stats = ex._flight_stats(loadout)
    assert stats == {
        "scmSpeed": 205.0, "maxSpeed": 1100.0,
        # forward boost only — the contract has one boostSpeed slot
        "boostSpeed": 450.0,
        # Vec3 x/y/z -> pitch/roll/yaw (CryEngine +X right, +Y nose, +Z up)
        "pitch": 45.0, "roll": 120.0, "yaw": 45.0,
    }


def test_flight_stats_missing_ifcs_field_stays_none() -> None:
    """boostSpeedForward absent on the struct -> boostSpeed None, not guessed
    from boostSpeedBackward or anything else."""
    df = _FakeDataForge({
        "Controller_Flight_TEST": _entity([
            _comp("IFCSParams", scmSpeed=200.0, maxAngularVelocity=None),
        ]),
    })
    ex = _extractor(df)
    loadout = [_loadout_entry("hardpoint_controller_flight", "Controller_Flight_TEST")]
    stats = ex._flight_stats(loadout)
    assert stats["scmSpeed"] == 200.0
    assert stats["boostSpeed"] is None
    assert stats["maxSpeed"] is None
    assert stats["pitch"] is None and stats["yaw"] is None and stats["roll"] is None


def test_flight_controller_ifcs_is_cached_per_class_name() -> None:
    """One record_to_dict call per ship class, not per lookup — a run resolves
    hundreds of ships and must not re-parse the same FlightController item."""
    df = _FakeDataForge({
        "Controller_Flight_TEST": _entity([
            _comp("IFCSParams", scmSpeed=200.0),
        ]),
    })
    ex = _extractor(df)
    loadout = [_loadout_entry("hardpoint_controller_flight", "Controller_Flight_TEST")]
    ex._flight_stats(loadout)
    ex._flight_stats(loadout)
    assert df.record_to_dict_calls == 1


def test_flight_controller_port_match_is_substring_generic() -> None:
    """The port name is matched by substring (case-insensitive), not equality,
    so minor naming variance across ship classes doesn't silently drop the
    field — but an unrelated port must never match."""
    df = _FakeDataForge({
        "Controller_Flight_TEST": _entity([
            _comp("IFCSParams", scmSpeed=200.0),
        ]),
    })
    ex = _extractor(df)
    loadout = [
        _loadout_entry("hardpoint_controller_weapon", "Controller_Weapon"),
        _loadout_entry("HARDPOINT_CONTROLLER_FLIGHT", "Controller_Flight_TEST"),
    ]
    assert ex._flight_stats(loadout)["scmSpeed"] == 200.0
