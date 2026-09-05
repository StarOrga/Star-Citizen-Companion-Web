"""Ship hull HP / hull mass / armour HP / cargo SCU projections.

Sources (VERIFIED against LIVE 4.9.0, `scripts/probe_hull_cargo.py`):

* hull HP + mass: the CryXmlB vehicle implementation XML referenced by
  `VehicleComponentParams.vehicleDefinition` — Σ `Part@damageMax` and the root
  `Part@mass`. Nomad 9 800 HP / 216 323 kg, Gladius 6 110, Freelancer 34 900.
* armour HP: the per-hull `ARMR_<Ship>` item's `SHealthComponentParams.Health`
  (Nomad 2 200, Hammerhead 25 740).
* cargo SCU: the ship's cargo grid → `InventoryContainer.interiorDimensions`,
  volume in metres ÷ 1.25³ (one SCU = a 1.25 m cube).

The XML fixtures below are trimmed real files (plain-text XML — the CryXmlB
decode path is exercised by the live probe, not by unit tests, since encoding
a CryXmlB blob in a fixture would test scdatatools, not us).
"""

from __future__ import annotations

import io

from sc_extract.dataforge_extract import CodexExtractor

NOMAD_XML = b"""<?xml version="1.0"?>
<Vehicle name="CNOU_Nomad">
  <Parts>
    <Part name="CNOU_Nomad" class="Animated" mass="216323">
      <Parts>
        <Part name="body" class="AnimatedJoint" damageMax="4000"/>
        <Part name="wing_left" class="AnimatedJoint" damageMax="2900"/>
        <Part name="wing_right" class="AnimatedJoint" damageMax="2900"/>
        <Part name="landingpad_helper" class="Helper"/>
      </Parts>
    </Part>
  </Parts>
</Vehicle>
"""

# Idris-P reuses the base hull's XML, whose root part is named "AEGS_Idris" —
# the name match misses, so the root part's mass must still be found.
IDRIS_XML = b"""<?xml version="1.0"?>
<Vehicle name="AEGS_Idris">
  <Parts>
    <Part name="AEGS_Idris" class="Animated" mass="37854373">
      <Parts>
        <Part name="Body" class="AnimatedJoint" damageMax="1500000"/>
      </Parts>
    </Part>
  </Parts>
</Vehicle>
"""


class _FakeInfo:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeP4K:
    """Minimal stand-in for scdatatools' P4KFile (namelist/getinfo/open)."""

    def __init__(self, files: dict) -> None:
        self.files = files

    def namelist(self):
        return list(self.files)

    def getinfo(self, name):
        return _FakeInfo(name)

    def open(self, info):
        return io.BytesIO(self.files[info.name])


def _extractor(files: dict | None = None) -> CodexExtractor:
    ex = CodexExtractor.__new__(CodexExtractor)
    ex.p4k = _FakeP4K(files or {})
    ex._vehicle_xml_cache = {}
    ex.on_log = lambda lvl, m: None
    return ex


def _vcp(path: str) -> dict:
    return {"_Type_": "VehicleComponentParams", "vehicleDefinition": path}


def test_hull_hp_is_the_sum_of_part_damage_max() -> None:
    ex = _extractor({"Data/Scripts/Entities/Vehicles/Implementations/Xml/CNOU_Nomad.xml": NOMAD_XML})
    hull = ex._hull_stats(
        _vcp("Scripts/Entities/Vehicles/Implementations/Xml/CNOU_Nomad.xml"),
        "CNOU_Nomad")
    assert hull == {"hp": 9800.0, "mass": 216323.0}


def test_hull_mass_falls_back_to_the_root_part() -> None:
    """A variant (Idris-P) points at the base hull's XML, whose root part is
    named after the BASE ship — the mass must not silently go null."""
    ex = _extractor({"Data/scripts/entities/vehicles/implementations/xml/aegs_idris.xml": IDRIS_XML})
    hull = ex._hull_stats(
        _vcp("scripts/entities/vehicles/implementations/xml/aegs_idris.xml"),
        "AEGS_Idris_P")
    assert hull["mass"] == 37854373.0
    assert hull["hp"] == 1500000.0


def test_missing_vehicle_xml_yields_nulls_not_zeros() -> None:
    ex = _extractor()
    assert ex._hull_stats(_vcp("Scripts/Nope.xml"), "X") == {"hp": None, "mass": None}
    assert ex._hull_stats({"_Type_": "VehicleComponentParams"}, "X") == {"hp": None, "mass": None}


def test_hull_xml_is_parsed_once_per_path() -> None:
    files = {"Data/Scripts/Entities/Vehicles/Implementations/Xml/CNOU_Nomad.xml": NOMAD_XML}
    ex = _extractor(files)
    path = "Scripts/Entities/Vehicles/Implementations/Xml/CNOU_Nomad.xml"
    first = ex._vehicle_xml_root(path)
    files.clear()  # a second read would now fail
    assert ex._vehicle_xml_root(path) is first


