"""Powered ITEMS keep their resource network (feedback c73f83e9 / #227).

Radar, life support and the flight controller are not ComponentKinds — they
go through `_project_item()`, which until schema 4 only attached `stats` to
armor. So their `ItemResourceComponentParams` (the Power draw the energy dock
needs) was projected away and the dock read "—" for radar / life support /
thrusters.

Values below are the REAL draws probed against LIVE 4.9 on 2026-09-13:
RADR_NAVE_S01_SNSR6 (2 segments), LFSP_TYDT_S02_ComfortAirPlus (2),
Controller_Flight_ARGO_RAFT (6), WEP_TractorBeam_S1_Utility_1 (1),
ARGO_TowingBeam_S3 (3). The same probe showed MainThruster /
ManneuverThruster records carry a resource group with NO Power consumption —
the thruster draw lives on the FlightController item, which is why that one
matters here. (The live tractor / towing beams carry
SCItemWeaponComponentParams and take the weapon projection, which already
kept the network; they are parametrised below only to pin the item rule.)
"""

from __future__ import annotations

import pytest

from sc_extract.dataforge import DataForge
from sc_extract.localization import Localizer
from sc_extract.dataforge_extract import (
    _classify_entity,
    CodexExtractor,
    _components_of,
    _attach_def,
    _COMPONENT_KIND,
)

from dcb_builder import build_minimal_v8


@pytest.fixture(scope="module")
def ex(tmp_path_factory: pytest.TempPathFactory) -> CodexExtractor:
    df = DataForge(build_minimal_v8())
    out = tmp_path_factory.mktemp("powered_out")
    return CodexExtractor(df, Localizer.empty(), out,
                          {"channel": "TEST", "patch": "0", "build": "0"})


def _segments(n: float) -> dict:
    return {"_Type_": "ItemResourceDeltaAmount", "resource": "Power",
            "resourceAmountPerSecond": {"_Type_": "SPowerSegmentResourceUnit",
                                        "units": n}}


def _resource_network(segments: float, *, min_fraction: float = 0.0) -> dict:
    return {
        "_Type_": "ItemResourceComponentParams",
        "isRelay": False,
        "defaultPriority": 30,
        "states": [{
            "_Type_": "ItemResourceState", "name": "Online",
            "deltas": [{"_Type_": "ItemResourceDeltaConsumption",
                        "minimumConsumptionFraction": min_fraction,
                        "consumption": _segments(segments)}],
        }],
    }


def _powered_item(atype: str, segments: float, *, sub_type: str = "UNDEFINED",
                  size: int = 1, extra: list | None = None) -> dict:
    comps = [
        {"_Type_": "SAttachableComponentParams",
         "AttachDef": {"Type": atype, "SubType": sub_type, "Size": size, "Grade": 1}},
        _resource_network(segments),
    ]
    comps.extend(extra or [])
    return {"_RecordValue_": {"_Type_": "EntityClassDefinition", "Components": comps}}


def _project(ex: CodexExtractor, resolved: dict) -> dict:
    comps = _components_of(resolved)
    attach = _attach_def(comps)
    return ex._project_item(ex.df.records[0], resolved, comps, attach, attach["Type"])


@pytest.mark.parametrize("atype,segments", [
    ("LifeSupportGenerator", 2.0),
    ("TractorBeam", 1.0),
    ("TowingBeam", 3.0),
    ("FlightController", 6.0),
    ("EMP", 1.0),
    ("QuantumInterdictionGenerator", 3.0),
])
def test_powered_item_keeps_its_power_draw(ex: CodexExtractor, atype: str,
                                           segments: float) -> None:
    """None of these is a ComponentKind — they must stay ITEMS (the web app
    routes them by attach type / port) and still carry the resource group."""
    assert atype not in _COMPONENT_KIND
    obj = _project(ex, _powered_item(atype, segments))
    assert obj["entityKind"] == "item"
    assert obj["attachType"] == atype
    net = obj["stats"]["ItemResourceComponentParams"]
    assert net["online.power.consumeSegments"] == segments
    assert net["stateNames"] == "Online"


