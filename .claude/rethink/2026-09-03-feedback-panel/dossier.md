# Hypothesis Dossier — Admin-Feedback-Panel (2026-09-03)

All statements below are HYPOTHESES derived from repo + live evidence, to be
validated in the question round.

## Scope boundary

In scope: everything inside the docked/maximized feedback panel (and the full
board page, which shares the component): the three views, the toolbar/filters,
the topic list and cards, the processing run, the sign-off gate, the author
channel, the composer placement, the dashboard's role.
Out of scope: the panel's footprint/placement (FAB, dock size, maximize,
resize — the admin says 95% perfect), the data model / statuses / routine
contract, the user-facing feedback FAB.

## Intended goal (reconstructed from ~40 commits since #213)

One place where an admin can (a) jot a new topic in seconds, (b) see what is
waiting on THEM (Rückfragen from the routine, Abnahmen), (c) answer those with
one box, (d) occasionally steer: release user topics, order an issue, decline,
(e) glance at throughput. The panel doubles as the "quick analytical look".

## Today's state (live, prod, 2026-09-03, docked 480×680)

- Chrome above the first card in Übersicht with filters open: view tabs +
  two segmented pairs (Aktiv/Erledigt, Admins/Nutzer) + search pill +
  expand-all + "Filter" link + status chips + author chips + stats line +
  day heading = ~230 px of 680 px (≈35 %) before content. Filters closed: ~150 px.
- Filter chips are ~24 px tall, tiny text, and the two chip rows use the same
  visual weight as the segmented tabs and the view tabs → no hierarchy.
- The "124 geshipped" stats line is the only stat left when nothing is waiting;
  it carries no action.
- **Abarbeiten was EMPTY** (Meine 0 / Andere 0 / Alle 0; Rückfragen 0 /
  Abnahmen 0) while Übersicht showed 6 active topics (4 ToDo, 1 In Arbeit,
  1 answered). The run only walks Rückfragen + Abnahmen, so most of the time
  the tab is a "🎉 Alles abgearbeitet" screen while the actual to-do pile lives
  in Übersicht behind a chevron-per-card list. That is the concrete reason the
  three tabs feel interchangeable: the run has nothing, the overview has
  everything, the dashboard is a separate page.
- Abarbeiten shows two chip rows (scope + kind) with counts even when all six
  numbers are 0 → 6 controls for an empty state.
- Fortschritt is dense but coherent; it is the one view the admin did not
  complain about.
- Cards: collapsed head = chevron · #N · title / pill row + author. Expanded =
  full body + thread + composer + "Weitere Aktionen" + (user topics) author
  channel. A long topic body pushes the reply box far below the fold.
- Search is a collapsed pill; the author filter lists raw user handles.

## Gap

The admin says: functionally and by footprint fine; visually and in use "teils
grausam": too fiddly filters, some filters hard to reach, the three tabs are
pretty but underused because Abarbeiten vs Übersicht differ too little.
Hypothesis: the panel accumulated ~10 rounds of "add a switch for X" (source,
tab, status, author, scope, kind, expand-all, search) and each got a chip row,
so the control surface grew linearly while the mental model stayed "one inbox".

## Already tried (so the fresh phase should not re-propose the same mechanics)

- #213 collapse topics into dated one-liners
- #229 declutter filter bar + motivating totals line
- #239 processing mode + dashboard (the three tabs)
- #264 open in processing mode by default
- #275/#276 scope processing queue by author, keep only open Rückfragen
- #315 sign-off tab added, #381/#394 folded back into the run as a chip
- #460 one foldable card per topic, one question per thread
- #464 source switch (Admins/Nutzer), issue order undo
- #485 panel width on mobile

Pattern: each round either added a control or folded one away; none changed
what "Abarbeiten" fundamentally contains (still only Rückfragen + Abnahmen).

## Live look

Possible (admin session in the user's Chrome, prod). Screenshots taken of
Übersicht (filters closed/open, expanded card), Abarbeiten (empty), Fortschritt.
