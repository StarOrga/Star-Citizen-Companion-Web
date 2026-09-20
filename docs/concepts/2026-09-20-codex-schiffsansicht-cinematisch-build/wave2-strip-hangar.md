# Wave 2 — frontend-strip-hangar handoff

Branch: `claude/codex-schiffsansicht-design-d0ab3a-fe-strip-hangar` (off
`claude/codex-schiffsansicht-design-d0ab3a` @ `867ed0a`, the current tip —
the parent branch had moved past the `919c251` snapshot named in the task by
the time this run started; synced onto `origin/…` per the branch-setup rule
rather than the stale SHA). Two new, self-contained standalone components for
the stage agent to host in Wave 2.5; `codex-detail.component.ts` and
`data-uploader/` untouched.

## Files

- `src/app/codex/holo/codex-holo-strip.component.ts` (658 lines) + spec (101
  lines) — the combined sticky bottom strip.
- `src/app/codex/holo/codex-holo-hangar.component.ts` (347 lines) + spec (150
  lines) — the hangar tab/overlay/hall.
- `public/i18n/{de,en}.json` — `codex.holo.strip.*` / `codex.holo.hangar.*`
  keys added (both files, same shape).

## A · `sc-codex-holo-strip` (`codex-holo-strip.component.ts:380`)

Layout matches `strip_final` (decisions JSON iteration 10) exactly: Einsatz →
arrow → Offensive/Verteidigung/Bewegung mini tiles → ring joint (no label) →
Signatur & Kühlung → an open/close toggle only when collapsed. Expanded panel
carries SCM/NAV + the Schleichen preset, the pip stacks, the cooling gauge AND
the energy summary (inventory #52 in full, `:519-563` for the panel).

**Reuse, not reimplementation.** The reactor/cooling maths is the exact
`computePowerSheet()` call `sc-codex-energy-dock` makes (`codex-power.ts`,
`:439-457`), including the same per-ship localStorage/URL draft persistence
(`codex-loadout-draft.ts`, `:472-541`). The three mini tiles group `cells()`
(the SAME `KpiStripCell[]` the KPI band already computes for the active
mission) via `PERSPECTIVE_KPIS` from `codex-build-compare.ts:26-31` — the
identical classification the patch-Δ view's `buildPerspectiveDeltas` uses, so
a ship's Offensive/Verteidigung/Bewegung split can never drift between the two
surfaces (`:456-467` in the strip).

**Inputs (mirror `sc-codex-energy-dock` + `sc-codex-kpi-band` +
`sc-codex-mission-bar` 1:1, `:382-403`):**

| Input | Type | Host signal (`codex-detail.component.ts`) |
|---|---|---|
| `occupants` | `readonly SummaryOccupant[]` (required) | `draftSummaryOccupants()` |
| `shipStats` | `Record<string, Record<string, string\|number\|boolean\|null>> \| null` | `shipPayload()?.stats ?? null` |
| `shipClassName` | `string` (required) | `shipClassName()` |
| `schemaVersion` | `number \| null` | `build()?.schemaVersion ?? null` |
| `userId` | `string \| null` | `currentUserId()` |
| `crossSection` | `number \| null` | `crossSectionMax()` |
| `cells` | `readonly KpiStripCell[]` (required) | `kpiCells()` |
| `active` | `MissionId` (required) | `activeMissionId()` |
| `capabilities` | `ShipCapabilities \| null` | `shipCapabilities()` |
| `rankResult` | `RankResult \| null` (see below) | `rankResult()` |
| `rankCohortLoading` | `boolean` | `rankCohortLoading()` |

**Outputs:** `sheetChange` (`PowerSheet`) → `powerSheet.set($event)`;
`missionChange` (`MissionId`) → `setMission($event)` (present for parity, not
wired to any control in the collapsed/expanded template — the strip shows the
active mission as a summary only, it does not duplicate the mission-bar chips;
see "Chosen attributes").

**CSS hook for the host:** `:host { position: sticky; inset-block-end: 0; }`
(`:299`) — the host places it last in the flow exactly where the energy dock
sits today, nothing else to wire.

## B · `sc-codex-holo-hangar` (`codex-holo-hangar.component.ts:215`)

No inputs — self-sufficient via `HangarService`/`AuthService`/`CodexService`
injection, same as the pattern `codex-list.component.ts` uses for its own
hangar chip. **CSS hook for the host:** `.holo-hangar` is `position: relative`
and centers its own tab; the host is expected to give the wrapping element
`position: absolute; top: 0` at the table's top edge (concept hv5-s1 —
"angedockt zu diesem Bereich, auch ungeöffnet") — this component supplies the
tab + overlay box, not the outer docking position.

