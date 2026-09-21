# Wave 5 — Red-Team: Codex Ship Holodeck (`/codex/ship/:className?view=holo`)

Autonomous run 2026-09-22 (devops:redteam, code-only review; browser
verification done by the orchestrator with a Playwright harness — see
`wave5-fix-holodeck.md`). Paths relative to the repo root.

Scope read: `codex-holo-stage.component.ts`, `codex-holo-share.component.ts`,
`codex-holo-strip.component.ts`, `codex-holo-patch(.delta).component.ts`,
`codex-holo-perspectives.component.ts`, `codex-holo-fork-guard.ts`,
`holo-silhouette.ts`, `codex-detail.component.ts` (holo toggle, share,
silhouette load, stage wiring, draft mirror, save), `stage/hangar-picker.component.ts`,
`ship-skin-viewer.component.ts`, `ship-hardpoint-map.component.ts`,
`hangar.service.ts` (share/adopt/refresh/peek), `hangar-shared-loadout.component.ts`,
`app.routes.ts`, migrations `20260920150000_codex_silhouettes.sql` +
`20260920160000_hangar_loadout_sharing.sql`, `public/i18n/{de,en}.json`, wave1/3/4 docs.

## (A) Confirmed root causes for the three reported symptoms

### Symptom 1 — "Links teilen funktioniert nicht"

**A1.1 — "Link kopieren" gives zero feedback in the holo view (the copy itself succeeds).**
`codex-holo-share.component.ts` → `copyCurrentLink` → stage → host `copyShareLink()`
writes `location.href` and sets `linkCopied`. The `linkCopied` toast is rendered
**only** in the classic branch of `codex-detail.component.ts` (inside
`@if (!(kind()==='ship' && holoView()))`). In holo nothing changes on screen, the
popover stays open (no close-on-action, no click-outside, no Esc — `onKeydown`
handles Esc only for the inspector). From the user's chair: "nothing happens".

**A1.2 — The copied URL does not round-trip the holo state.**
- `initHoloView` restores `holo` from localStorage **without writing `?view=holo`
  to the URL**. Anyone who lands via stored preference copies `…/codex/ship/x` →
  the recipient (no stored pref) opens the **classic** view.
- Hangar-picker navigation `onShipPickerPick` navigates to `['/codex','ship',slug]`
  with no `queryParams` → drops `view=holo`, `loadout`, `pw`.
- A draft restored from **localStorage** (`restoreDraftFromUrlOrStorage`) is never
  mirrored back into the URL → the copied link carries no `?loadout=` although the
  table shows a draft.

**A1.3 — Hangar share block is hidden without explanation, and usually hidden by a race.**
`loadActiveHangarConfig` runs synchronously right after `void this.hangar.loadAll()`.
`hangar.shipByClassName()` reads `ships()` which is still `[]` → `activeHangarConfig`
stays `null` → the popover renders only "Link kopieren" even though the ship is in
the hangar. Signed-out users, ships not in the hangar, and hangar ships with zero
configs also get the same silent nothing. The stage's `addToHangar` output is never
emitted anywhere, so there is no CTA path.

**A1.4 — What the hangar link shares is not what the table shows.**
`createShareLink` snapshots `config.loadout` of the `activeHangarConfig` **loaded at
page open**. `saveLoadoutDraft` writes the merged loadout to the hangar but never
updates `activeHangarConfig` → the snapshot is stale; unsaved table edits are never
included. Recipient side: after `adopt` the page navigates to
`/codex/ship/:cls?view=holo` but the codex page never applies a hangar config to its
draft → the recipient sees the **stock** loadout. `adoptSharedLoadout` does not
refresh `hangar.ships()`.

**A1.5 — Minor but visible:** existing links are never listed (`link` starts `null`,
popover destroyed on close) → every open shows "Freigabe-Link erzeugen" and every
click mints a **new** token row. Hotkey hints "(L)" / "(P)" advertise hotkeys that
do not exist.

### Symptom 2 — "Elemente überschneiden sich"

