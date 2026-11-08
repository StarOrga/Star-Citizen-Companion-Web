# HQ live contract (desktop <-> SCC-Web)

Contract version: 2 (2026-11-05). This file exists in BOTH repos (SCC-App
`docs/contracts/hq-live.md`, SCC-Web copy); a change needs both repos. The web repo holds an
identical copy at `docs/contracts/hq-live.md` - keep the two byte-identical.

Writer: SCC-App `modules/desktop/src/hq-live-sync-service.js` with the user's SCC
session token (PostgREST, RLS self-only). Reader: the web HQ (Jetzt, Bestand, Statistik).

## Opt-in

- `hq.liveSync.enabled` (default false): events + state. `hq.inventory.ocr.enabled`
  (default false): inventory writes. Independent. Off or signed out = no request.
- Tombstones on synced tables are `deleted_at timestamptz` (never a boolean).

## Tables written by the desktop

### `hq_live_events` PK (user_id, id)

| column | desktop writes | note |
|--------|----------------|------|
| user_id uuid | JWT `sub` | |
| id text | sha1 hex | rule below |
| type text | allowed type | list below |
| data jsonb | sanitized, **< 2 KB** (`pg_column_size < 2048`); desktop caps the JSON text at **1800 bytes** because the jsonb binary form can exceed its text | |
| at timestamptz | event time (ISO, UTC) | |
| applied jsonb null | only on `inventory.snapshot` | web owns it otherwise |
| undone bool | never | web owns it |
| synced_at | server default | |

Upsert: `POST ...?on_conflict=user_id,id` with
`Prefer: resolution=ignore-duplicates,return=minimal` - **never merge**; a resend must
not reset `applied` / `undone`.

**Event id:** `sha1( type + "|" + at + "|" + stableJson(data) )`, hex. `at` = ISO-8601 UTC
with milliseconds; `stableJson` = JSON with recursively sorted keys, no whitespace; `data`
is the sanitized object that is also stored (including `unitPrice`). Same log line -> same
id across restarts and re-reads.

**Allowed types** (`GAMELOG_EVENT_TYPES` minus `character.login`, `mobiglas.opened`,
`mobiglas.state`, plus `inventory.snapshot`): `session.joined`, `session.quit`,
`disconnect`, `hangar.ready`, `hangar.queue`, `restricted.entered/exited`,
`crime.crimestat_increased`, `crime.committed`, `crime.fined`, `crime.impounded`,
`contract.accepted/completed/failed/abandoned/objective`, `qt.target`, `qt.arrived`,
`injury`, `incapacitated`, `medbed.healed`, `vehicle.destroyed`,
`party.qt_to_you`, `party.calibration_started/complete`, `party.member_joined/left`,
`refinery.complete`, `armistice.entered/exited`, `monitored.down/restored/entered/exited`,
`shop.purchase`, `shop.purchase_failed`, `insurance.claim_requested/complete`,
`jurisdiction.changed`, `fuel.low`, `blueprint.received`, `mobiglas.app`,
`inventory.opened`, `inventory.snapshot`. Data shapes: SCC-App `docs/features/gamelog.md`.

**Privacy filter:** keys `member`, `members`, `victim`, `player`, `playerName`,
`characterId`, `geid`, `handle` are removed, so party events carry only `{ key }`.
No chat. Strings <= 200 chars.

**Fields the web stats read:**

| type | fields |
|------|--------|
| `shop.purchase` | `kind` buy/sell, `price` = TOTAL line amount, `unitPrice` = price / quantity, `quantity`, `item`, `shop`, `result` |
| `contract.completed` | `name`, `missionId` |
| `incapacitated`, `crime.crimestat_increased`, `insurance.claim_complete`, `blueprint.received` | event existence (+ data as in gamelog.md) |
| `refinery.complete` | `count`, `location` |

Price: the log's `client_price[...]` is sent as `price` and treated as the **total** of
the request (it is the amount the client displays and the server validates for the whole
`quantity`). This is not yet verified against a quantity > 1 purchase in a real log (the
fixtures use synthetic lines); if it turns out to be per unit, the desktop changes to
`price = unit * quantity` and the contract version is bumped.

**`inventory.snapshot`** (written by the OCR path): `data = { location, source: 'ocr',
item_count }`, `applied = { kind: 'snapshot', replaced: bool, previous: { snapshot: <hq_inventory_snapshots row>,
items: [<hq_inventory_items rows>] } | null }`. Undo = write `previous` back (`kind` lets the
web pick the undo handler).

### `hq_live_state` PK user_id

`state jsonb` (< 16 KB; desktop caps at 15 KB), `updated_at`. One row per user: the
sanitized `gamelog.state.changed` snapshot (location, jurisdiction, currentShip,
contracts, crimestat, lastQt, ...). Written at most once per 10 s, only when changed.
Upsert `on_conflict=user_id`, merge.

**Life sign (v2):** `state.presence = { gameRunning: bool, at: ISO-8601 UTC }`. The desktop checks
every 60 s, writes each time while the game runs and once when it stops. The web shows a location
as current only while `gameRunning` is true and `at` is younger than 3 minutes; a missing or stale
`presence` means no signal (app closed, crashed, or older than this contract).

The life sign outranks older session events: replay events are never published, so when the app
attaches to the log of a running game the `session.joined` never arrives and the previous session's
`session.quit` stays the newest session event. Only a `session.quit` / `disconnect` newer than
`presence.at` ends live, and so does `state.lastDisconnect` when its `at` is not before
`state.sessionStartedAt` and `recapConsumed` is not set (the client is back in the menu, the process
still runs).

### `hq_inventory_snapshots` PK (user_id, location)

`location text, system text|null, source text, taken_at timestamptz, item_count int`. A new
snapshot replaces the old one (merge upsert). Desktop source value: `ocr`.

### `hq_inventory_items` PK (user_id, location, name)

`class_name text|null, name text, qty numeric, unit 'pcs'|'scu'`. Per location the desktop
upserts the new list first (names merged case-insensitively, qty summed), then deletes only
the old names that are not in it - never a delete-all-then-insert, so a failure in between
cannot empty the location.

`reservations jsonb` (web-only, default `[]`): `[{ amount, note, at }]`, part of `qty` earmarked
for someone or something ("Spieler X", "Verkauf"); available = `qty` minus their amounts. The
desktop never writes it: its upsert leaves the column alone, and a name it deletes takes its
reservations with it.

### `hq_ship_storage` (user_id, ship_ref, location, source, taken_at)

Upsert `on_conflict=user_id,ship_ref` merge. (All conflict targets were verified against the
web migration.)

## Limits and retention

- 20 000 events / user (oldest 500 pruned), 300 inventory locations, 400 items / location,
  500 ship storage rows. Desktop clamps items to 400 per location.
- Events are deleted after **90 days** (pg_cron on the web side).
- Batches: every 5 s or 50 events; state 1 / 10 s; backoff 15 s ... 15 min.

## Related contracts

- `docs/contracts/scc-app-event-progress.md` (event progress, location / Arena Commander mode, received rewards) extends
  this contract: same opt-in, same session token, same RLS-self-only rule, no new live table. It follows the same copy
  rule - it exists in BOTH repos and the SCC-App copy must stay byte-identical to the web file. A change to either
  contract file is a change in both repos; whoever edits one of the two cross-references updates the other copy too.
