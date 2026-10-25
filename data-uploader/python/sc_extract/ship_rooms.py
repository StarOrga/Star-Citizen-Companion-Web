"""Room footprints per deck from the ship object containers (#797).

VERIFIED against LIVE 4.x (probe 2026-10-25, ANVL_Carrack):

* ``VehicleComponentParams.objectContainers[]`` lists the interior socpaks
  (``objectcontainers/ships/anvl/carrack/middle.socpak`` …) with an ``Offset``
  QuatT in the ship frame — the same frame the hardpoint transforms live in.
  Entry names (``front`` / ``middle`` / ``rear``) are hull SECTIONS, not decks.
* A socpak is a ZIP whose local headers spell paths with ``\\`` while the
  central directory uses ``/`` — ``zipfile.ZipFile.read`` refuses that
  ("File name in directory … and header … differ"), so entries are read from
  their local header directly (:func:`read_zip_entry`).
* The container's ``<name>.soc`` is a CrCh chunk file; one chunk is a CryXmlB
  ``<Entities>`` document. ``*_editor.xml`` only carries names and GUIDs, no
  positions, so it is not used.
* Each room is a ``Room_RN`` entity: ``Pos`` (container frame),
  ``PropertiesDataCore/EntityComponentRoom@roomName`` (a loc key, often
  ``@procedural_text_null``) and ``@interiorMapSection`` — the GUID of the
  ``InteriorMapSectionDefinition`` record, i.e. the DECK of #796.
* A room's volume is a ``GenericShape`` (``VA_*``) whose ``AreaComponent``
  links the room's ``EntityCryGUID``. Three segment types occur:
  ``Shape`` (``Points/Point@Pos`` + ``Height``, extruded), ``Box``
  (``BoxMin``/``BoxMax``) and ``Trimesh`` (``Point@pos`` triangle list).
  Their points are local to the shape entity: ``Pos`` + ``Rotate``
  (quaternion **w,x,y,z** — a ``Rotate="0,0,0,1"`` shape is turned 180° about
  Z, which is what puts the Carrack's port turret room inside the hull) +
  the segment's ``transform_ls`` translation.

The 2D schematic is a top view, so every volume is reduced to its floor
footprint: a ``Shape``'s polygon, a ``Box``'s rectangle, a ``Trimesh``'s
horizontal triangles at its lowest level.
"""

from __future__ import annotations

import math
import re
import struct
import zlib
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

Vec3 = Tuple[float, float, float]
Quat = Tuple[float, float, float, float]  # x, y, z, w

ROOM_CLASS = "Room_RN"
SHAPE_CLASS = "GenericShape"
_ROUND = 2
# A trimesh triangle counts as floor when its three corners sit within this
# many metres of each other in Z and of the mesh's lowest corner.
_FLAT_EPS_M = 0.05
_FLOOR_BAND_M = 0.3
_NULL_NAME_KEYS = {"", "@procedural_text_null", "@loc_empty", "@loc_placeholder"}


# ── socpak (zip) access ─────────────────────────────────────────────────────

def read_zip_entry(buf: bytes, info) -> bytes:
    """Bytes of one ZIP entry, read from its local header (stored or deflate)."""
    off = info.header_offset
    if struct.unpack_from("<I", buf, off)[0] != 0x04034B50:
        raise ValueError(f"no local header for {info.filename}")
    name_len, extra_len = struct.unpack_from("<HH", buf, off + 26)
    start = off + 30 + name_len + extra_len
    raw = buf[start:start + info.compress_size]
    if info.compress_type == 0:
        return raw
    if info.compress_type == 8:
        return zlib.decompress(raw, -15)
    raise ValueError(f"unsupported zip method {info.compress_type} for {info.filename}")


def soc_entries(zf) -> List[Any]:
    """The ``.soc`` entries of an opened socpak, top-level container first."""
    socs = [i for i in zf.infolist() if i.filename.lower().endswith(".soc")]
    return sorted(socs, key=lambda i: ("/" in i.filename.replace("\\", "/"), i.filename.lower()))


def soc_entities(blob: bytes, decode) -> Optional[Any]:
    """The ``<Entities>`` root of a ``.soc`` chunk file, or None.

    ``decode`` turns CryXmlB bytes into an element (scdatatools in production,
    a stub in tests). The chunk table is not walked: each embedded CryXmlB
    document is tried until one has the ``Entities`` root.
    """
    for m in re.finditer(rb"CryXmlB", blob):
        try:
            root = decode(blob[m.start():])
        except Exception:  # noqa: BLE001 — a non-entity chunk, try the next one
            continue
        if root is not None and root.tag == "Entities":
            return root
    return None


# ── geometry ────────────────────────────────────────────────────────────────

def _floats(text: Optional[str]) -> Optional[List[float]]:
    if not text:
        return None
    try:
        vals = [float(v) for v in text.split(",")]
    except ValueError:
        return None
    return vals if all(math.isfinite(v) for v in vals) else None


