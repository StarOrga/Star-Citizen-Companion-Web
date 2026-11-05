"""Missiles keep their flight and warhead numbers (feedback e7b6a2a1).

Values below are the REAL ones of MISL_S02_IR_NOVP_Rattler, probed on LIVE.
`SCItemMissileParams` has no resource network, so `_project_item()` dropped it,
and its warhead and turn rates sit deeper than the depth-2 flatten reaches.
"""

from __future__ import annotations

import pytest

from sc_extract.dataforge import DataForge
from sc_extract.localization import Localizer
from sc_extract.dataforge_extract import CodexExtractor, _attach_def, _components_of

from dcb_builder import build_minimal_v8


@pytest.fixture(scope="module")
def ex(tmp_path_factory: pytest.TempPathFactory) -> CodexExtractor:
    out = tmp_path_factory.mktemp("missile_out")
    return CodexExtractor(DataForge(build_minimal_v8()), Localizer.empty(), out,
                          {"channel": "TEST", "patch": "0", "build": "0"})


def _project(ex: CodexExtractor, params: dict) -> dict:
    resolved = {"_RecordValue_": {"_Type_": "EntityClassDefinition", "Components": [
        {"_Type_": "SAttachableComponentParams",
         "AttachDef": {"Type": "Missile", "SubType": "Missile", "Size": 2, "Grade": 1}},
        {"_Type_": "SCItemMissileParams", **params},
    ]}}
    comps = _components_of(resolved)
    attach = _attach_def(comps)
    return ex._project_item(ex.df.records[0], resolved, comps, attach, attach["Type"])


RATTLER = {
    "maxLifetime": 10,
    "armTime": 1.25,
    "explosionParams": {
        "_Type_": "ExplosionParams",
        "maxRadius": 6,
        "damage": {"_Type_": "DamageInfo", "DamagePhysical": 1370, "DamageEnergy": 0},
    },
    "GCSParams": {
        "_Type_": "SGuidanceAndControlParams",
        "linearSpeed": 1029,
        "boostPhase": {"_Type_": "SGuidanceAndControlPhaseParams", "angularSpeed": 200},
        "interceptPhase": {"_Type_": "SGuidanceAndControlPhaseParams", "angularSpeed": 450},
        "terminalPhase": {"_Type_": "SGuidanceAndControlPhaseParams", "angularSpeed": 500},
    },
    "targetingParams": {"_Type_": "STargetingParams", "lockTime": 0.8, "lockRangeMax": 5000,
                        "lockingAngle": 45},
}


def test_missile_keeps_the_keys_the_web_page_reads(ex: CodexExtractor) -> None:
    stats = _project(ex, RATTLER)["stats"]["SCItemMissileParams"]
    assert stats["GCSParams.linearSpeed"] == 1029
    assert stats["GCSParams.interceptPhase.angularSpeed"] == 450
    assert stats["targetingParams.lockRangeMax"] == 5000
    assert stats["targetingParams.lockTime"] == 0.8
    assert stats["targetingParams.lockingAngle"] == 45
    assert stats["maxLifetime"] == 10
    assert stats["armTime"] == 1.25
    assert stats["explosionParams.maxRadius"] == 6
    assert stats["explosionParams.damage.DamagePhysical"] == 1370


def test_a_missing_struct_stays_absent_never_zero(ex: CodexExtractor) -> None:
    stats = _project(ex, {"maxLifetime": 10})["stats"]["SCItemMissileParams"]
    assert stats == {"maxLifetime": 10}
