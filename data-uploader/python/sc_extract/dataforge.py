"""Pure-Python DataForge (DCB) reader for Star Citizen 4.x — versions 6 and 8.

WHY THIS EXISTS
---------------
scdatatools 1.0.4's ``DataCoreBinary`` cannot parse the live ``Data/Game2.dcb``:
the SC 4.x DataCore is **DataForge version 8**, and v8 grew the per-record
struct from 32 to 36 bytes (a ``tag_offset`` field was inserted). scdatatools
still reads 32-byte records, so after ~115k records every subsequent section
offset is wrong and ``DataCoreBinary.__init__`` aborts on
``assert offset == len(self.raw_data)``.

This module is a faithful, independent re-implementation of the binary format,
ported from the (MIT/Apache-licensed) StarBreaker Rust reader
(``diogotr7/StarBreaker`` :: ``crates/starbreaker-datacore``). It is original
Python code modelled on the documented on-disk layout — no game assets are
embedded; only the format grammar.

WHAT IT PRODUCES
----------------
``DataForge(blob)`` parses the whole container, then:
  * ``records`` — list of :class:`Record` (top-level objects).
  * ``record_to_dict(record)`` — fully resolves a record's object graph to a
    plain JSON-able dict, following StrongPointers, inline Classes, same-file
    References (inlined) and cross-file References (emitted as a ``{_RecordId_,
    _RecordName_, _RecordPath_}`` stub). WeakPointers are emitted as a
    ``_PointsTo_:ptr:N`` label with a ``_Pointers_`` appendix, mirroring
    StarBreaker / unp4k JSON so downstream tooling stays compatible.
  * ``record_types`` / ``records_by_type_name`` / ``record_by_id`` —
    discovery + lookup helpers.

The format grammar (header layout, section order, v6 vs v8 record size, the
0x0001..0x0310 data-type codes and their inline sizes, the four conversion
types, the two string tables, instance-data offset math) is taken verbatim
from the on-disk structures.
"""

from __future__ import annotations

import struct
from typing import Any, Dict, Iterator, List, Optional, Tuple

# ── Data type codes (DataForge property data_type field) ──────────────────────
DT_BOOLEAN = 0x0001
DT_SBYTE = 0x0002
DT_INT16 = 0x0003
DT_INT32 = 0x0004
DT_INT64 = 0x0005
DT_BYTE = 0x0006
DT_UINT16 = 0x0007
DT_UINT32 = 0x0008
DT_UINT64 = 0x0009
DT_STRING = 0x000A
DT_SINGLE = 0x000B
DT_DOUBLE = 0x000C
DT_LOCALE = 0x000D
DT_GUID = 0x000E
DT_ENUMCHOICE = 0x000F
DT_CLASS = 0x0010
DT_STRONGPOINTER = 0x0110
DT_WEAKPOINTER = 0x0210
DT_REFERENCE = 0x0310

_INLINE_SIZE = {
    DT_BOOLEAN: 1, DT_SBYTE: 1, DT_BYTE: 1,
    DT_INT16: 2, DT_UINT16: 2,
    DT_INT32: 4, DT_UINT32: 4, DT_ENUMCHOICE: 4,
    DT_INT64: 8, DT_UINT64: 8,
    DT_SINGLE: 4, DT_DOUBLE: 8,
    DT_STRING: 4, DT_LOCALE: 4,
    DT_GUID: 16,
    DT_STRONGPOINTER: 8, DT_WEAKPOINTER: 8,
    DT_REFERENCE: 20,
    DT_CLASS: 0,  # variable/recursive
}

# ── Conversion types (how the property is stored) ─────────────────────────────
CONV_ATTRIBUTE = 0x00  # inline scalar / single Class
# 0x01 ComplexArray, 0x02 SimpleArray, 0x03 ClassArray — all stored as
# (count:i32, first_index:i32) pointing into the matching value array.

_EMPTY_GUID = b"\x00" * 16


