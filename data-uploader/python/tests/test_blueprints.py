"""Tests for extract_blueprints() on CodexExtractor.

Uses a lightweight stub DataForge so the test runs without the 147 GB P4K.
The stub yields one CraftingBlueprintRecord with:
  - 2 ingredients: one resolvable (className resolved), one dangling GUID
  - a category ref (resolvable)
  - a GenericCraftingProcess_Dismantle with a TimeValue_Partitioned
  - an output item ref

Asserts:
  - JSON shape matches §6 BlueprintPayload contract
  - dangling ingredient kept with className=null
  - TimeValue_Partitioned normalizes to seconds correctly
  - counts bump to 1
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

import pytest

from sc_extract.dataforge_extract import CodexExtractor
from sc_extract.localization import Localizer


# ── Synthetic record GUIDs ────────────────────────────────────────────────────
BLUEPRINT_GUID = "aaaaaaaa-0000-0000-0000-000000000001"
CATEGORY_GUID  = "bbbbbbbb-0000-0000-0000-000000000002"
ITEM_A_GUID    = "cccccccc-0000-0000-0000-000000000003"  # resolvable ingredient
ITEM_DANGLING  = "dddddddd-0000-0000-0000-000000000004"  # dangling (no record)
OUTPUT_GUID    = "eeeeeeee-0000-0000-0000-000000000005"  # output item ref


def _make_record(name: str, type_name: str, guid: str) -> MagicMock:
    """Create a minimal Record mock."""
    r = MagicMock()
    r.name = name
    r.type = type_name
    r.guid = guid
    r.filename = f"libs/foundry/records/crafting/{name.lower()}.xml"
    r.tag = None
    return r


def _make_df(blueprint_rv: Dict[str, Any],
              resolvable_records: Dict[str, str]) -> MagicMock:
    """Build a stub DataForge that returns the given blueprint record value.

    resolvable_records: {guid: className} for records that record_by_id can find.
    """
    df = MagicMock()

    bp_record = _make_record(
        # Realistic, non-scaffolding className: _is_catalog_entity drops names
        # carrying dev/test tokens (a "TestItem" blueprint would be filtered out).
        "CraftingBlueprintRecord.BP_Iron_Plate_01",
        "CraftingBlueprintRecord",
        BLUEPRINT_GUID,
    )

    # records_by_type_name returns only the blueprint record
    def _rbt(type_name: str) -> List[Any]:
        if type_name == "CraftingBlueprintRecord":
            return [bp_record]
        return []

    df.records_by_type_name.side_effect = _rbt

    # record_to_dict returns the pre-built resolved dict
    df.record_to_dict.return_value = {
        "_RecordName_": bp_record.name,
        "_RecordId_": BLUEPRINT_GUID,
        "_RecordValue_": blueprint_rv,
    }

    # record_by_id resolves known GUIDs; returns None for dangling ones
    def _rbi(guid: str) -> Optional[MagicMock]:
        class_name = resolvable_records.get(guid)
        if class_name is None:
            return None
        rec = _make_record(f"EntityClassDefinition.{class_name}",
                           "EntityClassDefinition", guid)
        return rec

    df.record_by_id.side_effect = _rbi

    return df


# ── Test fixtures ─────────────────────────────────────────────────────────────

def _blueprint_rv() -> Dict[str, Any]:
    """Construct a realistic CraftingBlueprintRecord _RecordValue_ dict.

    Field names use the primary candidate from each _BP_* list so we also
    exercise the candidate-resolution logic. Tests that rely on fallback names
    are separate (see test_blueprint_candidate_fallback).
    """
    return {
        "_Type_": "CraftingBlueprintRecord",
        # Localization keys (candidate field: "name")
        "name": "@ui_blueprint_testitem_01_name",
        "description": "@ui_blueprint_testitem_01_desc",
        # Category ref (candidate field: "category")
        "category": {
            "_RecordId_": CATEGORY_GUID,
            "_RecordName_": "CraftingCategory.TestCategory",
        },
        # Output item ref (candidate field: "outputItem")
        "outputItem": {
            "_RecordId_": OUTPUT_GUID,
            "_RecordName_": "EntityClassDefinition.MISC_TestWidget",
        },
        # Output quantity (candidate field: "quantity")
        "quantity": 1,
        # Ingredients list (candidate field: "ingredients")
        "ingredients": [
            {
                # Resolvable ingredient (has both _RecordId_ and _RecordName_)
                "_RecordId_": ITEM_A_GUID,
                "_RecordName_": "EntityClassDefinition.MAT_IronIngot",
                "quantity": 5.0,
                "minQuality": 0.5,
            },
            {
                # Dangling GUID — no record in the DataForge for this one
                "_RecordId_": ITEM_DANGLING,
                "quantity": 2.0,
                "minQuality": None,
            },
        ],
        # processSpecificData: list with one verified dismantle process
        # TimeValue_Partitioned: VERIFIED field names (@days/@hours/@minutes/@seconds).
        # Total expected: 0*86400 + 1*3600 + 30*60 + 15 = 3600+1800+15 = 5415 s
        "processSpecificData": [
            {
                "_Type_": "GenericCraftingProcess_Dismantle",
                "@days": 0,
                "@hours": 1,
                "@minutes": 30,
                "@seconds": 15,
            }
        ],
    }


@pytest.fixture
def extractor(tmp_path: Path) -> CodexExtractor:
    rv = _blueprint_rv()
    df = _make_df(
        rv,
        resolvable_records={
            ITEM_A_GUID: "MAT_IronIngot",
            OUTPUT_GUID: "MISC_TestWidget",
            CATEGORY_GUID: "TestCategory",
        },
    )
    loc = Localizer({"en": {"ui_blueprint_testitem_01_name": "Test Blueprint",
                             "ui_blueprint_testitem_01_desc": "A test blueprint."},
                     "de": {"ui_blueprint_testitem_01_name": "Testblaupause",
                             "ui_blueprint_testitem_01_desc": "Eine Testblaupause."}})
    ex = CodexExtractor(
        df, loc, tmp_path,
        {"channel": "TEST", "patch": "0.0.0", "build": "0"},
        extract_assets=False,
    )
    return ex


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_extract_blueprints_creates_output_dir(extractor: CodexExtractor,
                                                tmp_path: Path) -> None:
    extractor.extract_blueprints()
    assert (tmp_path / "blueprints").is_dir()


def test_extract_blueprints_writes_one_json(extractor: CodexExtractor,
                                             tmp_path: Path) -> None:
    extractor.extract_blueprints()
    files = list((tmp_path / "blueprints").glob("*.json"))
    assert len(files) == 1, f"expected 1 blueprint file, got {len(files)}"


def test_blueprint_json_shape(extractor: CodexExtractor, tmp_path: Path) -> None:
    """§6 BlueprintPayload contract: required top-level keys must be present."""
    extractor.extract_blueprints()
    files = list((tmp_path / "blueprints").glob("*.json"))
    bp = json.loads(files[0].read_text(encoding="utf-8"))

    # Required top-level keys (§6)
    for key in ("className", "guid", "type", "recordTag", "name", "description",
                "entityKind", "category", "categoryLabel", "tier",
                "craftTimeSeconds", "dismantleTimeSeconds", "dismantleEfficiency",
                "ingredients", "outputs", "qualityRefs", "gameplayProperties",
                "poolClassName", "isDefault", "missionSource", "tags", "raw",
                "source"):
        assert key in bp, f"missing key '{key}' in blueprint JSON"
    assert bp["entityKind"] == "blueprint"


def test_blueprint_className(extractor: CodexExtractor, tmp_path: Path) -> None:
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    # _strip_type_prefix strips "CraftingBlueprintRecord." prefix
    assert bp["className"] == "BP_Iron_Plate_01"


def test_blueprint_guid(extractor: CodexExtractor, tmp_path: Path) -> None:
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    assert bp["guid"] == BLUEPRINT_GUID


def test_blueprint_localized_name(extractor: CodexExtractor, tmp_path: Path) -> None:
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    assert bp["name"]["en"] == "Test Blueprint"
    assert bp["name"]["de"] == "Testblaupause"
    assert bp["name"]["key"] == "@ui_blueprint_testitem_01_name"


def test_blueprint_localized_description(extractor: CodexExtractor,
                                          tmp_path: Path) -> None:
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    assert bp["description"]["en"] == "A test blueprint."


def test_blueprint_dismantle_time_seconds(extractor: CodexExtractor,
                                           tmp_path: Path) -> None:
    """TimeValue_Partitioned: 0d 1h 30m 15s == 5415 s (VERIFIED formula)."""
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    assert bp["dismantleTimeSeconds"] == pytest.approx(5415.0)


def test_blueprint_craft_time_null(extractor: CodexExtractor,
                                    tmp_path: Path) -> None:
    """No fabrication process in fixture -> craftTimeSeconds is null."""
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    assert bp["craftTimeSeconds"] is None


def test_blueprint_ingredients_count(extractor: CodexExtractor,
                                      tmp_path: Path) -> None:
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    assert len(bp["ingredients"]) == 2


def test_blueprint_resolvable_ingredient(extractor: CodexExtractor,
                                          tmp_path: Path) -> None:
    """Ingredient with known GUID resolves to className."""
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    ingr = next((i for i in bp["ingredients"] if i["guid"] == ITEM_A_GUID), None)
    assert ingr is not None
    assert ingr["className"] == "MAT_IronIngot"
    assert ingr["quantity"] == pytest.approx(5.0)
    assert ingr["minQuality"] == pytest.approx(0.5)


def test_blueprint_dangling_ingredient_kept(extractor: CodexExtractor,
                                             tmp_path: Path) -> None:
    """Dangling GUID must be kept (not dropped) with className=null (§4)."""
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    dangling = next((i for i in bp["ingredients"] if i["guid"] == ITEM_DANGLING), None)
    assert dangling is not None, "dangling ingredient was dropped — violates §4"
    assert dangling["className"] is None, "dangling ingredient should have className=null"
    assert dangling["quantity"] == pytest.approx(2.0)


def test_blueprint_mission_source_null(extractor: CodexExtractor,
                                        tmp_path: Path) -> None:
    """missionSource always null in v1 (R5)."""
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    assert bp["missionSource"] is None


def test_blueprint_count_bumped(extractor: CodexExtractor,
                                 tmp_path: Path) -> None:
    extractor.extract_blueprints()
    assert extractor.counts.get("blueprints") == 1


def test_blueprint_outputs_shape(extractor: CodexExtractor,
                                  tmp_path: Path) -> None:
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    outs = bp["outputs"]
    assert isinstance(outs, list) and len(outs) == 1
    assert outs[0]["className"] == "MISC_TestWidget"
    assert "guid" in outs[0]
    assert outs[0]["quantity"] == pytest.approx(1.0)


def test_blueprint_source_field(extractor: CodexExtractor,
                                 tmp_path: Path) -> None:
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    assert bp["source"]["channel"] == "TEST"


def test_blueprint_category_resolved(extractor: CodexExtractor,
                                      tmp_path: Path) -> None:
    extractor.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    # Category is now a className string (§6); the localized label is separate
    assert bp["category"] == "TestCategory"


def test_blueprint_time_normalization_days() -> None:
    """Standalone normalization check: 1d 0h 0m 0s == 86400 s."""
    from sc_extract.dataforge_extract import _find_first_dict_with, _to_float

    # Re-use the helper the extractor uses directly
    node = {"@days": 1, "@hours": 0, "@minutes": 0, "@seconds": 0}
    tv = _find_first_dict_with(
        node, ("@days", "days", "@hours", "hours", "@minutes", "minutes",
               "@seconds", "seconds"))
    assert tv is not None

    def pick(d, fields):
        for f in fields:
            v = d.get(f)
            if v is not None:
                return v
        return None

    total = (
        (_to_float(pick(tv, ("@days", "days", "Days"))) or 0.0) * 86400
        + (_to_float(pick(tv, ("@hours", "hours", "Hours"))) or 0.0) * 3600
        + (_to_float(pick(tv, ("@minutes", "minutes", "Minutes"))) or 0.0) * 60
        + (_to_float(pick(tv, ("@seconds", "seconds", "Seconds"))) or 0.0)
    )
    assert total == pytest.approx(86400.0)


def test_blueprint_candidate_fallback(tmp_path: Path) -> None:
    """Secondary candidate field names also resolve correctly.

    This covers the R1 risk: if live data uses 'resources' instead of
    'ingredients', the fallback should still find the list.
    """
    # Build a blueprint using 'resources' (2nd candidate) instead of 'ingredients'
    rv = {
        "_Type_": "CraftingBlueprintRecord",
        "name": "@test_name",
        "resources": [  # 2nd candidate in _BP_INGREDIENTS_FIELDS
            {
                "_RecordId_": ITEM_A_GUID,
                "_RecordName_": "EntityClassDefinition.MAT_IronIngot",
                "quantity": 3.0,
            }
        ],
    }
    df = _make_df(rv, {ITEM_A_GUID: "MAT_IronIngot"})
    ex = CodexExtractor(
        df, Localizer.empty(), tmp_path,
        {"channel": "TEST", "patch": "0", "build": "0"},
        extract_assets=False,
    )
    ex.extract_blueprints()
    bp = json.loads(list((tmp_path / "blueprints").glob("*.json"))[0].read_text())
    assert len(bp["ingredients"]) == 1
    assert bp["ingredients"][0]["className"] == "MAT_IronIngot"
    assert bp["ingredients"][0]["quantity"] == pytest.approx(3.0)
