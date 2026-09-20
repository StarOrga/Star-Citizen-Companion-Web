# P4K Format Notes

Star Citizen's `Data.p4k` is a modified CryEngine PAK — internally a ZIP container with custom encryption on some entries.

## What the upload pipeline does today (MVP)

`process-p4k` (Supabase edge function) downloads the **first 64 KB** of the uploaded blob and runs:

1. **Magic check** — `PK\x03\x04` for ZIP local-file-header, or `CrCh` / `CrPk` for older CryEngine variants.
2. **Header version** — read at offset 4 (little-endian uint16).
3. **Entry count estimate** — counts the `PK\x03\x04` signature occurrences in the first 64 KB. This is a lower bound (a real Data.p4k has tens of thousands of entries; the central directory is at the end of the file).
4. **Channel + version hint** — comes from the filename (regex in `src/app/p4k/p4k.service.ts`):
   - `(live|ptu|eptu|tech-preview)` token before/after a separator → channel
   - `\d+\.\d+(\.\d+)?` → version (e.g. `3.24.1`, `4.0_eptu`)

The result row in `p4k_uploads.result` looks like:

```json
{
  "magicOk": true,
  "magic": "PK",
  "headerVersion": 20,
  "estimatedEntries": 412,
  "fileSizeBytes": 80523776,
  "channelHint": "live",
  "versionHint": "3.24.1",
  "notes": ["ZIP local-file-header version = 20"],
  "parsedAt": "2026-05-17T..."
}
```

## What we explicitly do NOT do (yet)

- **Full ZIP central-directory parsing.** Would need the last 64KB + size of central directory. Add when phase flips to beta.
- **Decryption** of CryEngine-encrypted entries. The encryption key has been reverse-engineered by the SC community for read-only inspection but is not redistributed here.
- **Manifest.xml extraction.** Phase 2 goal — once we have central-directory parsing.
- **Ship/weapon catalog ingestion.** Phase 3 goal — feeds the loadout planner (erkul-style).

## File size limits

- Frontend cap: `environment.storage.maxP4kSizeMb = 200`. Production Data.p4k is ~150 GB — out of scope. We currently only accept slices/extracts.
- Storage bucket cap: 300 MB (`file_size_limit = 314572800` in migration `00002`). Upload above this hits a Supabase 413.

## FPS equipment + shop data (audited 2026-07-26 against the LIVE archive)

Findings worth not re-deriving — all measured, not assumed:

- **Wearables** are `EntityClassDefinition` records whose
  `SAttachableComponentParams.AttachDef.Type` is `Char_Armor_{Helmet,Torso,Arms,
  Legs,Undersuit,Backpack}`, `Char_Clothing_{Torso_0..2,Legs,Feet,Hat,Hands,
  Backpack}` or `Suit`. `SubType` carries the weight class (`Light`/`Medium`/
  `Heavy`), NOT the slot. `Char_Body`, `Char_Head*` and `Char_Accessory_Head` are
  creature/cosmetic, not player gear.
- **`record_to_dict` does not follow record references** at any `max_depth` — it
  emits `{_RecordId_, _RecordName_, _RecordPath_}` stubs. This is the trap behind
  the armour stat block: `SCItemSuitArmorParams.damageResistance` is a reference
  to a `DamageResistanceMacro` (only 12 macros back all 2298 armour pieces), and
  carry capacity sits behind an `InventoryContainer` reference. The generic
  `_component_stats()` dump therefore yields the macro's *name*
  (`damageResistance._RecordName_ = "DamageResistanceMacro.LightArmor"`) but none
  of the actual per-channel multipliers; `protectedBodyParts` is a list of
  references and is dropped entirely. Resolving those needs an explicit second
  `record_by_id` hop — worth caching, since a dozen macros are shared by
  thousands of items. **Still open as of #273** (see issue for the follow-up).
  The multipliers, once resolved, are the share of damage that GETS THROUGH
  (lower = better), so a UI must invert them.
- **Shop / price data is NOT in the P4K.** `SCItemPurchasableParams` carries no
  price, and the `Data/Scripts/ShopInventories/Inv_*.json` files that do carry
  `BuyPrice` use a pre-4.0 id space (0 of 6317 ids resolve against `Game2.dcb`).
  Don't build a "where to buy" feature on datamining.
- **Crafting is in the P4K**, under `CraftingBlueprintRecord.blueprint.*` — see
  `docs/concepts/codex-extraction-output.md` §0b for the exact nesting.

## Ship default loadouts (verified 2026-07-31 against LIVE 4.9.0)

