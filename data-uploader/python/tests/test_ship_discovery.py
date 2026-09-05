"""Unit tests for the ship-agnostic skin discovery heuristics (no real P4K).

A tiny in-memory fake P4K exercises the variant filter, hull resolution, strict
material matching and localization name lookup — the parts most likely to
silently mis-bind paints across ship variants.
"""
from __future__ import annotations

import io

import pytest

from sc_extract.ship_discovery import ShipDiscovery, ShipRef, ref_from_hull


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


# ── generic derivation + whole-catalog fast path (metadata-extract fold-in) ──

def test_ref_from_hull_derives_mfr_and_folder():
    ref = ref_from_hull(
        "DRAK_Cutlass_Black",
        "Data/Objects/Spaceships/Ships/DRAK/Cutlass/DRAK_Cutlass_Black.cga",
    )
    assert ref is not None
    assert (ref.mfr, ref.ship, ref.series_token) == ("DRAK", "Cutlass", "Cutlass")
    assert ref.ship_id == "DRAK_Cutlass_Black"


def test_ref_from_hull_returns_none_off_ships_root():
    # ground vehicles / other meshes are not under the ships root
    assert ref_from_hull("X", "Data/Objects/GroundVehicles/Foo/bar.cga") is None
    assert ref_from_hull("X", "") is None


def test_catalog_matches_discover_with_index():
    d = make_disco()
    d.build_index()
    cat = d.catalog(REF, hull_cga=f"{CUT}/DRAK_Cutlass_Black.cga")
    ids = {c["id"] for c in cat}
    # standard base finish + coalfire store paint, steel filtered out
    assert "standard" in ids
    assert any("coalfire" in i for i in ids)
    assert not any("steel" in i for i in ids)
    # coalfire resolves its verified store name via localization
    coalfire = next(c for c in cat if "coalfire" in c["id"])
    assert coalfire["name_verified"] is True
    assert coalfire["name"] == "Cutlass Coalfire Livery"


def test_catalog_does_not_promise_a_build_for_a_hull_without_materials():
    """#512: the build manifest gates on `has_material` alone.

    It used to read `std_mtl or hull_cga` for the factory finish, which is true
    for anything that resolved a hull at all — so wrecks, salvageable debris and
    other non-liveried entities entered the manifest and exported nothing. A
    whole-catalog run admitted 309 ships and produced glbs for 21.
    """
    debris_root = "Data/Objects/Spaceships/Ships/DRAK/Wreck"
    d = ShipDiscovery(FakeP4K([
        FakeInfo("Data/Localization/english/global.ini", data=LOC.encode("utf-8")),
        # a hull, and nothing else: no .mtl anywhere under this ship folder
        FakeInfo(f"{debris_root}/DRAK_Cutlass_Wreck.cga", size=8_000_000),
    ]))
    d.build_index()
    ref = ref_from_hull("DRAK_Cutlass_Wreck", f"{debris_root}/DRAK_Cutlass_Wreck.cga")
    assert ref is not None
    cat = d.catalog(ref, hull_cga=f"{debris_root}/DRAK_Cutlass_Wreck.cga")
    # The factory finish is still LISTED — the ship exists — but nothing in the
    # catalog claims a material, so the manifest gate rejects the ref.
    assert any(c["id"] == "standard" for c in cat)
    assert not any(c["has_material"] for c in cat)


def test_catalog_still_admits_a_ship_that_has_materials():
    """The tightened gate must not drop the ships that actually build."""
    d = make_disco()
    d.build_index()
    cat = d.catalog(REF, hull_cga=f"{CUT}/DRAK_Cutlass_Black.cga")
    assert any(c["has_material"] for c in cat)
    standard = next(c for c in cat if c["id"] == "standard")
    assert standard["has_material"] is True


def test_base_mtl_prefers_the_exact_ship_id_match():
    d = make_disco()
    mtls = d._ship_mtls(REF)
    assert d.find_base_mtl(REF, mtls, f"{CUT}/DRAK_Cutlass_Black.cga") == \
        f"{CUT}/Cutlass_Black/DRAK_Cutlass_Black.mtl"


def test_base_mtl_falls_back_to_the_hull_mesh_stem():
    """A ship whose base material is named after the MESH, not the entity id.

    Without a fallback such a ship gets no `standard` livery and drops out of a
    catalog-wide build entirely — the "only the Cutlass has liveries" symptom.
    """
    base = "Data/Objects/Spaceships/Ships/AEGS/Gladius"
    infos = [
        FakeInfo(f"{base}/AEGS_Gladius_Mesh.cga", size=9_000_000),
        FakeInfo(f"{base}/AEGS_Gladius_Mesh.mtl"),
        FakeInfo(f"{base}/AEGS_Gladius_Mesh_pirate.mtl"),
    ]
    d = ShipDiscovery(FakeP4K(infos))
    ref = ShipRef("AEGS_Gladius", "AEGS", "Gladius", "Gladius")
    spec = d.discover(ref)
    assert spec.hull_cga == f"{base}/AEGS_Gladius_Mesh.cga"
    std = next(p for p in spec.paints if p.id == "standard")
    assert std.mtl == f"{base}/AEGS_Gladius_Mesh.mtl"
    assert std.source == "factory"


def test_base_mtl_falls_back_to_the_shortest_candidate():
    """No id match and no mesh-stem match: the base name is always a prefix of
    its livery siblings, so the shortest stem is the factory finish."""
    base = "Data/Objects/Spaceships/Ships/RSI/Aurora"
    infos = [
        FakeInfo(f"{base}/aurora_body_camo_digi.mtl"),
        FakeInfo(f"{base}/aurora_body.mtl"),
    ]
    d = ShipDiscovery(FakeP4K(infos))
    ref = ShipRef("RSI_Aurora_MR", "RSI", "Aurora", "Aurora")
    assert d.find_base_mtl(ref, d._ship_mtls(ref)) == f"{base}/aurora_body.mtl"


def test_base_mtl_is_none_when_the_ship_has_no_materials():
    d = ShipDiscovery(FakeP4K([]))
    ref = ShipRef("X_Y", "X", "Y", "Y")
    assert d.find_base_mtl(ref, []) is None


def test_build_index_matches_full_scan_icons_and_mtls():
    scan = make_disco()
    idx = make_disco()
    idx.build_index()
    assert idx.find_paint_icons(REF) == scan.find_paint_icons(REF)
    assert idx._ship_mtls(REF) == scan._ship_mtls(REF)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
