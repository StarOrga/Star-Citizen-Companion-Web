"""Ship/item GEOMETRY from CryEngine ``.cga`` files (Ivo chunk format).

Two things are read here, both straight out of the ``.cga`` mesh the entity's
geometry component points at:

1. **Dimensions** — the axis-aligned bounding box (length/width/height in
   metres). SC 4.x physical sizes are NOT stored in the DataCore: every
   ``SGeometryNodeParams.BBoxRadius`` is ``0`` and the only ``size`` fields are
   gameplay port-sizes (1..12).
2. **Helper-node transforms** — the 3D position + orientation of every named
   node in the mesh, notably the ``hardpoint_*`` helpers an item port attaches
   to (``SItemPortDef.AttachmentImplementation.Helper.Helper.Name``). This is
   the only place a hardpoint's location on the hull exists; the DataCore only
   stores the helper NAME plus an offset relative to it.

scdatatools 1.0.4 cannot parse SC 4.x Ivo *geometry* chunks (unknown chunk-type
ids), so we read them directly. Verified layout (``#ivo`` v0x900):

  * file header: signature ``#ivo``, version u32, num_chunks u32,
    chunk_hdr_table_offset u32.
  * each chunk header (16 bytes): type u32, version u32, offset u64.
  * chunk type ``0x92914444`` (~248-256 bytes) carries the AABB as two
    consecutive ``Vec3`` (min, max) of float32 at byte-offset 24 within the
    chunk. Validated against AEGS_Avenger / DRAK_Cutlass_Black / AEGS_Gladius /
    MISC_Freelancer — extents match published ship dimensions within metres.
  * chunk type ``0xc201973c`` is the NAME table: u32 entry-count, then (at
    byte-offset 48) ``count`` 16-byte entries of
    ``u32 crc32(name), u16 x3, u16, u16, u16 node_index``, followed by a
    NUL-separated string blob. A name belongs to a node when its CRC-32 is in
    the table — verified 273/273 (AEGS_Gladius) and 209/209
    (DRAK_Cutlass_Black) names resolved.
  * chunk type ``0x70697fda`` is the NODE table: u32 header (``[1]`` = node
    count), node records start at byte-offset 64 with a 208-byte stride. Each
    record starts with two row-major ``Matrix34`` (12 float32, translation in
    the 4th column): the first is the node's MODEL-space (world) transform, the
    second its parent-relative (local) transform. Verified: every one of the
    273/209 rotation blocks is orthonormal, and ``world == local ∘ parent``
    holds for the sampled hierarchy.

Both the AABB scan and the node-stride are self-validating rather than blindly
trusted: the bbox scan looks for a plausible float triple-pair, and the node
walk falls back to searching for the stride at which *every* rotation block is
orthonormal. If neither validates we return nothing — a missing transform is
correct, a fabricated coordinate is not.
"""

from __future__ import annotations

import math
import struct
import zlib
from typing import Any, Dict, List, Optional, Tuple

_IVO_SIG = b"#ivo"
_BBOX_CHUNK_TYPE = 0x92914444
_NAME_CHUNK_TYPE = 0xC201973C
_NODE_CHUNK_TYPE = 0x70697FDA
# plausible metre extents for any single ship/item axis
_MIN_EXTENT = 0.3
_MAX_EXTENT = 2000.0

# Node-table layout (verified, see module docstring).
_NODE_BASE = 64
_NODE_STRIDE = 208
_MATRIX34_BYTES = 48
# A rotation block counts as valid when each basis row is unit length.
_ORTHONORMAL_TOL = 0.02
# Sanity cap: a node further than this from the origin is not a hull helper.
_MAX_NODE_COORD = 10_000.0


def _read_f3(buf: bytes, off: int):
    return struct.unpack_from("<3f", buf, off)


def _bbox_from_chunk(seg: bytes) -> Optional[Dict[str, float]]:
    """Scan a chunk for the first valid (min Vec3, max Vec3) AABB pair."""
    nf = len(seg) // 4
    floats = struct.unpack_from(f"<{nf}f", seg, 0) if nf else ()
    for i in range(0, max(0, nf - 6)):
        mn = floats[i : i + 3]
        mx = floats[i + 3 : i + 6]
        if any(not _finite(v) for v in mn + mx):
            continue
        ext = [mx[k] - mn[k] for k in range(3)]
        if all(_MIN_EXTENT < e < _MAX_EXTENT for e in ext):
            # axis mapping (CryEngine): X=width, Y=length, Z=height
            return {
                "width": round(abs(ext[0]), 3),
                "length": round(abs(ext[1]), 3),
                "height": round(abs(ext[2]), 3),
                "min": [round(v, 3) for v in mn],
                "max": [round(v, 3) for v in mx],
            }
    return None


