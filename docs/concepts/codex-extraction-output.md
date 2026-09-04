# Codex Extraction — Output Contract (Wave 1 → Wave 2 handoff)

> **Status:** Wave-1 output spec. Documents the EXACT JSON shape the extractor
> writes per entity type, so Wave 2 can build matching DB tables + ingest.
> **Producer:** `desktop-tool/python/sc_extract/` (real DataCore extraction).
> **Data source:** `Data/Game2.dcb` (DataForge v8) from the live `Data.p4k`.

## 0. What changed vs research §5 (forced by the live schema)

| Research §5 assumption | Live reality (Wave 1) | Impact |
|---|---|---|
| DataCore entry = `Data/Game.dcb` | **`Data/Game2.dcb`** | extractor auto-discovers any `*.dcb`; tables don't care |
| scdatatools parses the dcb | scdatatools 1.0.4 **cannot** (DataForge **v8**, record grew 32→36 B). We ship our own pure-Python reader (`dataforge.py`). | no schema impact; same record model |
| Localization folders `de`/`en` | folders are `english` / `german_(germany)` | mapped internally; output still `{de,en,key}` |
| Ship flight stats (SCM/pitch/yaw/accel) on the entity | live entity's own `Components` do **not** carry them; they live on the separate `Controller_Flight_<Ship>` ITEM entity referenced from the ship's default loadout (**CLOSED**, see §0b) | `ship.flight.*` resolved from that item's `IFCSParams` struct |
| Component stats under fixed struct names | real struct names differ (`SCItemShieldGeneratorParams`, `SCItemQuantumDriveParams`, `EntityComponentPowerConnection`, …); PowerPlant/Cooler often have no dedicated params struct | `component.stats` is a **map keyed by the live struct name** → flat scalars, not a fixed schema |
| Ammo `Ammunition.{Speed,Range,Size,Capacity}` + 6-ch damage | `AmmoParams` carries `speed/lifetime/size` directly; damage is nested under projectile params, not a flat `damage` block | ammo keeps a `raw` blob with everything; typed fields are best-effort |
| ~180 ships, ~250 weapons, ~600 components | **920 ships/vehicles, 1326 weapons, 2145 components, 21033 items, 1124 manufacturers, 235 ammo** (includes AI variants/templates) | counts are much higher; Wave 2 should expect variant rows (filter `*_PU_AI_*`, `*_Template`, `MASTER_*` for the "buyable" view) |

## 0b. Confirmed gaps in the 4.9.0 catalog (audited 2026-07-26)

Measured against the live `codex_*` tables, not assumed. Each of these makes a
stat the web app **cannot** display; closing them is extractor work.

