# Event data sheet (contract)

Contract version: 1 (2026-11-08). Concept: `docs/concepts/20261108-1130-hq-events-nachschub/`.

One JSON sheet per event describes what the event asks, what it gives and where it applies. Owner rule: **the
mechanism is flexible** - nothing is locked to today's events. Every value may be `unknown`, every list is open.

## Single source of truth

`supabase/functions/_shared/event-sheet.ts` - pure TypeScript with no imports, usable by the Deno edge functions
(`import ... from '../_shared/event-sheet.ts'`), by `node --test` and by the web client, which re-exports it from
`src/app/hq/events/event-sheet.ts`. Do not copy the types; import them. Tests:
`supabase/functions/_shared/event-sheet.test.mjs` (node) and `src/app/hq/events/event-sheet.spec.ts` (Karma).

## Shape

```jsonc
{
  "schema": 1,                       // EVENT_SHEET_SCHEMA; also sc_events.sheet_schema
  "fields": {
    "venues":        F<string[]>,    // open slugs; suggestions: verse, arena-commander, star-marine, website, twitch, unknown
    "area":          F<{kind, systems[], places[]}>,   // kind open; suggestions: none, system, places, any
    "tasks":         F<{id, label, trackId|null}[]>,
    "progress":      F<{model, tracks:[{id,label,unit|null,tiers:[{at,label,rewardIds[]}]}]}>, // model open: none, once, tiers, daily, group, community
    "rewards":       F<{id,name,className|null,variant|null,channel,timing:{kind,date|null},trackId|null,tier|null}[]>,
    "prerequisites": F<PrereqNode>,  // gear AND/OR tree, see below
    "start":         F<string>,      // ISO date or instant
    "end":           F<string>
  }
}
// F<T> = { "value": T | null, "confidence": 0..1, "source": slug, "review": "auto"|"pending"|"approved"|"edited"|"rejected" }
```

- `value: null` is **unknown**. A malformed value is normalised to unknown (`normalizeSheet` never throws).
- Ids (`venues`, `area.kind`, `progress.model`, gear, track/reward ids) are lowercase slugs
  (`[a-z0-9-]`); unknown slugs are **kept**, not rejected.
- A venue is independent of the area: an event can list `["verse","arena-commander"]` with an area of its own. Arena
  Commander is matched by the SCC-App mode, not by place (`isInEventArea`).
- `rewards[].channel`: `pledge | ingame | both | unknown`. `timing.kind`: `immediate | after-end | date | unknown`
  (`after-end` rewards show as "wartet auf Verteilung" until ticked). `className` is the exact Codex class_name of what
  is delivered; wishlist dedupe compares exactly this value (never the base item).
- `prerequisites` (C4) is an estimate of the gear needed: `{op:"and"|"or", items:[...]}` or a leaf
  `{gear, label|null}`. Gear ids are open (suggestions: `fps-combat-set`, `combat-ship`, `salvage-ship`, ...). The
  normaliser **drops** patch / alpha / game package / edition / account entries (`isForbiddenGear`); a group of one
  collapses to its member, empty groups vanish.

## Review (C3)

- Extraction output goes through `gateSheet`: every machine field with `confidence < 0.8` (`SHEET_CONFIDENCE_MIN`) and
  review `auto` becomes `pending`.
- The **public** sheet (`sc_events.sheet`, readable by every signed-in user) has `pending` and `rejected` fields
  blanked (`publicSheet`; the SQL function does the same). The **full** sheet is `sc_event_sheet_drafts` (admin-only).
- Admin: `setByAdmin` (confidence 1, source `admin`, review `edited`), `approveField` (review `approved`).
- Every write goes through `sc_event_sheet_apply(p_event_id text, p_sheet jsonb, p_actor_kind 'ai'|'admin', p_actor_id text)`
  (service role or admin): stores draft + public sheet + one row in `sc_event_sheet_history` (admin-only read).

## Related tables (migrations `20261108140000`, `20261108140100`)

`user_event_state` (per user, see `docs/contracts/scc-app-event-progress.md`), `hq_supply_packages.type/event_id`,
`hq_einsaetze.event_id/area`, `hq_einsatz_steps.kind='event'/event_id/area`, `hq_inventory_items.origin`.

## End chain (C5)

`resolveEventEnd`: official end (sheet `end`, else `sc_events.end_date` when `date_status='confirmed'`) > estimated next
patch (caller passes `computeNextPatch(...).atIso`) labelled as an estimate > unknown. An extension just changes the
official end. An estimate never closes an event or archives its Nachschub; only an official end in the past does.
