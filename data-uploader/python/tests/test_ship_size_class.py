"""Ship size class S1-S6 (Codex index filter, 2026-11-06): the vehicle
entity's own AttachDef.Size, kept only inside 1-6."""

from __future__ import annotations

from sc_extract.dataforge_extract import CodexExtractor


def test_size_class_from_attach_def() -> None:
    assert CodexExtractor._ship_size_class({"Type": "NOITEM_Vehicle", "Size": 3}) == 3
    assert CodexExtractor._ship_size_class({"Size": "6"}) == 6


def test_size_class_out_of_range_or_missing_is_none() -> None:
    assert CodexExtractor._ship_size_class({"Size": 0}) is None
    assert CodexExtractor._ship_size_class({"Size": 7}) is None
    assert CodexExtractor._ship_size_class({}) is None
    assert CodexExtractor._ship_size_class(None) is None
