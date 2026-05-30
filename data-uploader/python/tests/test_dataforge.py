"""Tests for the pure-Python DataForge v8 reader + Codex projections.

These run against a synthetic in-memory DCB blob (tests/dcb_builder.py) so CI
never needs the 147 GB game P4K. A real-data run is a local-dev concern
(see scripts/discover_schema.py + README).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from sc_extract.dataforge import DataForge
from sc_extract.localization import Localizer, parse_global_ini
from sc_extract.dataforge_extract import CodexExtractor, _strip_type_prefix

from dcb_builder import build_minimal_v8


@pytest.fixture(scope="module")
def df() -> DataForge:
    return DataForge(build_minimal_v8(record_name="TestThing.Sample", value=42,
                                      name_field="@test_Name_Sample"))


def test_parses_v8_header(df: DataForge) -> None:
    assert df.version == 8
    assert len(df.records) == 1
    assert "TestThing" in df.record_types


def test_record_fields_resolved(df: DataForge) -> None:
    rec = df.records[0]
    assert rec.name == "TestThing.Sample"
    assert rec.type == "TestThing"
    assert rec.filename == "libs/foundry/records/test/sample.xml"
    d = df.record_to_dict(rec)
    rv = d["_RecordValue_"]
    assert rv["_Type_"] == "TestThing"
    assert rv["Name"] == "@test_Name_Sample"   # String attr -> table1
    assert rv["Value"] == 42                    # Int32 attr (instance data)


def test_records_by_type_name(df: DataForge) -> None:
    assert len(df.records_by_type_name("TestThing")) == 1
    assert df.records_by_type_name("Nonexistent") == []


def test_record_by_id(df: DataForge) -> None:
    rec = df.records[0]
    assert df.record_by_id(rec.guid) is rec


def test_strip_type_prefix() -> None:
    assert _strip_type_prefix("EntityClassDefinition.AEGS_Gladius") == "AEGS_Gladius"
    assert _strip_type_prefix("NoPrefix") == "NoPrefix"


def test_localizer_resolution() -> None:
    ini = b"@test_Name_Sample=Sample Thing\nplain_key=Plain\n"
    loc = Localizer({"en": parse_global_ini(ini), "de": parse_global_ini(ini)})
    lt = loc.localized_text("@test_Name_Sample")
    assert lt == {"de": "Sample Thing", "en": "Sample Thing", "key": "@test_Name_Sample"}
    # unresolved key returns verbatim
    assert loc.localized_text("@missing")["en"] == "@missing"


def test_localizer_at_strip_fallback() -> None:
    # value stored WITHOUT the leading @ should still resolve a @-prefixed key
    loc = Localizer({"en": parse_global_ini(b"test_Name=Resolved\n")})
    assert loc.gettext("@test_Name", "en") == "Resolved"


def test_generic_dump_writes_every_record(df: DataForge, tmp_path: Path) -> None:
    ex = CodexExtractor(df, Localizer.empty(), tmp_path,
                        {"channel": "TEST", "patch": "0", "build": "0"})
    ex.dump_all_records()
    index = json.loads((tmp_path / "records" / "_index.json").read_text())
    assert index["total"] == 1
    assert index["per_type"]["TestThing"] == 1
    # the per-record JSON exists and is fully resolved
    files = list((tmp_path / "records" / "TestThing").glob("*.json"))
    assert len(files) == 1
    blob = json.loads(files[0].read_text())
    assert blob["_RecordValue_"]["Value"] == 42
