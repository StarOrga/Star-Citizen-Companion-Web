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
| Ship flight stats (SCM/pitch/yaw/accel) on the entity | live entity `VehicleComponentParams` does **not** carry them; they live in the referenced `vehicleDefinition` XML record (not yet resolved) | `ship.flight.*` emitted but **all null** (research Q1 — left nullable, not guessed) |
| Component stats under fixed struct names | real struct names differ (`SCItemShieldGeneratorParams`, `SCItemQuantumDriveParams`, `EntityComponentPowerConnection`, …); PowerPlant/Cooler often have no dedicated params struct | `component.stats` is a **map keyed by the live struct name** → flat scalars, not a fixed schema |
| Ammo `Ammunition.{Speed,Range,Size,Capacity}` + 6-ch damage | `AmmoParams` carries `speed/lifetime/size` directly; damage is nested under projectile params, not a flat `damage` block | ammo keeps a `raw` blob with everything; typed fields are best-effort |
| ~180 ships, ~250 weapons, ~600 components | **920 ships/vehicles, 1326 weapons, 2145 components, 21033 items, 1124 manufacturers, 235 ammo** (includes AI variants/templates) | counts are much higher; Wave 2 should expect variant rows (filter `*_PU_AI_*`, `*_Template`, `MASTER_*` for the "buyable" view) |

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
}

interface LoadoutEntry {       // ships only — stock/default loadout
  itemPortName: string | null;
  entityClassName: string | null;   // join → weapons/components/items; null = port stock-empty
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
  flight: {                       // ALL NULL in Wave 1 (see §0 / research Q1)
    scmSpeed: null; maxSpeed: null; boostSpeed: null;
    pitch: null; yaw: null; roll: null;
  };
  itemPorts: ItemPort[];
  defaultLoadout: LoadoutEntry[]; // stock hardpoint → item className map
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
