# Appendix: the admin panel (UI reference)

> Read when: the admin asks about the board itself — the stream, the Fortschritt
> dashboard, topic numbers, search.
> **The routine never reads this file to do its work**; nothing here changes what
> it reads or writes. Core contract: [`../feedback-routine.md`](../feedback-routine.md).

## The admin side: the stream (concept 2026-09-04, direction E)

The routine's counterpart is the admins-only panel (`sc-feedback-fab` →
`sc-admin-feedback`, embedded in a FAB overlay reachable from every page, and
the same component on the full board page `/admin/feedback`). Since concept
2026-09-04 the three views (Übersicht / Abarbeiten / Fortschritt) are gone:
Übersicht and Abarbeiten were two views of one pile, and the panel now IS that
pile — **one scroll in three bands, ordered by whose turn it is**. Nothing the
routine reads or writes changed; this section only describes what the admin
sees.

| Band | What is in it | Order |
|------|---------------|-------|
| **Du bist dran** | every open Rückfrage (`needs_input` with the routine's message last), every pending sign-off (`shipped` / `issue_created` with `reviewed_at is null`), every user topic still held back (`triaged = false`) | longest wait first (`waitingSince`) |
| **Läuft** | the routine's pile — untouched `open`, answered Rückfragen, `in_progress`, post-ship continuations — and questions parked at a user (`needs_input_author`) | newest activity first |
| **Geliefert** | every outcome — shipped, handed to an issue, declined, legacy rejected — **by day, the last day on top**, signed off or not | newest day first, newest topic first inside a day |

The derivations live in `feedback.types.ts` and are the single source for the
bands, the filter sheet, the card glyph and the opened topic: `turnOf` (admin ·
routine · user · nobody), `adminAsk` (question · review · release — what the
admin is asked for), `flightPosition` (the place on the four-station path
Eingang → In Arbeit → Geliefert → Abgenommen, with a branch endcap for issue /
declined / rejected, a `loop` flag for a post-ship continuation and a `queued`
flag that tells the routine's queue from a topic it holds right now), and
`deliveredByDay`. Every one of the eleven states the old status pills spelled
out is still distinguishable through that quartet — as a place on a line plus
a few words instead of a pile of pills (`feedback.types.spec.ts` asserts it).

**The first card of "Du bist dran" opens with its action inline** — the
routine's question (labelled `AI`, no avatar) with an answer box, the sign-off
with ✓ Abnehmen (reopening happens by replying inside the topic), or the release
button on a user topic. Acting on it moves the topic out of the band and the next card rises.
Every other card, and the lead card too, **opens the topic as a full-panel
sheet**: the poster's first message, the newest message, and between them one
"…" that unfolds one more message per tap (from the newest backwards); the
review gate, the release button and — on a user topic — the author channel
follow; the composer is glued to the bottom edge (a tall field, the half-size
chips with the "+" and "capture this page" tiles of the attachment row
(admin feedback 312a4acc, `PageScreenshotService`), one red
send button, and no frame of its own — the sticky bar's top border is the
separation). Its placeholder names the topic the reply lands in ("Antwort zu
#211 — …"). Sent messages longer than three lines fold behind "Mehr
anzeigen". The rare acts — Issue erstellen / Zurücknehmen, Nicht umsetzen &
löschen (with the canned reasons), Löschen, Im App ansehen and the link to the
PR / issue — sit behind the one ⋯ in the sheet's head.

The sheet carries **no chrome above the first post** (admin feedback 187574ed):
the poster/kind/timestamp row and the flight-path/baton/chips row it used to
open with repeated what the stream card the admin just tapped already said, and
together they pushed the topic's first sentence below the fold. Both are gone —
what is left is first post, last post, input field. The one thing on them that
was not repeated elsewhere in the sheet, the ship/issue link, moved into the ⋯
menu rather than disappearing with them.

**Controls at rest are two**: the search field (unchanged fuzzy search, see
"Searching the board") and one Filter button that opens a full-height sheet —
*Wer?* (Alle / Meine Themen / Andere Admins / Nutzer-Feedback / one author),
*Wo steht es?* (every presentation bucket, with counts), *Bereich* (the area
tags). Each question is answered by a **wrapping row of chips**, not a column
of full-width rows: stacked rows spent the whole horizontal axis on one option
and pushed the later ones out of the sheet's scroll port — at ~490 px the
fourth *Wer?* option was cut in half (feedback 04013a4c). Chips are ≥ 48 px
tall, wrap instead of scrolling sideways, carry their count inline, and the
picked one is a filled accent pill with a ✓ so the state reads without colour
(it replaced the left accent bar). An author chip is dashed — the same
single-choice set, one tier down. A search flattens the bands into one relevance-ordered list. The
Fortschritt dashboard lives behind the 📊 glyph next to
the filter button — the glyph now carries the word *Fortschritt* beside it
(hidden below 420 px like the filter label) and a tooltip that says what the
page is rather than repeating the button's own label (feedback a33ba528). The new-topic composer is the bar pinned under the stream.

**A row sits on the panel, and the panel never scrolls sideways.** Stream rows
draw an outline and nothing else: no fill, no `--sc-card` glow. The glow blurs
16 px and the rows are 8 px apart, so the halos merged into one continuous
light haze that read as a shared background box wrapped around each band's
group of issues (feedback 96259f21). The list itself is `overflow-y: auto` /
`overflow-x: hidden` — `overflow-y` alone leaves x at `visible`, which computes
to `auto`, and then a few stray pixels put a horizontal scrollbar under the
whole overview. The band head's chevron was exactly that: an inline glyph
rotated 90° turns its line height into its width, so every expanded band
overhung its row by ~3 px. It is a fixed 16 × 16 box now.

**Roles and red.** Avatars are initials coloured by `profiles.role` — admin in
the elevated-access red (`--sc-accent-hot`), collaborator light blue, viewer /
unknown grey-blue; the topics select `author:profiles(display_name, username,
role)` (admins may read every profile, policy `profiles_admin_read_all`, so no
projection was needed). That colour is the whole answer to "order or user
feedback?" — the stream row used to spell it out as *Auftrag* / *Nutzer-
Feedback* next to it, which said the same thing twice and cost the meta line a
third of its width, so the words are gone (feedback 96259f21). A routine
message carries the plain text label *AI* and no circle. Red is used exactly twice: the admin avatar and
the one primary call to action of a card or sheet (send / ✓ Abnehmen / Für die
Routine freigeben). `--sc-danger` stays reserved for errors and destructive
acts.

**"Neu seit deinem letzten Blick".** The Geliefert band's head counts every
outcome that finished after the previous visit
(`sc.adminFeedback.lastSeenDelivered`, written behind the preferences consent
at each open, registered in `PREFERENCE_KEYS`), and each such row wears a
`neu` chip. Delivered rows carry `▸ Ansehen` — a real `<a [routerLink]>` to the
section root of the topic's area (`areaRoute`, the inverse of `areaForUrl`;
nothing on an untagged topic) — and the PR / issue link. A shipped topic that
still waits for its sign-off is in the feed on its ship day (with the ✓ in the
row) *and* in "Du bist dran". The ship-cheer banner is gone; the confetti
burst stays.

**What the retired run offered and the stream does not.** Überspringen with
the lap, the local "Erledigt" tick-off (`sc.adminFeedback.handled`), the swipe
gestures, the progress rail and the scope / kind lenses went with
`feedback-workflow.component.ts` — the band is the queue, its order is the
walk, and acting on a card is what advances it. The toolbar's expand/collapse-
all and the motivating stats line went with the chip rows. The localStorage
keys `sc.adminFeedback.view`, `.handled`, `.workflowScope`, `.workflowKind`
are no longer read.

### What the Fortschritt view shows (feedback ef15ea67, reworked a33ba528)

The dashboard is **read-only and always-on by design — no filters, pickers or
toggles**: the admin asked for a view that is informative the second it opens.
Everything is hand-rolled SVG/CSS on the existing tokens (no charting
dependency).

**The 2026-09-05 rework (feedback a33ba528)** re-cut the page around a single
question — *what does a returning admin learn that they did not know last
week?* The previous layout led with a "Diesen Monat / All-time" pair (a donut,
four bars and two pace figures per column). The all-time column could not move:
its shipped share shifts by a fraction of a percent per week and its Erledigt
bar only ever grows. The monthly column reset to nothing every 1st. And the
lifecycle map underneath was contract documentation, not a measurement. So the
page now reads:

1. **Diese Woche** (`weeklyPulse`) — **Erledigt**, **Neu eingegangen** and the
   **Median bis Ship**, each since Monday 00:00 and each with the same figure
   for the previous *complete* week beside it. Deltas live only here, because
   this is the only block whose numbers move weekly. Under it, one sentence
   states the thing the three numbers are actually asked about: whether the
   pile grew or shrank this week.
   - The comparison is the previous **calendar** week, not a rolling 7 days —
     "seit Montag" is the frame the board is read in, and a rolling window
     redefines itself every day.
   - The intake delta is deliberately tone-neutral (more feedback is a busier
     week, not a worse one); only Erledigt and the median are coloured.
2. **Jetzt auf dem Board** (`lifecycleSnapshot`) — the live queue, no window
   and no projection: **Wartet auf dich** (Rückfragen an den Admin + the
   sign-off gate + review holds whose PR waits on a human merge), **In Arbeit**
   (routine + Rückfragen an Nutzer), **Unangefasst**, and the age of the oldest
   still-open topic. A queue is worth knowing *now*, so it is a state, not a
   trend.
3. **Durchsatz** (`weeklySeries`) — 12 calendar weeks, and now **two** series:
   the faint full-width column is what came IN that week (`created_at`), the
   solid inner column is what SHIPPED (`shipped_at`). A ship count alone cannot
   answer "are we keeping up" — five ships in a twelve-topic week is a losing
   week. A continuation counts once, in the week of its latest ship
   (`shipped_at` is bumped at each re-ship). Under the chart sit the two slow
   quality figures over a **30-day** window: the **median time-to-ship** and
   the **Rückfrage rate** (share of topics raised in the window the routine had
   to ask about). They are windowed at 30 days, not 7, because on a weekly
   sample they swing between 0 % and 50 % on a single topic.
4. **Lebenszyklus** — this document's "Contract" diagram rendered live, now
   inside a `<details>` that is **collapsed by default**. It is reference
   material: correct, occasionally useful, and identical from week to week. The
   spine is the happy path (ToDo → In Arbeit → Geshipped); every branch is
   labelled with what triggers it: the routine's Rückfrage and the admin's
   answer back into ToDo, the reaper reopening a stale claim
   (`in_progress → open`), the review hold (`in_progress` **with** a `ship_ref`,
   waiting on a human merge), the post-ship continuation loop back into In
   Arbeit, and the terminal `issue_created` / legacy `rejected` stages. Each
   node carries its current occupancy plus the operational annotations —
   oldest active topic in days, how many ToDo items are answered Rückfragen /
   continuations / reaper-reopened, and how many `in_progress` rows are review
   holds rather than active work (the holds that this doc's "Surfacing open
   review-holds" section warns can rot unnoticed).

**Dropped in the rework**, because none of them could tell one week from the
next: the all-time window entirely (donut, four bars, pace pair), the monthly
window's donut and bars, and the `dashboard.thisMonth / allTime / shippedShare /
donutLabel / note / todo / done / issues / openHint` keys that went with them.

**Honesty rule.** A figure is printed only when the board's own stamps support
it. A week without ships renders the median as an em dash, never as a `0`; the
median's delta is direction-only (`▲`/`▼`/`±`) because a percentage change over
a handful of ships pretends to a precision the data has not got, and the sample
size is printed next to it. Durations are measured **only** on rows carrying a
real `shipped_at` — the `updated_at` fallback that `computeStats` uses for
*attribution* would invent durations for legacy rows that never got a stamp.

There is **no transition history** in the schema, so the map annotates occupancy,
never pass-through counts — `lifecycleSnapshot` derives everything from the rows
and threads the board already holds. The map is a plain `<ol>`/`<ul>`, so it
reads as text for assistive tech (dots, spine and meters are `aria-hidden`), and
it is a vertical spine rather than a horizontal flow chart precisely so it never
scrolls sideways in the docked panel. The chart itself carries a text
`aria-label` naming both series, their peak and the running week.

### Referring to a topic by number (feedback 21587480)

Every topic carries a **stable sequential number**, shown as a quiet `#42` ahead
of the title on every stream card and in the opened topic's head. It exists so a
topic can be *named* in a conversation — "das aus #42" — instead of being quoted
or identified by its uuid.

It is a DB column, `admin_feedback.seq`, fed by the sequence
`admin_feedback_seq_seq` (migration
`20260726230000_admin_feedback_seq.sql`), **not** a position in the rendered
list. That distinction is the whole feature: the stream is filtered by
who/where/area, re-ordered by relevance while searching, split into three bands
and topics get deleted, so a list index would mean something different in every
view and would silently move under a topic somebody already referred to. The
number is assigned once, at insert, and never changes.

- **The backfill numbered the existing board by `created_at` ascending**, so #1
  is the oldest topic and the numbering reads like the board's own history.
- **Gaps are normal and are not a bug.** Sequences are non-transactional: a
  rolled-back insert, an insert an RLS policy rejected, or a deleted topic burns
  its number. Closing a gap would mean renumbering topics — exactly what the
  column exists to prevent.
- **Admin-only.** The number is not projected into `public.my_feedback`, so the
  author of a user-submitted topic never sees it. The benefit is internal, and
  that view is security-critical (see "User-submitted feedback"). Exposing it
  later would be an additive change there — keeping its `author_id = auth.uid()
  and source = 'user'` filter and its `revoke all … / grant select` pair intact.
- **A non-admin cannot pick their own number.** `seq` is defaulted, and defaults
  are applied *before* the insert policy's `WITH CHECK` runs, so the policy could
  not pin it. The existing BEFORE-INSERT guard
  `admin_feedback_normalize_user_insert()` — which already forces `triaged` and
  pins the timestamps of API inserts — assigns `seq` server-side for
  `source = 'user'` rows instead.
- **The routine may use it**: `#N` is an unambiguous, human-readable handle for a
  topic in a thread reply, a PR body or a Rückfrage.

### Searching the board (feedback 12476cec)

The stream's top bar carries the search field — always visible, docked,
maximized and full board alike. It is dependency-free and lives in
`searchFeedback` / `scoreFeedbackRow` in `feedback.types.ts`:

- **What is searched** — the topic body, its `processing_note`, the author names
  **and every `admin_feedback_messages` reply**. A topic whose only match sits
  three replies down is a hit and is marked "im Thread" in its row.
- **Its number is a lookup** — typing `42` or `#42` finds topic #42 (the `#` folds
  away in normalization). That one field is matched **exactly**: no prefix, no
  infix, no typo tolerance, because a reference number is a pointer, not a guess —
  `#4` is not `#42` and `#142` is not `#42`. Its field weight (`1.2`) sits above
  the body's, so #42 leads the list even when other topics mention the digits.
- **How it matches** — text is normalized (lowercase, diacritics stripped, `ß` →
  `ss`, markdown punctuation dropped), then each term is matched per word:
  exact › prefix › infix › Damerau-Levenshtein typo (1 edit from 4 characters,
  2 from 7) › subsequence. Every term has to match *somewhere* (AND), so adding a
  word always narrows.
- **How results are ranked** — mean term quality × field weight (body `1.0` ›
  note `0.55` › thread `0.5` › author `0.35`), a density bonus for repeated hits,
  a bonus when the query appears verbatim, and topic recency as the tiebreaker.
- **How it interacts with the rest** — a query flattens the three bands into
  one relevance-ordered "N Treffer" list (the filter sheet's Wer? / Wo steht
  es? / Bereich still apply); clearing it restores the bands.

One thing the routine should be aware of: **answering happens through the
normal thread insert** (`is_system=false`), i.e. exactly the resume condition
above — the lead card's inline box, the one-tap option buttons and the opened
topic's composer are just faster ways to produce those replies. Nothing the
panel does changes `status` except the two review-gate writes and the release.

A freshly `shipped` topic appearing between two polls triggers a short confetti
burst (`celebration.service.ts`, hand-rolled Web Animations API, no
dependency); the Geliefert band's "neu" marker is the durable version of that
news. The burst is suppressed under `prefers-reduced-motion: reduce`.
