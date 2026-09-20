# Wave 2 — frontend-patch-share handoff

Branch: `claude/codex-schiffsansicht-design-d0ab3a-fe-patch-share` (off
`claude/codex-schiffsansicht-design-d0ab3a` @ `867ed0a`).

Self-contained components only — `codex-detail.component.ts` (owned by the
stage agent) was NOT touched. Wave 2.5 hosts these via the slot contracts
below.

## A. Patch chooser + Δ view

- `src/app/codex/holo/codex-holo-patch.component.ts` (+ `.spec.ts`) —
  `sc-codex-holo-patch`.
- `src/app/codex/holo/codex-holo-patch-delta.component.ts` (+ `.spec.ts`) —
  `sc-codex-holo-patch-delta`, one instance per `PerspectiveDelta`, rendered
  by A's own template (import chain: A → its own sub-component).

### Slot contract — `sc-codex-holo-patch`

Inputs:
| Input | Type | Source |
|---|---|---|
| `className` | `string` (required) | the ship's `classNameSlug` |
| `channel` | `string` (default `'LIVE'`) | `svc.build()?.channel` |
| `activeBuild` | `BuildRef` (required) | `{ id: svc.build()!.id, patchVersion: svc.build()!.patchVersion }` |
| `activeKpiSheet` | `KpiSheet` (required) | the host's OWN `computeKpiSheet(...)` result for the CURRENT (stock, non-draft) loadout |
| `activeOccupants` | `PortOccupantMap` (required) | `Record<portName, className\|null>` for the current build's ports |
| `resolveComparisonSide` | `(detail: CodexDetail) => HoloPatchComparisonSide \| Promise<HoloPatchComparisonSide>` (required) | see below |

Outputs:
| Output | Type | Meaning |
|---|---|---|
| `kpiGhosts` | `HoloPatchKpiGhosts \| null` | ghost values + delta chips for the KPI band; `null` = comparison cleared |
| `portPins` | `Readonly<Record<string, PortPinBadge>> \| null` | pin badges keyed by port name; `null` = cleared |
| `comparisonBuild` | `CodexBuild \| null` | the picked build, or `null` once cleared |

`HoloPatchComparisonSide = { kpiSheet: KpiSheet; occupants: PortOccupantMap }`.
`PortPinBadge = { portName, fromClassName, toClassName, unresolved }` —
`unresolved` is true when the port key exists in `activeOccupants` but not in
the comparison side's `occupants` (the port itself doesn't exist on that
build — wave1-redteam note, `codex-holo-patch.component.ts:295`).

### `resolveComparisonSide` — exactly what the host must adapt

`codex-detail.component.ts` resolves a ship's stock KPI input and occupants
through a private, loadout-draft-aware, PARTLY ASYNC pipeline — not exported,
and per the pre-mortem instruction ("reuse, never reimplement") this
component does not copy it. The host generalises the following from its own
signals into one function of an arbitrary `CodexDetail` instead of the
component's own `detail()` signal:

- `kpiShipInput` (`codex-detail.component.ts:2943-2948`) — trivial, already a
  pure function of one `CodexDetail`: `{ flight: p.flight, stats: p.stats ?? null }`
  where `p = detail.payload as ShipPayload`.
