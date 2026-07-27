"""Hardpoint POSITION extraction: Ivo node transforms + port -> helper joining.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/

Every case here also pins the promise the feature rests on: when the data is
missing or does not validate, the readers return NOTHING. A fabricated
coordinate would put a marker on the wrong part of a hull, which is worse than
an absent marker.
"""

from __future__ import annotations

import math
import struct

from sc_extract.geometry import (
    bbox_from_cga_bytes,
    helpers_from_cga_bytes,
    normalize_geometry_path,
)
from sc_extract.hardpoints import (
    hardpoint_frame,
    port_helper_name,
    resolve_hardpoint_transforms,
)

from ivo_builder import (
    NAME_CHUNK,
    NODE_CHUNK,
    ivo,
    matrix34,
    name_chunk,
    node_chunk,
    ship_mesh,
)

HELPERS = {
    "hardpoint_weapon_left": (-3.5, 2.0, 0.5),
    "hardpoint_weapon_right": (3.5, 2.0, 0.5),
    "hardpoint_shield_gen": (0.0, -1.25, -0.75),
}


class TestHelpersFromCga:
    def test_named_nodes_yield_model_space_positions(self):
        helpers = helpers_from_cga_bytes(ship_mesh(HELPERS))
        assert set(helpers) == set(HELPERS)
        for name, pos in HELPERS.items():
            assert helpers[name]["position"] == [round(v, 4) for v in pos]
            # identity basis -> identity quaternion
            assert helpers[name]["rotation"] == [0.0, 0.0, 0.0, 1.0]
            assert helpers[name]["localPosition"] == [round(v, 4) for v in pos]
            assert helpers[name]["index"] > 0  # node 0 is the unnamed root

    def test_rotation_block_becomes_a_unit_quaternion(self):
        # 90° yaw about Z, row-major basis rows.
        rot = ((0.0, -1.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0))
        names = {"hardpoint_turret": 1}
        record = bytearray(matrix34((1.0, 2.0, 3.0), rot) + matrix34((1.0, 2.0, 3.0), rot))
        record.extend(b"\x00" * (208 - len(record)))
        root = bytearray(matrix34((0.0, 0.0, 0.0)) + matrix34((0.0, 0.0, 0.0)))
        root.extend(b"\x00" * (208 - len(root)))
        nodes_blob = bytearray(struct.pack("<8I", 0, 2, 0, 0, 0, 0, 0, 0))
        nodes_blob.extend(b"\x00" * (64 - len(nodes_blob)))
        nodes_blob.extend(root)
        nodes_blob.extend(record)
        raw = ivo([(NAME_CHUNK, name_chunk(names)), (NODE_CHUNK, bytes(nodes_blob))])
        q = helpers_from_cga_bytes(raw)["hardpoint_turret"]["rotation"]
        assert math.isclose(sum(v * v for v in q), 1.0, abs_tol=1e-4)
        assert math.isclose(q[2], math.sqrt(0.5), abs_tol=1e-4)  # z component of a 90° yaw

    def test_unknown_strings_do_not_create_nodes(self):
        # A material name in the string blob has no entry in the CRC table.
        names = {"hardpoint_weapon_left": 1}
        nodes = [((0.0, 0.0, 0.0), (0.0, 0.0, 0.0)), ((1.0, 1.0, 1.0), (1.0, 1.0, 1.0))]
        raw = ivo([
            (NAME_CHUNK, name_chunk(names, extra_strings=("some_material", "proxy_mat"))),
            (NODE_CHUNK, node_chunk(nodes)),
        ])
        assert list(helpers_from_cga_bytes(raw)) == ["hardpoint_weapon_left"]

    def test_non_ivo_input_returns_nothing(self):
        assert helpers_from_cga_bytes(b"") == {}
        assert helpers_from_cga_bytes(b"not a mesh at all") == {}
        assert helpers_from_cga_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 512) == {}

    def test_missing_name_chunk_returns_nothing(self):
        nodes = [((0.0, 0.0, 0.0), (0.0, 0.0, 0.0)), ((1.0, 2.0, 3.0), (1.0, 2.0, 3.0))]
        assert helpers_from_cga_bytes(ivo([(NODE_CHUNK, node_chunk(nodes))])) == {}

    def test_missing_node_chunk_returns_nothing(self):
        raw = ivo([(NAME_CHUNK, name_chunk({"hardpoint_weapon_left": 1}))])
        assert helpers_from_cga_bytes(raw) == {}

    def test_garbage_node_records_return_nothing(self):
        # Node payload full of 0xFF: no stride makes every rotation orthonormal.
        blob = bytearray(struct.pack("<8I", 0, 3, 0, 0, 0, 0, 0, 0))
        blob.extend(b"\x00" * (64 - len(blob)))
        blob.extend(b"\xff" * (3 * 208))
        raw = ivo([
            (NAME_CHUNK, name_chunk({"hardpoint_weapon_left": 1})),
            (NODE_CHUNK, bytes(blob)),
        ])
        assert helpers_from_cga_bytes(raw) == {}

    def test_index_out_of_range_is_dropped(self):
        nodes = [((0.0, 0.0, 0.0), (0.0, 0.0, 0.0)), ((1.0, 2.0, 3.0), (1.0, 2.0, 3.0))]
        raw = ivo([
            (NAME_CHUNK, name_chunk({"hardpoint_weapon_left": 99})),
            (NODE_CHUNK, node_chunk(nodes)),
        ])
        assert helpers_from_cga_bytes(raw) == {}

    def test_implausible_coordinate_is_dropped(self):
        helpers = helpers_from_cga_bytes(
            ship_mesh({"hardpoint_far_away": (0.0, 5.0e6, 0.0), "hardpoint_ok": (1.0, 2.0, 3.0)})
        )
        assert list(helpers) == ["hardpoint_ok"]

    def test_nan_position_is_dropped(self):
        helpers = helpers_from_cga_bytes(
            ship_mesh({"hardpoint_nan": (float("nan"), 0.0, 0.0), "hardpoint_ok": (1.0, 2.0, 3.0)})
        )
        assert list(helpers) == ["hardpoint_ok"]