**A2.1 — Hangar picker is double-offset and sits on the ship name.**
`.hangar-dock { position:absolute; top:10px; left:12px; z-index:6 }` wraps
`sc-hangar-picker`, whose own `.picker { position:absolute; top:12px; left:16px }`
offsets again. `.table-eyebrow { position:absolute; top:12px; left:14px; z-index:2 }`
prints "MFR · SHIP NAME" at the same spot, below the dock in z-order. On ≤640 px the
eyebrow (no `max-width`) also runs under `.tools5`. Measured in the browser: the
dock also overlaps the Einsatz role bar (it is positioned against the panel, not
the table body).

**A2.2 — The pin canvas is taller than its frame; pins land under the chrome and get clipped.**
`.shipwrap { width:min(560px,82%); aspect-ratio:1/1; top:52%; translate(-50%,-50%) }`
inside `.silhouette-frame { min-height:480px; overflow:hidden }`. At any table
≥ 683 px wide the wrap is 560 × 560 in a 480 px frame. Fallback-ring pins at
`y = 50 ± 44 %` sit under dock/eyebrow/tools5 and under `.legend`; `white-space:nowrap`
labels of the left/right ring pins get clipped.

**A2.3 — Left panel watermark is not positioned; it becomes an in-flow 30 px block.**
`.wm { position:absolute }` is overridden by the later, equally specific
`.frame > * { position:relative; z-index:1 }` → the mission word renders as a
relative block with `top:46%` shift, overlapping the statics.

**A2.4 — Many pins (capital ships).** With no loadout sections the pin source is
*all* `detail.ports` (no de-dup). 30–40 pins on a ring are ~38 px apart while labels
are 120–220 px wide → labels overlap 3–5 deep; `.shipwrap.no-geometry .pin-label
{display:none}` hides them only when there is **no** silhouette. Measured: the Nomad
(17 pins, silhouette present, 0 anchors) has 5 label collisions at 1440 px.
Duplicate `portName`s in `detail.ports` hit `track pin.portName` → NG0955.

**A2.5 — Undo toast vs strip.** `.undo-toast { position:fixed; bottom:110px }` vs
the sticky strip whose expanded panel is far taller than 110 px.

**A2.6 — Patch Δ tables render inside the top bar.** `sc-codex-holo-patch` sits in
`.ht-right` and after a pick renders four `.delta-view` tables *inside that cell* →
the top bar grows to several hundred px.

**A2.7 (orchestrator, browser-measured) — ≤640 px the table panel collapses to 2 px.**
The ≤1000 px rules `.holo-body:has(.holo-left:not(.collapsed)) { grid-template-columns:
0 minmax(0,1fr) 44px }` outrank the ≤640 px `.holo-body { grid-template-columns: 1fr }`
(`:has()` adds specificity). With `.holo-table { order:-1 }` the table lands in the
0-px column, the left rail takes the `1fr`. The page is unusable on phones.

### Symptom 3 — "Keine Standardsilhouette"

**A3.1 — The arrival animation (and with it the hero-art fallback and the count-up) is dead code.**
Hero art renders only `@if (!arrived() && heroArt().length > 0)`. `arrived` is set
immediately by the effect when `seenThisSession()` is true. The host computes
`holoSeenThisSession` from `holoSeenShips`, and **both** entry paths add the ship
before the stage ever mounts (`initHoloView`, `toggleHoloView`). So the hero art is
never shown, `startCountUp` never runs. The effect's `return () => clearTimeout(t)`
is also ignored by Angular (`effect` cleanups go through `onCleanup`).

**A3.2 — There is no fallback chain; the `@else` branch is the placeholder regardless of what else exists.**
mode `3d` → viewer, mode `schema` with frame → map, else `.shipwrap` → silhouette
**or** two dashed rings. `heroArt()` (RSI render → datamined `previewImage`) is
available for ~95 % of hulls but never used as the table image. State matrix:
- S present → hull path + pins (only good case; 0/332 prod silhouettes carry anchors).
- S absent, H present → two rings + pins on ring; hero art unused → **what the user sees**.
- User clicks "3D": no model → the viewer renders **nothing**, the frame is empty, the
  toggle shows `.on`. The stage never learns 3D availability.
- User clicks "Schema": no frame → silent no-op with the toggle `.on`.
- P empty → pins `[]`, inspector "0 / 0", no empty-state.

**A3.3 — Anchor metadata is dropped.** `clamped` anchors render like exact ones;
`unresolved[]` is parsed but never consulted.

