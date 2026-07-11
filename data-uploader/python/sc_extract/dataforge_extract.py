"""Real DataCore extraction: generic exhaustive dump + typed projections.

Consumes a parsed :class:`sc_extract.dataforge.DataForge` (our pure-Python v8
reader) plus localization tables, and writes:

  * ``records/<Type>/*.json`` — EVERY record of EVERY type, fully resolved via
    ``record_to_dict``. This is the "alle Werte von allen Spielelementen"
    guarantee: nothing is dropped, unknown types included.
  * ``ships/``, ``weapons/``, ``components/``, ``ammunition/``,
    ``manufacturers/`` — typed projections matching the domain model
    (docs/concepts/codex-research.md §5), streamed one JSON file per entity.

Classification is driven by the live data: ships by the
``libs/foundry/records/entities/spaceships/`` filename prefix, items by their
``SAttachableComponentParams.AttachDef.Type`` (vocabulary discovered from the
live datacore — see datacore_schema.json), with an ``Other`` catch-all so
nothing is silently dropped.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .dataforge import DataForge, Record
from .localization import Localizer

# ── Blueprint candidate-field lists (R1/R2: UNCONFIRMED — see extract_blueprints) ──────────
# RISK HIGH: these leaf-field names are hypotheses derived from SC crafting data
# discovered via scunpacked JSON dumps and community wiki schema notes. They have
# NOT been confirmed against a live Data/Game2.dcb. The first matching key wins;
# if none match, the field resolves to null (never crashes).
#
# Blueprint ingredient array container: DataForge struct name UNKNOWN (R2).
# Candidate top-level field names on CraftingBlueprintRecord that hold the
# ingredient list.
_BP_INGREDIENTS_FIELDS = ("ingredients", "resources", "entries", "inputs",
                          "craftingIngredients", "items")

# Output item ref field names (the thing you craft):
_BP_OUTPUT_FIELDS = ("outputItem", "output", "result", "craftingResult",
                     "item", "resultItem")

# Quantity scalar names (on ingredient entries):
_BP_QTY_FIELDS = ("quantity", "count", "amount", "qty", "requiredCount")

# Min-quality threshold scalar (on ingredient entries):
_BP_MINQUALITY_FIELDS = ("minQuality", "minimumQuality", "quality",
                         "requiredQuality", "qualityThreshold")

# Output quantity scalar names:
_BP_OUTPUT_QTY_FIELDS = ("quantity", "count", "amount", "outputCount")

# Blueprint category ref field names:
_BP_CATEGORY_FIELDS = ("category", "craftingCategory", "type", "blueprintCategory")

# Blueprint display name / description localization key fields.
# These override the generic entity loc-key fields when they appear on
# CraftingBlueprintRecord (which is NOT an EntityClassDefinition and thus
# does NOT carry AttachDef.Localization).
_BP_NAME_FIELDS = ("name", "Name", "localizedName", "displayName",
                   "blueprintName", "craftingName")
_BP_DESC_FIELDS = ("description", "Description", "localizedDescription",
                   "displayDescription", "blueprintDescription")

# processSpecificData: VERIFIED struct name for dismantle process is
# "GenericCraftingProcess_Dismantle". The fabrication process struct name is
# UNCONFIRMED (R2). We scan ANY struct under processSpecificData for a
# TimeValue_Partitioned so we are name-agnostic.
_BP_PROCESS_FIELDS = ("processSpecificData", "processData", "process",
                      "craftingProcess", "fabrication", "dismantling")

# Time normalization: VERIFIED from TimeValue_Partitioned struct (@days, @hours,
# @minutes, @seconds). The @ prefix is the DataForge attribute prefix in
# unp4k JSON. Both "@days" and "days" are tried (reader may strip @).
_TIME_DAYS_FIELDS = ("@days", "days", "Days")
_TIME_HOURS_FIELDS = ("@hours", "hours", "Hours")
_TIME_MINS_FIELDS = ("@minutes", "minutes", "Minutes")
_TIME_SECS_FIELDS = ("@seconds", "seconds", "Seconds")

# AttachDef.Type -> our ComponentKind (research §5). Vocabulary verified live.
_COMPONENT_KIND = {
    "PowerPlant": "PowerPlant",
    "Shield": "Shield",
    "Cooler": "Cooler",
    "QuantumDrive": "QuantumDrive",
    "MainThruster": "Thruster",
    "ManneuverThruster": "Thruster",
    "FuelTank": "FuelTank",
    "QuantumFuelTank": "FuelTank",
    "FuelIntake": "FuelIntake",
    "CargoGrid": "CargoGrid",
}

# AttachDef.Type values that denote weapons (ship + FPS).
_SHIP_WEAPON_TYPES = {"WeaponGun", "Turret", "MissileLauncher", "WeaponDefensive"}
_FPS_WEAPON_TYPES = {"WeaponPersonal"}

_SHIP_PREFIX = "libs/foundry/records/entities/spaceships/"

# Overall progress-bar sub-ranges (percent) for the two long phases, so the bar
# advances smoothly instead of freezing at the phase's start value. The host
# (extract.py) owns 0–10 (discover/open/decompress) and 85–100 (validate/
# bundle); everything the extractor itself does lives in 10–85.
_PCT_ENTITIES = (15, 55)   # typed catalog projection (ships/weapons/…)
_PCT_RECORDS = (55, 84)    # exhaustive generic dump


def _mapped_pct(current: int, total: int, lo: int, hi: int) -> int:
    """Map a ``current/total`` fraction into the overall-bar sub-range [lo, hi]."""
    if total <= 0:
        return lo
    return min(hi, lo + int((current / total) * (hi - lo)))


def _norm_path(p: Optional[str]) -> str:
    return (p or "").replace("\\", "/").lower()


def _strip_type_prefix(name: str) -> str:
    """Records carry the struct-type prefix, e.g. 'EntityClassDefinition.AEGS_Gladius'."""
    return name.split(".", 1)[1] if "." in name else name


# Tokens that mark a record as dev/test scaffolding (every catalog) or an NPC /
# derelict / world variant (mostly ships, some weapons/items). A record belongs
# in a player-facing catalog only if its class name contains NONE of these as a
# whole, underscore-delimited token. Token boundaries matter: a naive substring
# match would wrongly drop "ContestedZone" (contains "test") or "Temperature"
# ("temp"). Raw records are always kept by dump_all_records(); only the typed
# catalogs (ships/weapons/components/items/ammunition/blueprints) are filtered.
# This is the single source of truth — tune the token lists here.
_JUNK_TOKENS = (
    "template", "temp", "tmp", "test", "debug", "dummy", "placeholder",
    "deprecated", "dev", "proto", "prototype", "obsolete", "unused", "wip",
    "stub", "sample", "example", "broken",
)
_NPC_TOKENS = (
    "ai", "derelict", "unmanned", "shipboarded", "boarded", "lootable",
    "wreck", "hijacked", "stunt", "lowfuel", "nocargo", "halfcargo",
    "modifiers", "simpod",
)
_NONCATALOG_RE = re.compile(
    r"(?:^|_)(?:" + "|".join(_JUNK_TOKENS + _NPC_TOKENS) + r")(?:_|$)",
    re.IGNORECASE,
)


def _is_catalog_entity(class_name: str) -> bool:
    """True for real, player-facing entities; False for dev/test scaffolding and
    NPC/derelict/world variants. Shared by every typed catalog."""
    # SC class names are underscore-delimited, but normalise camelCase plus -, .
    # and spaces to '_' first so a variant marker can't hide behind a different
    # separator (e.g. 'Foo-Test', 'ShipBoardedVariant').
    norm = re.sub(r"(?<=[a-z])(?=[A-Z])", "_", class_name)
    norm = re.sub(r"[^0-9A-Za-z]+", "_", norm)
    return _NONCATALOG_RE.search(norm) is None


def _safe_filename(name: str) -> str:
    keep = "".join(c if (c.isalnum() or c in "._-") else "_" for c in name)
    return keep[:180] or "unnamed"


def _components_of(resolved: Dict[str, Any]) -> List[Dict[str, Any]]:
    comps = resolved.get("_RecordValue_", {}).get("Components")
    return [c for c in comps if isinstance(c, dict)] if isinstance(comps, list) else []


def _find_component(comps: List[Dict[str, Any]], type_name: str) -> Optional[Dict[str, Any]]:
    for c in comps:
        if c.get("_Type_") == type_name:
            return c
    return None


def _attach_def(comps: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    sac = _find_component(comps, "SAttachableComponentParams")
    if sac and isinstance(sac.get("AttachDef"), dict):
        return sac["AttachDef"]
    return None


class CodexExtractor:
    """Drives the generic dump + typed projections over a DataForge instance."""

    def __init__(self, df: DataForge, localizer: Localizer, out_dir: Path,
                 source: Dict[str, str], on_count: Callable[[str, int], None] = lambda k, v: None,
                 on_log: Callable[[str, str], None] = lambda lvl, m: None,
                 on_progress: Callable[..., None] = lambda *a, **k: None,
                 dump_generic: bool = True, p4k=None, extract_assets: bool = True) -> None:
        self.df = df
        self.loc = localizer
        self.out = out_dir
        self.source = source
        self.on_count = on_count
        self.on_log = on_log
        self.on_progress = on_progress
        self.dump_generic = dump_generic
        self.p4k = p4k
        self.counts: Dict[str, int] = {}
        # Preview-image + dimension extraction needs the open P4K. Lazily built.
        self._assets = None
        if extract_assets and p4k is not None:
            try:
                from .images import AssetExtractor
                self._assets = AssetExtractor(p4k, out_dir / "previews", on_log=on_log)
            except Exception as exc:  # noqa: BLE001
                on_log("warn", f"asset extractor unavailable: {exc}")
        self._dim_cache: Dict[str, Optional[Dict[str, Any]]] = {}
        # guid -> manufacturer code, built lazily
        self._manu_cache: Dict[str, Dict[str, Any]] = {}
        # Ship-skin (livery) catalog discovery — built lazily on the first ship,
        # index pre-bucketed once so per-ship lookup is cheap. Skins are a
        # sub-property of every ship, extracted inline with the metadata.
        self._skin_disco = None
        self._skins_total = 0
        # Ships that have at least one 3D-buildable paint (a resolvable material),
        # captured as ShipRefs for the follow-on glb build. Written to
        # skins/_build_manifest.json so the build step is driven by the extract
        # instead of manual ship input.
        self._skin_build_refs: List[Dict[str, str]] = []

    # ── public entry ─────────────────────────────────────────────────────────
    def run(self) -> Dict[str, int]:
        self.on_progress("localization", pct=10)
        self.dump_localization()      # full global.ini tables (en/de)
        self.dump_keybinds()          # default action profile (keybindings)
        self.on_progress("reference", pct=13)
        self.extract_manufacturers()
        self.extract_ammunition()
        self.extract_blueprints()     # crafting blueprints (CraftingBlueprintRecord)
        self.extract_entities()       # ships / weapons / components / items
        self._write_skin_build_manifest()
        if self._assets:
            self.on_log("info", f"preview images: {self._assets.converted} converted, "
                                f"{self._assets.misses} missing")
            self._bump("previews", self._assets.converted)
        if self.dump_generic:
            self.dump_all_records()   # exhaustive generic guarantee
        else:
            self.on_log("info", "skipping generic record dump (--skip-generic)")
        return self.counts

    # ── full localization tables ──────────────────────────────────────────────
    def dump_localization(self) -> None:
        """Write the complete global.ini tables (key→value) per language.

        The typed projections only carry the handful of name/description keys an
        entity references; this dumps the ENTIRE table so the catalog can resolve
        any @-key (roles, port labels, loadout item names, …) — the full
        "übersetzungen anzeigen" guarantee. One JSON file per short lang code.
        """
        d = self.out / "localization"
        d.mkdir(parents=True, exist_ok=True)
        total = 0
        for lang, table in self.loc._tables.items():
            (d / f"{lang}.json").write_text(
                json.dumps(table, ensure_ascii=False), encoding="utf-8")
            total += len(table)
            self.on_log("info", f"localization '{lang}': {len(table)} strings")
        self._bump("strings", total)

    # ── localized text helper ─────────────────────────────────────────────────
    def _localized(self, key: Optional[str]) -> Optional[Dict[str, str]]:
        if not key or key in ("@LOC_EMPTY", "@LOC_PLACEHOLDER", ""):
            return {"de": "", "en": "", "key": key or ""}
        return self.loc.localized_text(key)

    # ── keybindings ───────────────────────────────────────────────────────────
    def _find_profile_entry(self) -> Optional[str]:
        """Locate defaultProfile.xml in the P4K (case-insensitive suffix match)."""
        target = "libs/config/defaultprofile.xml"
        for name in self.p4k.namelist():
            if name.lower().replace("\\", "/").endswith(target):
                return name
        return None

    def dump_keybinds(self) -> None:
        """Write the default keybindings from Data/Libs/Config/defaultProfile.xml.

        Actionmaps + actions + per-device default bindings; labels stay raw
        @-keys (resolved client-side via codex_locale_strings, all languages).
        Needs the open P4K; a missing/unreadable profile is a warning, not a
        failure — the rest of the extract still lands.
        """
        if self.p4k is None:
            return
        entry = self._find_profile_entry()
        if not entry:
            self.on_log("warn", "defaultProfile.xml not found in P4K — no keybinds")
            return
        try:
            info = self.p4k.getinfo(entry)
            with self.p4k.open(info) as f:
                raw = f.read()
        except Exception as exc:  # noqa: BLE001
            self.on_log("warn", f"failed to read {entry}: {exc}")
            return
        from .keybinds import parse_default_profile

        data = parse_default_profile(raw)
        d = self.out / "keybinds"
        d.mkdir(parents=True, exist_ok=True)
        (d / "keybinds.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8")
        self.on_log("info", f"keybinds: {len(data['actionmaps'])} actionmaps, "
                            f"{len(data['actions'])} actions")
        self._bump("keybinds", len(data["actions"]))

    # ── manufacturers ─────────────────────────────────────────────────────────
    def extract_manufacturers(self) -> None:
        d = self.out / "manufacturers"
        d.mkdir(parents=True, exist_ok=True)
        n = 0
        for r in self.df.records_by_type_name("SCItemManufacturer"):
            if not _is_catalog_entity(_strip_type_prefix(r.name)):
                continue
            resolved = self.df.record_to_dict(r, max_depth=8)
            rv = resolved.get("_RecordValue_", {})
            code = rv.get("Code") or _strip_type_prefix(r.name)
            obj = {
                "className": _strip_type_prefix(r.name),
                "guid": r.guid,
                "code": code,
                "name": self._localized(rv.get("Localization", {}).get("Name")
                                        if isinstance(rv.get("Localization"), dict) else None),
                "description": self._localized(rv.get("Localization", {}).get("Description")
                                               if isinstance(rv.get("Localization"), dict) else None),
                "source": self.source,
            }
            self._manu_cache[r.guid] = obj
            (d / f"{_safe_filename(obj['className'])}.json").write_text(
                json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
            n += 1
        self._bump("manufacturers", n)

    def _manufacturer_ref(self, attach_def: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not attach_def:
            return None
        m = attach_def.get("Manufacturer")
        if isinstance(m, dict):
            gid = m.get("_RecordId_")
            if gid and gid in self._manu_cache:
                mc = self._manu_cache[gid]
                return {"code": mc["code"], "name": mc["name"], "className": mc["className"]}
        return None

    # ── ammunition ─────────────────────────────────────────────────────────────
    def extract_ammunition(self) -> None:
        d = self.out / "ammunition"
        d.mkdir(parents=True, exist_ok=True)
        n = 0
        for r in self.df.records_by_type_name("AmmoParams"):
            if not _is_catalog_entity(_strip_type_prefix(r.name)):
                continue
            resolved = self.df.record_to_dict(r, max_depth=12)
            rv = resolved.get("_RecordValue_", {})
            # damage block is nested under projectile params, not a flat `damage`
            # key — locate it generically by its channel field names.
            dmg = _damage_set(_dig(rv, "damage")) or _damage_set_anycase(
                _find_first_dict_with(
                    rv, ("DamagePhysical", "DamageEnergy", "DamageDistortion",
                         "DamageThermal", "DamageBiochemical", "DamageStun")))
            obj = {
                "className": _strip_type_prefix(r.name),
                "guid": r.guid,
                "speed": rv.get("speed"),
                "lifetime": rv.get("lifetime"),
                "size": rv.get("size"),
                "impactDamage": dmg,
                "raw": rv,  # keep everything (ammo schema is small + valuable)
                "source": self.source,
            }
            (d / f"{_safe_filename(obj['className'])}.json").write_text(
                json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
            n += 1
        self._bump("ammunition", n)

    # ── blueprints ─────────────────────────────────────────────────────────────
    def extract_blueprints(self) -> None:
        """Project CraftingBlueprintRecord entries to BlueprintPayload JSON.

        Field names used here are UNCONFIRMED hypotheses (R1/R2 — see module-level
        _BP_* constants). Every field falls back to null if no candidate matches.
        We never crash on unexpected structure; all GUID stubs with no matching
        record are kept with className=null and emitted as a warn-count.

        Output shape (§6 BlueprintPayload): className, guid, type, recordTag, name,
          description, entityKind, category, categoryLabel, tier, craftTimeSeconds,
          dismantleTimeSeconds, dismantleEfficiency, ingredients, outputs,
          qualityRefs, gameplayProperties, poolClassName, isDefault,
          missionSource (always null, R5), tags, raw, source.

        Ingredients shape (flattened; DB child table is Wave-1b's job):
          [{ className, guid, name, quantity, minQuality, role, raw }, ...]
        """
        d = self.out / "blueprints"
        d.mkdir(parents=True, exist_ok=True)

        # GUID -> className resolution cache for ingredient/output/category refs.
        # Built lazily from the full record list so we can resolve cross-refs.
        ref_cache: Dict[str, Optional[str]] = {}

        def _resolve_guid(guid: Optional[str]) -> Optional[str]:
            """Map a GUID string to a record className; None if unresolvable."""
            if not guid:
                return None
            if guid in ref_cache:
                return ref_cache[guid]
            rec = self.df.record_by_id(guid)
            className = _strip_type_prefix(rec.name) if rec else None
            ref_cache[guid] = className
            return className

        def _pick(d: Any, fields: tuple) -> Any:
            """Return first non-None value for any candidate field name in d."""
            if not isinstance(d, dict):
                return None
            for f in fields:
                v = d.get(f)
                if v is not None:
                    return v
            return None

        def _ref_stub(node: Any) -> Dict[str, Any]:
            """Extract {className, guid} from a DataForge GUID stub dict.

            A GUID stub looks like:
              {"_RecordId_": "...", "_RecordName_": "...", "_RecordPath_": "..."}
            or a resolved Record dict. Returns {className, guid}.
            """
            if not isinstance(node, dict):
                return {"className": None, "guid": None}
            guid = node.get("_RecordId_")
            # _RecordName_ is the full "Type.ClassName" form
            raw_name = node.get("_RecordName_")
            if raw_name:
                className = _strip_type_prefix(raw_name)
            else:
                className = _resolve_guid(guid)
            return {"className": className, "guid": guid}

        def _normalize_time(node: Any) -> Optional[float]:
            """Normalize a TimeValue_Partitioned struct to total seconds.

            VERIFIED: struct has @days, @hours, @minutes, @seconds.
            Scans generically; tries both @ and bare field names.
            Returns None if the struct is absent or has no recognizable fields.
            """
            if not isinstance(node, dict):
                return None
            # Search recursively for a dict that carries any of the time fields
            tv = _find_first_dict_with(
                node, ("@days", "days", "@hours", "hours", "@minutes",
                        "minutes", "@seconds", "seconds"),
                _max_depth=8)
            if tv is None:
                return None
            d_val = _to_float(_pick(tv, _TIME_DAYS_FIELDS)) or 0.0
            h_val = _to_float(_pick(tv, _TIME_HOURS_FIELDS)) or 0.0
            m_val = _to_float(_pick(tv, _TIME_MINS_FIELDS)) or 0.0
            s_val = _to_float(_pick(tv, _TIME_SECS_FIELDS)) or 0.0
            total = d_val * 86400 + h_val * 3600 + m_val * 60 + s_val
            return total if total > 0 else None

        def _craft_time(rv: Dict[str, Any]) -> Optional[float]:
            """Scan processSpecificData for ANY TimeValue_Partitioned struct.

            R2: fabrication process struct name unknown. We try all candidate
            field names for the process container and return the first valid time.
            craftTime and dismantleTime are emitted separately by the caller.
            """
            for pf in _BP_PROCESS_FIELDS:
                proc = rv.get(pf)
                if proc is None:
                    continue
                if isinstance(proc, list):
                    for item in proc:
                        t = _normalize_time(item)
                        if t is not None:
                            return t
                else:
                    t = _normalize_time(proc)
                    if t is not None:
                        return t
            # Also try a flat TimeValue_Partitioned directly on the record
            return _normalize_time(rv)

        def _project_ingredients(rv: Dict[str, Any],
                                  dangling_warn: list) -> List[Dict[str, Any]]:
            """Resolve ingredient list from any candidate field.

            Keeps dangling GUIDs (unresolvable) as {className: null, guid: <raw>}.
            Appends to dangling_warn so the caller can emit a single count log.
            """
            raw_list = None
            for f in _BP_INGREDIENTS_FIELDS:
                v = rv.get(f)
                if isinstance(v, list) and v:
                    raw_list = v
                    break
            if not raw_list:
                return []
            out = []
            for entry in raw_list:
                if not isinstance(entry, dict):
                    continue
                # The ingredient item ref may be a GUID stub or a nested ref field
                item_node = (entry.get("item") or entry.get("itemRef")
                             or entry.get("entity") or entry.get("entityRef")
                             or entry)
                ref = _ref_stub(item_node)
                if ref["className"] is None and ref["guid"]:
                    dangling_warn.append(ref["guid"])
                qty = _to_float(_pick(entry, _BP_QTY_FIELDS))
                min_q = _to_float(_pick(entry, _BP_MINQUALITY_FIELDS))
                role = _pick(entry, ("role", "ingredientRole", "resourceRole", "slot"))
                out.append({
                    "className": ref["className"],
                    "guid": ref["guid"],
                    "name": None,  # best-effort; resolve via the joined entity (v1)
                    "quantity": qty,
                    "minQuality": min_q,
                    "role": role if isinstance(role, str) else None,
                    "raw": entry,
                })
            return out

        n = 0
        total_dangling = 0
        # Ignore Legacy* record types (they are covered by the generic dump)
        for r in self.df.records_by_type_name("CraftingBlueprintRecord"):
            if not _is_catalog_entity(_strip_type_prefix(r.name)):
                continue
            resolved = self.df.record_to_dict(r, max_depth=16)
            rv = resolved.get("_RecordValue_", {})

            # name / description localization keys
            name_key = (_pick(rv, _BP_NAME_FIELDS)
                        or _pick(rv.get("Localization") if isinstance(
                            rv.get("Localization"), dict) else {}, _BP_NAME_FIELDS))
            desc_key = (_pick(rv, _BP_DESC_FIELDS)
                        or _pick(rv.get("Localization") if isinstance(
                            rv.get("Localization"), dict) else {}, _BP_DESC_FIELDS))

            # category ref → className string + localized label (§6)
            cat_node = _pick(rv, _BP_CATEGORY_FIELDS)
            category = None
            category_label = None
            if isinstance(cat_node, dict):
                category = _ref_stub(cat_node)["className"]
                cat_name_key = _pick(cat_node, _BP_NAME_FIELDS)
                category_label = (self._localized(cat_name_key)
                                  if isinstance(cat_name_key, str) else None)
            elif isinstance(cat_node, str):
                category = cat_node

            # output item ref(s) → outputs[] array (§6)
            out_node = _pick(rv, _BP_OUTPUT_FIELDS)
            output_qty = _to_float(_pick(rv, _BP_OUTPUT_QTY_FIELDS))
            outputs: List[Dict[str, Any]] = []
            for on in (out_node if isinstance(out_node, list) else [out_node]):
                if not isinstance(on, dict):
                    continue
                oref = _ref_stub(on)
                outputs.append({
                    "className": oref["className"],
                    "guid": oref["guid"],
                    "name": None,  # best-effort; resolve via the joined entity (v1)
                    "quantity": output_qty,
                    "raw": on,
                })
            if not outputs and output_qty is not None:
                outputs.append({"className": None, "guid": None,
                                "name": None, "quantity": output_qty, "raw": {}})

            # craft / dismantle times + dismantle efficiency: scan processes generically.
            # Fabrication struct name UNCONFIRMED (R2); GenericCraftingProcess_Dismantle
            # is the only VERIFIED one. Dismantle identified by "_Type_" containing
            # "dismantle"; everything else treated as fabrication.
            craft_time: Optional[float] = None
            dismantle_time: Optional[float] = None
            dismantle_eff: Optional[float] = None
            proc_data = rv.get("processSpecificData") or rv.get("processData") or []
            for proc in (proc_data if isinstance(proc_data, list) else [proc_data]):
                if not isinstance(proc, dict):
                    continue
                t = _normalize_time(proc)
                stype = (proc.get("_Type_") or "").lower()
                if "dismantle" in stype:
                    if dismantle_time is None:
                        dismantle_time = t
                    if dismantle_eff is None:
                        dismantle_eff = _to_float(_pick(proc, ("@efficiency", "efficiency")))
                elif craft_time is None and t is not None:
                    craft_time = t
            # Fallback: any TimeValue_Partitioned anywhere on the record
            if craft_time is None and dismantle_time is None:
                craft_time = _craft_time(rv)

            # ingredients (flattened; DB child table is Wave-1b's job)
            dangling: list = []
            ingredients = _project_ingredients(rv, dangling)
            total_dangling += len(dangling)

            # quality refs (v1: store className refs only; simulator deferred — R3)
            quality_refs = {
                "distribution": _ref_stub(_pick(rv, ("qualityDistribution",
                    "craftingQualityDistribution", "distribution")) or {})["className"],
                "quantization": _ref_stub(_pick(rv, ("qualityQuantization",
                    "craftingQualityQuantization", "quantization")) or {})["className"],
            }
            gp_node = _pick(rv, ("gameplayProperties", "craftingGameplayProperties",
                                 "properties", "gameplayPropertyDefs"))
            gameplay_properties = [
                _ref_stub(g)["className"]
                for g in (gp_node if isinstance(gp_node, list) else [])
                if isinstance(g, dict) and _ref_stub(g)["className"]
            ]
            pool_node = _pick(rv, ("pool", "blueprintPool", "poolRecord", "rewardPool"))
            pool_class = (_ref_stub(pool_node)["className"] if isinstance(pool_node, dict)
                          else pool_node if isinstance(pool_node, str) else None)
            default_node = _pick(rv, ("isAvailableByDefault", "availableByDefault",
                                      "isDefault", "@isAvailableByDefault"))
            is_default = bool(default_node) if isinstance(default_node, bool) else None
            tier_val = _to_float(_pick(rv, ("tier", "Tier", "blueprintTier", "craftingTier")))
            tags_node = _pick(rv, ("tags", "Tags"))
            tags = ([t for t in tags_node if isinstance(t, str)]
                    if isinstance(tags_node, list) else [])

            obj = {
                "className": _strip_type_prefix(r.name),
                "guid": r.guid,
                "type": r.type,
                "recordTag": r.tag,
                "name": self._localized(name_key if isinstance(name_key, str) else None),
                "description": self._localized(desc_key if isinstance(desc_key, str) else None),
                "entityKind": "blueprint",
                "category": category,
                "categoryLabel": category_label,
                "tier": int(tier_val) if tier_val is not None else None,
                "craftTimeSeconds": craft_time,
                "dismantleTimeSeconds": dismantle_time,
                "dismantleEfficiency": dismantle_eff,
                "ingredients": ingredients,
                "outputs": outputs,
                "qualityRefs": quality_refs,
                "gameplayProperties": gameplay_properties,
                "poolClassName": pool_class,
                "isDefault": is_default,
                "missionSource": None,  # R5: always null in v1
                "tags": tags,
                "raw": rv,
                "source": self.source,
            }
            (d / f"{_safe_filename(obj['className'])}.json").write_text(
                json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
            n += 1

        if total_dangling:
            self.on_log("warn", f"blueprints: {total_dangling} ingredient GUID(s) "
                                "unresolvable (kept with className=null)")
        self._bump("blueprints", n)

    # ── entities (ships / weapons / components / items) ────────────────────────
    def extract_entities(self) -> None:
        ships_d = self.out / "ships"; ships_d.mkdir(parents=True, exist_ok=True)
        wpn_d = self.out / "weapons"; wpn_d.mkdir(parents=True, exist_ok=True)
        comp_d = self.out / "components"; comp_d.mkdir(parents=True, exist_ok=True)
        item_d = self.out / "items"; item_d.mkdir(parents=True, exist_ok=True)

        n_ship = n_wpn = n_comp = n_item = n_skip = 0
        ents = self.df.records_by_type_name("EntityClassDefinition")
        total = len(ents)
        for i, r in enumerate(ents):
            # Filter dev/test scaffolding + NPC/derelict/world variants out of the
            # typed catalogs (ships/weapons/components/items) up front — same rule
            # for every entity type. Cheap name check before the costly resolve;
            # the raw record is still captured by dump_all_records().
            if not _is_catalog_entity(_strip_type_prefix(r.name)):
                n_skip += 1
                continue
            fn = _norm_path(r.filename)
            is_ship = fn.startswith(_SHIP_PREFIX)
            resolved = self.df.record_to_dict(r, max_depth=20)
            comps = _components_of(resolved)
            attach = _attach_def(comps)
            atype = attach.get("Type") if attach else None

            if is_ship:
                obj = self._project_ship(r, resolved, comps, attach)
                ships_d.joinpath(f"{_safe_filename(obj['className'])}.json").write_text(
                    json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
                n_ship += 1
            elif atype in _SHIP_WEAPON_TYPES or atype in _FPS_WEAPON_TYPES or \
                    _find_component(comps, "SCItemWeaponComponentParams"):
                obj = self._project_weapon(r, resolved, comps, attach, atype)
                wpn_d.joinpath(f"{_safe_filename(obj['className'])}.json").write_text(
                    json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
                n_wpn += 1
            elif atype in _COMPONENT_KIND:
                obj = self._project_component(r, resolved, comps, attach, atype)
                comp_d.joinpath(f"{_safe_filename(obj['className'])}.json").write_text(
                    json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
                n_comp += 1
            elif attach is not None:
                # any other attachable item — keep as generic item projection
                obj = self._project_item(r, resolved, comps, attach, atype)
                item_d.joinpath(f"{_safe_filename(obj['className'])}.json").write_text(
                    json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
                n_item += 1
            # entities with no AttachDef (rooms, AI templates, etc.) are still
            # captured by dump_all_records().

            if i % 2000 == 0:
                # Live counters (the grid) + a smooth "scanned i of total" line.
                # The per-2000 'entities i/total' log line is dropped — the
                # progress event now carries that, so the transcript stays clean.
                self.on_count("ships", n_ship)
                self.on_count("weapons", n_wpn)
                self.on_count("components", n_comp)
                self.on_count("items", n_item)
                self.on_count("skins", self._skins_total)
                self.on_progress("entities", current=i, total=total,
                                 pct=_mapped_pct(i, total, *_PCT_ENTITIES))

        self.on_progress("entities", current=total, total=total, pct=_PCT_ENTITIES[1])
        self.on_log("info", f"catalog: {n_ship} ships · {n_wpn} weapons · "
                            f"{n_comp} components · {n_item} items · "
                            f"{self._skins_total} skins "
                            f"({n_skip} dev/NPC variants skipped)")
        self._bump("ships", n_ship)
        self._bump("weapons", n_wpn)
        self._bump("components", n_comp)
        self._bump("items", n_item)
        self._bump("skins", self._skins_total)

    # ── asset helpers (preview image + dimensions) ─────────────────────────────
    def _display_icon(self, resolved: Dict[str, Any]) -> Optional[str]:
        """The entity's displayIcon path from StaticEntityClassData (if any)."""
        secd = resolved.get("_RecordValue_", {}).get("StaticEntityClassData")
        if not isinstance(secd, list):
            return None
        for entry in secd:
            if isinstance(entry, dict):
                icon = entry.get("displayIcon")
                if isinstance(icon, str) and icon:
                    return icon
        return None

    def _preview_image(self, resolved: Dict[str, Any]) -> Optional[str]:
        """Convert the entity's displayIcon DDS to a deduped WebP; return its name."""
        if not self._assets:
            return None
        return self._assets.resolve(self._display_icon(resolved))

    def _hull_path(self, comps) -> Optional[str]:
        """Normalized (Data/-rooted) whole-ship .cga/.cgf mesh path, or None.

        The mesh path lives on a component (e.g. SGeometryResourceParams) whose
        `Geometry` field is an SGeometryNodeParams: comp.Geometry.Geometry.Geometry.path.
        First try that documented nesting; then fall back to a generic deep
        search for ANY .cga/.cgf path string (the nesting depth has varied
        across patches). No per-ship special-casing — same scan for every hull.
        Shared by dimensions parsing and skin-catalog discovery."""
        from .geometry import normalize_geometry_path
        path = None
        for c in comps:
            g = c.get("Geometry")
            if isinstance(g, dict):
                p = _dig(g, "Geometry", "Geometry", "path")
                if isinstance(p, str) and p.lower().endswith((".cga", ".cgf")):
                    path = p
                    break
        if path is None:
            # generic fallback: first .cga/.cgf path anywhere on a component
            for c in comps:
                cand = _find_geometry_path(c)
                if cand:
                    path = cand
                    break
        return normalize_geometry_path(path)

    def _dimensions(self, comps) -> Optional[Dict[str, Any]]:
        """Real-world L/W/H (metres) from the ship's .cga geometry bounding box."""
        if self.p4k is None:
            return None
        from .geometry import bbox_from_cga_bytes
        key = self._hull_path(comps)
        if not key:
            return None
        if key in self._dim_cache:
            return self._dim_cache[key]
        dims = None
        try:
            # case-insensitive lookup
            if not hasattr(self, "_p4k_lower"):
                self._p4k_lower = {n.lower(): n for n in self.p4k.namelist()}
            entry = self._p4k_lower.get(key.lower())
            if entry:
                with self.p4k.open(self.p4k.getinfo(entry)) as f:
                    dims = bbox_from_cga_bytes(f.read())
        except Exception as exc:  # noqa: BLE001 — best-effort
            self.on_log("warn", f"dimensions failed for {key}: {exc}")
        self._dim_cache[key] = dims
        return dims

    def _skin_catalog(self, class_name: str, comps) -> List[Dict[str, Any]]:
        """Liveries (paint skins) for a ship, as a sub-property of its record.

        Derives the ship's manufacturer/folder from the already-resolved hull
        mesh path (no hard-coded ship table) and returns the cheap paint catalog
        — id, name, description, icon, and whether a 3D material exists. The
        heavy glb build is a separate, cached step; this only enumerates.
        Best-effort: any failure yields an empty list, never aborts the ship."""
        if self.p4k is None:
            return []
        hull = self._hull_path(comps)
        if not hull:
            return []
        from .ship_discovery import ShipDiscovery, ref_from_hull
        if self._skin_disco is None:
            self._skin_disco = ShipDiscovery(self.p4k)
            self._skin_disco.build_index()
        ref = ref_from_hull(class_name, hull)
        if ref is None:
            return []
        try:
            cat = self._skin_disco.catalog(ref, hull_cga=hull)
        except Exception as exc:  # noqa: BLE001 — one ship's skins must not fail the run
            self.on_log("warn", f"skin catalog for {class_name}: {type(exc).__name__}: {exc}")
            return []
        # Record ships with a buildable (material-backed) paint for the glb build.
        if any(c.get("has_material") for c in cat):
            self._skin_build_refs.append({
                "ship_id": ref.ship_id, "mfr": ref.mfr,
                "ship": ref.ship, "series_token": ref.series_token,
            })
        return cat

    def _write_skin_build_manifest(self) -> None:
        """Drop skins/_build_manifest.json listing every ship with a buildable
        paint. The follow-on 3D-glb build reads this instead of manual ship
        input, so skins ride along the normal extract → upload flow."""
        skins_dir = self.out / "skins"
        skins_dir.mkdir(parents=True, exist_ok=True)
        (skins_dir / "_build_manifest.json").write_text(
            json.dumps({"ships": self._skin_build_refs}, ensure_ascii=False, indent=2),
            encoding="utf-8")
        self.on_log("info", f"skin build manifest: {len(self._skin_build_refs)} "
                            f"ship(s) with buildable liveries")

    # ── typed projections ──────────────────────────────────────────────────────
    # Leaf field names that carry a localization @-key for name/description.
    # AttachDef.Localization.{Name,Description} is the primary source; some
    # entity types (notably ships via VehicleComponentParams, and a few items)
    # carry the key under a differently-named field. We fall back to a generic
    # deep search so descriptions are populated for every entity type that has
    # one, with NO per-ship special-casing.
    # TODO(phase2-verify): confirm the fallback leaf names against a real P4K.
    _NAME_KEY_FIELDS = ("Name", "name", "localizedName", "displayName",
                        "vehicleName")
    _DESC_KEY_FIELDS = ("Description", "description", "localizedDescription",
                        "displayDescription")

    def _loc_key_from(self, *sources, fields: tuple) -> Optional[str]:
        """First field value that looks like a localization key (a non-empty
        string), searched in order across the given source dicts."""
        for src in sources:
            if not isinstance(src, dict):
                continue
            val = _find_first_key(src, fields)
            if isinstance(val, str) and val and val not in (
                    "@LOC_EMPTY", "@LOC_PLACEHOLDER"):
                return val
        return None

    def _base_entity(self, r: Record, resolved, comps, attach) -> Dict[str, Any]:
        loc = attach.get("Localization") if attach else None
        name_key = loc.get("Name") if isinstance(loc, dict) else None
        desc_key = loc.get("Description") if isinstance(loc, dict) else None
        # Generic fallback: many entity types don't carry the loc key under
        # AttachDef.Localization. Search the AttachDef, then the whole record.
        rv = resolved.get("_RecordValue_", {})
        if not name_key:
            name_key = self._loc_key_from(attach, rv, fields=self._NAME_KEY_FIELDS)
        if not desc_key:
            desc_key = self._loc_key_from(attach, rv, fields=self._DESC_KEY_FIELDS)
        return {
            "className": _strip_type_prefix(r.name),
            "guid": r.guid,
            "type": r.type,
            "recordTag": r.tag,
            "name": self._localized(name_key),
            "description": self._localized(desc_key),
            "manufacturer": self._manufacturer_ref(attach),
            "tags": _tags(attach),
            "iconPath": None,  # raw DDS path deferred; previewImage is the usable art
            "previewImage": self._preview_image(resolved),  # WebP filename or null
            "source": self.source,
        }

    def _project_ship(self, r, resolved, comps, attach) -> Dict[str, Any]:
        base = self._base_entity(r, resolved, comps, attach)
        vcp = _find_component(comps, "VehicleComponentParams") or {}
        skins = self._skin_catalog(base["className"], comps)
        self._skins_total += len(skins)
        base.update({
            "entityKind": "ship",
            "role": vcp.get("vehicleRole"),
            "crew": {"size": vcp.get("crewSize")},
            "vehicleName": self._localized(vcp.get("vehicleName")),
            # real-world bounding-box dimensions (metres) parsed from the .cga mesh
            "dimensions": self._dimensions(comps),
            # flight stats: resolved generically from the IFCS / vehicle
            # flight-controller struct wherever it sits in the resolved graph.
            "flight": self._flight_stats(resolved, comps),
            "itemPorts": self._item_ports(comps),
            "defaultLoadout": self._default_loadout(comps),
            # liveries (paint skins) as a sub-property of the ship — catalog only
            # (names + icons); the 3D glb build is a separate cached step.
            "skins": skins,
        })
        return base

    # ── flight stats (generic) ──────────────────────────────────────────────────
    # Leaf field names on the IFCS / SCItemFlightControllerParams / vehicle
    # flight structs. The carrying struct differs by ship type and is often a
    # strong-pointer'd sub-component (IFCSParams=234, SCItemFlightControllerParams
    # =234 in the live schema), so we search by LEAF name across the whole
    # resolved graph, not by a fixed container. No per-ship special-casing — the
    # same candidate list runs for every vehicle.
    #
    # TODO(phase2-verify): confirm these leaf names against a real Data.p4k. SC
    # IFCS has renamed these across patches; the candidate lists cover the names
    # seen in StarBreaker/scdatatools dumps and erkul's data model. Any field
    # whose source key is absent stays None (documented-null, never guessed).
    _FLIGHT_FIELDS = {
        "scmSpeed": ("scmSpeed", "ScmSpeed", "maxSpeedSCM", "MaxSCMSpeed",
                     "scmCruiseSpeed"),
        "maxSpeed": ("maxSpeed", "MaxSpeed", "afterburnSpeed", "boostSpeedForward",
                     "maxSpeedNAV"),
        "boostSpeed": ("boostSpeed", "BoostSpeed", "boostSpeedForward",
                       "afterburnSpeedForward"),
        "pitch": ("maxAngularVelocityX", "pitchRate", "maxPitchRate",
                  "angularVelocityPitch"),
        "yaw": ("maxAngularVelocityZ", "yawRate", "maxYawRate",
                "angularVelocityYaw"),
        "roll": ("maxAngularVelocityY", "rollRate", "maxRollRate",
                 "angularVelocityRoll"),
    }

    def _flight_stats(self, resolved: Dict[str, Any], comps) -> Dict[str, Any]:
        """Best-effort flight characteristics, generic over all ship types.

        Returns the contract's flight block; any field whose source key is not
        present resolves to ``None``. Searches the full resolved record graph —
        the IFCS struct is frequently nested under a strong-pointer'd
        flight-controller component, not at the entity top level.
        """
        rv = resolved.get("_RecordValue_", {})
        return {
            out_key: _to_float(_find_first_key(rv, candidates))
            for out_key, candidates in self._FLIGHT_FIELDS.items()
        }

    def _project_weapon(self, r, resolved, comps, attach, atype) -> Dict[str, Any]:
        base = self._base_entity(r, resolved, comps, attach)
        wcp = _find_component(comps, "SCItemWeaponComponentParams") or {}
        base.update({
            "entityKind": "weapon",
            "weaponClass": "FPS" if atype in _FPS_WEAPON_TYPES else "Ship",
            # AttachDef.Type (e.g. WeaponGun/Turret/MissileLauncher) — the key
            # that matches a hardpoint's accepted port `types`. Promoted so the
            # slot-compatibility resolver can match weapons to ports.
            "attachType": atype,
            "subType": attach.get("SubType") if attach else None,
            "size": _to_int(attach.get("Size")) if attach else None,
            "grade": _grade(attach.get("Grade")) if attach else None,
            "weaponParams": self._weapon_params(wcp, resolved),
            "itemPorts": self._item_ports(comps),
        })
        return base

    def _weapon_params(self, wcp: Dict[str, Any],
                       resolved: Dict[str, Any]) -> Dict[str, Any]:
        """Top-level scalars of SCItemWeaponComponentParams PLUS the key combat
        scalars that live nested under fireActions / projectile / ammo params.

        The top-level struct rarely carries fire rate / projectile speed / per
        shot damage directly — those sit on the active fire action and the
        referenced ``AmmoParams``. We surface a small, STABLE derived set
        (generic, identical logic for every weapon) so the UI has fire rate +
        damage without parsing the nested action graph; the raw nested values
        remain in the generic dump.
        """
        params = _scalars(wcp)
        rv = resolved.get("_RecordValue_", {})
        # derived combat scalars — leaf names searched generically.
        # TODO(phase2-verify): confirm leaf names against a real P4K (SC has
        # renamed these; candidate lists cover StarBreaker/erkul observed names).
        derived = {
            "fireRate": _to_float(_find_first_key(
                rv, ("fireRate", "FireRate", "roundsPerMinute", "rpm"))),
            "projectileSpeed": _to_float(_find_first_key(
                rv, ("muzzleVelocity", "projectileSpeed"))),
            "projectilesPerShot": _to_float(_find_first_key(
                rv, ("pelletCount", "projectilesPerShot", "ammoCost"))),
            "heatPerShot": _to_float(_find_first_key(
                rv, ("heatPerShot", "weaponHeatPerShot"))),
        }
        # per-shot damage (6-channel) from the nested projectile/ammo damage block
        dmg = _damage_set_anycase(_find_first_dict_with(
            rv, ("DamagePhysical", "DamageEnergy", "DamageDistortion")))
        if dmg is not None:
            params["impactDamage"] = dmg
        for k, v in derived.items():
            if v is not None and k not in params:
                params[k] = v
        return params

    def _project_component(self, r, resolved, comps, attach, atype) -> Dict[str, Any]:
        base = self._base_entity(r, resolved, comps, attach)
        kind = _COMPONENT_KIND.get(atype, "Other")
        base.update({
            "entityKind": "component",
            "kind": kind,
            "attachType": atype,
            "subType": attach.get("SubType") if attach else None,
            "size": _to_int(attach.get("Size")) if attach else None,
            "grade": _grade(attach.get("Grade")) if attach else None,
            "stats": self._component_stats(comps, kind),
            "itemPorts": self._item_ports(comps),
        })
        return base

    def _project_item(self, r, resolved, comps, attach, atype) -> Dict[str, Any]:
        base = self._base_entity(r, resolved, comps, attach)
        base.update({
            "entityKind": "item",
            "attachType": atype,
            "subType": attach.get("SubType") if attach else None,
            "size": _to_int(attach.get("Size")) if attach else None,
            "grade": _grade(attach.get("Grade")) if attach else None,
        })
        return base

    # Component params structs are not the same vocabulary as AttachDef.Type;
    # discovered live (e.g. SCItemShieldGeneratorParams, SCItemQuantumDriveParams,
    # EntityComponentPowerConnection, SCItemPurchasableParams ...). Rather than
    # hardcode a brittle per-kind list, we capture the scalars of EVERY
    # non-structural "*Params" component so no stat is dropped — the typed
    # consumer picks the struct it needs by name. (The generic dump still holds
    # the fully-nested version.)
    _SKIP_COMPONENT_STATS = {
        "SAttachableComponentParams", "SGeometryResourceParams",
        "SEntityComponentDefaultLoadoutParams", "SItemPortContainerComponentParams",
        "SEntityAudioControllerParams", "SAudioProxyParams",
    }

    def _component_stats(self, comps, kind) -> Dict[str, Any]:
        """Stats of every params-bearing component, keyed by struct name.

        Captures the component's own top-level scalars AND scalars one level
        down inside nested sub-structs (flattened as ``Sub.field``). Many live
        component params nest their numbers one struct deep (e.g. a Shield's
        regen/health under a face/stage sub-struct, a QuantumDrive's params under
        an inner struct), so a top-level-only scan returned empty maps. We stop
        at depth 2 to avoid pulling in the entire nested graph (that lives in the
        generic dump). Structural/audio/geometry components are skipped.
        """
        stats: Dict[str, Any] = {}
        for c in comps:
            t = c.get("_Type_")
            if not t or t in self._SKIP_COMPONENT_STATS:
                continue
            flat = _scalars(c)
            # pull scalars from immediate child structs too (one level deep)
            for k, v in c.items():
                if not isinstance(k, str) or k.startswith("_"):
                    continue
                if isinstance(v, dict):
                    for sk, sv in _scalars(v).items():
                        flat.setdefault(f"{k}.{sk}", sv)
            if flat:  # only components that actually carry scalar values
                stats[t] = flat
        return stats

    def _item_ports(self, comps) -> List[Dict[str, Any]]:
        ipc = _find_component(comps, "SItemPortContainerComponentParams")
        if not ipc:
            return []
        ports = ipc.get("Ports")
        if not isinstance(ports, list):
            return []
        out = []
        for p in ports:
            if not isinstance(p, dict):
                continue
            out.append({
                "portName": p.get("Name") or p.get("name"),
                "minSize": _to_int(p.get("MinSize")),
                "maxSize": _to_int(p.get("MaxSize")),
                "types": _port_types(p),
                "flags": _as_list(p.get("Flags")),
            })
        return out

    def _default_loadout(self, comps) -> List[Dict[str, Any]]:
        dl = _find_component(comps, "SEntityComponentDefaultLoadoutParams")
        if not dl:
            return []
        loadout = dl.get("loadout")
        entries = loadout.get("entries") if isinstance(loadout, dict) else None
        if not isinstance(entries, list):
            return []
        out = []
        for e in entries:
            if not isinstance(e, dict):
                continue
            out.append({
                "itemPortName": e.get("itemPortName"),
                "entityClassName": e.get("entityClassName") or None,
            })
        return out

    # ── exhaustive generic dump ─────────────────────────────────────────────────
    def dump_all_records(self) -> None:
        base = self.out / "records"
        base.mkdir(parents=True, exist_ok=True)
        per_type = Counter()
        total = 0
        n_fail = 0
        n_types = len(self.df.record_types)
        # Denominator for the progress line: every record of every type is
        # written here, so the full record count IS the goal (known up front).
        total_records = len(self.df.records)
        for ti, t in enumerate(sorted(self.df.record_types)):
            tdir = base / _safe_filename(t)
            tdir.mkdir(exist_ok=True)
            recs = self.df.records_by_type_name(t)
            for r in recs:
                try:
                    resolved = self.df.record_to_dict(r, max_depth=24)
                except Exception as exc:  # noqa: BLE001 — never let one record abort the dump
                    resolved = {"_error_": str(exc), "_RecordId_": r.guid,
                                "_RecordName_": r.name}
                    self.on_log("warn", f"record_to_dict failed for {r.name}: {exc}")
                # Keep the GUID suffix (guarantees uniqueness) but cap the name
                # so the full path can't exceed Windows MAX_PATH (260) and abort
                # the whole dump. The write itself is guarded too: a single
                # unwritable record (long path, locked file) must never kill the
                # exhaustive dump — that previously aborted the entire run.
                stem = _safe_filename(_strip_type_prefix(r.name))[:96]
                fname = f"{stem}__{r.guid[:8]}.json"
                try:
                    tdir.joinpath(fname).write_text(
                        json.dumps(resolved, ensure_ascii=False), encoding="utf-8")
                except OSError as exc:  # noqa: BLE001 — skip, never abort the dump
                    n_fail += 1
                    self.on_log("warn", f"write failed for {fname}: {exc}")
                    continue
                per_type[t] += 1
                total += 1
            if ti % 25 == 0:
                # Tick the live records counter + advance the bar against the
                # known total record count; `detail` names the type in flight.
                self.on_count("records_total", total)
                self.on_progress("records", current=total, total=total_records,
                                 pct=_mapped_pct(total, total_records, *_PCT_RECORDS),
                                 detail=_strip_type_prefix(t))
        self.on_progress("records", current=total, total=total_records, pct=_PCT_RECORDS[1])
        self.on_log("info", f"generic dump: {total:,} records across {n_types} types")
        if n_fail:
            # Surface systemic write failures (disk full, permission, locked dir)
            # rather than hiding them behind per-record warns — a large count here
            # means the dump is materially incomplete even though it did not abort.
            lvl = "error" if n_fail > 50 else "warn"
            self.on_log(lvl, f"generic dump: {n_fail} record(s) unwritable "
                             f"(skipped — long path / locked / disk)")
        self._bump("records_total", total)
        # write an index of per-type counts
        (base / "_index.json").write_text(
            json.dumps({"per_type": dict(per_type.most_common()),
                        "total": total, "n_types": n_types},
                       ensure_ascii=False, indent=2), encoding="utf-8")

    def _bump(self, key: str, n: int) -> None:
        self.counts[key] = n
        self.on_count(key, n)


# ── value helpers ─────────────────────────────────────────────────────────────
def _scalars(d: Dict[str, Any]) -> Dict[str, Any]:
    """Flat scalar fields of a resolved struct (drops nested for typed view)."""
    return {k: v for k, v in d.items()
            if k != "_Type_" and not isinstance(v, (dict, list))}


def _dig(d: Any, *keys) -> Any:
    for k in keys:
        if isinstance(d, dict):
            d = d.get(k)
        else:
            return None
    return d


def _damage_set(d: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(d, dict):
        return None
    keys = ("DamagePhysical", "DamageEnergy", "DamageDistortion",
            "DamageThermal", "DamageBiochemical", "DamageStun")
    if any(k in d for k in keys):
        return {
            "physical": d.get("DamagePhysical"),
            "energy": d.get("DamageEnergy"),
            "distortion": d.get("DamageDistortion"),
            "thermal": d.get("DamageThermal"),
            "biochemical": d.get("DamageBiochemical"),
            "stun": d.get("DamageStun"),
        }
    return None


def _to_int(v: Any) -> Optional[int]:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _grade(v: Any) -> Optional[str]:
    i = _to_int(v)
    if i is None:
        return None
    return {1: "A", 2: "B", 3: "C", 4: "D"}.get(i, str(i))


def _tags(attach: Optional[Dict[str, Any]]) -> List[str]:
    if not attach:
        return []
    tags = attach.get("Tags")
    if isinstance(tags, list):
        return [str(t) for t in tags if not isinstance(t, (dict, list))]
    return []


def _port_types(p: Dict[str, Any]) -> List[str]:
    types = p.get("Types") or p.get("types")
    out = []
    if isinstance(types, list):
        for t in types:
            if isinstance(t, dict):
                v = t.get("Type") or t.get("type")
                if v:
                    out.append(str(v))
            elif t is not None:
                out.append(str(t))
    return out


def _as_list(v: Any) -> List[str]:
    if isinstance(v, list):
        return [str(x) for x in v if not isinstance(x, (dict, list))]
    return []


# ── generic deep helpers (no per-ship special-casing) ──────────────────────────
def _to_float(v: Any) -> Optional[float]:
    """Coerce to float, tolerating numeric strings; None on failure."""
    if isinstance(v, bool):  # bool is an int subclass — exclude
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip())
        except (TypeError, ValueError):
            return None
    return None


def _find_first_key(node: Any, names: tuple, _depth: int = 0,
                    _max_depth: int = 24) -> Any:
    """Depth-first search for the first scalar value under any of ``names``.

    Generic over the whole resolved object graph. Used to locate fields whose
    *container struct* name varies between entity types but whose *leaf field*
    name is stable (e.g. ``scmSpeed`` may sit on different IFCS structs across
    ship classes). Case-insensitive on keys. Skips DataForge metadata keys.
    """
    if _depth > _max_depth:
        return None
    lowered = {n.lower() for n in names}
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(k, str) and k.lower() in lowered and not isinstance(v, (dict, list)):
                return v
        for k, v in node.items():
            if isinstance(k, str) and k.startswith("_") and k.endswith("_"):
                continue  # _Type_, _RecordId_, … — never a stat
            found = _find_first_key(v, names, _depth + 1, _max_depth)
            if found is not None:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _find_first_key(item, names, _depth + 1, _max_depth)
            if found is not None:
                return found
    return None


def _find_first_dict_with(node: Any, required_keys: tuple, _depth: int = 0,
                          _max_depth: int = 24) -> Optional[Dict[str, Any]]:
    """DFS for the first dict that contains ANY of ``required_keys`` directly.

    Returns the containing dict so callers can read several sibling fields off
    one struct (e.g. the damage block carrying all six damage channels).
    """
    if _depth > _max_depth:
        return None
    lowered = {k.lower() for k in required_keys}
    if isinstance(node, dict):
        if any(isinstance(k, str) and k.lower() in lowered for k in node.keys()):
            return node
        for k, v in node.items():
            if isinstance(k, str) and k.startswith("_") and k.endswith("_"):
                continue
            found = _find_first_dict_with(v, required_keys, _depth + 1, _max_depth)
            if found is not None:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _find_first_dict_with(item, required_keys, _depth + 1, _max_depth)
            if found is not None:
                return found
    return None


def _find_geometry_path(node: Any, _depth: int = 0, _max_depth: int = 12) -> Optional[str]:
    """DFS for the first ``.cga``/``.cgf`` mesh path string anywhere in ``node``."""
    if _depth > _max_depth:
        return None
    if isinstance(node, str):
        return node if node.lower().endswith((".cga", ".cgf")) else None
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(k, str) and k.startswith("_") and k.endswith("_"):
                continue
            found = _find_geometry_path(v, _depth + 1, _max_depth)
            if found:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _find_geometry_path(item, _depth + 1, _max_depth)
            if found:
                return found
    return None


def _damage_set_anycase(d: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Build a 6-channel DamageSet from a struct using case-insensitive keys.

    The live ``DamageInfo`` struct uses keys like ``DamagePhysical`` but casing
    has varied across patches; match case-insensitively and on the bare channel
    name (``Physical``) as a fallback.
    """
    if not isinstance(d, dict):
        return None
    ci = {k.lower(): v for k, v in d.items() if isinstance(k, str)}

    def pick(channel: str) -> Any:
        return ci.get(f"damage{channel}") or ci.get(channel)

    channels = ("physical", "energy", "distortion", "thermal",
                "biochemical", "stun")
    out = {c: pick(c) for c in channels}
    if any(v is not None for v in out.values()):
        return out
    return None
