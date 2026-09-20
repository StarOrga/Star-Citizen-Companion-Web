"""Silhouette geometry: rasterise -> trace -> smooth/simplify -> contract JSON.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/

Every case pins the promise the module rests on: no invented geometry (empty
input -> None, never a placeholder shape) and determinism (same triangles in
-> byte-identical path out, run after run).
"""

from __future__ import annotations

from sc_extract.silhouette import (
    build_entity_silhouette,
    build_silhouette,
    chaikin_smooth,
    denoise_mask,
    douglas_peucker,
    project_anchors,
    project_topdown,
    rasterize_mask,
    trace_contours,
    xy_bounds,
)

import numpy as np


def _rect_hull(half_width: float, length: float) -> list:
    """A flat rectangular "hull": nose at +Y, tail at Y=0, centred on X."""
    hw = half_width
    return [
        ((-hw, 0.0, 0.0), (hw, 0.0, 0.0), (hw, length, 0.0)),
        ((-hw, 0.0, 0.0), (hw, length, 0.0), (-hw, length, 0.0)),
    ]


class TestProjectAndRasterize:
    def test_project_topdown_drops_z(self) -> None:
        tris = [((1.0, 2.0, 99.0), (3.0, 4.0, -5.0), (5.0, 6.0, 0.0))]
        out = project_topdown(tris)
        assert out == [((1.0, 2.0), (3.0, 4.0), (5.0, 6.0))]

    def test_xy_bounds_empty_is_none(self) -> None:
        assert xy_bounds([]) is None

    def test_rasterize_mask_fills_triangle(self) -> None:
        tris_2d = project_topdown(_rect_hull(2.0, 10.0))
        bounds = xy_bounds(tris_2d)
        mask, px_per_m, w, h = rasterize_mask(tris_2d, bounds, mask_size=64)
        assert mask.any()
        # aspect preserved: the rectangle is 4m wide, 10m long -> width < height
        assert w < h
        assert h == 64  # longer span maps to the full mask size


class TestDenoise:
    def test_denoise_removes_single_pixel_speckle(self) -> None:
        m = np.zeros((10, 10), dtype=bool)
        m[3:7, 3:7] = True
        m[0, 0] = True  # isolated speckle far from the blob
        out = denoise_mask(m, iterations=1)
        assert not out[0, 0]
        assert out[4, 4]  # the real blob survives


class TestContourTracing:
    def test_outer_contour_is_closed_and_on_the_mask(self) -> None:
        m = np.zeros((9, 9), dtype=bool)
        m[2:7, 2:7] = True
        result = trace_contours(m)
        outer = result["outer"]
        assert outer is not None
        assert outer[0] == outer[-1]
        assert all(m[r, c] for r, c in outer)

    def test_hole_detected_above_threshold(self) -> None:
        m = np.zeros((9, 9), dtype=bool)
        m[1:8, 1:8] = True
        m[3:6, 3:6] = False  # 3x3 = 9px hole, well above a low threshold
        result = trace_contours(m, min_hole_area_px=4)
        assert len(result["holes"]) == 1

    def test_hole_below_threshold_is_ignored(self) -> None:
        m = np.zeros((9, 9), dtype=bool)
        m[1:8, 1:8] = True
        m[4, 4] = False  # 1px pocket
        result = trace_contours(m, min_hole_area_px=4)
        assert result["holes"] == []

    def test_background_touching_border_is_not_a_hole(self) -> None:
        m = np.zeros((5, 5), dtype=bool)
        m[1:4, 1:4] = True  # solid interior block, surrounding ring is bg
        result = trace_contours(m, min_hole_area_px=1)
        assert result["holes"] == []  # the surrounding void touches the border


class TestSmoothAndSimplify:
    def test_douglas_peucker_collapses_collinear_points(self) -> None:
        pts = [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (3.0, 0.0)]
        assert douglas_peucker(pts, tolerance=0.01) == [(0.0, 0.0), (3.0, 0.0)]

    def test_douglas_peucker_keeps_a_real_corner(self) -> None:
        pts = [(0.0, 0.0), (1.0, 5.0), (2.0, 0.0)]
        out = douglas_peucker(pts, tolerance=0.5)
        assert (1.0, 5.0) in out

    def test_chaikin_smooth_preserves_closed_ring(self) -> None:
        ring = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0), (0.0, 0.0)]
        out = chaikin_smooth(ring, iterations=1)
        assert out[0] == out[-1]
        assert len(out) > len(ring)  # corner-cutting adds points


