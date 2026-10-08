"""Verse-hub constellation reducer: silhouette ring -> exactly 7 stars in 0..1."""
from __future__ import annotations

import math

from sc_extract.constellation import (
    STAR_COUNT,
    constellation_from_path,
    main_ring,
    reduce_to_constellation,
    rings_from_path,
)


def _circle(n: int, rx: float = 300.0, ry: float = 120.0):
    return [(500 + rx * math.cos(2 * math.pi * i / n), 500 + ry * math.sin(2 * math.pi * i / n))
            for i in range(n)]


def _path(ring, reverse=False):
    pts = list(reversed(ring)) if reverse else list(ring)
    return " ".join([f"M {pts[0][0]} {pts[0][1]}"] + [f"L {x} {y}" for x, y in pts[1:]] + ["Z"])


def _assert_valid(stars):
    assert stars is not None
    assert len(stars) == STAR_COUNT == 7
    for x, y in stars:
        assert 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0


def test_dense_ring_reduces_to_exactly_seven_points():
    stars = reduce_to_constellation(_circle(400))
    _assert_valid(stars)
    assert len({tuple(p) for p in stars}) == 7


def test_deterministic_same_input_same_output():
    ring = _circle(257)
    assert reduce_to_constellation(ring) == reduce_to_constellation(list(ring))


def test_normalised_longer_axis_spans_unit_and_aspect_kept():
    stars = reduce_to_constellation(_circle(400, rx=300, ry=100))
    xs = [p[0] for p in stars]
    ys = [p[1] for p in stars]
    assert min(xs) == 0.0 and max(xs) == 1.0
    # Shorter axis is centred, not stretched to 0..1.
    assert max(ys) - min(ys) < 0.5
    assert math.isclose((min(ys) + max(ys)) / 2, 0.5, abs_tol=1e-3)


def test_keeps_the_extreme_points_of_a_ship_shape():
    # A plus-shaped "ship": nose, tail and both wingtips must survive.
    ship = [(500, 0), (520, 400), (900, 450), (900, 500), (520, 520), (510, 1000),
            (490, 1000), (480, 520), (100, 500), (100, 450), (480, 400)]
    dense = []
    for i, p in enumerate(ship):
        q = ship[(i + 1) % len(ship)]
        for t in range(10):
            dense.append((p[0] + (q[0] - p[0]) * t / 10, p[1] + (q[1] - p[1]) * t / 10))
    stars = reduce_to_constellation(dense)
    _assert_valid(stars)
    ys = [p[1] for p in stars]
    xs = [p[0] for p in stars]
    assert min(ys) == 0.0 and max(ys) == 1.0  # nose + tail
    # Wingtips: an 800-wide hull in a 1000-long frame is centred -> 0.1..0.9.
    assert min(xs) == 0.1 and max(xs) == 0.9


def test_degenerate_triangle_is_padded_to_seven():
    stars = reduce_to_constellation([(0, 0), (10, 0), (5, 8)])
    _assert_valid(stars)
    assert stars == reduce_to_constellation([(0, 0), (10, 0), (5, 8)])


def test_two_point_line_is_padded_and_centred():
    stars = reduce_to_constellation([(0, 0), (10, 0)])
    _assert_valid(stars)
    assert all(p[1] == 0.5 for p in stars)


def test_exactly_seven_vertices_kept_as_is():
    ring = _circle(7)
    stars = reduce_to_constellation(ring)
    _assert_valid(stars)
    assert len({tuple(p) for p in stars}) == 7


def test_no_extent_returns_none():
    assert reduce_to_constellation([]) is None
    assert reduce_to_constellation([(3, 3)]) is None
    assert reduce_to_constellation([(3, 3), (3, 3), (3, 3)]) is None
    assert constellation_from_path("") is None


def test_main_ring_ignores_holes_and_small_components():
    hull = _circle(80, 300, 150)
    hole = _circle(20, 50, 20)
    pod = [(10, 10), (40, 10), (40, 40), (10, 40)]
    path = " ".join([_path(pod), _path(hull), _path(hole, reverse=True)])
    assert len(rings_from_path(path)) == 3
    assert main_ring(path) == [(float(x), float(y)) for x, y in hull]
    _assert_valid(constellation_from_path(path))