def _vec(text: Optional[str]) -> Vec3:
    v = _floats(text)
    return (v[0], v[1], v[2]) if v and len(v) >= 3 else (0.0, 0.0, 0.0)


def _quat_wxyz(text: Optional[str]) -> Quat:
    """CryEngine ``Rotate`` attribute (w,x,y,z) → (x,y,z,w); identity if absent."""
    v = _floats(text)
    if not v or len(v) != 4:
        return (0.0, 0.0, 0.0, 1.0)
    w, x, y, z = v
    n = math.sqrt(w * w + x * x + y * y + z * z)
    if n < 1e-9:
        return (0.0, 0.0, 0.0, 1.0)
    return (x / n, y / n, z / n, w / n)


def rotate(q: Quat, v: Vec3) -> Vec3:
    x, y, z, w = q
    tx = 2 * (y * v[2] - z * v[1])
    ty = 2 * (z * v[0] - x * v[2])
    tz = 2 * (x * v[1] - y * v[0])
    return (v[0] + w * tx + (y * tz - z * ty),
            v[1] + w * ty + (z * tx - x * tz),
            v[2] + w * tz + (x * ty - y * tx))


def _qmul(a: Quat, b: Quat) -> Quat:
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def ang3_quat(rot: Dict[str, Any]) -> Quat:
    """DataForge ``Ang3`` (degrees, applied X then Y then Z) → quaternion."""
    def axis(i: int, deg: float) -> Quat:
        h = math.radians(deg) / 2
        q = [0.0, 0.0, 0.0, math.cos(h)]
        q[i] = math.sin(h)
        return (q[0], q[1], q[2], q[3])

    try:
        x, y, z = (float(rot.get(k) or 0.0) for k in ("x", "y", "z"))
    except (TypeError, ValueError):
        return (0.0, 0.0, 0.0, 1.0)
    if not all(math.isfinite(v) for v in (x, y, z)):
        return (0.0, 0.0, 0.0, 1.0)
    return _qmul(axis(2, z), _qmul(axis(1, y), axis(0, x)))


def move(p: Sequence[float], q: Quat, t: Vec3) -> List[float]:
    """``q · p + t``, rounded like every emitted coordinate."""
    r = rotate(q, (p[0], p[1], p[2]))
    return [round(r[i] + t[i], _ROUND) for i in range(3)]


def decode_cryxml(blob: bytes):
    """CryXmlB bytes → root element (scdatatools, like the vehicle XML)."""
    import io

    from scdatatools.engine.cryxml import etree_from_cryxml_file
    return etree_from_cryxml_file(io.BytesIO(blob)).getroot()


def _transform_ls(text: Optional[str]) -> Tuple[Quat, Vec3]:
    """Rotation + translation of a ``transform_ls`` string
    (``Q : w,x,y,z | T : x,y,z``); identity for anything unreadable."""
    q = re.search(r"Q\s*:\s*([-0-9.e+,\s]+)", text or "")
    t = re.search(r"T\s*:\s*([-0-9.e+,\s]+)", text or "")
    return (_quat_wxyz(q.group(1).replace(" ", "")) if q else (0.0, 0.0, 0.0, 1.0),
            _vec(t.group(1).replace(" ", "")) if t else (0.0, 0.0, 0.0))


def _segment_footprints(seg) -> Tuple[List[List[Vec3]], List[List[Vec3]], float]:
    """Local floor outlines, floor triangles (trimesh) and height (m) of one
    ``Segment``. Points pass through the segment's own ``transform_ls``."""
    kind = (seg.get("Type") or "").lower()
    q, t = _transform_ls(seg.get("transform_ls"))

    def off(p: Vec3) -> Vec3:
        r = rotate(q, p)
        return (r[0] + t[0], r[1] + t[1], r[2] + t[2])

    if kind == "shape":
        pts = [off(_vec(p.get("Pos"))) for p in seg.iter("Point")]
        h = (_floats(seg.get("Height")) or [0.0])[0]
        return ([pts] if len(pts) >= 3 else []), [], h
    if kind == "box":
        lo, hi = _vec(seg.get("BoxMin")), _vec(seg.get("BoxMax"))
        z = lo[2]
        rect = [off((lo[0], lo[1], z)), off((hi[0], lo[1], z)),
                off((hi[0], hi[1], z)), off((lo[0], hi[1], z))]
        return [rect], [], hi[2] - lo[2]
    if kind == "trimesh":
        pts = [off(_vec(p.get("pos") or p.get("Pos"))) for p in seg.iter("Point")]
        if len(pts) < 3:
            return [], [], 0.0
        zmin = min(p[2] for p in pts)
        zmax = max(p[2] for p in pts)
        floor = []
        for i in range(0, len(pts) - 2, 3):
            tri = pts[i:i + 3]
            zs = [p[2] for p in tri]
            if max(zs) - min(zs) <= _FLAT_EPS_M and min(zs) - zmin <= _FLOOR_BAND_M:
                floor.append(tri)
        return [], floor, zmax - zmin
    return [], [], 0.0


