# Appendix: the stale-claim reaper and in-flight claims

> Read when: the gate reported `reaped` / `skippedLive` / `bare_in_progress`, an
> item came back `open` with a stale-claim note, or a row sits `in_progress`
> without a `ship_ref`. Core contract: [`../feedback-routine.md`](../feedback-routine.md).

## Resuming interrupted work (stale-claim reaper)

The routine's queue is `status = 'open'` only. That means a run which claims
an item (sets `in_progress`) and is then **interrupted before reaching a
terminal state** — usage limit hit, PC powered off, Claude not running, a
crash — leaves the item stranded in `in_progress`. Nothing looks at
`in_progress` rows, so the work is **never resumed**. This was the gap behind
feedback item `253da974` ("die letzte Nachricht die in Arbeit ist wurde nicht
wieder aufgenommen").

The fix is a **reaper that runs first, every cycle** (STEP 1.5 in the task).
Because the reaper is part of the routine, the interruption naturally heals on
the next cron tick after the machine/Claude is back — no PC-independent
infrastructure required (that was declined 2026-07-07).

**Run the reaper FIRST — before the queue read, before any empty-stop.** The
task numbers the queue read as STEP 1 and the reaper as STEP 1.5, but the
reaper *executes first* every cycle. This ordering is load-bearing: the queue
read looks only at `open`/`needs_input` and never at `in_progress`, so a run
that reads the queue first, finds it empty, and takes the "No open feedback →
stop" exit strands every `in_progress` item **without ever reaping it**. That
is precisely the `b5e070df` failure — the item sat `in_progress` for hours
while later runs kept stopping at the empty-queue check.

**No recency cap — resume back to the last successful ship, not just recent
runs.** The reaper's only age gate is the 30-minute *lower* bound; there is
deliberately **no upper bound**. One sweep reopens *every* stranded
`in_progress` row regardless of how many cadence cycles ago it stranded, so the
first run after a multi-hour downtime gap (PC off / usage-limit / Claude not
running) catches all of them at once — not merely the last few runs.

It reopens only **orphaned** claims and never disturbs intentional holds:

```sql
update public.admin_feedback
set status = 'open',
    processing_note = 'auto-reopened: in_progress claim went stale (interrupted run) — resuming',
    processed_at = now()
where status = 'in_progress'
  and ship_ref is null                             -- no PR was ever opened → incomplete, not a review hold
  and processed_at < now() - interval '30 minutes' -- older than ~1.5 cadence cycles → not a run in flight
returning id;
```

Why the two guards:

- **`ship_ref IS NULL`** distinguishes an *interrupted* claim from an
  *intentional manual-review hold*. A held item (red build, or a
  sensitive/broad change — e.g. PR #108) always carries a `ship_ref` (its PR)
  and a `processing_note`; a human owns it, so the reaper must leave it alone.
  An orphaned claim never got as far as opening a PR, so `ship_ref` is null.
- **`processed_at < now() - interval '30 minutes'`** protects a *currently
  overlapping run* that legitimately claimed the item and is still
  implementing/building. The gate script uses 60 minutes AND a liveness
  check on the item's worktree (see [`gate.md`](gate.md)), because a bare timer reopened
  live claims — memory `feedback-reaper-reopens-live-claims`.

### The 30-minute window is too short — and the collateral damage is silent

The guard above assumes 30 min exceeds a real item. It does not always: a codex
item (`2c88a788`) needed ~40 min of worker time on 2026-07-26, so an
**overlapping run's reaper reset it to `open` while the work was still in flight
and already merging**. This is not merely "wasted effort" — it corrupts the
owning run's bookkeeping, silently:

- The owner's terminal update is written `... set status='shipped' ... where
  id=<id> and status='in_progress'`. Once a foreign reaper flipped the row to
  `open`, that UPDATE matches **zero rows and reports no error**. The PR merges,
  `main` moves, and the DB still shows unshipped work — so the next run
  re-implements something that already landed. Two further rows in that run
  (`8acd4198`, `f7d3bd9a`) were hit the same way.
- The mirror image happened 90 minutes later: *this* routine's reaper reopened
  three claims of a live run (`5e9032cf`, `52a5ef4c`, `5920cf8c`) that had been
  working them for >30 min without re-stamping `processed_at`.

**Two rules follow, and both are mandatory.**

1. **Never trust a status-guarded UPDATE to have happened — always `returning`,
   always check exactly one row came back.** On zero rows, re-read the row and
   reconcile against *reality*, not against the status you assumed: a merged PR
   always wins, so mark it `shipped` guarded on `status <> 'shipped'` instead.
   Re-read the queue right before writing the STEP 5 report, because a parallel
   run may have shipped or parked items you thought you owned.
2. **Before implementing any reaped item, check whether its work is still hot.**
   `git log -1 --format=%ci origin/feat/feedback-<short-id>`, `gh pr list --limit 5
   --json updatedAt`, and file mtimes in `scfb-<short-id>`. Activity in the last
   few minutes ⇒ a **live owner**: leave the row `in_progress` with a *fresh*
   `processed_at` — that re-stamp protects the owner for another 30 min and keeps
   its `where status='in_progress'` ship-update valid — set a truthful
   `processing_note`, and pick a different item instead.

### Answered-but-stranded resumes are covered by the same guard

A `needs_input` topic the admin has answered is normally resumed by the
per-topic query: a run picks it up, claims it `in_progress`
(`... where status='needs_input'`), and acts on the answer. If that run **dies
mid-resume**, the item is left `in_progress` with `ship_ref` still null —
invisible to the needs_input-resume query (it is no longer `needs_input`) yet
caught by this reaper (`ship_ref IS NULL`). On the redo it re-enters as `open`;
the per-item procedure reads the **full thread** and acts on the admin's
already-posted answer. **Do not re-ask a question the admin already answered** —
resume from the answer. `b5e070df` is the canonical case: the admin posted
"unsigned v1 ok, lets go", a run claimed the resume and died, and the item
stranded until a reaper-first run reopened it.

Reaped items are logged in the run report and then flow through the normal
per-item procedure below in the same run.

**Usage-limit aborts are the common case — and resumption is delayed, not
instant.** When a run hits the Claude usage limit mid-item, the process just
stops: the item stays `in_progress` and the *next* routine run does **not**
continue it right away. Two things follow from the reaper's guards:

- The **`processed_at` guard means a gap.** A tick inside the window skips the
  stranded item; only a later tick reopens it. So an item aborted by the usage
  limit can visibly sit `in_progress` for one or two ticks before it is picked
  up again. That delay is intended
  (it protects a legitimately overlapping in-flight run) — it is not a bug, but
  it does mean "stuck for half an hour" is expected, not lost.
- **Resumption re-enters at the item level — but it is *not* automatically a
  from-scratch rebuild.** The reaper reopens the row to `open` and the next run
  re-enters the per-item procedure; what it must *not* do is assume the previous
  attempt left nothing behind. See the next section.

### A reaped item usually still has recoverable work

The reaper reasons only about DB state (`ship_ref IS NULL`), which cannot see a
pushed branch, a CI verdict, or a dirty worktree — since 0.85.12 workers also
push a `wip:` commit right after their first edit and before every long build,
so an app quit loses minutes, not the item — and every run works in a
**per-item worktree that survives the interruption**. Treating a reaped item as a
blank redo therefore throws away real, often already-certified work:

- **`52a5ef4c` (Starscape self-update), 2026-07-26:** `feat/feedback-52a5ef4c`
  was already pushed with 3 commits and a **green `wallpaper-app` CI run** — the
  killed run died between "CI green" and `gh pr create`. A rebuild would have
  discarded a ~2200-line Rust/web change plus the CI cycle that certified it.
- **`5920cf8c` (public feedback FAB), same run:** no branch pushed, but
  `scfb-5920cf8c` still held the entire in-flight change **uncommitted** (a new
  `src/app/feedback/`, the FAB component, an RLS migration).

**How to apply — inspect before rebuilding.** On every reaped item, in addition
to the STEP 3a PR/branch idempotency check:

```bash
git worktree list | grep scfb-<short-id>     # a per-item worktree left behind?
git -C <that worktree> status                # uncommitted work in it?
git ls-remote --heads origin feat/feedback-<short-id>
gh run list --branch feat/feedback-<short-id>   # already-green CI?
```

Resume from whatever exists — commit the dirty tree first, then rebase onto
`origin/main`. Only delete-and-rebuild when the leftover work is genuinely wrong.

### The one abort window the `ship_ref IS NULL` guard can't see — and how the redo stays idempotent

`ship_ref` is only ever written to the DB in the **final** ship UPDATE (green
merge, or red/sensitive hold). So an abort *before* that UPDATE always leaves
`ship_ref = NULL` in the DB — which is exactly what makes the reaper's guard
correct for distinguishing an interrupted claim from an intentional hold.

But there is a narrow window the DB state alone cannot describe: an abort
**after `gh pr create` (or even `gh pr merge`) but before the ship UPDATE runs**.
The DB still shows `ship_ref = NULL`, so the reaper correctly reopens the item —
yet a PR (possibly already merged into `main`) now exists on GitHub that the DB
knows nothing about. A naive full redo would then rebuild work that already
landed and open a **duplicate PR** (or attempt a double-merge).

This is closed by an **idempotency check at the start of implementation**
(per-item procedure step 3): because the branch name `feat/feedback-<id-short>`
is deterministic, the run first looks for an existing branch/PR for this item
and *reconciles* it instead of rebuilding:

- **merged PR exists** → work already in `main`; skip the rebuild, just mark the
  row `shipped` (using the PR's `mergedAt` / url).
- **open PR exists** → resume from that branch (re-verify → merge or hold); never
  open a second PR.
- **stale branch, no PR** → delete the branch, then rebuild fresh.
- **nothing exists** → normal fresh branch off `main`.

So the redo is safe even in the post-PR abort window: at worst it re-runs verify
on an already-correct branch, never double-ships.

Bottom line: a usage-limit abort is self-healing on a later cron tick once
Claude is back under limit — just not on the immediately following run, and not
by picking up where it left off.

## In-flight claims inside the 30-minute window — report the work, don't assume liveness

The reaper's `processed_at < now() - interval '30 minutes'` guard protects a run
that is legitimately still working. But it is a **timer, not a liveness check**:
at minute 29 an item that is being actively implemented and an item whose owner
died 29 minutes ago are *indistinguishable in the database*. Reporting such a row
as "another run has it, no action needed" states something the routine has not
verified — and if the owner is in fact dead, the finished work sits invisible
until a later tick.

That is exactly what happened on 2026-07-26 with `02a0570b` and `21587480`. Both
were claimed at 21:34 by a run that then died. At 22:03 the queue read found them
29 minutes old, the reaper correctly skipped them, and the run reported them as
in-flight. What the report did **not** say — because it never looked — was that
both already carried finished work on disk:

- `02a0570b`: a worktree with two commits **plus ~1000 uncommitted lines** of the
  hardpoint-map UI, one crash away from being lost.
- `21587480`: an **open PR (#282)** with all CI checks green, needing only a
  rebase and a merge.

The admin saw "2 in Arbeit" in the panel and had to ask. Nothing was lost, but a
whole cadence cycle was, and the routine's own report was the reason it looked
like there was nothing to do.

**The rule: an in-flight claim is a report item, not a silent skip.** The DB
cannot tell you whether the owner lives, but the filesystem and GitHub can — and
both are cheap to ask, with no writes and no interference with a genuinely
running owner:

```sh
git worktree list                                   # is there a scfb-<short-id> tree, and is it dirty?
gh pr list --state all --head feat/feedback-<short-id> --json number,state,url
```

For every `in_progress` row with `ship_ref IS NULL` that the reaper skipped
because it is younger than 30 minutes, name in the STEP 5 report:

- its age (so "29 min" reads as "about to be reaped", not "just started"),
- whether a branch/PR exists — **an open PR with green checks means the item is
  finished and waiting on a merge**, not "in progress",
- whether a worktree holds uncommitted work (that is unpersisted work, the only
  state a crash actually destroys).

Do **not** claim or touch such a row — the 30-minute guard stays, and taking an
item from a live owner is the failure it exists to prevent. Reporting is the
whole intervention. The next tick then reaps and resumes it with the
`feedback-reaped-items-keep-worktree-work` procedure (check for a pushed branch
and a dirty worktree before rebuilding from scratch).

**Never write "no action needed" about a row you did not inspect.** If the
routine has not looked at the worktree and the PR list, the honest phrasing is
"claimed 29 min ago by another run, work state not inspected" — which invites the
next tick to check, instead of closing the question.

## Surfacing open review-holds (the reaper's mirror image) — see [`holds.md`](holds.md)

A sensitive/red item the routine parks for the admin lives as `in_progress`
**with** a `ship_ref` (its PR) — and after that, **nothing ever looks at it
again**: the reaper skips it by design (`ship_ref IS NOT NULL` — it is an
intentional hold, not an orphaned claim) and the `needs_input`-resume query
never sees it (it is `in_progress`, not `needs_input`).