class TestBboxFromCga:
    def test_aabb_chunk_yields_metre_extents(self):
        raw = ship_mesh(HELPERS, bbox=((-4.0, -8.0, -1.5), (4.0, 8.0, 2.5)))
        dims = bbox_from_cga_bytes(raw)
        assert dims is not None
        assert dims["width"] == 8.0
        assert dims["length"] == 16.0
        assert dims["height"] == 4.0
        assert dims["min"] == [-4.0, -8.0, -1.5]

    def test_no_geometry_returns_none(self):
        assert bbox_from_cga_bytes(b"nope") is None


class TestNormalizeGeometryPath:
    def test_roots_and_normalises(self):
        assert (
            normalize_geometry_path("Objects\\Spaceships\\Ships\\AEGS\\Gladius\\AEGS_Gladius.cga")
            == "Data/Objects/Spaceships/Ships/AEGS/Gladius/AEGS_Gladius.cga"
        )

    def test_rejects_non_mesh(self):
        assert normalize_geometry_path("Data/foo/bar.mtl") is None
        assert normalize_geometry_path(None) is None


class TestPortHelperName:
    def test_documented_nesting(self):
        port = {
            "Name": "hardpoint_weapon_left",
            "AttachmentImplementation": {
                "Helper": {"Helper": {"Name": "hardpoint_weapon_left_mesh"}}
            },
        }
        assert port_helper_name(port) == "hardpoint_weapon_left_mesh"

    def test_deep_fallback_when_nesting_moved(self):
        port = {
            "Name": "hardpoint_turret",
            "Attachment": {"HelperImpl": {"attachHelper": {"name": "  turret_base  "}}},
        }
        assert port_helper_name(port) == "turret_base"

    def test_no_helper_reference(self):
        assert port_helper_name({"Name": "hardpoint_weapon_left"}) is None
        assert port_helper_name(None) is None
        assert port_helper_name({"AttachmentImplementation": {"Helper": {}}}) is None


