"""FPS weapon + standalone item packages (sc_extract.assets3d.fps / .items)."""
from __future__ import annotations

import struct
from pathlib import Path

import pytest

from sc_extract import glb_materials
from sc_extract.assets3d import manifest as mf
from sc_extract.assets3d.datacore import port_types_with_subtypes
from sc_extract.assets3d.entity import EntityDef, LoadoutEntry, PortDef, resolve_entity
from sc_extract.assets3d.fps import (FpsSource, IVO_COMPILED_BONES, body_path, body_sources,
                                     bones_from_chr, is_attachment_port, is_fps_weapon_record,
                                     parse_cdf)
from sc_extract.assets3d.items import is_item_record
from sc_extract.assets3d.package import build_manifest
from sc_extract.assets3d.parts import glb_bounds, merge_glbs
from sc_extract.assets3d.transforms import to_pos_quat

CDF = "Data/objects/fps_weapons/w/gun.cdf"
CHR = "Data/objects/fps_weapons/w/gun.chr"


def ivo_chr(bones):
    """bones = [(name, parent, world_pos_cry, world_quat_xyzw_cry)]."""
    recs = b""
    for name, parent, wp, wq in bones:
        recs += struct.pack("<IIhh", 1, 1, parent, 0)
        recs += struct.pack("<4f3f", *wq, *wp)          # relative (unused)
        recs += struct.pack("<4f3f", *wq, *wp)          # world
    names = b"".join(n.encode() + b"\0" for n, *_ in bones)
    body = struct.pack("<I", len(bones)) + recs + names
    header = struct.pack("<4sIII", b"#ivo", 0x900, 1, 16)
    table = struct.pack("<IIQ", IVO_COMPILED_BONES, 0x900, 32)
    return header + table + body


def test_bones_from_chr_converts_to_gltf_space():
    blob = ivo_chr([("root", -1, (0, 0, 0), (0, 0, 0, 1)),
                    ("sight_attachment", 0, (0.0, 0.0332, 0.1467), (0, 0, 0, 1))])
    bones = bones_from_chr(blob)
    assert bones["root"]["position"] == [0.0, 0.0, 0.0]
    # CryEngine (x, y, z) -> glTF (x, z, -y): forward (+Y) becomes -Z, up (+Z) becomes +Y
    assert bones["sight_attachment"]["position"] == pytest.approx([0.0, 0.1467, -0.0332])
    assert bones_from_chr(b"CrCh" + b"\0" * 32) == {}


def test_parse_cdf_and_body_sources_skip_ammo_and_unknown_bones():
    cdf = (b'<CharacterDefinition><Model File="objects/fps_weapons/w/gun.chr" Material="objects/w/gun_mat"/>'
           b'<AttachmentList>'
           b'<Attachment Type="CA_SKIN" AName="parts" Binding="objects/w/gun_parts.skin" Material="objects/w/gun_mat.mtl"/>'
           b'<Attachment Type="CA_BONE" AName="bullet" Binding="Objects/fps_weapons/ammo/x.cgf" BoneName="bullet"/>'
           b'<Attachment Type="CA_BONE" AName="stock" Binding="objects/w/stock.cgf" BoneName="stock_bone"'
           b' RelPosition="0,0.1,0" RelRotation="1,0,0,0"/>'
           b'<Attachment Type="CA_BONE" AName="lost" Binding="objects/w/lost.cgf" BoneName="nope"/>'
           b'</AttachmentList></CharacterDefinition>')
    cd = parse_cdf(cdf)
    assert cd.model == CHR and cd.material == "Data/objects/w/gun_mat.mtl"
    bones = {"stock_bone": {"position": [0.0, 0.0, 0.5], "rotation": [0, 0, 0, 1]},
             "bullet": {"position": [0, 0, 0], "rotation": [0, 0, 0, 1]}}
    src = body_sources(cd, bones)
    assert [s[0] for s in src] == ["Data/objects/w/gun_parts.skin", "Data/objects/w/stock.cgf"]
    assert src[0][2] is None
    pos, _ = to_pos_quat(src[1][2])
    # bone (glTF) + RelPosition 0.1 along CryEngine +Y = glTF -Z
    assert pos == pytest.approx([0.0, 0.0, 0.4])


