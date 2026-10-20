"""Ship deck list on the codex payload (#796).

Fixtures are trimmed copies of LIVE 4.10 InteriorMapSectionDefinition records
(probe 2026-10-20): a section is only `name` (loc key) + `restrictViewBounds`,
filed under `ui/map/sectiondefinitions/ship_setup/<mfr>/<family>/`.
"""

from __future__ import annotations

from sc_extract.dataforge_extract import CodexExtractor
from sc_extract.ship_decks import build_deck_index, project_decks, sections_for_class

ROOT = "libs/foundry/records/ui/map/sectiondefinitions"
LOC_EN = {
    "@vehicle_deck_lower": "Lower Deck",
    "@vehicle_deck_main": "Main Deck",
    "@vehicle_deck_upper": "Upper Deck",
    "@vehicle_deck_01": "Deck 01",
    "@vehicle_deck_02": "Deck 02",
    "@vehicle_deck_03": "Deck 03",
    "@vehicle_deck_04": "Deck 04",
}
LOC_DE = {"@vehicle_deck_lower": "Unteres Deck", "@vehicle_deck_01": "Deck 01"}


def _entry(path: str, name: str, loc: str = "@LOC_EMPTY"):
    return (f"InteriorMapSectionDefinition.{name}", f"{ROOT}/{path}", loc)


ENTRIES = [
    # deliberately out of order — the projection sorts
    _entry("ship_setup/anvl/carrack/carrack_deck_3.xml", "Carrack_Deck_3"),
    _entry("ship_setup/anvl/carrack/carrack_deck_1.xml", "Carrack_Deck_1"),
    _entry("ship_setup/anvl/carrack/carrack_deck_4.xml", "Carrack_Deck_4"),
    _entry("ship_setup/anvl/carrack/carrack_deck_2.xml", "Carrack_Deck_2"),
    _entry("ship_setup/aegs/hammerhead/hammerhead_upper_deck.xml", "Hammerhead_Upper_Deck"),
    _entry("ship_setup/aegs/hammerhead/hammerhead_lower_deck.xml", "Hammerhead_Lower_Deck"),
    _entry("ship_setup/aegs/hammerhead/hammerhead_main_deck.xml", "Hammerhead_Main_Deck"),
    # authored keys, one of them wrong (LIVE: the upper deck says "Lower Deck")
    _entry("ship_setup/aegs/redeemer/redeemer_lower_deck.xml", "Redeemer_Lower_Deck", "@vehicle_deck_lower"),
    _entry("ship_setup/aegs/redeemer/redeemer_upper_deck.xml", "Redeemer_Upper_Deck", "@vehicle_deck_lower"),
    # LIVE: both Valkyrie decks are labelled "Lower Deck"
    _entry("ship_setup/anvl/valkyrie/valkyrie_deck_01.xml", "Valkyrie_Deck_01", "@vehicle_deck_lower"),
    _entry("ship_setup/anvl/valkyrie/valkyrie_deck_02.xml", "Valkyrie_Deck_02", "@vehicle_deck_lower"),
    _entry("ship_setup/orig/890_jump/890_deck_1.xml", "890_Deck_1"),
    _entry("ship_setup/crus/starlifter/starlifter_deck_1.xml", "Starlifter_Deck_1"),
    _entry("ship_setup/rsi/zeus/rsi_zeus_deck.xml", "RSI_Zeus_Deck"),
    _entry("ship_setup/rsi/constellation_phoenix/x.xml", "Constellation_Phoenix_Main_Deck"),
    _entry("ship_setup/rsi/constellation/x.xml", "Constellation_Deck_1"),
    # not a ship section — must never map
    _entry("stations/grimhex/grimhex_main.xml", "GrimHex_Main"),
]


def _loc(key):
    en, de = LOC_EN.get(key), LOC_DE.get(key)
    return {"en": en, "de": de} if (en or de) else None


