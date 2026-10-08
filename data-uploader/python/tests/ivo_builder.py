"""Minimal CryEngine ``#ivo`` blob builder for CI tests.

Produces a structurally-valid Ivo file with the two chunks
:mod:`sc_extract.geometry` reads — the CRC-32 name table (``0xc201973c``) and the
node/transform table (``0x70697fda``) — plus optionally the AABB chunk
(``0x92914444``). Layout mirrors the reader's documented expectations:

  header (16 B)  |  chunk header table (16 B/chunk)  |  chunk payloads

The chunk table is written directly after the file header so every chunk payload
runs cleanly up to the next chunk offset (the reader derives chunk length from
the following chunk's offset — lengths are not stored on disk).
"""

from __future__ import annotations

import struct
import zlib
from typing import Dict, List, Optional, Sequence, Tuple

IVO_SIG = b"#ivo"
BBOX_CHUNK = 0x92914444
NAME_CHUNK = 0xC201973C
NODE_CHUNK = 0x70697FDA

NAME_TABLE_START = 48
NAME_ENTRY_STRIDE = 16
NODE_BASE = 64
NODE_STRIDE = 208

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def matrix34(pos: Sequence[float], rot: Sequence[Sequence[float]] = IDENTITY) -> bytes:
    """Row-major Matrix34: 3 rows of (basis x3, translation)."""
    return struct.pack(
        "<12f",
        rot[0][0], rot[0][1], rot[0][2], pos[0],
        rot[1][0], rot[1][1], rot[1][2], pos[1],
        rot[2][0], rot[2][1], rot[2][2], pos[2],
    )


def name_chunk(names: Dict[str, int], extra_strings: Sequence[str] = ()) -> bytes:
    """CRC-32 name table: count, entries at offset 48, then the string blob."""
    buf = bytearray(struct.pack("<I", len(names)))
    buf.extend(b"\x00" * (NAME_TABLE_START - len(buf)))
    for name, index in names.items():
        entry = struct.pack(
            "<IHHHHH", zlib.crc32(name.encode("utf-8")) & 0xFFFFFFFF, 0, 0, 0, 0, index
        )
        buf.extend(entry)
        buf.extend(b"\x00" * (NAME_ENTRY_STRIDE - len(entry)))
    blob = list(names) + list(extra_strings)
    buf.extend(b"\x00".join(s.encode("utf-8") for s in blob) + b"\x00")
    return bytes(buf)


def node_chunk(
    nodes: Sequence[Tuple[Sequence[float], Sequence[float]]],
    stride: int = NODE_STRIDE,
    declared_count: Optional[int] = None,
) -> bytes:
    """Node table: count in the 2nd u32, records from offset 64 at ``stride``."""
    count = len(nodes) if declared_count is None else declared_count
    buf = bytearray(struct.pack("<8I", 0, count, 0, 0, 0, 0, 0, 0))
    buf.extend(b"\x00" * (NODE_BASE - len(buf)))
    for world, local in nodes:
        record = bytearray(matrix34(world) + matrix34(local))
        record.extend(b"\x00" * (stride - len(record)))
        buf.extend(record)
    return bytes(buf)


def bbox_chunk(mn: Sequence[float], mx: Sequence[float]) -> bytes:
    """AABB metadata chunk: (min, max) float triples at byte offset 24."""
    buf = bytearray(b"\x00" * 24)
    buf.extend(struct.pack("<6f", *mn, *mx))
    buf.extend(b"\x00" * 32)
    return bytes(buf)


def ivo(chunks: Sequence[Tuple[int, bytes]], version: int = 0x900) -> bytes:
    """Assemble a full Ivo blob from ``(chunk_type, payload)`` pairs."""
    header_size = 16
    table_size = len(chunks) * 16
    first_offset = header_size + table_size
    out = bytearray()
    out.extend(IVO_SIG)
    out.extend(struct.pack("<III", version, len(chunks), header_size))
    offset = first_offset
    payloads: List[bytes] = []
    for chunk_type, payload in chunks:
        out.extend(struct.pack("<IIQ", chunk_type, 1, offset))
        payloads.append(payload)
        offset += len(payload)
    for payload in payloads:
        out.extend(payload)
    return bytes(out)