def test_port_types_keep_subtypes_and_grab_ports_are_not_slots():
    raw = {"Types": [{"Type": "WeaponAttachment", "SubTypes": ["IronSight"]}]}
    assert port_types_with_subtypes(raw) == ["WeaponAttachment.IronSight"]
    assert port_types_with_subtypes({"Types": [{"Type": "Missile", "SubTypes": []}]}) == ["Missile"]
    assert not is_attachment_port(PortDef("item_grab", "magAttach", 0, 0, [], []))
    assert is_attachment_port(PortDef("optics_attach", "sight_attachment", 1, 2,
                                      ["WeaponAttachment.IronSight"], ["inventory"]))


@pytest.mark.parametrize("fn,cls,ok", [
    ("libs/foundry/records/entities/scitem/weapons/fps_weapons/behr_rifle_ballistic_01.xml",
     "behr_rifle_ballistic_01", True),
    ("libs/foundry/records/entities/scitem/weapons/fps_weapons/dev/x.xml", "x_rifle", False),
    ("libs/foundry/records/entities/scitem/weapons/melee/ksar_melee_01.xml", "ksar_melee_01", False),
    ("libs/foundry/records/entities/scitem/weapons/fps_weapons/t.xml", "behr_rifle_test_01", False),
    ("libs/foundry/records/entities/scitem/weapons/fps_weapons/t.xml", "FPS_Rifle_Template", False),
])
def test_fps_record_rule(fn, cls, ok):
    assert is_fps_weapon_record(fn, cls) is ok


def test_item_record_rule():
    assert is_item_record("libs/foundry/records/entities/scitem/ships/quantumdrive/q.xml", "QDRV_RSI_S01")
    assert not is_item_record("libs/foundry/records/entities/scitem/ships/x/q.xml", "QDRV_AI_S01")
    assert not is_item_record("libs/foundry/records/entities/scitem/weapons/fps_weapons/a.xml", "a")


def _tiny_glb(path: Path, offset: float) -> Path:
    pos = struct.pack("<9f", offset, 0, 0, offset + 1, 0, 0, offset, 1, 0)
    gltf = {"asset": {"version": "2.0"}, "buffers": [{"byteLength": len(pos)}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pos)}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3",
                           "min": [offset, 0, 0], "max": [offset + 1, 1, 0]}],
            "materials": [{"name": "m", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "material": 0}]}],
            "nodes": [{"name": "n", "mesh": 0}], "scenes": [{"nodes": [0]}], "scene": 0}
    glb_materials.write_glb(path, gltf, pos)
    return path


def test_merge_glbs_offsets_indices_and_applies_matrix(tmp_path):
    a = _tiny_glb(tmp_path / "a.glb", 0.0)
    b = _tiny_glb(tmp_path / "b.glb", 0.0)
    shift = [[1, 0, 0, 0], [0, 1, 0, 2.0], [0, 0, 1, 0], [0, 0, 0, 1]]
    gltf, blob = merge_glbs([(a, None), (b, shift)])
    assert len(gltf["meshes"]) == 2 and gltf["meshes"][1]["primitives"][0]["attributes"]["POSITION"] == 1
    assert gltf["bufferViews"][1]["byteOffset"] >= 36
    assert "baseColorTexture" not in str(gltf["materials"])
    out = tmp_path / "m.glb"
    glb_materials.write_glb(out, gltf, blob)
    bb = glb_bounds(out)
    assert bb["min"][1] == 0.0 and bb["max"][1] == 3.0


class _Reader:
    def __init__(self, files):
        self.files = {k.lower(): v for k, v in files.items()}

    def exists(self, p):
        return p.lower() in self.files

    def read(self, p):
        return self.files[p.lower()]


