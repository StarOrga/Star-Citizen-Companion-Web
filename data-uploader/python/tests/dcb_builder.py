"""Minimal DataForge v8 (.dcb) blob builder for CI tests.

Produces a tiny but structurally-valid v8 DataCore so the pure-Python reader
(sc_extract.dataforge) and the projections can be exercised without the 147 GB
game P4K. Mirrors the on-disk layout the reader expects (see dataforge.py).

We build ONE struct ("TestThing") with two attribute properties:
  * Name  : String  (offset into string table 1)
  * Value : Int32
and ONE record of that struct. Enough to prove header parse, section offset
math, instance reading, string-table resolution and record_to_dict.
"""

from __future__ import annotations

import struct
from typing import Dict, List, Tuple

# data type / conversion constants mirrored from the reader
DT_INT32 = 0x0004
DT_STRING = 0x000A
CONV_ATTRIBUTE = 0x00


class _StringTable:
    def __init__(self) -> None:
        self.buf = bytearray(b"\x00")  # offset 0 = empty string
        self.offsets: Dict[str, int] = {"": 0}

    def add(self, s: str) -> int:
        if s in self.offsets:
            return self.offsets[s]
        off = len(self.buf)
        self.buf.extend(s.encode("utf-8") + b"\x00")
        self.offsets[s] = off
        return off


def build_minimal_v8(record_name: str = "TestThing.Sample",
                     value: int = 42,
                     name_field: str = "@test_Name_Sample") -> bytes:
    """Return a valid v8 DCB blob with a single TestThing record."""
    st1 = _StringTable()  # filenames + String/Locale/Enum attribute values
    st2 = _StringTable()  # struct/property/record names

    struct_name_off = st2.add("TestThing")
    prop_name_off = st2.add("Name")
    prop_value_off = st2.add("Value")
    rec_name_off = st2.add(record_name)
    file_name_off = st1.add("libs/foundry/records/test/sample.xml")
    name_value_off = st1.add(name_field)

    # ── StructDefinition: name_off(u32) parent(i32) attr_c(u16) first_attr(u16) ssize(u32)
    # Two attribute props: String(4 bytes) + Int32(4 bytes) => struct_size 8
    struct_defs = [(struct_name_off, -1, 2, 0, 8)]
    # ── PropertyDefinition: name_off(u32) struct_index(u16) data_type(u16) conv(u16) pad(u16)
    prop_defs = [
        (prop_name_off, 0, DT_STRING, CONV_ATTRIBUTE),
        (prop_value_off, 0, DT_INT32, CONV_ATTRIBUTE),
    ]
    # ── DataMapping: struct_count(u32) struct_index(i32) — 1 instance of struct 0
    data_mappings = [(1, 0)]
    # ── Record v8: name_off(u32) file_off(i32) tag_off(i32) struct_index(i32)
    #              guid(16) inst_idx(u16) struct_size(u16)
    guid = bytes(range(16))
    records = [(rec_name_off, file_name_off, -1, 0, guid, 0, 8)]

    # value arrays: none of the scalar pools used (String/Int32 are inline attrs)
    # instance data: one TestThing = [String:int32 offset][Int32 value]
    instance = struct.pack("<i", name_value_off) + struct.pack("<i", value)

    # ── assemble header counts ────────────────────────────────────────────────
    text1 = bytes(st1.buf)
    text2 = bytes(st2.buf)

    header = struct.pack(
        "<II4H24I II",
        0,            # magic
        8,            # version
        0, 0, 0, 0,   # unknown1..4
        len(struct_defs),    # struct_definition_count
        len(prop_defs),      # property_definition_count
        0,                   # enum_definition_count
        len(data_mappings),  # data_mapping_count
        len(records),        # record_definition_count
        0,                   # boolean_count
        0, 0, 0, 0,          # int8/16/32/64
        0, 0, 0, 0,          # uint8/16/32/64
        0,                   # single
        0,                   # double
        0,                   # guid
        0,                   # string
        0,                   # locale
        0,                   # enum
        0,                   # strong
        0,                   # weak
        0,                   # reference
        0,                   # enum_option
        len(text1),          # text_length
        len(text2),          # text_length2
    )
    assert len(header) == 120, len(header)

    out = bytearray(header)
    for (no, pa, ac, fa, ss) in struct_defs:
        out += struct.pack("<IiHHI", no, pa, ac, fa, ss)
    for (no, si, dt, cv) in prop_defs:
        out += struct.pack("<IHHHH", no, si, dt, cv, 0)
    # no enum defs
    for (sc, si) in data_mappings:
        out += struct.pack("<Ii", sc, si)
    for (no, fo, to, si, g, ii, ss) in records:
        out += struct.pack("<Iii", no, fo, to)  # name, file, tag
        out += struct.pack("<I", si)            # struct_index
        out += g                                # guid (16)
        out += struct.pack("<HH", ii, ss)       # instance_index, struct_size
    # no value arrays
    out += text1
    out += text2
    out += instance
    return bytes(out)