There is **no separate loadout record** to chase — the trap is subtler, and it
cost us a whole "ships look unarmed" gap. `SEntityComponentDefaultLoadoutParams
.loadout.entries` holds `SItemPortLoadoutEntryParams`, and each one names its
item in **one of two** ways:

| field | count (top-level, all 314 catalog ships) |
| --- | --- |
| `entityClassName` — a bare class-name string | 13 346 |
| `entityClassReference` — a record ref, with `entityClassName` `""` | 10 972 |

All 16 859 references in the ship set point at an `EntityClassDefinition`, so
`_RecordName_` minus its type prefix is the class name the codex joins on.

Entries also **nest**: `entry.loadout` is a further loadout node carrying the
sub-items of the item just installed (10 209 sub-entries, max depth 2). A gun
mount is what bolts to the hull; the gun sits one level down —
`hardpoint_weapon_top_left` → `Mount_Gimbal_S3` → `hardpoint_class_2` →
`KLWE_LaserRepeater_S3`. The sub-port name is a port of the OCCUPANT itself
(9 168 of 9 317 match the occupant's own `itemPorts`), which is the join that
lets a consumer pair a mount with what it carries.

`sc_extract/dataforge_extract.py::_loadout_entries` reads both forms and the
nesting. `Data/Scripts/Loadouts/Vehicles/` (13 files) is a red herring — no
player ship's armament is there.

## Power / energy per module — the resource network (schema 3)

Every powered item's energy numbers live in `ItemResourceComponentParams`, but
**not** where a generic dump finds them: they sit inside `states[]` and its
nested `deltas[]`, and both are **lists**, which the extractor's generic
depth-2 flatten drops entirely. A pre-schema-3 build therefore ships that
struct looking populated — `isRelay`, `defaultPriority`, `selfRepair.*` — while
carrying *zero* power values. That is the single most misleading shape in this
data set: the group is present, so "does the item have resource data?" answers
yes and every actual number still reads `null`.

`dataforge_extract.py::_add_resource_network` (schema 3, PR #523) projects the
lists into flat, **state-prefixed** keys — `online.power.consumeSegments`,
`online.power.generateSegments`, `online.power.minFraction`,
`online.coolant.{consume,generate}`, `online.em.nominal`, `online.ir.nominal`,
plus `stateNames` — and the web app reads the prefixed form **only**, with no
bare-key fallback (`test_resource_stats_contract.py` is the tripwire).

Consequences worth not re-deriving:

- A cooler's cooling rate and a power plant's output are **not** missing from
  the game files, as older comments in `codex-equipped-stats.ts` claimed. They
  are `online.coolant.generate` / `online.power.generateSegments` and appear the
  moment a build is extracted at schema 3.
- Components draw whole `SPowerSegmentResourceUnit` segments; weapons draw
  fractional `SStandardResourceUnit` power. **4/3 standard units = 1 segment**
  (`STANDARD_UNITS_PER_SEGMENT` in `codex.types.ts`) — the one conversion that
  puts a repeater and a cooler on a comparable scale.
- Nothing in the app can backfill this. `codex_builds.schema_version` is written
  by the uploader that produced the extract, so per-module energy stays blank
  until the admin re-runs the data uploader. Checked 2026-09-08: the `is_current`
  LIVE 4.10.0 build was extracted with tool 0.25.3 at schema **2**, ~5 h before
  #523 merged — which is why the energy dock reports `reExtractPending`.

## Weapon → round link (schema 6, verified 2026-09-18 against LIVE 4.10)

`SCItemWeaponComponentParams.ammoContainerRecord` is **null on every ship
weapon** — all ship guns, rocket pods, beams and all 188 countermeasure
launchers — and there is no `<launcher>_AMMO` naming convention. Two prior
readers waited on that field; it is the wrong one. The round a ship weapon
fires sits on the weapon entity's **own** component:

```
EntityClassDefinition.<weapon>.Components[_Type_ == "SAmmoContainerComponentParams"]
  .ammoParamsRecord  → { _RecordId_, _RecordName_: "AmmoParams.<class>", _RecordPath_ }
  .maxAmmoCount      → magazine (48 flares / 5 chaff on a Nomad; a literal 0 on
                        energy weapons, int32 max on salvage heads)
```

FPS weapons are the one family that does use `ammoContainerRecord`: it points
at a separate magazine entity, whose own `SAmmoContainerComponentParams`
carries the same fields (second hop, `_weapon_ammo_link`). Coverage on the
probe: 188/188 launchers (only five rounds exist: BEHR_Flare, TALN_Chaff,
JOKR_Flare, JOKR_Chaff, NOVA_Chaff), 195/196 ship guns + rocket pods — 50 of
them with a round NOT named `<class>_AMMO` (bespoke turrets, PDCs, `RPOD_*`
rocket pods, Idris/LowPoly variants) that the convention silently missed —
390/395 FPS weapons (binoculars carry none), every tractor / towing / salvage
beam (placeholder rounds: `VehicleBullets`, a rifle laser bolt — the web
ignores the salvage head's). Never resolved: mining lasers (no container) and
`BEHR_JavelinBallisticCannon_S7_LowPoly` (container without a round).

Emitted as `weaponParams.ammoClassName` / `ammoGuid` / `ammoCapacity`;
`tests/test_weapon_ammo_link.py` + `tests/fixtures/live_weapon_ammo_links.json`
pin the live shapes. The web (`ammoClassNameFor`) prefers the explicit name
and keeps the `<class>_AMMO` convention only for builds below schema 6.

## Ivo geometry chunks — hardpoint positions (reverse-engineered 2026-07-26)

`scdatatools` 1.0.4 cannot parse SC 4.x Ivo *geometry* chunks, so
`sc_extract/geometry.py` reads them directly. Verified layout (`#ivo` v0x900:
16-byte file header, then a 16-byte-per-chunk header table of `type u32`,
`version u32`, `offset u64`; a chunk runs to the next chunk's offset):

| chunk type   | what it holds | how it is read |
| ------------ | ------------- | -------------- |
| `0x92914444` | AABB (ship L/W/H) | first plausible `(min,max)` float-triple pair, byte offset 24 |
| `0xc201973c` | NAME table | `count` at 0, 16-byte entries at 48 (`crc32(name)` … `u16 node_index`), then a NUL-separated string blob; a name belongs to a node when its CRC-32 is in the table |
| `0x70697fda` | NODE table | count in the 2nd u32, records from offset **64** at a **208-byte** stride, each starting with two row-major `Matrix34` (model-space, then parent-relative) |

Verified against `AEGS_Gladius` (273/273 names resolved) and
`DRAK_Cutlass_Black` (209/209); every rotation block orthonormal. Both readers
self-validate (the node walk re-derives the stride by requiring EVERY rotation
block to be orthonormal) and return nothing rather than a fabricated coordinate.

This is the **only** place a hardpoint's position on the hull exists — the
DataCore stores just the helper node's NAME
(`SItemPortDef.AttachmentImplementation.Helper.Helper.Name`) plus a relative
offset. `sc_extract/hardpoints.py` joins the two by **exact** node-name match
(helper name, else the port name itself); a near-miss yields no position.
Coordinates are metres in the hull mesh's model space, CryEngine axes
(`+X` starboard, `+Y` nose, `+Z` up), never rescaled.

Opening `Data.p4k` costs ~24 s and reading/decompressing `Data/Game2.dcb`
(330 MB) another ~2 min; cache the raw `.dcb` bytes to disk when iterating on
extraction logic instead of re-reading the archive.

## Top-down silhouettes from the hull mesh (2026-09-20, Holotable ship view)

`data-uploader/python/sc_extract/silhouette_export.py` + `silhouette.py` turn
the raw hull (`.cga` + its `.cgam` geometry) of every ship, weapon, component
and armour entity listed in the extract manifest into one normalised outline:
cgf-converter → glTF (**Y-up** — rotate `(x, y, z) → (x, −z, y)` to get back to
Cry `+X` starboard / `+Y` nose / `+Z` up before projecting, otherwise you get a
front cross-section), drop Z, rasterise at 1024 px, keep every component
≥ 64 px² as its own subpath (nacelles on thin struts), reverse the winding of
holes, Chaikin ×2, Douglas-Peucker with tolerance
`max(0.15 m, 0.3 % of span, 1.5 px)` (an absolute 0.15 m blew the 200k-char
path cap on capital ships), then centre into a 1000-unit viewBox. Hardpoint
anchors go through the **same** min/scale/offset as the path (% of the
viewBox — the `hardpointFrame` AABB from `geometry.py` is a different box).
Cache key = sha of `.cga` + `.cgam` + the tuning constants. Output contract:
`docs/concepts/2026-09-20-codex-schiffsansicht-cinematisch-build/wave0-research.md`
§C1; landing table `codex_silhouettes` (see `supabase.md`). **Not yet run
against a LIVE archive** as of the ship — the first real run is a hand-off.

## References

- CryEngine PAK overview: <https://wiki.starcitizenbase.com/wiki/Data.p4k>
- Star Citizen Tools — file format reverse-engineering: <https://wiki.starcitizen.tools>
- erkul.games does parsing client-side (uploads stay local). We chose server-side for now to simplify the first MVP — re-evaluate when file size becomes a constraint.
