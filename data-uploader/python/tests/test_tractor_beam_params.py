"""Tractor-beam reach and pull on the weapon payload (admin feedback #233).

A ship tractor beam (SureGrip, ViseLock, the ATLS Durus …) goes through the
weapon projection because it carries `SCItemWeaponComponentParams`, but its
only fire action is a `SWeaponActionFireTractorBeamParams` struct with NO
`fireRate` — so the fire-rate walk never selects it and the beam's reach and
pull never reached the payload. The ship page therefore showed a SureGrip as
"power draw 1 segment" and nothing else.

Shapes below are copied from the LIVE 4.10 P4K (`GRIN_TractorBeam_S1`,
probed 2026-09-17): minForce 1500 / maxForce 500000 N, minDistance 0 /
maxDistance 150 / fullStrengthDistance 75 m, maxAngle 60°, maxVolume 300000,
tetherBreakTime 1.5 s, movement band 5–10 m/s and 0.1–20 m/s². Every value is
emitted as a flat `tractorBeam.<key>` scalar — the frontend reads exactly
those keys — and a weapon without the struct emits none of them.
"""

from __future__ import annotations

from sc_extract.dataforge_extract import (
    CodexExtractor,
    _find_tractor_action,
    _tractor_beam_params,
)


def _extractor() -> CodexExtractor:
    return CodexExtractor.__new__(CodexExtractor)


def tractor_action(**overrides) -> dict:
    """The verified `SWeaponActionFireTractorBeamParams` leaf, live values."""
    base = {
        "_Type_": "SWeaponActionFireTractorBeamParams",
        "name": "TractorBeam",
        "toggleMode": "IsNotToggle",
        "minForce": 1500.0,
        "maxForce": 500000.0,
        "minDistance": 0.0,
        "maxDistance": 150.0,
        "fullStrengthDistance": 75.0,
        "maxAngle": 60.0,
        "maxVolume": 300000.0,
        "volumeForceCoefficient": 0.30000001192092896,
        "tetherBreakTime": 1.5,
        "safeRangeValueFactor": 0.8500000238418579,
        "heatPerSecond": 0.0,
        "movementParams": {
            "_Type_": "SWeaponActionFireTractorBeamMovementParams",
            "minAcceleration": 0.10000000149011612,
            "maxAcceleration": 20.0,
            "minSpeed": 5.0,
            "maxSpeed": 10.0,
            "accelerationFactor": 5.0,
        },
        "towingBeamParams": None,
    }
    base.update(overrides)
    return base


def _wcp(fire_actions) -> dict:
    return {
        "_Type_": "SCItemWeaponComponentParams",
        "fireRate": 0.0,
        "fireActions": fire_actions,
    }


class TestFindTractorAction:
    def test_finds_the_inline_leaf(self) -> None:
        fa = tractor_action()
        assert _find_tractor_action([fa]) is fa

    def test_descends_into_sequence_wrappers(self) -> None:
        fa = tractor_action()
        wrapper = {
            "_Type_": "SWeaponActionSequenceParams",
            "sequenceEntries": [{"weaponAction": fa}],
        }
        assert _find_tractor_action([wrapper]) is fa

    def test_ignores_other_fire_actions(self) -> None:
        single = {"_Type_": "SWeaponActionFireSingleParams", "fireRate": 750.0}
        assert _find_tractor_action([single]) is None
        assert _find_tractor_action(None) is None
        assert _find_tractor_action([]) is None


class TestTractorBeamParams:
    def test_live_shape_emits_every_flat_key(self) -> None:
        out = _tractor_beam_params(_wcp([tractor_action()]))
        assert out == {
            "tractorBeam.minForce": 1500.0,
            "tractorBeam.maxForce": 500000.0,
            "tractorBeam.minDistance": 0.0,
            "tractorBeam.maxDistance": 150.0,
            "tractorBeam.fullStrengthDistance": 75.0,
            "tractorBeam.maxAngle": 60.0,
            "tractorBeam.maxVolume": 300000.0,
            "tractorBeam.tetherBreakTime": 1.5,
            "tractorBeam.safeRangeValueFactor": 0.8500000238418579,
            "tractorBeam.minSpeed": 5.0,
            "tractorBeam.maxSpeed": 10.0,
            "tractorBeam.minAcceleration": 0.10000000149011612,
            "tractorBeam.maxAcceleration": 20.0,
        }

    def test_explicit_zero_is_kept_absent_field_stays_absent(self) -> None:
        fa = tractor_action()
        del fa["maxVolume"]
        del fa["movementParams"]
        out = _tractor_beam_params(_wcp([fa]))
        assert out["tractorBeam.minDistance"] == 0.0
        assert "tractorBeam.maxVolume" not in out
        assert "tractorBeam.maxSpeed" not in out

    def test_non_numeric_leaf_is_skipped(self) -> None:
        out = _tractor_beam_params(_wcp([tractor_action(maxForce=None, maxAngle="wide")]))
        assert "tractorBeam.maxForce" not in out
        assert "tractorBeam.maxAngle" not in out
        assert out["tractorBeam.maxDistance"] == 150.0

    def test_a_gun_emits_nothing(self) -> None:
        single = {"_Type_": "SWeaponActionFireSingleParams", "fireRate": 750.0}
        assert _tractor_beam_params(_wcp([single])) == {}
        assert _tractor_beam_params({"_Type_": "SCItemWeaponComponentParams"}) == {}


class TestWeaponParamsIntegration:
    def test_tractor_keys_land_on_weapon_params_without_a_fire_rate(self) -> None:
        params = _extractor()._weapon_params(_wcp([tractor_action()]), {"_RecordValue_": {}})
        assert params["tractorBeam.maxDistance"] == 150.0
        assert params["tractorBeam.fullStrengthDistance"] == 75.0
        assert params["tractorBeam.maxForce"] == 500000.0
        # the flat 0.0 scalar is removed, never left as a stale zero
        assert "fireRate" not in params

    def test_a_gun_keeps_its_params_untouched(self) -> None:
        single = {"_Type_": "SWeaponActionFireSingleParams", "fireRate": 750.0}
        params = _extractor()._weapon_params(_wcp([single]), {"_RecordValue_": {}})
        assert params["fireRate"] == 750.0
        assert not any(k.startswith("tractorBeam.") for k in params)