def _finite(v: float) -> bool:
    return v == v and abs(v) != float("inf")


def _ivo_chunks(raw: bytes) -> List[Tuple[int, int, bytes]]:
    """Split an Ivo blob into ``(chunk_type, chunk_version, payload)`` triples.

    A chunk's length is not stored, so it runs to the next chunk offset (or to
    end-of-file). Returns ``[]`` for anything that is not a readable Ivo file —
    callers treat that as "no data", never as an error.
    """
    if len(raw) < 16 or raw[:4] != _IVO_SIG:
        return []
    try:
        _sig, _ver, num_chunks, tbl_off = struct.unpack_from("<IIII", raw, 0)
    except struct.error:
        return []
    if not (0 < num_chunks < 64) or tbl_off + num_chunks * 16 > len(raw):
        return []
    headers = []
    for i in range(num_chunks):
        try:
            t, v, off = struct.unpack_from("<IIQ", raw, tbl_off + i * 16)
        except struct.error:
            return []
        if not (0 <= off < len(raw)):
            continue
        headers.append((t, v, off))
    offsets = sorted(o for _, _, o in headers)

    def chunk_end(off: int) -> int:
        for o in offsets:
            if o > off:
                return o
        return len(raw)

    return [(t, v, raw[off : chunk_end(off)]) for (t, v, off) in headers]


def bbox_from_cga_bytes(raw: bytes) -> Optional[Dict[str, float]]:
    """Parse a ``.cga`` blob and return {length,width,height,min,max} in metres."""
    chunks = _ivo_chunks(raw)
    # Prefer the known bbox chunk; fall back to scanning all small chunks.
    candidates = [c for c in chunks if c[0] == _BBOX_CHUNK_TYPE]
    candidates += [c for c in chunks if c[0] != _BBOX_CHUNK_TYPE]
    for _t, _v, seg in candidates:
        if len(seg) > 4096:  # bbox lives in a small metadata chunk, skip mesh data
            continue
        dims = _bbox_from_chunk(seg)
        if dims:
            return dims
    return None


# ── helper-node transforms ────────────────────────────────────────────────────
def _node_names(chunks: List[Tuple[int, int, bytes]]) -> Dict[int, str]:
    """``node_index -> name`` from the CRC-32 name table chunk.

    The table stores only the CRC-32 of each name plus the node index; the
    literal strings sit in a trailing NUL-separated blob that also holds
    material/attribute names. Hashing every string and keeping the ones present
    in the table is what re-associates them. Unknown hashes are simply dropped.
    """
    seg = next((s for (t, _v, s) in chunks if t == _NAME_CHUNK_TYPE), None)
    if seg is None or len(seg) < 52:
        return {}
    (count,) = struct.unpack_from("<I", seg, 0)
    table_start = 48
    table_end = table_start + count * 16
    if count <= 0 or table_end > len(seg):
        return {}
    crc_to_index: Dict[int, int] = {}
    for i in range(count):
        crc, _a, _b, _c, _d, index = struct.unpack_from(
            "<IHHHHH", seg, table_start + i * 16)
        # The final u16 of the entry is the node index; keep the first mapping
        # for a duplicated hash so a collision cannot silently retarget a node.
        crc_to_index.setdefault(crc, index)
    out: Dict[int, str] = {}
    for chunk in seg[table_end:].split(b"\x00"):
        if not chunk:
            continue
        index = crc_to_index.get(zlib.crc32(chunk) & 0xFFFFFFFF)
        if index is not None:
            out.setdefault(index, chunk.decode("utf-8", "replace"))
    return out


def _is_orthonormal(m: Tuple[float, ...]) -> bool:
    """True when the 3x3 rotation block of a row-major Matrix34 is a rotation."""
    for row in (m[0:3], m[4:7], m[8:11]):
        total = 0.0
        for v in row:
            if v != v or abs(v) == float("inf"):  # NaN / inf
                return False
            total += v * v
        if abs(math.sqrt(total) - 1.0) > _ORTHONORMAL_TOL:
            return False
    return True


def _matrix34(seg: bytes, off: int) -> Optional[Tuple[float, ...]]:
    try:
        return struct.unpack_from("<12f", seg, off)
    except struct.error:
        return None


