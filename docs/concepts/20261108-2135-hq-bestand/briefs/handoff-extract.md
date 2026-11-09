# Handoff D7 - scrap data (extract)

Branch `claude/hq-bestand-ui-improvements-33d845-extract`.

## Finding

The Codex pipeline that carries `dismantle_*` is `codex_builds` / `ingest-catalog` (table `codex_blueprints`, a view over `codex_blueprints_rows` since 20261102100000). In the game files dismantling is ONE global `GenericCraftingBlueprint` record with `GenericCraftingProcess_Dismantle` (efficiency + time); the repo holds no fixture of a per-item yield. The real yield field is therefore NOT identified: the extractor reads hypothesised keys and stays null otherwise.

## Fields (codex_blueprints, keyed by `output_class_name` = the item)

| Column | Type | Meaning |
|---|---|---|
| `dismantle_yield` | jsonb `[{material, amount}]` | NULL = unknown |
| `dismantlable` | boolean | true/false as stated by the record; NULL = unknown (never false by guess) |

Payload JSON carries the same as `dismantleYield` / `dismantlable`.

## Where

- Extractor: `data-uploader/python/sc_extract/dataforge_extract.py` - `_dismantle_yield`, `_dismantlable_flag`, tuples `_DISMANTLE_YIELD_*` / `_DISMANTLABLE_FLAGS` (the named extraction hook; narrow them once a real record is inspected).
- Mapping: `data-uploader/src/lib/catalog-map.ts` (`mapBlueprints`), `supabase/scripts/seed-codex.mjs`.
- Migration: `supabase/migrations/20261109000500_codex_blueprint_dismantle_yield.sql` (adds columns to `codex_blueprints_rows`, re-creates the view). Not pushed; not dry-run (no Docker/psql here) - run `begin; <file>; select dismantle_yield, dismantlable from codex_blueprints limit 1; rollback;` on a stack before `db push`.
- Ingest: no function change - `codex_upsert_rows` takes the column list from the row keys and `codex_carry_over` copies all base columns.

## Accessor (`src/app/hq/data/scrap-info.ts`)

```ts
scrapInfo(row: ScrapRow | null | undefined): { state: 'yes'|'no'|'unknown'; yield?: {material: string; amount: number}[] }
scrapInfoOf(className, index: ReadonlyMap<string, ScrapRow>): ScrapInfo
ScrapInfoService.load(classNames: string[]): Promise<void>   // fills a signal index from codex_blueprints
ScrapInfoService.info(className): ScrapInfo                  // reactive, 'unknown' until loaded
```

`no` only on explicit `dismantlable === false`; `yes` on true or a non-empty yield; everything else `unknown`. The UI must render `unknown` as "unbekannt" (new i18n key is the UI agent's).

## Needs a real uploader run

All values are NULL today. A real `Data.p4k` extraction must show whether the dismantle process (or the item's own record) names a yield; if the key differs from the hypotheses, adjust the tuples, then re-run the uploader. Items without their own blueprint (shop/loot items) have no row at all and stay `unknown` until a source for them is found.
