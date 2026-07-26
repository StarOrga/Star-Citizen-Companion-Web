"""Tests for the personal FPS armor / undersuit stat projection.

Issue #253: armor pieces (AttachDef.Type in Char_Armor_*) must carry a generic
`stats` block sourced from _component_stats() — the same struct-name-keyed
scalar dump ship components use, with zero per-field foreknowledge.

These exercise _project_item directly against synthetic resolved-record dicts
(built with the same shape record_to_dict emits) so no game P4K is needed. The
real Record shell comes from the minimal synthetic DCB.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from sc_extract.dataforge import DataForge
from sc_extract.localization import Localizer
from sc_extract.dataforge_extract import (
    CodexExtractor,
    _components_of,
    _attach_def,
    _ARMOR_TYPES,
)

from dcb_builder import build_minimal_v8


@pytest.fixture(scope="module")
def ex(tmp_path_factory: pytest.TempPathFactory) -> CodexExtractor:
    df = DataForge(build_minimal_v8())
    out = tmp_path_factory.mktemp("armor_out")
    return CodexExtractor(df, Localizer.empty(), out,
                          {"channel": "TEST", "patch": "0", "build": "0"})


def _armor_resolved(atype: str = "Char_Armor_Torso") -> dict:
    """A resolved record for one armor piece: an AttachDef of `atype` plus an
    SCItemSuitArmorParams component carrying a couple of made-up scalars and one
    nested sub-struct (to prove the one-level flatten)."""
    return {
        "_RecordValue_": {
            "_Type_": "EntityClassDefinition",
            "Components": [
                {
                    "_Type_": "SAttachableComponentParams",
                    "AttachDef": {
                        "Type": atype,
                        "SubType": "Medium",
                        "Size": 2,
                        "Grade": 1,
                    },
                },
                {
                    "_Type_": "SCItemSuitArmorParams",
                    "TemperatureResistanceMin": -40.0,
                    "TemperatureResistanceMax": 120.0,
                    "DamageReduction": 0.35,
                    # nested one level deep — flattened as "Resistances.Physical"
                    "Resistances": {
                        "_Type_": "SArmorResistance",
                        "Physical": 0.5,
                    },
                },
            ],
        }
    }


def test_armor_types_cover_all_six() -> None:
    assert _ARMOR_TYPES == {
        "Char_Armor_Helmet", "Char_Armor_Torso", "Char_Armor_Arms",
        "Char_Armor_Legs", "Char_Armor_Undersuit", "Char_Armor_Backpack",
    }


def test_project_item_attaches_armor_stats(ex: CodexExtractor) -> None:
    r = ex.df.records[0]
    resolved = _armor_resolved()
    comps = _components_of(resolved)
    attach = _attach_def(comps)
    atype = attach["Type"]

    obj = ex._project_item(r, resolved, comps, attach, atype)

    assert obj["entityKind"] == "item"
    assert obj["attachType"] == "Char_Armor_Torso"
    assert obj["subType"] == "Medium"
    assert obj["size"] == 2
    # generic stat block keyed by the live struct name
    assert "stats" in obj
    armor = obj["stats"]["SCItemSuitArmorParams"]
    assert armor["TemperatureResistanceMin"] == -40.0
    assert armor["TemperatureResistanceMax"] == 120.0
    assert armor["DamageReduction"] == 0.35
    # one nested level is flattened as "Sub.field"
    assert armor["Resistances.Physical"] == 0.5


def test_all_armor_attach_types_get_stats(ex: CodexExtractor) -> None:
    r = ex.df.records[0]
    for atype in _ARMOR_TYPES:
        resolved = _armor_resolved(atype)
        comps = _components_of(resolved)
        attach = _attach_def(comps)
        obj = ex._project_item(r, resolved, comps, attach, atype)
        assert obj["stats"]["SCItemSuitArmorParams"]["DamageReduction"] == 0.35, atype


def test_non_armor_item_has_no_stats(ex: CodexExtractor) -> None:
    """A generic (non-armor) attachable item must NOT gain a stats block, even
    when it carries an SCItem*Params component."""
    resolved = _armor_resolved("Char_Clothing_Hat")  # not an armor type
    comps = _components_of(resolved)
    attach = _attach_def(comps)
    obj = ex._project_item(ex.df.records[0], resolved, comps, attach, attach["Type"])
    assert "stats" not in obj


def test_armor_without_params_omits_stats(ex: CodexExtractor) -> None:
    """An armor piece whose only components carry no scalar params gets no empty
    stats map (dropped when nothing meaningful to show)."""
    resolved = {
        "_RecordValue_": {
            "_Type_": "EntityClassDefinition",
            "Components": [
                {
                    "_Type_": "SAttachableComponentParams",
                    "AttachDef": {"Type": "Char_Armor_Helmet"},
                },
            ],
        }
    }
    comps = _components_of(resolved)
    attach = _attach_def(comps)
    obj = ex._project_item(ex.df.records[0], resolved, comps, attach, "Char_Armor_Helmet")
    assert "stats" not in obj
