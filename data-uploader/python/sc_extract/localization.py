"""Localization: parse SC ``global.ini`` tables and resolve @-keys.

``Data/Localization/<language>/global.ini`` is a flat ``key=value`` file
(one entry per line, split on the first ``=``). Resolution mirrors
scdatatools' ``gettext``: try the raw key; if it misses and starts with ``@``,
strip the leading ``@`` and retry; if still missing, return the key verbatim
so untranslated entries are visible rather than blank.

Language folders are DISCOVERED from the archive at runtime
(``discover_language_folders``): the live P4K ships long folder names
(``english``, ``german_(germany)``, ``french_(france)``, …) and the set has
grown patch over patch — a hardcoded map silently drops new languages.
Known folders map to stable short codes via ``FOLDER_LANG_MAP``; unknown
folders degrade to a slug of the folder name so nothing is ever lost.

English is the CANONICAL ORIGINAL: the game's source strings live in
``english/global.ini`` and every other table is a (partial) translation of
it. ``localized_text`` therefore keeps its ``{de, en, key}`` payload contract
(en = original) regardless of how many extra languages were discovered —
the full tables per language are dumped separately by
``CodexExtractor.dump_localization``.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

# our short lang code -> list of P4K folder-name candidates (first match wins).
# Legacy static map — kept for callers/tests that probe a fixed language set;
# the extract pipeline itself uses discover_language_folders() instead.
LANG_FOLDERS = {
    "en": ["english"],
    "de": ["german_(germany)", "german"],
}

# Known live P4K localization folders → stable short language codes.
# Unknown folders fall back to a slug (see lang_code_for_folder).
FOLDER_LANG_MAP = {
    "english": "en",
    "german_(germany)": "de",
    "german": "de",
    "french_(france)": "fr",
    "french": "fr",
    "italian_(italy)": "it",
    "italian": "it",
    "spanish_(spain)": "es",
    "spanish_(latin_america)": "es-419",
    "polish_(poland)": "pl",
    "polish": "pl",
    "portuguese_(brazil)": "pt-BR",
    "chinese_(simplified)": "zh-Hans",
    "chinese_(traditional)": "zh-Hant",
    "japanese_(japan)": "ja",
    "japanese": "ja",
    "korean_(south_korea)": "ko",
    "korean": "ko",
    "russian_(russia)": "ru",
    "russian": "ru",
    "turkish_(turkey)": "tr",
}

_GLOBAL_INI_RE = re.compile(r"^data/localization/([^/]+)/global\.ini$")


def lang_code_for_folder(folder: str) -> str:
    """Short code for a P4K localization folder; slug fallback for unknowns."""
    key = folder.strip().lower()
    if key in FOLDER_LANG_MAP:
        return FOLDER_LANG_MAP[key]
    # "brazilian_(portuguese)" → "brazilian-portuguese" — ugly but lossless.
    return re.sub(r"[^a-z0-9]+", "-", key).strip("-") or key


def discover_language_folders(names: List[str]) -> Dict[str, str]:
    """Scan a P4K name list for every ``Data/Localization/<x>/global.ini``.

    Returns ``{short_code: original_entry_name}``, English first (canonical
    original), the rest sorted by code for deterministic output. On duplicate
    codes (e.g. both ``german`` and ``german_(germany)``) the first
    alphabetical folder wins — they carry the same content in practice.
    """
    found: Dict[str, str] = {}
    for name in sorted(names):
        m = _GLOBAL_INI_RE.match(name.lower())
        if not m:
            continue
        code = lang_code_for_folder(m.group(1))
        if code not in found:
            found[code] = name
    ordered: Dict[str, str] = {}
    if "en" in found:
        ordered["en"] = found.pop("en")
    for code in sorted(found):
        ordered[code] = found[code]
    return ordered


def parse_global_ini(raw: bytes) -> Dict[str, str]:
    """Parse a global.ini blob into a {key: value} dict."""
    table: Dict[str, str] = {}
    text = raw.decode("utf-8-sig", "replace")
    for line in text.splitlines():
        if not line or "=" not in line:
            continue
        key, _, value = line.partition("=")
        table[key.strip()] = value
    return table


class Localizer:
    """Resolves a localization key to {de, en, key}."""

    def __init__(self, tables: Dict[str, Dict[str, str]]) -> None:
        # tables keyed by short code: {"en": {...}, "de": {...}, "fr": {...}, ...}
        self._tables = tables

    @classmethod
    def empty(cls) -> "Localizer":
        return cls({})

    @property
    def languages(self) -> List[str]:
        """Short codes of every loaded language table (en first when present)."""
        codes = list(self._tables.keys())
        if "en" in codes:
            codes.remove("en")
            codes.insert(0, "en")
        return codes

    def _lookup(self, lang: str, key: str) -> Optional[str]:
        table = self._tables.get(lang)
        if not table:
            return None
        if key in table:
            return table[key]
        if key.startswith("@"):
            stripped = key[1:]
            if stripped in table:
                return table[stripped]
        return None

    def gettext(self, key: str, lang: str) -> str:
        """Resolve, falling back to the verbatim key if unresolved."""
        v = self._lookup(lang, key)
        return v if v is not None else key

    def localized_text(self, key: str) -> Dict[str, str]:
        """{de, en, key} — key kept raw so the UI can spot missing strings.

        ``en`` is the original English source string; the payload contract
        stays two-language for compatibility (the full per-language tables
        are dumped separately and land in codex_locale_strings).
        """
        return {
            "de": self.gettext(key, "de"),
            "en": self.gettext(key, "en"),
            "key": key,
        }
