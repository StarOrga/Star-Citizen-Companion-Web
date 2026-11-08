# SCC-App event progress (contract, desktop -> SCC-Web)

Contract version: 1 (2026-11-08, proposal for the SCC-App session; checklist A1-A4 of the HQ events brief). Companion
of `docs/contracts/hq-live.md` (same opt-in `hq.liveSync.enabled`, same user session token, RLS self-only). The SCC-App
repo copy must stay byte-identical to this file.

Goal: the web updates the user's event state automatically - progress per track, the place the user is in (offers
"in the event area, switch to the Nachschub?"), Arena Commander mode, and a received reward ("claim ticks itself").
Owner: the detection should be built from the game logs ("die Erkennung gern die Gamelogs von gestern analysieren").

## 1. Progress and rewards -> `user_event_state`

Write with the RPC, never with a plain upsert (it merges per track / per reward by timestamp, so a stale live report
cannot overwrite a newer manual value and vice versa):

```
POST /rest/v1/rpc/user_event_state_report
{
  "p_event_id": "iae-2956",                       // sc_events.id
  "p_progress": { "<track id>": { "value": 14, "source": "live", "updated_at": "2026-11-08T12:00:00.000Z" } },
  "p_claimed":  { "<reward id>": { "channel": "pledge", "at": "2026-11-08T12:00:00.000Z", "stored": false, "by": "live" } },
  "p_status":   null                              // "open"|"done"|"dismissed"|"aborted"; the app sets nothing but "done" never
}
```

- `track id` / `reward id` are the ids of the public sheet (`sc_events.sheet`, `docs/contracts/event-sheet.md`:
  `progress.value.tracks[].id`, `rewards.value[].id`). The app reads them from `sc_events` (authenticated read). An id
  the sheet does not know is ignored by the web, not an error.
- `value` is the absolute counter for the track (not a delta), `source` is always `"live"`, `updated_at` the time of the
  log line (ISO UTC, ms). Counters only go up; send only on change, at most once per 10 s per event.
- A received reward: `p_claimed` with `by: "live"`. `channel` is what the log shows (`pledge` item / `ingame` item;
  unsure -> omit the claim, never guess). `stored` stays `false`: putting it into Bestand is the web's decision.
  This also changes the channel of an already-ticked reward when the newer `at` says so ("scc app befaehigen, das
  automatisch zu aendern").
- The app never sets `p_status` to `done` and never `dismissed`; those are the user's choices.
- Rows of other users are unreachable (RLS). Signed out or opt-in off = no request.

## 2. Place, system and Arena Commander mode -> `hq_live_state.state`

No new table: the existing `hq_live_state` snapshot (`docs/contracts/hq-live.md`) carries two keys the web reads for
the Jetzt offer bar:

```jsonc
"location": { "system": "Stanton", "place": "Lorville" },   // as today; strings, any case (the web slugifies)
"event": { "arenaCommander": true, "mode": "pirate-swarm", "at": "2026-11-08T12:00:00.000Z" }
```

- `event.arenaCommander` is true while the log shows an Arena Commander session, absent/false otherwise; `mode` is an
  open slug (never an enum). The web matches Arena Commander against the event's `venues` (`arena-commander`), not its
  area (`isInEventArea`).
- `location.system` / `location.place` are compared against `area.systems` / `area.places` of the sheet after slugging
  (`Area 18` -> `area-18`). No signal (`presence` stale) = the web shows no offer.

## 3. Detection hints (for A1, from the logs)

Patterns to find first in yesterday's logs: contract/objective lines of the event, kill/visit/discovery counters, a
reward grant line (blueprint.received exists already; ships/items need new patterns). Everything the app is unsure
about is **not sent**; the user's manual value stays authoritative until a live value with a newer `updated_at` arrives.