def _area2(poly: Sequence[Sequence[float]]) -> float:
    return abs(sum(poly[i][0] * poly[i - 1][1] - poly[i - 1][0] * poly[i][1]
                   for i in range(len(poly))))


# ── rooms ───────────────────────────────────────────────────────────────────

def _room_component(ent) -> Dict[str, Optional[str]]:
    for el in ent.iter("EntityComponentRoom"):
        return {"roomName": el.get("roomName"), "section": el.get("interiorMapSection")}
    return {"roomName": None, "section": None}


def rooms_in_container(entities, offset: Vec3, offset_rot: Quat = (0.0, 0.0, 0.0, 1.0)
                       ) -> List[Dict[str, Any]]:
    """Rooms of one ``<Entities>`` root, transformed into the ship frame.

    Each row: ``{key, locKey, section, pos, floorZ, height, shapes, tris}``:
    ``shapes`` are outlined 2D polygons ``[[x, y], …]``, ``tris`` the floor
    triangles of trimesh volumes (filled, never outlined). A room with
    neither is a pin.
    """
    def to_ship(p: Vec3) -> Vec3:
        r = rotate(offset_rot, p)
        return (r[0] + offset[0], r[1] + offset[1], r[2] + offset[2])

    rooms: Dict[str, Dict[str, Any]] = {}
    for ent in entities:
        if ent.get("EntityClass") != ROOM_CLASS:
            continue
        guid = (ent.get("EntityCryGUID") or "").lower()
        if not guid:
            continue
        comp = _room_component(ent)
        pos = to_ship(_vec(ent.get("Pos")))
        rooms[guid] = {
            "key": ent.get("Name") or guid,
            "locKey": comp["roomName"],
            "section": (comp["section"] or "").lower() or None,
            "pos": [round(c, _ROUND) for c in pos],
            "floorZ": None,
            "height": None,
            "shapes": [],
            "tris": [],
        }
    if not rooms:
        return []

    for ent in entities:
        if ent.get("EntityClass") != SHAPE_CLASS:
            continue
        area = ent.find("AreaComponent")
        if area is None:
            continue
        linked = [e.get("EntityCryGUID", "").lower() for e in area.iter("Entity")]
        room = next((rooms[g] for g in linked if g in rooms), None)
        if room is None:
            continue
        epos = _vec(ent.get("Pos"))
        erot = _quat_wxyz(ent.get("Rotate"))
        for seg in area.findall("Segment"):
            polys, tris, height = _segment_footprints(seg)
            for poly, bucket in [(q, "shapes") for q in polys] + [(q, "tris") for q in tris]:
                world = [to_ship(tuple(a + b for a, b in zip(rotate(erot, p), epos)))
                         for p in poly]
                flat = [[round(p[0], _ROUND), round(p[1], _ROUND)] for p in world]
                if _area2(flat) < 1e-3:
                    continue
                room[bucket].append(flat)
                z = min(p[2] for p in world)
                room["floorZ"] = round(z if room["floorZ"] is None else min(room["floorZ"], z), _ROUND)
                if height > 0:
                    room["height"] = round(max(room["height"] or 0.0, height), _ROUND)
    return list(rooms.values())


def cry_guid_to_record_id(guid: Optional[str]) -> Optional[str]:
    """A CryEngine GUID string (as the ``.soc`` writes ``interiorMapSection``)
    → the DataForge record id string of the same 16 bytes.

    The two spell the bytes in different orders. VERIFIED on LIVE:
    ``649bcee0-2974-4755-b033-a7d5249eb419`` (soc) is the record
    ``29744755-cee0-649b-19b4-9e24d5a733b0`` (InteriorMapSectionDefinition.
    Carrack_Deck_2): the first and second halves of the leading 64 bits swap
    places as 32-bit words, and the trailing 64 bits are byte-reversed.
    """
    h = (guid or "").replace("-", "").lower()
    if len(h) != 32 or any(c not in "0123456789abcdef" for c in h):
        return None
    g1, g2, g3, tail = h[0:8], h[8:12], h[12:16], h[16:32]
    rev = "".join(tail[i:i + 2] for i in range(14, -2, -2))
    return f"{g2}{g3}-{g1[4:8]}-{g1[0:4]}-{rev[0:4]}-{rev[4:16]}"


def is_unnamed(loc_key: Optional[str]) -> bool:
    return (loc_key or "").strip().lower() in _NULL_NAME_KEYS


def bounds_of(rooms: Iterable[Dict[str, Any]]) -> Optional[Dict[str, List[float]]]:
    """2D ``{min: [x, y], max: [x, y]}`` over every room shape (or pin)."""
    xs: List[float] = []
    ys: List[float] = []
    for r in rooms:
        pts = [p for s in r["shapes"] + r.get("tris", []) for p in s] or [r["pos"][:2]]
        xs += [p[0] for p in pts]
        ys += [p[1] for p in pts]
    if not xs:
        return None
    return {"min": [min(xs), min(ys)], "max": [max(xs), max(ys)]}
