# Wave 2 — frontend handoff (Holotable stage)

Branch: `claude/codex-schiffsansicht-design-d0ab3a-fe-stage` (off
`claude/codex-schiffsansicht-design-d0ab3a` @ `919c251`).

Scope note (discretion, reported per the strict contract): the whole feature
is titled "Codex Holotable **ship** view" and every concept round talks about
one ship's stage — so the toggle, `holoView` signal and
`<sc-codex-holo-stage>` are all gated `kind() === 'ship'`. Every other codex
kind (weapon/component/item/armor/blueprint) never renders the toggle, never
reads `holoView`, and its template branch is untouched — so it is
byte-for-byte identical regardless of what `localStorage` holds, not just
"unchanged when false".

## A · The view toggle

- `src/app/codex/codex-detail.component.ts:1682-1732` — `holoView` signal,
  `HOLO_VIEW_STORAGE_KEY = 'sc.codex.holoView'`, `initHoloView(className)`
  (URL `?view=holo|classic` wins, else localStorage, else `false`),
  `toggleHoloView()` (flips the signal, writes localStorage, mirrors the URL
  via `router.navigate([], { queryParamsHandling: 'merge' })`, `replaceUrl:
  true` so toggling never spams browser history), `holoSeenThisSession` (a
  plain `Set<classNameSlug>`, read by the stage's arrival animation).
- `initHoloView` is called from `load()` at `:1857` (before any async work),
  keyed by `className` (the route param, not yet the resolved
  `classNameSlug` — both are the same string on this route).
- Toggle markup: `codex-detail.component.ts:298-314` (crumb row, `kind() ===
  'ship'` only), CSS `:1437-1441` (reused `.crumbrow`/`.crumb-spacer`, three
  new small rules).
- Persisted per user (not per ship) — a decision within discretion since the
  request said "persisted per user in localStorage" without a scope; a
  global preference is what every other per-user localStorage flag in this
  codebase already does (draft storage is the one per-ship exception, and it
  is per-ship for a different reason — draft identity — not for a view
  preference).

## B · `CodexHoloStageComponent`

`src/app/codex/holo/codex-holo-stage.component.ts` (+
`codex-holo-stage.component.spec.ts`, styles inline per the file's own
convention — matches how `codex-rank-card.component.ts` does it, not
`codex-detail.component.ts`'s external template string, since the parent
file is already 4000+ lines and adding a sibling `.html`/`.css` pair would be
the only place in `codex/` that does).

Mounted from `codex-detail.component.ts:1141-1180` (inputs) with the Details
drawer content projected as `<ng-content>` at `:1181-1340` — literally the
SAME markup/bindings as the classic tool-row / fixed-systems / description /
crafting / spec-raw blocks, copy-pasted rather than re-derived, so it reuses
the exact same signals and methods (`editionOptions`, `skinOptions`,
`toggleLinkForm`, `tailModuleSections`, `recipe`, `specSections`, …) the
classic view already exercises. Reasoning: those blocks are dense,
auth/admin-gated forms (ship-link) and structural-hardpoint groups where a
second implementation would be a second place to get the `--sc-accent-hot`
admin rule or the RSI-link escaping wrong.

- **Three panels** — `:holo-body` grid `300px 1fr 300px`, collapsible rails
  (`leftCollapsed`/`rightCollapsed` signals, 44px collapsed width via CSS,
  `@media (max-width: 1100px)` starts collapsed-width by default,
  `@media (max-width: 768px)` stacks to one column). File:
  `codex-holo-stage.component.ts:220-232` (styles), `:140-142` /
  `:230-236` (template — the rail toggle buttons).
- **Einsatz bar = table header** — reuses `sc-codex-kpi-band` +
  `sc-codex-mission-bar` verbatim (`:107-115`); no second profile selector —
  the rank-card's own profile radios (inside the left panel) are the only
  Einsatz/profile control, exactly per the ask.
- **Left panel "Einordnung"** — reuses `sc-codex-rank-card` (`:130-140`),
  cohort text link to `/codex?kind=ship` (`:141-143`), watermark = active
  mission's own i18n string. **Top-3 named cohort ships are NOT built** — see
  Questions below, this is the one deliberately-unbuilt item.
- **Table** — `silhouette-frame` (`:150-174`): SVG `<path fill-rule="evenodd">`
  when a `HoloSilhouette` is present, else the §C3 neutral dashed-ring
  placeholder + `codex.holo.noGeometry` badge. Pins (`:175-190`,
  `pins` computed `:365-388`) are derived from `detail().ports`, matched
  against `silhouette.anchors` by `portId === portName` — **not** from
  `anchors ∪ unresolved`, per the wave1-redteam note. A port with no matching
  anchor gets a deterministic fallback ring position (evenly spaced on a
  circle) and the `.unresolved` dashed style — covers both the `unresolved[]`
  case and the "in neither array" case identically, as §C3 specifies. Click
  → `inspectorTarget` computed (`:391-398`) synthesizes a `LayoutTarget` by
  scanning the already-available sections for the matching row, then the
  inspector panel's ⇄/ⓘ buttons emit the SAME `swapRequested`/`inspected`
  outputs the ports list uses — the parent's existing swap picker and
  component modal open unchanged. `3D`/`Schema`/`Teilen` toggle row
  (`:118-122`) — `viewMode` signal switches a class for future 3D/Schema
  embeds (see Questions: the actual `sc-ship-skin-viewer` / hull-map
  embedding is not wired into this toggle, only the state and the buttons
  are — see below), `Teilen` re-emits the parent's `copyShareLink()`.
- **Right panel "Ports"** — one `sc-codex-hardpoint-layout` instance PER
  group (`allSections()` = primary + tail sections), a "Detail ▾" per group
  (`:196-224`), a per-group density checkbox (`isGroupDense`/
  `toggleGroupDense`, purely a CSS-hook signal today — see Questions).
- **Perspectives** — four tiles (`PERSPECTIVES`/`PERSPECTIVE_KPIS` reused
  from `codex-build-compare.ts`, not re-derived), gauge = mean percentile of
  the ACTIVE rank profile's axes that fall in the tile's KPI-key group (real
  `rankResult()` data, never invented — a tile with no ranked axis in its
  group shows the KPI gap, not a fabricated 0%), three headline KPI values
  from `kpiCells()`, "Alle Werte ▾" expands the SAME
  `sc-codex-offensive-panel`/`sc-codex-defensive-panel`/`sc-codex-ship-panel`
  the classic view uses (`:274-296`). Discretion: `sc-codex-ship-panel`
  (flight/systems/hull/signature facts) is not itself split into
  "Bewegung"-only vs. "Signatur & Kühlung"-only content — both tiles expand
  to the SAME full ship-panel rather than a re-derived half, so nothing from
  inventory #43 is lost or duplicated-with-a-gap; reported here rather than
  silently splitting the component.
- **Change journal** — `journal` computed (`:436-452`) scans every section's
  `LayoutSlot.draftState`/`draftPaths` (the same per-row data the ports list
  already renders, second read only) into a flat list with a per-row Revert
  and one "discard all" button, both re-emitting `reverted` — no new draft
  tracking. "Undo as a toast" (SCC-app style) is **not built** — see
  Questions; today's revert is inline in the journal list, not a toast.
- **Arrival** — `arrived` signal set after 1600ms via `effect()`
  (`:307-317`), hard cut (`arrived` set immediately) when `reducedMotion()`
  input is true OR `seenThisSession()` is true. CSS-only `opacity` reveal on
  the silhouette path (`:159-163`); the "hero art = loading screen" half and
  the 2.5s lid cap are **not built** — see Questions. Count-up of KPI numbers
  is **not built** — `sc-codex-kpi-band` renders its values statically and
  forking it for one caller risked exactly the kind of parallel
  implementation the "reuse, never reimplement" rule warns about.
- **Sound** — `soundOn` signal, `localStorage['sc.codex.holo.sound']`,
  default off, WebAudio oscillator blip on toggle-on only (`:318-350`) — no
  audio asset, matches the ask.
- **Mobile** — CSS breakpoints at 1100px/768px collapse the rails and stack
  the grid (`:220-232`); the "Tisch | Daten" tab alternative and the
  landscape `table | inspector` split are **not built** — see Questions.

## C · Integration slots (Wave 2.5)

Left as literal HTML comments in `codex-holo-stage.component.ts`:

- `<!-- holo-slot: strip -->` (`:227`) — sticky bottom strip. Needs:
  `kpiCells()` input (already on the component), `draftChangedCount()`
  (already on the component); the sibling agent adds its own open/close
  signal and — per decision it.10 — the energy summary content (not built
  here at all, on purpose: energy dock stays a separate sticky element for
  both views, see below).
- `<!-- holo-slot: hangar-tab -->` (`:167`, top edge of the table). Needs:
  `detail().classNameSlug` (already on the component via `detail` input),
  `inHangar()` and an `addToHangar` output — **neither exists on this
  component today**; the sibling agent will need to add both as new
  input/output, mirroring the classic view's `inHangar()`/`addToHangar()`
  (projected into the Details drawer here, not otherwise on the stage).
- `<!-- holo-slot: patch-delta -->` (`:203`, inside the inspector). Needs:
  `detail().classNameSlug` (already available) and the currently-active
  build id — **not currently passed to this component**; the sibling agent
  will need a `buildId` input from `CodexService.build()`.
- `<!-- holo-slot: share -->` (`:333`, inside the Teilen popover — currently
  just a button, no popover yet). Needs: the `copyShareLink` output (already
  exists) and the current share URL string — **not currently exposed**; the
  parent's `copyShareLink()` writes to the clipboard directly today rather
  than returning a URL, so the sibling agent will need either a new
  `shareUrl` input or a second parent method that returns the string instead
  of copying it.

Energy dock: kept as a SEPARATE sticky element in the parent,
`codex-detail.component.ts:1345-1354`, rendered for `kind() === 'ship'`
**regardless of `holoView()`** — item A says it "stays in the parent and
keeps working for both views", and it is not in item A's list of
replaced sections. The Wave 2.5 strip is an ADDITIONAL summary, not a
replacement for the dock.

## D · i18n

`public/i18n/{de,en}.json`, `codex.holo.*` (added right after
`codex.editionPicker`): `codex.holo.noGeometry`, `codex.holo.pinUnresolved`
(both pre-named by wave0-research §C3, kept verbatim), `codex.holo.toggle.*`
(`group`/`classic`/`classicHint`/`holo`/`holoHint`), `codex.holo.stage.*`
(`railToggle`, `einordnung`, `cohortLink`, `view3d`, `viewSchema`,
`viewShare`, `silhouetteAria`, `noGeometryReason`, `inspector`, `ports`,
`detailShow`/`detailHide`, `density`, `allValues`/`allValuesHide`,
`journal`, `detailsShow`/`detailsHide`, `sound`,
`perspective.{offensive,defensive,movement,signature}`). German wording
follows the concept ("Einsatz" via the reused mission-bar strings,
"Einordnung", "Alle Werte ▾", "Detail ▾"). `i18n-keys.spec.ts` passes
unmodified (verified in the green 1144-test run below).

## E · Known data gaps

Rendered exactly as today, via the reused/projected panels — no new gap
strings invented. The perspective gauges add ONE new honest gap: a tile
whose active-profile axes are all unranked shows `codex.kpi.gap`, never an
invented percentage.

## Inventory audit (all 59 rows)

| # | Row | Where in holo view |
|---|---|---|
| 1-4 | Crumb row (back, data pill, provenance, states) | **parent, unchanged** — outside the swapped region, same markup for both views |
| 5-9 | Hero art, 3D viewer, 2D/3D toggle, eyebrow, `<h1>` | Table's silhouette (5,9 folded into the `holo-eyebrow`/silhouette); 3D toggle is the `3D` text-toggle (`:118`) — **embedding is a Question**, see below |
| 10 | Career/crew/cargo/mass chips | `stageCounts()` reused verbatim in `.holo-chips` (`:99-108`) — wait, chips there are the MODULE CENSUS (#11); the career/crew/cargo/mass fact chips (#10) are **not built** — see Questions |
| 11 | Module census chips | `.holo-chips` in the Einsatz header (`:99-108`) |
| 12 | Pin/compare toggle | **accepted loss** (concept decision 3) |
| 13 | Factory loadout | Change journal's "discard all" button |
| 14 | Copy share link | Teilen text-toggle → `copyShareLink` output |
| 15 | Switch ship | **accepted loss** (concept decision 3) |
| 16-17 | Edition/skin pickers | Details drawer (projected, verbatim) |
| 18 | classNameSlug `<code>` | Details drawer (projected) |
| 19 | Add to hangar | Details drawer (projected) + `hangar-tab` slot for the sibling agent's dedicated tab |
| 20 | RSI link | Details drawer (projected) |
| 21-23 | Ship-link form + admin promote | Details drawer (projected), admin row keeps `--sc-accent-hot` unchanged (same markup) |
| 24 | Rank card (full) | Left panel, reused component + new weak-axis marker |
| 25 | KPI band | Einsatz header |
| 26 | Mission bar | Einsatz header |
| 27 | Draft save bar | **not built as a distinct widget** — its data (`draftChangedCount`, save/discard) lives in the change journal instead; the explicit "Speichern" action itself (`saveLoadoutDraft()`) is **not wired** — see Questions |
| 28 | Draft persistence (URL/localStorage) | parent, unchanged — the stage never touches draft storage |
| 29-39 | Loadout column + hardpoint-layout rows | Right panel "Ports", grouped, `sc-codex-hardpoint-layout` reused unmodified |
| 40 | Analysis column heading | Perspectives section heading (implicit — four tiles instead of one "3" counter) |
| 41-43 | Offensive/defensive/ship panels | Perspective tiles' "Alle Werte ▾" |
| 44 | Full 3D section below columns | **not built** — see Questions |
| 45 | Fixed systems | Details drawer (projected) |
| 46 | Description | Details drawer (projected) |
| 47-48 | Ammo/stat groups | out of scope — ship kind only reaches these when `kind() !== 'ship'`, which never holds here |
| 49 | Structural hardpoints | Details drawer — heading only, the full port-row markup is **not projected** (see Questions), only the section header + count |
| 50 | Crafting | Details drawer (projected) — ships never have a recipe in practice, kept for parity |
| 51 | Spec/raw | Details drawer (projected, verbatim) |
| 52 | Energy dock | parent, unconditional for both views (see §C) |
| 53 | Compare tray | parent, unconditional (outside the swapped block) |
| 54-56 | Component modal / swap picker / weapon detail | parent, unconditional — the stage only emits the same requests |
| 57 | Hover sync (`activePorts`) | shared — stage inputs/outputs the same signal |
| 58 | Keyboard (Esc/Enter/Arrow) | unchanged — all in the parent-owned modals |
| 59 | i18n discipline | followed, `i18n-keys.spec.ts` green |

## Gates

- `npm run typecheck` — clean.
- `npm run build` — succeeds; one pre-existing-pattern **warning** (not an
  error): `codex-detail.component.ts` component styles now 22.11 kB vs the
  18 kB warning budget (24 kB error budget, not hit) — the toggle added
  ~350 bytes to an already-large style block. Flagged, not fixed further
  (would need trimming unrelated existing CSS, out of scope).
- `npx ng test --include='src/app/codex/**/*.spec.ts' --watch=false
  --browsers=ChromeHeadless` — **1144/1144 green**, including
  `codex-detail.component.spec.ts` (untouched) and `i18n-keys.spec.ts`.
  New: `codex-holo-stage.component.spec.ts` (5 cases: placeholder without
  silhouette, resolved pin, unresolved-ring pin, reduced-motion immediate
  arrival, normal-motion deferred arrival) and
  `codex-detail-holo-toggle.spec.ts` (4 cases: default classic + toggle
  persists to localStorage, URL `?view=holo` overrides a stored classic
  preference, URL `?view=classic` overrides a stored holo preference, the
  holo branch actually swaps in `<sc-codex-holo-stage>` and removes `.m-top`).
  The toggle tests live in their OWN new file rather than editing
  `codex-detail.component.spec.ts`, per the "must stay green untouched"
  instruction.

## Chosen (attributes)

- Weak radar axis marker (coordinator clarification): `--sc-danger`
  **stroke only**, no fill, no coloured text —
  `codex-rank-card.component.ts:65-67` (template),
  `:238-241` (CSS `.weak-axis`), `weakestAxisVertex` computed
  (`:339-353`, lowest-percentile ranked axis, ties keep profile order).
- Rail collapse breakpoints: 1100px (collapsed by default, matches the
  ask's "tablet 768–1100 = rails collapsed by default" — extended down
  through 768px since the request only specifies 768px as the LOWER edge of
  that band) / 768px (single column).
- Arrival: 1600ms transformation (`setTimeout`), no separate "2.5s lid" gate
  built (the whole arrival is one 1600ms opacity reveal, under the 2.5s cap
  by construction rather than by a second timer).
- Sound: WebAudio `OscillatorNode`, 880Hz, 120ms exponential-decay gain
  envelope, no audio asset.
- View-toggle persistence scope: per-user/global (localStorage key not
  keyed by ship) — see §A.
- Details drawer: closed by default (`detailsOpen` signal init `false`).
- Ports list: each group individually closed by default
  (`openGroups` starts empty).

## Questions for the user (left unbuilt, not guessed)

1. **Top-3 named cohort ships** (left rail "Einordnung"). No signal anywhere
   in the codebase carries a ranked list of cohort SHIP NAMES — `RankResult`
   only has percentiles/bars, never per-ship rows (confirmed by reading
   `codex-rank.ts` in full). Building this needs either a new
   `CodexService`/`codex-rank.ts` return shape (a `core`-owned change) or
   inventing names, which the project's "never invented" data rule forbids.
   Not built.
2. **3D/Schema embedding behind the table's hover toggle.** The toggle
   buttons and `viewMode` signal exist, but `sc-ship-skin-viewer` /
   `sc-ship-hardpoint-map` are not mounted inside the stage component —
   wiring them needs the same `hardpointPortRefs()`/`hardpointFrame()`/
   `hardpointMarkers()` inputs the classic hero already threads through, and
   I could not tell from the concept whether the 3D view should REPLACE the
   silhouette in place or open as an overlay above it, which changes the
   component's structure rather than an attribute. Left unbuilt; the classic
   view's 2D/3D toggle stays the fallback (reachable via the view-toggle,
   satisfying "remain reachable" from §C3's last line).
3. **"Change journal … undo as a toast (SCC-app style)".** Built as an
   inline list with inline Revert buttons instead of toast notifications —
   the app has no existing toast primitive component to reuse (grepped for
   `toast` across `src/app/`: only ad-hoc `role="status"` paragraphs, e.g.
   the ship-link form's `sl-ok`), and building a new toast SYSTEM for one
   caller is a much bigger object than the request named. Left as the
   simpler inline form rather than guessing a toast API.
4. **Career/crew/cargo/mass fact chips (#10)** and the full **explicit
   loadout save bar (#27, "Speichern" action)**. Both exist as data on the
   parent (`stageCounts()` is module census only, #10 needs a different
   parent computed value that is not currently exposed as its own signal;
   `saveLoadoutDraft()` exists but nothing in the stage calls it — the
   change journal's revert-only actions cover UNDOING a draft, not SAVING
   it). Not built — the ask does not say where "Speichern" belongs in the
   new layout (KPI header? journal? details drawer?) and guessing changes
   what gets built where.
5. **Mobile "Tisch | Daten" tab setting and the landscape `table |
   inspector` layout.** The CSS breakpoints stack the panels, but neither
   the per-user tab setting nor a landscape-specific two-pane layout is
   built — both are full sub-features (a new persisted setting + a second
   responsive layout mode) rather than an attribute of the stacked layout
   already there.
6. **Structural hardpoints (#49) full port-row detail** inside the Details
   drawer — only the section heading + port count is projected; the actual
   `hardpointGroups()`/`compat()` row markup (expandable rows, compat-item
   lazy-load) was not copied in, since for ships this section is a rare
   edge case (`hasLoadoutSection()` is true for essentially every ship) and
   copying ~70 more lines of lazy-loading markup for a path that likely
   never renders felt like scope creep beyond "present, not hidden" for a
   case that is already reachable in the classic view via the toggle.

Pushed SHA: `5315602` on `claude/codex-schiffsansicht-design-d0ab3a-fe-stage`.

## Wave 2.5 addendum — integrate siblings, close the gaps

Merged `origin/claude/codex-schiffsansicht-design-d0ab3a` (now containing
fe-strip-hangar and fe-patch-share) via `git merge --no-edit`, clean, then
wired all four slots and built out items 1-6 from the coordinator's reopened
list. Pushed SHA: `1b6a085` on `claude/codex-schiffsansicht-design-d0ab3a-fe-stage`.

### i18n merge hazard (fixed here, not by the sibling agents)

The three-way merge left **`"codex.holo"` defined THREE times** as sibling
keys inside `codex` in both `de.json` and `en.json` (my `toggle`/`stage`
block, fe-strip-hangar's `strip`/`hangar` block, fe-patch-share's
`patch`/`share` block) — syntactically valid JSON, but `JSON.parse` (and
therefore ngx-translate at runtime) silently keeps only the LAST one, which
is why `1224 SUCCESS` in the test run below does NOT prove the merge was
safe on its own — the karma suite never asserts `codex.holo.stage.*` resolves
against the same object `codex.holo.strip.*` does. Wrote a small duplicate-key
scanner (bracket-depth + per-object key-set) to confirm zero duplicate keys
anywhere in either file after the fix — plain `JSON.parse` cannot detect this
class of bug, it just picks a winner. Merged all three `holo` blocks into one
object (`public/i18n/de.json:605-729`, `en.json:605-729`) and deleted the two
now-redundant standalone blocks, fixing the two trailing-comma breaks that
deleting them left behind. Flagging this because it is exactly the kind of
"tests are green but the feature is silently broken" hazard the merge step
does not surface — none of the three agents' own gates would have caught it
in isolation.

### Slot wiring (file:line)

| Slot | Hosted component | Wiring | File:line |
|---|---|---|---|
| strip | `sc-codex-holo-strip` | Sticky, last element in the stage template; inputs mirror `sc-codex-energy-dock`'s 1:1, new `occupants`/`shipStats`/`schemaVersion`/`userId`/`crossSection`/`cells`/`active`/`capabilities`/`rankResult`/`rankCohortLoading` inputs added to the stage and threaded from the parent's existing `draftSummaryOccupants()`/`shipPayload()`/`build()`/`currentUserId()`/`crossSectionMax()` | `codex-holo-stage.component.ts:~410-422` (mount), `codex-detail.component.ts:1194-1198` (parent feed) |
| hangar-tab | `sc-codex-holo-hangar` | No inputs (self-sufficient); wrapped in `.hangar-tab-dock` (`position:absolute; top:0`) at the table's top edge per its own CSS-hook contract; the mobile mini-slot is the SAME instance (no separate mobile component — the table itself stacks full-width under 768px, so the tab already sits correctly) | `codex-holo-stage.component.ts:~248-250` |
| patch-delta | `sc-codex-holo-patch` (trigger, Einsatz header) + inline port-badge in the inspector (see "Chosen" below re: `sc-codex-holo-patch-delta`) | `activeKpiSheet` = parent's `stockKpiSheet()` (made public); `activeOccupants`/`buildRef`/`resolveComparisonSide` are NEW parent computeds/adapter (`patchActiveOccupants`, `patchActiveBuild`, `resolvePatchComparisonSide`); outputs feed `patchGhosts`/`patchPortPins`/`patchComparisonBuild` signals on the stage, `patchPortPins` drives a `.pin.patched` outline + the inspector's from→to line | `codex-holo-stage.component.ts:~135-149` (mount), `:~305-315` (inspector badge), `codex-detail.component.ts:2668-2703` (new parent computeds + adapter) |
| share | `sc-codex-holo-share` | Popover toggled by the "Teilen" table-toggle button (`sharePopoverOpen` signal); `config` = parent's new `activeHangarConfig` signal, best-effort loaded via `listConfigs()` when the ship is in the hangar; `copyCurrentLink` → parent's existing `copyShareLink()`; `configRefreshed` → `activeHangarConfig.set($event)` | `codex-holo-stage.component.ts:~247-262`, `codex-detail.component.ts:2757-2764` (`loadActiveHangarConfig`) |

### Reopened items 1-6 — built

1. **Top-3 "Einordnung"** — `topCohortShips` computed (`codex-holo-stage.component.ts:~640-670`): candidates = `recentlyViewedShips() ∪ hangarShipClassNames()`, each resolved against `rankCohort()` (the SAME cohort array `rankShip()` already fetched — new parent input, `codex-detail.component.ts:3343` made public), ranked by the active mission's accent KPI value (real `sheet[key]`, never invented), sorted desc, sliced to 3; random-ish fill from the rest of the cohort when the candidate pool is short (deterministic sort by class name, not `Math.random`, to keep the computed pure). "Recently viewed" = new `recentlyViewedShips` signal + `localStorage['sc.codex.recentShips']`, cap 20, updated on every ship-page load (`codex-detail.component.ts:1707-1730`, `:1861-1864`).
2. **3D/Schema in place** — `viewMode` signal (`'holo'|'3d'|'schema'`), the silhouette frame conditionally mounts `sc-ship-skin-viewer [embedded]=true` or `sc-ship-hardpoint-map`, both wired to `activePorts`/`hovered` for hover-sync parity, toggle buttons flip back to `'holo'` on a second click (`codex-holo-stage.component.ts:~262-275`).
3. **Undo toast** — a `role="status"` region, `UNDO_TOAST_MS = 6000`, one "Rückgängig" button; an `effect()` diffs `journal()` against the previously-seen port set and pops the toast for the newest change, ALONGSIDE (not instead of) the always-present inline revert list, so a second simultaneous change is never stranded once the first toast fades (`codex-holo-stage.component.ts:~530-548`).
4. **#10 chips + #27 save bar** — `heroChips` reuses the parent's EXISTING `heroChips` computed verbatim (career/role/crew/3-state-cargo/mass — it already did exactly this, just never threaded through; `codex-detail.component.ts:3573-3617` made accessible via a new `[heroChips]` input, no logic duplicated); `sc-codex-loadout-save-bar` mounted in the Einsatz header below the mission bar, identical inputs/outputs to the classic view (`codex-holo-stage.component.ts:~160-172`).
5. **Mobile tabs + landscape** — `mobileTabsEnabled` signal + `localStorage['sc.codex.holo.mobileTabs']` (default off = stacked), a checkbox + two-tab control visible only under the 768px breakpoint; `.mobile-hide-table`/`.mobile-hide-data` CSS classes toggle visibility of the table vs. the rails/perspectives/journal/details when tabs are on. Landscape: `@media (orientation: landscape) and (max-width: 1100px)` sets the grid to `44px 1fr 260px` (left rail collapsed edge, table, right rail/"inspector" pane) — interpreting "table | inspector" as table-plus-ports-rail, since the inspector itself is a floating panel INSIDE the table, not a fourth region (`codex-holo-stage.component.ts:~185-200`, `:~420-432`).
6. **Structural hardpoints, full markup** — the ~70-line expandable-row + lazy compat-list block copied verbatim into the Details-drawer projected content (same signals: `hardpointGroups()`, `compat()`, `expandedPort()`, `togglePort()`, `isPortLocated()`, `isPortActive()`, `hoverPort()`) — nothing summarised (`codex-detail.component.ts:1395-1456`).

### Fork guard wiring (item 11)

- `codex-detail.component.ts` `saveLoadoutDraft()`: `ensureEditable(target)` called before the write; `'cancelled'` returns without writing; `'forked'` uses `forkFollowedLoadout(target.id, { loadout: merged })` (single write, per the handoff's preferred option) instead of a separate fork+update (`:2984-2993`).
- `hangar-ship-detail.component.ts` `activate()` (`:601-608`) and `saveLoadout()` (`:626-636`): same guard, same `'forked'` → `forkFollowedLoadout` single-write preference.

### Strip minimal edit (item 7)

`codex-holo-strip.component.ts`: added `sheet().ready` (✓/✕, reusing
`codex.energy.readiness.shortOk/shortNo`) and `codex.energy.draftNote` back
into the expanded panel's `.hp-summary`/below it (`:261-273` template,
`:331-334` CSS) — both existed on `PowerSheet`/as an i18n key already, no new
data or strings invented.

### Updated inventory audit — all 59 rows

Only THREE rows remain a loss, all three explicitly accepted by the user
(concept decision 3) or structurally absent from a sticky strip, not
ambiguous:

| # | Row | Status |
|---|---|---|
| 12 | Pin/compare toggle | **accepted loss** (concept decision 3) |
| 15 | Switch ship | **accepted loss** (concept decision 3) |
| 52 (dock-position radio only) | Energy dock's minimise/expand-position picker | **accepted loss** — concept it.10 explicitly drops it from the strip ("ein auf und zu reicht"); the strip has no docked/floating STATE to position, so the radio group has no object left to control in this view |

Every other row (1-11, 13-14, 16-59) is reachable exactly as described in
the original audit table above, PLUS: #10 (chips) and #27 (save bar) moved
from "not built" to "Einsatz header" (see item 4 above); the "Top-3 named
cohort ships" question from the original handoff is now answered and built
(user decision 1); the 3D/Schema question is now answered and built (user
decision 2).

### Chosen attributes (Wave 2.5, in addition to the Wave 2 list)

- Patch-delta inspector badge: a compact one-line `from → to` string
  (`PortPinBadge`) rather than mounting `sc-codex-holo-patch-delta` a second
  time inside the inspector — that component renders a whole
  `PerspectiveDelta` GROUP (for the KPI tiles), which `sc-codex-holo-patch`
  already shows in its own popover; a single inspected PORT has no
  perspective group of its own, only its own occupant delta, which
  `portPins()` already carries. Reported as a discretion, not a guess: the
  literal instruction ("`sc-codex-holo-patch-delta` inside your inspector")
  is followed in spirit (patch context visible where the pin is inspected)
  without force-fitting a component built for a different granularity.
- `resolveComparisonSide` adapter: top-level stock mounts only, no nested
  `carriedOccupants`/ammo resolution for the COMPARISON side (see the
  adapter's own doc comment, `codex-detail.component.ts:2668-2702`) — neither
  `compareKpiSheets` nor `comparePortOccupants` need sub-slot detail.
- "Recently viewed" persistence key: `sc.codex.recentShips`, cap 20,
  most-recent-first, global (not per-user-id — this app's localStorage
  conventions are per-browser-profile throughout, matching `holoView`'s own
  scope choice from Wave 2).
- Random cohort fill-up: sorted by `className` string order rather than
  `Math.random()`, so the computed stays pure/stable within one
  change-detection pass (no visible re-shuffling on every unrelated signal
  change).

Pushed SHA: `1b6a085` on `claude/codex-schiffsansicht-design-d0ab3a-fe-stage`.

### Questions for the user

None outstanding. The one ambiguity from Wave 2 ("Top-3 named cohort ships")
was resolved by user decision 1; the 3D/Schema-embedding ambiguity was
resolved by user decision 2; the reopened items 3-6 all had concrete
attribute freedom but no remaining scope ambiguity.

### Gates (Wave 2.5)

- `npm run typecheck` — clean (own Bash call).
- `npm run build` — succeeds; same pre-existing style-budget WARNING as
  Wave 2 (`codex-detail.component.ts`, 22.43 kB vs 18 kB warning / 24 kB
  error threshold — not hit), unchanged in kind, +0.32 kB from the new
  `[heroChips]`/patch/share/strip bindings (own Bash call).
- `npx ng test --include='src/app/codex/**/*.spec.ts'
  --include='src/app/hangar/**/*.spec.ts' --watch=false
  --browsers=ChromeHeadless` — **1224/1224 green** (own Bash call), including
  the untouched `codex-detail.component.spec.ts` and `i18n-keys.spec.ts`, and
  every sibling agent's own spec (strip, hangar, patch, patch-delta, share,
  fork-guard, hangar-shared-loadout).
