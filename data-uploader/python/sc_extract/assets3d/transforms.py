"""Rigid transforms and the ONE CryEngine -> glTF axis conversion.

Everything upstream (DataCore helper names, ``.cga`` node matrices) lives in
CryEngine model space: metres, ``+X`` right, ``+Y`` forward, ``+Z`` up. The
published GLBs (hull, parts, interior) are what cgf-converter emits: glTF
space, metres, ``+Y`` up. Placements are composed in CryEngine space (where the
helper matrices are native) and converted exactly once, at the very end, by
:func:`cry_to_gltf`. The web applies the result verbatim.

The basis was confirmed against the converter's own output: a hull helper
node at CryEngine ``(x, y, z)`` lands at glTF ``(x, z, -y)`` (see
``tests/test_asset_package.py`` and the locator check in
:mod:`sc_extract.assets3d.package`).

Matrices are plain row-major 4x4 nested lists — tiny, dependency-free and easy
to assert on in tests.
"""
from __future__ import annotations

import math
from typing import List, Optional, Sequence, Tuple

Mat4 = List[List[float]]
Vec3 = List[float]
Quat = List[float]  # [x, y, z, w]

# glTF = C * cry: x -> x, y(forward) -> -z, z(up) -> y. A proper rotation
# (det +1), so quaternions convert by rotating their vector part.
CRY_TO_GLTF: Mat4 = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, -1.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
]


def identity() -> Mat4:
    return [[1.0 if r == c else 0.0 for c in range(4)] for r in range(4)]


def matmul(a: Mat4, b: Mat4) -> Mat4:
    return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]


def transpose(a: Mat4) -> Mat4:
    return [[a[c][r] for c in range(4)] for r in range(4)]


def from_pos_quat(pos: Sequence[float], quat: Optional[Sequence[float]]) -> Mat4:
    """Rigid matrix from a translation and an ``[x, y, z, w]`` quaternion."""
    x, y, z, w = _unit(quat) if quat else (0.0, 0.0, 0.0, 1.0)
    m = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), float(pos[0])],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), float(pos[1])],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), float(pos[2])],
        [0.0, 0.0, 0.0, 1.0],
    ]
    return m


def to_pos_quat(m: Mat4) -> Tuple[Vec3, Quat]:
    """Translation + unit quaternion ``[x, y, z, w]`` (w >= 0) of a rigid matrix."""
    pos = [m[0][3], m[1][3], m[2][3]]
    tr = m[0][0] + m[1][1] + m[2][2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, 0.25 * s]
    elif m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = math.sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2
        q = [0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s]
    elif m[1][1] > m[2][2]:
        s = math.sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2
        q = [(m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s]
    else:
        s = math.sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2
        q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s, (m[1][0] - m[0][1]) / s]
    q = list(_unit(q))
    if q[3] < 0:
        q = [-v for v in q]
    return pos, q


def cry_to_gltf(m: Mat4) -> Mat4:
    """Re-express a CryEngine-space transform in glTF space: ``C * M * C^T``."""
    return matmul(matmul(CRY_TO_GLTF, m), transpose(CRY_TO_GLTF))


def cry_point_to_gltf(p: Sequence[float]) -> Vec3:
    return [float(p[0]), float(p[2]), -float(p[1])]


def rounded(v: Sequence[float], nd: int = 5) -> List[float]:
    """Stable JSON numbers (no ``-0.0``)."""
    return [round(float(x), nd) + 0.0 for x in v]


def _unit(q: Sequence[float]) -> Tuple[float, float, float, float]:
    n = math.sqrt(sum(float(v) * float(v) for v in q)) or 1.0
    return (float(q[0]) / n, float(q[1]) / n, float(q[2]) / n, float(q[3]) / n)
