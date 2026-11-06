"""Mission catalog projection (MissionBrokerEntry -> missions/<class>.json).

Field names are VERIFIED against LIVE 4.x DataCore (probe 2026-11-03, 2584
MissionBrokerEntry records, 1978 without ``notForRelease``):

  title / description / missionGiver   @-loc keys (often ~mission(...) templates)
  type                                 ref -> MissionType.LocalisedTypeName
  missionGiverRecord                   ref -> MissionGiver (optional)
  locationMissionAvailable             ref -> StarMapObject.name (optional)
  localityAvailable                    ref -> MissionLocality.availableLocations[0]
  missionReward.reward / currencyType  base payout (0 = none / dynamic)
  lawfulMission, missionBuyInAmount, canBeShared, onceOnly

CIG fills ``~mission(Token)`` placeholders at runtime from the offering
contractor; we do NOT invent their values. ``titleClean`` drops the tokens so a
search over "Cargo Haul" still finds the hauling contracts, and is null when
nothing readable is left (the UI then names the mission by its type).
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Optional

_TOKEN_RE = re.compile(r"~mission\([^)]*\)")
_UNSET = ("<= UNINITIALIZED =>", "<= PLACEHOLDER =>")
# Folders that never reach a player's contract list.
_SKIP_DIRS = ("/testmissions", "/reptests")


def clean_title(text: Optional[str]) -> Optional[str]:
    """Strip ~mission(...) tokens and dangling separators; None when empty."""
    if not text or any(u in text for u in _UNSET):
        return None
    # "~mission(ReputationRank) Rank - ~mission(CargoGradeToken) Cargo Haul":
    # a " - " segment that STARTS with a token only qualifies a runtime value
    # ("<rank> Rank"); leading ones are dropped, the last segment always stays.
    segs = [g for g in re.split(r"\s+[-–—]\s+", text) if g.strip()]
    while len(segs) > 1 and segs[0].lstrip().startswith("~mission("):
        segs.pop(0)
    # CIG writes line breaks as a literal backslash-n; a title has no use for them.
    s = _TOKEN_RE.sub(" ", " - ".join(segs)).replace("\\n", " ")
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^[\s\-–—:|]+|[\s\-–—:|]+$", "", s).strip()
    return s if re.search(r"[A-Za-zÀ-ÿ]{3,}", s) else None


def _strip_type_prefix(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    return name.split(".", 1)[1] if "." in name else name


def _ref(node: Any) -> Optional[Dict[str, Any]]:
    return node if isinstance(node, dict) and node.get("_RecordId_") else None


def _category(filename: str) -> Optional[str]:
    """Folder below missionbroker/pu_missions (cargo, delivery, pu_mercenary/…)."""
    p = (filename or "").replace("\\", "/").lower()
    marker = "missionbroker/"
    if marker not in p:
        return None
    parts = p.split(marker, 1)[1].split("/")[:-1]
    if parts and parts[0] == "pu_missions":
        parts = parts[1:]
    return "/".join(parts) or None


def readable_text(localized: Callable[[Optional[str]], Optional[Dict[str, str]]],
                  key: Any) -> Optional[Dict[str, str]]:
    """The localized text of an @-key, or None when no language has readable text."""
    if not isinstance(key, str) or not key.startswith("@"):
        return None
    val = localized(key)
    if not val:
        return None
    # Localizer.gettext falls back to the verbatim @-key: that is no text.
    val = {k: ("" if k != "key" and (v or "").startswith("@") else v) for k, v in val.items()}
    if not (val.get("en") or val.get("de")):
        return None
    if any(u in (val.get("en") or "") for u in _UNSET):
        return None
    return val


def extract_missions(df, localized: Callable[[Optional[str]], Optional[Dict[str, str]]],
                     out_dir: Path, source: Dict[str, str],
                     on_log: Callable[[str, str], None] = lambda lvl, m: None,
                     contracts: Iterable[Dict[str, Any]] = ()) -> int:
    """Write one JSON per released MissionBrokerEntry; returns the count.

    ``contracts``: mission objects of the career/list contracts that award a
    blueprint (blueprint_sources.py). Same shape, so the same ingest and page.
    """
    d = out_dir / "missions"
    d.mkdir(parents=True, exist_ok=True)
    cache: Dict[str, Any] = {}

    def record_value(ref: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if not ref:
            return {}
        gid = ref["_RecordId_"]
        if gid not in cache:
            rec = df.record_by_id(gid)
            cache[gid] = (df.record_to_dict(rec, max_depth=1).get("_RecordValue_", {})
                          if rec else {})
        return cache[gid] or {}

    def loc_text(key: Any) -> Optional[Dict[str, str]]:
        return readable_text(localized, key)

    n = 0
    skipped = 0
    for r in df.records_by_type_name("MissionBrokerEntry"):
        fn = (r.filename or "").replace("\\", "/").lower()
        try:
            rv = df.record_to_dict(r, max_depth=1).get("_RecordValue_", {})
        except Exception as exc:  # noqa: BLE001
            on_log("warn", f"missions: {r.name}: {exc}")
            skipped += 1
            continue
        if rv.get("notForRelease") or any(s in fn for s in _SKIP_DIRS):
            skipped += 1
            continue

        title = loc_text(rv.get("title"))
        type_ref = _ref(rv.get("type"))
        type_name = loc_text(record_value(type_ref).get("LocalisedTypeName")) if type_ref else None

        loc_ref = _ref(rv.get("locationMissionAvailable"))
        locality_ref = _ref(rv.get("localityAvailable"))
        if not loc_ref and locality_ref:
            avail = record_value(locality_ref).get("availableLocations") or []
            loc_ref = _ref(avail[0]) if avail else None
        location = None
        if loc_ref:
            location = {
                "className": _strip_type_prefix(loc_ref.get("_RecordName_")),
                "name": loc_text(record_value(loc_ref).get("name")),
                "locality": _strip_type_prefix(locality_ref.get("_RecordName_")) if locality_ref else None,
            }

        giver_ref = _ref(rv.get("missionGiverRecord"))
        giver_text = loc_text(rv.get("missionGiver"))
        if giver_text and "~mission(" in (giver_text.get("en") or ""):
            giver_text = None

        reward = rv.get("missionReward") if isinstance(rv.get("missionReward"), dict) else {}
        amount = reward.get("reward")
        amount = int(amount) if isinstance(amount, (int, float)) and amount > 0 else None

        title_clean = None
        if title:
            title_clean = {"en": clean_title(title.get("en")), "de": clean_title(title.get("de"))}
            if not (title_clean["en"] or title_clean["de"]):
                title_clean = None
        if not title_clean and not type_name:
            skipped += 1
            continue

        class_name = _strip_type_prefix(r.name)
        obj = {
            "className": class_name,
            "guid": r.guid,
            "title": title,
            "titleClean": title_clean,
            "description": loc_text(rv.get("description")),
            "type": {"className": _strip_type_prefix(type_ref.get("_RecordName_")) if type_ref else None,
                     "name": type_name},
            "giver": {"name": giver_text,
                      "className": _strip_type_prefix(giver_ref.get("_RecordName_")) if giver_ref else None},
            "location": location,
            "reward": {"amount": amount, "currency": reward.get("currencyType") or None} if amount else None,
            "lawful": rv.get("lawfulMission") if isinstance(rv.get("lawfulMission"), bool) else None,
            "buyIn": int(rv["missionBuyInAmount"]) if isinstance(rv.get("missionBuyInAmount"), (int, float)) and rv["missionBuyInAmount"] > 0 else None,
            "shareable": rv.get("canBeShared") if isinstance(rv.get("canBeShared"), bool) else None,
            "onceOnly": rv.get("onceOnly") if isinstance(rv.get("onceOnly"), bool) else None,
            "category": _category(fn),
            "source": source,
        }
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", class_name or r.guid)
        (d / f"{safe}.json").write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        n += 1
    for obj in contracts:
        (d / f"{obj['className']}.json").write_text(
            json.dumps({**obj, "source": source}, ensure_ascii=False), encoding="utf-8")
        n += 1
    on_log("info", f"missions: {n} released contracts ({skipped} test/unreleased/untitled skipped)")
    return n
