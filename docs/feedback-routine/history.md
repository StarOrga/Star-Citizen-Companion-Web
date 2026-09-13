# Appendix: history — why the rules are the way they are

> Read when: someone asks "why is this rule here?", or a rule looks wrong and you need the failure it was written against. Every rule below lives normatively in the core or in an appendix — this file is the narrative, never the contract. Core: [`../feedback-routine.md`](../feedback-routine.md).

## Index

| Date | What happened | The rule it produced | Rule now lives in |
|---|---|---|---|
| 2026-07-07 | An event-driven, PC-independent cloud build was designed and dropped (claude.ai Cloud + Supabase webhook). | The routine is a local scheduled task; when the PC is dark it simply does not fire, and the heartbeat is what says so. | core (intro) · `gate.md` |
| 2026-07-14 | PR #167 (`10cd9fd7`) was parked green + `MERGEABLE` as "sensitive (auth flow)" and nobody mentioned it again for a day, until the admin asked. | List open review-holds every cycle and report them; an empty `open` queue is not "nothing to do". | `holds.md` |
| 2026-07-23 | Several open items redesigned the same component in parallel and produced contradictory PRs. | Same-area items serialise: ship the oldest, leave the rest `open` for the next run. | core, "Concurrency" |
| 2026-07-23 | `a5783bed` (a wallpaper-app change) sat bare `in_progress` with "npm-gate cannot verify" and starved three trivial web items for >22 h. | Never leave a bare `in_progress`; park it `needs_input`. Native areas have their own verify path and are shipped like everything else. | `needs-input.md` · core, Scope |
| 2026-07-24 | One run's RSI-upcoming edits landed on another run's docs branch — two runs sharing the primary checkout. | Every unit of work runs in its own isolated worktree; workers commit+push before returning. | core, "Concurrency" |
| 2026-07-24 | The devops edit hook blocked three edits as "editing main" because the shell was still parked in the primary checkout. | `cd` into the worktree before the first Edit/Write of a thread. | core, "Concurrency" |
| 2026-07-26 | Three migrations minted the same `20260726120000` prefix across main and two PRs; `db push` would have silently skipped two of them. | Check the prefix against `origin/main` before every merge and rename on collision; read which files the push names. | core, STEP 4 (narrative below) |
| 2026-07-26 | A parallel *issue* runner shipped item `5e9032cf`'s scope twice (PR #265, #273); PR #274 came back CONFLICTING. | Before claiming an item that maps to an issue, check the issue and its sub-issues for open/merged PRs. | core, "Concurrency" (narrative below) |
| 2026-07-26 | An overlapping run's 30-minute reaper reset `2c88a788` (and two more rows) to `open` while the work was merging — the owner's status-guarded UPDATE then matched zero rows, silently. | Always `returning`; reconcile against reality. The gate's reaper uses 60 min **plus** a worktree liveness check. | `reaper.md` · core, STEP 2 |
| 2026-07-26 | Reaped items `52a5ef4c` (pushed branch, green CI) and `5920cf8c` (uncommitted worktree) were nearly rebuilt from scratch. | Inspect worktree, branch, PR and CI before rebuilding a reaped item. | `reaper.md` |
| 2026-07-26 | `02a0570b` + `21587480` were reported as "another run has it, no action needed" — one held ~1000 uncommitted lines, the other an open green PR (#282). A whole cadence cycle was lost. | An in-flight claim is a report item, not a silent skip; never write "no action needed" about a row you did not inspect. | `reaper.md` |
| 2026-07-27 | 14 commits of Codex-Showroom work sat unpushed while the run reported "No open feedback." | Run the loose-ends sweep every cycle and report what it finds — report-only. | `sweep.md` |
| 2026-07-30 | `b5e070df` stranded `in_progress` for hours because every later run read the queue first and took the empty-queue exit. | The reaper executes first, before the queue read and before any empty-stop; no upper age bound. | `reaper.md` |
| 2026-08-02 | Hold PR #314 (`40d2f925`) stood 2.6 days; two newer migrations made its own migration out of order, and the admin's steering reply from day one had been invisible to all four queue reads. | Verify a hold's mergeability, base distance and migration order every cycle; query (e) makes an answered hold actionable. | `holds.md` |
| 2026-09-01 | A 22-item evening drained over two days because every run stopped after one wave. | A run drains wave by wave until the queue is empty or a brake trips. | core, STEP 5 · `gate.md` |
| 2026-09-05/06 | Twice in one night (`ae9f8cba` / PR #534, `a33ba528` / PR #531) the ✅ "live ansehen" reply went out ~1 min after the merge; the deployment was 9.5 min later, or missing entirely. | The review reply is posted only after the deployment for the merge SHA is observed green — via `npm run verify:ship-live`, never by hand. | `continuation.md` · core, STEP 4 |
| 2026-09-06 | A run died at 98 % usage mid-verification after merging three PRs; no review reply was ever posted. | The `shipped` UPDATE sets `review_reply_pending`; query (f) is read first thing in every working run. | `continuation.md` · core, STEP 1 |
| 2026-09-13 | An idle tick cost a full runbook read. | STEP 0 is one script call; an idle tick reports one line and never reads the runbook. | `gate.md` · core, STEP 0 |

## 2026-07-30 → 2026-09-06 · The review gate and the panel's controls

What happened: the board grew a human sign-off step, then lost the Abnahme tab, then the Abarbeiten run, then the "Gespräch wieder aufnehmen" button — four rounds of admin feedback (#79, d4990269, concept 2026-09-04, 187574ed). The routine survived all four without a change, which is the point worth remembering.

**Rule produced:** the routine never reads or writes `reviewed_at`; a reply into a finished topic is the reopen (reply-then-reopen), and a reply into a topic still in the loop must not reset a running claim. **Lives in:** the core, "Contract".

> **The review gate (`reviewed_at`, migration 20260729130000) is invisible to the
> routine — deliberately.** Shipping no longer archives a topic: the board keeps
> a `shipped` / `issue_created` row on the ACTIVE side until an admin signs it
> off (`reviewed_at`), and "Gespräch wieder aufnehmen" sets `status = 'open'` and
> `reviewed_at = null`, which is an ordinary queue item again. The routine
> therefore needs no change: it never reads or writes `reviewed_at`, and every
> query below stays exactly as it is. The gate is a second, human way into the
> continuation loop that query (d) already implements — pressing a button instead
> of having to remember to reply.
>
> Since feedback #79 the gate has its own step on the board, and since feedback
> d4990269 that step lives **inside the Abarbeiten run**: every row the gate holds
> is walked one at a time, with the same two decisions the in-card gate has — "Ins
> Archiv — erledigt" (`reviewed_at`) and "Gespräch wieder aufnehmen"
> (`status = 'open'`). Still no new status value, still nothing the routine reads.
>
> The **Abnahme tab is gone** (feedback d4990269, round 2). It was a second
> surface for exactly the rows the run already walks; what replaced it is a **kind
> filter** in the run — Alle / Rückfragen / Abnahmen, each with its count — so
> "just the sign-offs" is a chip rather than a view. A remembered `review` view
> opens the run on that chip, and the in-card gate in the Übersicht is untouched.
>
> **Since concept 2026-09-04 the run is gone.** The sign-off is a card in the
> panel's "Du bist dran" band (first card pre-opened with ✓ / ↻ inline) and a
> ✓ in the Geliefert feed row — see [`admin-panel.md`](admin-panel.md). The
> contract stays: `reviewed_at` or `status = 'open'`, nothing new to read.
>
> **"Gespräch wieder aufnehmen" is gone as a button — the reply IS the reopen**
> (admin feedback 187574ed). It used to open the same answer box every thread
> has, one click away from the box already sitting at the bottom of the topic. So
> the opened topic has no reopen control any more: sending a reply into a topic
> that is *finished* — archived, or waiting for its sign-off — posts the steer
> *and* sets `status = 'open'`. Unchanged: a reopened topic reaches the routine
> with the reason already in the thread, which is what the continuation path
> (query (d) / the `shipped_at` + newer-human-message rule) reads anyway, and the
> write order is still **reply-then-reopen** — a failed reply reopens nothing, a
> failed reopen has at least kept the admin's words. A topic that is still in the
> loop (`open` / `in_progress` / `needs_input`) gets the reply only: a plain
> answer must never reset a running claim.
>
> The panel's own row of controls follows from that. In the opened topic the only
> two moves are on the composer's line: **Abgenommen** left of the send button,
> and the send button itself (labelled with the key that triggers it). No review
> box, no "In App ansehen" — the card the admin came from carries that link.

## 2026-07-26 · Three migrations, one version prefix

### Migration version collisions are silent — check the prefix before every merge

Supabase's migration ledger keys on the **version prefix**, not the filename. Two
files sharing `20260726120000` are the *same* migration to `db push`: the first
applies, and every later one is treated as already applied and **silently skipped
while the push reports success**.

Parallel autonomous runs produce this by construction — each rounds "now" to the
same timestamp. On 2026-07-26 three files carried `20260726120000`
(`…_codex_fps_equipment.sql`, `…_starscape_channels.sql`,
`…_user_feedback_channel.sql`) across `main` and two open PRs. The codex one
merged first; without renaming, the Starscape channel tables and the entire
public-feedback RLS set would never have run — and nothing would have reported an
error. They were moved to `…160000` / `…170000` before merging.

**Rule now lives in:** the core, "Migration version prefixes collide silently", and [`holds.md`](holds.md) (migration order on a decayed hold).

### The atomic claim does not guard against a parallel *issue* runner

`admin_feedback`'s claim only serialises **runs that read that table**. A
parallel run working GitHub *issues* — branches like `feat/codex-fps-frontend`,
PR titles referencing `(#251)` — never touches `admin_feedback`, so it can ship
the exact scope a feedback item is claimed for, and the claim-holder finds out
only when its PR comes back `CONFLICTING`.

Observed 2026-07-26 on item `5e9032cf` (FPS-equipment codex), twice inside one
run: **PR #265** merged issue #251 mid-flight, the worker was re-scoped onto the
deferred #253 — and while it did that, **PR #273** merged #253 as well, so PR
#274 opened `DIRTY / CONFLICTING`. `origin/main` moved seven times inside that
single routine cycle.

**How to apply:** before claiming a feedback item that maps to a GitHub issue
(the `processing_note` often names one, e.g. "issue #187 created"), check that
issue **and its sub-issues** for open/merged PRs — `gh issue view <n>`,
`gh pr list --search "<n> in:title" --state all` — not just the deterministic
`feat/feedback-<short-id>` branch that STEP 3a's idempotency check already
covers. Re-check `origin/main` immediately before the serial merge; on a
conflict, reconcile *toward what already shipped* and keep only the unique
delta rather than forcing the merge through.


**Rule now lives in:** the core, "Concurrency" (check the issue and its sub-issues before claiming an item that maps to one).

## 2026-07-26 → 2026-09-06 · "Issue erstellen": from record to order

This replaces the old motion, where "Issue erstellt" was a *record*: the admin
filed the issue by hand and the same click archived the topic. The panel's
by-hand record ("Issue-Link eintragen") is gone as well (admin feedback
18e96ad3, round 2) — the order in the thread is the only issue motion left, and
the routine is the only writer of `issue_created` + `ship_ref`.

**Rule now lives in:** the core, "Issue erstellen" + "Data model reference".
