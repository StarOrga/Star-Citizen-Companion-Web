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


def test_armor_hp_follows_the_loadout_armour_item_of_a_variant() -> None:
    # LIVE 4.10.2: MISC_Starlancer_Max fits ARMR_MISC_Starlancer (12 100 HP,
    # erkul/FleetYards); ARMR_MISC_Starlancer_Max does not exist, so the old
    # class-name guess left the MAX without any armour value.
    ex = _extractor()
    seen = []
    table = {"ARMR_MISC_Starlancer": 12100.0}

    def _comps(class_name: str):
        seen.append(class_name)
        hp = table.get(class_name)
        return [{"_Type_": "SHealthComponentParams", "Health": hp}] if hp else []

    ex._entity_class_comps = _comps
    loadout = [{"itemPortName": "hardpoint_armour",
                "entityClassName": "ARMR_MISC_Starlancer"}]
    assert ex._armor_hp("MISC_Starlancer_Max", loadout) == 12100.0
    assert seen == ["ARMR_MISC_Starlancer"]


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


def test_cargo_status_none_for_the_nomads_open_bed() -> None:
    """VERIFIED LIVE 4.9.0 / 4.10.2: the Nomad's stock loadout carries NO
    inventory container — its bed is a `Door_..._Cargo_Bed` with no stock fit
    of its own, and its interior containers place no grid either. The files
    define no hold, so the status is `none`; an SCU is never invented (#842)."""
    ex = _extractor()
    ex._entity_class_comps = lambda class_name: []
    loadout = [{"itemPortName": "hardpoint_cargo_bed",
                "entityClassName": "Door_Ship_Exterior_CNOU_Nomad_Cargo_Bed"}]
    assert ex._cargo_scu(loadout) is None
    assert ex._cargo_status(loadout) == "none"


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


def _own_loadout(*entries) -> list:
    return [{"_Type_": "SEntityComponentDefaultLoadoutParams", "loadout": {"entries": [
        {"itemPortName": port, "entityClassName": cls} for port, cls in entries]}}]


def test_cargo_follows_the_installed_items_own_stock_fit() -> None:
    """VERIFIED LIVE 4.10.2 (#842): the Mustang Alpha lists only its
    `CNOU_Mustang_Cargo_Rack`; the grid hangs in the RACK's own default loadout
    (4 SCU), like the Constellation's bay door and the 400i lift."""
    ex = _extractor()
    comps = {
        "CNOU_Mustang_Cargo_Rack": _own_loadout(("hardpoint_cargo_grid", "CNOU_Mustang_CargoGrid_Main"),
                                                ("hardpoint_cargo_box_01", "CNOU_Mustang_Cargo_Box_Fake")),
        "CNOU_Mustang_CargoGrid_Main": _grid_comps(1.25, 2.5, 2.5),
    }
    ex._entity_class_comps = lambda c: comps.get(c, [])
    loadout = [{"itemPortName": "hardpoint_cargo_module", "entityClassName": "CNOU_Mustang_Cargo_Rack"}]
    assert ex._cargo_scu(loadout) == 4.0
    assert ex._cargo_status(loadout) == "measured"


def test_a_listed_sub_item_is_not_counted_twice() -> None:
    """When the ship's loadout already lists the item's sub-items, its own
    stock fit is NOT walked as well — the grid would count twice."""
    ex = _extractor()
    comps = {
        "Pod": _own_loadout(("cargo_grid", "Pod_CargoGrid")),
        "Pod_CargoGrid": _grid_comps(2.5, 2.5, 2.5),
    }
    ex._entity_class_comps = lambda c: comps.get(c, [])
    loadout = [{"itemPortName": "hardpoint_cargo_pod", "entityClassName": "Pod",
                "entries": [{"itemPortName": "cargo_grid", "entityClassName": "Pod_CargoGrid"}]}]
    assert ex._cargo_scu(loadout) == 8.0


def test_ore_pods_count_by_their_resource_container_capacity() -> None:
    """VERIFIED LIVE 4.10.2: a Prospector carries four 8-SCU ore pods and four
    collapsed 0-SCU ones — 32 SCU, read from `ResourceContainer.capacity`."""
    ex = _extractor()

    def pod(scu: float) -> list:
        return [{"_Type_": "ResourceContainer",
                 "capacity": {"_Type_": "SStandardCargoUnit", "standardCargoUnits": scu}}]
    comps = {"Cargo_ShipMining_Pod_Prospector": pod(8.0),
             "Cargo_ShipMining_Pod_Prospector_Collapsed": pod(0.0),
             "HTNK_Prospector": pod(999.0)}
    ex._entity_class_comps = lambda c: comps.get(c, [])
    loadout = (
        [{"itemPortName": f"hardpoint_mining_pod_{i}", "entityClassName": "Cargo_ShipMining_Pod_Prospector"}
         for i in range(4)]
        + [{"itemPortName": f"hardpoint_stored_pod_{i}", "entityClassName": "Cargo_ShipMining_Pod_Prospector_Collapsed"}
           for i in range(4)]
        # A fuel tank is a resource container too, but no cargo entry.
        + [{"itemPortName": "hardpoint_fuel_tank", "entityClassName": "HTNK_Prospector"}]
    )
    assert ex._cargo_scu(loadout) == 32.0


