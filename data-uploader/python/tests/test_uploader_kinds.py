"""Uploader coverage widening: silhouettes for every item + ammunition, the
UNDEFINED placeholder -> null rule, armor/clothing asset packages.

Synthetic records only (the DataForge is a stub) — no game P4K needed.
"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from sc_extract.assets3d import manifest as mf
from sc_extract.assets3d.armor import ARMOR_DIR, is_armor_record, is_armor_type
from sc_extract.dataforge import DataForge
from sc_extract.dataforge_extract import CodexExtractor, _undefined_to_none
from sc_extract.localization import Localizer
from sc_extract.ship_discovery import ShipDiscovery, ref_from_hull

from dcb_builder import build_minimal_v8

MESH = {"Geometry": {"Geometry": {"Geometry": {"path": "objects/thing/thing.cgf"}}}}


@pytest.fixture()
def ex(tmp_path) -> CodexExtractor:
    df = DataForge(build_minimal_v8())
    return CodexExtractor(df, Localizer.empty(), tmp_path,
                          {"channel": "TEST", "patch": "0", "build": "0"})


def _rec(name: str, filename: str = "libs/foundry/records/entities/scitem/x/y.xml"):
    return SimpleNamespace(name=name, filename=filename, guid="g-" + name, type="T", tag="")


def _stub_df(records: dict, resolved: dict):
    return SimpleNamespace(
        records_by_type_name=lambda t: records.get(t, []),
        record_to_dict=lambda r, max_depth=0: resolved[r.name],
    )


def _entity(atype: str, subtype: str = "Medium", with_mesh: bool = True) -> dict:
    comps = [{"_Type_": "SAttachableComponentParams",
              "AttachDef": {"Type": atype, "SubType": subtype, "Size": 1, "Grade": 1}}]
    if with_mesh:
        comps.append({"_Type_": "SGeometryResourceParams", **MESH})
    return {"_RecordValue_": {"_Type_": "EntityClassDefinition", "Components": comps}}


def test_undefined_to_none():
    assert _undefined_to_none("UNDEFINED") is None
    assert _undefined_to_none(" undefined ") is None
    assert _undefined_to_none("Medium") == "Medium"
    assert _undefined_to_none(None) is None
    assert _undefined_to_none(3) == 3


def test_projection_nulls_undefined_type_and_subtype(ex):
    resolved = _entity("UNDEFINED", "UNDEFINED")
    from sc_extract.dataforge_extract import _attach_def, _components_of
    comps = _components_of(resolved)
    attach = _attach_def(comps)
    obj = ex._project_item(_rec("EntityClassDefinition.Thing"), resolved, comps, attach,
                           attach["Type"])
    assert obj["subType"] is None
    assert obj["attachType"] is None
    comp = ex._project_component(_rec("EntityClassDefinition.Thing"), resolved, comps, attach,
                                 attach["Type"])
    assert comp["subType"] is None and comp["attachType"] is None


def test_every_item_with_a_mesh_gets_a_silhouette_candidate(ex):
    """Not only armor: a plain tool/consumable item is listed too, as kind `item`."""
    recs = [_rec("EntityClassDefinition.Medpen_Tool"), _rec("EntityClassDefinition.Torso_Armor"),
            _rec("EntityClassDefinition.No_Mesh_Item")]
    resolved = {
        recs[0].name: _entity("Gadget"),
        recs[1].name: _entity("Char_Armor_Torso"),
        recs[2].name: _entity("Gadget", with_mesh=False),
    }
    ex.df = _stub_df({"EntityClassDefinition": recs}, resolved)
    ex.extract_entities()
    got = {(c["kind"], c["class_name"]) for c in ex._silhouette_candidates}
    assert got == {("item", "Medpen_Tool"), ("item", "Torso_Armor")}


def test_ammunition_with_geometry_gets_an_ammo_candidate_without_is_skipped(ex):
    recs = [_rec("AmmoParams.bullet_with_mesh"), _rec("AmmoParams.bullet_pure_physics")]
    resolved = {
        recs[0].name: {"_RecordValue_": {"speed": 1, "projectile": {"mesh": {"path": "objects/ammo/shell.cgf"}}}},
        recs[1].name: {"_RecordValue_": {"speed": 1}},
    }
    ex.df = _stub_df({"AmmoParams": recs}, resolved)
    ex.extract_ammunition()  # must not raise for the mesh-less round
    assert [(c["kind"], c["class_name"]) for c in ex._silhouette_candidates] == [
        ("ammo", "bullet_with_mesh")]
    assert (ex.out / "ammunition" / "bullet_pure_physics.json").exists()
    ex._write_silhouette_manifest()
    manifest = json.loads((ex.out / "silhouettes" / "_build_manifest.json").read_text("utf-8"))
    assert manifest["entities"][0]["mesh"].lower().endswith("shell.cgf")


# ---- ground vehicle hulls ---------------------------------------------------------
def test_ref_from_hull_accepts_ground_vehicle_roots():
    ref = ref_from_hull("TMBL_Cyclone", "Data/Objects/GroundVehicles/TMBL/Cyclone/TMBL_Cyclone.cga")
    assert ref is not None
    assert (ref.mfr, ref.ship, ref.series_token) == ("TMBL", "Cyclone", "Cyclone")
    assert ref.root == "Data/Objects/GroundVehicles"
    ship = ref_from_hull("DRAK_Cutlass_Black",
                         "Data/Objects/Spaceships/Ships/DRAK/Cutlass/DRAK_Cutlass_Black.cga")
    assert ship is not None and ship.root == "Data/Objects/Spaceships/Ships"


def test_find_hull_follows_the_ref_root():
    class Info:
        def __init__(self, fn, size=1):
            self.filename, self.file_size = fn, size

    base = "Data/Objects/GroundVehicles/TMBL/Cyclone"
    disco = ShipDiscovery(SimpleNamespace(
        infolist=lambda: [Info(f"{base}/TMBL_Cyclone.cga"), Info(f"{base}/mat/TMBL_Cyclone.mtl")]))
    ref = ref_from_hull("TMBL_Cyclone", f"{base}/TMBL_Cyclone.cga")
    assert disco.find_hull(ref) == f"{base}/TMBL_Cyclone.cga"
    disco.build_index()
    assert disco._mtls_index["tmbl/cyclone"]


# ---- armor packages ---------------------------------------------------------------
def test_armor_kind_is_a_valid_manifest_kind():
    assert "armor" in mf.KINDS
    schema_path = Path(mf.__file__).with_name("manifest.schema.json")
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    assert "armor" in schema["properties"]["kind"]["enum"]


def test_armor_type_and_record_rules():
    assert is_armor_type("Char_Armor_Helmet")
    assert is_armor_type("Char_Clothing_Hat")
    assert not is_armor_type("WeaponPersonal")
    assert not is_armor_type(None)
    assert is_armor_record("libs/foundry/records/entities/scitem/characters/x/rsi_helmet.xml",
                           "RSI_Helmet_01")
    assert not is_armor_record("libs/foundry/records/entities/scitem/ships/x/y.xml", "RSI_Helmet_01")
    assert not is_armor_record("libs/foundry/records/entities/scitem/weapons/x/y.xml", "Gun")
    assert ARMOR_DIR == "_armor"


def test_armor_classes_filters_by_type_and_geometry():
    from sc_extract.assets3d.armor import armor_classes
    from sc_extract.assets3d.entity import EntityDef

    def ent(cls, itype, geo):
        return EntityDef(class_name=cls, guid="g", item_type=itype, geometry_path=geo,
                         material_path=None, ports=[])

    dirs = "libs/foundry/records/entities/scitem/characters/"
    recs = {
        "EntityClassDefinition.Helm_A": SimpleNamespace(name="EntityClassDefinition.Helm_A", filename=dirs + "a.xml"),
        "EntityClassDefinition.Hat_B": SimpleNamespace(name="EntityClassDefinition.Hat_B", filename=dirs + "b.xml"),
        "EntityClassDefinition.Gun_C": SimpleNamespace(name="EntityClassDefinition.Gun_C", filename=dirs + "c.xml"),
        "EntityClassDefinition.Helm_NoMesh": SimpleNamespace(name="EntityClassDefinition.Helm_NoMesh", filename=dirs + "d.xml"),
    }
    ents = {"Helm_A": ent("Helm_A", "Char_Armor_Helmet", "Data/a.cdf"),
            "Hat_B": ent("Hat_B", "Char_Clothing_Hat", "Data/b.cgf"),
            "Gun_C": ent("Gun_C", "WeaponPersonal", "Data/c.cdf"),
            "Helm_NoMesh": ent("Helm_NoMesh", "Char_Armor_Helmet", "Data/missing.cdf")}
    source = SimpleNamespace(
        base=SimpleNamespace(_by_name=recs),
        weapon=lambda c: ents.get(c),
        reader=SimpleNamespace(exists=lambda p: "missing" not in p),
    )
    assert armor_classes(source) == ["Hat_B", "Helm_A"]