def ship_mesh(
    helpers: Dict[str, Sequence[float]],
    bbox: Optional[Tuple[Sequence[float], Sequence[float]]] = None,
) -> bytes:
    """A mesh whose named nodes sit at the given model-space positions.

    Node 0 is an unnamed root so indices are not trivially 0-based, which also
    proves the name table's index mapping is honoured. The node chunk is written
    last so it ends exactly at EOF (the reader's stride validation is exact).
    """
    names: Dict[str, int] = {}
    nodes: List[Tuple[Sequence[float], Sequence[float]]] = [((0.0, 0.0, 0.0), (0.0, 0.0, 0.0))]
    for name, pos in helpers.items():
        names[name] = len(nodes)
        nodes.append((pos, pos))
    chunks: List[Tuple[int, bytes]] = []
    if bbox is not None:
        chunks.append((BBOX_CHUNK, bbox_chunk(bbox[0], bbox[1])))
    chunks.append((NAME_CHUNK, name_chunk(names)))
    chunks.append((NODE_CHUNK, node_chunk(nodes)))
    return ivo(chunks)


# ── LIVE 4.x layout (verified on AEGS_Gladius / DRAK_Cutlass_Black, #643) ─────
def live_node_chunk(
    nodes: Sequence[Tuple[Sequence[float], Sequence[float]]],
    names: Sequence[str],
    n_index_list: int = 3,
    n_subsets: int = 5,
    tail: bytes = b"",
) -> bytes:
    """Node chunk as LIVE 4.x writes it: header ``[1]`` node count, ``[3]``
    u16-index-list count, ``[4]`` mesh-subset count, ``[5]`` string-table size;
    records, then the two u16 lists, then one NUL-terminated name per node in
    node order (``tail`` lets a test append trailing bytes)."""
    table = b"".join(n.encode("utf-8") + b"\x00" for n in names)
    hdr = struct.pack("<8I", 32, len(nodes), 1, n_index_list, n_subsets, len(table), 0, 0)
    buf = bytearray(hdr)
    buf.extend(b"\x00" * (NODE_BASE - len(buf)))
    for world, local in nodes:
        record = bytearray(matrix34(world) + matrix34(local))
        record.extend(b"\x00" * (NODE_STRIDE - len(record)))
        buf.extend(record)
    buf.extend(b"\x07\x00" * (n_index_list + n_subsets))  # u16 lists, content irrelevant
    buf.extend(table)
    buf.extend(tail)
    return bytes(buf)


def live_name_chunk(names: Sequence[str]) -> bytes:
    """``0xc201973c`` v0x901 as LIVE ships it: ``[count, string-size]`` header
    and 16-byte entries whose 6th u16 is NOT the node index any more (it reads
    ``0xffff`` / unrelated values) — the reason the CRC table resolved 1 of 273
    names on AEGS_Gladius."""
    blob = b"".join(n.encode("utf-8") + b"\x00" for n in names)
    buf = bytearray(struct.pack("<II", len(names), len(blob)))
    buf.extend(b"\x00" * (NAME_TABLE_START - len(buf)))
    for n in names:
        buf.extend(struct.pack("<IHHHHHH", zlib.crc32(n.encode("utf-8")) & 0xFFFFFFFF,
                               1, 3, 0xFFFF, 0xFFFF, 0xFFFF, 0x13))
    buf.extend(blob)
    return bytes(buf)


def live_ship_mesh(
    helpers: Dict[str, Sequence[float]],
    bbox: Optional[Tuple[Sequence[float], Sequence[float]]] = None,
) -> bytes:
    """A LIVE-4.x-shaped hull: root node ``Body`` offset from the origin (as on
    the Cutlass), named helpers parented to it, names only resolvable from the
    node chunk's string table."""
    root = (0.0, 6.85, -0.59)
    names = ["Body"]
    nodes: List[Tuple[Sequence[float], Sequence[float]]] = [(root, root)]
    for name, pos in helpers.items():
        names.append(name)
        nodes.append((pos, tuple(pos[k] - root[k] for k in range(3))))
    chunks: List[Tuple[int, bytes]] = [(NAME_CHUNK, live_name_chunk(names))]
    chunks.append((NODE_CHUNK, live_node_chunk(nodes, names)))
    if bbox is not None:
        chunks.append((BBOX_CHUNK, bbox_chunk(bbox[0], bbox[1])))
    return ivo(chunks)