- `summaryOccupants` (`codex-detail.component.ts:2888-2900`) — depends on
  `resolvedLoadout` (`:2793-2814`), which depends on `loadoutAll()` (the
  ship's port list) and the ASYNC `loadoutPayloads`/`ammoPayloads` signals
  (`:1768-1771`, populated by `CodexService` batch payload reads at
  `:1986`/`:2049`). For the comparison build this means: read `detail.ports`
  for the port list, collect their occupant class names, batch-fetch their
  payloads for THAT build (same shape as the host's own fetch, but scoped to
  `buildId` instead of the current build), then run the same
  occupant-shaping logic. **Use the STOCK resolution
  (`summaryOccupants`), never `draftSummaryOccupants`** — the Δ view compares
  two PATCHES, not the viewer's unsaved draft against a patch.
- Port occupancy for `comparePortOccupants` is the STOCK per-port occupant
  (one entry per `detail.ports[i].portName`), not the draft-overlaid view —
  same reasoning.

This function does not exist today; Wave 2.5 either exports a pure version of
the two computeds parametrized over `(detail, ports)` from
`codex-detail.component.ts`, or writes the small adapter directly in the host
template/class that wires `sc-codex-holo-patch`. No guess was made about
which — flagged so Wave 2.5 makes the call with the component in front of it.

### Never-finalised builds (redteam item, `codex.service.ts:755-770`)

`isFinalised(b) = totalRecordCount(b.entityCounts) > 0 && b.schemaVersion > 0`
(`codex-holo-patch.component.ts:243-245`, reusing `totalRecordCount` from
`codex-patch-timeline.ts`). Chose **mark, not hard-filter** — same idiom
`codex-patch-headline.component.ts` already uses for "no data" patches
(disabled row + `aria-disabled` + an in-words flag, never colour alone): a
patch list that is ALL non-finalised would otherwise render empty with no
explanation.

### Admin-only schema row

Rendered only when `roles.isCollaborator()` (Wave-1 `RoleService`, same
`isAdmin`/`isCollaborator` gate `codex-status-banner.component.ts` uses) AND
a comparison build is selected. Styled with `--sc-accent-hot` per CLAUDE.md
("red means elevated access") and carries the visible label
`codex.holo.patch.adminOnly` ("Nur Admin/Collaborator") — never colour alone.
Shows `schemaVersion`, `extractedAt`, `entityCounts` total (via
`totalRecordCount`), and `isReExtractPending` (existing `codex.types.ts`
helper, reused not reimplemented).

## B. Share popover content

- `src/app/codex/holo/codex-holo-share.component.ts` (+ `.spec.ts`) —
  `sc-codex-holo-share`.

### Slot contract

Inputs: `config: HangarShipConfig | null` (null = ship not in the viewer's
hangar, or signed out — only action (1) shows), `shipClassName`, `channel`,
`patchVersion` (all `string`, required — same triple the host already reads
off `svc.build()` for the patch trigger).

Outputs: `copyCurrentLink: void` (today's `?loadout=` share, inventory #14 —
the host wires this to its EXISTING `copyShareLink()`,
`codex-detail.component.ts:2579-2588`, unchanged; this component never
touches `location.href` or the clipboard for that action itself), and
`configRefreshed: HangarShipConfig` (fires after a successful
`refreshFollowedLoadout` pull so the host can swap in the fresher config).

Behaviour: action (1) always renders. Action (3) — "verwaltet von
`<ownerName>` · Stand `<ownerUpdatedAt>`" + Aktualisieren — renders when
`config.followsOwner`, using `loadoutVariantHint()` (`hangar.types.ts:161-174`,
already reads `ownerUpdatedAt` per the wave-1.5 fix, never the follower row's
own `updatedAt`). Action (2) — create/copy/revoke a `hangar_share_links` row
via `HangarService.createShareLink`/`revokeShareLink` — renders only for a
config that is NOT following (`!config.followsOwner`): a still-following
config has nothing of its own to share, only the owner's link (out of scope
here — re-sharing a followed config was not asked for and is not built).

## C. Shared-link landing page

- `src/app/hangar/hangar-shared-loadout.component.ts` (+ `.spec.ts`) —
  `sc-hangar-shared-loadout`.
- Route: `src/app/app.routes.ts` — `/hangar/shared/:token`, added to the
  **ungated public layout's** children array (next to the existing
  `shared/loadout/:token`), NOT under the gated shell's `hangar/...` routes —
  those sit behind `canActivateChild: [authGuard, approvedGuard]`, which
  would bounce a signed-out recipient before the page ever renders. Same
  "public by design, token is the whole authorization" reasoning as the
  existing `social/shared-loadout.component.ts`, mirrored closely
  (loading/available/unavailable states, one indistinguishable "unavailable"
  answer for unknown/revoked/expired — no probe surface).

Behaviour: `peekSharedLoadout(token)` on `ngOnInit`; anonymous
(`!auth.isAuthenticated()`) sees the read-only card + a `routerLink="/login"`
CTA; signed-in sees the same card + an "Übernehmen" button that calls
`adoptSharedLoadout(token)` then navigates to
`/codex/ship/<shipClassName>?view=holo` (route is `codex/:kind/:className`,
so the navigation array is `['/codex', 'ship', shipClassName]`).

## D. Fork guard

