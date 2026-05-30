"""Localization: parse SC ``global.ini`` tables and resolve @-keys.

``Data/Localization/<language>/global.ini`` is a flat ``key=value`` file
(one entry per line, split on the first ``=``). Resolution mirrors
scdatatools' ``gettext``: try the raw key; if it misses and starts with ``@``,
strip the leading ``@`` and retry; if still missing, return the key verbatim
so untranslated entries are visible rather than blank.

The live P4K uses long language folder names (``english``,
``german_(germany)``); we map our short codes (``en``/``de``) onto them.
"""

from __future__ import annotations

from typing import Dict, Optional

# our short lang code -> list of P4K folder-name candidates (first match wins)
LANG_FOLDERS = {
    "en": ["english"],
    "de": ["german_(germany)", "german"],
}


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
        # tables keyed by short code: {"en": {...}, "de": {...}}
        self._tables = tables

    @classmethod
    def empty(cls) -> "Localizer":
        return cls({})

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
        """{de, en, key} — key kept raw so the UI can spot missing strings."""
        return {
            "de": self.gettext(key, "de"),
            "en": self.gettext(key, "en"),
            "key": key,
        }