class _Base:
    def __init__(self, ents, comps, loadouts, helpers):
        self.ents, self.comps, self.loadouts, self.h = ents, comps, loadouts, helpers

    def entity(self, c):
        return self.ents.get(c)

    def components(self, c):
        return self.comps.get(c, [])

    def default_loadout(self, c):
        return self.loadouts.get(c, [])

    def helpers(self, g):
        return self.h.get(g, {})


def test_fps_source_places_attachments_on_bones_and_lists_empty_slots():
    cdf = (b'<CharacterDefinition><Model File="objects/fps_weapons/w/gun.chr"/><AttachmentList>'
           b'<Attachment Type="CA_SKIN" Binding="objects/fps_weapons/w/gun.skin"/></AttachmentList>'
           b'</CharacterDefinition>')
    chr_blob = ivo_chr([("root", -1, (0, 0, 0), (0, 0, 0, 1)),
                        ("sight_attachment", 0, (0, 0.03, 0.15), (0, 0, 0, 1)),
                        ("magAttach", 0, (0, 0.17, -0.01), (0.1248, 0, 0, 0.9922))])
    reader = _Reader({CDF: cdf, CHR: chr_blob})
    ports = [PortDef("optics_attach", "sight_attachment", 1, 2, ["WeaponAttachment.IronSight"], ["inventory"]),
             PortDef("magazine_attach", "magAttach", 1, 1, ["WeaponAttachment.Magazine"], []),
             PortDef("barrel_attach", "barrel_attachment", 2, 2, ["WeaponAttachment.Barrel"], ["inventory"]),
             PortDef("item_grab", "magAttach", 0, 0, [], [])]
    gun = EntityDef("gun_01", "g-1", None, None, "WeaponPersonal", "Medium", 2, ports)
    mag = EntityDef("gun_01_mag", "g-2", "Data/m.cgf", None, "WeaponAttachment", "Magazine", 1)
    base = _Base({"gun_01": gun, "gun_01_mag": mag},
                 {"gun_01": [{"Geometry": {"Geometry": {"Geometry": {"path": "objects/fps_weapons/w/gun.cdf"}}}}]},
                 {"gun_01": [LoadoutEntry("magazine_attach", "gun_01_mag"),
                             LoadoutEntry("optics_attach", None)]}, {})
    src = FpsSource(base, reader)
    assert body_path(base.components("gun_01")) == CDF
    w = src.weapon("gun_01")
    assert w.geometry_path == CDF and [p.name for p in w.ports] == \
        ["optics_attach", "magazine_attach", "barrel_attach"]
    resolved = resolve_entity(w, src.default_loadout("gun_01"), src)
    m = build_manifest("fps_weapon", w, resolved, {}, None)
    assert mf.validate_manifest(m) == []
    by = {p["id"]: p for p in m["placements"]}
    assert by["magazine_attach"]["itemClass"] == "gun_01_mag"
    assert by["magazine_attach"]["group"] == "attachments"
    assert by["magazine_attach"]["position"] == pytest.approx([0.0, -0.01, -0.17])
    assert by["optics_attach"]["loadout"] == "empty" and by["optics_attach"]["itemClass"] is None
    assert by["optics_attach"]["port"]["types"] == ["WeaponAttachment.IronSight"]
    assert by["optics_attach"]["position"] == pytest.approx([0.0, 0.15, -0.03])
    # no bone for the barrel on this rig -> listed, not placeable
    assert by["barrel_attach"]["position"] is None and by["barrel_attach"]["port"]["maxSize"] == 2


def test_item_kind_is_valid():
    root = EntityDef("QDRV_X_S01", "q-1", "Data/q.cga", None, "QuantumDrive", None, 1)
    m = build_manifest("item", root, [], {}, {"sha256": "a" * 64, "bytes": 10})
    assert m["kind"] == "item" and mf.validate_manifest(m) == []
