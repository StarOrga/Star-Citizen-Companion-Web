# Codebase facts for reconciliation (Step 5 input)

Gathered with code access AFTER the code-blind fresh phase. These constrain
what each approach costs and what survives.

## Surfaces

- `src/app/shell/feedback-fab.component.ts` (324 lines): the shell — FAB,
  docked 480×680 panel (resizable, maximize, full sheet ≤720px), title with
  `scRoutineStatus` tint. **Stays untouched** (corridor).
- `src/app/admin/feedback/admin-feedback.component.ts` (3467 lines, template
  185–1098, styles 1099–1851, class 1852–3467): the board. Owns view switch,
  overview toolbar (Aktiv/Erledigt · Admins/Nutzer · search · expand-all ·
  Filter disclosure → status chips + author chips), stats line, dated groups,
  msgCard template (head, body, thread fold, review gate, reply composer,
  author channel, "Weitere Aktionen" → issue order / decline / delete),
  composer bar. **Template + styles are the rewrite target; the class holds
  ~60 signals/computeds/handlers most of which survive.**
- `feedback-workflow.component.ts` (1446 lines + 485 spec): the Abarbeiten
  run (scope chips, kind chips, progress rail, swipe, one card, skip/done,
  reopen composer). **Retirable** if the run folds into the stream; its
  useful logic (queue building, focus index, thread fold) lives in
  `feedback.types.ts` (`buildWorkflowQueue`, `foldThread`) and survives.
- `feedback-dashboard.component.ts` (882 lines): Fortschritt. **Stays as is**;
  only its mount point moves.
- `feedback-composer.component.ts` (802) + `feedback-attachments.component.ts`
  (325): reusable building blocks, also used by the viewer panel. **Stay.**
- `feedback.types.ts` (1381 + 1200 spec): statuses, buckets, queue, search,
  fold, topic number/title, decline reasons. **Stays; gains a
  "turn/owner" derivation and a "station" derivation** (pure functions, easy
  to spec).
- `celebration.service.ts`, `routine-heartbeat.service.ts`,
  `routine-status.directive.ts`: stay.

## Data already there (no migration needed for any approach)

- `FeedbackRow.shipped_at` (ship day), `reviewed_at` (sign-off), `ship_ref`
  (PR/issue URL), `seq` (#number), `source` (admin/user), `triaged`,
  `decision_note` (decline reason), `area` (news/codex/hangar/starscape/
  desktop/settings/admin/other via migration 20260903120000).
- `areaForUrl()` exists (`feedback-area.types.ts`); its inverse (area → route)
  does not, but is a 10-line map: news→/news, codex→/codex, hangar→/hangar,
  starscape→/starscape, desktop→/download, settings→/settings, admin→/admin.
  That is enough for a "▸ Ansehen" deep link on shipped rows.
- Buckets: `awaiting_admin | awaiting_author | todo | in_progress | review |
  shipped | issue_created | rejected | declined` (`feedbackBucket()`), plus
  markers `isAnsweredAwaitingRoutine`, `isContinuedAfterShip`,
  `pendingIssueRequest`, `awaitsTriage`, `awaitsReview`.
  → "Whose turn" derives cleanly: **admin** = awaiting_admin ∪ review ∪
  (user ∧ untriaged); **user** = awaiting_author; **routine** = todo ∪
  in_progress ∪ answered ∪ continued; **nobody** = terminal ∧ reviewed.
- Stations (4-node path) derive from bucket: Eingang = untriaged user topic;
  In Arbeit = todo/in_progress/awaiting_*/answered/continued; Geliefert =
  review (shipped or issue_created, not yet reviewed); Abgenommen = terminal
  ∧ reviewed. Branch endcaps: issue_created (reviewed), declined, rejected.

## Persisted preferences today (localStorage)

`sc.adminFeedback.view`, `.handled`, `.workflowScope`, `.workflowKind`,
board tab, source filter, expanded ids, `filtersOpen`. A stream design
drops view/scope/kind; keeps expanded ids; adds `lastSeenShippedAt` for
the "since your last look" dot.

## i18n

`adminFeedback.*` ≈ 210 keys DE/EN (`public/i18n/{de,en}.json`). A rewrite
retires ~60 (view.*, workflow.scope.*, workflow.kindFilter.*, tab.*,
sourceFilter.*, filter.*, statusFilter.*, stats.*) and adds ~40 (bands,
stations, turn phrases, filter sheet, shipped feed, "Ansehen").

## Tests

`admin-feedback` has no component spec (logic is tested via
`feedback.types.spec.ts`, 1200 lines). Workflow component spec (485 lines)
goes with the component. Composer/attachments specs untouched. New pure
functions (turn, station, shippedByDay, areaRoute) get specs.

## Mobile gate

Touch targets must measure ≥48px under the panel's scale animations (memory
`sc-mobile-gate-touch-baseline`). Any chip row < 44px tall is a known
finding; band headers, filter-sheet rows and card heads at 48px clear it.

## Effort scale (for the concept page)

- Stream + bands + turn/station derivations + filter sheet + shipped feed +
  retire workflow view + i18n + specs: **L** (2–3 routine days; one PR per
  band is possible: (1) derivations + stream, (2) filter sheet + search,
  (3) shipped feed + deep links, (4) retire run + dashboard re-home).
- Any approach that keeps a separate run view and only restyles: **M**, but
  does not fix the "empty run" finding.
- Master/detail in maximized mode: +M on top (second pane, routing of
  expanded state), phone/docked unaffected.
