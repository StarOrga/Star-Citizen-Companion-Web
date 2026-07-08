# Admin-Feedback Routine (local scheduled task, every 20 min)

Autonomous routine that turns the admins-only feedback board
(`public.admin_feedback`) into shipped changes. Runs as a **local Claude
scheduled task** (`nightly-admin-feedback`, cron `*/20 * * * *`) — it fires
only while Claude is running on the dev machine, **not** a PC-independent
cloud agent. A true event-driven / PC-independent build would require a
claude.ai Cloud environment + Supabase INSERT webhook; considered and
declined 2026-07-07 (see `sc-admin-feedback-routine` memory).

## Contract

Source of work: rows in `public.admin_feedback` with `status = 'open'`,
oldest `created_at` first.

Status lifecycle the routine drives:

```
open ──pick up──▶ in_progress ──green build+tests──▶ shipped
  ▲                             └──red / needs review──▶ (stays in_progress, PR opened)
  │                  └──not actionable──▶ rejected (with processing_note)
  └──reaper: orphaned claim (no PR) went stale──────────┘
```

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
  implementing/building — 30 min comfortably exceeds a normal single-item
  cycle while the ~20-min cadence keeps resumption prompt. Worst case if a
  genuine build outruns 30 min: the item is reopened and re-done on a fresh
  branch+PR — wasted effort, never data corruption (the atomic claim still
  prevents two runs acting on it at the same instant, and each item ships via
  its own independent PR).

Reaped items are logged in the run report and then flow through the normal
per-item procedure below in the same run.

## Per-item procedure

For each `open` row (process independently, most-recent context wins):

1. **Claim it (atomically).** `update admin_feedback set status='in_progress',
   processed_at=now() where id=<id> and status='open'`. If **zero** rows were
   updated, a concurrent run already claimed it — skip the item and move on.
   This atomic claim is the single-flight lock that makes overlapping ~20-min
   runs safe; never process an item you did not successfully claim.
2. **Understand.** Read `body` (markdown). If it is not an actionable code
   change (vague, a question, out of scope), set `status='rejected'`,
   `processing_note='<short why>'`, `processed_at=now()` and continue.
3. **Implement** on a fresh branch `feat/feedback-<id-short>` off `main`.
   Follow repo conventions (CLAUDE.md): standalone components, signals,
   OnPush, ngx-translate for all strings, no keys in the bundle.
4. **Verify (the safety net).** Run in order — all must pass:
   - `npm run typecheck`
   - `npm run build`
   - `npm test`
5. **Ship decision:**
   - **All green** → open a PR and auto-merge it to `main` (never force-push).
     On merge: `update admin_feedback set status='shipped', shipped_at=now(),
     ship_ref='<PR url>', processed_at=now(), processing_note=null where id=<id>`.
   - **Any red / non-trivial risk** → open a PR for manual review, leave
     `status='in_progress'`, set `ship_ref='<PR url>'` and
     `processing_note='build/tests red — needs manual review'`.
6. Never touch rows already `shipped` or `rejected`.

## Guardrails

- **PR + auto-merge only** — the merge is gated on green build+tests. No direct
  pushes to `main`, no force-push.
- One branch + PR per feedback item, so each ships/reverts independently.
- If an item would touch auth, RLS, secrets, or payment paths → do **not**
  auto-ship; open a PR and leave `in_progress` for human review.
- Batch cap: if more than ~10 open items exist, process the oldest 10 and leave
  the rest `open` for the next run.
- **Overlapping runs are expected** — the task fires every ~20 min, and a run
  that processes several items can outlast that interval. The atomic claim in
  step 1 is the *only* concurrency guard; there is no external lock.

## Data model reference

`public.admin_feedback` (see migration `20260707190000_admin_feedback.sql`):

| column           | meaning                                                    |
|------------------|------------------------------------------------------------|
| `status`         | `open` \| `in_progress` \| `shipped` \| `rejected`         |
| `ship_ref`       | PR/commit URL the routine attached                         |
| `processing_note`| routine's note (reject reason / red-build hint)            |
| `shipped_at`     | set when merged to `main`                                  |
| `processed_at`   | last time the routine acted on the row                     |

The routine authenticates as `service_role` and therefore bypasses RLS.
