"""extract_blueprints() against the VERIFIED live CraftingBlueprintRecord shape.

``test_blueprints.py`` covers the older hypothesis-driven candidate fields (kept
as a fallback). This module pins the shape actually observed in a live
``Data/Game2.dcb`` (SC 4.x LIVE), where a blueprint nests EVERYTHING under a
single ``blueprint`` node:

    CraftingBlueprintRecord
      blueprint (CraftingBlueprint)
        category            -> ref BlueprintCategoryRecord.FPSArmours | FPSWeapons | ...
        blueprintName       -> loc key
        processSpecificData (CraftingProcess_Creation)
          entityClass       -> ref EntityClassDefinition.<crafted item>
        tiers[] (CraftingBlueprintTier)
          recipe (CraftingRecipe)
            costs (CraftingRecipeCosts)
              craftTime     -> TimeValue_Partitioned (BARE days/hours/minutes/seconds)
              mandatoryCost -> CraftingCost_Select tree whose leaves are
                               CraftingCost_Resource { resource, quantity, minQuality }

Reading the record top level only — which is what the code did before — left
category, outputs and ingredients null for every one of the 1 598 live
blueprints, so the FPS codex could never answer "what does this cost to craft".
The fixture below is a trimmed copy of
``CraftingBlueprintRecord.BP_CRAFT_cds_undersuit_helmet_01_01_01``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

import pytest

from sc_extract.dataforge_extract import CodexExtractor
from sc_extract.localization import Localizer

BP_GUID = "11111111-0000-0000-0000-000000000001"
CATEGORY_GUID = "cce046cc-267e-35b0-f32e-fe710225eca3"
OUTPUT_GUID = "a35b4317-bc89-9a26-727e-5d284aecfdad"
SILICON_GUID = "a6e149b3-3197-7bbd-40ce-f8f47e0b95a4"
TUNGSTEN_GUID = "a6e149b3-3197-7bbd-40ce-f8f47e0b95a5"


def _verified_rv() -> Dict[str, Any]:
    return {
        "_Type_": "CraftingBlueprintRecord",
        "blueprint": {
            "_Type_": "CraftingBlueprint",
            "category": {
                "_RecordId_": CATEGORY_GUID,
                "_RecordName_": "BlueprintCategoryRecord.FPSArmours",
            },
            "blueprintName": "@LOC_PLACEHOLDER",
            "processSpecificData": {
                "_Type_": "CraftingProcess_Creation",
                "entityClass": {
                    "_RecordId_": OUTPUT_GUID,
                    "_RecordName_": "EntityClassDefinition.cds_undersuit_helmet_01_01_01",
                },
            },
            "tiers": [
                {
                    "_Type_": "CraftingBlueprintTier",
                    "recipe": {
                        "_Type_": "CraftingRecipe",
                        "costs": {
                            "_Type_": "CraftingRecipeCosts",
                            "craftTime": {
                                "_Type_": "TimeValue_Partitioned",
                                # BARE names — no '@' prefix — 1 min 30 s = 90 s
                                "days": 0, "hours": 0, "minutes": 1, "seconds": 30.0,
                            },
                            "mandatoryCost": {
                                "_Type_": "CraftingCost_Select",
                                "nameInfo": {"debugName": "ASPECTS",
                                             "displayName": "@LOC_PLACEHOLDER"},
                                "count": 1,
                                "options": [
                                    {
                                        "_Type_": "CraftingCost_Select",
                                        "nameInfo": {
                                            "debugName": "SUIT UNDERLAY",
                                            "displayName": "@crafting_ui_slotname_suitunderlay",
                                        },
                                        "count": 1,
                                        "options": [
                                            {
                                                "_Type_": "CraftingCost_Resource",
                                                "resource": {
                                                    "_RecordId_": SILICON_GUID,
                                                    "_RecordName_": "ResourceType.Silicon",
                                                },
                                                "quantity": {
                                                    "_Type_": "SStandardCargoUnit",
                                                    "standardCargoUnits": 0.03,
                                                },
                                                "minQuality": 0,
                                            },
                                        ],
                                    },
                                ],
                            },
                            "optionalCosts": [
                                {
                                    "_Type_": "CraftingCost_Select",
                                    "nameInfo": {"debugName": "PLATING"},
                                    "options": [
                                        {
                                            "_Type_": "CraftingCost_Resource",
                                            "resource": {
                                                "_RecordId_": TUNGSTEN_GUID,
                                                "_RecordName_": "ResourceType.Tungsten",
                                            },
                                            "quantity": {
                                                "_Type_": "SMicroCargoUnit",
                                                "microSCU": 20000,
                                            },
                                            "minQuality": 250,
                                        },
                                    ],
                                },
                            ],
                        },
                        "results": None,
                    },
                },
            ],
        },
    }


@pytest.fixture
def extractor(tmp_path: Path) -> CodexExtractor:
    record = MagicMock()
    record.name = "CraftingBlueprintRecord.BP_CRAFT_cds_undersuit_helmet_01_01_01"
    record.type = "CraftingBlueprintRecord"
    record.guid = BP_GUID
    record.filename = "libs/foundry/records/crafting/blueprints/bp_craft.xml"
    record.tag = None

    df = MagicMock()
    df.records_by_type_name.side_effect = (
        lambda t: [record] if t == "CraftingBlueprintRecord" else []
    )
    df.record_to_dict.return_value = {"_RecordValue_": _verified_rv()}
    df.record_by_id.side_effect = lambda guid: None

    return CodexExtractor(
        df, Localizer({"en": {}, "de": {}}), tmp_path,
        {"channel": "TEST", "patch": "0.0.0", "build": "0"},
        extract_assets=False,
    )


def _payload(tmp_path: Path) -> Dict[str, Any]:
    files: List[Path] = list((tmp_path / "blueprints").glob("*.json"))
    assert len(files) == 1
    return json.loads(files[0].read_text(encoding="utf-8"))


def test_category_resolves_from_the_nested_blueprint_node(
    extractor: CodexExtractor, tmp_path: Path,
) -> None:
    extractor.extract_blueprints()
    assert _payload(tmp_path)["category"] == "FPSArmours"


def test_output_class_resolves_from_creation_process(
    extractor: CodexExtractor, tmp_path: Path,
) -> None:
    """`processSpecificData.entityClass` is the crafted item — the key the
    detail view uses to answer 'how do I craft this?'."""
    extractor.extract_blueprints()
    outputs = _payload(tmp_path)["outputs"]
    assert len(outputs) == 1
    assert outputs[0]["className"] == "cds_undersuit_helmet_01_01_01"
    assert outputs[0]["guid"] == OUTPUT_GUID


def test_craft_time_reads_bare_time_fields(
    extractor: CodexExtractor, tmp_path: Path,
) -> None:
    extractor.extract_blueprints()
    bp = _payload(tmp_path)
    assert bp["craftTimeSeconds"] == pytest.approx(90.0)
    assert bp["dismantleTimeSeconds"] is None


def test_ingredients_walk_the_cost_tree(
    extractor: CodexExtractor, tmp_path: Path,
) -> None:
    extractor.extract_blueprints()
    ings = _payload(tmp_path)["ingredients"]
    by_name = {i["className"]: i for i in ings}
    assert set(by_name) == {"Silicon", "Tungsten"}

    silicon = by_name["Silicon"]
    assert silicon["quantity"] == pytest.approx(0.03)
    assert silicon["minQuality"] == pytest.approx(0)
    # role carries the recipe slot label, taken from the enclosing select node
    assert silicon["role"] == "SUIT UNDERLAY"

    # microSCU quantities are normalized to SCU like the standard-unit ones
    tungsten = by_name["Tungsten"]
    assert tungsten["quantity"] == pytest.approx(0.02)
    assert tungsten["role"] == "PLATING"


def test_dismantle_blueprint_still_resolves(tmp_path: Path) -> None:
    """The global dismantle record uses GenericCraftingBlueprint with the
    process inline — efficiency + time must survive the nesting change."""
    record = MagicMock()
    record.name = "CraftingBlueprintRecord.GlobalGenericDismantle"
    record.type = "CraftingBlueprintRecord"
    record.guid = BP_GUID
    record.filename = "libs/foundry/records/crafting/global.xml"
    record.tag = None

    df = MagicMock()
    df.records_by_type_name.side_effect = (
        lambda t: [record] if t == "CraftingBlueprintRecord" else []
    )
    df.record_to_dict.return_value = {"_RecordValue_": {
        "_Type_": "CraftingBlueprintRecord",
        "blueprint": {
            "_Type_": "GenericCraftingBlueprint",
            "processSpecificData": {
                "_Type_": "GenericCraftingProcess_Dismantle",
                "efficiency": 0.5,
                "dismantleTime": {"_Type_": "TimeValue_Partitioned",
                                  "days": 0, "hours": 0, "minutes": 0,
                                  "seconds": 15.0},
            },
        },
    }}
    df.record_by_id.side_effect = lambda guid: None

    ex = CodexExtractor(
        df, Localizer({"en": {}, "de": {}}), tmp_path,
        {"channel": "TEST", "patch": "0.0.0", "build": "0"},
        extract_assets=False,
    )
    ex.extract_blueprints()
    bp = _payload(tmp_path)
    assert bp["dismantleTimeSeconds"] == pytest.approx(15.0)
    assert bp["dismantleEfficiency"] == pytest.approx(0.5)
    assert bp["ingredients"] == []


def _extract_dismantle(tmp_path: Path, process: Dict[str, Any]) -> Dict[str, Any]:
    record = MagicMock()
    record.name = "CraftingBlueprintRecord.DismantleYieldProbe"
    record.type = "CraftingBlueprintRecord"
    record.guid = BP_GUID
    record.filename = "libs/foundry/records/crafting/probe.xml"
    record.tag = None
    df = MagicMock()
    df.records_by_type_name.side_effect = (
        lambda t: [record] if t == "CraftingBlueprintRecord" else []
    )
    df.record_to_dict.return_value = {"_RecordValue_": {
        "_Type_": "CraftingBlueprintRecord",
        "blueprint": {"_Type_": "GenericCraftingBlueprint",
                      "processSpecificData": process},
    }}
    df.record_by_id.side_effect = lambda guid: None
    CodexExtractor(
        df, Localizer({"en": {}, "de": {}}), tmp_path,
        {"channel": "TEST", "patch": "0.0.0", "build": "0"},
        extract_assets=False,
    ).extract_blueprints()
    return _payload(tmp_path)


def test_dismantle_yield_unknown_when_record_has_no_yield_field(tmp_path: Path) -> None:
    """Absent record field => None (unknown), never [] and never dismantlable=False."""
    bp = _extract_dismantle(tmp_path, {
        "_Type_": "GenericCraftingProcess_Dismantle", "efficiency": 0.5,
        "dismantleTime": {"_Type_": "TimeValue_Partitioned", "seconds": 15.0},
    })
    assert bp["dismantleYield"] is None
    assert bp["dismantlable"] is None


def test_dismantle_yield_reads_material_and_amount(tmp_path: Path) -> None:
    bp = _extract_dismantle(tmp_path, {
        "_Type_": "GenericCraftingProcess_Dismantle", "efficiency": 0.5,
        "dismantlable": True,
        "outputs": [
            {"material": {"_RecordName_": "EntityClassDefinition.MAT_Iron",
                          "_RecordId_": "11111111-1111-1111-1111-111111111111"},
             "quantity": 2.5},
            {"material": {"_RecordName_": "EntityClassDefinition.MAT_Tungsten"},
             "amount": 1},
            {"material": {"_RecordName_": "EntityClassDefinition.MAT_Broken"}},
        ],
    })
    assert bp["dismantleYield"] == [
        {"material": "MAT_Iron", "amount": 2.5},
        {"material": "MAT_Tungsten", "amount": 1.0},
    ]
    assert bp["dismantlable"] is True


def test_dismantlable_false_only_from_explicit_flag(tmp_path: Path) -> None:
    bp = _extract_dismantle(tmp_path, {
        "_Type_": "GenericCraftingProcess_Dismantle", "canDismantle": False,
    })
    assert bp["dismantlable"] is False
    assert bp["dismantleYield"] is None