| Gap | Evidence | Consequence in the app |
|---|---|---|
| ~~`weaponParams.fireRate` is `0` on **all 430** ship weapons that carry the struct (likewise `projectilesPerShot`, `heatPerShot` mostly)~~ **CLOSED (PR A)** — fire actions are inline structs under `fireActions` (never cross-record refs), nested inside a `SWeaponActionSequenceParams` wrapper that itself carries no `fireRate`; the concrete leaf (verified: `SWeaponActionFireSingleParams`, matched generically by the `SWeaponActionFire*` prefix + literal `fireRate` presence so burst/charge/rapid variants are covered too) is walked and the first positive `fireRate` in struct order wins. The flat `SCItemWeaponComponentParams.fireRate: 0.0` scalar is now overwritten rather than silently shadowing it. `projectilesPerShot` reads `launchParams.pelletCount` on that same leaf (NOT a top-level `projectilesPerShot` field, which doesn't exist); `heatPerShot` is the leaf's own top-level field. Verified against LIVE 4.9.0 `KLWE_LaserRepeater_S3`: `fireRate` 750 RPM, `pelletCount` 1, `heatPerShot` 0.0 (→ absent, not a stale zero) | `damagePerSecond()` in `codex-equipped-stats.ts` starts working by itself once a re-extracted P4K lands; out-of-band values (outside 30–15000 rpm) stay absent rather than guessed |
| No **spread / recoil**, **power draw**, **EM signature** or **health** on ship weapons (re-verified 2026-07-27 over all 97 size-3 ship weapons of build `b77f1586`) | `weaponParams` carries only fire-action, animation and green-zone flags; weapons have no `stats` struct at all | the **swap picker** (`codex-swap-picker.component.ts`) derives its columns from the data, so a size-3 gun table shows Alpha / Penetration / Range / Projectile speed and names DPS + fire rate as missing in its footer instead of rendering columns of `—` |
| `weaponParams.ammoContainerRecord` is `null` on **all 430** | ammo container record not resolved | **no magazine / max-ammo count.** Also forces the gun→projectile link to go through the `<weaponClass>_AMMO` name convention instead of the record reference |
| ~~Ship weapon hardpoints are stock-**empty**: only **4 of 314** ships have any `subType=Gun` in `defaultLoadout`~~ **CLOSED 2026-07-31** — **295 of 314** now do | Not a separate loadout record after all: `SItemPortLoadoutEntryParams` names its item EITHER as a literal `entityClassName` string OR via an `entityClassReference` record reference with `entityClassName` left `""`, and the extractor read only the first. It also stopped at the top level, where a gun mount — not the gun — sits. Both fixed; see §0c | the codex shows a ship's stock armament as soon as a P4K is re-extracted with an uploader that carries this change. Extracts made before it carry no guns, and the UI keeps disclosing the gap per ship |
| Coolers carry no cooling rate, power plants no power output | neither has a dedicated `SCItem*Params` struct (already noted above) | those hardpoints show durability only |
| No **per-item power draw / output** anywhere | `ItemResourceComponentParams` (present on 1 872 components) carries only `defaultPriority`, `isRelay`, `wirelessConnection` and self-repair fields; `EntityComponentPowerConnection` — the struct that holds `PowerBase`/`PowerDraw` — exists on exactly **one** non-ship entity in the whole catalog | the ship page's **Power Management** panel can report generation *count/size/durability/distortion pool* but no power triangle. Named as a gap in the panel (`codex.summary.gap.noPowerDraw`) |
| No **ship hull HP**; per-hull damage multipliers were unreachable | ship payloads carry no health struct (still open). The per-hull `ARMR_<ship>` item WAS stat-less — **closed for stats (PR A/B)**: it carries `SCItemVehicleArmorParams` — top-level signal multipliers (`signalInfrared/signalElectromagnetic/signalCrossSection`), per-channel `damageMultiplier.*` (depth 1), and now also `armorPenetrationResistance.basePenetrationReduction` (depth 1, absolute) alongside the depth-2 `armorPenetrationResistance.penetrationAbsorptionForType.*` and `armorDeflection.deflectionValue.*` per-damage-type absolutes (reached via a targeted post-step, not the generic 1-level flatten) — gated on the struct being present rather than on `AttachDef.Type` (the vehicle-armor vocabulary doesn't overlap the FPS `Char_Armor_*` one `_ARMOR_TYPES` already covered); shields still expose only `SHealthComponentParams.DamageResistances.IgnoreMeleeDamage` | the **Defence** panel shows the shield pool, regen, delays and distortion pool, and can now also show the hull's per-channel damage multipliers, penetration reduction and deflection values; hull HP itself still renders as `—` with an explicit note rather than a fabricated number |
| No **ship-level IR/EM signature** scalar; only the radar cross-section survives | `SSCSignatureSystemParams` on ships carries **no scalar IR/EM fields at all** — `baseSignatureParams`/`emissionModifierParams` are null on every spot-checked ship (verified live Nomad); the absolute-emission model needs power-draw data that isn't in the client files (see the power-draw gap above). The one real value is `radarProperties.crossSectionParams.crossSection`, a Vec3 (`x`/`y`/`z`, e.g. Nomad `6604 / 3302 / 9712`) at depth 3, now reached by a targeted post-step (`crossSection.x/y/z`) | the codex signature panel shows the three cross-section axes (max axis as the comparable KPI number) and honestly labels IR/EM as not present in the game data, rather than "awaiting upload" |
| ~~`payload.flight` is **all-null on every ship** (0 of 314 carry `scmSpeed`)~~ **CLOSED** — `VehicleComponentParams.vehicleDefinition` (a P4K-relative XML path, e.g. `Scripts/Entities/Vehicles/Implementations/Xml/CNOU_Nomad.xml`) WAS investigated as the source; decoded live (CryXmlB), it carries damage/HUD/interaction config but **no movement data at all** — it only references a `FlightController` item port by `itemType`, never inlines its params. The real source is a separate ITEM entity: the ship's default loadout carries an entry at `itemPortName` `hardpoint_controller_flight` whose `entityClassName` is `EntityClassDefinition.Controller_Flight_<Ship>`; resolving THAT record's `Components` yields a struct tagged `IFCSParams` with `scmSpeed`, `maxSpeed`, `boostSpeedForward`/`boostSpeedBackward`, and `maxAngularVelocity` (a Vec3 in CryEngine axes: `x`=pitch, `y`=roll, `z`=yaw). Verified against LIVE 4.9.0 `CNOU_Nomad` (scmSpeed 205, maxSpeed 1100, boost 450/230, pitch/roll/yaw 45/120/45), `AEGS_Gladius` (226, 1193, 520/268, 68/200/52) and `MISC_Freelancer` (197, 1050, 400/205, 32/103/32) — fighter vs. freighter agility ordering is exactly as expected. One `record_to_dict` hop per ship class, cached by class name. `boostSpeed` in the contract is forward-only (the contract has a single slot; backward boost is dropped, not guessed into it) | the ship page's **Hull & flight** block now renders real SCM/max/boost speeds and per-axis rates for every ship whose loadout resolves a `Controller_Flight_*` item (verified: all three spot-checked ships); a ship with no such port, or whose item resolves without an `IFCSParams` component, still shows `—` rather than a guess |
| **Purchase price and shop location are not in the P4K at all** (audited 2026-07-26 against the LIVE archive) | Items do carry `SCItemPurchasableParams` (10 548 records), but it holds only display/interaction fields — `displayName`, `displayThumbnail`, `allowTryOn`, `allowQuickBuy`, `interactionPoints`, … — and **no price**. `Data/Scripts/ShopInventories/Inv_<Shop>_<Location>.json` (118 files) *does* carry `BuyPrice`/`SellPrice` per item id, but **0 of 6317** of those ids resolve against `Data/Game2.dcb` — they are pre-4.0 entitlement ids, and the file set still contains 2018/2019 anniversary-sale inventories. Modern shop inventories are served from CIG's backend, not shipped in the client. | **"Where can I buy it" cannot be answered by datamining** — for FPS gear or anything else. The codex omits the section rather than showing a wrong or empty price. Community-sourced pricing (or an RSI/third-party API) would be a separate, non-extractor feature. |
| Armour damage-resistance **multipliers** are still unresolved | `SCItemSuitArmorParams.damageResistance` is a **cross-file** record reference — `record_to_dict` only inlines same-file references (and StrongPointers/inline classes); a cross-file reference is emitted as a `{_RecordId_, _RecordName_, _RecordPath_}` stub, never followed — so the generic stat dump yields the macro name (`DamageResistanceMacro.LightArmor`) but no numbers. `protectedBodyParts` (a list of references) and storage capacity (behind `containerParams`) drop out for the same reason. | the armour stat panel added in #273 shows the fields that ARE flat (temperature range, radiation, g-force, helmet optics) but no actual protection values, body coverage or SCU capacity. Fix is an explicit `record_by_id` hop — tracked as a follow-up. |

## 0c. How a ship's stock loadout is really stored (verified 2026-07-31, LIVE 4.9.0)

Measured over all 314 catalog ships in `Data/Game2.dcb`, not assumed. The stock
fit lives in `SEntityComponentDefaultLoadoutParams.loadout.entries`, a list of
`SItemPortLoadoutEntryParams`, and it hides the item in two places:

* **Two ways to name the occupant.** `entityClassName` is a bare class-name
  string on 13 346 top-level entries; on **10 972** it is `""` and the item is
  named by `entityClassReference` instead — a record reference to its
  `EntityClassDefinition` (all 16 859 references in the ship set point at one, so
  `_RecordName_` minus the `EntityClassDefinition.` prefix IS the codex class
  name). Reading only the first form is what made ship armament look absent.
* **Entries nest.** `entry.loadout` is another loadout node holding the
  sub-items of the item just installed — 10 209 sub-entries, max depth 2. This is
  where a gun mount's actual gun lives:
  `hardpoint_weapon_top_left` → `Mount_Gimbal_S3` → `hardpoint_class_2` →
  `KLWE_LaserRepeater_S3`. Same for a rack's missiles and a turret's weapon.
  The sub-port name is a port of the OCCUPANT (9 168 of 9 317 match its own
  `itemPorts`), which is how the UI pairs "3× S3 gimbal → 3× S3 repeater".

Effect of resolving both: occupied hardpoints **13 346 → 34 527** (of 36 231
entries), ships with a stock `subType=Gun` **4 → 295** of 314. 54 references
across 17 distinct class names resolve to no catalog entity — capital-ship
internals (Javelin engine covers, side-turret interiors) and one
`APAR_BallisticGatling_S4_CapitalShip`; those keep a class name with no joined
entity rather than being dropped.

There is **no** separate per-ship loadout XML: `Data/Scripts/Loadouts/Vehicles/`
holds 13 files, none of them a player ship's armament.

Crafting, by contrast, IS fully reachable — and was silently broken until this
change. A `CraftingBlueprintRecord` nests everything under a `blueprint` node
(`category` → `BlueprintCategoryRecord.*`, `processSpecificData.entityClass` →
the crafted entity, `tiers[].recipe.costs.{craftTime,mandatoryCost,
optionalCosts}` → a `CraftingCost_Select` tree whose `CraftingCost_Resource`
leaves name the material, its quantity — `SStandardCargoUnit.standardCargoUnits`
or `SMicroCargoUnit.microSCU` — and its minimum quality). The extractor read only
the record top level, so category, output class and ingredients came back null
for **all 1595** live blueprints. With the nested read: **1588 resolved output
classes and 1594 with ingredients, of which 916 are `FPSArmours` and 210
`FPSWeapons`** — i.e. most of the crafting system is FPS gear. Note the
`TimeValue_Partitioned` fields are BARE (`days`/`hours`/`minutes`/`seconds`), not
`@`-prefixed.

`codex_blueprints.output_class_name` is what makes the forward question ("which
materials does this item cost") answerable; it is indexed as of
`20260726120000_codex_fps_equipment.sql`.

Projectile stats that ARE reachable: ammunition rows carry `speed`, `lifetime`
and per-channel `impactDamage`, so alpha damage, projectile speed and range
(`speed × lifetime`) are real for ~71% of `subType=Gun` weapons. Spot-checked
against erkul.games: `KLWE_LaserRepeater_S3` → 43.65 dmg / 1480 m/s / 1924 m,
all three exact.

## 1. Output directory layout

```
<out_dir>/
  manifest.json                 # counts + quality_score + scope (IPC done event mirrors this)
  ships/<className>.json         # 1 file per ship/vehicle entity
  weapons/<className>.json        # ship + FPS weapons
  components/<className>.json     # PowerPlant/Shield/Cooler/QuantumDrive/Thruster/FuelTank/FuelIntake/CargoGrid/Other
  items/<className>.json          # every other attachable item (Cargo, Seat, Armor, Door, Paints, …)
  ammunition/<className>.json
  manufacturers/<className>.json
  records/                        # EXHAUSTIVE generic dump — every record of every type
    _index.json                   # { per_type: {Type: count}, total, n_types }
    <RecordType>/<name>__<guid8>.json   # full record_to_dict, nothing dropped
```

`records/` is the **"alle Werte von allen Spielelementen" guarantee**: ~115k
records across ~600 types, each fully resolved. The typed folders above are
curated projections of the subset Wave 2's UI needs first. `className` is the
stable join/permalink key (the `EntityClassDefinition.` / `<Type>.` prefix is
stripped).

## 2. Shared shapes

```ts
type LocalizedText = { de: string; en: string; key: string };  // key = raw global.ini key, kept for fallback/debug

type ManufacturerRef = { code: string; name: LocalizedText; className: string } | null;

type Source = { channel: string; patch: string; build: string };

interface ItemPort {
  portName: string | null;
  minSize: number | null;
  maxSize: number | null;
  types: string[];     // accepted item types (e.g. ["DockingCollar"])
  flags: string[];
  // ── hardpoint POSITION (#137 part 3) — ships only, and only when the port
  // resolved to a helper node in the hull .cga mesh. Absent/null otherwise;
  // "no position" is a valid, expected state, never an error.
  helperName?: string | null;   // the mesh helper node the port attaches to
  position?: number[] | null;   // [x,y,z] metres, hull model space
  rotation?: number[] | null;   // [x,y,z,w] mount facing, same space
}

// portName -> where that hardpoint sits on the hull. Ships only. Covers the
// default-loadout mounts too (on ships, weapon/shield hardpoints usually appear
// nowhere else) plus every `hardpoint_*` helper node of the mesh, capped at 512.
interface HardpointTransform {
  position: number[];            // [x,y,z] metres, hull model space
  rotation: number[] | null;     // [x,y,z,w]
  helper: string;                // the mesh node it resolved to (audit trail)
  source: "helper" | "portName" | "mesh";  // how the join was made
}

// The box those positions live in, so a consumer can normalise 0..1 without
// knowing the hull. `source: "ports"` means the hull bounding box was NOT usable
// as a shared frame and the extent was derived from the points — approximate.
interface HardpointFrame {
  min: number[]; max: number[];
  source: "bbox" | "ports";
}

interface LoadoutEntry {       // ships only — stock/default loadout
  itemPortName: string | null;
  entityClassName: string | null;   // join → weapons/components/items; null = port stock-empty
  // The stock fit of the item installed HERE — a gun mount's gun, a rack's
  // missiles, a turret's weapon. Sub-port names match the OCCUPANT's own
  // `itemPorts` (9 168 of 9 317 sub-entries do, measured on 4.9.0). ABSENT when
  // the occupant carries nothing and on every extract made before this field
  // existed, so "no key" means unknown, never "carries nothing".
  entries?: LoadoutEntry[];
}
```

`BaseEntity` fields present on ship / weapon / component / item:

```ts
interface BaseEntity {
  className: string;          // stable key, e.g. "AEGS_Gladius"
  guid: string;               // CIG GUID, 8-4-4-4-12 hex
  type: string;               // DataCore record.type (always "EntityClassDefinition" here)
  recordTag: string | null;   // v8 record domain tag (e.g. "Ship"), may be null
  name: LocalizedText;
  description: LocalizedText;
  manufacturer: ManufacturerRef;
  tags: string[];             // from AttachDef.Tags
  iconPath: null;             // DDS path deferred (scope) — always null in Wave 1
  source: Source;
  entityKind: "ship" | "weapon" | "component" | "item";
}
```

## 3. Per-type shapes

### ships/&lt;className&gt;.json
```ts
interface Ship extends BaseEntity {
  entityKind: "ship";
  role: string | null;            // localization KEY, e.g. "@vehicle_class_lightfighter" (resolve via strings if desired)
  crew: { size: number | null };
  vehicleName: LocalizedText;     // VehicleComponentParams.vehicleName resolved
  flight: {                       // resolved from the FlightController item's
                                   // IFCSParams struct, see §0b. Any field the
                                   // struct doesn't carry stays null (never guessed).
    scmSpeed: number | null; maxSpeed: number | null; boostSpeed: number | null; // forward boost only
    pitch: number | null; yaw: number | null; roll: number | null; // deg/s
  };
  itemPorts: ItemPort[];
  defaultLoadout: LoadoutEntry[]; // stock hardpoint → item className map
  // WHERE each hardpoint sits on the hull, parsed from the ship's .cga helper
  // nodes (CryEngine axes: +X starboard, +Y nose, +Z up; metres, never rescaled).
  // Both null when the mesh had no readable node table — the Codex then falls
  // back to its category-grouped list with no positions at all.
  hardpointTransforms: Record<string, HardpointTransform>;
  hardpointFrame: HardpointFrame | null;
  // Whitelist-only ship stats (PR A/B) — `SSCSignatureSystemParams`, same
  // struct-keyed shape as a component's `stats`. Deliberately an allowlist,
  // not the item/component blacklist — a ship's Components list is far
  // larger and noisier. Absent entirely when the whitelist finds nothing.
  // VERIFIED against the live Nomad: the struct carries NO scalar IR/EM
  // fields at all (`baseSignatureParams`/`emissionModifierParams` are null —
  // the absolute-emission model needs power data the client doesn't ship,
  // see §0b). The one real value is the radar cross-section, a Vec3 at
  // `radarProperties.crossSectionParams.crossSection` (depth 3 — reached by
  // a targeted post-step, not the generic 1-level flatten), projected as
  // `crossSection.x/y/z`.
  stats?: Record<string, Record<string, string | number | boolean | null>>;
}
```

### weapons/&lt;className&gt;.json
```ts
interface Weapon extends BaseEntity {
  entityKind: "weapon";
  weaponClass: "Ship" | "FPS";
  subType: string | null;         // AttachDef.SubType (Gun / CountermeasureLauncher / …)
  size: number | null;            // AttachDef.Size
  grade: "A"|"B"|"C"|"D"|string|null;   // AttachDef.Grade (1..4 → A..D)
  weaponParams: Record<string, scalar>; // flat scalars of SCItemWeaponComponentParams
  itemPorts: ItemPort[];          // attachments (scope, underbarrel, …)
}
```

### components/&lt;className&gt;.json
```ts
interface Component extends BaseEntity {
  entityKind: "component";
  kind: "PowerPlant"|"Shield"|"Cooler"|"QuantumDrive"|"Thruster"|"FuelTank"|"FuelIntake"|"CargoGrid"|"Other";
  attachType: string | null;      // raw AttachDef.Type
  subType: string | null;
  size: number | null;
  grade: "A"|"B"|"C"|"D"|string|null;
  // stats: map keyed by the LIVE component-params struct name → flat scalars.
  // e.g. { "SCItemShieldGeneratorParams": { MaxShieldHealth, MaxShieldRegen,
  //         DownedRegenDelay, DamagedRegenDelay, ... },
  //        "SCItemQuantumDriveParams": { jumpRange, quantumFuelRequirement, ... } }
  stats: Record<string, Record<string, scalar>>;
  itemPorts: ItemPort[];
}
```

### items/&lt;className&gt;.json
```ts
interface Item extends BaseEntity {
  entityKind: "item";
  attachType: string | null; subType: string | null;
  size: number | null; grade: string | null;
}
```

### ammunition/&lt;className&gt;.json
```ts
interface Ammunition {
  className: string; guid: string;
  speed: number | null; lifetime: number | null; size: number | null;
  impactDamage: DamageSet | null;   // best-effort; often null (damage nested elsewhere)
  raw: object;                      // full resolved AmmoParams — nothing lost
  source: Source;
}
type DamageSet = { physical; energy; distortion; thermal; biochemical; stun };
```

### manufacturers/&lt;className&gt;.json
```ts
interface Manufacturer {
  className: string; guid: string;
  code: string;                  // e.g. "AEG"
  name: LocalizedText; description: LocalizedText;
  source: Source;
}
```

### records/&lt;Type&gt;/&lt;name&gt;__&lt;guid8&gt;.json (generic)
```ts
{
  "_RecordName_": string,
  "_RecordId_": string,            // GUID
  "_RecordTag_"?: string,          // v8 only
  "_RecordValue_": { "_Type_": string, ...fully-resolved fields... },
  "_Pointers_"?: { "ptr:N": {...} }  // weak-pointer targets (unp4k/StarBreaker convention)
}
```
References resolve as: same-file sub-records inlined; cross-record/cross-file
refs as `{ _RecordId_, _RecordName_, _RecordPath_ }` stubs. WeakPointers appear
as `"_PointsTo_:ptr:N"` strings with the target under `_Pointers_`.

## 4. manifest.json
```jsonc
{
  "channel": "LIVE", "patch_version": "4.x", "build_number": "...",
  "schema_version": 1,
  "quality_score": 100.0,                 // thresholds.py over entity_counts
  "entity_counts": {
    "ships": 920, "weapons": 1326, "components": 2145, "items": 21033,
    "manufacturers": 1124, "ammunition": 235,
    "records_total": 114997,              // generic dump size
    "strings": 111990                      // en+de global.ini key count
  },
  "warnings": [], "tool_version": "...",
  "scope": { "hd_icons": true, "render_pngs": true, "component_tree": true }
}
```

## 5. Wave-2 ingest notes
- Natural key: `(channel, patch, build, className)`. `className` is unique per build.
- Expect **variant explosion**: `MASTER_*` templates, `*_Template`, `*_PU_AI_*`,
  `*_Renegade`, `*_Unmanned_*` are AI/template duplicates of player ships. A
  "buyable ships" view should filter these (heuristic: keep entities whose
  `className` has no `_AI_`/`_PU_AI_`/`_Template`/`MASTER_` token, or cross-check
  against a purchasable/loadout-assortment list — `SLoadoutAssortment`, 309 records).
- `LocalizedText` → side `entity_strings(entity_id, lang, field, value, key)` table
  scales best (matches `global.ini` shape); promote indexed columns
  (`size`, `grade`, `attach_type`, `manufacturer_code`) and keep the rest as JSONB.
- `component.stats` is heterogeneous JSONB keyed by struct name — store as JSONB,
  promote the few fields the UI sorts/filters on once they stabilize in beta.
- `ingest-bundle` edge function currently stores only manifest + counts
  (research Q7) — Wave 2 must add per-entity upsert for these tables.

---

## 6. Wave-2 → Wave-3 read contract

> **Status:** DELIVERED. Migration `00008_codex_catalog.sql` (+ `00009_codex_seed_tokens.sql`)
> applied to cloud `hcnqhvzlavdycidqyaai`. A current LIVE build is seeded.

### 6.1 Tables (schema `public`)

| Table | Holds | Promoted columns (typed, indexed) | JSONB |
|---|---|---|---|
| `codex_builds` | one catalog version per `(channel, patch_version, build_number)`; `is_current` (≤1 per channel) scopes the default UI | `channel, patch_version, build_number, is_current, quality_score, entity_counts` | `manifest` |
| `codex_manufacturers` | `SCItemManufacturer` projections | `class_name, manufacturer_code, name_localized` | `payload` (full Manufacturer JSON) |
| `codex_ships` | ship/vehicle entities (one record per game FILE, so a hull appears several times — duplicates and editions are collapsed for display by `codex-edition-group.ts`, never in the data) | `class_name, manufacturer_code, role, crew_size, is_variant, name_localized` | `payload` (full Ship JSON: flight/itemPorts/defaultLoadout) |
| `codex_weapons` | ship + FPS weapons (one flat table; `weapon_class` separates the two, and the Codex browses it through the two-level taxonomy in `codex-weapon-taxonomy.ts`) | `class_name, weapon_class, attach_type, sub_type, size, grade, manufacturer_code, is_variant, name_localized` | `payload` (weaponParams/itemPorts) |
| `codex_components` | PowerPlant/Shield/Cooler/QuantumDrive/Thruster/FuelTank/FuelIntake/CargoGrid/Other | `class_name, kind, attach_type, sub_type, size, grade, manufacturer_code, is_variant, name_localized` | `payload` (`stats` heterogeneous, keyed by struct name) |
| `codex_items` | every other attachable item | `class_name, attach_type, sub_type, size, grade, manufacturer_code, is_variant, name_localized` | `payload` |
| `codex_ammunition` | `AmmoParams` projections | `class_name, speed, lifetime, size` | `payload` (incl. `raw` AmmoParams + `impactDamage`) |
| `codex_item_ports` | hardpoints; parent = `(build_id, parent_class_name, parent_kind)` | `parent_class_name, parent_kind, port_name, min_size, max_size, types[], flags[], port_index` | — |
| `codex_entity_strings` | localized text (global.ini shape) | `entity_class_name, entity_kind, lang, field, value, loc_key` | — |

Natural key on every entity table: `(channel, patch_version, build_number, class_name)`.
Every entity also carries `build_id` (FK → `codex_builds.id`) — the compact join column.
`is_variant` flags AI/template duplicates (`MASTER_*`, `*_Template`, `*_PU_AI_*`,
`*_AI_*`, `*_Unmanned_*`, `*_Renegade`). A "buyable" view should filter `is_variant = false`.

### 6.2 RLS guarantees

- **Read:** any **authenticated** user (role `viewer` and up). No collaborator/admin
  needed — matches the `/news` authGuard-only model. Just gate the route with `authGuard`.
- **Write:** **service-role only** (no INSERT/UPDATE/DELETE policy for `authenticated`).
  Clients can never mutate the catalog; writes go through `ingest-catalog` / the seed script.
- `codex_seed_tokens` is service-role-only (RLS on, no policy) — never queried from the client.
- Verified via `get_advisors(security)`: no policy/exposure findings on any `codex_*` table.

### 6.3 supabase-js read queries (Wave 3)

Generated row types: `src/app/core/database.types.ts`. Domain read models:
`src/app/codex/codex.types.ts`. Use the cloud client (`SupabaseClientProvider`).

**Resolve the current build id (call once, cache):**
```ts
const { data: build } = await sb.client
  .from('codex_builds')
  .select('id, channel, patch_version, build_number, entity_counts')
  .eq('channel', 'LIVE').eq('is_current', true)
  .single();
const buildId = build!.id;
```

**List by kind (paged, filtered, buyable-only):**
```ts
const { data, count } = await sb.client
  .from('codex_ships')
  .select('class_name, name_localized, manufacturer_code, role, crew_size, payload', { count: 'exact' })
  .eq('build_id', buildId)
  .eq('is_variant', false)              // buyable view
  // .eq('manufacturer_code', 'AEG')     // optional facet
  .order('name_localized', { ascending: true })
  .range(0, 49);
// weapons facets: .eq('weapon_class','Ship').eq('size',3).eq('grade','A')
// components facets: .eq('kind','Shield').eq('size',2)
```

**Fuzzy search over BOTH localized names AND classNames (server-side, trigram):**
```ts
const q = 'gladius';
const { data } = await sb.client
  .from('codex_ships')
  .select('class_name, name_localized, manufacturer_code')
  .eq('build_id', buildId)
  .or(`name_localized.ilike.%${q}%,class_name.ilike.%${q}%`)  // GIN pg_trgm backs both
  .limit(25);
```
`ilike '%...%'` is index-accelerated by the per-table `*_name_trgm` / `*_class_trgm`
GIN trigram indexes. Run the same query per entity table for a global search, or
search `codex_entity_strings` (`value ilike`) for description hits.

**Detail by className (entity + ports + strings):**
```ts
const cn = 'AEGS_Gladius';
const [{ data: ship }, { data: ports }, { data: strings }] = await Promise.all([
  sb.client.from('codex_ships').select('*').eq('build_id', buildId).eq('class_name', cn).single(),
  sb.client.from('codex_item_ports').select('*').eq('build_id', buildId).eq('parent_class_name', cn).order('port_index'),
  sb.client.from('codex_entity_strings').select('lang, field, value, loc_key').eq('build_id', buildId).eq('entity_class_name', cn),
]);
// ship.payload has the full Ship JSON (flight/defaultLoadout/itemPorts);
// `defaultLoadout[].entityClassName` joins back to weapons/components/items by class_name.
```

### 6.4 What is seeded in cloud RIGHT NOW

Build `LIVE / 4.x / live-proof` (`is_current = true`). **Representative subset**
(not the full extraction — payloads are large; see note below). Real row counts:

| Table | Rows |
|---|---|
| `codex_manufacturers` | 1124 (ALL) |
| `codex_ships` | 920 (ALL; 577 flagged `is_variant`) |
| `codex_ammunition` | 235 (ALL) |
| `codex_weapons` | 400 (of 1326) |
| `codex_components` | 400 (of 2145) |
| `codex_items` | 400 (of 21033) |
| `codex_entity_strings` | 11748 |
| `codex_item_ports` | 12553 |

**To seed the FULL catalog** (all weapons/components/items): run the extractor
(`desktop-tool/python`, `python -m sc_extract.extract ...`) to an `out_dir`, then
either
- `supabase/scripts/seed-codex.mjs --out <out_dir>` with `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` (direct), or
- `... --via-function` with `SUPABASE_ANON_KEY` + `SUPABASE_SEED_TOKEN` (the
  machine never needs the service-role key; the `ingest-catalog` edge function
  writes server-side). Drop the per-kind caps to ingest everything.

The cloud DB was seeded via `ingest-catalog` (seed-token path), so no service-role
key ever touched the seeding host. The seed token used was revoked after the run.
