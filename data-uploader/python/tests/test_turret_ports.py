"""#795: turret ports from the vehicle XML, PDC guns from the turret's own fit.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/

VERIFIED against LIVE 4.x (probe 2026-10-25):

* AEGS_Hammerhead's `SItemPortContainerComponentParams` lists 7 system ports
  (fuel, relays, life support); its six manned turrets, missile racks and
  countermeasures are `<Part><ItemPort>` entries of
  `aegs_hammerhead.xml` only — so the codex listed no turret port at all.
* AEGS_Idris_P's loadout fits `hardpoint_pdc_01 => Turret_PDC_BEHR_A` with no
  sub-entries; the gun (`BEHR_LaserRepeater_PDC_S1`) is the turret item's own
  `SEntityComponentDefaultLoadoutParams`.

The XML below is a trimmed real file (plain-text XML; the CryXmlB decode path
is exercised by the live probe, as in test_ship_hull_cargo.py).
"""

from __future__ import annotations

import io

from sc_extract.dataforge_extract import CodexExtractor

HAMMERHEAD_XML = b"""<?xml version="1.0"?>
<Vehicle name="AEGS_Hammerhead">
  <Parts>
    <Part name="AEGS_Hammerhead" class="Animated" mass="1000">
      <Parts>
        <Part name="turret_top" class="ItemPort">
          <ItemPort minSize="5" maxSize="5" flags="$uneditable">
            <Types><Type type="TurretBase" subtypes="MannedTurret"/></Types>
          </ItemPort>
        </Part>
        <Part name="hardpoint_missile_top_left_01" class="ItemPort">
          <ItemPort minSize="5" maxSize="5" flags="editable">
            <Types><Type type="MissileLauncher"/></Types>
          </ItemPort>
        </Part>
        <Part name="hardpoint_door_cargo" class="ItemPort">
          <ItemPort minSize="1" maxSize="1">
            <Types><Type type="Door"/></Types>
          </ItemPort>
        </Part>
        <Part name="hardpoint_lifesupport" class="ItemPort">
          <ItemPort minSize="3" maxSize="3">
            <Types><Type type="LifeSupportGenerator"/></Types>
          </ItemPort>
        </Part>
        <Part name="hardpoint_weapon_shadow" class="ItemPort">
          <ItemPort minSize="2" maxSize="2">
            <Types><Type type="WeaponGun"/></Types>
          </ItemPort>
        </Part>
        <Part name="body" class="AnimatedJoint" damageMax="4000"/>
      </Parts>
    </Part>
  </Parts>
</Vehicle>
"""

XML_PATH = "Scripts/Entities/Vehicles/Implementations/Xml/AEGS_Hammerhead.xml"


class _FakeInfo:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeP4K:
    def __init__(self, files: dict) -> None:
        self.files = files

    def namelist(self):
        return list(self.files)

    def getinfo(self, name):
        return _FakeInfo(name)

    def open(self, info):
        return io.BytesIO(self.files[info.name])


def _extractor(files: dict | None = None, items: dict | None = None) -> CodexExtractor:
    ex = CodexExtractor.__new__(CodexExtractor)
    ex.p4k = _FakeP4K(files or {})
    ex._vehicle_xml_cache = {}
    ex.on_log = lambda lvl, m: None
    catalog = items or {}
    ex._entity_class_comps = lambda cls: catalog.get(cls, [])
    return ex


def _container(*names):
    return {"_Type_": "SItemPortContainerComponentParams",
            "Ports": [{"Name": n, "MinSize": 1, "MaxSize": 1} for n in names]}


def _item(kind, *loadout):
    """Components of an item entity: its attach type + its own stock fit."""
    return [
        {"_Type_": "SAttachableComponentParams", "AttachDef": {"Type": kind}},
        {"_Type_": "SEntityComponentDefaultLoadoutParams", "loadout": {
            "_Type_": "SItemPortLoadoutManualParams",
            "entries": [{"itemPortName": p, "entityClassName": c, "loadout": None}
                        for p, c in loadout],
        }},
    ]


def _ship(*entries):
    return [{"_Type_": "SEntityComponentDefaultLoadoutParams", "loadout": {
        "_Type_": "SItemPortLoadoutManualParams", "entries": list(entries)}}]


