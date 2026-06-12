"""Tests for localization language discovery + table parsing.

Run via: python -m pytest data-uploader/python/tests/
"""

from sc_extract.localization import (
    Localizer,
    discover_language_folders,
    lang_code_for_folder,
    parse_global_ini,
)


class TestLangCodeForFolder:
    def test_known_folders_map_to_stable_codes(self):
        assert lang_code_for_folder("english") == "en"
        assert lang_code_for_folder("german_(germany)") == "de"
        assert lang_code_for_folder("french_(france)") == "fr"
        assert lang_code_for_folder("spanish_(latin_america)") == "es-419"
        assert lang_code_for_folder("chinese_(simplified)") == "zh-Hans"
        assert lang_code_for_folder("korean_(south_korea)") == "ko"

    def test_case_insensitive(self):
        assert lang_code_for_folder("English") == "en"
        assert lang_code_for_folder("GERMAN_(GERMANY)") == "de"

    def test_unknown_folder_degrades_to_slug(self):
        assert lang_code_for_folder("klingon_(quonos)") == "klingon-quonos"
        assert lang_code_for_folder("future_lang") == "future-lang"


class TestDiscoverLanguageFolders:
    NAMES = [
        "Data/Localization/english/global.ini",
        "Data/Localization/german_(germany)/global.ini",
        "Data/Localization/french_(france)/global.ini",
        "Data/Localization/chinese_(simplified)/global.ini",
        "Data/Localization/english/notes.txt",  # not a global.ini → ignored
        "Data/Objects/Spaceships/Ships/AEGS/Gladius/Gladius.cga",
    ]

    def test_discovers_every_language(self):
        found = discover_language_folders(self.NAMES)
        assert set(found) == {"en", "de", "fr", "zh-Hans"}

    def test_english_is_first(self):
        found = discover_language_folders(self.NAMES)
        assert next(iter(found)) == "en"

    def test_preserves_original_entry_casing(self):
        found = discover_language_folders(self.NAMES)
        assert found["en"] == "Data/Localization/english/global.ini"

    def test_duplicate_codes_keep_first_alphabetical_folder(self):
        names = [
            "Data/Localization/german_(germany)/global.ini",
            "Data/Localization/german/global.ini",
        ]
        found = discover_language_folders(names)
        assert list(found) == ["de"]
        assert found["de"] == "Data/Localization/german/global.ini"

    def test_empty_input(self):
        assert discover_language_folders([]) == {}


class TestParseGlobalIni:
    def test_parses_key_values_and_skips_junk(self):
        raw = "a=Alpha\njunk-line\nb=Beta=WithEquals\n\n".encode("utf-8")
        table = parse_global_ini(raw)
        assert table == {"a": "Alpha", "b": "Beta=WithEquals"}

    def test_handles_utf8_bom(self):
        raw = "﻿ship_name=Gladius\n".encode("utf-8")
        assert parse_global_ini(raw) == {"ship_name": "Gladius"}


class TestLocalizer:
    def make(self):
        return Localizer({
            "en": {"ship_name": "Gladius", "only_en": "Original"},
            "de": {"ship_name": "Gladius (DE)"},
            "fr": {"ship_name": "Gladius (FR)"},
        })

    def test_languages_en_first(self):
        assert self.make().languages == ["en", "de", "fr"]

    def test_localized_text_contract_is_two_language(self):
        t = self.make().localized_text("@ship_name")
        assert t == {"de": "Gladius (DE)", "en": "Gladius", "key": "@ship_name"}

    def test_en_original_survives_missing_translation(self):
        t = self.make().localized_text("@only_en")
        assert t["en"] == "Original"
        # unresolved in de → verbatim key (UI filters @-prefixed values)
        assert t["de"] == "@only_en"

    def test_gettext_extra_language(self):
        assert self.make().gettext("@ship_name", "fr") == "Gladius (FR)"
