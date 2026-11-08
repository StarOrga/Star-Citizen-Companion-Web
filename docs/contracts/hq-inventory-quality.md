# HQ inventory quality contract (desktop <-> SCC-Web)

Contract version: 1 (2026-11-09, migration `20261109000100_hq_inventory_quality_reservations.sql`).
Companion of `hq-live.md`. The desktop app writes the field **`quality`** on `hq_inventory_items`.

## The field

| column | type | meaning |
|--------|------|---------|
| `quality` | `smallint`, `1..1000`, nullable | The quality the game shows for the stack (materials: 1-1000 as in the inventory/refinery UI). **`null` = unknown**, never `0`. Out-of-range values are rejected (`hq_inv_item_quality`). |
| `quality_key` | `smallint`, **generated** (`coalesce(quality, 0)`) | The nullable quality as a key column. Never written by a client, only named in `on_conflict`. |

## One stack per (place, item, quality)

The primary key of `hq_inventory_items` is now `(user_id, location, name, quality_key)`.
Two qualities of the same item at one place are two rows; the same quality adds up in ONE row (the
app sums what it reads for that quality, the web aggregates the stacks to "Eisen: Ø Q 780, 612-905").

## What changes for the desktop writer

1. **Upsert target.** `on_conflict=user_id,location,name,quality_key` (was `user_id,location,name`).
   The old target no longer matches a unique constraint and PostgREST answers `42P10`. A plain
   delete + insert of a whole place (snapshot replace) keeps working unchanged.
2. **Write `quality`** per row when the OCR/log read gives one; omit it (or `null`) when not read.
   A row without quality is the "unknown quality" stack of that item.
3. **Replace semantics are per place, as before.** A new snapshot of a place replaces all of the
   place's rows (all qualities). The web's "undo" restores the previous snapshot with its qualities
   (`hq_live_events.applied.previous.items[].quality`, optional number or null - please include it).
4. `item_count` of `hq_inventory_snapshots` counts **stacks** (rows), max 400 per place as before.
5. **Reservations** (`hq_inventory_reservations`) belong to one stack
   `(user_id, location, name, quality_key)` and are removed with the stack (cascade). The app does not
   write them. A snapshot replace therefore drops the reservations of replaced rows - same behaviour
   as the former jsonb column. Prefer upserting changed rows over delete + insert where you can.

## Other tables of this release the desktop may meet

- `hq_inventory_removals` (web-written, owner-only): manual removals for "zuletzt aufgebraucht". The app
  does not write it; its own drops stay `inventory.snapshot` events.
- Sales: a sale the app observes may be reported to a Verkauf Nachschub with
  `rpc hq_nachschub_report_sale(p_package_id uuid, p_auec numeric, p_ref text)` -> new progress (numeric).
  `p_ref` (use the sale's `hq_live_events.id`) makes a re-sent report a no-op; the call is `SECURITY INVOKER`,
  so it only touches the signed-in user's own `type = 'verkauf'` Nachschub. Returns `null` when nothing matched.

## Compatibility

Rows written before the migration keep `quality = null`. A client that never sends `quality` but uses the
new `on_conflict` behaves exactly as before. The web falls back to "quality unknown" everywhere.
