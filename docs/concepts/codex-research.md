# Codex Feature — Wave 0 Research: P4K Extraction + Display Spec

> **Status:** Wave-0 research handoff. Unblocks Wave 1 (extractor) and Wave 2 (DB schema + types).
> **Author:** devops:research · **Date:** 2026-05-29
> **Data-source decision (fixed):** Extract from the real game files (`Data.p4k`) via **scdatatools**. NOT an external API.
> **Scope of verification:** scdatatools API claims are verified by reading the *actually-installed* package source on disk
> (`…\Python312\Lib\site-packages\scdatatools\`). Field-set / record-type claims are corroborated against the open-source
> `scunpacked` loader and primary RSI/Star-Citizen-Wiki sources. See the Fact Verification table at the end.

---

## 0. TL;DR for Waves 1 & 2

- **Open the P4K** with `from scdatatools.p4k import P4KFile` — a top-level leaf module. It does **not** import `nubia`.
- **Load the DataCore** with `from scdatatools.forge import DataCoreBinary`, fed the bytes of the P4K entry **`Data/Game.dcb`** (capital G, `.dcb`).
- **Decryption is transparent.** The P4K AES key is hard-coded in scdatatools (`DEFAULT_P4K_KEY`); the `Game.dcb` payload itself is parsed as plaintext binary. No keys to supply, no separate decrypt step.
- **The `nubia` ImportError only bites if you go through `scdatatools.sc.StarCitizen`** (the convenience wrapper). Import the leaf modules directly and you sidestep it entirely — OR `pip install nubia` / stub it to regain the wrapper. Recommendation: **use the leaf modules + a thin hand-rolled loader**; it's the smallest dependency surface.
- **Ships** = `EntityClassDefinition` records whose `filename` matches `libs/foundry/records/entities/spaceships/.*`. Stats live in their **Components** (a list of typed structs), not in flat fields.
  - ⚠️ **Corrected in practice (feedback 0a5988d5):** the `spaceships/` prefix alone is **incomplete** — GROUND vehicles live in the sibling `entities/groundvehicles/` directory (40 records vs 920 spaceships in the live datacore). Using the single prefix silently dropped the whole URSA / Cyclone / Storm / ROC / PTV / STV / UTV / ATLS / Nox / X1 family from `codex_ships`. The extractor now matches `entities/{spaceships,groundvehicles,vehicles}/` **plus** a `VehicleComponentParams` fallback — see `_VEHICLE_ROOT_RE` in `dataforge_extract.py`.
- **The domain model** (Section 5) intentionally mirrors the field set that `scunpacked` proved extractable, so the schema is grounded in a working reference implementation rather than guesswork.

**Headline risk:** scdatatools 1.0.4 was released **2022-08-02** — ~4 years old. The binary container parser (DataForge v5/v6) is robust, but **record-type and struct-property *names* in the live SC build may have drifted** since. Wave 1 must treat the exact property paths below as *starting hypotheses to confirm against the live `Game.dcb`*, not gospel. (See Section 6.)

> **VERIFIED BY ORCHESTRATOR (2026-05-29):** `from scdatatools.p4k import P4KFile` works after installing missing deps
> (`python-nubia pyquaternion pycryptodome xxhash sentry-sdk rsa cryptography zstandard lz4 Pillow numpy`). BUT opening the
> live `LIVE/Data.p4k` raises `zipfile.BadZipFile: Corrupt extra field 0001 (size=18)` at `scdatatools/p4k.py:183`
> (`_decodeExtra` only handles ZIP64 tag `0x0001` for lengths {0,8,16,≥24}; SC 4.x uses ln=18). This confirms Risk Q2 is
> a *blocking* reality, not just a hypothesis. Wave 1's first job: patch `_decodeExtra` to tolerate ln=18 OR install a
> newer scdatatools (GitLab `devel`) / StarBreaker. Same domain model regardless.

---

## 1. scdatatools 1.0.4 API surface (verified against installed source)

### 1.1 Avoiding the `nubia`/CLI import

The reported failure — `import scdatatools` → `ModuleNotFoundError: No module named 'nubia'` — is real and traced to this chain (all read directly from disk):

```
scdatatools/__init__.py            →  from scdatatools.sc import StarCitizen
scdatatools/sc/__init__.py         →  from scdatatools.cli.utils import track   # line 9
scdatatools/cli/__init__.py        →  from nubia import Nubia, Options, context # line 4  → ImportError
```

So **both** `import scdatatools` and `from scdatatools.sc import StarCitizen` fail, because importing `scdatatools.cli.utils` first runs `scdatatools/cli/__init__.py`, which imports `nubia`.

**The data/p4k/forge leaf modules do NOT traverse `sc` or `cli`.** Verified import graphs:

| Import | Pulls in `nubia`? | Notes |
|---|---|---|
| `from scdatatools.p4k import P4KFile` | **No** | deps: `zstandard`, `pycryptodome` (`Crypto.Cipher.AES`), `scdatatools.plugins`, `scdatatools.utils` |
| `from scdatatools.forge import DataCoreBinary` | **No** | deps: `scdatatools.engine.cryxml`, `scdatatools.forge.dftypes` (ctypes), `scdatatools.utils` |
| `from scdatatools.forge.dco import dco_from_guid, Entity, Ship` | **No** | convenience DCO wrappers; deps `scdatatools.forge.dftypes` only |
| `from scdatatools.sc import StarCitizen` | **YES** (fails) | also pulls `rsi.launcher`, `wwise` — heavy + network-ish |

**Decision for Wave 1:** Do **not** use `StarCitizen`. Open the P4K and DataCore directly:

```python
from scdatatools.p4k import P4KFile
from scdatatools.forge import DataCoreBinary

p4k = P4KFile(r"C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Data.p4k")
dcb_info = p4k.getinfo("Data/Game.dcb")          # case-insensitive getinfo available
with p4k.open(dcb_info) as f:                    # transparent AES + zstd decode
    dcb = DataCoreBinary(f.read())
```

> Fallback if a future scdatatools build moves things: a one-line `sys.modules["nubia"] = types.ModuleType("nubia")` stub *before* importing, or `pip install nubia`, restores `StarCitizen`. But the leaf-module path above has no such fragility.

### 1.2 Loading the DataCore & enumerating records

- **Path/name confirmed:** the entry is **`Data/Game.dcb`** — capital `G`, extension `.dcb` (DataForge Binary). scdatatools' own `generate_inventory` hard-codes `Data / "Game.dcb"`, and the `datacore` property does `self.p4k.getinfo("Data/Game.dcb")`.
- `DataCoreBinary(bytes)` parses the header, structure/property/enum definitions, value tables, and lazily materializes structure instances. Verified attributes:
  - `dcb.records` — list of `Record` (ctypes structs). Each `Record` exposes:
    - `record.name` — class name (e.g. `AEGS_Avenger_Titan`), with the `<type>.` prefix stripped.
    - `record.type` — the structure-definition name (e.g. `EntityClassDefinition`).
    - `record.filename` — virtual datacore path (e.g. `libs/foundry/records/entities/spaceships/aegs_avenger_titan.xml`).
    - `record.id.value` — GUID string.
    - `record.properties` — dict-like of typed property values (nested structs, references, arrays, scalars).
  - `dcb.records_by_guid` — `{guid: Record}`.
  - `dcb.record_types` — `set` of all distinct `type` strings present (use this to *discover* the live schema's type names — invaluable for Wave 1).
  - `dcb.entities` — `{name: Record}` for every `EntityClassDefinition` (pre-indexed in `__init__`).
  - `dcb.search_filename(glob, mode="fnmatch")` — e.g. `dcb.search_filename("*spaceships*")`.
  - `dcb.record_to_dict(record, depth=100)` / `dump_record_json(...)` — fully resolve a record (follows references, guards `nextstate`/`parent` cycles). **This is the workhorse** for converting a record into a JSON-able blob.

Higher-level convenience (optional): `scdatatools.forge.dco` provides `dco_from_guid(dcb, guid)` returning a typed wrapper; the registered handlers in 1.0.4 are:

```
EntityClassDefinition                                              → Entity   (exposes .components dict, .tags)
EntityClassDefinition + filename ~ libs/foundry/records/entities/spaceships/.*  → Ship  (exposes .category, .icon, .object_containers, …)
```

So **the canonical "is this a ship?" test is the `spaceships/` filename prefix** — taken straight from scdatatools' own `register_record_handler` decorator on the `Ship` class.

**But that test only covers SPACE ships.** scdatatools' `Ship` handler is registered for the spaceships path only, and the live datacore keeps drivable ground vehicles under `libs/foundry/records/entities/groundvehicles/`. Treating the spaceships prefix as "is this a vehicle?" therefore loses every rover, buggy, tank and hoverbike in the game. The reliable discriminator for *vehicle* is the second column of the table below: the **`VehicleComponentParams` component** (967 records in the live datacore ≈ 920 spaceships + 40 ground vehicles + a handful filed elsewhere). The extractor uses the path roots as the fast path and that component as the fallback.

### 1.3 DataCore record types → entity mapping

Verified from scdatatools source + corroborated by the `scunpacked` loader (which parses the same DataCore). The unit of truth is the **`EntityClassDefinition`** record; "what kind of thing it is" is decided by (a) its `filename` path and (b) which **component param structs** appear in its `Components` list.

| Our entity type | DataCore source | Key discriminator |
|---|---|---|
| **Ship / vehicle** | `EntityClassDefinition` under `libs/foundry/records/entities/{spaceships,groundvehicles,vehicles}/…` | filename prefix (all three roots — `spaceships/` alone misses every ground vehicle); OR has `VehicleComponentParams` component |
| **Ship weapon** | `EntityClassDefinition` (item) | has `SCItemWeaponComponentParams`; `SAttachableComponentParams.AttachDef.Type` ~ `WeaponGun`/`Turret`/`MissileLauncher` |
| **FPS weapon** | `EntityClassDefinition` (item) | `SCItemWeaponComponentParams` + FPS `AttachDef.Type`/tags; scunpacked splits these into `fps-items.json` |
| **Ammunition** | dedicated records under `Data/Libs/Foundry/Records/ammoparams` | referenced by `SCItemWeaponComponentParams.ammoContainerRecord` → `SAmmoContainerComponentParams.ammoParamsRecord` |
| **Ship component — power plant** | `EntityClassDefinition` (item) | `AttachDef.Type == "PowerPlant"` (+ power params component) |
| **Ship component — shield** | item | `AttachDef.Type == "Shield"` (+ shield params) |
| **Ship component — cooler** | item | `AttachDef.Type == "Cooler"` |
| **Ship component — quantum drive** | item | `AttachDef.Type == "QuantumDrive"` |
| **Ship component — thruster / fuel tank / cargo grid / fuel intake** | item | by `AttachDef.Type`; aggregated by scunpacked's port-summary |
| **Item ports / hardpoints** | **not separate records** — they live inside an entity's `SItemPortContainerComponentParams.Ports[]` | each port has `Name`, attachment helper, and accepted size/type/tags |
| **Manufacturer** | `SCItemManufacturer` record type | referenced from `AttachDef.Manufacturer` |

**Component param struct names (verbatim, confirmed):**
`VehicleComponentParams`, `SCItemVehicleComponentParams`, `SAttachableComponentParams`, `SItemPortContainerComponentParams`, `SEntityComponentDefaultLoadoutParams`, `SGeometryResourceParams`, `SCItemWeaponComponentParams`, `SAmmoContainerComponentParams`, `SCItemSuitArmorParams`, `SCItemManufacturer`. (The first six are read directly by scdatatools' blueprint processors; the rest by scunpacked's loaders.)

**How loadouts/installed-items resolve:** an entity's `SEntityComponentDefaultLoadoutParams.loadout.entries[]` each carry an `itemPortName` + `entityClassName` (string). You resolve `entityClassName` against `dcb.entities[...]` to get the installed item's record. This is exactly how scdatatools' `process_component_loadouts` walks the default loadout, and it gives us the **default hardpoint → item** mapping for free.

### 1.4 Localization & className → human-name mapping

Verified from `scdatatools/sc/localization.py`:

- Localization tables are `Data/Localization/<language>/global.ini` files — simple `key=value` lines (CRLF-split, `=`-split once, UTF-8). scdatatools reads every `<language>` folder it finds.
- Resolution: `gettext(key, language)`. If the raw key misses and it starts with `@`, the leading `@` is stripped and retried. If still missing, the **key itself is returned** (so unresolved keys are visible, not blank).
- **The chain for a human name:** an item's `SAttachableComponentParams.AttachDef.Localization.Name` (and `…Description`) is a localization **key** (e.g. `@item_Name_AEGS_Avenger_Titan`), which you look up in `global.ini` for each language → `"Avenger Titan"`. The internal `record.name` / `entityClassName` (e.g. `AEGS_Avenger_Titan`) is the **stable join key**; the localized strings are the display layer.
- **Manufacturer name** resolves the same way via the `SCItemManufacturer` record's localized name/code fields.

**Wave-1 note:** we don't need scdatatools' `SCLocalization` class (it's tied to `StarCitizen`). Wave 1 can extract the `global.ini` files directly with `p4k.search("Data/Localization/*/global.ini")` and parse them with the same trivial `key=value` logic. This keeps the extractor on the `nubia`-free leaf path.

---

## 2. Field set to extract per entity type

Marked **[reliable]** (confirmed extractable by scunpacked and/or scdatatools, structurally stable) vs **[flaky]** (present but schema-name-sensitive across SC versions, or sometimes absent). Property paths are starting hypotheses for Wave 1 to confirm against the live DataCore.

### Ship / vehicle
| Field | Reliability | Source path (hypothesis) |
|---|---|---|
| className (join key) | [reliable] | `record.name` |
| localized name / manufacturer | [reliable] | `AttachDef.Localization.Name`; `AttachDef.Manufacturer` |
| mass | [reliable] | sum of part masses (scunpacked sums `Part.Mass`) |
| crew size | [reliable] | `VehicleComponentParams.crewSize` |
| cargo capacity (SCU) | [reliable] | sum of installed `CargoGrid.Capacity` over cargo ports |
| SCM / max speed | [reliable] | `ifcs.MaxSpeed` |
| afterburn / boost speed | [reliable] | `ifcs.MaxAfterburnSpeed` |
| pitch / yaw / roll rates | **[flaky]** | inside the IFCS/vehicle params — **exact key names unconfirmed**, see §6 Q1 |
| acceleration (main/retro/strafe) | **[flaky]** | thruster aggregation; names version-sensitive |
| HP / health (hull + per-part) | [reliable] | per-`Part` health from the vehicle definition XML |
| hydrogen fuel capacity / intake rate | [reliable] | `HydrogenFuelTank.Capacity`; `HydrogenFuelIntake.Rate` |
| quantum fuel capacity | [reliable] | `QuantumFuelTank.Capacity` |
| quantum drive speed / spool / fuel rate | [reliable] | `QuantumDrive.StandardJump.Speed`/`.SpoolUpTime`; `.FuelRate` |
| thruster thrust capacity / fuel rate | [reliable] | `Thruster.ThrustCapacity`; `Thruster.MaxThrustFuelRate` |
| hardpoint/item-port list (size, type, default item) | [reliable] | `SItemPortContainerComponentParams.Ports[]` + default loadout |
| icon / UI texture | [reliable] | `Ship.icon`; `Data/Textures/UI/Spaceships/*.dds` |
| category / role | **[flaky]** | `Ship.category`; tags |

### Ship & FPS weapons
| Field | Reliability | Source path (hypothesis) |
|---|---|---|
| type / subType / size / grade | [reliable] | `AttachDef.{Type,SubType,Size,Grade}` |
| rounds per minute | [reliable] | weapon mode `RoundsPerMinute` |
| damage per shot / per second | [reliable] | mode `DamagePerShot` / `DamagePerSecond` |
| pellets per shot | [reliable] | mode `PelletsPerShot` |
| fire modes | [reliable] | mode `FireType`, `AmmoPerShot` |
| capacitor consumption / cooldown / regen | [reliable] | `RequestedRegenPerSec`, `Cooldown`, `CostPerBullet`, `RequestedAmmoLoad` |
| ammo (speed, range, size, capacity) | [reliable] | `Ammunition.{Speed,Range,Size,Capacity}` |
| ammo damage (impact + detonation) | [reliable] | `ImpactDamage`/`DetonationDamage` → 6-type `StandardisedDamage` |
| projectile lifetime | **[flaky]** | not surfaced by scunpacked's standardised model; present in raw ammoparams |

### Ship components
Common to all: `type`, `subType`, `size` (int), `grade` (int → A/B/C/D), `class` (Military/Civilian/Industrial/Competition via tags), localized name, manufacturer, `tags[]`. **[all reliable]** — these come from `SAttachableComponentParams.AttachDef`.

| Component | Fields | Reliability | Source |
|---|---|---|---|
| Power plant | power output | [reliable] | `Output` |
| Cooler | cooling rate | [reliable] | `Rate` |
| Shield | max HP, regen, downed-delay, damaged-delay, 6-type absorption (min/max) | [reliable] | `Health`, `Regeneration`, `DownedDelay`, `DamagedDelay`, `…Absorption.{Physical,Energy,Distortion,Thermal,Biochemical,Stun}` |
| Quantum drive | jump speed, spool, cooldown, fuel rate, max range, jump range | [reliable] (speed/spool/cooldown [flaky] exact keys) | `StandardJump.{Speed,SpoolUpTime}`, `FuelRate`, `…Performance.MaximumRange`, `JumpRange` |

> **Damage model is uniform across the game:** six channels — Physical, Energy, Distortion, Thermal, Biochemical, Stun — appear on shields (absorption), weapons, and ammo. Model damage as a fixed 6-field object everywhere.

### Manufacturer
`code`, localized `name`, `description` — from `SCItemManufacturer`. **[reliable]**

### Item port / hardpoint (embedded, not a top-level entity)
`portName`, `size` (int), accepted `types[]`, `flags[]`, `category`, `installedItem` (default), editability. **[reliable]** — mirrors scunpacked's `StandardisedItemPort`. Note SC's weapon-size math (gimbal/twin-link/turret changes effective hardpoint size) is a *display concern* (§4), computed from port size + mount type, not a stored field.

---

## 3. Decryption status

- **P4K archive entries:** AES-128-CBC, zero IV, key hard-coded in scdatatools as
  `DEFAULT_P4K_KEY = b"\x5E\x7A\x20\x02\x30\x2E\xEB\x1A\x3B\xB6\x17\xC3\x0F\xDE\x1E\x47"` (read verbatim from `p4k.py:22`). `P4KFile.open()` decrypts transparently when `P4KInfo.is_encrypted` is set (detected from the ZIP extra field at byte 168) and then zstd-decompresses. **No key needs to be supplied by us** — the default is used automatically.
- **`Game.dcb` (DataCore) payload:** parsed as **plaintext binary** by `DataCoreBinary` — there is no AES/decrypt step in the forge module; it reads a header + ctypes structs directly. The only "decryption" is whatever the *P4K entry* needs (handled per above). So once you've `p4k.open("Data/Game.dcb").read()`, the bytes are ready for `DataCoreBinary(...)`.
- **DataForge version:** `DataCoreHeader.version` drives a v5+ vs older branch (32-bit vs 16-bit data-mapping defs). 1.0.4's parser handles both; the current SC build is well within range. **No external keys, no licensing blockers.**

**Net:** decryption is a solved, transparent, key-free problem for our use case. (Corroborated: StarBreaker and scunpacked operate on the same files with the same built-in key.)

---

## 4. erkul.games display analysis (inspiration only — NO IP/data/asset/code reuse)

erkul.games is the de-facto reference for SC loadout planning: DPS/power/cooling simulation over an up-to-date ship + component database. Observed IA/UX (from public guides + the Dutch Demons walkthrough + Hardpoint.io comparison):

**Patterns worth adopting as concepts:**
1. **Ship-first entry → slot canvas.** Pick a ship, then a layout of clickable hardpoint/component slots appears; clicking a slot opens a contextual picker filtered to compatible items (right size/type).
2. **Live stats sidebar.** Persistent panel showing aggregate stats (DPS, EM/IR signature, capacitor regen, power draw, thermal load, mass, fuel range, quantum speed) that recompute on every change. Hover → tooltip breakdown.
3. **Component search + faceted filter.** Find by name; filter the full DB by manufacturer / size / type / stats; show in-game availability.
4. **Saved builds + shareable URL.** Each loadout serializes to a link for sharing/comparison.

**How WE do it better (concrete):**
- **Better search:** server-side full-text + fuzzy over *localized* names AND classNames AND tags, with instant faceted filters (Supabase `pg_trgm` / `tsvector`). erkul's search is name-centric; ours indexes the join key too, so power users can search `AEGS_*`.
- **First-class comparison:** a true side-by-side compare tray (pin 2–4 ships or components; diff-highlight deltas). erkul leans single-build; comparison is our differentiator.
- **Bilingual by design:** DE/EN via ngx-translate for *our* UI chrome, and the game's `global.ini` DE+EN strings for *entity* names — a localized item DB that erkul doesn't offer.
- **Deep-linking everywhere:** stable routes `/codex/ship/:className`, `/codex/item/:className`, and shareable loadout permalinks encoding ship + per-port item classNames (round-trips cleanly because classNames are stable).
- **Hardpoint clarity:** visualize accepted size *range* per port and surface SC's gimbal/twin-link effective-size math inline, so users understand *why* a S5 hardpoint takes a gimballed S4.
- **Provenance + freshness:** every value badges its source patch/build (we already capture `channel`/`patch`/`build`), so users trust the data and see staleness. erkul shows "live" only.
- **Viewer-accessible (no login):** the brief mandates a viewer-accessible tab; read paths must work unauthenticated (align with `authGuard` only on edit/save features).

> **Hard rule for Wave 2/3:** adopt *patterns*, never assets/data/markup/CSS/code from erkul. Our data comes exclusively from our own P4K extraction.

---

## 5. Recommended domain model (source-agnostic sketch)

Intentionally aligned to the proven `scunpacked` field set so Wave 1 (populate) and Wave 2 (schema/types) share one contract. `className` is the stable join/permalink key; localized strings are a separate display layer.

```ts
type DamageSet = {                 // uniform 6-channel model used everywhere
  physical: number; energy: number; distortion: number;
  thermal: number; biochemical: number; stun: number;
};

type LocalizedText = { de: string; en: string; key: string }; // key = global.ini lookup key

interface Manufacturer {
  code: string;                    // e.g. "AEGS"
  name: LocalizedText;
  description?: LocalizedText;
}

interface ItemPort {
  portName: string;
  size: number;                    // hardpoint size (int)
  minSize?: number; maxSize?: number; // if exposed by the live schema (else = size)
  types: string[];                 // accepted item types
  flags: string[];
  category?: string;
  installedItemClassName?: string; // default loadout occupant (join → Item/Component)
  editable: boolean;
  children?: ItemPort[];           // turrets/racks have sub-ports
}

interface BaseEntity {
  className: string;               // stable key, e.g. "AEGS_Avenger_Titan"
  guid: string;
  type: string;                    // DataCore record.type
  name: LocalizedText;
  manufacturer?: Manufacturer;
  tags: string[];
  iconPath?: string;               // extracted DDS→PNG
  source: { channel: string; patch: string; build: string };
}

interface Ship extends BaseEntity {
  role?: string; category?: string;
  mass: number;
  health?: { hull?: number; parts?: Record<string, number> };
  crew: { min?: number; max?: number };
  cargoScu: number;
  flight: {                        // [flaky] exact provenance — see §6 Q1
    scmSpeed?: number; maxSpeed?: number; boostSpeed?: number;
    pitch?: number; yaw?: number; roll?: number;
    accelMain?: number; accelRetro?: number; accelStrafe?: number;
  };
  fuel: { hydrogenCapacity?: number; hydrogenIntakeRate?: number; quantumCapacity?: number };
  quantum?: { jumpSpeed?: number; spoolTime?: number; cooldown?: number; fuelRate?: number; maxRange?: number };
  itemPorts: ItemPort[];
}

type ComponentKind =
  | "PowerPlant" | "Shield" | "Cooler" | "QuantumDrive"
  | "Thruster" | "FuelTank" | "FuelIntake" | "CargoGrid" | "Other";

interface Component extends BaseEntity {
  kind: ComponentKind;
  size: number;                    // item size
  grade?: "A" | "B" | "C" | "D";
  itemClass?: "Military" | "Civilian" | "Industrial" | "Competition";
  powerDraw?: number; thermalOutput?: number;
  // kind-specific (sparse — only the relevant ones populated):
  powerOutput?: number;            // PowerPlant
  coolingRate?: number;            // Cooler
  shield?: { maxHp: number; regen: number; downedDelay: number; damagedDelay: number;
             absorptionMin: DamageSet; absorptionMax: DamageSet };
  itemPorts?: ItemPort[];          // components can have sub-ports
}

interface Ammunition {
  className: string; guid: string;
  speed?: number; range?: number; size?: number; capacity?: number;
  impactDamage?: DamageSet; detonationDamage?: DamageSet;
}

type WeaponMode = {
  name: string; fireType?: string;
  roundsPerMinute?: number; damagePerShot?: number; damagePerSecond?: number;
  pelletsPerShot?: number; ammoPerShot?: number;
};

interface Weapon extends BaseEntity {
  weaponClass: "Ship" | "FPS";
  subType?: string;                // Gun / Turret / MissileLauncher / …
  size: number; grade?: "A"|"B"|"C"|"D";
  modes: WeaponMode[];
  consumption?: { requestedRegenPerSec?: number; cooldown?: number;
                  costPerBullet?: number; requestedAmmoLoad?: number };
  ammunitionClassName?: string;    // join → Ammunition
  itemPorts?: ItemPort[];          // attachments (e.g. underbarrel, scope)
}
```

Notes for Wave 2:
- Store `className` UNIQUE per `(channel, patch, build)` — it's the natural key and the permalink slug.
- `LocalizedText` → either a JSONB column or a side `entity_strings(entity_id, lang, field, value)` table; the latter scales to more languages and matches `global.ini` shape.
- Sparse component fields → either wide-nullable table per kind, or a typed JSONB `stats` column keyed by `kind`. Given alpha-phase churn (per CLAUDE.md), **JSONB `stats` + a few promoted indexed columns** (size, grade, type, manufacturer_code) is the pragmatic call; promote more columns once the schema stabilizes in beta.

---

## 6. Open questions / risks for Wave 1 (extraction)

**Q1 — Exact IFCS/flight property names [HIGH].** scunpacked reliably reads `MaxSpeed`/`MaxAfterburnSpeed`, but the **pitch/yaw/roll and acceleration** property paths inside the live vehicle/IFCS params are *not* confirmed and are the field most likely to have been renamed since 2022. **Action:** Wave 1 dumps one ship's full `record_to_dict` (e.g. `AEGS_Gladius`) and greps the resolved JSON for the angular/accel keys *before* committing the extractor mapping. Until confirmed, mark these fields nullable and ship without them rather than guessing.

**Q2 — scdatatools 1.0.4 age vs current build [HIGH, CONFIRMED BLOCKING].** Released 2022-08-02 (~4 yrs). The container parser is fine, but `dcb.record_types` / struct names may differ from this doc's hypotheses. **Orchestrator confirmed:** `P4KFile` on the live `Data.p4k` already fails with `BadZipFile: Corrupt extra field 0001 (size=18)` (ZIP64 ln=18 unhandled in `_decodeExtra`). **Action:** Wave 1's FIRST step is to fix P4K opening (patch `_decodeExtra` to tolerate ln=18, or newer scdatatools / StarBreaker), THEN print `sorted(dcb.record_types)` and a histogram of component-param struct names from the live `Game.dcb`, and reconcile against Section 1.3. Treat any mismatch as the source of truth. Keep the same domain model (§5) so downstream waves are unaffected.

**Q3 — Memory / performance on a 147 GB P4K [MED].** `DataCoreBinary` reads the entire `Game.dcb` into a `bytearray` then `memoryview` (fine — the dcb is tens of MB, not GB). The P4K itself is opened as a ZIP central-directory (streamed, not loaded). The real cost is `record_to_dict(depth=100)` over thousands of records with deep reference following. **Action:** cap depth, memoize resolved sub-records, stream output to per-entity JSON chunks (the scaffold already does chunked output), and skip texture/geometry extraction unless `scope` requests it.

**Q4 — Item ↔ entity classification ambiguity [MED].** Distinguishing ship-weapon vs FPS-weapon vs generic item relies on `AttachDef.Type`/tags whose vocabulary can shift. **Action:** drive classification off a small, version-checked lookup of `AttachDef.Type` values discovered from the live data (Q2's histogram), with an `"Other"` catch-all so nothing is dropped silently.

**Q5 — Default loadout completeness [LOW].** `SEntityComponentDefaultLoadoutParams` gives the *stock* loadout; some ports may be empty or reference items not in `dcb.entities`. scdatatools already logs missing `entityClassName`s. **Action:** record empty/unresolved ports as ports with `installedItemClassName = null` rather than omitting them — the hardpoint structure matters even when stock-empty.

**Q6 — Localization coverage [LOW].** Unresolved `@`-keys return the key verbatim. **Action:** keep the raw key in `LocalizedText.key` so the UI can fall back gracefully and we can spot missing translations.

**Q7 — Ingest pipeline gap [MED, for Wave 2].** Current `supabase/functions/ingest-bundle/index.ts` stores only manifest + `entity_counts`, NOT per-entity rows. The §5 model requires per-entity upsert tables. Flag for Wave 2: extend ingest to write `ships`/`weapons`/`components`/`item_ports`/`manufacturers`/`entity_strings` rows keyed by `(channel,patch,build)`.

---

## Fact Verification

| # | Claim | Source | Verified | Confidence |
|---|---|---|---|---|
| 1 | `P4KFile` is at `scdatatools.p4k`; opens P4K w/o `nubia` | Installed `scdatatools/p4k.py` (read on disk) | ✅ Read directly + orchestrator import-confirmed | High |
| 2 | `nubia` ImportError comes via `sc → cli.utils → cli/__init__` | Read `__init__.py`, `sc/__init__.py:9`, `cli/__init__.py:4` | ✅ Full chain read on disk | High |
| 3 | DataCore entry is `Data/Game.dcb`, plaintext binary | `sc/__init__.py:175,252`; `forge/__init__.py` (no decrypt step) | ✅ Read directly | High |
| 4 | P4K AES key hard-coded; decryption transparent | `p4k.py:22,44-50,464-468` | ✅ Read verbatim | High |
| 5 | Ship = `EntityClassDefinition` under `…/spaceships/` | `forge/dco/entities.py` `Ship` `filename_match` | ✅ Read verbatim | High |
| 6 | Localization via `global.ini` key=value, `@`-strip fallback | `sc/localization.py` | ✅ Read verbatim | High |
| 7 | Component struct names | scdatatools `entity_class.py` processors | ✅ Read verbatim (corroborated by scunpacked) | High |
| 8 | scunpacked ship/weapon/shield/QD/ammo field set | scunpacked `Loader/*.cs`, `Json/Standardised*.cs` | ✅ Multiple files fetched; consistent | High |
| 9 | 6-channel damage model | scunpacked `StandardisedDamage.cs` + shield absorption | ✅ Confirmed across 3 files | High |
| 10 | Component grades A–D; classes Military/Civilian/Industrial | Star Citizen Wiki "Ship components"; RSI Comm-Links | ✅ 2 sources | High |
| 11 | Hardpoint size system; gimbal/twin-link effective size | RSI Comm-Link "The Shipyard: Weapon Hardpoints" | ✅ Primary (CIG) | High |
| 12 | scdatatools 1.0.4 released 2022-08-02 | Libraries.io / PyPI | ⚠️ ~4 yrs old → staleness CONFIRMED blocking (ln=18) | High |
| 13 | erkul.games UX patterns | Dutch Demons walkthrough + erkul/Hardpoint.io listings | ✅ 2 independent descriptions | Medium |
| 14 | SC has 250+ ships, 220+ flyable | Star Citizen Wiki / RSI Ship Matrix | ⚠️ Approx, evolves each patch | Medium |

## Sources

- [scdatatools on PyPI](https://pypi.org/project/scdatatools/)
- [scdatatools docs (readthedocs)](https://scdatatools.readthedocs.io/en/latest/readme.html)
- [scdatatools GitLab (scmodding)](https://gitlab.com/scmodding/frameworks/scdatatools)
- [scdatatools 1.0.4 on Libraries.io](https://libraries.io/pypi/scdatatools)
- [richardthombs/scunpacked (loader reference)](https://github.com/richardthombs/scunpacked)
- [StarCitizenWiki/scunpacked-data](https://github.com/StarCitizenWiki/scunpacked-data)
- [diogotr7/StarBreaker (alt extractor)](https://github.com/diogotr7/StarBreaker)
- [Star Citizen Wiki — Ship components](https://starcitizen.tools/Ship_components)
- [RSI Comm-Link — The Shipyard: Weapon Hardpoints](https://robertsspaceindustries.com/en/comm-link/engineering/16181-The-Shipyard-Weapon-Hardpoints)
- [RSI Comm-Link — The Shipyard: Ordnance Hardpoints](https://robertsspaceindustries.com/en/comm-link/engineering/16190-The-Shipyard-Ordnance-Hardpoints)
- [RSI Ship Matrix](https://robertsspaceindustries.com/en/ship-matrix)
- [erkul.games](https://www.erkul.games/)
- [Erkul walkthrough — Dutch Demons](https://dutchdemons.com/tool/dpscalculator/)
- [Hardpoint.io (comparison reference)](https://hardpoint.io/)
