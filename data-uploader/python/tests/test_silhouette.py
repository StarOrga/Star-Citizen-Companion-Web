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


def _noisy_rect_hull(x_span: float, y_span: float, *,
                      tooth_period: float = 1.0, tooth_depth: float = 2.0) -> list:
    """A rectangle with a jagged (alternating in/out) top edge — high-frequency
    boundary noise, the way a capital ship's raster trace looks before
    simplification, big enough to matter at the ship's own scale but far
    below the (adaptive) DP tolerance."""
    n = max(2, int(x_span / tooth_period))
    xs = [i * x_span / n for i in range(n + 1)]
    tris = []
    prev_x, prev_y = xs[0], y_span
    for i in range(1, len(xs)):
        x = xs[i]
        y_top = y_span + (tooth_depth if i % 2 else 0.0)
        bl, br = (prev_x, 0.0, 0.0), (x, 0.0, 0.0)
        tl, tr = (prev_x, prev_y, 0.0), (x, y_top, 0.0)
        tris.append((bl, br, tr))
        tris.append((bl, tr, tl))
        prev_x, prev_y = x, y_top
    return tris


def _annulus_hull(outer: float, inner: float) -> list:
    """A square picture-frame (outer square minus a smaller concentric square)
    — one connected blob with one hole, for winding-direction tests."""
    o, i = outer, inner
    oa, ob, oc, od = (0.0, 0.0, 0.0), (o, 0.0, 0.0), (o, o, 0.0), (0.0, o, 0.0)
    m = (o - i) / 2.0
    ia, ib, ic, id_ = (m, m, 0.0), (m + i, m, 0.0), (m + i, m + i, 0.0), (m, m + i, 0.0)
    return [
        (oa, ob, ib), (oa, ib, ia),  # bottom trapezoid
        (ob, oc, ic), (ob, ic, ib),  # right
        (oc, od, id_), (oc, id_, ic),  # top
        (od, oa, ia), (od, ia, id_),  # left
    ]


def _two_component_hull() -> list:
    """A main hull plus a small SEPARATE blob (a "nacelle" the open() denoise
    pass would sever) well clear of it — two disjoint foreground components,
    both above `MIN_COMPONENT_AREA_PX`."""
    main = _rect_hull(2.0, 10.0)
    nacelle_a, nacelle_b, nacelle_c = (7.0, 0.0, 0.0), (9.0, 0.0, 0.0), (8.0, 2.0, 0.0)
    return main + [(nacelle_a, nacelle_b, nacelle_c)]


def _signed_area(ring: list) -> float:
    """Shoelace formula, ``ring`` closed (first point == last)."""
    total = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        total += x0 * y1 - x1 * y0
    return total / 2.0


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


class TestToleranceBudget:
    def test_noisy_capital_ship_path_stays_under_budget(self) -> None:
        """Should-fix "tolerance" (wave1-redteam.md): a flat 0.15 m DP
        tolerance is fine for a fighter but lets a capital-scale, noisy hull
        blow through the SVG path length budget — the tolerance must scale
        with the hull's own span (0.3%) and the raster's own pixel size."""
        sil = build_silhouette(_noisy_rect_hull(400.0, 120.0))
        assert sil is not None
        assert len(sil["path"]) < 60_000
        assert sil["simplifyToleranceM"] > 0.15  # adaptive tolerance kicked in


class TestComponents:
    def test_two_disjoint_blobs_both_become_subpaths(self) -> None:
        """Should-fix "components" (wave1-redteam.md): a blob the open()
        denoise pass severs from the main hull (a nacelle/wingtip/arm) must
        stay in the path as its own subpath, not be dropped for not being
        the single biggest blob."""
        sil = build_silhouette(_two_component_hull())
        assert sil is not None
        assert sil["path"].count("M ") == 2