def test_an_ore_pod_with_an_inventory_box_counts_its_ore_capacity() -> None:
    """VERIFIED LIVE 4.10.2: the ROC-DS ore pod carries BOTH a 3.4 SCU
    `ResourceContainer` and a hand-load inventory box of 1.28 SCU. The ore
    capacity is the one the wiki / erkul list; the box understated it."""
    ex = _extractor()
    comps = {"Cargo_GroundVehicleMining_Pod_ROC_DS": [
        {"_Type_": "ResourceContainer",
         "capacity": {"_Type_": "SStandardCargoUnit", "standardCargoUnits": 3.4}},
        {"_Type_": "SCItemInventoryContainerComponentParams",
         "containerParams": {"interiorDimensions": {"x": 1.25, "y": 1.25, "z": 1.6}}},
    ]}
    ex._entity_class_comps = lambda c: comps.get(c, [])
    loadout = [{"itemPortName": "hardpoint_cargogrid_main",
                "entityClassName": "Cargo_GroundVehicleMining_Pod_ROC_DS"}]
    assert ex._cargo_scu(loadout) == 3.4


def test_a_grid_without_a_container_holds_nothing() -> None:
    """VERIFIED LIVE 4.10.2: the Ursa Rover's and Javelin's grids carry
    `containerParams: null` — no container in the game files, so no hold."""
    ex = _extractor()
    ex._entity_class_comps = lambda c: [{"_Type_": "SCItemInventoryContainerComponentParams",
                                         "containerParams": None}]
    loadout = [{"itemPortName": "hardpoint_cargogrid", "entityClassName": "RSI_Ursa_CargoGrid_Rear"}]
    assert ex._cargo_status(loadout) == "none"


def test_cargo_status_unmeasured_only_for_an_unresolvable_container_record() -> None:
    class _NoRecords:
        def record_by_id(self, guid):
            return None
    ex = _extractor()
    ex.df = _NoRecords()
    ex._entity_class_comps = lambda c: [{"_Type_": "SCItemInventoryContainerComponentParams",
                                         "containerParams": {"_RecordId_": "x-1", "_RecordName_": "InventoryContainer.X"}}]
    loadout = [{"itemPortName": "hardpoint_cargo_grid", "entityClassName": "X_CargoGrid"}]
    assert ex._cargo_scu(loadout) is None
    assert ex._cargo_status(loadout) == "unmeasured"


ROC_XML = b"""<?xml version="1.0"?>
<Vehicle name="GRIN_ROC">
  <Parts><Part name="GRIN_ROC" mass="2000"/></Parts>
  <MovementParams id="xmlMovement"><PhysicalWheeled><Handling>
    <Power acceleration="10" decceleration="10" topSpeed="32" reverseSpeed="19"/>
  </Handling></PhysicalWheeled></MovementParams>
</Vehicle>
"""


def test_a_ground_vehicle_gets_its_top_speed_from_the_vehicle_xml() -> None:
    path = "scripts/entities/vehicles/implementations/xml/grin_roc.xml"
    ex = _extractor({"Data/" + path: ROC_XML})
    empty = {k: None for k in ("scmSpeed", "maxSpeed", "boostSpeed", "pitch", "yaw", "roll")}
    vcp = {"vehicleDefinition": path, "movementClass": "ArcadeWheeled"}
    out = ex._ground_speed(vcp, empty)
    assert out["maxSpeed"] == 32.0 and out["reverseSpeed"] == 19.0
    assert out["scmSpeed"] is None


def test_a_spaceship_flight_block_is_left_alone() -> None:
    ex = _extractor({})
    flight = {"scmSpeed": 160.0, "maxSpeed": 990.0}
    assert ex._ground_speed({"movementClass": "Spaceship"}, flight) is flight


def test_fuel_capacity_sums_the_stock_tanks() -> None:
    ex = _extractor({})

    def tank(scu: float) -> list:
        return [{"_Type_": "ResourceContainer",
                 "capacity": {"_Type_": "SStandardCargoUnit", "standardCargoUnits": scu}}]
    comps = {"HTNK_MISC_Starlancer": tank(32.1), "QTNK_MISC_Starlancer": tank(8.6)}
    ex._entity_class_comps = lambda c: comps.get(c, [])
    loadout = [{"itemPortName": "hardpoint_fuel_1", "entityClassName": "HTNK_MISC_Starlancer"},
               {"itemPortName": "hardpoint_quantum_fuel_1", "entityClassName": "QTNK_MISC_Starlancer"}]
    assert ex._fuel_capacity(loadout) == {"hydrogen": 32.1, "quantum": 8.6}
    assert ex._fuel_capacity([]) == {"hydrogen": None, "quantum": None}
