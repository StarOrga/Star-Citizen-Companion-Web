"""The classification pre-pass must agree with the projection loop.

`plan_entity_totals` announces "x von y" per typed catalog before the loop
writes a single file; if its verdict ever diverged from the loop's branch order
the UI would show a bar that can never reach 100 % (or overshoots). Both sides
now share `_classify_entity`, so the test pins that function's decisions on
synthetic resolved records and checks `expected()` event semantics.
"""

from __future__ import annotations

import json

import pytest

from sc_extract import events
from sc_extract.dataforge_extract import (
    _classify_entity,
    _components_of,
    _attach_def,
)


def _resolved(atype: str | None, extra_components: list[dict] | None = None) -> dict:
    comps: list[dict] = []
    if atype is not None:
        comps.append({"_Type_": "SAttachableComponentParams", "AttachDef": {"Type": atype}})
    comps.extend(extra_components or [])
    return {"_RecordValue_": {"_Type_": "EntityClassDefinition", "Components": comps}}


def _kind(filename: str, resolved: dict) -> str | None:
    comps = _components_of(resolved)
    return _classify_entity(filename, comps, _attach_def(comps))


SHIP_PATH = "libs/foundry/records/entities/spaceships/aegs/aegs_gladius.xml"
ITEM_PATH = "libs/foundry/records/entities/scitem/ships/weapons/gun.xml"


@pytest.mark.parametrize(
    "filename, resolved, expected",
    [
        (SHIP_PATH, _resolved("Ship"), "ships"),
        # Vehicle filed outside the known roots — the component still makes it a ship.
        (ITEM_PATH, _resolved("Ship", [{"_Type_": "VehicleComponentParams"}]), "ships"),
        (ITEM_PATH, _resolved("WeaponGun"), "weapons"),
        (ITEM_PATH, _resolved("WeaponPersonal"), "weapons"),
        # Weapon by component signal, AttachDef type unrelated.
        (ITEM_PATH, _resolved("Misc", [{"_Type_": "SCItemWeaponComponentParams"}]), "weapons"),
        (ITEM_PATH, _resolved("PowerPlant"), "components"),
        (ITEM_PATH, _resolved("Char_Armor_Torso"), "items"),
        # No AttachDef at all → only the generic dump captures it.
        (ITEM_PATH, _resolved(None), None),
    ],
)
def test_classify_entity(filename: str, resolved: dict, expected: str | None) -> None:
    assert _kind(filename, resolved) == expected


def test_ship_path_beats_weapon_signal() -> None:
    # Branch order is part of the contract: a vehicle root wins over any
    # weapon-looking component (turret-bearing hulls carry weapon params).
    resolved = _resolved("WeaponGun", [{"_Type_": "SCItemWeaponComponentParams"}])
    assert _kind(SHIP_PATH, resolved) == "ships"


def test_expected_rides_on_count_event(capsys: pytest.CaptureFixture[str], monkeypatch) -> None:
    monkeypatch.setattr(events, "_expected_seen", {})
    monkeypatch.setattr(events, "_last_count", {})
    events.count("ships", 12)
    events.expected("ships", 340)
    events.expected("ships", 340)  # unchanged → dropped
    lines = [json.loads(l) for l in capsys.readouterr().out.splitlines() if l.strip()]
    counts = [l["counter"] for l in lines if l.get("type") == "count"]
    assert counts[0] == {"key": "ships", "value": 12}
    assert counts[1] == {"key": "ships", "value": 12, "expected": 340}
    assert len(counts) == 2


def test_category_order_groups_catalogs_left_to_right() -> None:
    # Display order ships → components → weapons → items; stable inside a
    # catalog; unplaced records (None) last.
    from sc_extract.dataforge_extract import _category_order

    kinds = ["items", None, "weapons", "ships", "components", "items", "ships"]
    order = _category_order(kinds)
    assert [kinds[i] for i in order] == [
        "ships", "ships", "components", "weapons", "items", "items", None,
    ]
    assert order[:2] == [3, 6]  # DataCore order kept within a catalog
    assert order[4:6] == [0, 5]


def test_heartbeat_reports_cpu_load(capsys: pytest.CaptureFixture[str], monkeypatch) -> None:
    import time

    monkeypatch.setattr(events, "_sink", None)
    stop = events.start_heartbeat(interval=0.05)
    deadline = time.monotonic() + 0.3
    while time.monotonic() < deadline:
        sum(range(10_000))  # keep this process busy
    stop()
    time.sleep(0.1)
    pulses = [
        json.loads(l) for l in capsys.readouterr().out.splitlines()
        if l.strip() and json.loads(l).get("type") == "pulse"
    ]
    assert pulses, "heartbeat emitted nothing"
    assert all(isinstance(p["busy"], (int, float)) for p in pulses)
    assert max(p["busy"] for p in pulses) > 0.1