class TestHoleWinding:
    def test_hole_subpath_winds_opposite_the_outer_subpath(self) -> None:
        """Should-fix "hole winding" (wave1-redteam.md): a hole ring must be
        emitted with the OPPOSITE winding of the outer ring so
        `fill-rule="nonzero"` actually punches the hole."""
        import re

        sil = build_silhouette(_annulus_hull(10.0, 4.0))
        assert sil is not None
        subpaths = re.findall(r"M.*?Z", sil["path"])
        assert len(subpaths) == 2  # outer + one hole

        def ring_of(block: str) -> list:
            return [tuple(map(float, m.split()))
                    for m in re.findall(r"-?\d+\.?\d* -?\d+\.?\d*", block)]

        outer_area = _signed_area(ring_of(subpaths[0]))
        hole_area = _signed_area(ring_of(subpaths[1]))
        assert outer_area != 0.0 and hole_area != 0.0
        assert (outer_area > 0) != (hole_area > 0)  # opposite sign


class TestAnchors:
    # This hull's own XY bounds happen to equal FRAME's X/Y bounds, so the
    # blocker-2 path transform below is exactly what `build_silhouette`
    # computes for it (not a hand-typed identity transform, real rounding
    # included) — the same fixture the anchors below are checked against.
    FRAME = {"min": [-2.0, 0.0, 0.0], "max": [2.0, 10.0, 2.0], "source": "bbox"}
    TRANSFORM = build_silhouette(_rect_hull(2.0, 10.0))["_transform"]

    def test_anchor_projection_matches_the_silhouette_path_transform(self) -> None:
        """Blocker 2 (wave1-redteam.md): x/y go through the SAME min/scale/
        offset transform as the path (mesh bounds, centred in the viewBox),
        not the frame's own raw percentage — so a mesh narrower than it is
        long (this hull: 4 m wide, 10 m long) lands OFF the 0%/100% edge on
        the narrow axis once the viewBox centres it."""
        transforms = {
            "hardpoint_gun_left": {
                "position": [-2.0, 0.0, 0.0], "rotation": None,
                "helper": "hardpoint_gun_left", "source": "helper",
            },
        }
        anchors, unresolved = project_anchors(
            transforms, self.FRAME, ["hardpoint_gun_left"], transform=self.TRANSFORM,
        )
        assert len(anchors) == 1
        a = anchors[0]
        assert a["x"] == 30.0  # centred: (X-min)*scale+offsetX, not a raw 0%
        assert a["y"] == 100.0  # tail, Y=min, unaffected by X-axis centring
        assert a["side"] == "port"  # side still derives from the FRAME's mid X
        assert a["clamped"] is False  # still checked against the FRAME's own AABB

    def test_centred_hardpoint_lands_at_viewbox_centre(self) -> None:
        """The should-fix pytest: a hardpoint at the exact centre of the hull
        that produced the path must land at (50, 50) regardless of the
        viewBox centring offset — proving anchors and path share one frame."""
        transforms = {
            "hardpoint_core": {
                "position": [0.0, 5.0, 0.0], "rotation": None,
                "helper": "hardpoint_core", "source": "helper",
            },
        }
        anchors, _ = project_anchors(
            transforms, self.FRAME, ["hardpoint_core"], transform=self.TRANSFORM,
        )
        assert len(anchors) == 1
        assert abs(anchors[0]["x"] - 50.0) <= 0.5
        assert abs(anchors[0]["y"] - 50.0) <= 0.5

    def test_missing_helper_is_unresolved(self) -> None:
        anchors, unresolved = project_anchors(
            {}, self.FRAME, ["hardpoint_shield_generator_2"], transform=self.TRANSFORM,
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
        anchors, _ = project_anchors(transforms, self.FRAME, [], transform=self.TRANSFORM)
        assert anchors[0]["clamped"] is True

    def test_missing_frame_yields_no_anchors(self) -> None:
        anchors, unresolved = project_anchors(
            {"a": {"position": [0, 0, 0]}}, {}, ["a"], transform=self.TRANSFORM,
        )
        assert anchors == []
        assert unresolved == []  # no frame -> nothing resolved, nothing to report either

    def test_missing_transform_yields_no_anchors(self) -> None:
        """No path was built (e.g. mesh had no usable surface) -> never a pin
        in a space nobody can verify against."""
        anchors, unresolved = project_anchors(
            {"a": {"position": [0.0, 0.0, 0.0]}}, self.FRAME, ["a"], transform=None,
        )
        assert anchors == []
        assert unresolved == []


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