def test_flight_controller_is_the_thruster_draw(ex: CodexExtractor) -> None:
    """Controller_Flight_ARGO_RAFT pulls 6 segments; a thruster pulls nothing.
    The item projection has to keep the controller's block for the 'Antriebe'
    group to ever show a number."""
    obj = _project(ex, _powered_item("FlightController", 6.0))
    assert obj["stats"]["ItemResourceComponentParams"]["online.power.consumeSegments"] == 6.0


def test_unpowered_item_still_has_no_stats(ex: CodexExtractor) -> None:
    """The gate is the resource struct being PRESENT — a plain item with other
    *Params structs but no network stays lean (same rule as non-armor items)."""
    resolved = {"_RecordValue_": {"_Type_": "EntityClassDefinition", "Components": [
        {"_Type_": "SAttachableComponentParams",
         "AttachDef": {"Type": "Char_Clothing_Hat", "SubType": "Hat", "Size": 1}},
        {"_Type_": "SCItemClothingParams", "TemperatureResistanceMin": -10.0},
    ]}}
    assert "stats" not in _project(ex, resolved)


def test_powered_item_also_keeps_its_own_params(ex: CodexExtractor) -> None:
    """Once the block is emitted it is the usual struct-keyed dump, so an
    item's own params ride along — nothing is cherry-picked out."""
    resolved = _powered_item("LifeSupportGenerator", 2.0, extra=[
        {"_Type_": "SCItemLifeSupportParams", "oxygenRate": 1.5},
    ])
    obj = _project(ex, resolved)
    assert obj["stats"]["SCItemLifeSupportParams"]["oxygenRate"] == 1.5
    assert obj["stats"]["ItemResourceComponentParams"]["online.power.consumeSegments"] == 2.0


# Live shape of RADR_BLTR_S01_Hunter (LIVE 4.10.2, trimmed): eight signature
# slots, aim assist, ping cooldown.
def _hunter_radar() -> dict:
    slot = lambda sens, pierce: {"_Type_": "SCItemRadarSignatureDetection",  # noqa: E731
                                 "sensitivity": sens, "piercing": pierce,
                                 "permitPassiveDetection": True, "permitActiveDetection": True}
    return {
        "_Type_": "SCItemRadarComponentParams",
        "signatureDetection": [slot(0.8, 0.25), slot(0.8, 0.25), slot(0.8, 0.25), slot(0.0, 0.25),
                               slot(1.0, 1.0), slot(1.0, 0.25), slot(1.0, 0.25), slot(0.0, 0.25)],
        "pingProperties": {"_Type_": "SCItemRadarPingProperties", "cooldownTime": 2.5},
        "aimAssist": {"_Type_": "SRadarAimAssistData", "distanceMinAssignment": 780.0,
                      "distanceMaxAssignment": 1028.5, "outsideRangeBufferDistance": 60.0},
    }


def test_a_ship_radar_is_a_component_with_flat_range_and_sensitivity(ex: CodexExtractor) -> None:
    """#842: radars sit in a component slot and draw power like one, so they
    are `codex_components` kind `Radar` — with the power draw kept and the
    detection numbers the generic flatten drops (a list) as flat keys."""
    assert _COMPONENT_KIND["Radar"] == "Radar"
    resolved = _powered_item("Radar", 2.0, sub_type="MidRangeRadar", extra=[_hunter_radar()])
    comps = _components_of(resolved)
    attach = _attach_def(comps)
    assert _classify_entity("radar.xml", comps, attach) == "components"
    obj = ex._project_component(ex.df.records[0], resolved, comps, attach, "Radar")
    assert obj["entityKind"] == "component" and obj["kind"] == "Radar"
    radar = obj["stats"]["SCItemRadarComponentParams"]
    assert radar["aimAssistRangeM"] == 1028.5
    assert radar["aimAssistMinRangeM"] == 780.0
    assert radar["pingCooldownS"] == 2.5
    assert (radar["sensitivityIR"], radar["sensitivityEM"], radar["sensitivityCS"]) == (0.8, 0.8, 0.8)
    assert radar["sensitivityDB"] == 0.0 and radar["sensitivityRS"] == 1.0
    assert radar["piercingRS"] == 1.0
    assert "sensitivity5" not in radar  # unnamed slots stay out
    assert obj["stats"]["ItemResourceComponentParams"]["online.power.consumeSegments"] == 2.0
