"""#794: helper offsets and the origin guard in hardpoint resolution.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/

VERIFIED against LIVE 4.x (probe 2026-10-25): AEGS_Idris_P's PDC ports attach
to the hull ROOT node ``AEGS_Idris`` (at the origin) and carry their real
position only in ``AttachmentImplementation.Helper.Helper.Offset``
(``hardpoint_pdc_01``: 0 / 39 / 10.51). Before #794 95 Idris-P transforms were
emitted at 0 / 0 / 0.
"""

from __future__ import annotations

import math

from sc_extract.hardpoints import port_helper_offset, resolve_hardpoint_transforms

ROOT = {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0, 1.0], "index": 0}
NOSE = {"position": [0.0, 30.0, 2.0], "rotation": [0.0, 0.0, 0.0, 1.0], "index": 1}


def raw_port(name, helper, offset=None):
    """An SItemPortDef as record_to_dict emits it (only the fields used here)."""
    return {
        "Name": name,
        "AttachmentImplementation": {
            "_Type_": "SItemPortDefAttachmentImplementationBone",
            "Helper": {"Helper": {
                "Name": helper,
                "Offset": {"_Type_": "QuatT",
                           "Rotation": {"x": 0, "y": 0, "z": 0},
                           "Position": ({"x": offset[0], "y": offset[1], "z": offset[2]}
                                        if offset else {"x": 0, "y": 0, "z": 0})},
            }},
        },
    }


class TestPortHelperOffset:
    def test_reads_the_quatt_position(self):
        assert port_helper_offset(raw_port("hardpoint_pdc_01", "AEGS_Idris",
                                           (0, 39, 10.51))) == [0.0, 39.0, 10.51]

    def test_zero_or_missing_offset_is_none(self):
        assert port_helper_offset(raw_port("p", "n")) is None
        assert port_helper_offset({"Name": "p"}) is None
        assert port_helper_offset(None) is None


class TestOffsetAndOriginGuard:
    HELPERS = {"AEGS_Idris": ROOT, "hardpoint_nose": NOSE}

    def _resolve(self, ports, loadout=(), unresolved=None):
        return resolve_hardpoint_transforms(self.HELPERS, item_ports=ports,
                                            loadout_port_names=loadout,
                                            include_mesh_hardpoints=False,
                                            unresolved=unresolved, reject_origin=True)

    def test_root_helper_plus_offset_gives_the_real_position(self):
        out = self._resolve([{"portName": "hardpoint_pdc_01", "helperName": "AEGS_Idris",
                              "helperOffset": [0.0, 39.0, 10.51]}])
        assert out["hardpoint_pdc_01"]["position"] == [0.0, 39.0, 10.51]
        assert out["hardpoint_pdc_01"]["helper"] == "AEGS_Idris"
        assert out["hardpoint_pdc_01"]["source"] == "helper"

    def test_offset_is_rotated_into_the_node_frame(self):
        # 90 deg about +Z: the node's local +X points along model +Y.
        s = math.sin(math.pi / 4)
        helpers = {"turret_base": {"position": [5.0, 0.0, 0.0],
                                   "rotation": [0.0, 0.0, s, s], "index": 2}}
        out = resolve_hardpoint_transforms(
            helpers, item_ports=[{"portName": "gun", "helperName": "turret_base",
                                  "helperOffset": [1.0, 0.0, 0.0]}],
            include_mesh_hardpoints=False)
        assert out["gun"]["position"] == [5.0, 1.0, 0.0]

    def test_a_port_on_the_origin_is_reported_not_emitted(self):
        unresolved = []
        out = self._resolve([{"portName": "hardpoint_controller_fuel",
                              "helperName": "AEGS_Idris"}], unresolved=unresolved)
        assert "hardpoint_controller_fuel" not in out
        assert unresolved == ["hardpoint_controller_fuel"]

    def test_origin_helper_falls_back_to_a_real_node_of_the_port_name(self):
        unresolved = []
        out = self._resolve([{"portName": "hardpoint_nose", "helperName": "AEGS_Idris"}],
                            unresolved=unresolved)
        assert out["hardpoint_nose"]["position"] == [0.0, 30.0, 2.0]
        assert out["hardpoint_nose"]["source"] == "portName"
        assert unresolved == []

    def test_ports_without_offset_keep_their_node_position(self):
        out = self._resolve([{"portName": "x", "helperName": "hardpoint_nose"}])
        assert out["x"]["position"] == [0.0, 30.0, 2.0]

    def test_unresolved_is_optional(self):
        assert self._resolve([{"portName": "p", "helperName": "AEGS_Idris"}]) == {}

    def test_sub_entities_keep_origin_placements_by_default(self):
        # A gun on its turret's pivot sits at the parent's local origin.
        out = resolve_hardpoint_transforms(
            {"pivot": ROOT}, item_ports=[{"portName": "gun", "helperName": "pivot"}],
            include_mesh_hardpoints=False)
        assert out["gun"]["position"] == [0.0, 0.0, 0.0]
