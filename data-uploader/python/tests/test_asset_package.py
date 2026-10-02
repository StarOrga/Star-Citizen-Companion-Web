"""Generic 3D asset package: resolve -> enrich -> manifest, without a P4K.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest tests/test_asset_package.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from sc_extract import glb_materials
from sc_extract.assets3d import manifest as mf
from sc_extract.assets3d.enrich import enrich, group_of
from sc_extract.assets3d.entity import EntityDef, LoadoutEntry, PortDef, resolve_entity
from sc_extract.assets3d.package import build_manifest, check_locators
from sc_extract.assets3d.parts import PartRef, PartStore, glb_bounds
from sc_extract.assets3d.transforms import (cry_point_to_gltf, cry_to_gltf, from_pos_quat,
                                            to_pos_quat)

SHA_GUN = "a" * 64
SHA_MOUNT = "b" * 64
SHA_MSL = "c" * 64
QZ90 = [0.0, 0.0, math.sqrt(0.5), math.sqrt(0.5)]  # +90 deg about CryEngine Z (up)


class FakeSource:
    def __init__(self, entities, helpers):
        self.entities, self._helpers = entities, helpers

    def entity(self, name):
        return self.entities.get(name)

    def helpers(self, path):
        return self._helpers.get(path, {})


def h(pos, rot=None):
    return {"position": pos, "rotation": rot or [0.0, 0.0, 0.0, 1.0]}


@pytest.fixture
def ship():
    ents = {
        "MOUNT_S3": EntityDef("MOUNT_S3", "g-mount", "Data/mount.cga", item_type="Turret",
                              ports=[PortDef("hardpoint_class_2", types=["WeaponGun"])]),
        "GUN_S3": EntityDef("GUN_S3", "g-gun", "Data/gun.cga", item_type="WeaponGun", size=3),
        "RACK": EntityDef("RACK", "g-rack", None, item_type="MissileLauncher",
                          ports=[PortDef("missile_01_attach"), PortDef("missile_02_attach")]),
        "MSL": EntityDef("MSL", "g-msl", "Data/msl.cga", item_type="Missile"),
    }
    helpers = {
        "Data/hull.cga": {"hardpoint_weapon_left": h([-2.0, 1.0, 0.5], QZ90),
                          "hardpoint_missile": h([0.0, -1.0, -0.5])},
        "Data/mount.cga": {"hardpoint_class_2": h([0.0, 0.5, 0.0])},
        "Data/rack.cga": {},
    }
    root = EntityDef("SHIP", "g-ship", "Data/hull.cga", ports=[
        PortDef("hardpoint_weapon_left", min_size=3, max_size=3, types=["Turret.GunTurret"]),
        PortDef("hardpoint_missile", types=["MissileLauncher"], flags=["uneditable"]),
        PortDef("hardpoint_shield", types=["Shield"]),
    ])
    loadout = [
        LoadoutEntry("hardpoint_weapon_left", "MOUNT_S3",
                     [LoadoutEntry("hardpoint_class_2", "GUN_S3")]),
        LoadoutEntry("hardpoint_missile", "RACK", [LoadoutEntry("missile_01_attach", "MSL")]),
    ]
    return root, loadout, FakeSource(ents, helpers)


def test_axis_conversion_is_cry_x_z_minus_y():
    assert cry_point_to_gltf([1, 2, 3]) == [1.0, 3.0, -2.0]
    pos, _ = to_pos_quat(cry_to_gltf(from_pos_quat([1, 2, 3], None)))
    assert pos == pytest.approx([1, 3, -2])
    # CryEngine yaw (about up=Z) becomes a glTF rotation about up=Y.
    _, q = to_pos_quat(cry_to_gltf(from_pos_quat([0, 0, 0], QZ90)))
    assert q == pytest.approx([0.0, math.sqrt(0.5), 0.0, math.sqrt(0.5)])


def test_quaternion_round_trip():
    q = [0.1, -0.3, 0.2, 0.9]
    n = math.sqrt(sum(v * v for v in q))
    _, back = to_pos_quat(from_pos_quat([0, 0, 0], q))
    assert back == pytest.approx([v / n for v in q])


def test_nested_ports_compose_parent_transforms(ship):
    root, loadout, src = ship
    res = {r.path: r for r in resolve_entity(root, loadout, src)}
    gun = res["hardpoint_weapon_left/hardpoint_class_2"]
    # mount at (-2,1,0.5) yawed +90: its local +Y 0.5 m points along world -X.
    pos, _ = to_pos_quat(gun.world)
    assert pos == pytest.approx([-2.5, 1.0, 0.5])
    assert gun.parent_path == "hardpoint_weapon_left" and gun.item.class_name == "GUN_S3"
    # rack has no geometry -> its children have no helper -> unplaceable, but listed
    msl = res["hardpoint_missile/missile_01_attach"]
    assert msl.world is None and msl.item_class == "MSL"
    # declared-but-empty ports are kept for the "free slot" UI
    assert res["hardpoint_shield"].item is None
    assert "hardpoint_missile/missile_02_attach" in res


def test_enrich_groups_refs_and_metadata(ship):
    root, loadout, src = ship
    rows = {p["id"]: p for p in enrich(resolve_entity(root, loadout, src), root,
                                       {"Data/gun.cga": SHA_GUN, "Data/mount.cga": SHA_MOUNT,
                                        "Data/msl.cga": SHA_MSL})}
    gun = rows["hardpoint_weapon_left/hardpoint_class_2"]
    assert gun["group"] == "weapons" and gun["partSha256"] == SHA_GUN
    assert gun["parentClass"] == "MOUNT_S3" and gun["itemGuid"] == "g-gun"
    assert gun["position"] == pytest.approx([-2.5, 1.0, 0.5])
    assert rows["hardpoint_weapon_left"]["parentClass"] == "SHIP"
    assert rows["hardpoint_weapon_left"]["port"]["types"] == ["Turret.GunTurret"]
    assert rows["hardpoint_missile"]["port"]["editable"] is False
    assert rows["hardpoint_missile/missile_01_attach"]["group"] == "missiles"
    # no transform -> no part, even though the geometry exists
    assert rows["hardpoint_missile/missile_01_attach"]["partSha256"] is None
    shield = rows["hardpoint_shield"]
    assert shield["loadout"] == "empty" and shield["group"] == "components"


def test_group_inherits_parent_and_reads_port_types():
    assert group_of(None, ["Shield"], None) == "components"
    assert group_of(EntityDef("X"), [], "weapons") == "weapons"
    assert group_of(EntityDef("X", item_type="Magazine"), [], None) == "attachments"
    assert group_of(None, [], None) == "other"


def _manifest(ship, parts):
    root, loadout, src = ship
    return build_manifest("ship", root, resolve_entity(root, loadout, src), parts,
                          {"sha256": "d" * 64, "bytes": 10},
                          {"min": [0, 0, 0], "max": [1, 1, 1]})


def test_manifest_valid_and_only_lists_used_parts(ship):
    parts = {"Data/gun.cga": PartRef(SHA_GUN, 100, "Data/gun.cga"),
             "Data/mount.cga": PartRef(SHA_MOUNT, 50, "Data/mount.cga"),
             "Data/msl.cga": PartRef(SHA_MSL, 70, "Data/msl.cga")}
    m = _manifest(ship, parts)
    assert mf.validate_manifest(m) == []
    assert set(m["parts"]) == {SHA_GUN, SHA_MOUNT}  # missile unplaceable -> not listed
    json.loads(mf.to_json(m))


@pytest.mark.parametrize("mutate,needle", [
    (lambda m: m.update(schemaVersion=2), "schemaVersion"),
    (lambda m: m["placements"][0].update(group="guns"), "group"),
    (lambda m: m["placements"][1].update(parentPort="nope"), "parentPort"),
    (lambda m: m["placements"][0].update(partSha256="e" * 64), "parts"),
    (lambda m: m["placements"][0].update(rotation=None), "both"),
])
def test_manifest_validation_rejects(ship, mutate, needle):
    m = _manifest(ship, {"Data/gun.cga": PartRef(SHA_GUN, 1, "Data/gun.cga")})
    mutate(m)
    assert any(needle in e for e in mf.validate_manifest(m))


def test_schema_file_matches_typed_contract():
    schema = json.loads(mf.SCHEMA_PATH.read_text(encoding="utf-8"))
    assert set(schema["required"]) == set(mf.Manifest.__annotations__)
    item = schema["properties"]["placements"]["items"]
    assert set(item["required"]) == set(mf.Placement.__annotations__)
    assert tuple(item["properties"]["group"]["enum"]) == mf.GROUPS
    assert tuple(schema["properties"]["kind"]["enum"]) == mf.KINDS
    assert schema["properties"]["schemaVersion"]["const"] == mf.SCHEMA_VERSION


def _glb_with_locators(path: Path, locators: dict) -> None:
    gltf = {"asset": {"version": "2.0"}, "scene": 0, "nodes": [],
            "scenes": [{"nodes": [], "extras": {"hardpoints": locators}}]}
    glb_materials.write_glb(path, gltf, b"")


def test_manifest_positions_coincide_with_hull_locators(ship, tmp_path):
    """Converter locators are in glTF space; the manifest derives the same points
    from DataCore + .cga matrices. They must agree within 1 cm."""
    m = _manifest(ship, {})
    hull = tmp_path / "hull.glb"
    _glb_with_locators(hull, {"hardpoint_weapon_left": [-2.0, 1.0, 0.5],
                              "hardpoint_missile": [0.0, -1.0, -0.5]})
    rep = check_locators(m, hull)
    assert rep["ok"] and rep["checked"] == 2 and rep["max_error_m"] < 0.01
    # a position left in the other axis convention is caught
    _glb_with_locators(hull, {"hardpoint_weapon_left": cry_point_to_gltf([-2.0, 1.0, 0.5])})
    assert not check_locators(m, hull)["ok"]


def test_glb_node_transforms_world_space():
    from sc_extract.assets3d.parts import glb_node_transforms
    q = [0.0, math.sqrt(0.5), 0.0, math.sqrt(0.5)]
    gltf = {"scene": 0, "scenes": [{"nodes": [0]}],
            "nodes": [{"name": "root", "translation": [1, 0, 0], "rotation": q, "children": [1]},
                      {"name": "hardpoint_x", "translation": [0, 0, 2], "scale": [3, 3, 3]}]}
    n = glb_node_transforms(gltf)
    # child +Z 2 m under a +90 deg yaw about Y -> +X 2 m
    assert n["hardpoint_x"]["position"] == pytest.approx([3.0, 0.0, 0.0])
    assert n["hardpoint_x"]["rotation"] == pytest.approx(q)


def test_cga_helpers_are_converted_to_gltf_space():
    from sc_extract.assets3d.datacore import _cry_helper_to_gltf
    out = _cry_helper_to_gltf({"position": [1.0, 2.0, 3.0], "rotation": QZ90})
    assert out["position"] == pytest.approx([1.0, 3.0, -2.0])
    assert out["rotation"] == pytest.approx([0.0, math.sqrt(0.5), 0.0, math.sqrt(0.5)])


def test_glb_bounds_through_node_transform(tmp_path):
    gltf = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}],
            "nodes": [{"mesh": 0, "translation": [10, 0, 0]}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
            "accessors": [{"min": [-1, -2, -3], "max": [1, 2, 3], "count": 0,
                           "componentType": 5126, "type": "VEC3"}]}
    p = tmp_path / "b.glb"
    glb_materials.write_glb(p, gltf, b"")
    assert glb_bounds(p) == {"min": [9.0, -2.0, -3.0], "max": [11.0, 2.0, 3.0]}


def test_part_store_dedups_by_path_and_content(tmp_path, monkeypatch):
    built = []

    def fake_build(self, geo, mtl):
        built.append(geo)
        dest = self.path_of("f" * 64)
        dest.write_bytes(b"glb")
        return PartRef("f" * 64, 3, geo)

    monkeypatch.setattr(PartStore, "_build", fake_build)
    store = PartStore(tmp_path / "_parts", lambda p: b"", lambda p: True, Path("conv.exe"),
                      lambda *a: None, tmp_path / "w")
    a = store.export("Data/Objects/gun.cga")
    b = store.export("data/objects/GUN.cga")  # same path, other case
    c = store.export("Data/Objects/gun_copy.cga")
    assert built == ["Data/Objects/gun.cga", "Data/Objects/gun_copy.cga"]
    assert a.sha256 == b.sha256 == c.sha256 and b.cached
    store.save_index()
    again = PartStore(tmp_path / "_parts", lambda p: b"", lambda p: True, Path("conv.exe"),
                      lambda *a: None, tmp_path / "w")
    assert again.export("Data/Objects/gun.cga").cached and len(built) == 2
