"""`ItemResourceComponentParams.states[]` projection (energy model).

The struct's `states[]`/`deltas[]` are LISTS, which `_component_stats()`'s
generic depth-2 flatten drops — so the whole energy model (segment budget,
minimum draw, coolant load, shield regen, IR/EM signature, power ranges) never
reached a payload. `_add_resource_network()` is a targeted post-step for this
one struct, in the same spirit as `_add_vehicle_armor_depth2()`.

The fixtures below are trimmed copies of REAL resolved LIVE-4.9.0 records
(probe 2026-09-04: POWR_LPLT_S01_IonBurst, COOL_JUST_S01_UltraFlow,
SHLD_SECO_S01_WEB, KLWE_LaserRepeater_S3) — plain resolved dicts rather than
`dcb_builder` blobs, because these projections are pure functions of the
resolved component list (same pattern as `test_stats_regression.py`).
"""

from __future__ import annotations

import pytest

from sc_extract.dataforge_extract import CodexExtractor


def _extractor() -> CodexExtractor:
    return CodexExtractor.__new__(CodexExtractor)


def _amount(resource: str, unit_type: str, value) -> dict:
    unit = {"_Type_": unit_type}
    if unit_type == "SPowerSegmentResourceUnit":
        unit["units"] = value
    else:
        unit["standardResourceUnits"] = value
    return {"_Type_": "ItemResourceDeltaAmount", "resource": resource,
            "resourceAmountPerSecond": unit}


def _irc(deltas: list, *, em=None, ir=None, ranges=True,
         state: str = "Online") -> dict:
    st: dict = {"_Type_": "ItemResourceState", "name": state, "deltas": deltas}
    if em is not None or ir is not None:
        st["signatureParams"] = {
            "_Type_": "ItemResourceSignatureParams",
            "EMSignature": None if em is None else {
                "_Type_": "ItemResourceSignatureEntry",
                "nominalSignature": em[0], "decayRate": em[1]},
            "IRSignature": None if ir is None else {
                "_Type_": "ItemResourceSignatureEntry",
                "nominalSignature": ir[0], "decayRate": ir[1]},
        }
    if ranges:
        st["powerRanges"] = {
            "_Type_": "PowerRangeParams",
            "low": {"_Type_": "ResourceRangeParams", "start": 0,
                    "modifier": 0.699999988079071, "registerRange": False},
            "medium": {"_Type_": "ResourceRangeParams", "start": 1,
                       "modifier": 0.8500000238418579, "registerRange": True},
            "high": {"_Type_": "ResourceRangeParams", "start": 3,
                     "modifier": 1.0, "registerRange": True},
        }
    return {"_Type_": "ItemResourceComponentParams", "isRelay": False,
            "defaultPriority": 30, "states": [st]}


def _reactor() -> dict:
    return _irc(
        [
            {"_Type_": "ItemResourceDeltaGeneration",
             "generation": _amount("Power", "SPowerSegmentResourceUnit", 14)},
            {"_Type_": "ItemResourceDeltaConsumption",
             "minimumConsumptionFraction": 0.0,
             "consumption": _amount("Coolant", "SStandardResourceUnit", 0.0)},
        ],
        em=(5250.0, 0.15000000596046448), ir=(0.0, 0.15000000596046448))


def _cooler() -> dict:
    return _irc(
        [{"_Type_": "ItemResourceDeltaConversion",
          "minimumConsumptionFraction": 0.6666666865348816,
          "consumption": _amount("Power", "SPowerSegmentResourceUnit", 3),
          "generation": _amount("Coolant", "SStandardResourceUnit", 34.0)}],
        em=(1490.0, 0.15000000596046448), ir=(7130.0, 0.5))


def _shield() -> dict:
    return _irc(
        [
            {"_Type_": "ItemResourceDeltaConversion",
             "minimumConsumptionFraction": 0.5,
             "consumption": _amount("Power", "SPowerSegmentResourceUnit", 2),
             "generation": _amount("Shield", "SStandardResourceUnit", 410.0)},
            {"_Type_": "ItemResourceDeltaConsumption",
             "minimumConsumptionFraction": 0.0,
             "consumption": _amount("Coolant", "SStandardResourceUnit", 0.0)},
        ],
        em=(750.0, 0.15000000596046448), ir=(0.0, 0.15000000596046448))


def _weapon_irc() -> dict:
    return _irc(
        [{"_Type_": "ItemResourceDeltaConsumption",
          "minimumConsumptionFraction": 0.0,
          "consumption": _amount("Power", "SStandardResourceUnit", 1.0)}],
        em=(0.0, 0.15000000596046448), ir=(0.0, 0.15000000596046448))


def _stats(comp: dict) -> dict:
    return _extractor()._component_stats([comp], "x")["ItemResourceComponentParams"]