def test_armor_hp_reads_the_per_hull_armour_item() -> None:
    ex = _extractor()
    seen = []

    def _comps(class_name: str):
        seen.append(class_name)
        return [{"_Type_": "SHealthComponentParams", "Health": 2200.0}]

    ex._entity_class_comps = _comps
    assert ex._armor_hp("CNOU_Nomad") == 2200.0
    assert seen == ["ARMR_CNOU_Nomad"]


def test_armor_hp_is_none_without_an_armour_item() -> None:
    ex = _extractor()
    ex._entity_class_comps = lambda class_name: []
    assert ex._armor_hp("CNOU_Nomad") is None


def _grid_comps(x: float, y: float, z: float) -> list:
    return [{
        "_Type_": "SCItemInventoryContainerComponentParams",
        "containerParams": {
            "_Type_": "InventoryContainer",
            "interiorDimensions": {"_Type_": "Vec3", "x": x, "y": y, "z": z},
        },
    }]


def test_cargo_scu_from_the_grids_interior_volume() -> None:
    """Nomad: one 2.5 × 2.5 × 7.5 m grid = 46.875 m³ = 24 SCU (1 SCU = 1.25³)."""
    ex = _extractor()
    ex._entity_class_comps = lambda class_name: (
        _grid_comps(2.5, 2.5, 7.5) if "CargoGrid" in class_name else [])
    loadout = [{"itemPortName": "hardpoint_cargo_grid",
                "entityClassName": "CNOU_Nomad_CargoGrid"}]
    assert ex._cargo_scu(loadout) == 24.0


def test_cargo_scu_sums_every_grid() -> None:
    ex = _extractor()
    ex._entity_class_comps = lambda class_name: _grid_comps(1.25, 1.25, 12.5)
    loadout = [
        {"itemPortName": "hardpoint_cargo_grid_a", "entityClassName": "A_CargoGrid"},
        {"itemPortName": "hardpoint_cargo_grid_b", "entityClassName": "B_CargoGrid"},
    ]
    assert ex._cargo_scu(loadout) == 20.0


def test_cargo_scu_is_none_without_a_grid() -> None:
    """A fighter has no cargo grid at all — the figure must be null, never 0
    (0 SCU and "no cargo hold" are different statements in the UI)."""
    ex = _extractor()
    ex._entity_class_comps = lambda class_name: []
    assert ex._cargo_scu([{"itemPortName": "hardpoint_weapon_left",
                           "entityClassName": "Mount_Gimbal_S3"}]) is None


def test_cargo_status_measured_when_a_grid_yields_a_volume() -> None:
    ex = _extractor()
    ex._entity_class_comps = lambda class_name: (
        _grid_comps(2.5, 2.5, 7.5) if "CargoGrid" in class_name else [])
    loadout = [{"itemPortName": "hardpoint_cargo_grid",
                "entityClassName": "Ship_CargoGrid"}]
    assert ex._cargo_status(loadout) == "measured"


def test_cargo_status_unmeasured_for_the_nomads_open_bed() -> None:
    """VERIFIED LIVE 4.9.0: the Nomad's 87-entry stock loadout carries NO
    inventory container — its bed is a `Door_..._Cargo_Bed`. `cargoScu` is
    rightly null, but the hull DOES haul, so the page must disclose a gap
    instead of claiming "Kein Laderaum"."""
    ex = _extractor()
    ex._entity_class_comps = lambda class_name: []
    loadout = [{"itemPortName": "hardpoint_cargo_bed",
                "entityClassName": "Door_Ship_Exterior_CNOU_Nomad_Cargo_Bed"}]
    assert ex._cargo_scu(loadout) is None
    assert ex._cargo_status(loadout) == "unmeasured"


def test_cargo_status_none_for_a_fighter() -> None:
    ex = _extractor()
    ex._entity_class_comps = lambda class_name: []
    loadout = [{"itemPortName": "hardpoint_weapon_left",
                "entityClassName": "Mount_Gimbal_S3"}]
    assert ex._cargo_status(loadout) == "none"


def test_cargo_scu_walks_nested_loadout_entries() -> None:
    ex = _extractor()
    ex._entity_class_comps = lambda class_name: (
        _grid_comps(2.5, 2.5, 2.5) if class_name == "Pod_CargoGrid" else [])
    loadout = [{
        "itemPortName": "hardpoint_pod",
        "entityClassName": "Cargo_Pod",
        "entries": [{"itemPortName": "cargo_grid", "entityClassName": "Pod_CargoGrid"}],
    }]
    assert ex._cargo_scu(loadout) == 8.0
