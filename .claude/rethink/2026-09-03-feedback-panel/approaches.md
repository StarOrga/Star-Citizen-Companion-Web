# Reconciled approaches — Admin feedback panel (2026-09-04)

Three code-blind lens agents, one brief. Raw blocks summarised, then the
reconciliation against `codebase-facts.md`.

## Raw · product-value — "One list, ordered by whose turn"

- Kill all views/tabs/switches/chip rows. ONE scrolling list sorted by
  whose turn: **Your turn** (routine questions, sign-offs, unreleased user
  topics — pre-expanded, action inline; acting collapses it and the next
  rises = the old run without a view), **In flight** (one-line heads, band
  header toggles collapse-all), **Shipped** (day groups, newest first, with
  an in-app link per row; "since your last look · n new").
- Title bar: name + reachability tint, search glyph, progress glyph. Search
  is a full-height overlay: big input + four big targets (Questions /
  Sign-offs / From users / Mine · Others / All). Archive = search result.
- Status: 5-dot **station track** (New → Queued → Building → Review → Done)
  + one **turn badge** (You / Routine / User / —). Terminal branches
  recolour the last station.
- Not built: run view, tabs, chip rows, dated groups in active list, swipe,
  skip, rail, saved views, admin unread inbox.
- blast_radius (agent): new-approach

## Raw · ux-design — "One Stream, Whose Move Is It"

- Two surfaces: **BOARD** (default) and **GELIEFERT** (badge in the title
  bar that glows green + counts up when ships landed since last look = the
  celebration). Board = one scroll, three sticky owner bands: DU BIST DRAN
  (orange-red), LÄUFT (cyan), WARTET AUF USER (dim). Empty band = 24px line.
- First card in DU BIST DRAN auto-expanded, thread folded, answer box
  focused, full-width primary button. Accordion (one open at a time).
- **Flight path**: 4 nodes on a hairline rail (Eingang · In Arbeit ·
  Geliefert · Abgenommen), marker FORM says who holds the ball (◐ routine,
  ◆HALT admin, ◈ user, ○ queued), back-loop arc for "continued", branch
  endcaps for Issue / Abgelehnt / Verworfen, pre-stage ◇ + ▲frei for
  unreleased user topics. Words next to the marker.
- Controls: one 44px search field always visible + one Filter button →
  full-height sheet with 48px rows in three questions (Wer? / Wo steht es?
  = the same path nodes, tappable / Bereich). Active filters = one token.
  ⋯ per card for rare acts.
- GELIEFERT = day feed newest first with `▸ Ansehen` deep link per row;
  declined/issue rows quieter in the same feed; Fortschritt is the last
  section of the feed.
- Maximized = master/detail (340px rail + detail pane). Phone = docked
  layout with full-screen sheets, 48px targets.
- blast_radius (agent): section-rewrite

## Raw · enduser-feel — "One Scroll, Baton On Top"

- One scroll, four zones: **Du bist dran** (first card open), **Geliefert**
  (day log, newest first, "3 neu seit gestern", "Im App ansehen" per row,
  sign-off check duplicated here), **Läuft** (collapsed to header + count),
  **Archiv** (collapsed, count). Compose bar pinned bottom. Header = title +
  dot (+ "Routine offline seit 14:20" as words), search glyph, Bilanz glyph,
  overflow glyph (filter sheet + collapse all).
