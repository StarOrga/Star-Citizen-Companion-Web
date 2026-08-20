"""Vehicle (hull) armor items (PR A task 2): the per-hull `ARMR_<ship>` items
carry `SCItemVehicleArmorParams` but use their own AttachDef.Type vocabulary,
not the FPS `Char_Armor_*` one `_ARMOR_TYPES` already covers. The stats gate
in `_project_item()` must key off the struct being PRESENT, not off atype, so
these items get HP/damage-multiplier stats too — while leaving the existing
`Char_Armor_*` behaviour (test_armor_stats.py) and non-armor items untouched.
"""

from __future__ import annotations

import pytest

from sc_extract.dataforge import DataForge
from sc_extract.localization import Localizer
from sc_extract.dataforge_extract import CodexExtractor, _components_of, _attach_def

from dcb_builder import build_minimal_v8


@pytest.fixture(scope="module")
def ex(tmp_path_factory: pytest.TempPathFactory) -> CodexExtractor:
    df = DataForge(build_minimal_v8())
    out = tmp_path_factory.mktemp("vehicle_armor_out")
    return CodexExtractor(df, Localizer.empty(), out,
                          {"channel": "TEST", "patch": "0", "build": "0"})


def _vehicle_armor_resolved(atype: str = "Ship_Armor") -> dict:
    """Shape mirrors the real ARMR_<ship> item: an AttachDef whose Type is NOT
    in _ARMOR_TYPES, plus SCItemVehicleArmorParams (verified field names, from
    the live P4K's ARMR_CNOU_Nomad projection)."""
    return {
        "_RecordValue_": {
            "_Type_": "EntityClassDefinition",
            "Components": [
                {
                    "_Type_": "SAttachableComponentParams",
                    "AttachDef": {"Type": atype, "SubType": "Standard", "Size": 3, "Grade": 2},
                },
                {
                    "_Type_": "SCItemVehicleArmorParams",
                    "signalInfrared": 1.0,
                    "signalElectromagnetic": 1.0,
                    "signalCrossSection": 1.0,
                    "damageMultiplier": {
                        "_Type_": "SDamageInfo",
                        "DamagePhysical": 0.7,
                        "DamageEnergy": 0.5,
                    },
                },
            ],
        }
    }


def test_vehicle_armor_item_gets_stats(ex: CodexExtractor) -> None:
    r = ex.df.records[0]
    resolved = _vehicle_armor_resolved()
    comps = _components_of(resolved)
    attach = _attach_def(comps)
    atype = attach["Type"]

    obj = ex._project_item(r, resolved, comps, attach, atype)

    assert "stats" in obj
    armor = obj["stats"]["SCItemVehicleArmorParams"]
    assert armor["signalInfrared"] == 1.0
    assert armor["damageMultiplier.DamagePhysical"] == 0.7
    assert armor["damageMultiplier.DamageEnergy"] == 0.5


def test_atype_outside_char_armor_and_no_vehicle_armor_struct_stays_bare(
        ex: CodexExtractor) -> None:
    """Sanity: a non-armor item with an atype outside _ARMOR_TYPES and no
    SCItemVehicleArmorParams component still gets no stats (this is what
    test_non_armor_item_has_no_stats already pins for Char_Armor_*-adjacent
    types; this pins it for the vehicle-armor gate specifically)."""
    resolved = {
        "_RecordValue_": {
            "_Type_": "EntityClassDefinition",
            "Components": [
                {
                    "_Type_": "SAttachableComponentParams",
                    "AttachDef": {"Type": "PaintScheme"},
                },
            ],
        }
    }
    comps = _components_of(resolved)
    attach = _attach_def(comps)
    obj = ex._project_item(ex.df.records[0], resolved, comps, attach, "PaintScheme")
    assert "stats" not in obj


def test_vehicle_armor_item_gets_deflection_and_penetration(ex: CodexExtractor) -> None:
    """VERIFIED against the live `ARMR_CNOU_Nomad`: `armorDeflection.
    deflectionValue.*` and `armorPenetrationResistance.
    penetrationAbsorptionForType.*` are per-damage-type dicts nested one
    level deeper than the generic 1-level flatten reaches; a targeted
    post-step for THIS struct only projects them as dotted keys. The
    `basePenetrationReduction` scalar already survives the generic flatten
    (depth 1) and must keep working alongside the new depth-2 keys."""
    resolved = {
        "_RecordValue_": {
            "_Type_": "EntityClassDefinition",
            "Components": [
                {
                    "_Type_": "SAttachableComponentParams",
                    "AttachDef": {"Type": "Ship_Armor", "SubType": "Standard", "Size": 3, "Grade": 2},
                },
                {
                    "_Type_": "SCItemVehicleArmorParams",
                    "signalInfrared": 1.0,
                    "signalElectromagnetic": 1.0,
                    "signalCrossSection": 1.0,
                    "damageMultiplier": {
                        "_Type_": "SDamageInfo",
                        "DamagePhysical": 0.7,
                        "DamageEnergy": 0.5,
                    },
                    "armorPenetrationResistance": {
                        "_Type_": "SArmorPenetrationResistance",
                        "basePenetrationReduction": 0.2,
                        "penetrationAbsorptionForType": {
                            "_Type_": "SDamageInfo",
                            "DamagePhysical": 0.1,
                            "DamageEnergy": 0.05,
                        },
                    },
                    "armorDeflection": {
                        "_Type_": "SArmorDeflection",
                        "deflectionValue": {
                            "_Type_": "SDamageInfo",
                            "DamagePhysical": 10.0,
                            "DamageEnergy": 9.0,
                        },
                    },
                },
            ],
        }
    }
    comps = _components_of(resolved)
    attach = _attach_def(comps)
    atype = attach["Type"]

    obj = ex._project_item(ex.df.records[0], resolved, comps, attach, atype)

    armor = obj["stats"]["SCItemVehicleArmorParams"]
    # depth-1 fields keep working
    assert armor["damageMultiplier.DamagePhysical"] == 0.7
    assert armor["armorPenetrationResistance.basePenetrationReduction"] == 0.2
    # new depth-2 fields
    assert armor["armorPenetrationResistance.penetrationAbsorptionForType.DamagePhysical"] == 0.1
    assert armor["armorPenetrationResistance.penetrationAbsorptionForType.DamageEnergy"] == 0.05
    assert armor["armorDeflection.deflectionValue.DamagePhysical"] == 10.0
    assert armor["armorDeflection.deflectionValue.DamageEnergy"] == 9.0


def test_vehicle_armor_without_params_omits_stats(ex: CodexExtractor) -> None:
    resolved = {
        "_RecordValue_": {
            "_Type_": "EntityClassDefinition",
            "Components": [
                {
                    "_Type_": "SAttachableComponentParams",
                    "AttachDef": {"Type": "Ship_Armor"},
                },
            ],
        }
    }
    comps = _components_of(resolved)
    attach = _attach_def(comps)
    obj = ex._project_item(ex.df.records[0], resolved, comps, attach, "Ship_Armor")
    assert "stats" not in obj
