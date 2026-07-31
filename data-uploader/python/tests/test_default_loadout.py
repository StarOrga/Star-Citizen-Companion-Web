"""Default-loadout resolution: what a ship's hardpoints are stock-fitted with.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/

The shapes exercised here are copied verbatim (structure, not content) from the
LIVE 4.9.0 ``Data/Game2.dcb``. Two of them used to be dropped on the floor:

1. an entry that names its item ONLY via ``entityClassReference`` (with
   ``entityClassName`` left as the empty string), and
2. the nested ``entry.loadout`` that holds the sub-items of the item just
   installed — which is where a gun mount's actual gun lives.

The other promise pinned here is the negative one: a port that really is
stock-empty must stay ``None``. Inventing an occupant would tell a pilot their
ship carries a gun it does not have.
"""

from __future__ import annotations

from sc_extract.dataforge_extract import (
    _LOADOUT_MAX_DEPTH,
    _default_loadout_of,
    _loadout_class_name,
    _loadout_entries,
)


def entry(port, *, name=None, ref=None, loadout=None):
    """One SItemPortLoadoutEntryParams as record_to_dict emits it."""
    return {
        "_Type_": "SItemPortLoadoutEntryParams",
        "itemPortName": port,
        # LIVE uses "" — not null — for "no literal class name here".
        "entityClassName": name if name is not None else "",
        "entityClassReference": (
            {
                "_RecordId_": "00000000-0000-0000-0000-000000000000",
                "_RecordName_": f"EntityClassDefinition.{ref}",
                "_RecordPath_": f"libs/foundry/records/entities/scitem/{ref}.xml",
            }
            if ref
            else None
        ),
        "inventoryContainer": None,
        "loadout": loadout,
    }


def manual(*entries):
    return {
        "_Type_": "SItemPortLoadoutManualParams",
        "InventoryItems": [],
        "entries": list(entries),
    }


class TestLoadoutClassName:
    def test_literal_class_name_wins(self):
        assert _loadout_class_name(entry("p", name="HTNK_Hull")) == "HTNK_Hull"

    def test_falls_back_to_the_record_reference(self):
        # The regression: LIVE leaves entityClassName empty and names the item
        # by reference instead. 10 972 of 25 801 top-level ship entries do this.
        assert _loadout_class_name(entry("p", ref="Mount_Gimbal_S3")) == "Mount_Gimbal_S3"

    def test_reference_keeps_only_the_class_name(self):
        e = entry("p", ref="KLWE_LaserRepeater_S3")
        assert e["entityClassReference"]["_RecordName_"].startswith("EntityClassDefinition.")
        assert _loadout_class_name(e) == "KLWE_LaserRepeater_S3"

    def test_literal_name_beats_a_reference_when_both_are_set(self):
        assert _loadout_class_name(entry("p", name="A", ref="B")) == "A"

    def test_stock_empty_port_stays_empty(self):
        assert _loadout_class_name(entry("hardpoint_cockpit_flair")) is None

    def test_whitespace_only_name_is_not_an_occupant(self):
        assert _loadout_class_name(entry("p", name="   ")) is None

    def test_malformed_reference_is_ignored(self):
        for ref in ({}, {"_RecordName_": ""}, {"_RecordName_": None}, "not-a-dict"):
            assert _loadout_class_name({"entityClassName": "", "entityClassReference": ref}) is None


class TestLoadoutEntries:
    def test_flat_shape_is_unchanged_for_plain_entries(self):
        out = _loadout_entries(manual(entry("hardpoint_radar", name="RADR_S01")))
        assert out == [{"itemPortName": "hardpoint_radar", "entityClassName": "RADR_S01"}]

    def test_nested_sub_items_are_resolved(self):
        # Verbatim structure of the Nomad's port: the gimbal is what bolts to
        # the hull, the repeater is what shoots.
        out = _loadout_entries(
            manual(
                entry(
                    "hardpoint_weapon_top_left",
                    ref="Mount_Gimbal_S3",
                    loadout=manual(entry("hardpoint_class_2", ref="KLWE_LaserRepeater_S3")),
                )
            )
        )
        assert out == [
            {
                "itemPortName": "hardpoint_weapon_top_left",
                "entityClassName": "Mount_Gimbal_S3",
                "entries": [
                    {
                        "itemPortName": "hardpoint_class_2",
                        "entityClassName": "KLWE_LaserRepeater_S3",
                    }
                ],
            }
        ]

    def test_entries_key_is_absent_when_there_are_no_sub_items(self):
        # Keeps the payload lean and the old two-key shape intact.
        (only,) = _loadout_entries(manual(entry("hardpoint_armor", name="ARMR_Hull")))
        assert "entries" not in only

    def test_empty_nested_loadout_adds_no_key(self):
        (only,) = _loadout_entries(manual(entry("p", name="X", loadout=manual())))
        assert "entries" not in only

    def test_missile_rack_keeps_every_round_as_its_own_sub_entry(self):
        rack = entry(
            "hardpoint_missiles_wing_left",
            name="MRCK_Quad",
            loadout=manual(*(entry(f"missile_0{i}_attach", name="MISL_S02") for i in (1, 2, 3, 4))),
        )
        (out,) = _loadout_entries(manual(rack))
        assert [e["itemPortName"] for e in out["entries"]] == [
            "missile_01_attach", "missile_02_attach", "missile_03_attach", "missile_04_attach",
        ]

    def test_order_is_preserved(self):
        ports = ["hardpoint_a", "hardpoint_b", "hardpoint_c"]
        out = _loadout_entries(manual(*(entry(p, name=p.upper()) for p in ports)))
        assert [e["itemPortName"] for e in out] == ports

    def test_recursion_is_capped(self):
        # A malformed/cyclic tree must not hang the extract. Build one deeper
        # than the cap and check the walk stops.
        node = manual(entry("leaf", name="LEAF"))
        for _ in range(_LOADOUT_MAX_DEPTH + 3):
            node = manual(entry("branch", name="BRANCH", loadout=node))
        depth = 0
        cur = _loadout_entries(node)
        while cur and "entries" in cur[0]:
            depth += 1
            cur = cur[0]["entries"]
        assert depth <= _LOADOUT_MAX_DEPTH

    def test_junk_in_yields_nothing_out(self):
        for junk in (None, [], "loadout", {"entries": "nope"}, {}):
            assert _loadout_entries(junk) == []

    def test_non_dict_entries_are_skipped_not_fatal(self):
        out = _loadout_entries({"entries": [None, "x", entry("p", name="P")]})
        assert out == [{"itemPortName": "p", "entityClassName": "P"}]


class TestDefaultLoadoutOfComponents:
    def test_reads_the_loadout_component(self):
        comps = [
            {"_Type_": "VehicleComponentParams"},
            {
                "_Type_": "SEntityComponentDefaultLoadoutParams",
                "loadout": manual(entry("hardpoint_shield_generator_01", ref="SHLD_S01")),
            },
        ]
        assert _default_loadout_of(comps) == [
            {"itemPortName": "hardpoint_shield_generator_01", "entityClassName": "SHLD_S01"}
        ]

    def test_no_loadout_component_yields_nothing(self):
        assert _default_loadout_of([{"_Type_": "VehicleComponentParams"}]) == []