class TestBuildSilhouette:
    def test_empty_triangles_yields_none(self) -> None:
        assert build_silhouette([]) is None

    def test_degenerate_triangles_yield_none(self) -> None:
        # zero-area triangle only — nothing to rasterise
        assert build_silhouette([((0, 0, 0), (0, 0, 0), (0, 0, 0))]) is None

    def test_rectangle_hull_produces_contract_fields(self) -> None:
        sil = build_silhouette(_rect_hull(2.0, 10.0))
        assert sil is not None
        assert sil["viewBox"] == "0 0 1000 1000"
        assert sil["noseUp"] is True
        assert sil["path"].startswith("M ")
        assert sil["path"].rstrip().endswith("Z")
        assert sil["bbox"]["w"] > 0 and sil["bbox"]["h"] > 0
        assert sil["pointCount"] > 0
        assert sil["simplifyToleranceM"] == 0.15

    def test_nose_up_orientation(self) -> None:
        """+Y (nose) must land at the SMALLER viewBox y (screen top)."""
        sil = build_silhouette(_rect_hull(2.0, 10.0))
        # crude check: every path y-coordinate for the tail end (near Y=0)
        # should be numerically larger than for the nose end (near Y=10).
        import re
        coords = [tuple(map(float, m.split()))
                 for m in re.findall(r"-?\d+\.?\d* -?\d+\.?\d*", sil["path"])]
        ys = [y for _x, y in coords]
        assert max(ys) > 500  # tail (Y=0) is near the bottom
        assert min(ys) < 500  # nose (Y=10) is near the top

    def test_deterministic(self) -> None:
        tris = _rect_hull(2.0, 10.0)
        a = build_silhouette(tris)
        b = build_silhouette(tris)
        assert a == b


class TestAnchors:
    FRAME = {"min": [-2.0, 0.0, 0.0], "max": [2.0, 10.0, 2.0], "source": "bbox"}

    def test_anchor_projection_matches_hardpoint_map_convention(self) -> None:
        transforms = {
            "hardpoint_gun_left": {
                "position": [-2.0, 0.0, 0.0], "rotation": None,
                "helper": "hardpoint_gun_left", "source": "helper",
            },
        }
        anchors, unresolved = project_anchors(transforms, self.FRAME, ["hardpoint_gun_left"])
        assert len(anchors) == 1
        a = anchors[0]
        # x=(X-min)/span -> 0%; y=1-(Y-min)/span -> 100% (tail, Y=min)
        assert a["x"] == 0.0
        assert a["y"] == 100.0
        assert a["side"] == "port"  # X < mid (-2 < 0)
        assert a["clamped"] is False

    def test_missing_helper_is_unresolved(self) -> None:
        anchors, unresolved = project_anchors(
            {}, self.FRAME, ["hardpoint_shield_generator_2"],
        )
        assert anchors == []
        assert unresolved == ["hardpoint_shield_generator_2"]

    def test_out_of_frame_position_is_clamped(self) -> None:
        transforms = {
            "hardpoint_wingtip": {
                "position": [5.0, 0.0, 0.0], "rotation": None,
                "helper": "hardpoint_wingtip", "source": "helper",
            },
        }
        anchors, _ = project_anchors(transforms, self.FRAME, [])
        assert anchors[0]["clamped"] is True

    def test_missing_frame_yields_no_anchors(self) -> None:
        anchors, unresolved = project_anchors({"a": {"position": [0, 0, 0]}}, {}, ["a"])
        assert anchors == []
        assert unresolved == []  # no frame -> nothing resolved, nothing to report either


class TestEntitySilhouette:
    def test_ship_row_carries_anchors_and_unresolved(self) -> None:
        transforms = {
            "hardpoint_gun_left": {
                "position": [-2.0, 0.0, 0.0], "rotation": None,
                "helper": "hardpoint_gun_left", "source": "helper",
            },
        }
        row = build_entity_silhouette(
            kind="ship", class_name="TEST_Ship",
            triangles=_rect_hull(2.0, 10.0),
            hull_cga="Data/Objects/Spaceships/Ships/TEST/Ship/TEST_Ship.cga",
            tool_version="0.1.0", build={"channel": "LIVE", "patchVersion": "4.9.0"},
            generated_at="2026-09-20T00:00:00Z",
            frame={"min": [-2.0, 0.0, 0.0], "max": [2.0, 10.0, 0.5], "source": "bbox"},
            hardpoint_transforms=transforms,
            all_port_names=["hardpoint_gun_left", "hardpoint_shield_generator_2"],
        )
        assert row is not None
        assert row["kind"] == "ship"
        assert row["className"] == "TEST_Ship"
        assert row["source"]["hullCga"].endswith("TEST_Ship.cga")
        assert row["source"]["modelSpace"] == "cryengine:+X right,+Y nose,+Z up"
        assert len(row["anchors"]) == 1
        assert row["unresolved"] == ["hardpoint_shield_generator_2"]

    def test_non_ship_row_has_no_anchors_key(self) -> None:
        row = build_entity_silhouette(
            kind="weapon", class_name="TEST_Gun",
            triangles=_rect_hull(0.2, 1.0),
            hull_cga="Data/Objects/Weapons/TEST_Gun.cga",
            tool_version="0.1.0", build={}, generated_at="2026-09-20T00:00:00Z",
        )
        assert row is not None
        assert "anchors" not in row
        assert "unresolved" not in row

    def test_no_mesh_yields_no_row(self) -> None:
        row = build_entity_silhouette(
            kind="weapon", class_name="TEST_Empty", triangles=[],
            hull_cga="Data/x.cga", tool_version="0.1.0", build={},
            generated_at="2026-09-20T00:00:00Z",
        )
        assert row is None