- Tab: `--sc-accent` (never `--sc-accent-hot` — a plain viewer's own hangar is
  not an elevated-access surface, root CLAUDE.md's red-means-admin rule).
- Overlay: fixed `block-size: 236px`, `overflow: hidden` (`:172-187`) — search
  is always rendered (`:63-69`), never conditionally hidden.
- Grouping: `GROUP_THRESHOLD = 8` (`:26`, chosen attribute) — above it the
  flat tile grid is replaced by role-count buttons (`groups()`, `:279-287`);
  clicking a group FILTERS the same fixed-height area to that group's ships
  (`activeGroup`, `:291`) rather than nesting an accordion, which is how "no
  scrollbars, ever" stays true even with more ships than the box can show at
  once — a nested `<details>` growing past 236px would have broken that
  constraint the first time a group itself overflowed.
- Silhouette: `CodexService.silhouettes('ship', classNames)` batch
  (`:314-318`), §C3 neutral ring placeholder when a silhouette is missing
  (`.ring`, `:82`).
- Variant hint: `loadoutVariantHint()` (`hangar.types.ts:177-191`) → `heute` /
  `gestern` / absolute date via `relativeDayBucket()`
  (`core/locale/date-format.ts:180`), or `managedBy` with the RPC-resolved
  `ownerName` — see "Owner name resolution" below. Never a source string.
- Hall: `hallOpen` signal, fullscreen grid, same `HangarTile`/tile markup,
  natural scroll (not height-constrained — only the docked overlay is).
- Signed-out (`signedIn()`, `:229`): the overlay renders ONLY the sign-in
  link, no search/tiles/hall button.

**Owner-name resolution (wave1's declared gap).** `wave1-core-web.md`
"Deliberately NOT done" explicitly assigns "owner display-name resolution for
`managedByOwner`" to this wave. A plain `listConfigs()` row never carries
`ownerName` (only `adoptSharedLoadout`/`refreshFollowedLoadout` populate it,
wave1.5 fix B) and there is no generic "look up any user's display name"
client call anywhere in the app — so for every hangar ship whose active config
is still `followsOwner: true`, `load()` calls
`hangarService.refreshFollowedLoadout(configId)` (`:320-329`), which is
exactly the RPC path the service already offers for this: it re-reads the
row AND resolves `ownerName` server-side (`hangar_follow_snapshot`, wave1.5).
This is the "existing profile-lookup" wave1 deferred to — not a new one.

## Inventory audit (wave0-research.md §A rows #24-26, #52)

| # | Item | Where it lives now |
|---|---|---|
| 24 | Rank card (radar, percentile, verdict) | UNCHANGED, `sc-codex-rank-card` still renders separately; the strip additionally consumes its `RankResult` for the three tiles' percentile (new use, not a move) |
| 25 | KPI band (6 cells/mission) | UNCHANGED, `sc-codex-kpi-band` still renders separately; the strip additionally consumes its `cells()` output, grouped into 3 tiles instead of 4/6 |
| 26 | Mission bar (chips, disabled reasons, reset) | UNCHANGED, `sc-codex-mission-bar` still renders separately — the strip's `missionChange` output is mirrored for API parity but the strip itself shows only a read-only Einsatz summary (label + ship count + percentile), never the chip picker (concept: the strip is "Zusammenfassung der Analyse", not a control surface) |
| 52 | Energy dock (full feature set) | MOVED into the strip's expanded panel: budget/segments → `hp-summary` (`:245-253`); position radio → DROPPED (concept it.10: "in der nicht aufgeklappten Leiste reicht ein auf und zu" — no dock-position picker in the Holotable view, loss accepted same as compare/switch-ship, concept decision 3); minimise/expand → the strip's own toggle; re-extract gap tags → `codex.energy.gap.noReactorData` fallback (`:222-224`); minimised strip (IR/EM/CS/cooling%/readiness) → the collapsed `.sig` segment (`:129-159`), readiness glyph specifically DROPPED per concept it.10 ("Sichtbar als raus") — see "Not built" below; pip stacks + arrows + top-off + tooltips → `hp-pips` (`:200-238`), same `codex-power.ts` helpers; group toggle + tooltip → same, `grp-btn`/`tipbox`; facts+deltas → `.sig .fact` (`:141-159`); heat gauge → `hp-cooling` (`:255-263`); footer modes/presets/draftNote → `hp-modes` (`:190-198`), draftNote DROPPED (chosen attribute — the expanded panel already carries `hp-summary`'s live numbers, a second static note was redundant screen space in the fixed-height panel); state in localStorage/URL → same keys, reused verbatim (`:487-538`) |

## Chosen attributes (unspecified by the request)

- Strip: `SIGNATURE_RANK_KEYS = ['ir', 'crossSection']` for the class-rank
  pips (em/coolant have no rank axis to borrow); 5-pip scale,
  `Math.round(meanPercentile / 20)`.
- Strip: `missionChange` output kept for input/output PARITY with
  `sc-codex-mission-bar` per the literal instruction ("outputs mirror
  theirs") even though nothing in the strip's own template emits it yet — the
  host is free to ignore it; documented rather than silently dropped.
- Strip: mini-tile percentile = mean of the `RankResult` axes that fall in
  that perspective's `PERSPECTIVE_KPIS` set (own function, `:456-467`) — no
  existing model computes a per-perspective mean, only per-axis.
- Strip: pulse/count-up is CSS-only (`.pulse { transition: color .4s }`,
  reduced away by the blanket `prefers-reduced-motion` rule at `:656-660`) —
  no JS-side "did this value change" tracking, since the underlying signals
  already re-render the DOM node only on an actual value change.
- Hangar: `GROUP_THRESHOLD = 8`; group-click FILTERS instead of nesting
  accordions (see above); the fullscreen hall has no threshold/grouping —
  it's presented as a plain grid with natural scroll.
- Hangar: readiness ✓/✕ from the old minimised strip NOT carried into the
  Signatur & Kühlung segment (see "Not built").

## Not built (ambiguous — flagged, not guessed)

- **Readiness ✓/✕ in the collapsed strip.** Concept it.10's own final note
  says `"Sichtbar als raus" ... im aufgeklappten rechts daneben einbauen` —
  literally "move visibility-as OUT [of the collapsed strip], build it in
  the EXPANDED panel next to [something]" but never names the "something,"
  and readiness (reactor can/cannot hold its minimums) is a different fact
  from "Sichtbar als" (which mission-lens visibility label was shown). Both
  the OLD minimised-strip readiness glyph and this instruction are candidates
  for the same removed slot, and picking one would either keep a fact the
  concept explicitly asked to hide or drop one it never mentioned. Left out
  of both the collapsed strip and the expanded panel — `sheet().ready` is
  still computed and available on the component if the host wants it exposed
  differently.

## Gates

- `npm run typecheck` — clean (own Bash call).
- `npm run build` — `dist/sc-companion/browser` regenerated with 126 files
  incl. `index.html` (own Bash call; the `ng build` process itself hung
  after writing every artifact — the known no-exit issue, memory
  `sc-vercel-ng-build-no-exit-hang` — confirmed complete by the dist
  timestamps, not by the process exiting, and killed rather than left
  running).
- `npx ng test --include='src/app/codex/**/*.spec.ts' --watch=false
  --browsers=ChromeHeadless` — 1144/1144 green, including
  `i18n-keys.spec.ts` (own Bash call).

## Questions for the user

None outstanding for the built scope — the one genuine ambiguity (readiness
placement) is listed under "Not built" rather than guessed.

## Pushed SHA

See branch `claude/codex-schiffsansicht-design-d0ab3a-fe-strip-hangar` —
pushed after this doc in the same logical step (see the accompanying commit).