- `src/app/codex/holo/codex-holo-fork-guard.ts` (+ `.spec.ts`) —
  `CodexHoloForkGuard` (`providedIn: 'root'` injectable, not a component).
  `ensureEditable(config): Promise<'own' | 'forked' | 'cancelled'>` — `'own'`
  immediately (no prompt) when `!config.followsOwner`; otherwise
  `window.confirm(t('codex.holo.patch.forkGuard.question'))` (same
  confirmation idiom as `admin.component.ts`/`p4k-history.component.ts`,
  `codex-holo-fork-guard.ts:44`), then `HangarService.forkFollowedLoadout(id, {})`
  on confirm.

### Write paths that MUST call `ensureEditable` before writing — NOT wired here

| Call site | What it does today | Required change |
|---|---|---|
| `src/app/codex/codex-detail.component.ts:2559` (`activateConfig`) and `:2563` (`updateConfig`), inside `saveLoadoutDraft()` (`:2534-2569`) | Activates/updates the ship-page save-bar's target config directly | Before `:2563`'s `updateConfig`, call `ensureEditable(target)`; on `'cancelled'` abort without writing; on `'forked'` re-read `target` (the fork already wrote `loadout`/`name`/`role` via `forkFollowedLoadout`'s own `patch` argument, so the separate `updateConfig` call may become redundant — Wave 2.5's call, `forkFollowedLoadout(target.id, { loadout: merged })` in ONE write is the tighter option) |
| `src/app/hangar/hangar-ship-detail.component.ts:601` (`activate()`) | `hangar.activateConfig(cfg.id, ship.id)` | `ensureEditable(cfg)` before the call; abort on `'cancelled'` |
| `src/app/hangar/hangar-ship-detail.component.ts:626` (`saveLoadout()`) | `hangar.updateConfig(cfg.id, { loadout })` | `ensureEditable(cfg)` before the call; on confirm, prefer `forkFollowedLoadout(cfg.id, { loadout })` over a separate fork+update |

Not wired because all three files are owned by other agents (stage /
hangar-strip) per the task's literal "do not touch codex-detail.component.ts"
and "you build self-contained components" instructions.

## E. i18n

Added to **both** `public/i18n/de.json` and `public/i18n/en.json`:
`codex.holo.patch.*` (trigger, popTitle, loading, empty, notFinalised, clear,
comparing, perspective.{offensive,defensive,movement,signature},
delta.{noChange,kpi,from,to,change}, adminOnly, schema.*, forkGuard.question),
`codex.holo.share.*` (copyLink, followedBy/followedSince, refresh(ing),
createLink/creating, copy/copied, revoke/revokeNote/revoked, errorGeneric),
`hangar.shared.*` (eyebrow, loading, by, emptyLoadout, adopt(ing)/adoptHint/
adoptError, loginToAdopt, aboutCta, unavailable.title/body). Reused existing
`codex.kpi.*` and `hangar.roles.*` keys instead of duplicating them
(`codex-holo-patch-delta.component.ts:14-41`, note `armorHp` maps to the
existing `codex.kpi.armor`, not a new `armorHp` key).

## Chosen attributes (discretion, not scope)

- Δ view direction: `from = active build, to = picked build` — the ghost
  overlay always reads "what would this look like on `<picked patch>`"
  relative to what's currently shown.
- Never-finalised builds: marked + disabled, not removed from the list (see
  above).
- Fork guard uses `window.confirm`, matching the rest of the app's
  destructive-action confirmations.
- Share popover: action (2) gated on `!followsOwner` (a followed config
  shares nothing of its own) — not explicitly specified, judged the only
  coherent reading of "for a config with `followsOwner`: the hint... and a
  refresh action" (i.e. that branch replaces, not supplements, action 2).

## Gates

- `npm run typecheck` — clean.
- `npm run build` — clean (see command output in the session; production
  bundle built successfully).
- `npx ng test --include='src/app/codex/**/*.spec.ts' --include='src/app/hangar/**/*.spec.ts' --watch=false --browsers=ChromeHeadless`
  — `1206 SUCCESS`, including `i18n-keys.spec.ts`.

## Questions for the user

None — every point that changed what was built (never-finalised mark vs.
filter, Δ direction, the `resolveComparisonSide` adapter shape, the share
popover's action-2 gating) was a discretion call within the literal ask, not
an ambiguity that changes WHAT gets built, and is recorded above rather than
guessed silently.

## Pushed SHA

See the branch `claude/codex-schiffsansicht-design-d0ab3a-fe-patch-share` —
commit created and pushed after this document (SHA logged in the session's
final report).