## (B) Further risks

### P0
- **B0.1 — Stale share popover across ship switch.** Stage is reused across
  `/codex/ship/A → B`; `sharePopoverOpen` and the mounted share component keep
  `link()` of ship A.
- **B0.2 — Power strip state bleeds between ships.** `restored` is a one-shot flag;
  on ship B the strip keeps A's `cutGroups/levels/mode/preset` and persists them
  under B's key.

### P1
- B1.1 `viewMode` persists across ships (3D on a ship without skins → empty frame).
- B1.2 `inspectedPort` survives ship change.
- B1.3 Fallback pins (from `detail.ports`) have no slot → click gives the empty state.
- B1.4 Hotkey hint says "1 bis {{n}}" for n up to 40 but hotkeys cover 1–10; n=0 reads "1 bis 0".
- B1.5 `blip()` leaks an `AudioContext` per click (Chrome caps ~6).
- B1.6 `startCountUp` reads the cohort at arrival time; cohort arrives async.
- B1.7 Toggles at 45 % opacity until hover — on touch "Teilen" reads as disabled.
- B1.8 Recipient page after adopt carries no config reference.
- B1.9 `peek_shared_loadout` returns nothing for unapproved owners; insert gated too → `errorGeneric` with no reason.

### P2
- B2.1 CLAUDE.md "navigations are real anchors": hangar-picker chain items are `<button>`s that `router.navigate`.
- B2.2 `[markers]="[...hardpointMarkers()]"` allocates a new array every CD.
- B2.3 Timers without `DestroyRef` (inspectPin pulse, undo toast, share `copied`, host `linkCopiedTimer`, arrival timer, rAF loop).
- B2.4 Digit hotkeys are document-global (fire inside the swap-picker modal).
- B2.5 `.legend` is `aria-hidden`; pins have no `aria-describedby` for "unresolved".
- B2.6 A missing `codex_silhouettes` table is indistinguishable from "no row".
- B2.7 `followedSince` renders an invalid date when `ownerUpdatedAt` is missing.
- B2.8 Mobile tabs: "Daten" hides the table but keeps the sticky strip.

## (C) Missing i18n keys

None — every `codex.holo.*` key used resolves in de/en. Two **misleading** strings:
`codex.holo.share.copyLinkHotkeyHint` "(L)" and `codex.holo.patch.trigger.hotkeyHint`
"(P)" advertise hotkeys that are not implemented.

## (D) Out-of-scope improvement ideas (candidate GitHub issues)

1. Default silhouette from `previewImage`/RSI art with the uploader silhouette overlaying it when it arrives.
2. Silhouette coverage dashboard (admin) — ships with/without `codex_silhouettes` per build.
3. Share = "Snapshot of the table" — share the current draft as a hangar link in one click; list/reuse existing tokens.
4. Recipient landing on the holodeck — `/hangar/shared/:token` "Auf dem Holotisch ansehen" opens the codex page with the shared loadout as a read-only draft.
5. Pin label collision handling — auto-hide above N pins, leader lines, hover-cluster popover.
6. Explicit view-mode availability — grey out 3D/Schema with reasons.
7. Real hotkeys — `L` copy link, `P` patch chooser, `3`/`S` view modes.
8. Arrival replay per ship switch (short cut instead of the 1.6 s arrival).
9. Stage-level `DestroyRef`/timer hygiene + OnPush audit.
10. Uploader: 0/332 ship silhouettes in the current LIVE build carry `anchors` — `silhouette_build.py` finds no `hardpointTransforms`/`hardpointFrame` in `ships/<class>.json` for this extract; until that pipeline emits them every pin sits on the fallback ring.

```
REDTEAM_REVIEW:
  scope: Codex ship Holodeck view — share paths, stage layout overlaps, silhouette fallback, state hygiene
  verdict: rework
  notes: A1.1/A1.2/A1.3 make sharing look broken; A2.1–A2.3/A2.7 are pure CSS/positioning defects; A3.1 disables the whole arrival/hero-art path and A3.2 leaves no default silhouette. Top by severity: A1.1, A1.3, A1.4, A2.1, A2.2, A2.3, A2.7, A3.1, A3.2, B0.1, B0.2.
```
