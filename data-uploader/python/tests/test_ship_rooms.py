"""#797: room footprints per deck from the ship object containers.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/

The XML below is trimmed from the LIVE 4.x ``objectcontainers/ships/anvl/
carrack/middle.socpak`` → ``middle.soc`` ``<Entities>`` chunk (probe
2026-10-25). The CryXmlB decode is the live probe's job; here the decoder is a
stub that parses plain XML behind a fake ``CryXmlB`` magic.
"""

from __future__ import annotations

import io
import math
import struct
import xml.etree.ElementTree as ET
import zipfile

import pytest

from sc_extract.ship_rooms import (ang3_quat, bounds_of, cry_guid_to_record_id, is_unnamed, move,
                                   read_zip_entry, rooms_in_container, rotate, soc_entities,
                                   soc_entries)

MEDBAY = "46b8c49d-4de3-774a-e3e9-b7fbf4f666a7"
OFFICE = "445e122b-1c47-2774-7506-7f2bda0ac09a"
TURRET = "41ac189a-4464-b79e-5a6e-7e3d4baf5683"
LIFT = "4e577b00-9827-49c9-50a3-a7306a6de8a2"
DECK_MAIN = "649bcee0-2974-4755-b033-a7d5249eb419"

ENTITIES = f"""<Entities>
 <Entity Name="MedicalBay_Room_RN" Pos="-0.3843,0.4458,-1.8483" EntityClass="Room_RN" EntityCryGUID="{MEDBAY}">
  <PropertiesDataCore><EntityComponentRoom roomName="@vehicle_room_medical" interiorMapSection="{DECK_MAIN.upper()}"/></PropertiesDataCore>
 </Entity>
 <Entity Name="MedicalBay_Office_Room_RN" Pos="-3.75,-5.31,0.35" EntityClass="Room_RN" EntityCryGUID="{OFFICE}">
  <PropertiesDataCore><EntityComponentRoom roomName="@procedural_text_null" interiorMapSection="{DECK_MAIN}"/></PropertiesDataCore>
 </Entity>
 <Entity Name="Turret_Room_RN" Pos="-20,-27,-1" EntityClass="Room_RN" EntityCryGUID="{TURRET}">
  <PropertiesDataCore><EntityComponentRoom roomName="@vehicle_room_turret" interiorMapSection="{DECK_MAIN}"/></PropertiesDataCore>
 </Entity>
 <Entity Name="Lift_Room_RN" Pos="3,14,-9.5" EntityClass="Room_RN" EntityCryGUID="{LIFT}">
  <PropertiesDataCore><EntityComponentRoom roomName="@vehicle_room_lift" interiorMapSection="{DECK_MAIN}"/></PropertiesDataCore>
 </Entity>
 <Entity Name="VA_Medbay-001" Pos="-3.5,-3.74,-3.52" Rotate="0,0,0,1" EntityClass="GenericShape">
  <AreaComponent>
   <Segment index="0" transform_ls="Q : 1,0,0,0 | T : 0,0,0" Type="Shape" Height="4">
    <Points><Point Pos="0,0,0"/><Point Pos="-10,0,0"/><Point Pos="-10,-9,0"/><Point Pos="0,-9,0"/></Points>
   </Segment>
   <Entities><Entity EntityCryGUID="{MEDBAY}"/></Entities>
  </AreaComponent>
  <AreaComponent>
   <Segment index="0" transform_ls="Q : 1,0,0,0 | T : 0,0,0" Type="Shape" Height="4">
    <Points><Point Pos="0,0,0"/><Point Pos="-10,0,0"/><Point Pos="-10,-9,0"/><Point Pos="0,-9,0"/></Points>
   </Segment>
   <Entities><Entity EntityCryGUID="{MEDBAY}"/></Entities>
  </AreaComponent>
 </Entity>
 <Entity Name="VA_Office" Pos="-3.75,-5.3,-1.3" EntityClass="GenericShape">
  <AreaComponent>
   <Segment index="0" transform_ls="Q : 1,0,0,0 | T : 0,0,0" Type="Box" BoxMin="-1,-1.25,-1.5" BoxMax="1,1.25,1.5"/>
   <Entities><Entity EntityCryGUID="{OFFICE.upper()}"/></Entities>
  </AreaComponent>
 </Entity>
 <Entity Name="VA_Turret" Pos="-20,-27,-2" EntityClass="GenericShape">
  <AreaComponent>
   <Segment index="0" transform_ls="Q : 1,0,0,0 | T : 0,1,0" Type="Trimesh">
    <Point pos="0,0,0"/><Point pos="4,0,0"/><Point pos="4,2,0"/>
    <Point pos="0,0,0"/><Point pos="4,2,0"/><Point pos="0,2,0"/>
    <Point pos="0,0,0"/><Point pos="0,0,3"/><Point pos="4,0,3"/>
    <Point pos="0,0,3"/><Point pos="4,0,3"/><Point pos="4,2,3"/>
   </Segment>
   <Entities><Entity EntityCryGUID="{TURRET}"/></Entities>
  </AreaComponent>
 </Entity>
 <Entity Name="AS_Medbay" Pos="0,0,0" EntityClass="AreaShape">
  <AreaComponent><Segment Type="Shape" Height="3"><Points><Point Pos="0,0,0"/><Point Pos="1,0,0"/><Point Pos="1,1,0"/></Points></Segment>
   <Entities><Entity EntityCryGUID="{MEDBAY}"/></Entities></AreaComponent>
 </Entity>
</Entities>"""