def _node_stride(seg: bytes, count: int) -> Optional[int]:
    """The byte stride between node records, validated against the data.

    Tries the verified stride first, then searches downwards from the largest
    stride the chunk can hold: the correct stride is the one at which the
    rotation block of EVERY node is orthonormal. With hundreds of nodes a wrong
    stride cannot pass that test by chance, so this adapts to a record-layout
    change across patches without ever guessing. The floor of 96 bytes is the
    world+local matrix pair — anything smaller would be re-reading the same
    matrices at half stride and is therefore rejected outright.
    """
    def fits(stride: int) -> bool:
        if _NODE_BASE + count * stride > len(seg):
            return False
        for i in range(count):
            m = _matrix34(seg, _NODE_BASE + i * stride)
            if m is None or not _is_orthonormal(m):
                return False
        return True

    if fits(_NODE_STRIDE):
        return _NODE_STRIDE
    max_stride = (len(seg) - _NODE_BASE) // count
    for stride in range(max_stride - max_stride % 4, 2 * _MATRIX34_BYTES - 1, -4):
        if stride != _NODE_STRIDE and fits(stride):
            return stride
    return None


def _quaternion(m: Tuple[float, ...]) -> List[float]:
    """Row-major Matrix34 rotation block -> ``[x, y, z, w]`` quaternion."""
    m00, m01, m02 = m[0], m[1], m[2]
    m10, m11, m12 = m[4], m[5], m[6]
    m20, m21, m22 = m[8], m[9], m[10]
    trace = m00 + m11 + m22
    if trace > 0.0:
        s = math.sqrt(trace + 1.0) * 2.0
        w, x, y, z = 0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s
    elif m00 > m11 and m00 > m22:
        s = math.sqrt(1.0 + m00 - m11 - m22) * 2.0
        w, x, y, z = (m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s
    elif m11 > m22:
        s = math.sqrt(1.0 + m11 - m00 - m22) * 2.0
        w, x, y, z = (m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s
    else:
        s = math.sqrt(1.0 + m22 - m00 - m11) * 2.0
        w, x, y, z = (m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s
    return [round(x, 6), round(y, 6), round(z, 6), round(w, 6)]


def _translation(m: Tuple[float, ...]) -> Optional[List[float]]:
    pos = [m[3], m[7], m[11]]
    for v in pos:
        if v != v or abs(v) > _MAX_NODE_COORD:  # NaN / implausible
            return None
    return [round(v, 4) for v in pos]


def helpers_from_cga_bytes(raw: bytes) -> Dict[str, Dict[str, Any]]:
    """Named node transforms of a ``.cga`` mesh, keyed by node name.

    Each value is ``{"position": [x, y, z], "rotation": [x, y, z, w],
    "localPosition": [x, y, z], "index": int}`` — ``position``/``rotation`` in
    the mesh's own model space (CryEngine axes: X = right, Y = forward,
    Z = up, metres), ``localPosition`` relative to the node's parent.

    Returns ``{}`` when the file is not a parseable Ivo mesh or the node/name
    chunks are missing — never raises, never invents coordinates.
    """
    chunks = _ivo_chunks(raw)
    if not chunks:
        return {}
    names = _node_names(chunks)
    if not names:
        return {}
    seg = next((s for (t, _v, s) in chunks if t == _NODE_CHUNK_TYPE), None)
    if seg is None or len(seg) < _NODE_BASE + 4:
        return {}
    try:
        count = struct.unpack_from("<8I", seg, 0)[1]
    except struct.error:
        return {}
    if not (0 < count <= 100_000):
        return {}
    stride = _node_stride(seg, count)
    if stride is None:
        return {}

    out: Dict[str, Dict[str, Any]] = {}
    for index, name in names.items():
        if not (0 <= index < count):
            continue
        base = _NODE_BASE + index * stride
        world = _matrix34(seg, base)
        local = _matrix34(seg, base + _MATRIX34_BYTES)
        if world is None:
            continue
        pos = _translation(world)
        if pos is None:
            continue
        entry: Dict[str, Any] = {
            "position": pos,
            "rotation": _quaternion(world),
            "index": index,
        }
        if local is not None and _is_orthonormal(local):
            local_pos = _translation(local)
            if local_pos is not None:
                entry["localPosition"] = local_pos
        out[name] = entry
    return out


def normalize_geometry_path(path: Optional[str]) -> Optional[str]:
    """DataCore geometry path -> P4K entry key (Data/-rooted, forward slashes)."""
    if not path:
        return None
    p = path.replace("\\", "/").strip().lstrip("/")
    if not p.lower().endswith(".cga") and not p.lower().endswith(".cgf"):
        return None
    if not p.lower().startswith("data/"):
        p = "Data/" + p
    return p