def _entry(port, cls, children=None):
    return {"itemPortName": port, "entityClassName": cls,
            "loadout": ({"_Type_": "SItemPortLoadoutManualParams", "entries": children}
                        if children else None)}


class TestVehicleXmlWeaponPorts:
    VCP = {"vehicleDefinition": XML_PATH}

    def _ports(self, container=("hardpoint_lifesupport",), loadout=()):
        ex = _extractor({f"Data/{XML_PATH}": HAMMERHEAD_XML})
        comps = [_container(*container)]
        return ex._vehicle_xml_weapon_ports(self.VCP, comps, list(loadout))

    def test_turret_and_weapon_ports_come_from_the_xml(self):
        names = [p["portName"] for p in self._ports()]
        assert names == ["turret_top", "hardpoint_missile_top_left_01",
                         "hardpoint_weapon_shadow"]

    def test_port_shape_matches_the_container_rows(self):
        top = self._ports()[0]
        assert top == {"portName": "turret_top", "minSize": 5, "maxSize": 5,
                       "types": ["TurretBase"], "flags": ["$uneditable"],
                       "helperName": None}

    def test_non_weapon_xml_ports_stay_out(self):
        names = {p["portName"] for p in self._ports()}
        assert "hardpoint_door_cargo" not in names
        assert "hardpoint_lifesupport" not in names

    def test_a_container_port_is_never_listed_twice(self):
        names = [p["portName"] for p in
                 self._ports(container=("HARDPOINT_WEAPON_SHADOW",))]
        assert "hardpoint_weapon_shadow" not in names

    def test_casing_follows_the_default_loadout(self):
        ports = self._ports(loadout=[{"itemPortName": "Turret_Top"}])
        assert ports[0]["portName"] == "Turret_Top"

    def test_no_vehicle_xml_means_no_extra_ports(self):
        ex = _extractor({})
        assert ex._vehicle_xml_weapon_ports({"vehicleDefinition": XML_PATH},
                                            [_container()], []) == []
        assert ex._vehicle_xml_weapon_ports({}, [_container()], []) == []


class TestTurretStock:
    ITEMS = {
        "Turret_PDC_BEHR_A": _item("Turret", ("hardpoint_turret_weapon",
                                              "BEHR_LaserRepeater_PDC_S1")),
        "AEGS_Turret_Manned": _item("TurretBase", ("hardpoint_weapon_left",
                                                   "Stock_Gun_From_Item")),
        "AEGS_Seat_Pilot": _item("Seat", ("hardpoint_screen", "Vehicle_Screen_MFD")),
    }

    def _loadout(self, *entries):
        return _extractor(items=self.ITEMS)._ship_default_loadout(_ship(*entries))

    def test_pdc_turret_gets_the_gun_of_its_own_stock_fit(self):
        lo = self._loadout(_entry("hardpoint_pdc_01", "Turret_PDC_BEHR_A"))
        assert lo[0]["entries"] == [{"itemPortName": "hardpoint_turret_weapon",
                                     "entityClassName": "BEHR_LaserRepeater_PDC_S1"}]

    def test_ship_loadout_overrides_the_turret_stock(self):
        lo = self._loadout(_entry("Turret_Top", "AEGS_Turret_Manned", children=[
            _entry("hardpoint_weapon_left", "KLWE_LaserRepeater_S4")]))
        assert [e["entityClassName"] for e in lo[0]["entries"]] == ["KLWE_LaserRepeater_S4"]

    def test_non_turret_items_keep_what_the_ship_says(self):
        lo = self._loadout(_entry("hardpoint_seat_pilot", "AEGS_Seat_Pilot"),
                           _entry("hardpoint_paint", None))
        assert "entries" not in lo[0]
        assert lo[1] == {"itemPortName": "hardpoint_paint", "entityClassName": None}

    def test_each_turret_gets_its_own_copy(self):
        lo = self._loadout(_entry("hardpoint_pdc_01", "Turret_PDC_BEHR_A"),
                           _entry("hardpoint_pdc_02", "Turret_PDC_BEHR_A"))
        lo[0]["entries"][0]["entityClassName"] = "changed"
        assert lo[1]["entries"][0]["entityClassName"] == "BEHR_LaserRepeater_PDC_S1"
