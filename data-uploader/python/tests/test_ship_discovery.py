"""Unit tests for the ship-agnostic skin discovery heuristics (no real P4K).

A tiny in-memory fake P4K exercises the variant filter, hull resolution, strict
material matching and localization name lookup — the parts most likely to
silently mis-bind paints across ship variants.
"""
from __future__ import annotations

import io

import pytest

from sc_extract.ship_discovery import ShipDiscovery, ShipRef


class FakeInfo:
    def __init__(self, filename: str, size: int = 1000, data: bytes = b"") -> None:
        self.filename = filename
        self.file_size = size
        self._data = data


class FakeStream:
    def __init__(self, data: bytes) -> None:
        self._d = data

    def read(self) -> bytes:
        return self._d


class FakeP4K:
    def __init__(self, infos):
        self._infos = infos

    def infolist(self):
        return self._infos

    def open(self, info):
        return FakeStream(info._data)


CUT = "Data/Objects/Spaceships/Ships/DRAK/Cutlass"
ICONS = "Data/UI/SharedAssets/PaintColorLogos"
LOC = (
    "item_NameCutlass_Paint_SkullandCrossbones_Black_Red=Cutlass Skull and Crossbones Livery\n"
    "item_NameCutlass_Paint_Fleetweek_2021_Red_Black=Cutlass Coalfire Livery\n"
    "item_DescCutlass_Paint_SkullandCrossbones_Black_Red=Arr.\n"
)


def make_disco():
    infos = [
        FakeInfo("Data/Localization/english/global.ini", data=LOC.encode("utf-8")),
        # hull meshes (variant-specific whole-ship cga)
        FakeInfo(f"{CUT}/DRAK_Cutlass_Black.cga", size=10_000_000),
        FakeInfo(f"{CUT}/DRAK_Cutlass_Red.cga", size=16_000_000),
        FakeInfo(f"{CUT}/DRAK_Cutlass_Black_cinematic.cga", size=3_000_000),
        # black paint materials
        FakeInfo(f"{CUT}/Cutlass_Black/DRAK_Cutlass_Black.mtl"),
        FakeInfo(f"{CUT}/Cutlass_Black/DRAK_Cutlass_Black_pirate.mtl"),
        # a steel material that must NOT bind to the black ship
        FakeInfo(f"{CUT}/Cutlass_Steel/DRAK_Cutlass_Steel_Saurian_DarkGreen.mtl"),
        # icons: black-specific + a steel one (must be filtered out for black)
        FakeInfo(f"{ICONS}/Paint_Cutlass_Black_Coalfire_Black_Red_Icon.dds"),
        FakeInfo(f"{ICONS}/Paint_Cutlass_Steel_Saurian_DarkGreen_Icon.dds"),
        FakeInfo(f"{ICONS}/Paint_Cutlass_Xeno_Threat_Icon.dds"),  # series-generic event
    ]
    return ShipDiscovery(FakeP4K(infos))


REF = ShipRef("DRAK_Cutlass_Black", "DRAK", "Cutlass", "Cutlass")


def test_variant_of_detects_ship_variant():
    d = make_disco()
    assert d._variant_of("DRAK_Cutlass_Black") == "black"
    assert d._variant_of("AEGS_Gladius") is None


def test_find_hull_prefers_exact_ship_id_cga():
    d = make_disco()
    hull = d.find_hull(REF)
    assert hull.endswith("DRAK_Cutlass_Black.cga")
    assert "cinematic" not in hull.lower()


def test_paint_icons_filtered_to_ship_variant():
    d = make_disco()
    icons = d.find_paint_icons(REF)
    toks = set(icons)
    # black-specific kept, steel dropped, series-generic kept
    assert any("coalfire" in t for t in toks)
    assert not any("steel" in t for t in toks)
    assert any("xeno_threat" in t for t in toks)


def test_match_mtl_does_not_bind_foreign_variant():
    d = make_disco()
    mtls = d._ship_mtls(REF)
    # the steel saurian material must never be picked for a black-ship icon
    picked = d._match_mtl("saurian_darkgreen", mtls, REF)
    assert picked is None or "steel" not in picked.lower()


def test_loc_lookup_matches_display_name_not_key():
    d = make_disco()
    # icon token 'coalfire' must resolve to the Coalfire display name even though
    # its localization KEY is 'Fleetweek_2021_Red_Black'
    name, _desc = d._loc_lookup("Cutlass", "black_coalfire_black_red")
    assert name == "Cutlass Coalfire Livery"


def test_discover_builds_spec_with_hull_and_paints():
    d = make_disco()
    spec = d.discover(REF)
    assert spec.hull_cga.endswith("DRAK_Cutlass_Black.cga")
    assert spec.ship_id == "DRAK_Cutlass_Black"
    # standard paint present, and no steel paint leaked in
    ids = {p.id for p in spec.paints}
    assert "standard" in ids
    assert not any("steel" in p.mtl.lower() for p in spec.paints if p.mtl)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