def _rooms(offset=(0.0, 0.0, 0.0)):
    return {r["key"]: r for r in rooms_in_container(ET.fromstring(ENTITIES), offset)}


class TestRooms:
    def test_every_room_is_listed_with_its_deck_and_name_key(self):
        rooms = _rooms()
        assert sorted(rooms) == ["Lift_Room_RN", "MedicalBay_Office_Room_RN",
                                 "MedicalBay_Room_RN", "Turret_Room_RN"]
        assert rooms["MedicalBay_Room_RN"]["locKey"] == "@vehicle_room_medical"
        assert rooms["MedicalBay_Room_RN"]["section"] == DECK_MAIN

    def test_shape_is_turned_by_its_wxyz_rotation(self):
        # Rotate="0,0,0,1" is w=0, z=1: 180 deg about Z, so local -X points to +X.
        med = _rooms()["MedicalBay_Room_RN"]
        assert med["shapes"] == [[[-3.5, -3.74], [6.5, -3.74], [6.5, 5.26], [-3.5, 5.26]]]
        assert med["floorZ"] == -3.52 and med["height"] == 4.0

    def test_only_the_first_area_component_counts(self):
        assert len(_rooms()["MedicalBay_Room_RN"]["shapes"]) == 1

    def test_area_shapes_for_audio_are_not_rooms(self):
        med = _rooms()["MedicalBay_Room_RN"]
        assert all(len(s) == 4 for s in med["shapes"])

    def test_box_becomes_its_floor_rectangle(self):
        office = _rooms()["MedicalBay_Office_Room_RN"]
        assert office["shapes"] == [[[-4.75, -6.55], [-2.75, -6.55], [-2.75, -4.05], [-4.75, -4.05]]]
        assert office["floorZ"] == -2.8 and office["height"] == 3.0

    def test_trimesh_keeps_only_its_floor_triangles(self):
        turret = _rooms()["Turret_Room_RN"]
        assert turret["shapes"] == []
        assert turret["tris"] == [[[-20.0, -26.0], [-16.0, -26.0], [-16.0, -24.0]],
                                  [[-20.0, -26.0], [-16.0, -24.0], [-20.0, -24.0]]]
        assert turret["height"] == 3.0

    def test_a_room_without_volume_is_a_pin(self):
        lift = _rooms()["Lift_Room_RN"]
        assert lift["shapes"] == [] and lift["tris"] == [] and lift["pos"] == [3.0, 14.0, -9.5]

    def test_container_offset_moves_everything(self):
        lift = _rooms((0.0, -5.0, -3.0))["Lift_Room_RN"]
        assert lift["pos"] == [3.0, 9.0, -12.5]

    def test_segment_rotation_is_applied(self):
        # transform_ls Q (w,x,y,z) = 90 deg about Z: the box's long side turns from X to Y.
        h = math.sqrt(0.5)
        ents = ET.fromstring(f"""<Entities>
         <Entity Name="R_Room_RN" Pos="0,0,0" EntityClass="Room_RN" EntityCryGUID="{LIFT}"/>
         <Entity Name="VA" Pos="0,0,0" EntityClass="GenericShape"><AreaComponent>
          <Segment transform_ls="Q : {h},0,0,{h} | T : 0,0,0" Type="Box" BoxMin="-2,-1,0" BoxMax="2,1,3"/>
          <Entities><Entity EntityCryGUID="{LIFT}"/></Entities></AreaComponent></Entity>
        </Entities>""")
        (rect,) = rooms_in_container(ents, (0, 0, 0))[0]["shapes"]
        xs = [p[0] for p in rect]
        ys = [p[1] for p in rect]
        assert (max(xs) - min(xs), max(ys) - min(ys)) == pytest.approx((2.0, 4.0))

    def test_no_rooms_means_empty(self):
        assert rooms_in_container(ET.fromstring("<Entities/>"), (0, 0, 0)) == []


