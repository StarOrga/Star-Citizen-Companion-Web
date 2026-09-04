"""Real DataCore extraction: generic exhaustive dump + typed projections.

Consumes a parsed :class:`sc_extract.dataforge.DataForge` (our pure-Python v8
reader) plus localization tables, and writes:

  * ``records/<Type>/*.json`` — EVERY record of EVERY type, fully resolved via
    ``record_to_dict``. This is the "alle Werte von allen Spielelementen"
    guarantee: nothing is dropped, unknown types included.
  * ``ships/``, ``weapons/``, ``components/``, ``ammunition/``,
    ``manufacturers/`` — typed projections matching the domain model
    (docs/concepts/codex-research.md §5), streamed one JSON file per entity.

Classification is driven by the live data: vehicles by their
``libs/foundry/records/entities/{spaceships,groundvehicles,vehicles}/`` record
path OR by carrying ``VehicleComponentParams`` (see ``_VEHICLE_ROOT_RE`` — a
spaceships-only prefix used to drop every ground vehicle), items by their
``SAttachableComponentParams.AttachDef.Type`` (vocabulary discovered from the
live datacore — see datacore_schema.json), with an ``Other`` catch-all so
nothing is silently dropped.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

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

# Output item ref field names (the thing you craft). `entityClass` is the
# VERIFIED live name, found on blueprint.processSpecificData (struct
# CraftingProcess_Creation); the rest are the older hypotheses, kept as
# fallbacks in case the layout changes again.
_BP_OUTPUT_FIELDS = ("entityClass", "outputItem", "output", "result",
                     "craftingResult", "item", "resultItem")

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

# AttachDef.Type values that denote personal (FPS) armor / clothing pieces.
# These carry SCItemSuitArmorParams / SCItemClothingParams stat blocks that the
# generic _component_stats() dump surfaces without per-field foreknowledge.
_ARMOR_TYPES = {
    "Char_Armor_Helmet", "Char_Armor_Torso", "Char_Armor_Arms",
    "Char_Armor_Legs", "Char_Armor_Undersuit", "Char_Armor_Backpack",
}

# ── vehicle classification ────────────────────────────────────────────────────
# A vehicle used to be "an entity whose record file sits under
# libs/foundry/records/entities/spaceships/". That single prefix silently
# dropped every GROUND vehicle: the live datacore keeps them in a SIBLING
# directory (entities/groundvehicles, 40 records against 920 spaceships), so the
# URSA, the whole Cyclone family, Storm, Nova, ROC, PTV/STV/UTV/MTC/MDC, ATLS,
# Ballista, Mule, Dragonfly, Nox and X1 never reached the `ships/` projection and
# therefore never reached codex_ships. Downstream that looked like a completely
# different bug — the RSI diff reported them as "flight-ready but missing", i.e.
# ships the app knows nothing about and consequently has no artwork for.
#
# Two signals now, so a future directory rename cannot repeat this:
#   1. the known vehicle roots (fast path, no record resolve needed), and
#   2. VehicleComponentParams on the resolved record — the component that MAKES
#      an entity a vehicle, wherever CIG decides to file it.
_VEHICLE_ROOT_RE = re.compile(
    r"libs/foundry/records/entities/(?:spaceships|groundvehicles|vehicles)/"
)
# The component every drivable/flyable entity carries. Used as the data-driven
# fallback for records filed outside the known roots.
_VEHICLE_COMPONENT = "VehicleComponentParams"

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


# ── default loadout ───────────────────────────────────────────────────────────
# A ship's stock fit lives in SEntityComponentDefaultLoadoutParams.loadout, an
# SItemPortLoadout*Params whose `entries` are SItemPortLoadoutEntryParams. Each
# entry names its item in ONE OF TWO ways — verified against the LIVE 4.9.0
# Data/Game2.dcb over all 314 catalog ships:
#
#   * `entityClassName`  — a bare class-name string (13 346 top-level entries)
#   * `entityClassReference` — a record reference to the item's
#     EntityClassDefinition, with `entityClassName` left as "" (10 972 top-level
#     entries; all 16 859 references in the whole ship set point at an
#     EntityClassDefinition, so `_RecordName_` minus its type prefix IS the
#     class name the codex keys on)
#
# Reading only the first form is what made ship armament look absent: the Nomad
# names every thruster and its missile racks by string, but its three gun mounts
# — and the guns inside them — only by reference.
#
# Entries also NEST: `entry.loadout` is another loadout node holding the
# sub-items of the item just installed. That is where a gun mount's actual gun
# lives (`hardpoint_weapon_top_left` → Mount_Gimbal_S3 → `hardpoint_class_2` →
# KLWE_LaserRepeater_S3), as do a missile rack's missiles and a turret's weapon.
# Measured nesting depth is 2 (10 209 sub-entries across the catalog); the cap
# below is slack against a future deeper tree and against a malformed cycle.
_LOADOUT_MAX_DEPTH = 8


def _loadout_class_name(entry: Dict[str, Any]) -> Optional[str]:
    """The class name an ``SItemPortLoadoutEntryParams`` installs, or None.

    Prefers the literal ``entityClassName``; falls back to the record reference
    the same entry may carry instead. Returns None only when the port really is
    stock-empty — never a guessed or derived name.
    """
    name = entry.get("entityClassName")
    if isinstance(name, str) and name.strip():
        return name.strip()
    ref = entry.get("entityClassReference")
    if isinstance(ref, dict):
        raw = ref.get("_RecordName_")
        if isinstance(raw, str) and raw.strip():
            return _strip_type_prefix(raw.strip()) or None
    return None


def _loadout_entries(loadout: Any, _depth: int = 0) -> List[Dict[str, Any]]:
    """``[{itemPortName, entityClassName, entries?}]`` for one loadout node.

    ``entries`` is present only when the installed item brings its own sub-items,
    so the flat top-level shape older consumers read is unchanged.
    """
    if not isinstance(loadout, dict) or _depth > _LOADOUT_MAX_DEPTH:
        return []
    entries = loadout.get("entries")
    if not isinstance(entries, list):
        return []
    out: List[Dict[str, Any]] = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        item: Dict[str, Any] = {
            "itemPortName": e.get("itemPortName"),
            "entityClassName": _loadout_class_name(e),
        }
        children = _loadout_entries(e.get("loadout"), _depth + 1)
        if children:
            item["entries"] = children
        out.append(item)
    return out


def _loadout_pairs(entries: Any, _depth: int = 0) -> List[Tuple[str, str]]:
    """``(itemPortName, entityClassName)`` of a resolved loadout, nested
    entries included (a cargo pod's grid hangs under the pod)."""
    out: List[Tuple[str, str]] = []
    if not isinstance(entries, list) or _depth > _LOADOUT_MAX_DEPTH:
        return out
    for e in entries:
        if not isinstance(e, dict):
            continue
        cls = e.get("entityClassName")
        if isinstance(cls, str) and cls:
            out.append((str(e.get("itemPortName") or ""), cls))
        out.extend(_loadout_pairs(e.get("entries"), _depth + 1))
    return out


def _default_loadout_of(comps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The stock fit of an entity, from its components. Empty when it has none."""
    dl = _find_component(comps, "SEntityComponentDefaultLoadoutParams")
    return _loadout_entries(dl.get("loadout")) if dl else []


class CodexExtractor:
    """Drives the generic dump + typed projections over a DataForge instance."""

    def __init__(self, df: DataForge, localizer: Localizer, out_dir: Path,
                 source: Dict[str, str], on_count: Callable[[str, int], None] = lambda k, v: None,
                 on_log: Callable[[str, str], None] = lambda lvl, m: None,
                 on_progress: Callable[..., None] = lambda *a, **k: None,
                 dump_generic: bool = True, p4k=None, extract_assets: bool = True,
                 workers: int = 1, raw_dcb: Optional[bytes] = None) -> None:
        self.df = df
        self.loc = localizer
        self.out = out_dir
        self.source = source
        # Worker count is handed DOWN from the host, never inferred here — see
        # parallel_dump.worker_count for why os.cpu_count() is the wrong answer.
        # 1 (the default) keeps every caller that predates parallelism serial.
        self.workers = max(1, int(workers))
        # Raw DataCore bytes, kept only so workers can re-parse them from shared
        # memory. None => the parallel path is unavailable and we stay serial.
        self.raw_dcb = raw_dcb
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
        # mesh path -> named helper-node transforms (hardpoint positions). Same
        # .cga as the dimensions, parsed once per hull and shared by variants.
        self._helper_cache: Dict[str, Dict[str, Any]] = {}
        # FlightController class name -> its IFCSParams struct (or None), see
        # _flight_controller_ifcs. One resolve per ship class, not per record.
        self._flight_cache: Dict[str, Optional[Dict[str, Any]]] = {}
        # vehicle implementation XML path -> parsed root element (or None).
        # Ship variants share one file, so this is parsed once per hull.
        self._vehicle_xml_cache: Dict[str, Any] = {}
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

        def _cost_quantity(node: Any) -> Optional[float]:
            """Quantity off a CraftingCost_Resource `quantity` struct.

            VERIFIED shapes: ``SStandardCargoUnit{standardCargoUnits}`` (SCU)
            and ``SMicroCargoUnit{microSCU}``; a bare number is also accepted.
            """
            if isinstance(node, (int, float)) and not isinstance(node, bool):
                return float(node)
            if not isinstance(node, dict):
                return None
            scu = _to_float(node.get("standardCargoUnits"))
            if scu is not None:
                return scu
            micro = _to_float(node.get("microSCU"))
            if micro is not None:
                return micro / 1_000_000.0
            return _to_float(_pick(node, _BP_QTY_FIELDS))

        def _walk_costs(node: Any, slot: Optional[str], out: List[Dict[str, Any]],
                        depth: int = 0) -> None:
            """Collect CraftingCost_Resource leaves out of a cost tree.

            VERIFIED live structure (SC 4.x): a recipe's ``mandatoryCost`` is a
            ``CraftingCost_Select`` whose ``options`` hold either further
            ``CraftingCost_Select`` nodes (recipe slots, named via
            ``nameInfo.debugName`` / ``nameInfo.displayName``) or the
            ``CraftingCost_Resource`` leaves that name the actual material
            (``resource`` → ``ResourceType.<Material>``) plus ``quantity`` and
            ``minQuality``. Recursion is depth-capped so a cyclic/degenerate
            tree can never hang an extract.
            """
            if depth > 8 or not isinstance(node, dict):
                return
            struct = str(node.get("_Type_") or "")
            info = node.get("nameInfo")
            if isinstance(info, dict):
                label = info.get("debugName") or info.get("displayName")
                if isinstance(label, str) and label:
                    slot = label
            if struct == "CraftingCost_Resource" or "resource" in node:
                ref = _ref_stub(node.get("resource"))
                if ref["className"] or ref["guid"]:
                    out.append({
                        "className": ref["className"],
                        "guid": ref["guid"],
                        "name": None,
                        "quantity": _cost_quantity(node.get("quantity")),
                        "minQuality": _to_float(node.get("minQuality")),
                        "role": slot,
                        "raw": node,
                    })
                return
            for child in (node.get("options") or []):
                _walk_costs(child, slot, out, depth + 1)

        def _verified_ingredients(bp: Dict[str, Any]) -> List[Dict[str, Any]]:
            """Ingredients off the VERIFIED tiers[].recipe.costs cost tree."""
            out: List[Dict[str, Any]] = []
            tiers = bp.get("tiers")
            if not isinstance(tiers, list):
                return out
            for tier in tiers:
                if not isinstance(tier, dict):
                    continue
                recipe = tier.get("recipe")
                costs = recipe.get("costs") if isinstance(recipe, dict) else None
                if not isinstance(costs, dict):
                    continue
                _walk_costs(costs.get("mandatoryCost"), None, out)
                for opt in (costs.get("optionalCosts") or []):
                    _walk_costs(opt, None, out)
            return out

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
            # VERIFIED live: a CraftingBlueprintRecord carries EVERYTHING under a
            # single `blueprint` node (`CraftingBlueprint` for fabrication,
            # `GenericCraftingBlueprint` for the global dismantle record) —
            # category / blueprintName / processSpecificData / tiers all live
            # there, not at the record top level. This code read the top level
            # only, so category, output class and ingredients came back null for
            # every one of the 1595 live blueprints. Search the inner node first,
            # then fall back to the top level so an older layout still resolves.
            bp_node = rv.get("blueprint") if isinstance(rv.get("blueprint"), dict) else {}

            def _pick2(fields: tuple) -> Any:
                """First candidate hit in the blueprint node, then the record."""
                return _pick(bp_node, fields) if _pick(bp_node, fields) is not None \
                    else _pick(rv, fields)

            # name / description localization keys
            name_key = (_pick2(_BP_NAME_FIELDS)
                        or _pick(rv.get("Localization") if isinstance(
                            rv.get("Localization"), dict) else {}, _BP_NAME_FIELDS))
            desc_key = (_pick2(_BP_DESC_FIELDS)
                        or _pick(rv.get("Localization") if isinstance(
                            rv.get("Localization"), dict) else {}, _BP_DESC_FIELDS))

            # category ref → className string + localized label (§6)
            cat_node = _pick2(_BP_CATEGORY_FIELDS)
            category = None
            category_label = None
            if isinstance(cat_node, dict):
                category = _ref_stub(cat_node)["className"]
                cat_name_key = _pick(cat_node, _BP_NAME_FIELDS)
                category_label = (self._localized(cat_name_key)
                                  if isinstance(cat_name_key, str) else None)
            elif isinstance(cat_node, str):
                category = cat_node

            # output item ref(s) → outputs[] array (§6).
            # VERIFIED: the crafted entity is
            # blueprint.processSpecificData.entityClass (struct
            # CraftingProcess_Creation) — checked before the older candidates.
            psd = bp_node.get("processSpecificData")
            out_node = _pick(psd, _BP_OUTPUT_FIELDS) if isinstance(psd, dict) else None
            if out_node is None:
                out_node = _pick2(_BP_OUTPUT_FIELDS)
            output_qty = _to_float(_pick2(_BP_OUTPUT_QTY_FIELDS))
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

            # craft / dismantle times + dismantle efficiency.
            # VERIFIED: fabrication = CraftingProcess_Creation with the craft time
            # on tiers[].recipe.costs.craftTime (TimeValue_Partitioned, BARE field
            # names days/hours/minutes/seconds — no '@' prefix); dismantle =
            # GenericCraftingProcess_Dismantle with efficiency + dismantleTime
            # inline. Dismantle is still identified by "_Type_" containing
            # "dismantle"; everything else is fabrication.
            craft_time: Optional[float] = None
            dismantle_time: Optional[float] = None
            dismantle_eff: Optional[float] = None
            proc_data = (bp_node.get("processSpecificData")
                         or rv.get("processSpecificData")
                         or rv.get("processData") or [])
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
                craft_time = _craft_time(bp_node) or _craft_time(rv)

            # ingredients (flattened into codex_blueprint_ingredients rows by the
            # uploader). VERIFIED cost tree first, legacy candidate-field scan as
            # the fallback.
            dangling: list = []
            ingredients = _verified_ingredients(bp_node)
            if not ingredients:
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
        # Vehicles the path roots missed and only VehicleComponentParams caught —
        # logged so a directory rename shows up as a number instead of silently
        # shrinking the ship catalog again.
        n_offroot = 0
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
            resolved = self.df.record_to_dict(r, max_depth=20)
            comps = _components_of(resolved)
            attach = _attach_def(comps)
            atype = attach.get("Type") if attach else None
            # Path first (cheap, covers 99%), then the component signal for a
            # vehicle filed outside the known roots. See _VEHICLE_ROOT_RE.
            is_ship = bool(_VEHICLE_ROOT_RE.search(fn))
            if not is_ship and _find_component(comps, _VEHICLE_COMPONENT) is not None:
                is_ship = True
                n_offroot += 1

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
                # any other attachable item — generic item projection. Personal
                # armor/clothing pieces additionally carry a generic stat block
                # (SCItemSuitArmorParams / SCItemClothingParams via _component_stats).
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
        if n_offroot:
            self.on_log("warn", f"ships: {n_offroot} vehicle(s) matched only by "
                                f"{_VEHICLE_COMPONENT} — outside the known entity "
                                f"roots; check whether CIG moved a directory")
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

    def _helper_nodes(self, comps) -> Dict[str, Dict[str, Any]]:
        """Named node transforms of this entity's hull mesh (cached per mesh).

        Same ``.cga`` the dimensions come from, so hardpoint positions and the
        bounding box share one coordinate space. Cached by mesh path because
        variants of a ship reuse the same hull, and each parse walks a few
        hundred node records. Best-effort: any failure means "no positions",
        never an aborted ship.
        """
        if self.p4k is None:
            return {}
        from .geometry import helpers_from_cga_bytes
        key = self._hull_path(comps)
        if not key:
            return {}
        cached = self._helper_cache.get(key)
        if cached is not None:
            return cached
        helpers: Dict[str, Dict[str, Any]] = {}
        try:
            if not hasattr(self, "_p4k_lower"):
                self._p4k_lower = {n.lower(): n for n in self.p4k.namelist()}
            entry = self._p4k_lower.get(key.lower())
            if entry:
                with self.p4k.open(self.p4k.getinfo(entry)) as f:
                    helpers = helpers_from_cga_bytes(f.read())
        except Exception as exc:  # noqa: BLE001 — best-effort, never abort a ship
            self.on_log("warn", f"helper nodes failed for {key}: {exc}")
            helpers = {}
        self._helper_cache[key] = helpers
        return helpers

    def _hardpoint_positions(
        self, comps, item_ports: List[Dict[str, Any]],
        loadout: List[Dict[str, Any]], dims: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """``{transforms, frame}`` — where each of this ship's ports sits on the hull.

        Joins the projected item ports + default-loadout port names against the
        hull mesh's helper nodes (see :mod:`sc_extract.hardpoints`). Ships only:
        every lookup costs one mesh parse, and the hull is the only mesh whose
        hardpoint layout a player reads. Returns empty dicts when the mesh has no
        readable node table — the consumer then shows no positions at all rather
        than approximations.
        """
        from .hardpoints import hardpoint_frame, resolve_hardpoint_transforms
        helpers = self._helper_nodes(comps)
        if not helpers:
            return {"transforms": {}, "frame": None}
        transforms = resolve_hardpoint_transforms(
            helpers,
            item_ports=item_ports,
            loadout_port_names=[e.get("itemPortName") for e in loadout],
        )
        if not transforms:
            return {"transforms": {}, "frame": None}
        frame = hardpoint_frame([t["position"] for t in transforms.values()], dims)
        return {"transforms": transforms, "frame": frame}

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

    # Struct names whitelisted for the ship-level `stats` block. Deliberately an
    # allowlist, NOT the item/component blacklist (_SKIP_COMPONENT_STATS) — a
    # ship's Components list is much larger and noisier than a weapon/item's
    # (dozens of entries: every hardpoint's default-loadout stub, geometry,
    # audio…), so dumping "everything not skipped" here would balloon every
    # ship payload for little value. Extend this set deliberately, one struct
    # at a time, as new ship-level stat needs arise (PR A: signature only).
    _SHIP_STATS_WHITELIST = {"SSCSignatureSystemParams"}

    def _ship_stats(self, comps) -> Dict[str, Any]:
        """Whitelist-only stats block for ships, same struct-keyed shape as
        `_component_stats()` (one level of nested-struct flattening as
        `Sub.field`). Ships get no `stats` key at all when the whitelist finds
        nothing — never an empty object."""
        stats: Dict[str, Any] = {}
        for c in comps:
            t = c.get("_Type_")
            if t not in self._SHIP_STATS_WHITELIST:
                continue
            flat = _flatten_depth2(c)
            if t == "SSCSignatureSystemParams":
                self._add_cross_section(c, flat)
            if flat:
                stats[t] = flat
        return stats

    def _add_cross_section(self, sig_params: Dict[str, Any],
                            flat: Dict[str, Any]) -> None:
        """Targeted (depth-3) pull of the radar cross-section Vec3.

        VERIFIED against the live Nomad: `SSCSignatureSystemParams` carries no
        scalar IR/EM fields at all — the only real signature value is
        `radarProperties.crossSectionParams.crossSection` (a Vec3), one level
        deeper than the generic 1-level flatten above reaches. This does NOT
        deepen that generic flatten (which would pull in unrelated noise from
        every other nested struct) — it reaches for exactly this one known
        path and emits `crossSection.x/y/z` only when the axis value is
        present and finite. No invented defaults.
        """
        cross = _dig(sig_params, "radarProperties", "crossSectionParams", "crossSection")
        if not isinstance(cross, dict):
            return
        for axis in ("x", "y", "z"):
            val = _to_float(cross.get(axis))
            if val is not None and math.isfinite(val):
                flat[f"crossSection.{axis}"] = val

    def _project_ship(self, r, resolved, comps, attach) -> Dict[str, Any]:
        base = self._base_entity(r, resolved, comps, attach)
        vcp = _find_component(comps, "VehicleComponentParams") or {}
        skins = self._skin_catalog(base["className"], comps)
        self._skins_total += len(skins)
        dims = self._dimensions(comps)
        item_ports = self._item_ports(comps)
        loadout = self._default_loadout(comps)
        # WHERE each port sits on the hull, from the mesh's helper nodes. Filled
        # in on the ports themselves (so the codex_item_ports rows carry it) and
        # as one ship-level map, because a ship's weapon/shield mounts usually
        # appear only as default-loadout port names, not as item ports.
        hp = self._hardpoint_positions(comps, item_ports, loadout, dims)
        transforms = hp["transforms"]
        for port in item_ports:
            t = transforms.get(port.get("portName"))
            if t:
                port["helperName"] = t["helper"]
                port["position"] = t["position"]
                port["rotation"] = t["rotation"]
        base.update({
            "entityKind": "ship",
            "role": vcp.get("vehicleRole"),
            # Career (`@vehicle_focus_*`) sits next to the role
            # (`@vehicle_class_*`) on the same struct; both are localisation
            # keys, resolved by the consumer through the locale tables.
            "career": vcp.get("vehicleCareer"),
            "crew": {"size": vcp.get("crewSize")},
            "vehicleName": self._localized(vcp.get("vehicleName")),
            # real-world bounding-box dimensions (metres) parsed from the .cga mesh
            "dimensions": dims,
            # flight stats: the ship's OWN Components never carry them — they
            # live on the FlightController ITEM entity referenced from the
            # default loadout (see _flight_stats docstring).
            "flight": self._flight_stats(loadout),
            # hull hitpoints + hull mass from the vehicle implementation XML,
            # armour HP from the ARMR_<Ship> item, cargo capacity from the
            # cargo grid's inventory container. Each stays None when its
            # source is absent - never a guess, never a 0.
            "hull": self._hull_stats(vcp, base["className"]),
            "armorHp": self._armor_hp(base["className"]),
            "cargoScu": self._cargo_scu(loadout),
            "itemPorts": item_ports,
            "defaultLoadout": loadout,
            # portName -> {position, rotation, helper, source}; model-space metres
            # in CryEngine axes (+X right, +Y nose, +Z up) — see hardpoints.py.
            "hardpointTransforms": transforms,
            # The box those positions live in, so a consumer can normalise them
            # without knowing the hull. None when no position resolved.
            "hardpointFrame": hp["frame"],
            # liveries (paint skins) as a sub-property of the ship — catalog only
            # (names + icons); the 3D glb build is a separate cached step.
            "skins": skins,
        })
        ship_stats = self._ship_stats(comps)
        if ship_stats:
            base["stats"] = ship_stats
        return base

    def _entity_class(self, class_name: str) -> Optional[Record]:
        """Record for a bare entity class name (no ``EntityClassDefinition.``
        prefix), case-insensitive. The index is built once per run and shared
        by the flight-controller, armour and cargo hops."""
        if not class_name:
            return None
        if not hasattr(self, "_ecd_by_name"):
            self._ecd_by_name = {
                rec.name.split(".", 1)[1].lower(): rec
                for rec in self.df.records_by_type_name("EntityClassDefinition")
                if "." in rec.name
            }
        return self._ecd_by_name.get(class_name.lower())

    def _entity_class_comps(self, class_name: str) -> List[Dict[str, Any]]:
        """Resolved Components of an entity class, ``[]`` when unresolvable."""
        rec = self._entity_class(class_name)
        if rec is None:
            return []
        try:
            d = self.df.record_to_dict(rec, max_depth=10)
        except Exception as exc:  # noqa: BLE001 — best-effort, never abort a ship
            self.on_log("warn", f"entity resolve failed for {class_name}: {exc}")
            return []
        comps = d.get("_RecordValue_", {}).get("Components")
        return comps if isinstance(comps, list) else []

    # ── hull HP / hull mass (vehicle implementation XML) ──────────────────────
    # VERIFIED against LIVE 4.9.0 (probe 2026-09-04, scripts/probe_hull_cargo.py):
    # the DataCore carries NO hull hitpoints at all — they live in the CryXmlB
    # vehicle implementation referenced by
    # `VehicleComponentParams.vehicleDefinition`
    # (Scripts/Entities/Vehicles/Implementations/Xml/<Ship>.xml). Hull HP is the
    # SUM of every `Part@damageMax` (Nomad 9 800 over 11 parts, Gladius 6 110,
    # Freelancer 34 900); hull mass is the ROOT part's `@mass` — usually named
    # after the ship (`Part[@name="CNOU_Nomad"]`), but variants reuse the base
    # hull's XML (Idris-P -> aegs_idris.xml, root part "AEGS_Idris"), so the
    # name match falls back to the first part that carries a mass.
    def _hull_stats(self, vcp: Dict[str, Any],
                    class_name: str) -> Dict[str, Optional[float]]:
        out: Dict[str, Optional[float]] = {"hp": None, "mass": None}
        root = self._vehicle_xml_root(vcp.get("vehicleDefinition"))
        if root is None:
            return out
        total = 0.0
        seen = False
        named_mass: Optional[float] = None
        # Every part carrying a usable mass, with its depth below the XML root,
        # in document order. The VEHICLE ROOT part is the shallowest one; its
        # children (wings, nacelles, doors) sit deeper and are much lighter.
        masses: list = []

        def _walk(node, depth: int) -> None:
            nonlocal total, seen, named_mass
            for part in node:
                if part.tag == "Part":
                    dmg = _to_float(part.get("damageMax"))
                    if dmg is not None and math.isfinite(dmg):
                        total += dmg
                        seen = True
                    mass = _to_float(part.get("mass"))
                    if mass is not None and math.isfinite(mass) and mass > 0:
                        masses.append((depth, mass))
                        if (named_mass is None
                                and (part.get("name") or "").lower() == class_name.lower()):
                            named_mass = mass
                    _walk(part, depth + 1)
                else:
                    _walk(part, depth)

        _walk(root, 0)
        if seen:
            out["hp"] = total

        if named_mass is not None:
            out["mass"] = named_mass
        elif masses:
            # A VARIANT reuses the base hull's XML, so the root part is named
            # after the base ship (Idris-P -> aegs_idris.xml, root "AEGS_Idris")
            # and the class-name match misses. Take the shallowest part — the
            # vehicle root — and, if several share that depth, the HEAVIEST of
            # them. The old "first part that carries a mass" rule silently
            # picked whichever sub-part happened to come first in the file,
            # which on a multi-root XML is a wing, not the hull.
            top = min(d for d, _ in masses)
            candidates = [m for d, m in masses if d == top]
            out["mass"] = max(candidates)
            self.on_log(
                "warn",
                f"hull mass: {class_name} has no part named after its class - "
                f"using the vehicle root part's mass ({out['mass']:g} kg) "
                f"out of {len(masses)} massed part(s)",
            )
        return out

    def _vehicle_xml_root(self, path: Optional[str]):
        """Parsed root element of a vehicle implementation XML, or ``None``.

        Cached per path (ship variants share one implementation file).
        CryXmlB-encoded files are decoded via scdatatools, exactly like the
        keybind profile and the .mtl files the skin pipeline reads.
        """
        if not path or self.p4k is None:
            return None
        key = path.replace("\\", "/").lower()
        if key in self._vehicle_xml_cache:
            return self._vehicle_xml_cache[key]
        root = None
        try:
            import io as _io
            import xml.etree.ElementTree as ET

            if not hasattr(self, "_p4k_by_lower"):
                self._p4k_by_lower = {n.lower().replace("\\", "/"): n
                                      for n in self.p4k.namelist()}
            real = (self._p4k_by_lower.get(key)
                    or self._p4k_by_lower.get("data/" + key))
            if real:
                with self.p4k.open(self.p4k.getinfo(real)) as f:
                    blob = f.read()
                if blob[:7] == b"CryXmlB":
                    from scdatatools.engine.cryxml import etree_from_cryxml_file
                    root = etree_from_cryxml_file(_io.BytesIO(blob)).getroot()
                else:
                    root = ET.fromstring(blob)
            else:
                self.on_log("warn", f"vehicle definition not in P4K: {path}")
        except Exception as exc:  # noqa: BLE001 — best-effort, never abort a ship
            self.on_log("warn", f"vehicle xml parse failed for {path}: {exc}")
            root = None
        self._vehicle_xml_cache[key] = root
        return root

    # ── cargo capacity ────────────────────────────────────────────────────────
    # One SCU is a 1.25 m cube, so capacity = interior volume (m³) / 1.25³.
    # The capacity is NOT on the ship: it sits on the cargo-grid item in the
    # ship's stock loadout, behind `containerParams` -> `interiorDimensions`.
    # `containerParams` is frequently a CROSS-FILE record reference (a
    # `{_RecordId_, _RecordName_}` stub that `record_to_dict` does not inline),
    # hence the explicit `record_by_id` hop.
    _SCU_EDGE_M = 1.25
    _CARGO_CONTAINER_FIELDS = ("containerParams", "inventoryContainer",
                               "container", "cargoContainer")

    def _cargo_scu(self, loadout: List[Dict[str, Any]]) -> Optional[float]:
        """Total stock cargo capacity in SCU, or ``None`` when the ship has no
        cargo grid at all (a fighter must read as "no cargo hold", not 0 SCU)."""
        total = 0.0
        found = False
        for port, cls in _loadout_pairs(loadout):
            if "cargo" not in f"{port} {cls}".lower():
                continue  # cheap gate: never resolve a ship's whole loadout
            volume = self._container_volume(self._entity_class_comps(cls))
            if volume is None:
                continue
            found = True
            total += volume / (self._SCU_EDGE_M ** 3)
        if not found:
            return None
        return round(total, 2)

    def _container_volume(self, comps: List[Dict[str, Any]]) -> Optional[float]:
        """Interior volume (m³) of the first inventory container on an item."""
        for c in comps:
            if not isinstance(c, dict):
                continue
            for field in self._CARGO_CONTAINER_FIELDS:
                params = c.get(field)
                dims = self._interior_dimensions(params)
                if dims is None:
                    continue
                edges = [_to_float(dims.get(a)) for a in ("x", "y", "z")]
                if any(e is None or not math.isfinite(e) or e <= 0 for e in edges):
                    continue
                return edges[0] * edges[1] * edges[2]
        return None

    def _interior_dimensions(self, params: Any) -> Optional[Dict[str, Any]]:
        """`interiorDimensions` off an inline container struct, or off the
        record a cross-file `containerParams` reference points at."""
        if not isinstance(params, dict):
            return None
        dims = params.get("interiorDimensions")
        if isinstance(dims, dict):
            return dims
        guid = params.get("_RecordId_")
        if not isinstance(guid, str) or not guid:
            return None
        try:
            rec = self.df.record_by_id(guid)
            if rec is None:
                return None
            resolved = self.df.record_to_dict(rec, max_depth=6)
        except Exception as exc:  # noqa: BLE001 — best-effort, never abort a ship
            self.on_log("warn", f"container record resolve failed for {guid}: {exc}")
            return None
        value = resolved.get("_RecordValue_", resolved)
        dims = value.get("interiorDimensions") if isinstance(value, dict) else None
        return dims if isinstance(dims, dict) else None

    def _armor_hp(self, class_name: str) -> Optional[float]:
        """Hull-armour hitpoints from the per-hull `ARMR_<Ship>` item's
        `SHealthComponentParams.Health` (VERIFIED: Nomad 2 200, Hammerhead
        25 740). ``None`` when the ship has no armour item."""
        comps = self._entity_class_comps(f"ARMR_{class_name}")
        health = _find_component(comps, "SHealthComponentParams") or {}
        return _to_float(health.get("Health"))

    # ── flight stats (generic) ──────────────────────────────────────────────────
    # VERIFIED against a live Data.p4k (CNOU_Nomad / AEGS_Gladius /
    # MISC_Freelancer, 2026-08-18): a ship's OWN Components list never carries
    # movement data. The FlightController is a separate ITEM entity —
    # "EntityClassDefinition.Controller_Flight_<Ship>" — referenced from the
    # ship's default loadout at itemPortName "hardpoint_controller_flight".
    # THAT entity's Components list carries a struct tagged "IFCSParams" with
    # the actual scm/max/boost speeds and per-axis angular-velocity caps.
    # (VehicleComponentParams.vehicleDefinition — a P4K XML path — was also
    # investigated and does NOT carry these; the vehicle XML only references
    # the FlightController by itemType, never inlines its params.)
    #
    # Angular velocity is a Vec3 in CryEngine axes (+X right, +Y nose, +Z up —
    # see the hardpointTransforms comment elsewhere in this file): rotation
    # AROUND the right axis is pitch, around the nose axis is roll, around the
    # up axis is yaw.
    _IFCS_AXIS_TO_RATE = {"x": "pitch", "y": "roll", "z": "yaw"}

    def _flight_controller_ifcs(self, loadout: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """The IFCSParams struct off this ship's FlightController item, or ``None``.

        Cached by the item's bare class name (e.g. ``Controller_Flight_CNOU_
        Nomad``) since every ship has exactly one, and re-parsing it per skin
        variant would be wasted work. Best-effort: any resolution failure
        yields ``None``, never an aborted ship.
        """
        entry = next(
            (e for e in loadout
             if "controller_flight" in (e.get("itemPortName") or "").lower()),
            None,
        )
        cls = entry.get("entityClassName") if entry else None
        if not cls:
            return None
        if cls in self._flight_cache:
            return self._flight_cache[cls]
        ifcs: Optional[Dict[str, Any]] = None
        try:
            fc_rec = self._entity_class(cls)
            if fc_rec is not None:
                fc = self.df.record_to_dict(fc_rec, max_depth=12)
                fc_comps = fc.get("_RecordValue_", {}).get("Components") or []
                ifcs = next(
                    (c for c in fc_comps
                     if isinstance(c, dict) and c.get("_Type_") == "IFCSParams"),
                    None,
                )
        except Exception as exc:  # noqa: BLE001 — best-effort, never abort a ship
            self.on_log("warn", f"flight controller resolve failed for {cls}: {exc}")
        self._flight_cache[cls] = ifcs
        return ifcs

    def _flight_stats(self, loadout: List[Dict[str, Any]]) -> Dict[str, Any]:
        """The contract's flight block, resolved from the FlightController item.

        Any field whose source key is absent on the resolved IFCSParams struct
        stays ``None`` — never guessed. ``boostSpeed`` is the FORWARD boost
        speed only: the contract has one slot and backward boost (typically
        ~half of forward) is dropped rather than guessed into it.
        """
        out: Dict[str, Any] = {
            "scmSpeed": None, "maxSpeed": None, "boostSpeed": None,
            "pitch": None, "yaw": None, "roll": None,
        }
        ifcs = self._flight_controller_ifcs(loadout)
        if not ifcs:
            return out
        out["scmSpeed"] = _to_float(ifcs.get("scmSpeed"))
        out["maxSpeed"] = _to_float(ifcs.get("maxSpeed"))
        out["boostSpeed"] = _to_float(ifcs.get("boostSpeedForward"))
        mav = ifcs.get("maxAngularVelocity")
        if isinstance(mav, dict):
            for axis, out_key in self._IFCS_AXIS_TO_RATE.items():
                out[out_key] = _to_float(mav.get(axis))
        return out

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
        # Weapons had no `stats` block at all: power draw, IR/EM signature,
        # health, distortion, mass and aim assist were all unreachable for the
        # UI. Allowlist-based, dropped entirely when nothing matches.
        weapon_stats = self._weapon_stats(comps)
        if weapon_stats:
            base["stats"] = weapon_stats
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
        # fireRate/projectilesPerShot/heatPerShot are NOT derived here — all
        # three need the SELECTED fire-action struct (below), not an unscoped
        # generic leaf search: `pelletCount`/`heatPerShot` exist on every fire
        # action a weapon carries (single/burst/charge/…), so an unscoped
        # first-match search over the whole record can silently pick a
        # DIFFERENT fire mode's value than the one actually selected — or, for
        # heatPerShot, pick up a real 0.0 from an unrelated mode and leave it
        # sitting in `params` as a stale zero the fire-action stage below then
        # has no positive value to overwrite (verified against the live P4K:
        # `KLWE_LaserRepeater_S3`'s own selected action has heatPerShot 0.0 —
        # a laser weapon genuinely generates no separate shot-heat — and that
        # must come out ABSENT, not `0.0`).
        derived = {
            "projectileSpeed": _to_float(_find_first_key(
                rv, ("muzzleVelocity", "projectileSpeed"))),
        }
        # per-shot damage (6-channel) from the nested projectile/ammo damage block
        dmg = _damage_set_anycase(_find_first_dict_with(
            rv, ("DamagePhysical", "DamageEnergy", "DamageDistortion")))
        if dmg is not None:
            params["impactDamage"] = dmg
        for k, v in derived.items():
            if v is not None and k not in params:
                params[k] = v
        # Fire rate (R4): walk SCItemWeaponComponentParams.fireActions, pick the
        # first genuine fire action's positive fireRate (skipping charge/sequence
        # wrappers sitting at 0), sanity-band it (30-15000 rpm). `_scalars(wcp)`
        # above already copied a literal top-level `fireRate: 0.0` that would
        # otherwise silently shadow the real value — OVERWRITE it unconditionally
        # here rather than the previous only-if-absent merge. No value found (or
        # out-of-band) => fireRate is REMOVED so the field is genuinely absent,
        # never a stale/guessed 0.
        fire_actions = _collect_fire_actions(wcp.get("fireActions"))
        fa, rpm = _select_fire_action(fire_actions)
        if rpm is not None:
            params["fireRate"] = rpm
            if fa is not None:
                # VERIFIED against the live P4K (`KLWE_LaserRepeater_S3`): the
                # fire action leaf has no top-level `projectilesPerShot` field
                # at all — pellet count lives one level deeper, at
                # `launchParams.pelletCount` (an earlier, unverified draft
                # read a nonexistent top-level field and would never have
                # found a value). `heatPerShot` IS a genuine top-level field
                # on the leaf, confirmed against the same weapon.
                launch = fa.get("launchParams")
                pps = _to_float(launch.get("pelletCount")) if isinstance(launch, dict) else None
                if pps is not None and pps > 0:
                    params["projectilesPerShot"] = pps
                heat = _to_float(fa.get("heatPerShot"))
                if heat is not None and heat > 0:
                    params["heatPerShot"] = heat
        else:
            params.pop("fireRate", None)
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
        # Personal FPS armor / clothing pieces expose a generic stat block
        # (SCItemSuitArmorParams / SCItemClothingParams scalars, keyed by struct
        # name) via the same mechanism ship components use — no per-field
        # foreknowledge, dropped entirely when empty so non-armor items stay lean.
        # Vehicle (hull) armor pieces get the same treatment: gate on the struct
        # actually being present (SCItemVehicleArmorParams), not on AttachDef.Type
        # — the per-hull ARMR_<ship> items don't use the Char_Armor_* vocabulary.
        has_vehicle_armor = _find_component(comps, "SCItemVehicleArmorParams") is not None
        if atype in _ARMOR_TYPES or has_vehicle_armor:
            stats = self._component_stats(comps, "Armor")
            if stats:
                base["stats"] = stats
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
            # top-level scalars + immediate child structs (one level deep)
            flat = _flatten_depth2(c)
            if t == "SCItemVehicleArmorParams":
                self._add_vehicle_armor_depth2(c, flat)
            if t == "ItemResourceComponentParams":
                self._add_resource_network(c, flat)
            if flat:  # only components that actually carry scalar values
                stats[t] = flat
        return stats

    # Structs a WEAPON is allowed to surface as `stats`. Weapons carry the same
    # noisy Components list ships do (geometry, audio, per-attachment stubs), so
    # this is an allowlist like `_SHIP_STATS_WHITELIST`, not the item blacklist.
    _WEAPON_STATS_WHITELIST = {
        "ItemResourceComponentParams",   # power draw + IR/EM signature
        "SHealthComponentParams",        # Health
        "SDistortionParams",             # distortion pool / regen
        "SEntityPhysicsControllerParams",  # mass
        "SCItemAimableComponentParams",  # gimbal range / tracking rate
    }

    def _weapon_stats(self, comps) -> Dict[str, Any]:
        """Allowlist-only stats block for weapons, same struct-keyed shape as
        `_component_stats()`. Weapons had no `stats` key at all before; they get
        one only when the allowlist actually matches (never an empty object)."""
        stats: Dict[str, Any] = {}
        for c in comps:
            t = c.get("_Type_")
            if t not in self._WEAPON_STATS_WHITELIST:
                continue
            flat = _flatten_depth2(c)
            if t == "ItemResourceComponentParams":
                self._add_resource_network(c, flat)
            if flat:
                stats[t] = flat
        return stats

    # ── resource network (power / coolant / shield / signature) ───────────────
    # VERIFIED against live LIVE-4.9.0 records (probe 2026-09-04): reactor
    # POWR_LPLT_S01_IonBurst, cooler COOL_JUST_S01_UltraFlow, shield
    # SHLD_SECO_S01_WEB, weapon KLWE_LaserRepeater_S3. `states[]` and its
    # `deltas[]` are LISTS, which the generic flatten drops entirely — the whole
    # energy model (segment budget, minimum draw, coolant load, IR/EM) lived
    # exactly there and never reached the payload.
    #
    # Emitted flat keys, one prefix per state (state name lower-cased):
    #   stateNames                            "Online" ("|"-joined when several)
    #   <state>.power.consumeSegments         SPowerSegmentResourceUnit.units
    #   <state>.power.consumeUnits            SStandardResourceUnit.standardResourceUnits
    #   <state>.power.generateSegments        reactor budget (units)
    #   <state>.power.generateUnits
    #   <state>.power.minFraction             minimumConsumptionFraction of the
    #                                         Power-consuming delta (4 dp: the
    #                                         raw value is float32 noise, e.g.
    #                                         0.6666666865348816)
    #   <state>.<resource>.consume/.generate  every non-Power resource by its
    #                                         own lower-cased name, SRU/s
    #                                         (coolant, shield, fuel, …)
    #   <state>.em.nominal/.decayRate         signatureParams.EMSignature
    #   <state>.ir.nominal/.decayRate         signatureParams.IRSignature
    #   <state>.powerRanges.<low|medium|high>.<start|modifier>
    # Amounts of repeated deltas on the same resource+direction are SUMMED.
    # Nothing is defaulted: a key is emitted only when the record carries it —
    # an explicit 0.0 in the file (e.g. a reactor's 0 coolant draw) is kept as 0.
    _SIGNATURE_KEYS = (("EMSignature", "em"), ("IRSignature", "ir"))
    _POWER_RANGE_BANDS = ("low", "medium", "high")

    def _add_resource_network(self, params: Dict[str, Any],
                              flat: Dict[str, Any]) -> None:
        states = params.get("states")
        if not isinstance(states, list):
            return
        names: List[str] = []
        for state in states:
            if not isinstance(state, dict):
                continue
            name = state.get("name")
            if not isinstance(name, str) or not name:
                continue
            names.append(name)
            p = f"{name.lower()}."
            for delta in state.get("deltas") or []:
                if isinstance(delta, dict):
                    self._add_resource_delta(delta, flat, p)
            sig = state.get("signatureParams")
            if isinstance(sig, dict):
                for src, key in self._SIGNATURE_KEYS:
                    entry = sig.get(src)
                    if not isinstance(entry, dict):
                        continue
                    for field_name, out_key in (("nominalSignature", "nominal"),
                                                ("decayRate", "decayRate")):
                        val = _to_float(entry.get(field_name))
                        if val is not None and math.isfinite(val):
                            flat[f"{p}{key}.{out_key}"] = val
            ranges = state.get("powerRanges")
            if isinstance(ranges, dict):
                for band in self._POWER_RANGE_BANDS:
                    entry = ranges.get(band)
                    if not isinstance(entry, dict):
                        continue
                    for field_name in ("start", "modifier"):
                        val = _to_float(entry.get(field_name))
                        if val is not None and math.isfinite(val):
                            flat[f"{p}powerRanges.{band}.{field_name}"] = val
        if names:
            flat["stateNames"] = "|".join(names)

    def _add_resource_delta(self, delta: Dict[str, Any], flat: Dict[str, Any],
                            prefix: str) -> None:
        """One `deltas[]` entry: Generation carries `generation`, Consumption
        carries `consumption`, Conversion carries both."""
        for side, verb in (("consumption", "consume"), ("generation", "generate")):
            amount = delta.get(side)
            if not isinstance(amount, dict):
                continue
            resource = amount.get("resource")
            unit = amount.get("resourceAmountPerSecond")
            if not isinstance(resource, str) or not isinstance(unit, dict):
                continue
            utype = unit.get("_Type_")
            if resource == "Power":
                if utype == "SPowerSegmentResourceUnit":
                    key, val = f"{prefix}power.{verb}Segments", _to_float(unit.get("units"))
                else:
                    key = f"{prefix}power.{verb}Units"
                    val = _to_float(unit.get("standardResourceUnits"))
                if val is not None and math.isfinite(val):
                    _accumulate(flat, key, val)
                if verb == "consume":
                    frac = _to_float(delta.get("minimumConsumptionFraction"))
                    if frac is not None and math.isfinite(frac):
                        flat[f"{prefix}power.minFraction"] = round(frac, 4)
                continue
            raw = unit.get("standardResourceUnits")
            if raw is None:
                raw = unit.get("units")
            val = _to_float(raw)
            if val is not None and math.isfinite(val):
                _accumulate(flat, f"{prefix}{resource.lower()}.{verb}", val)

    # Depth-2 dicts that the live `SCItemVehicleArmorParams` struct nests its
    # real per-damage-type numbers under. Targeted post-step for THIS struct
    # only — `_component_stats()`'s generic 1-level flatten (above) is left
    # untouched for every other component (red-team R3: no shared-blacklist
    # regression, see test_stats_regression.py).
    _VEHICLE_ARMOR_DEPTH2 = (
        ("armorDeflection", "deflectionValue"),
        ("armorPenetrationResistance", "penetrationAbsorptionForType"),
    )

    def _add_vehicle_armor_depth2(self, armor_params: Dict[str, Any],
                                   flat: Dict[str, Any]) -> None:
        """VERIFIED against the live `ARMR_CNOU_Nomad`: `armorDeflection.
        deflectionValue.*` and `armorPenetrationResistance.
        penetrationAbsorptionForType.*` are per-damage-type dicts one level
        deeper than the generic flatten reaches. Emits dotted keys like
        `armorDeflection.deflectionValue.DamagePhysical` only for values that
        are actually present."""
        for outer, inner in self._VEHICLE_ARMOR_DEPTH2:
            sub = armor_params.get(outer)
            if not isinstance(sub, dict):
                continue
            nested = sub.get(inner)
            if not isinstance(nested, dict):
                continue
            for sk, sv in _scalars(nested).items():
                flat[f"{outer}.{inner}.{sk}"] = sv

    def _item_ports(self, comps) -> List[Dict[str, Any]]:
        ipc = _find_component(comps, "SItemPortContainerComponentParams")
        if not ipc:
            return []
        ports = ipc.get("Ports")
        if not isinstance(ports, list):
            return []
        from .hardpoints import port_helper_name
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
                # Mesh helper node this port attaches to. On its own it is just a
                # name; _hardpoint_positions turns it into a coordinate when the
                # node actually exists in the hull mesh.
                "helperName": port_helper_name(p),
            })
        return out

    def _default_loadout(self, comps) -> List[Dict[str, Any]]:
        return _default_loadout_of(comps)

    # ── exhaustive generic dump ─────────────────────────────────────────────────
    def dump_all_records(self) -> None:
        base = self.out / "records"
        base.mkdir(parents=True, exist_ok=True)
        n_types = len(self.df.record_types)

        # The parallel path needs the raw DataCore blob to hand workers (they
        # re-parse it out of shared memory — the parsed container itself cannot
        # cross a process boundary). Without it, or with a single worker, run
        # the serial path below unchanged: `--workers 1` must stay byte-for-byte
        # what this code did before parallelism existed.
        if self.workers > 1 and self.raw_dcb:
            from .parallel_dump import PoolUnusable, dump_records_parallel

            self.on_log("info", f"generic dump: {self.workers} worker processes")
            try:
                per_type, total, n_fail = dump_records_parallel(
                    self.df, self.raw_dcb, base, self.workers,
                    on_log=self.on_log, on_count=self.on_count,
                    on_progress=self.on_progress, pct_range=_PCT_RECORDS,
                )
            except PoolUnusable as exc:
                # Falling through to the serial dump costs time; NOT falling
                # through costs the data. A pool can be unusable for reasons we
                # cannot see from here (locked-down machine, packaged build
                # without freeze_support, no shared-memory segment available),
                # and the exhaustive dump is a guarantee the run makes.
                self.on_log("warn", f"worker pool unusable ({exc}) — falling back "
                                    f"to the serial record dump")
            else:
                self._finish_record_dump(base, per_type, total, n_fail, n_types)
                return

        per_type = Counter()
        total = 0
        n_fail = 0
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
        self._finish_record_dump(base, per_type, total, n_fail, n_types)

    def _finish_record_dump(self, base: Path, per_type: Counter, total: int,
                            n_fail: int, n_types: int) -> None:
        """Tallies, warnings and the index — identical for serial and parallel."""
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


def _flatten_depth2(d: Dict[str, Any]) -> Dict[str, Any]:
    """Top-level scalars of a resolved struct plus the scalars of its immediate
    child structs, flattened as ``Sub.field`` (the shape `_component_stats()`
    and `_ship_stats()` have always emitted)."""
    flat = _scalars(d)
    for k, v in d.items():
        if not isinstance(k, str) or k.startswith("_"):
            continue
        if isinstance(v, dict):
            for sk, sv in _scalars(v).items():
                flat.setdefault(f"{k}.{sk}", sv)
    return flat


def _accumulate(flat: Dict[str, Any], key: str, value: float) -> None:
    """Sum repeated deltas that target the same resource and direction."""
    prev = flat.get(key)
    flat[key] = value if not isinstance(prev, (int, float)) else prev + value


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


# ── weapon fire-rate (R4) ────────────────────────────────────────────────────
# Fire actions are INLINE structs under SCItemWeaponComponentParams.fireActions
# (not cross-record refs), but they can be wrapped in sequence action structs
# (`SWeaponActionSequenceParams` -> `sequenceEntries[].weaponAction`) which do
# NOT themselves carry a `fireRate` field at all. A plain depth-first "first
# fireRate anywhere" scan (the previous approach) therefore frequently landed
# on an unrelated nested `fireRate`-shaped leaf instead of the real action's
# value.
#
# VERIFIED against the LIVE 4.9.0 P4K (`KLWE_LaserRepeater_S3`, PR A report):
# the leaf struct actually carrying `fireRate` is `SWeaponActionFireSingleParams`
# (fireRate 750, unit RPM per the enclosing `sequenceEntries[].unit`) — NOT the
# `SWeaponActionFireParams` name an earlier, unverified draft of this file
# assumed (that type does not exist in the live schema; matching only it would
# have found zero fire actions on every real ship weapon). CIG's naming
# convention nests every concrete fire-action variant under the
# `SWeaponActionFire*Params` family (observed: `...FireSingleParams`; likely
# siblings for burst/charge/rapid/beam modes use the same prefix) — so we match
# generically on `_Type_` starting with `SWeaponActionFire` AND the struct
# actually carrying a literal `fireRate` key, rather than hard-coding one
# variant name. This stays generic across weapon types without guessing field
# values: an unrecognised variant simply yields no fire actions (never a wrong
# number).
_FIRE_ACTION_TYPE_PREFIX = "SWeaponActionFire"
_FIRE_RATE_MIN_RPM = 30.0
_FIRE_RATE_MAX_RPM = 15000.0


def _is_fire_action_struct(node: Dict[str, Any]) -> bool:
    t = node.get("_Type_")
    return (isinstance(t, str) and t.startswith(_FIRE_ACTION_TYPE_PREFIX)
            and "fireRate" in node)


def _collect_fire_actions(node: Any, _depth: int = 0,
                          _max_depth: int = 10) -> List[Dict[str, Any]]:
    """DFS collecting every concrete `SWeaponActionFire*Params` struct (any
    variant, matched by literal `fireRate` presence — see module note above)
    under `node`, in encounter order. Descends into sequence-action wrappers
    and lists — fire actions are inline structs, never cross-record
    references."""
    found: List[Dict[str, Any]] = []
    if _depth > _max_depth:
        return found
    if isinstance(node, dict):
        if _is_fire_action_struct(node):
            found.append(node)
        for k, v in node.items():
            if isinstance(k, str) and k.startswith("_") and k.endswith("_"):
                continue
            found.extend(_collect_fire_actions(v, _depth + 1, _max_depth))
    elif isinstance(node, list):
        for item in node:
            found.extend(_collect_fire_actions(item, _depth + 1, _max_depth))
    return found


def _select_fire_action(
        fire_actions: List[Dict[str, Any]]
) -> Tuple[Optional[Dict[str, Any]], Optional[float]]:
    """Pick the fire action to derive fireRate/projectilesPerShot/heatPerShot
    from: the FIRST action (in struct order) whose literal `fireRate` is
    positive (skips charge/sequence-wrapper actions sitting at 0 ahead of the
    real one), then sanity-band that single value. Out-of-band is treated as
    absent outright — we do not keep scanning past it, so a bogus first value
    can't be silently papered over by a plausible-looking later one.

    Returns (selected_action_or_None, rpm_or_None).
    """
    for fa in fire_actions:
        rpm = _to_float(fa.get("fireRate"))
        if rpm is not None and rpm > 0:
            if _FIRE_RATE_MIN_RPM <= rpm <= _FIRE_RATE_MAX_RPM:
                return fa, rpm
            return None, None
    return None, None


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
