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

Opening `Data.p4k` costs ~24 s and reading/decompressing `Data/Game2.dcb`
(330 MB) another ~2 min; cache the raw `.dcb` bytes to disk when iterating on
extraction logic instead of re-reading the archive.

## References

- CryEngine PAK overview: <https://wiki.starcitizenbase.com/wiki/Data.p4k>
- Star Citizen Tools — file format reverse-engineering: <https://wiki.starcitizen.tools>
- erkul.games does parsing client-side (uploads stay local). We chose server-side for now to simplify the first MVP — re-evaluate when file size becomes a constraint.
