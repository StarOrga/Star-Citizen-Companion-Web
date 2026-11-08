# Handoff: core data layer for HQ Bestand (wave 1 -> wave 2)

Branch `claude/hq-bestand-ui-improvements-33d845-core`. Build the UI ONLY from this note. Everything below typechecks and is specced
(`src/app/hq/data/hq-bestand-data.spec.ts`). Migrations are NOT pushed to the cloud project: they must run (`npm run db:push` from the primary
checkout, then `notify pgrst, 'reload schema'` is already in the files) before the UI can write quality, friend reservations, removals,
Verkauf or gather. Until then the services degrade (reservations/removals load as empty, `ensureKinds` logs and stays "other").

## Migrations (`supabase/migrations/`)

| file | what |
|---|---|
| `20261109000100_hq_inventory_quality_reservations.sql` | `hq_inventory_items.quality` (smallint 1..1000, null = unknown) + generated `quality_key`; PK `(user_id, location, name, quality_key)`; **drops** `hq_inventory_items.reservations` (jsonb, copied into the new table first); `hq_inventory_reservations`; `hq_inventory_removals`; RPC `hq_reservations_for_me()`, `hq_reservations_mark_seen(uuid[])`; pg_cron `hq-reservations-expire` (hourly), `hq-inventory-removals-retention` |
| `20261109000200_hq_nachschub_verkauf_gather.sql` | `hq_supply_packages.goal_auec / progress_auec / sale_refs`, type `verkauf`; `hq_supplies.gather` jsonb; RPC `hq_nachschub_report_sale(uuid, numeric, text)` |
| `20261109000300_hq_codex_kinds.sql` | RPC `hq_codex_kinds(text[])` |

Dry-run: all three applied (and re-applied) in PGlite on top of the real HQ migrations; checks run: duplicate stack rejected, upsert on
`quality_key`, quality 0 rejected, friend reservation ok / non-friend rejected / over-reserve rejected / empty target rejected, the friend reads only
through `hq_reservations_for_me()` (0 rows through the table), stranger sees 0, Verkauf needs a goal, `hq_nachschub_report_sale` idempotent by ref,
gather `[]` rejected, `hq_codex_kinds` ship > weapon > item. No local Supabase stack exists on this machine; `db push` was NOT run.

## Rows and types (`src/app/hq/data/hq-db.types.ts`)

- `HqInventoryItemRow` gains `quality?: number | null` (null = unknown) and `quality_key?`. `reservations` is **still on the row type** but is filled by the
  service from `hq_inventory_reservations` (`HqStockReservation` gains `id?`, `friendId?`, `expiresAt?`), so `reservationsOf` / `availableOf` / `reservedOf`
  keep working. **One row = one stack (place, item, quality).** Never key a row by `location+name` alone any more; use `(location, name, quality ?? null)`.