- Status: 4-station micro-track + a worded baton sentence ("Routine
  arbeitet" / "Frage an dich" / "Wartet auf deinen Haken" …), "Runde 2"
  loop tick for continued.
- Journeys: morning glance 0 clicks; three decisions ≈ 5 taps; release 1
  tap; decline 3 taps; new idea 3 taps + typing.
- Flagged extras: (1) routine questions may carry answer OPTIONS → 2–3 big
  one-tap buttons (graceful fallback to text); (2) viewer panel gets the
  same "Im App ansehen" deep link on done topics; (3) collaborators get a
  read-only delivery log + running titles; (4) offline send wording.
- Celebration = the "neu seit" counter + one header sweep, no confetti.
- blast_radius (agent): section-rewrite (+ two flagged reaches: viewer
  panel, routine convention)

---

# Reconciliation (Step 5, with codebase access)

## Settled core — all three agree (not a variant; goes into every design)

1. **No Übersicht/Abarbeiten/Fortschritt tabs.** One scroll ordered by
   **whose turn** (admin → routine → user → nobody). Derivable today from
   `feedbackBucket()` + `awaitsTriage`/`awaitsReview`/`isAnsweredAwaitingRoutine`
   (codebase-facts § Data). The run view (`feedback-workflow.component`,
   1446 lines) is retired; its queue logic in `feedback.types` survives.
2. **The first "your turn" card opens expanded** with its inline action
   (answer box / accept + resume / release · issue · decline). Acting on it
   collapses it and the next one rises. Accordion, one open at a time.
3. **Status = position on a 4-station path + who holds the baton**, in words
   as well as form. Stations: Eingang · In Arbeit · Geliefert · Abgenommen;
   branches: Issue · Abgelehnt · Verworfen (legacy). All 11 states stay
   distinguishable (mapping in codebase-facts).
4. **Geliefert as a day feed, newest day first**, with `▸ Ansehen` deep link
   from the area tag (needs a 10-line area→route map) + PR/issue link, and
   a "neu seit deinem letzten Blick" marker (one localStorage timestamp).
   This replaces the ship-cheer banner.
5. **Fortschritt stays byte-identical**, re-homed behind a glyph / at the
   end of the delivered feed (`feedback-dashboard.component` untouched).
6. **Controls at rest ≤ 2**: search + one filter entry. Every chip row goes.
   Filters live in a full-height sheet with ≥48px rows (mobile-gate
   baseline). Rare acts (issue order/undo, decline, delete, message user)
   behind one ⋯ per card.
7. **Composer bar pinned at the bottom**, unchanged behaviour.
8. Shell untouched; viewer panel untouched unless the extra below is picked.

## Where they genuinely differ — the three designs

| | Ⓐ Drei Bänder (product-value) | Ⓑ Board + Geliefert-Badge (ux-design) | Ⓒ Stab oben, Log darunter (enduser-feel) |
|---|---|---|---|
| Geliefert lives | **band 3 in the same scroll** after In flight; older ships only via search | **own surface** behind a title-bar badge that glows/counts as the celebration | **zone 2, directly under Du bist dran**, before Läuft ("memory before machine"); Läuft + Archiv collapsed |
| Header | name + tint · 🔍 · 📊 | name + tint · `GELIEFERT · n` badge · ⤢ ✕ (shell) | name + dot **with words when offline** · 🔍 · Bilanz · ⋯ |
| Status glyph | 5-dot track + coloured **turn badge** | **flight path** with marker forms (◐ ◆ ◈ ○), back-loop arc, branch endcaps | 4-station micro-track + **worded baton sentence** |
| Search/filter | search glyph → **overlay** with big targets (Questions / Sign-offs / From users / Mine / Others / All) | **search field always visible** + Filter button → sheet (Wer? / Wo steht es? / Bereich) | search glyph; **overflow ⋯** → sheet (Umfang / Autor / Status / nur Fragen / nur Freigaben) + collapse all |
| Archive | search results only | quiet rows inside the Geliefert feed | zone 4, collapsed, count |
| Maximized | same column, wider | **master/detail** (340px rail + detail pane) | same column |
| Extras | — | ⋯ per card; active-filter token | one-tap answer **options** (routine convention); viewer deep link; collaborator read-only log; offline wording |
| Agent radius | new-approach | section-rewrite | section-rewrite |

## Blast radius vs. the corridor ("panel interior completely; shell +
## data model may be reshaped in presentation")

- Ⓐ, Ⓑ, Ⓒ core: **in-corridor**. All derive from existing columns; no
  migration; shell untouched.
- Ⓑ master/detail in maximized: **in-corridor** (interior), +M effort.
- Ⓒ extra (1) one-tap answer options: **over-corridor** — needs the routine
  to emit structured options (a thread-message convention, routine prompt +
  parser). Shown as flagged outlier; graceful fallback keeps it optional.
- Ⓒ extra (2) viewer deep link: **over-corridor** (viewer panel), but tiny
  (one anchor); flagged, cheap.
- Ⓒ extra (3) collaborator read-only log: **over-corridor** (needs a new
  RLS projection for collaborators); flagged.
- Ⓒ extra (4) offline send wording: in-corridor (heartbeat service exists).

## Effort (codebase-facts § Effort)

- Core stream (any of Ⓐ/Ⓑ/Ⓒ): **L**, splittable into 4 PRs.
- Ⓑ master/detail: **+M**. Ⓒ options convention: **+M** (routine side).
- Ⓒ viewer deep link: **+S**. Ⓒ collaborator log: **+M** (RLS).

## Open questions for the concept page (views)

1. Where does Geliefert live: same scroll (Ⓐ/Ⓒ) or own surface (Ⓑ)? And
   before or after Läuft?
2. Which status glyph: turn badge (Ⓐ), flight-path marker forms (Ⓑ), or
   worded baton (Ⓒ)? (Words can ride along in all three.)
3. Search: always-visible field (Ⓑ) or glyph → overlay/sheet (Ⓐ/Ⓒ)?
4. Maximized: same column or master/detail?
5. Extras: one-tap options · viewer deep link · collaborator log · offline
   wording — which to include (over-corridor ones need a widening).