class TestHelpers:
    def test_cry_guid_maps_to_the_dataforge_record_id(self):
        # Both pairs verified on LIVE (Carrack deck 2 and deck 1).
        assert cry_guid_to_record_id(DECK_MAIN) == "29744755-cee0-649b-19b4-9e24d5a733b0"
        assert (cry_guid_to_record_id("B71E4810-AC27-42AE-9E3F-8D044D14CDE6")
                == "ac2742ae-4810-b71e-e6cd-144d048d3f9e")
        assert cry_guid_to_record_id("nope") is None and cry_guid_to_record_id(None) is None

    def test_unnamed_keys(self):
        assert is_unnamed("@procedural_text_null") and is_unnamed(None) and is_unnamed("")
        assert not is_unnamed("@vehicle_room_medical")

    def test_bounds_cover_shapes_and_pins(self):
        b = bounds_of(_rooms().values())
        assert b == {"min": [-20.0, -26.0], "max": [6.5, 14.0]}
        assert bounds_of([]) is None

    def test_ang3_is_degrees(self):
        q = ang3_quat({"x": 0, "y": 0, "z": 90})
        v = rotate(q, (1.0, 0.0, 0.0))
        assert v == pytest.approx((0.0, 1.0, 0.0), abs=1e-9)
        assert ang3_quat({"x": "nan"}) == (0.0, 0.0, 0.0, 1.0)

    def test_move(self):
        assert move([1, 0, 0], ang3_quat({"z": 180}), (0.0, 2.0, 0.0)) == [-1.0, 2.0, 0.0]

    def test_nan_positions_fall_back_to_origin(self):
        ents = ET.fromstring(f'<Entities><Entity Name="R" Pos="nan,0,0" EntityClass="Room_RN" '
                             f'EntityCryGUID="{LIFT}"/></Entities>')
        assert rooms_in_container(ents, (0, 0, 0))[0]["pos"] == [0.0, 0.0, 0.0]
        assert math.isfinite(rooms_in_container(ents, (0, 0, 0))[0]["pos"][0])


