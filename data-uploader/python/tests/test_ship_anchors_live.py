"""#643 end to end: a LIVE-4.x-shaped hull -> ships/<class>.json ->
`_ship_anchor_inputs` -> non-empty silhouette anchors.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/

Before #643 every one of the 332 prod `codex_silhouettes` ship rows carried
`anchors: []`, because the hull's node names were unreadable on LIVE 4.x and
`hardpointTransforms` was written empty. This pins the whole hand-off.
"""

from __future__ import annotations

import json

from sc_extract.geometry import bbox_from_cga_bytes, helpers_from_cga_bytes
from sc_extract.hardpoints import hardpoint_frame, resolve_hardpoint_transforms
from sc_extract.silhouette import build_entity_silhouette
from sc_extract.silhouette_build import _ship_anchor_inputs

from ivo_builder import live_ship_mesh

HELPERS = {
    "hardpoint_gun_nose": (0.0, 7.5, -0.5),
    "hardpoint_weapon_left": (-2.5, 0.0, 0.0),
    "hardpoint_weapon_right": (2.5, 0.0, 0.0),
}
BBOX = ((-3.0, -8.0, -1.0), (3.0, 8.0, 1.5))


def _hull_triangles():
    """A flat 6 m x 16 m deck covering the bbox footprint (Cry X/Y)."""
    (x0, y0, _), (x1, y1, _) = BBOX
    return [((x0, y0, 0.0), (x1, y0, 0.0), (x1, y1, 0.0)),
            ((x0, y0, 0.0), (x1, y1, 0.0), (x0, y1, 0.0))]


def _write_ship_json(out_dir, class_name: str) -> None:
    raw = live_ship_mesh(HELPERS, bbox=BBOX)
    helpers = helpers_from_cga_bytes(raw)
    loadout = ["hardpoint_gun_nose", "hardpoint_weapon_left", "hardpoint_weapon_right"]
    transforms = resolve_hardpoint_transforms(helpers, item_ports=[], loadout_port_names=loadout)
    frame = hardpoint_frame([t["position"] for t in transforms.values()], bbox_from_cga_bytes(raw))
    ship = {
        "className": class_name,
        "itemPorts": [],
        "defaultLoadout": [{"itemPortName": n} for n in loadout + ["hardpoint_not_on_mesh"]],
        "hardpointTransforms": transforms,
        "hardpointFrame": frame,
    }
    (out_dir / "ships").mkdir(parents=True)
    (out_dir / "ships" / f"{class_name}.json").write_text(json.dumps(ship), encoding="utf-8")


def test_live_hull_reaches_the_silhouette_as_anchors(tmp_path):
    _write_ship_json(tmp_path, "TEST_Fighter")
    anchor_in = _ship_anchor_inputs(tmp_path, "TEST_Fighter")
    assert anchor_in["frame"]["source"] == "bbox"
    assert set(HELPERS) <= set(anchor_in["transforms"])

    row = build_entity_silhouette(
        kind="ship", class_name="TEST_Fighter", triangles=_hull_triangles(),
        hull_cga="Data/Objects/Spaceships/Ships/TEST/TEST_Fighter.cga",
        tool_version="test", build={}, generated_at="",
        frame=anchor_in["frame"], hardpoint_transforms=anchor_in["transforms"],
        all_port_names=anchor_in["port_names"],
    )
    assert row is not None
    by_port = {a["portId"]: a for a in row["anchors"]}
    assert set(HELPERS) <= set(by_port)
    # nose gun near the top (nose up), wing guns mirrored left/right
    assert by_port["hardpoint_gun_nose"]["y"] < 20
    assert by_port["hardpoint_weapon_left"]["side"] == "port"
    assert by_port["hardpoint_weapon_right"]["side"] == "starboard"
    assert by_port["hardpoint_weapon_left"]["x"] < 50 < by_port["hardpoint_weapon_right"]["x"]
    assert not any(a["clamped"] for a in row["anchors"])
    assert row["unresolved"] == ["hardpoint_not_on_mesh"]