def _guid_str(b: bytes) -> str:
    """Format a 16-byte CIG GUID like the canonical 8-4-4-4-12 hex string.

    CIG stores the GUID as little-endian for the first three groups (same as
    .NET ``Guid`` / Windows GUID byte order), which StarBreaker mirrors.
    """
    d1 = struct.unpack_from("<I", b, 0)[0]
    d2 = struct.unpack_from("<H", b, 4)[0]
    d3 = struct.unpack_from("<H", b, 6)[0]
    rest = b[8:16]
    return (
        f"{d1:08x}-{d2:04x}-{d3:04x}-"
        f"{rest[0]:02x}{rest[1]:02x}-"
        f"{rest[2]:02x}{rest[3]:02x}{rest[4]:02x}{rest[5]:02x}{rest[6]:02x}{rest[7]:02x}"
    )


class _Reader:
    """Cursor over a memoryview; little-endian primitive reads."""

    __slots__ = ("mv", "off")

    def __init__(self, mv: memoryview, off: int = 0) -> None:
        self.mv = mv
        self.off = off

    def bytes(self, n: int) -> memoryview:
        b = self.mv[self.off : self.off + n]
        self.off += n
        return b

    def i8(self) -> int:
        v = struct.unpack_from("<b", self.mv, self.off)[0]; self.off += 1; return v

    def u8(self) -> int:
        v = self.mv[self.off]; self.off += 1; return v

    def i16(self) -> int:
        v = struct.unpack_from("<h", self.mv, self.off)[0]; self.off += 2; return v

    def u16(self) -> int:
        v = struct.unpack_from("<H", self.mv, self.off)[0]; self.off += 2; return v

    def i32(self) -> int:
        v = struct.unpack_from("<i", self.mv, self.off)[0]; self.off += 4; return v

    def u32(self) -> int:
        v = struct.unpack_from("<I", self.mv, self.off)[0]; self.off += 4; return v

    def i64(self) -> int:
        v = struct.unpack_from("<q", self.mv, self.off)[0]; self.off += 8; return v

    def u64(self) -> int:
        v = struct.unpack_from("<Q", self.mv, self.off)[0]; self.off += 8; return v

    def f32(self) -> float:
        v = struct.unpack_from("<f", self.mv, self.off)[0]; self.off += 4; return v

    def f64(self) -> float:
        v = struct.unpack_from("<d", self.mv, self.off)[0]; self.off += 8; return v

    def advance(self, n: int) -> None:
        self.off += n


class Record:
    """A top-level DataCore record (the unit other code treats as an entity)."""

    __slots__ = ("name", "filename", "tag", "type", "struct_index",
                 "instance_index", "guid", "index", "file_off")

    def __init__(self, name, filename, tag, type_name, struct_index,
                 instance_index, guid, index, file_off) -> None:
        self.name = name
        self.filename = filename
        self.tag = tag
        self.type = type_name
        self.struct_index = struct_index
        self.instance_index = instance_index
        self.guid = guid
        self.index = index          # position in DataForge.records
        self.file_off = file_off    # raw file_name_offset (for same-file ref test)

    def __repr__(self) -> str:
        return f"<Record {self.name} type={self.type} guid={self.guid}>"


