# Codex Blueprint — Web ↔ Desktop App Alignment

*Date: 2026-06-19 | Status: reference*

## Purpose

Documents how the web `CodexBlueprint` entity (web repo) maps to the app-side
`CodexEntity` with `kind: 'blueprint'` (app repo `modules/shared/codex-connect.contract.ts`),
so both sides stay consistent when the schema evolves.

---

## Web-side blueprint shape (`codex.types.ts`)

| Field | Type | Source column |
|---|---|---|
| `classNameSlug` | `string` | `codex_blueprints.class_name` |
| `nameLocalized` | `string \| null` | Resolved i18n from `codex_entity_strings` |
| `category` | `BlueprintCategory \| string \| null` | `codex_blueprints.category` |
| `tier` | `number \| null` | `codex_blueprints.tier` |
| `craftTimeSec` | `number \| null` | `codex_blueprints.craft_time_sec` |
| `dismantleTimeSec` | `number \| null` | `codex_blueprints.dismantle_time_sec` |
| `payload` | `BlueprintPayload` | `codex_blueprints.payload` (JSONB) |

`BlueprintCategory` (web union):
`ship_components | fps_weapons | ship_weapons | consumables | armor | clothing | food | medicine | other`

`BlueprintPayload` exposes `tier`, `craftTimeSec`, `dismantleTimeSec`, `outputClassName`,
`outputQuantity`, and `qualityStats[]`. These are also promoted as top-level columns on
`CodexListRow` via `blueprintCategory`, `blueprintTier`, and `craftTimeSec` for list-view
use without payload deserialization.

---

## App-side entity shape (`codex-connect.contract.ts`)

Blueprints are exposed as `CodexEntity` with `kind: 'blueprint'` and
`category: 'blueprint'` (a first-class `CodexCategory`).

Relevant fields on `CodexEntity`:

| Field | Source |
|---|---|
| `blueprintCategory` | `codex_blueprints.category` — the web's `BlueprintCategory` string, passed through verbatim |
| `stats.craftTimeSec` | `codex_blueprints.craft_time_sec` (seconds, number) |
| `stats.dismantleTimeSec` | `codex_blueprints.dismantle_time_sec` (seconds, number) |
| `stats.blueprintTier` | `codex_blueprints.tier` (integer, 1–5) |
| `subType` | Always `null` for blueprints (the kind has no subType column) |

---

## Category mapping

The web `BlueprintCategory` values flow into `CodexEntity.blueprintCategory` without
remapping. The app UI uses `blueprintCategory` as a sub-filter facet inside the
`blueprint` `CodexCategory` (see `CodexFacetFilter.blueprintCategory`).

SC item sub-classifications (`subType`) are NOT used for blueprints — the output item's
sub-classification lives in the output entity's own row, not in the blueprint.

```
Web BlueprintCategory   →  App CodexEntity.blueprintCategory
─────────────────────────────────────────────────────────────
ship_components         →  "ship_components"
fps_weapons             →  "fps_weapons"
ship_weapons            →  "ship_weapons"
consumables             →  "consumables"
armor                   →  "armor"
clothing                →  "clothing"
food                    →  "food"
medicine                →  "medicine"
other                   →  "other"
```

---

## Consistency rules

1. **Category strings are canonical** from the web extractor. The app must not rename
   them; any new category added to web `BlueprintCategory` must be handled gracefully
   (fall through to `"other"` filter bucket) by the app without a code change.

2. **Time values are always seconds** (`craftTimeSec`, `dismantleTimeSec`). The app
   stats bag stores the raw number; display formatting (e.g. "2m 30s") is the renderer's
   responsibility.

3. **Tier is 1-based integer** (1 = basic, 5 = advanced). Null means no tier data in
   this build — render as "—" in the UI.

4. **`blueprintTier` key in `stats`** is the canonical bag key. Do not use `tier`
   (ambiguous with ship/weapon tier in other entity kinds).

5. **Ingredients are not synced to the app SQLite mirror** in Wave 1. The app only
   holds the blueprint header row. Full ingredient lists remain web-only.
