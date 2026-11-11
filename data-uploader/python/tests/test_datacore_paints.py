"""Liveries come from the DataCore, not from icon file names.

VERIFIED LIVE 4.10.2 (MISC_Starlancer_Max / _TAC, GRIN_ROC, AEGS_Idris_P): the
ship entity's `SGeometryResourceParams.Geometry` lists one SubGeometry per
livery whose `Tags` names the paint item's tag and whose `Material` is that
livery's .mtl (empty for tint-only liveries). The paint item carries the store
name. The old icon/file-name heuristic listed a TAC camo on the MAX, missed 6
of its 14 liveries, gave the TAC none and named rows "starlancer Starlancer
Beige Darkblue White".
"""

from __future__ import annotations

from sc_extract.dataforge_extract import CodexExtractor, _merge_paint_catalog, _paint_id


class _Rec:
    def __init__(self, name: str) -> None:
        self.name = name


class _DF:
    def __init__(self, paints: dict) -> None:
        self.paints = paints

    def records_by_type_name(self, _t):
        return [_Rec(f"EntityClassDefinition.{n}") for n in self.paints]

    def record_to_dict(self, rec, max_depth=4):
        cn = rec.name.split(".", 1)[1]
        return {"_RecordValue_": {"Components": [self.paints[cn]]}}


class _Loc:
    def __init__(self, table: dict) -> None:
        self.table = table

    def localized_text(self, key):
        v = self.table.get(key, key)
        return {"en": v, "de": v, "key": key}


def _paint(tag: str, name_key: str, ptype: str = "Paints") -> dict:
    return {"_Type_": "SAttachableComponentParams", "AttachDef": {
        "Type": ptype, "Tags": f"Paint_Starlancer @{tag}", "RequiredTags": "Paint_Starlancer",
        "Localization": {"Name": name_key, "Description": "@LOC_EMPTY"}}}


def _extractor() -> CodexExtractor:
    ex = CodexExtractor.__new__(CodexExtractor)
    ex.df = _DF({
        "Paint_Starlancer_Grey_White_Grey": _paint("Paint_Starlancer_Grey_White_Grey", "@n_updraft"),
        "Paint_Starlancer_GoblinG_A_Red_Black": _paint("Paint_Starlancer_GoblinG_A_Red_Black", "@n_arccorp"),
        "Paint_Starlancer_Template": _paint("Paint_Starlancer_Template", "@n_placeholder"),
    })
    ex.loc = _Loc({"@n_updraft": "Starlancer Updraft Livery",
                   "@n_arccorp": "Starlancer ArcCorp Livery",
                   "@n_placeholder": "<= PLACEHOLDER =>"})
    ex.on_log = lambda lvl, m: None
    return ex


def _geo(*subs) -> list:
    return [{"_Type_": "SGeometryResourceParams", "Geometry": {
        "Geometry": {"Geometry": {"path": "Objects/Spaceships/Ships/MISC/starlancer/exterior/misc_starlancer.cga"},
                     "Material": {"path": ""}},
        "SubGeometry": [{"Tags": t, "Geometry": {"Material": {"path": m}}} for t, m in subs]}}]


def test_liveries_are_read_from_the_ship_geometry_and_the_paint_items() -> None:
    ex = _extractor()
    out = ex._datacore_paints(_geo(
        ("Paint_Starlancer_Grey_White_Grey",
         "Objects\\Spaceships\\Ships\\MISC\\starlancer\\exterior\\misc_starlancer_ext_grey_white_grey.mtl"),
        ("Paint_Starlancer_GoblinG_A_Red_Black", ""),
        ("Paint_Starlancer_Template", ""),      # placeholder name -> dropped
        ("Paint_Unknown", "x.mtl"),             # no paint item -> dropped
    ))
    assert out["base_mtl"] is None
    assert [p["name"] for p in out["paints"]] == ["Starlancer Updraft Livery",
                                                    "Starlancer ArcCorp Livery"]
    assert out["paints"][0]["mtl"] == \
        "Data/Objects/Spaceships/Ships/MISC/starlancer/exterior/misc_starlancer_ext_grey_white_grey.mtl"
    assert out["paints"][1]["mtl"] is None
    assert out["paints"][0]["id"] == "starlancer_grey_white_grey"


def test_a_ship_without_livery_subgeometry_keeps_the_heuristics() -> None:
    ex = _extractor()
    assert ex._datacore_paints([{"_Type_": "SGeometryResourceParams",
                                 "Geometry": {"Geometry": {}}}]) is None


def test_merge_keeps_heuristic_ids_and_icons_and_drops_foreign_rows() -> None:
    cat = [
        {"id": "standard", "name": "starlancer (Standard)", "has_material": True, "icon": None},
        {"id": "starlancer_arccorp", "name": "Starlancer ArcCorp Livery",
         "icon": "Data/UI/x_Icon.dds", "has_material": False},
        {"id": "starlancer_tac_grey_grey_yellow_camo",
         "name": "starlancer Starlancer Tac Grey Grey Yellow Camo", "icon": "y.dds"},
    ]
    paints = [{"id": "starlancer_gobling_a_red_black", "name": "Starlancer ArcCorp Livery",
               "description": "", "mtl": None, "paintClass": "Paint_Starlancer_GoblinG_A_Red_Black"},
              {"id": "starlancer_grey_white_grey", "name": "Starlancer Updraft Livery",
               "description": "d", "mtl": "Data/a.mtl", "paintClass": "Paint_Starlancer_Grey_White_Grey"}]
    rows, build = _merge_paint_catalog(cat, paints)
    assert [r["id"] for r in rows] == ["standard", "starlancer_arccorp", "starlancer_grey_white_grey"]
    assert rows[1]["icon"] == "Data/UI/x_Icon.dds"
    # tint-only livery: buildable because the factory finish is
    assert rows[1]["has_material"] is True
    assert [b["mtl"] for b in build] == [None, "Data/a.mtl"]


def test_paint_id_slugs_the_class() -> None:
    assert _paint_id("Paint_ROC_Hadanite_Pink") == "roc_hadanite_pink"


def test_merge_lends_the_icon_of_an_unnamed_heuristic_row_by_id() -> None:
    cat = [{"id": "standard", "name": "x", "has_material": True},
           {"id": "starlancer_grey_white_grey", "name": "starlancer Starlancer Grey White Grey",
            "icon": "g.dds", "has_material": False}]
    rows, _ = _merge_paint_catalog(cat, [{"id": "starlancer_grey_white_grey",
                                          "name": "Starlancer Updraft Livery", "description": "",
                                          "mtl": None, "paintClass": "Paint_Starlancer_Grey_White_Grey"}])
    assert rows[1]["icon"] == "g.dds" and rows[1]["name"] == "Starlancer Updraft Livery"


def test_envelope_maps_cryengine_axes() -> None:
    from sc_extract.dataforge_extract import _envelope
    assert _envelope({"x": 127.0, "y": 243.0, "z": 57.5}) == {"length": 243.0, "width": 127.0, "height": 57.5}
    assert _envelope({"x": 0, "y": 1, "z": 1}) is None
    assert _envelope(None) is None