class TestResolveHardpointTransforms:
    def setup_method(self):
        self.helpers = helpers_from_cga_bytes(ship_mesh(HELPERS))

    def test_helper_name_wins_and_is_flagged(self):
        ports = [{"portName": "weapon_left", "helperName": "hardpoint_weapon_left"}]
        out = resolve_hardpoint_transforms(self.helpers, item_ports=ports,
                                           include_mesh_hardpoints=False)
        assert out["weapon_left"]["source"] == "helper"
        assert out["weapon_left"]["helper"] == "hardpoint_weapon_left"
        assert out["weapon_left"]["position"] == [-3.5, 2.0, 0.5]

    def test_port_name_matches_node_name_case_insensitively(self):
        ports = [{"portName": "HARDPOINT_Weapon_Right", "helperName": None}]
        out = resolve_hardpoint_transforms(self.helpers, item_ports=ports,
                                           include_mesh_hardpoints=False)
        assert out["HARDPOINT_Weapon_Right"]["source"] == "portName"
        assert out["HARDPOINT_Weapon_Right"]["position"] == [3.5, 2.0, 0.5]

    def test_loadout_port_names_resolve_too(self):
        out = resolve_hardpoint_transforms(
            self.helpers,
            loadout_port_names=["hardpoint_shield_gen", None, "", "does_not_exist"],
            include_mesh_hardpoints=False,
        )
        assert list(out) == ["hardpoint_shield_gen"]
        assert out["hardpoint_shield_gen"]["position"] == [0.0, -1.25, -0.75]

    def test_unknown_helper_yields_no_entry(self):
        ports = [{"portName": "weapon_left", "helperName": "hardpoint_weapon_lefT_v2"}]
        assert resolve_hardpoint_transforms(self.helpers, item_ports=ports,
                                            include_mesh_hardpoints=False) == {}

    def test_no_prefix_or_fuzzy_matching(self):
        # "hardpoint_weapon" is a prefix of a real node — it must NOT match.
        ports = [{"portName": "hardpoint_weapon", "helperName": None}]
        assert resolve_hardpoint_transforms(self.helpers, item_ports=ports,
                                            include_mesh_hardpoints=False) == {}

    def test_mesh_hardpoints_included_and_flagged(self):
        out = resolve_hardpoint_transforms(self.helpers)
        assert set(out) == set(HELPERS)
        assert {e["source"] for e in out.values()} == {"mesh"}

    def test_non_hardpoint_nodes_are_not_included(self):
        helpers = helpers_from_cga_bytes(
            ship_mesh({"hardpoint_weapon_left": (1.0, 0.0, 0.0), "wing_left_geom": (2.0, 0.0, 0.0)})
        )
        assert list(resolve_hardpoint_transforms(helpers)) == ["hardpoint_weapon_left"]

    def test_port_entries_survive_the_cap(self):
        many = {f"hardpoint_extra_{i:03d}": (float(i), 0.0, 0.0) for i in range(40)}
        many["hardpoint_weapon_left"] = (-3.5, 2.0, 0.5)
        helpers = helpers_from_cga_bytes(ship_mesh(many))
        out = resolve_hardpoint_transforms(
            helpers,
            item_ports=[{"portName": "weapon_left", "helperName": "hardpoint_weapon_left"}],
            max_entries=5,
        )
        assert len(out) == 5
        assert out["weapon_left"]["source"] == "helper"

    def test_no_helpers_no_transforms(self):
        assert resolve_hardpoint_transforms({}, item_ports=[{"portName": "x"}]) == {}


class TestHardpointFrame:
    def test_prefers_the_hull_bounding_box(self):
        dims = {"min": [-4.0, -8.0, -1.5], "max": [4.0, 8.0, 2.5]}
        frame = hardpoint_frame([[-3.5, 2.0, 0.5], [3.5, 2.0, 0.5]], dims)
        assert frame == {"min": [-4.0, -8.0, -1.5], "max": [4.0, 8.0, 2.5], "source": "bbox"}

    def test_tolerates_a_hardpoint_just_outside_the_box(self):
        dims = {"min": [-4.0, -8.0, -1.5], "max": [4.0, 8.0, 2.5]}
        frame = hardpoint_frame([[-4.2, 2.0, 0.5]], dims)
        assert frame["source"] == "bbox"

    def test_falls_back_when_the_box_is_a_different_frame(self):
        # Points nowhere near the box -> the two are not a shared space.
        dims = {"min": [-4.0, -8.0, -1.5], "max": [4.0, 8.0, 2.5]}
        frame = hardpoint_frame([[120.0, 40.0, 10.0], [100.0, 20.0, 0.0]], dims)
        assert frame["source"] == "ports"
        assert frame["min"][0] < 100.0 and frame["max"][0] > 120.0

    def test_falls_back_without_dimensions(self):
        frame = hardpoint_frame([[-1.0, -2.0, -3.0], [1.0, 2.0, 3.0]])
        assert frame["source"] == "ports"
        assert frame["min"][1] < -2.0 and frame["max"][1] > 2.0

    def test_single_point_still_yields_a_usable_span(self):
        frame = hardpoint_frame([[1.0, 2.0, 3.0]])
        assert frame is not None
        assert all(frame["max"][i] > frame["min"][i] for i in range(3))

    def test_no_points_no_frame(self):
        assert hardpoint_frame([]) is None
        assert hardpoint_frame([[1.0, 2.0]]) is None  # malformed vec
        assert hardpoint_frame([[float("nan"), 0.0, 0.0]]) is None

    def test_degenerate_box_is_ignored(self):
        dims = {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}
        assert hardpoint_frame([[1.0, 1.0, 1.0]], dims)["source"] == "ports"
