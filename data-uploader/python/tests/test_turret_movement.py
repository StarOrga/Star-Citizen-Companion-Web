"""Turret traverse limits on the codex payload (#793).

`SCItemTurretParams.movementList[]` is a list, which the generic stats flatten
drops — the codex only carried the gunner's head-look (`SCItemSeatParams`),
never how far the mount itself turns. The ship-fitting view of the companion
app needs the real traverse to draw sight cones and count the turrets that
bear on an attacker.

Shapes below are trimmed copies of LIVE 4.10 records (probe 2026-10-20):
`AEGS_Idris_Remote_Camera_Turret_Upper` (standard limits: yaw ±180°, pitch
-15…90°, 95°/s) and `AEGS_Hammerhead_SCItem_Turret_Top` (pitch band that
changes with the yaw of `turret_upper_helper`: -3…70° fore/aft, -10…70°
abeam). Audio sub-structs are dropped — the extractor never reads them.
"""

from __future__ import annotations

from sc_extract.dataforge_extract import CodexExtractor, _turret_movement


def _axis(lowest=None, highest=None, *, bands=None, relative=None,
          speed=95.0, overwrites=None) -> dict:
    if bands is not None:
        limits = {
            "_Type_": "SCItemTurretCustomAngleLimitParams",
            "RelativeJointName": relative,
            "AngleLimits": [
                {"_Type_": "SCItemTurretCustomAngleLimit", "TurretRotation": r,
                 "LowestAngle": lo, "HighestAngle": hi}
                for r, lo, hi in bands
            ],
            "limitOverwrites": [],
        }
    else:
        limits = {
            "_Type_": "SCItemTurretStandardAngleLimitParams",
            "LowestAngle": lowest,
            "HighestAngle": highest,
            "limitOverwrites": overwrites or [],
        }
    return {
        "_Type_": "SCItemTurretJointMovementAxisParams",
        "speed": speed,
        "acceleration_timeToFullSpeed": 0.30000001192092896,
        "angleLimits": limits,
    }


def _joint(name, *, yaw=None, pitch=None, roll=None, slaved=False) -> dict:
    return {
        "_Type_": "SCItemTurretJointMovementParams",
        "movementTag": None,
        "jointName": name,
        "slavedOnly": slaved,
        "restrictTargetAngles": False,
        "yawAxis": yaw,
        "pitchAxis": pitch,
        "rollAxis": roll,
    }


def _turret(*joints) -> dict:
    return {
        "_Type_": "SCItemTurretParams",
        "rotationStyle": "SingleAxis",
        "movementList": list(joints),
        "weaponModifierInterpolationFactor": [1.0, 0.0, 1.0],
    }


IDRIS_CAMERA_TURRET = _turret(
    _joint("Gimbal_Mount_Yaw", yaw=_axis(-180.0, 180.0)),
    _joint("Gimbal_Mount_Pitch", pitch=_axis(-15.0, 90.0)),
)

HAMMERHEAD_TOP_TURRET = _turret(
    _joint("turret_upper_helper", yaw=_axis(-180.0, 180.0, speed=60.0)),
    _joint("turret_pitch", pitch=_axis(
        bands=[(0.0, -3.0, 70.0), (90.0, -10.0, 70.0),
               (180.0, -3.0, 70.0), (270.0, -10.0, 70.0)],
        relative="turret_upper_helper", speed=60.0)),
)


def test_standard_limits_emit_one_entry_per_axis():
    assert _turret_movement([IDRIS_CAMERA_TURRET]) == [
        {"joint": "Gimbal_Mount_Yaw", "axis": "yaw",
         "minAngle": -180.0, "maxAngle": 180.0, "speed": 95.0},
        {"joint": "Gimbal_Mount_Pitch", "axis": "pitch",
         "minAngle": -15.0, "maxAngle": 90.0, "speed": 95.0},
    ]


def test_rotation_dependent_limits_keep_their_bands_and_an_envelope():
    yaw, pitch = _turret_movement([HAMMERHEAD_TOP_TURRET])
    assert yaw == {"joint": "turret_upper_helper", "axis": "yaw",
                   "minAngle": -180.0, "maxAngle": 180.0, "speed": 60.0}
    assert pitch["axis"] == "pitch"
    assert (pitch["minAngle"], pitch["maxAngle"]) == (-10.0, 70.0)
    assert pitch["relativeJoint"] == "turret_upper_helper"
    assert pitch["limitsByRotation"] == [
        {"rotation": 0.0, "minAngle": -3.0, "maxAngle": 70.0},
        {"rotation": 90.0, "minAngle": -10.0, "maxAngle": 70.0},
        {"rotation": 180.0, "minAngle": -3.0, "maxAngle": 70.0},
        {"rotation": 270.0, "minAngle": -10.0, "maxAngle": 70.0},
    ]


def test_tag_gated_limit_overwrites_do_not_replace_the_traverse():
    # XNAA_SanTokYai_Mount_Gimbal_S3: a stowed-state limiter locks the gimbal
    # to ±1°, the normal traverse stays ±80°.
    stowed = [{"_Type_": "SCItemTurretStandardAngleLimitTagOverwriteParams",
               "limiterTag": {"_RecordName_": "Tag.x"},
               "LowestAngle": -1.0, "HighestAngle": 1.0}]
    turret = _turret(_joint("yaw", yaw=_axis(-80.0, 80.0, overwrites=stowed)))
    (entry,) = _turret_movement([turret])
    assert (entry["minAngle"], entry["maxAngle"]) == (-80.0, 80.0)


def test_slaved_joint_is_flagged_and_float_noise_rounded():
    turret = _turret(_joint("follower", pitch=_axis(-14.999999046325684, 90.0,
                                                    speed=None), slaved=True))
    assert _turret_movement([turret]) == [
        {"joint": "follower", "axis": "pitch", "minAngle": -15.0,
         "maxAngle": 90.0, "slavedOnly": True},
    ]


def test_items_without_turret_params_get_nothing():
    assert _turret_movement([]) == []
    assert _turret_movement([{"_Type_": "SCItemSeatParams", "minYaw": -90.0}]) == []
    # A turret struct with no usable limits is not an empty traverse entry.
    assert _turret_movement([_turret(_joint("broken", yaw={"speed": 10.0}))]) == []


def test_base_entity_carries_turret_movement_only_for_turrets():
    ex = CodexExtractor.__new__(CodexExtractor)
    ex._localized = lambda key: None
    ex._loc_key_from = lambda *a, **k: None
    ex._manufacturer_ref = lambda attach: None
    ex._preview_image = lambda resolved: None
    ex.source = "test"

    class _Rec:
        name = "EntityClassDefinition.AEGS_Idris_Remote_Camera_Turret_Upper"
        guid = "g"
        type = "EntityClassDefinition"
        tag = None

    turret = ex._base_entity(_Rec(), {"_RecordValue_": {}}, [IDRIS_CAMERA_TURRET], None)
    assert [e["axis"] for e in turret["turretMovement"]] == ["yaw", "pitch"]
    plain = ex._base_entity(_Rec(), {"_RecordValue_": {}}, [], None)
    assert "turretMovement" not in plain