def _decks(class_name):
    return project_decks(sections_for_class(build_deck_index(ENTRIES), class_name), _loc)


def test_numbered_decks_sorted_and_named():
    decks = _decks("ANVL_Carrack")
    assert [d["key"] for d in decks] == [
        "Carrack_Deck_1", "Carrack_Deck_2", "Carrack_Deck_3", "Carrack_Deck_4"]
    assert [d["order"] for d in decks] == [0, 1, 2, 3]
    assert decks[0]["name"] == {"en": "Deck 01", "de": "Deck 01"}
    assert decks[3]["name"] == {"en": "Deck 04", "de": None}


def test_positional_decks_bottom_first():
    decks = _decks("AEGS_Hammerhead")
    assert [d["key"] for d in decks] == [
        "Hammerhead_Lower_Deck", "Hammerhead_Main_Deck", "Hammerhead_Upper_Deck"]
    assert [d["name"]["en"] for d in decks] == ["Lower Deck", "Main Deck", "Upper Deck"]


def test_wrong_or_duplicate_authored_names_are_not_trusted():
    assert [d["name"]["en"] for d in _decks("AEGS_Redeemer")] == ["Lower Deck", "Upper Deck"]
    assert [d["name"]["en"] for d in _decks("ANVL_Valkyrie")] == ["Deck 01", "Deck 02"]


def test_no_name_source_gives_null():
    assert _decks("RSI_Zeus_CL") == [{"key": "RSI_Zeus_Deck", "name": None, "order": 0}]


def test_variant_rule():
    # variants share the base hull's deck set
    assert _decks("ANVL_Carrack_Expedition") == _decks("ANVL_Carrack")
    # families without a base class (Starlifter, Zeus) map by prefix
    assert _decks("CRUS_Starlifter_C2")[0]["key"] == "Starlifter_Deck_1"
    # the folder drops the underscore the class name does not have
    assert _decks("ORIG_890Jump")[0]["key"] == "890_Deck_1"
    # longest family wins
    assert _decks("RSI_Constellation_Phoenix_Emerald")[0]["key"] == "Constellation_Phoenix_Main_Deck"
    assert _decks("RSI_Constellation_Andromeda")[0]["key"] == "Constellation_Deck_1"
    # prefix only at an underscore boundary, manufacturer must match
    assert _decks("ANVL_Carracks") is None
    assert _decks("DRAK_Carrack") is None


def test_absent_when_none():
    assert _decks("AEGS_Gladius") is None
    assert _decks("") is None
    assert project_decks([], _loc) is None


class _Rec:
    def __init__(self, name, filename, loc):
        self.name, self.filename, self.loc = name, filename, loc


class _FakeDF:
    def __init__(self, entries):
        self.recs = [_Rec(*e) for e in entries]

    def records_by_type_name(self, t):
        return self.recs if t == "InteriorMapSectionDefinition" else []

    def record_to_dict(self, rec, max_depth=2):
        return {"_RecordValue_": {"_Type_": "InteriorMapSectionDefinition",
                                  "name": rec.loc, "restrictViewBounds": False}}


class _FakeLoc:
    def localized_text(self, key):  # gettext falls back to the verbatim key
        return {"en": LOC_EN.get(key, key), "de": LOC_DE.get(key, key), "key": key}


def _extractor():
    ex = CodexExtractor.__new__(CodexExtractor)
    ex.df = _FakeDF(ENTRIES)
    ex.loc = _FakeLoc()
    ex.on_log = lambda *a: None
    return ex


def test_extractor_payload_shape():
    ex = _extractor()
    decks = ex._ship_decks("AEGS_Redeemer")
    assert decks == [
        {"key": "Redeemer_Lower_Deck", "name": {"en": "Lower Deck", "de": "Unteres Deck"}, "order": 0},
        {"key": "Redeemer_Upper_Deck", "name": {"en": "Upper Deck", "de": None}, "order": 1},
    ]
    assert ex._ship_decks("AEGS_Gladius") is None
