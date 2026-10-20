"""Ordered deck list per ship from ``InteriorMapSectionDefinition`` records (#796).

VERIFIED against LIVE 4.10 (probe 2026-10-20): 221 InteriorMapSectionDefinition
records, 64 of them under
``libs/foundry/records/ui/map/sectiondefinitions/ship_setup/<mfr>/<family>/``
across 26 hull families. A record carries nothing but a ``name`` loc key and
``restrictViewBounds`` — no ship reference and no deck order. So:

* **Ship mapping** comes from the path. ``<mfr>`` must equal the class name's
  manufacturer prefix; ``<family>`` (non-alphanumerics dropped, case-folded)
  must equal the class name's remainder (exact match: ``anvl/carrack`` →
  ``ANVL_Carrack``, ``orig/890_jump`` → ``ORIG_890Jump``) or a prefix of it at
  an ``_`` boundary (variant: ``ANVL_Carrack_Expedition``, and the families
  that have no base class at all — ``crus/starlifter`` → ``CRUS_Starlifter_C2``,
  ``rsi/zeus`` → ``RSI_Zeus_CL``). CIG files one deck set per hull family and
  the variants share the hull, so the prefix rule is what the data intends.
  The longest matching family wins (``rsi/constellation_phoenix`` would beat a
  hypothetical ``rsi/constellation`` for ``RSI_Constellation_Phoenix_Emerald``).
* **Order** comes from the record name, because nothing else carries one:
  ``Lower`` < ``Main`` < ``Upper`` (bottom first) for positional names, else
  the deck number (``Carrack_Deck_1`` … ``_4`` — CIG's own numbering; the data
  does not say whether deck 1 is the lowest), else the name. 0-based.
* **Name**: 49 of the 64 records carry ``@LOC_EMPTY``, and two authored keys
  are wrong (``Redeemer_Upper_Deck`` and both Valkyrie decks say
  ``@vehicle_deck_lower``). The authored key is used unless it is empty,
  contradicts the record name's own position, or labels two decks of the same
  ship alike; otherwise the game's own ``@vehicle_deck_<lower|main|upper>`` /
  ``@vehicle_deck_0<N>`` key is derived from the record name ("Lower Deck",
  "Deck 01"); otherwise ``None``.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

SHIP_SETUP = "/ship_setup/"
_EMPTY_KEYS = {"", "@LOC_EMPTY", "@LOC_PLACEHOLDER"}
_POSITIONS = ("lower", "main", "upper")
_POSITION_KEY = re.compile(r"^@vehicle_deck_(lower|main|upper)$", re.I)

# (mfr, compact family) -> raw sections {key, locKey}
DeckIndex = Dict[Tuple[str, str], List[Dict[str, Optional[str]]]]
Localize = Callable[[str], Optional[Dict[str, Optional[str]]]]


def _compact(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _tokens(section_key: str) -> List[str]:
    return section_key.lower().split("_")


def _position(section_key: str) -> Optional[str]:
    toks = _tokens(section_key)
    for p in _POSITIONS:
        if p in toks:
            return p
    return None


def _number(section_key: str) -> Optional[int]:
    toks = _tokens(section_key)
    for i, t in enumerate(toks[:-1]):
        if t == "deck" and toks[i + 1].isdigit():
            return int(toks[i + 1])
    return None


def _sort_key(section_key: str) -> Tuple[int, int, str]:
    pos = _position(section_key)
    if pos is not None:
        return (0, _POSITIONS.index(pos), section_key.lower())
    num = _number(section_key)
    if num is not None:
        return (1, num, section_key.lower())
    return (2, 0, section_key.lower())


def _derived_key(section_key: str) -> Optional[str]:
    pos = _position(section_key)
    if pos is not None:
        return f"@vehicle_deck_{pos}"
    num = _number(section_key)
    if num is not None and 1 <= num <= 9:
        return f"@vehicle_deck_0{num}"
    return None


def build_deck_index(entries: Iterable[Tuple[str, str, Optional[str]]]) -> DeckIndex:
    """``entries`` = (record name, record filename, ``name`` loc key)."""
    index: DeckIndex = {}
    for rec_name, filename, loc_key in entries:
        path = (filename or "").replace("\\", "/").lower()
        if SHIP_SETUP not in path:
            continue
        parts = path.split(SHIP_SETUP, 1)[1].split("/")
        if len(parts) < 3:  # <mfr>/<family>/<file>.xml
            continue
        key = rec_name.split(".", 1)[-1]
        index.setdefault((parts[0], _compact(parts[1])), []).append(
            {"key": key, "locKey": loc_key})
    return index


def sections_for_class(index: DeckIndex, class_name: str) -> Optional[List[Dict[str, Optional[str]]]]:
    """Deck sections of the hull family a ship class belongs to, or None."""
    if not class_name or "_" not in class_name:
        return None
    mfr, rest = class_name.split("_", 1)
    toks = rest.split("_")
    for k in range(len(toks), 0, -1):  # exact first, then longest prefix
        hit = index.get((mfr.lower(), _compact("_".join(toks[:k]))))
        if hit:
            return hit
    return None


def project_decks(sections: Optional[List[Dict[str, Optional[str]]]],
                  localize: Localize) -> Optional[List[Dict[str, Any]]]:
    """Ordered ``[{key, name, order}]``; None when there are no sections."""
    if not sections:
        return None
    authored = Counter(s["locKey"].lower() for s in sections
                       if s.get("locKey") and s["locKey"] not in _EMPTY_KEYS)
    out = []
    for order, s in enumerate(sorted(sections, key=lambda s: _sort_key(s["key"]))):
        key = s["key"]
        loc = s.get("locKey")
        use = None
        if loc and loc not in _EMPTY_KEYS and authored[loc.lower()] == 1:
            m = _POSITION_KEY.match(loc)
            pos = _position(key)
            if not (m and pos and m.group(1).lower() != pos):
                use = loc
        if use is None:
            use = _derived_key(key)
        out.append({"key": key, "name": localize(use) if use else None, "order": order})
    return out
