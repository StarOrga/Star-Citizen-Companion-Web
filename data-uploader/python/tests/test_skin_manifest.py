"""Tests for the skin build-manifest bridge between the metadata extract and
the follow-on 3D-glb build — the manifest is what makes skins ride along the
normal extract → upload flow instead of a separate, manually-driven pipeline.
"""
from __future__ import annotations

import json
from pathlib import Path

from sc_extract.dataforge_extract import CodexExtractor
from sc_extract.localization import Localizer
from sc_extract.skin_export_app import _refs_from_manifest


def _extractor(tmp_path: Path) -> CodexExtractor:
    # p4k=None → no asset/dimension work; we only exercise manifest writing.
    return CodexExtractor(None, Localizer.empty(), tmp_path,  # type: ignore[arg-type]
                          {"channel": "TEST", "patch": "0", "build": "0"},
                          extract_assets=False)


def test_write_manifest_lists_buildable_ships(tmp_path: Path) -> None:
    ex = _extractor(tmp_path)
    ex._skin_build_refs = [
        {"ship_id": "DRAK_Cutlass_Black", "mfr": "DRAK", "ship": "Cutlass", "series_token": "Cutlass"},
        {"ship_id": "AEGS_Gladius", "mfr": "AEGS", "ship": "Gladius", "series_token": "Gladius"},
    ]
    ex._write_skin_build_manifest()
    data = json.loads((tmp_path / "skins" / "_build_manifest.json").read_text(encoding="utf-8"))
    assert [s["ship_id"] for s in data["ships"]] == ["DRAK_Cutlass_Black", "AEGS_Gladius"]


def test_write_manifest_empty_when_no_buildable_ships(tmp_path: Path) -> None:
    ex = _extractor(tmp_path)
    ex._write_skin_build_manifest()
    data = json.loads((tmp_path / "skins" / "_build_manifest.json").read_text(encoding="utf-8"))
    assert data == {"ships": []}


def test_refs_from_manifest_round_trip(tmp_path: Path) -> None:
    manifest = tmp_path / "_build_manifest.json"
    manifest.write_text(json.dumps({"ships": [
        {"ship_id": "DRAK_Cutlass_Black", "mfr": "DRAK", "ship": "Cutlass", "series_token": "Cutlass"},
        {"ship_id": "MISC_Freelancer", "mfr": "MISC", "ship": "Freelancer"},  # series omitted → defaults to folder
    ]}), encoding="utf-8")
    refs = _refs_from_manifest(manifest)
    assert [(r.ship_id, r.mfr, r.ship, r.series_token) for r in refs] == [
        ("DRAK_Cutlass_Black", "DRAK", "Cutlass", "Cutlass"),
        ("MISC_Freelancer", "MISC", "Freelancer", "Freelancer"),
    ]