def test_reactor_generation_segments_are_the_power_budget() -> None:
    s = _stats(_reactor())
    assert s["online.power.generateSegments"] == 14
    assert s["stateNames"] == "Online"
    # the reactor's coolant draw is an explicit 0.0 in the file — kept as 0,
    # not dropped and not invented
    assert s["online.coolant.consume"] == 0.0
    assert "online.power.consumeSegments" not in s


def test_cooler_conversion_consumes_power_and_generates_coolant() -> None:
    s = _stats(_cooler())
    assert s["online.power.consumeSegments"] == 3
    assert s["online.power.minFraction"] == 0.6667  # rounded, float32 noise
    assert s["online.coolant.generate"] == 34.0
    assert s["online.em.nominal"] == 1490.0
    assert s["online.ir.nominal"] == 7130.0
    assert s["online.ir.decayRate"] == pytest.approx(0.5)


def test_shield_conversion_yields_regen_and_minimum_draw() -> None:
    s = _stats(_shield())
    assert s["online.power.consumeSegments"] == 2
    assert s["online.power.minFraction"] == 0.5
    assert s["online.shield.generate"] == 410.0
    assert s["online.coolant.consume"] == 0.0


def test_standard_resource_units_land_on_their_own_key() -> None:
    """A weapon draws Power as SStandardResourceUnit, NOT whole segments — the
    two unit types must never collapse into one key."""
    s = _stats(_weapon_irc())
    assert s["online.power.consumeUnits"] == 1.0
    assert "online.power.consumeSegments" not in s
    assert s["online.em.nominal"] == 0.0


def test_power_ranges_are_flattened_per_band() -> None:
    s = _stats(_cooler())
    assert s["online.powerRanges.low.start"] == 0
    assert s["online.powerRanges.medium.start"] == 1
    assert s["online.powerRanges.high.modifier"] == 1.0


def test_repeated_deltas_on_one_resource_are_summed() -> None:
    comp = _irc([
        {"_Type_": "ItemResourceDeltaConsumption",
         "minimumConsumptionFraction": 0.5,
         "consumption": _amount("Coolant", "SStandardResourceUnit", 4.0)},
        {"_Type_": "ItemResourceDeltaConsumption",
         "minimumConsumptionFraction": 0.5,
         "consumption": _amount("Coolant", "SStandardResourceUnit", 6.0)},
    ], ranges=False)
    assert _stats(comp)["online.coolant.consume"] == 10.0


def test_states_are_prefixed_by_their_lowercased_name() -> None:
    comp = _irc([{"_Type_": "ItemResourceDeltaConsumption",
                  "minimumConsumptionFraction": 1.0,
                  "consumption": _amount("Power", "SPowerSegmentResourceUnit", 2)}],
                ranges=False, state="Standby")
    s = _stats(comp)
    assert s["standby.power.consumeSegments"] == 2
    assert s["stateNames"] == "Standby"


def test_missing_states_list_adds_nothing() -> None:
    comp = {"_Type_": "ItemResourceComponentParams", "isRelay": False}
    s = _stats(comp)
    assert s == {"isRelay": False}


def test_weapons_get_an_allowlisted_stats_block() -> None:
    comps = [
        _weapon_irc(),
        {"_Type_": "SHealthComponentParams", "Health": 1500.0},
        {"_Type_": "SDistortionParams", "MaximumDistortionDamage": 800.0,
         "DistortionDecayRate": 40.0},
        {"_Type_": "SEntityPhysicsControllerParams",
         "PhysType": {"_Type_": "SEntityPhysicsType", "Mass": 200.0}},
        {"_Type_": "SCItemAimableComponentParams", "gimbalRange": 5.0},
        # noise a weapon really carries — must NOT surface
        {"_Type_": "SGeometryResourceParams", "Geometry": "x.cga"},
        {"_Type_": "SEntityAudioControllerParams", "volume": 1.0},
    ]
    stats = _extractor()._weapon_stats(comps)
    assert set(stats) == {
        "ItemResourceComponentParams", "SHealthComponentParams",
        "SDistortionParams", "SEntityPhysicsControllerParams",
        "SCItemAimableComponentParams",
    }
    assert stats["SHealthComponentParams"]["Health"] == 1500.0
    assert stats["SEntityPhysicsControllerParams"]["PhysType.Mass"] == 200.0
    assert stats["SCItemAimableComponentParams"]["gimbalRange"] == 5.0
    assert stats["ItemResourceComponentParams"]["online.power.consumeUnits"] == 1.0


def test_weapon_without_allowlisted_structs_gets_no_stats() -> None:
    assert _extractor()._weapon_stats([{"_Type_": "SGeometryResourceParams"}]) == {}