- `HqReservationRow`, `HqFriendReservationRow` (friend's side), `HqInventoryRemovalRow` + `HqRemovalKind` (`take|delete|reduce|handout`),
  `HqGatherStop {location, system?, amount, quality?, done}`, `HqCodexKindRow`; `HqSupplyRow.gather`; `HqSupplyPackageRow.type` adds `'verkauf'`, `goal_auec`, `progress_auec`.

## Pure utils (all in `src/app/hq/data/`)

| export | file | use |
|---|---|---|
| `aggregateQuality(rows, by: 'place'\|'item' = 'place'): QualityAggregate[]` | `hq-quality.ts` | the Frachtdeck container: `{location, name, className, unit, qty, reserved, available, knownQty, unknownQty, avg, min, max, stacks[]}`; `stacks[]` best quality first, unknown last, each with `reservations` for the hover (I3, I4, I6) |
| `averageLabel(a)` -> `"Ø Q 780"` or null, `rangeLabel(a)` -> `"612–905"` / `"780"` / null | `hq-quality.ts` | the label strings (add i18n around them if you wish) |
| `qualityBands(stacks, width = 100): QualityBand[]` | `hq-quality.ts` | bars of "Eisen nach Qualität" (I6); unknown stack is `aggregate.unknownQty`, not a band |
| `itemIdentity({class_name, name})` | `hq-quality.ts` | stable item key (class name else name, lower-cased) |
| `lastRemovals(manual, eventsNewestFirst, current, limit = 10): Removal[]` | `hq-removals.ts` | one list: manual removals + desktop snapshot drops, newest first, no time window (I12, I13). `Removal {key, at, location, name, className, qty, unit, quality, kind: take\|delete\|reduce\|handout\|snapshot}` |
| `orderByAmount`, `moveStop`, `buildGatherStops(sources, need) -> {stops, covered}`, `gatherProgress`, `nextStop`, `withStopDone`, `parseGather`, `gatherToSteps(line, stops)`, `GATHER_MAX_STOPS = 12` | `hq-gather.ts` | gather route (D4). `buildGatherStops` uses the FREE amount (minus reservations), largest place first, trims the last stop, merges quality stacks of one place |
| `bestandKindOf(row): BestandKind {area: weapons\|armor\|ship\|other, sub, role}`, `kindsByClass`, `ARMOR_SUBS`, `WEAPON_SUBS` | `hq-codex-kind.ts` | I9 / H1. armor sub = `helmet torso arms legs undersuit backpack`; weapons sub = Codex taxonomy ids `sidearm primary heavy melee throwable gadget other` (Pistole / Primärwaffe / Schwere / Nahkampf / Wurf / Gadget); ship `role` = `ShipRole` of `codex-ship-filters.ts` (`combat transport exploration industrial support competition ground multirole`) |
| `parseQuality(raw)` | `hq-snapshot.ts` (re-exported by the service) | 1..1000 whole or null |
| `parseSellGoal(raw)`, `sellProgress(nachschub)`, `SELL_GOAL_MAX`, type `NachschubLineInput` | `nachschub/nachschub.model.ts` | Verkauf goal input ("1.500.000" ok) and progress `{earned, goal, share, reached}` |

## `HqInventoryService` (`src/app/hq/data/hq-inventory.service.ts`) - what the UI calls

New signals: `removals`, `friendReservations`, `kinds` (Map lower-cased class name -> `BestandKind`).
`HqStackRef = {location, name, quality?}` identifies a stack; **omit `quality` = first stack of that name (old behaviour); pass `null` for the unknown-quality stack**.

| method | notes |
|---|---|
| `lastRemovals(events = [], limit = 10): Removal[]` | pass `HqLiveService.events()` (newest first). Reads `removals()` + `items()`. Not a signal: call it inside a `computed` |
| `lastKnownLocation(): Promise<{name, system} \| null>` | I16: default for manual entries, from `hq_live_state.state.location` |
| `ensureKinds(classNames)` | I9/H1: call with the class names of what is shown; fills `kinds()`; idempotent, chunks of 400 |
| `addManual(location, item, qty, unit, classRef?, origin?, quality = null)` | quality is the 7th arg; upsert key is `quality_key`. `addStock(..., origin, quality?)`, `removeStock(..., classRef, quality?)` likewise (undefined = first stack) |
| `takeOut(ref, amount, kind = 'take')`, `setAmount(ref, qty)`, `deleteRow(ref)` | D3: now write a `hq_inventory_removals` row (`take` / `reduce` when `setAmount` lowers / `delete` with the whole amount). Failures of the log never fail the removal |
| `reserve(ref, amount, target: string \| {note?, friendId?, expiresAt?})` | D2: a string = old free-text form. Needs a friend or a non-empty note; amount <= free stock |
| `updateReservation(ref, reservationId, {amount?, note?, friendId?, expiresAt?})` | "editable afterwards"; `null` clears friend / expiry |
| `endReservation(ref, index, handedOut)` | unchanged signature; `handedOut` also logs a `handout` removal |
| `loadFriendReservations()` / `markFriendReservationsSeen(ids)` | the friend's side: fills `friendReservations()` (`HqFriendReservationRow`: owner name, place, item, quality, amount, note, expires, seen). Call from the friend-facing surface (e.g. Jetzt/Freunde); unseen count = `filter(r => !r.seen)` |

Friend picker: use `FriendsService.graph().friends[].user_id` as `friendId` (the DB checks `are_friends`). "Reserviert" filter grouped by friend: group
`row.reservations` by `friendId` (free-text ones under their note).
Expiry: the DB hides an expired reservation immediately (RLS + RPC filter) and deletes it hourly; `expiresAt` is shown for the live ones only.

## `HqSuppliesService` (`src/app/hq/hq-supplies.service.ts`)

`SupplyItem.gather?: readonly HqGatherStop[] | null`; `SupplyMeta.gather` on `addLine` (also sets `stepKind: 'pickup'`; adding the same item to a
Nachschub again merges the places). New: `setGather(id, stops)` (reorder / edit, line done when all ticked) and `tickGatherStop(id, index, done = true)`.
Jetzt ticks a stop with `tickGatherStop`; `gatherToSteps(line, stops)` gives the Einsatz `pickup` steps (one per stop, each with its own place).

## `NachschubService` (`src/app/hq/nachschub/nachschub.service.ts`)

- `addToNachschub(target: string | 'new', lines: NachschubLineInput[], opts?: {name?}) : Promise<NachschubResult>` - D5. An existing active id adds to it
  (repeatable, same item grows); `'new'` makes a normal Nachschub (needs a free slot; name from `opts.name`, else the naming service). Undo included.
- `createSellNachschub(goalAuec, lines, opts?: {name?})` - D6, type `verkauf`. Pass the translated name ("Geld verdienen") as `opts.name`.
- `setSellProgress(id, earned)`, `reportSale(id, auec, ref?)` (RPC, idempotent), `Nachschub.goalAuec/progressAuec`, `sellProgress(n)`.
- `NachschubLineInput {name, className, amount, unit: 'pcs'|'scu', stops?: HqGatherStop[]}`. With `stops` the line is a gather line; build them with
  `buildGatherStops(stackRows, need)` for "10 Agricium von verschiedenen Standorten". Sell lines from the Bestand pass the place as a single stop.
- New result keys the UI must translate: `hq.nachschub.sellGoalInvalid` (existing: `nothingPicked`, `slotsFull`, `linesFull`, `done.created`, `done.added`).
  Added i18n keys: none (owner of `public/i18n` is wave 2).

## Contracts / docs

`docs/contracts/hq-inventory-quality.md` (desktop writes `quality`, upsert on `quality_key`; Verkauf sale report RPC) - needs a copy/PR in the SCC-App repo.
`docs/concepts/nachschub-hq-ui-spec.md` updated for Verkauf + gather.

## Known limits (not shortfalls of a line)

- The desktop app MUST switch its inventory upsert to `on_conflict=user_id,location,name,quality_key` (old target = 42P10). Coordinate the app release with
  the migration; until then desktop writes to inventory fail.
- Reservations are keyed to a stack; a quality change in a desktop snapshot replace drops that stack's reservations (like deleting the row did before).
- A pickup step of the Einsatz still holds one place; the gather line is one supply line that expands to several steps (`gatherToSteps`).
- D7 (scrap data) is another agent's; the UI shows "unbekannt".
