"""Ship/item DIMENSIONS from CryEngine ``.cga`` geometry (Ivo chunk format).

SC 4.x physical sizes (length/width/height in metres) are NOT stored in the
DataCore — every ``SGeometryNodeParams.BBoxRadius`` is ``0`` and the only
``size`` fields are gameplay port-sizes (1..12). The real axis-aligned bounding
box lives in the ``.cga`` mesh referenced by the entity's geometry component.

scdatatools 1.0.4 cannot parse SC 4.x Ivo *geometry* chunks (unknown chunk-type
ids), so we read the bbox directly. Verified layout (``#ivo`` v0x900):

  * file header: signature ``#ivo``, version u32, num_chunks u32,
    chunk_hdr_table_offset u32.
  * each chunk header (16 bytes): type u32, version u32, offset u64.
  * chunk type ``0x92914444`` (~248-256 bytes) carries the AABB as two
    consecutive ``Vec3`` (min, max) of float32 at byte-offset 24 within the
    chunk. Validated against AEGS_Avenger / DRAK_Cutlass_Black / AEGS_Gladius /
    MISC_Freelancer — extents match published ship dimensions within metres.

We don't hardcode the offset: we scan the chunk for the first float triple-pair
where ``min < max`` componentwise and every extent is in a plausible range, so a
differing prefix on some assets still resolves correctly.
"""

from __future__ import annotations

import struct
from typing import Dict, Optional

_IVO_SIG = b"#ivo"
_BBOX_CHUNK_TYPE = 0x92914444
# plausible metre extents for any single ship/item axis
_MIN_EXTENT = 0.3
_MAX_EXTENT = 2000.0


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


def bbox_from_cga_bytes(raw: bytes) -> Optional[Dict[str, float]]:
    """Parse a ``.cga`` blob and return {length,width,height,min,max} in metres."""
    if len(raw) < 16 or raw[:4] != _IVO_SIG:
        return None
    try:
        _sig, _ver, num_chunks, tbl_off = struct.unpack_from("<IIII", raw, 0)
    except struct.error:
        return None
    if not (0 < num_chunks < 64) or tbl_off + num_chunks * 16 > len(raw):
        return None
    headers = []
    for i in range(num_chunks):
        t, v, off = struct.unpack_from("<IIQ", raw, tbl_off + i * 16)
        headers.append((t, off))
    offsets = sorted(o for _, o in headers)

    def chunk_end(off: int) -> int:
        for o in offsets:
            if o > off:
                return o
        return len(raw)

    # Prefer the known bbox chunk; fall back to scanning all small chunks.
    candidates = [(t, off) for (t, off) in headers if t == _BBOX_CHUNK_TYPE]
    candidates += [(t, off) for (t, off) in headers if t != _BBOX_CHUNK_TYPE]
    for _t, off in candidates:
        if off < 0 or off >= len(raw):
            continue
        seg = raw[off : chunk_end(off)]
        if len(seg) > 4096:  # bbox lives in a small metadata chunk, skip mesh data
            continue
        dims = _bbox_from_chunk(seg)
        if dims:
            return dims
    return None


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
