"""Which contracts award which blueprint (ContractGenerator -> BlueprintPoolRecord).

VERIFIED against LIVE 4.10.2 build 12913470 (Game2.dcb, 2026-11-06):

  ContractGenerator.generators[].contracts[]            CareerContract / Contract
    .contractResults.contractResults[]                  polymorphic results
      BlueprintRewards { blueprintPool, chance, missionResults }
  BlueprintPoolRecord.blueprintRewards[]                BlueprintReward { blueprintRecord, weight }

``missionResults`` is one flag per ``EMissionResult`` in enum order (Completed,
InProgress, Failed, Abandoned, Withdrawn). 1 034 of 1 037 results fire on Completed,
3 on InProgress; a result that fires only on a failed run earns nothing here.

The contracts that award blueprints are NOT MissionBrokerEntry records:
``ContractLegacy.missionBrokerEntry`` is the only bridge and none of the 419 legacy
contracts has a BlueprintRewards result. So they become mission rows of their own,
in the shape of missions.py, which the existing ingest op and page take unchanged.

A class name never carries a dot: ``/codex/mission/<class>`` must stay a plain route.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from .missions import _ref, _strip_type_prefix, clean_title, readable_text

#: Missions kept per blueprint; ``total`` says how many exist (median 6, max 126).
MISSION_SOURCE_MAX = 12
_COMPLETED, _IN_PROGRESS = 0, 1
_SAFE = re.compile(r"[^A-Za-z0-9_-]")


@dataclass
class BlueprintSources:
    #: Mission objects in the shape of missions.py, plus ``contract`` and ``blueprintRewards``.
    missions: List[Dict[str, Any]] = field(default_factory=list)
    #: Blueprint class name -> ``{"total": n, "missions": [...]}``, the payload's missionSource.
    by_blueprint: Dict[str, Dict[str, Any]] = field(default_factory=dict)


def _released(node: Dict[str, Any]) -> bool:
    return not node.get("notForRelease") and not node.get("workInProgress")


def _param(name: str, kind: str, *overrides: Dict[str, Any]) -> Any:
    """The first value of a named param: the contract's own, then its handler's."""
    for o in overrides:
        for p in (o or {}).get(kind) or []:
            if isinstance(p, dict) and p.get("param") == name and p.get("value") is not None:
                return p["value"]
    return None


def _earns(result: Dict[str, Any]) -> bool:
    flags = result.get("missionResults")
    if not isinstance(flags, list):
        return False
    return any(i < len(flags) and flags[i] for i in (_COMPLETED, _IN_PROGRESS))


def _en_de(val: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
    return {"en": val.get("en") or "", "de": val.get("de") or ""} if val else None


def _read_pools(df) -> Dict[str, Tuple[str, List[Tuple[str, float]]]]:
    """Pool record id -> (pool class, [(blueprint class, weight)])."""
    pools: Dict[str, Tuple[str, List[Tuple[str, float]]]] = {}
    for r in df.records_by_type_name("BlueprintPoolRecord"):
        rv = df.record_to_dict(r, max_depth=2).get("_RecordValue_", {})
        rows: List[Tuple[str, float]] = []
        for b in rv.get("blueprintRewards") or []:
            ref = _ref(b.get("blueprintRecord")) if isinstance(b, dict) else None
            cn = _strip_type_prefix(ref.get("_RecordName_")) if ref else None
            weight = b.get("weight") if isinstance(b, dict) else None
            if cn and isinstance(weight, (int, float)) and weight > 0:
                rows.append((cn, float(weight)))
        pools[r.guid] = (_strip_type_prefix(r.name) or r.guid, rows)
    return pools


def _iter_contracts(df) -> Iterable[Tuple[str, Dict[str, Any], Dict[str, Any]]]:
    for r in df.records_by_type_name("ContractGenerator"):
        rv = df.record_to_dict(r).get("_RecordValue_", {})
        generator = _strip_type_prefix(r.name) or r.guid
        for handler in rv.get("generators") or []:
            if not isinstance(handler, dict) or not _released(handler):
                continue
            for c in handler.get("contracts") or []:
                if isinstance(c, dict) and _released(c):
                    yield generator, handler, c


def _unique_names(found: List[Tuple[str, Dict[str, Any], Dict[str, Any]]]) -> Dict[int, str]:
    """A stable class per contract: its debug name, plus its id where two share one."""
    seen: Dict[str, int] = {}
    for _g, _h, c in found:
        base = _SAFE.sub("_", str(c.get("debugName") or ""))
        seen[base] = seen.get(base, 0) + 1
    names: Dict[int, str] = {}
    for i, (_g, _h, c) in enumerate(found):
        base = _SAFE.sub("_", str(c.get("debugName") or ""))
        ident = _SAFE.sub("", str(c.get("id") or ""))[:8]
        if not base:
            base = ident
        elif seen[base] > 1:
            base = f"{base}_{ident}"
        names[i] = f"contract_{base}"
    return names


def build_blueprint_sources(df, localized: Callable[[Optional[str]], Optional[Dict[str, str]]],
                            on_log: Callable[[str, str], None] = lambda lvl, m: None) -> BlueprintSources:
    pools = _read_pools(df)
    cache: Dict[str, Dict[str, Any]] = {}

    def record_value(ref: Optional[Dict[str, Any]], depth: int = 1) -> Dict[str, Any]:
        if not ref:
            return {}
        gid = ref["_RecordId_"]
        if gid not in cache:
            rec = df.record_by_id(gid)
            cache[gid] = df.record_to_dict(rec, max_depth=depth).get("_RecordValue_", {}) if rec else {}
        return cache[gid] or {}

    def text(key: Any) -> Optional[Dict[str, str]]:
        return readable_text(localized, key)

    def rewards_of(contract: Dict[str, Any]) -> List[Dict[str, Any]]:
        results = (contract.get("contractResults") or {}).get("contractResults") or []
        out = []
        for res in results:
            if not isinstance(res, dict) or res.get("_Type_") != "BlueprintRewards" or not _earns(res):
                continue
            ref = _ref(res.get("blueprintPool"))
            pool = pools.get(ref["_RecordId_"]) if ref else None
            chance = res.get("chance")
            if pool and pool[1] and isinstance(chance, (int, float)) and chance > 0:
                out.append({"pool": pool[0], "chance": float(chance), "rows": pool[1]})
        return out

    def location_of(*prereq_lists: Iterable[Any]) -> Optional[Dict[str, Any]]:
        for prereqs in prereq_lists:
            for p in prereqs or []:
                if not isinstance(p, dict):
                    continue
                loc = locality = None
                if p.get("_Type_") == "ContractPrerequisite_Location":
                    loc = _ref(p.get("locationAvailable"))
                elif p.get("_Type_") == "ContractPrerequisite_Locality":
                    locality = _ref(p.get("localityAvailable"))
                    avail = record_value(locality).get("availableLocations") or []
                    loc = _ref(avail[0]) if avail else None
                if loc:
                    return {
                        "className": _strip_type_prefix(loc.get("_RecordName_")),
                        "name": text(record_value(loc).get("name")),
                        "locality": _strip_type_prefix(locality.get("_RecordName_")) if locality else None,
                    }
        return None

    found = [(g, h, c) for g, h, c in _iter_contracts(df) if rewards_of(c)]
    names = _unique_names(found)
    out = BlueprintSources()
    links: Dict[str, List[Dict[str, Any]]] = {}
    dropped = 0
    for i, (generator, handler, contract) in enumerate(found):
        template_ref = _ref(contract.get("template"))
        template = record_value(template_ref, 2)
        if template and not _released(template):
            continue
        overrides = contract.get("paramOverrides") or {}
        params = handler.get("contractParams") or {}
        display = template.get("contractDisplayInfo") or {}

        type_ref = _ref(overrides.get("missionTypeOverride")) or _ref(params.get("missionTypeOverride")) or _ref(display.get("type"))
        type_name = text(record_value(type_ref).get("LocalisedTypeName")) if type_ref else None
        title = text(_param("Title", "stringParamOverrides", overrides, params))
        title_clean = None
        if title:
            title_clean = {"en": clean_title(title.get("en")), "de": clean_title(title.get("de"))}
            if not (title_clean["en"] or title_clean["de"]):
                title_clean = None
        if not title_clean and not type_name:
            # Same rule as missions.py and the ingest: a title is never invented.
            dropped += 1
            continue

        giver = text(_param("Contractor", "stringParamOverrides", overrides, params))
        if giver and "~mission(" in (giver.get("en") or ""):
            giver = None
        illegal = _param("Illegal", "boolParamOverrides", overrides, params)
        if illegal is None:
            illegal = display.get("illegal")
        location = location_of(contract.get("additionalPrerequisites"),
                               (handler.get("defaultAvailability") or {}).get("prerequisites"))
        rewards = rewards_of(contract)
        class_name = names[i]
        obj = {
            "className": class_name,
            "guid": contract.get("id"),
            "title": title,
            "titleClean": title_clean,
            "description": text(_param("Description", "stringParamOverrides", overrides, params)),
            "type": {"className": _strip_type_prefix(type_ref.get("_RecordName_")) if type_ref else None,
                     "name": type_name},
            "giver": {"name": giver, "className": None},
            "location": location,
            "reward": None,
            "lawful": (not illegal) if isinstance(illegal, bool) else None,
            "buyIn": None,
            "shareable": None,
            "onceOnly": None,
            "category": f"contract/{generator}".lower(),
            "contract": {"generator": generator, "debugName": contract.get("debugName"),
                         "template": _strip_type_prefix(template_ref.get("_RecordName_")) if template_ref else None},
            "blueprintRewards": [{"pool": r["pool"], "chance": r["chance"],
                                  "blueprints": [cn for cn, _w in r["rows"]]} for r in rewards],
        }
        out.missions.append(obj)

        shown_title = {"en": (title_clean or {}).get("en") or (type_name or {}).get("en") or "",
                       "de": (title_clean or {}).get("de") or (type_name or {}).get("de") or ""}
        shares: Dict[str, float] = {}
        for r in rewards:
            total_weight = sum(w for _cn, w in r["rows"])
            for cn, w in r["rows"]:
                shares[cn] = shares.get(cn, 0.0) + r["chance"] * w / total_weight
        for cn, share in shares.items():
            links.setdefault(cn, []).append({
                "className": class_name,
                "title": shown_title,
                "giver": _en_de(giver),
                "location": _en_de(location["name"]) if location else None,
                # Sorts the list only: how the game draws from a pool is not in the data.
                "share": round(share, 4),
            })

    for cn, rows in links.items():
        rows.sort(key=lambda m: (-m["share"], m["title"]["en"] or m["title"]["de"], m["className"]))
        out.by_blueprint[cn] = {"total": len(rows), "missions": rows[:MISSION_SOURCE_MAX]}
    on_log("info", f"blueprint sources: {len(out.missions)} contracts award "
                   f"{len(out.by_blueprint)} blueprints ({dropped} untitled skipped)")
    return out