class DataForge:
    """Parsed DataForge v6/v8 container with record_to_dict resolution."""

    def __init__(self, data: bytes | bytearray | memoryview) -> None:
        # A memoryview is adopted as-is (read-only) rather than copied: workers
        # map the raw DataCore out of a shared-memory segment, and copying it
        # per worker would multiply the largest single allocation in the run by
        # the worker count for no benefit — the parse is read-only anyway. The
        # CALLER must keep the underlying buffer alive for this object's
        # lifetime (see parallel_dump._init, which holds the SharedMemory).
        self._buf = data.toreadonly() if isinstance(data, memoryview) else memoryview(bytes(data))
        self._parse()

    # ── Header + section parsing ─────────────────────────────────────────────
    def _parse(self) -> None:
        mv = self._buf
        r = _Reader(mv, 0)
        # 120-byte header
        _magic = r.u32()
        self.version = r.u32()
        if self.version not in (6, 8):
            raise ValueError(f"unsupported DataForge version {self.version}")
        r.advance(2 + 2 + 2 + 2)  # unknown1..4 (u16 x4)
        (struct_count, prop_count, enum_count, dmap_count, record_count,
         bool_c, i8_c, i16_c, i32_c, i64_c, u8_c, u16_c, u32_c, u64_c,
         single_c, double_c, guid_c, string_c, locale_c, enum_v_c,
         strong_c, weak_c, ref_c, enum_opt_c) = struct.unpack_from(
            "<24I", mv, r.off)
        r.advance(24 * 4)
        text_len = r.u32()
        text_len2 = r.u32()

        HEADER = 120
        off = HEADER

        # StructDefinition: name_offset(u32) parent(i32) attr_count(u16)
        #                   first_attr(u16) struct_size(u32) = 16 bytes
        self._struct_defs: List[Tuple[int, int, int, int, int]] = []
        for _ in range(struct_count):
            name_off, parent, attr_c, first_attr, ssize = struct.unpack_from(
                "<IiHHI", mv, off)
            self._struct_defs.append((name_off, parent, attr_c, first_attr, ssize))
            off += 16

        # PropertyDefinition: name_offset(u32) struct_index(u16) data_type(u16)
        #                     conversion_type(u16) padding(u16) = 12 bytes
        self._prop_defs: List[Tuple[int, int, int, int]] = []
        for _ in range(prop_count):
            name_off, sidx, dtype, conv = struct.unpack_from("<IHHH", mv, off)
            self._prop_defs.append((name_off, sidx, dtype, conv))
            off += 12

        # EnumDefinition: name_offset(u32) value_count(u16) first_value(u16) = 8
        self._enum_defs: List[Tuple[int, int, int]] = []
        for _ in range(enum_count):
            name_off, vcount, vfirst = struct.unpack_from("<IHH", mv, off)
            self._enum_defs.append((name_off, vcount, vfirst))
            off += 8

        # DataMapping: struct_count(u32) struct_index(i32) = 8
        self._data_mappings: List[Tuple[int, int]] = []
        for _ in range(dmap_count):
            scount, sidx = struct.unpack_from("<Ii", mv, off)
            self._data_mappings.append((scount, sidx))
            off += 8

        # Records — v8 = 36 bytes (with tag_offset), v6 = 32 bytes.
        self._records_raw: List[Tuple[int, int, int, int, int, int]] = []
        if self.version >= 8:
            for _ in range(record_count):
                name_off, file_off, tag_off, sidx = struct.unpack_from(
                    "<IiiI", mv, off)
                guid = bytes(mv[off + 16 : off + 32])
                inst_idx, _ssize = struct.unpack_from("<HH", mv, off + 32)
                self._records_raw.append(
                    (name_off, file_off, tag_off, sidx, inst_idx, off))
                off += 36
        else:
            for _ in range(record_count):
                name_off, file_off, sidx = struct.unpack_from("<IiI", mv, off)
                guid = bytes(mv[off + 12 : off + 28])
                inst_idx, _ssize = struct.unpack_from("<HH", mv, off + 28)
                self._records_raw.append(
                    (name_off, file_off, -1, sidx, inst_idx, off))
                off += 32
        self._record_guids = [
            bytes(mv[base + (16 if self.version >= 8 else 12):
                     base + (32 if self.version >= 8 else 28)])
            for (*_, base) in self._records_raw
        ]

        # ── Value arrays (raw byte slices; indexed elementwise) ──────────────
        def take(count: int, elem: int):
            nonlocal off
            seg = mv[off : off + count * elem]
            off += count * elem
            return seg

        self._v_i8 = take(i8_c, 1)
        self._v_i16 = take(i16_c, 2)
        self._v_i32 = take(i32_c, 4)
        self._v_i64 = take(i64_c, 8)
        self._v_u8 = take(u8_c, 1)
        self._v_u16 = take(u16_c, 2)
        self._v_u32 = take(u32_c, 4)
        self._v_u64 = take(u64_c, 8)
        self._v_bool = take(bool_c, 1)
        self._v_single = take(single_c, 4)
        self._v_double = take(double_c, 8)
        self._v_guid = take(guid_c, 16)
        self._v_string = take(string_c, 4)   # StringId -> table1
        self._v_locale = take(locale_c, 4)
        self._v_enum = take(enum_v_c, 4)
        self._v_strong = take(strong_c, 8)   # Pointer
        self._v_weak = take(weak_c, 8)       # Pointer
        self._v_ref = take(ref_c, 20)        # Reference
        self._v_enum_opt = take(enum_opt_c, 4)  # StringId2 -> table2

        # ── String tables ────────────────────────────────────────────────────
        self._st1 = mv[off : off + text_len]
        off += text_len
        self._st2 = mv[off : off + text_len2]
        off += text_len2

        # ── Instance data (everything remaining) ──────────────────────────────
        self._instance_data = mv[off:]

        # Per-struct instance base offsets
        self._instance_offsets = [0] * len(self._struct_defs)
        running = 0
        for scount, sidx in self._data_mappings:
            self._instance_offsets[sidx] = running
            running += scount * self._struct_defs[sidx][4]  # struct_size

        # ── Flattened property indices per struct (parent-first) ─────────────
        self._cached_props: List[List[int]] = []
        for si in range(len(self._struct_defs)):
            self._cached_props.append(self._flatten_props(si))

        # ── Build record objects + lookup maps ───────────────────────────────
        self.records: List[Record] = []
        self.records_by_guid: Dict[str, Record] = {}
        self.record_types = set()
        self._records_by_type: Dict[str, List[Record]] = {}
        # main record = last record per file_name_offset
        last_by_file: Dict[int, int] = {}
        for i, (name_off, file_off, tag_off, sidx, inst_idx, base) in enumerate(
                self._records_raw):
            last_by_file[file_off] = i
        self._main_record_ids = set()
        for i in last_by_file.values():
            self._main_record_ids.add(self._record_guids[i])

        self._guid_to_record: Dict[bytes, Record] = {}
        for i, (name_off, file_off, tag_off, sidx, inst_idx, base) in enumerate(
                self._records_raw):
            type_name = self._str2(self._struct_defs[sidx][0])
            rec = Record(
                name=self._str2(name_off),
                filename=self._str1(file_off),
                tag=(self._str2(tag_off) if tag_off != -1 else None),
                type_name=type_name,
                struct_index=sidx,
                instance_index=inst_idx,
                guid=_guid_str(self._record_guids[i]),
                index=i,
                file_off=file_off,
            )
            self.records.append(rec)
            self.records_by_guid[rec.guid] = rec
            self._guid_to_record[self._record_guids[i]] = rec
            self.record_types.add(type_name)
            self._records_by_type.setdefault(type_name, []).append(rec)

    # ── String helpers ──────────────────────────────────────────────────────
    @staticmethod
    def _cstr(table: memoryview, offset: int) -> str:
        if offset < 0 or offset >= len(table):
            return ""
        end = offset
        n = len(table)
        while end < n and table[end] != 0:
            end += 1
        return bytes(table[offset:end]).decode("utf-8", "replace")

    def _str1(self, off: int) -> str:
        return self._cstr(self._st1, off)

    def _str2(self, off: int) -> str:
        return self._cstr(self._st2, off)

    def _flatten_props(self, struct_index: int) -> List[int]:
        chain: List[Tuple[int, int]] = []  # (first_attr, count) child->root
        cur = struct_index
        while cur != -1:
            _no, pa, ac, fa, _sz = self._struct_defs[cur]
            chain.append((fa, ac))
            cur = pa  # parent_type_index is i32; -1 terminates
        # parent-first => reverse
        out: List[int] = []
        for fa, ac in reversed(chain):
            out.extend(range(fa, fa + ac))
        return out

    # ── Instance access ──────────────────────────────────────────────────────
    def _instance_reader(self, struct_index: int, instance_index: int) -> _Reader:
        size = self._struct_defs[struct_index][4]
        base = self._instance_offsets[struct_index] + instance_index * size
        return _Reader(self._instance_data, base)

    # ── Discovery / lookup API ───────────────────────────────────────────────
    def records_by_type_name(self, name: str) -> List[Record]:
        return self._records_by_type.get(name, [])

    def record_by_id(self, guid_str: str) -> Optional[Record]:
        return self.records_by_guid.get(guid_str)

    def iter_records(self) -> Iterator[Record]:
        return iter(self.records)

    # ── Full record resolution (port of walker.rs) ───────────────────────────
    def record_to_dict(self, record: Record, max_depth: int = 64) -> Dict[str, Any]:
        """Resolve a record's full object graph into a JSON-able dict."""
        # weak-pointer prescan
        weak_ids: Dict[Tuple[int, int], int] = {}
        self._prescan_struct(record.struct_index, record.instance_index, weak_ids,
                             record_file_off=record.file_off)
        pointed_to = set(weak_ids.keys())
        ctx = _Ctx(weak_ids, pointed_to, record.file_off)

        out: Dict[str, Any] = {
            "_RecordName_": record.name,
            "_RecordId_": record.guid,
        }
        if record.tag is not None:
            out["_RecordTag_"] = record.tag
        out["_RecordValue_"] = self._walk_instance(
            record.struct_index, record.instance_index, ctx, max_depth)

        if ctx.pointed_to:
            ptrs: Dict[str, Any] = {}
            for key in sorted(ctx.pointed_to, key=lambda k: weak_ids[k]):
                si, ii = key
                obj = {"_Type_": self._str2(self._struct_defs[si][0])}
                rd = self._instance_reader(si, ii)
                self._walk_fields(si, rd, obj, ctx, max_depth)
                ptrs[f"ptr:{weak_ids[key]}"] = obj
            out["_Pointers_"] = ptrs
        return out

    # ── prescan (weak pointers) ──────────────────────────────────────────────
    def _prescan_struct(self, struct_index, instance_index, weak_ids, record_file_off):
        rd = self._instance_reader(struct_index, instance_index)
        self._prescan_fields(struct_index, rd, weak_ids, record_file_off)

    def _prescan_fields(self, struct_index, rd, weak_ids, file_off):
        for pi in self._cached_props[struct_index]:
            _no, p_sidx, dtype, conv = self._prop_defs[pi]
            if conv == CONV_ATTRIBUTE:
                self._prescan_attr(dtype, p_sidx, rd, weak_ids, file_off)
            else:
                self._prescan_array(dtype, p_sidx, rd, weak_ids, file_off)

    def _prescan_attr(self, dtype, p_sidx, rd, weak_ids, file_off):
        if dtype == DT_WEAKPOINTER:
            si, ii = rd.i32(), rd.i32()
            if not (si == -1 and ii == -1):
                weak_ids.setdefault((si, ii), len(weak_ids) + 1)
        elif dtype == DT_STRONGPOINTER:
            si, ii = rd.i32(), rd.i32()
            if not (si == -1 and ii == -1):
                sr = self._instance_reader(si, ii)
                self._prescan_fields(si, sr, weak_ids, file_off)
        elif dtype == DT_REFERENCE:
            ii = rd.i32(); gid = bytes(rd.bytes(16))
            self._prescan_ref(gid, weak_ids, file_off)
        elif dtype == DT_CLASS:
            self._prescan_fields(p_sidx, rd, weak_ids, file_off)
        else:
            rd.advance(_INLINE_SIZE[dtype])

    def _prescan_array(self, dtype, p_sidx, rd, weak_ids, file_off):
        count = rd.i32(); first = rd.i32()
        for i in range(first, first + count):
            if dtype == DT_WEAKPOINTER:
                si, ii = struct.unpack_from("<ii", self._v_weak, i * 8)
                if not (si == -1 and ii == -1):
                    weak_ids.setdefault((si, ii), len(weak_ids) + 1)
            elif dtype == DT_STRONGPOINTER:
                si, ii = struct.unpack_from("<ii", self._v_strong, i * 8)
                if not (si == -1 and ii == -1):
                    sr = self._instance_reader(si, ii)
                    self._prescan_fields(si, sr, weak_ids, file_off)
            elif dtype == DT_REFERENCE:
                gid = bytes(self._v_ref[i * 20 + 4 : i * 20 + 20])
                self._prescan_ref(gid, weak_ids, file_off)
            elif dtype == DT_CLASS:
                sr = self._instance_reader(p_sidx, i)
                self._prescan_fields(p_sidx, sr, weak_ids, file_off)

    def _prescan_ref(self, gid: bytes, weak_ids, file_off):
        if gid == _EMPTY_GUID:
            return
        tgt = self._guid_to_record.get(gid)
        if tgt is None or gid in self._main_record_ids:
            return
        if tgt.file_off != file_off:
            return
        sr = self._instance_reader(tgt.struct_index, tgt.instance_index)
        self._prescan_fields(tgt.struct_index, sr, weak_ids, file_off)

    # ── full walk ─────────────────────────────────────────────────────────────
    def _walk_instance(self, struct_index, instance_index, ctx, depth) -> Dict[str, Any]:
        obj: Dict[str, Any] = {}
        key = (struct_index, instance_index)
        wid = ctx.weak_ids.get(key)
        if wid is not None:
            obj["_Pointer_"] = f"ptr:{wid}"
            ctx.pointed_to.discard(key)
        obj["_Type_"] = self._str2(self._struct_defs[struct_index][0])
        rd = self._instance_reader(struct_index, instance_index)
        self._walk_fields(struct_index, rd, obj, ctx, depth)
        return obj

    def _walk_fields(self, struct_index, rd, obj, ctx, depth):
        for pi in self._cached_props[struct_index]:
            name_off, p_sidx, dtype, conv = self._prop_defs[pi]
            name = self._str2(name_off)
            if conv == CONV_ATTRIBUTE:
                obj[name] = self._walk_attr(dtype, p_sidx, rd, ctx, depth)
            else:
                obj[name] = self._walk_array(dtype, p_sidx, rd, ctx, depth)

    def _walk_attr(self, dtype, p_sidx, rd, ctx, depth) -> Any:
        if dtype == DT_BOOLEAN:
            return rd.u8() != 0
        if dtype == DT_SBYTE:
            return rd.i8()
        if dtype == DT_INT16:
            return rd.i16()
        if dtype == DT_INT32:
            return rd.i32()
        if dtype == DT_INT64:
            return rd.i64()
        if dtype == DT_BYTE:
            return rd.u8()
        if dtype == DT_UINT16:
            return rd.u16()
        if dtype == DT_UINT32:
            return rd.u32()
        if dtype == DT_UINT64:
            return rd.u64()
        if dtype == DT_SINGLE:
            return rd.f32()
        if dtype == DT_DOUBLE:
            return rd.f64()
        if dtype in (DT_STRING, DT_LOCALE, DT_ENUMCHOICE):
            return self._str1(rd.i32())
        if dtype == DT_GUID:
            return _guid_str(bytes(rd.bytes(16)))
        if dtype == DT_CLASS:
            if depth <= 0:
                rd.advance(self._struct_defs[p_sidx][4])
                return {"_truncated_": True}
            sub = {"_Type_": self._str2(self._struct_defs[p_sidx][0])}
            self._walk_fields(p_sidx, rd, sub, ctx, depth - 1)
            return sub
        if dtype == DT_STRONGPOINTER:
            si, ii = rd.i32(), rd.i32()
            if si == -1 and ii == -1:
                return None
            if depth <= 0:
                return {"_truncated_": True}
            return self._walk_instance(si, ii, ctx, depth - 1)
        if dtype == DT_WEAKPOINTER:
            si, ii = rd.i32(), rd.i32()
            if si == -1 and ii == -1:
                return None
            wid = ctx.weak_ids.get((si, ii))
            return f"_PointsTo_:ptr:{wid}" if wid is not None else None
        if dtype == DT_REFERENCE:
            ii = rd.i32(); gid = bytes(rd.bytes(16))
            return self._resolve_ref(gid, ctx, depth)
        raise ValueError(f"unknown data_type {dtype:#06x}")

    def _walk_array(self, dtype, p_sidx, rd, ctx, depth) -> List[Any]:
        count = rd.i32(); first = rd.i32()
        out: List[Any] = []
        for i in range(first, first + count):
            if dtype == DT_BOOLEAN:
                out.append(self._v_bool[i] != 0)
            elif dtype == DT_SBYTE:
                out.append(struct.unpack_from("<b", self._v_i8, i)[0])
            elif dtype == DT_INT16:
                out.append(struct.unpack_from("<h", self._v_i16, i * 2)[0])
            elif dtype == DT_INT32:
                out.append(struct.unpack_from("<i", self._v_i32, i * 4)[0])
            elif dtype == DT_INT64:
                out.append(struct.unpack_from("<q", self._v_i64, i * 8)[0])
            elif dtype == DT_BYTE:
                out.append(self._v_u8[i])
            elif dtype == DT_UINT16:
                out.append(struct.unpack_from("<H", self._v_u16, i * 2)[0])
            elif dtype == DT_UINT32:
                out.append(struct.unpack_from("<I", self._v_u32, i * 4)[0])
            elif dtype == DT_UINT64:
                out.append(struct.unpack_from("<Q", self._v_u64, i * 8)[0])
            elif dtype == DT_SINGLE:
                out.append(struct.unpack_from("<f", self._v_single, i * 4)[0])
            elif dtype == DT_DOUBLE:
                out.append(struct.unpack_from("<d", self._v_double, i * 8)[0])
            elif dtype == DT_STRING:
                out.append(self._str1(struct.unpack_from("<i", self._v_string, i * 4)[0]))
            elif dtype == DT_LOCALE:
                out.append(self._str1(struct.unpack_from("<i", self._v_locale, i * 4)[0]))
            elif dtype == DT_ENUMCHOICE:
                out.append(self._str1(struct.unpack_from("<i", self._v_enum, i * 4)[0]))
            elif dtype == DT_GUID:
                out.append(_guid_str(bytes(self._v_guid[i * 16 : i * 16 + 16])))
            elif dtype == DT_CLASS:
                if depth <= 0:
                    out.append({"_truncated_": True})
                else:
                    out.append(self._walk_instance(p_sidx, i, ctx, depth - 1))
            elif dtype == DT_STRONGPOINTER:
                si, ii = struct.unpack_from("<ii", self._v_strong, i * 8)
                if si == -1 and ii == -1:
                    out.append(None)
                elif depth <= 0:
                    out.append({"_truncated_": True})
                else:
                    out.append(self._walk_instance(si, ii, ctx, depth - 1))
            elif dtype == DT_WEAKPOINTER:
                si, ii = struct.unpack_from("<ii", self._v_weak, i * 8)
                if si == -1 and ii == -1:
                    out.append(None)
                else:
                    wid = ctx.weak_ids.get((si, ii))
                    out.append(f"_PointsTo_:ptr:{wid}" if wid is not None else None)
            elif dtype == DT_REFERENCE:
                gid = bytes(self._v_ref[i * 20 + 4 : i * 20 + 20])
                out.append(self._resolve_ref(gid, ctx, depth))
            else:
                raise ValueError(f"unknown array data_type {dtype:#06x}")
        return out

    def _resolve_ref(self, gid: bytes, ctx, depth) -> Any:
        if gid == _EMPTY_GUID:
            return None
        tgt = self._guid_to_record.get(gid)
        if tgt is None:
            return None
        is_main = gid in self._main_record_ids
        tgt_name = tgt.name
        if is_main:
            # cross-record ref to a main record -> stub
            return {
                "_RecordId_": tgt.guid,
                "_RecordName_": tgt_name,
                "_RecordPath_": tgt.filename,
            }
        if tgt.file_off == ctx.file_off:
            # same-file sub-record: inline
            if depth <= 0:
                return {"_RecordId_": tgt.guid, "_RecordName_": tgt_name,
                        "_truncated_": True}
            sub = {"_RecordId_": tgt.guid, "_RecordName_": tgt_name}
            inner = self._walk_instance(tgt.struct_index, tgt.instance_index,
                                        ctx, depth - 1)
            sub.update(inner)
            return sub
        # cross-file sub-record stub
        return {
            "_RecordId_": tgt.guid,
            "_RecordName_": tgt_name,
            "_RecordPath_": tgt.filename,
        }


class _Ctx:
    __slots__ = ("weak_ids", "pointed_to", "file_off")

    def __init__(self, weak_ids, pointed_to, file_off):
        self.weak_ids = weak_ids
        self.pointed_to = pointed_to
        self.file_off = file_off
