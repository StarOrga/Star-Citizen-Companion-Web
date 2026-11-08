# HQ inventory quality contract (desktop <-> SCC-Web)

Contract version: 1 (2026-11-09, migration `20261109000100_hq_inventory_quality_reservations.sql`).
Companion of `hq-live.md`. The desktop app writes the field **`quality`** of the table **`hq_inventory_stacks`**.

## Backward compatible by design

The released desktop app keeps working unchanged. `hq_inventory_items` keeps its primary key
`(user_id, location, name)` and its meaning: **one row per item and place with the TOTAL qty**. The old
upsert `on_conflict=user_id,location,name` stays valid. The old app writes no stacks, so all of its
quality is "unknown" in the web.

## The optional stacks endpoint

`hq_inventory_stacks` splits an item row's total by quality. A new app writes stacks IN ADDITION to the item row.

| column | type | meaning |
|--------|------|---------|
| `user_id` | uuid | JWT `sub` (default `auth.uid()`) |
| `location`, `name` | text | the item row it belongs to (FK `(user_id, location, name)` -> `hq_inventory_items`, **on delete cascade**) |
| `quality` | smallint, **1..1000**, not null | the quality the game shows. A share without a known quality is simply not written. |
| `qty` | numeric, > 0 | the amount of that quality |

Primary key `(user_id, location, name, quality)`. Upsert with `on_conflict=user_id,location,name,quality`.
RLS: owner-only select / insert / update / delete, like the items table.

## Mismatch rule (the item qty is the truth)

- **Unknown quality = `item.qty - sum(stacks.qty)`.** The remainder is shown in the web as "Qualität unbekannt".
- A stack write is **refused** (`check_violation`) when it would push `sum(stacks)` above the item qty. Write order:
  raising the amount = item row first, then stacks; lowering = stacks first, then the item row.
- If an OLD app (or a manual write) lowered the item qty so that `sum(stacks) > qty`, the stacks are **stale** and the
  web ignores them (everything unknown) until the new app rewrites them. The view `hq_inventory_item_quality`
  (`stacked_qty`, `unknown_qty`, `stale` per item) states this.
- Deleting the item row (including the snapshot replace "delete + insert" of a place) cascades its stacks and
  reservations. Prefer upserting changed rows over delete + insert where you can.
- Caps: at most 20 qualities per item, 3000 stacks per user; `hq_inventory_snapshots.item_count` still counts item rows.

## Snapshot replace

Write the item rows exactly as before (`on_conflict=user_id,location,name`, total qty), then the stacks of every item whose
qualities were read. Items without readable quality get no stack rows.

## Other tables of this release the desktop may meet

- `hq_inventory_reservations` (web-written; the app does not write it): reservations reference `(location, name)` and have
  an optional `quality` (null = any stack).
- `hq_inventory_removals` (web-written, owner-only): manual removals for "zuletzt aufgebraucht".
- Sales: a sale the app observes may be reported to a Verkauf Nachschub with
  `rpc hq_nachschub_report_sale(p_package_id uuid, p_auec numeric, p_ref text)` -> new progress (numeric).
  `p_ref` (use the sale's `hq_live_events.id`) makes a re-sent report a no-op; the call is `SECURITY INVOKER`, so it only
  touches the signed-in user's own `type = 'verkauf'` Nachschub. Returns `null` when nothing matched.