def _backslash_zip(files):
    """A ZIP whose local headers use backslashes, like the LIVE socpaks."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    raw = bytearray(buf.getvalue())
    for name in files:
        enc = name.encode()
        i = raw.find(b"PK\x03\x04" + b"")
        while i != -1:
            nlen = struct.unpack_from("<H", raw, i + 26)[0]
            if raw[i + 30:i + 30 + nlen] == enc:
                raw[i + 30:i + 30 + nlen] = enc.replace(b"/", b"\\")
            i = raw.find(b"PK\x03\x04", i + 4)
    return bytes(raw)


class TestSocpak:
    def test_entries_with_backslash_headers_are_readable(self):
        blob = _backslash_zip({"middle/sub/a.soc": b"x" * 500, "middle.soc": b"main"})
        zf = zipfile.ZipFile(io.BytesIO(blob))
        with pytest.raises(zipfile.BadZipFile):
            zf.read("middle/sub/a.soc")
        socs = soc_entries(zf)
        assert [i.filename for i in socs] == ["middle.soc", "middle/sub/a.soc"]
        assert read_zip_entry(blob, socs[1]) == b"x" * 500

    def test_stored_entries(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            z.writestr("a.soc", b"plain")
        zf = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
        assert read_zip_entry(buf.getvalue(), zf.infolist()[0]) == b"plain"

    def test_entities_chunk_is_found_among_other_cryxml_chunks(self):
        def decode(b):
            return ET.fromstring(b[len(b"CryXmlB"):].split(b"\0", 1)[0])
        blob = (b"CrChF\0junk" + b"CryXmlB<Other/>\0" + b"pad"
                + b"CryXmlB" + ENTITIES.encode() + b"\0tail")
        root = soc_entities(blob, decode)
        assert root is not None and root.tag == "Entities"
        assert soc_entities(b"CryXmlBbroken", decode) is None


class _Rec:
    def __init__(self, name):
        self.name = name


class TestAttachDeckRooms:
    def _extractor(self, rooms):
        from sc_extract.dataforge_extract import CodexExtractor
        ex = CodexExtractor.__new__(CodexExtractor)
        sections = {"29744755-cee0-649b-19b4-9e24d5a733b0": _Rec("InteriorMapSectionDefinition.Carrack_Deck_2")}
        ex.df = type("DF", (), {"record_by_id": staticmethod(lambda g: sections.get(g))})()
        ex._deck_name = lambda key: {"en": key.lstrip("@").title(), "de": None}
        ex._ship_rooms = lambda vcp: rooms
        ex.logs = []
        ex.on_log = lambda lvl, m: ex.logs.append((lvl, m))
        return ex

    def _room(self, key, section, loc="@vehicle_room_medical"):
        return {"key": key, "locKey": loc, "section": section, "pos": [0.0, 1.0, 2.0],
                "floorZ": 1.0, "height": 3.0, "shapes": [[[0.0, 0.0], [2.0, 0.0], [2.0, 2.0]]],
                "tris": []}

    def test_rooms_land_on_their_deck_with_bounds(self):
        decks = [{"key": "Carrack_Deck_1", "name": None, "order": 0},
                 {"key": "Carrack_Deck_2", "name": None, "order": 1}]
        self._extractor([self._room("Zeta_Room_RN", DECK_MAIN),
                         self._room("Alpha_Room_RN", DECK_MAIN, "@procedural_text_null"),
                         self._room("Foreign_Room_RN", "00000000-0000-0000-0000-000000000000"),
                         self._room("Loose_Room_RN", None)])._attach_deck_rooms(decks, {})
        assert "rooms" not in decks[0] and "bounds" not in decks[0]
        rooms = decks[1]["rooms"]
        assert [r["key"] for r in rooms] == ["Alpha_Room_RN", "Zeta_Room_RN"]
        assert rooms[0]["name"] is None
        assert rooms[1]["name"] == {"en": "Vehicle_Room_Medical", "de": None}
        assert set(rooms[1]) == {"key", "name", "pos", "floorZ", "height", "shapes", "tris"}
        assert decks[1]["bounds"] == {"min": [0.0, 0.0], "max": [2.0, 2.0]}
        rest = decks[2]
        assert (rest["key"], rest["order"], rest["fallback"]) == ("unassigned", 2, True)
        assert rest["name"] == {"en": "Other rooms", "de": "Weitere Räume"}
        assert [r["key"] for r in rest["rooms"]] == ["Foreign_Room_RN", "Loose_Room_RN"]

    def test_a_single_deck_takes_the_rooms_without_a_section(self):
        decks = [{"key": "Prospector_Deck_1", "name": None, "order": 0}]
        self._extractor([self._room("Room_Main", None),
                         self._room("Foreign_Room_RN", "00000000-0000-0000-0000-000000000000")]
                        )._attach_deck_rooms(decks, {})
        assert [r["key"] for r in decks[0]["rooms"]] == ["Room_Main"]
        assert decks[0]["bounds"] == {"min": [0.0, 0.0], "max": [2.0, 2.0]}
        assert [r["key"] for r in decks[1]["rooms"]] == ["Foreign_Room_RN"]

    def test_unmapped_rooms_of_a_multi_deck_ship_get_one_fallback_deck(self):
        decks = [{"key": "Vulture_Deck_1", "name": None, "order": 0},
                 {"key": "Vulture_Deck_2", "name": None, "order": 1}]
        self._extractor([self._room("Room_Hab", None), self._room("Room_Cargo", None)]
                        )._attach_deck_rooms(decks, {})
        assert "rooms" not in decks[0] and "rooms" not in decks[1]
        rest = decks[2]
        assert rest["name"] == {"en": "All rooms", "de": "Alle Räume"}
        assert [r["key"] for r in rest["rooms"]] == ["Room_Cargo", "Room_Hab"]
        assert rest["bounds"] == {"min": [0.0, 0.0], "max": [2.0, 2.0]}

    def test_a_ship_without_decks_gets_the_fallback_deck_only(self):
        decks = []
        self._extractor([self._room("Room_Main", None)])._attach_deck_rooms(decks, {})
        assert [(d["key"], d["order"]) for d in decks] == [("unassigned", 0)]

    def test_a_failure_also_drops_the_fallback_deck(self):
        decks = [{"key": "Carrack_Deck_2", "name": None, "order": 0}]
        ex = self._extractor([self._room("Loose", None), self._room("Bad", "x")])
        ex.df = None  # section lookup blows up after the fallback room was seen
        ex._attach_deck_rooms(decks, {})
        assert decks == [{"key": "Carrack_Deck_2", "name": None, "order": 0}]

    def test_a_failure_leaves_the_decks_without_rooms(self):
        decks = [{"key": "Carrack_Deck_2", "name": None, "order": 0}]
        ex = self._extractor([{"key": "Broken"}])
        ex._attach_deck_rooms(decks, {})
        assert decks == [{"key": "Carrack_Deck_2", "name": None, "order": 0}]
        assert ex.logs and ex.logs[0][0] == "warn"

    def test_no_rooms_leaves_the_decks_alone(self):
        decks = [{"key": "Carrack_Deck_2", "name": None, "order": 0}]
        self._extractor([])._attach_deck_rooms(decks, {})
        assert decks == [{"key": "Carrack_Deck_2", "name": None, "order": 0}]


class TestShipRoomsAcrossContainers:
    def _extractor(self, per_file):
        from sc_extract.dataforge_extract import CodexExtractor
        ex = CodexExtractor.__new__(CodexExtractor)
        ex._container_rooms = lambda name: per_file.get(name, [])
        return ex

    def _room(self, key):
        return {"key": key, "locKey": None, "section": None, "pos": [1.0, 0.0, 0.0],
                "floorZ": 0.0, "height": 2.0, "shapes": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]],
                "tris": []}

    def test_keys_stay_unique_and_offsets_apply(self):
        ex = self._extractor({"a.socpak": [self._room("Corridor_Room_RN")],
                              "b.socpak": [self._room("Corridor_Room_RN")]})
        vcp = {"objectContainers": [
            {"fileName": "a.socpak", "Offset": {"Position": {"x": 0, "y": 10, "z": -3}}},
            {"fileName": "b.socpak", "Offset": {"Position": {"x": 0, "y": -10, "z": 0},
                                                "Rotation": {"x": 0, "y": 0, "z": 180}}},
        ]}
        a, b = ex._ship_rooms(vcp)
        assert (a["key"], b["key"]) == ("Corridor_Room_RN", "Corridor_Room_RN~2")
        assert a["pos"] == [1.0, 10.0, -3.0] and a["floorZ"] == -3.0
        assert b["pos"] == [-1.0, -10.0, 0.0]
        assert b["shapes"] == [[[0.0, -10.0], [-1.0, -10.0], [-1.0, -11.0]]]

    def test_garbage_offsets_fall_back_to_the_origin(self):
        ex = self._extractor({"a.socpak": [self._room("R")]})
        rooms = ex._ship_rooms({"objectContainers": [
            {"fileName": "a.socpak", "Offset": {"Position": {"x": "abc"}, "Rotation": "nope"}},
            {"fileName": None}, "junk"]})
        assert rooms[0]["pos"] == [1.0, 0.0, 0.0]


class TestNestedContainers:
    def test_rooms_in_a_nested_soc_are_skipped_with_a_warning(self):
        from sc_extract.dataforge_extract import CodexExtractor
        socpak = _backslash_zip({"middle.soc": b"no rooms here",
                                 "middle/sub/a.soc": b"CryXmlB <Entities>Room_RN</Entities>"})
        outer = io.BytesIO()
        with zipfile.ZipFile(outer, "w", zipfile.ZIP_STORED) as z:
            z.writestr("Data/ObjectContainers/ships/x/middle.socpak", socpak)
        ex = CodexExtractor.__new__(CodexExtractor)
        ex.p4k = zipfile.ZipFile(io.BytesIO(outer.getvalue()))
        ex.logs = []
        ex.on_log = lambda lvl, m: ex.logs.append((lvl, m))
        assert ex._container_rooms("ObjectContainers/ships/x/middle.socpak") == []
        assert any(lvl == "warn" and "nested container" in m for lvl, m in ex.logs)
