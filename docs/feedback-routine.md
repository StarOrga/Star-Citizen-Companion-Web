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
  │                  └──not shippable yet (noise OR needs a decision)──▶ needs_input
  │                        (routine posts a SYSTEM reply explaining why)
  │                                    │
  └──reaper: orphaned claim (no PR) ───┤
                                       ▼
        admin answers in the thread ──▶ picked up again next run

  rejected  ← the ADMIN decides this alone (by deleting the topic); the
              routine NEVER sets it.
```

**The routine never rejects — the admin alone decides what to discard.** Every
item the routine cannot ship right now goes to `needs_input` with a system
reply explaining why (whether it's a product/auth/RLS/privacy decision, a
choice between options, a clarification, or even apparent noise it is unsure
about). The admin then either steers it in the thread — and the routine resumes
— or **deletes the topic** if he wants it gone. There is no routine-side
`rejected`: a hard reject once ended the conversation and left the admin no way
to steer the routine (the gap behind the per-topic chat,
`admin_feedback_messages`), and it took the reject/keep call away from the admin
who owns the board. `rejected` survives only as a legacy status on old rows;
the routine leaves those untouched.

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
2. **Understand.** Read `body` (markdown) **and the topic's thread** (all
   `admin_feedback_messages` for this id, oldest first — the admin may have
   already answered a prior question). Then classify:
   - **Not shippable right now** — either apparent noise (spam, duplicate,
     empty/garbled) *or* it needs a human decision / clarification (product
     call, auth/RLS/privacy, a choice between options, or the body literally
     asks "create an issue / discuss") → **never reject.** Post a SYSTEM reply
     explaining why (the question, the options, or — for suspected noise — "this
     looks like a duplicate/spam; delete it if you agree"), set
     `status='needs_input'`, `processed_at=now()`; continue. Discarding is the
     admin's call, made by deleting the topic — not the routine's.
   - **Actionable now** → implement (step 3).
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

## Per-topic chat: `needs_input` + system replies

Each topic (`admin_feedback` row) carries a thread in
`public.admin_feedback_messages`. Humans post via RLS (`is_system=false`,
`author_id=self`); the routine posts **system** replies as `service_role`
(`is_system=true`, `author_id=null`) — service_role bypasses RLS.

**Parking an item for a decision** (instead of `rejected`):

```sql
-- 1) ask the question in the thread
insert into public.admin_feedback_messages (feedback_id, is_system, body)
values ('<id>', true, '<the question / rationale / options, markdown>');
-- 2) park the topic
update public.admin_feedback
set status = 'needs_input', processing_note = '<one-line why parked>', processed_at = now()
where id = '<id>';
```

Keep the system reply concrete: state what's blocking, list the options or the
exact decision needed, and (when relevant) link the GitHub issue you opened for
the deeper discussion.

**Resuming a `needs_input` topic.** Each run, after the `open` queue, also pick
up `needs_input` topics whose **latest thread message is human** (the admin
answered — `is_system=false` and newer than the last system reply):

```sql
select f.id
from public.admin_feedback f
join lateral (
  select is_system
  from public.admin_feedback_messages m
  where m.feedback_id = f.id
  order by m.created_at desc
  limit 1
) last on true
where f.status = 'needs_input' and last.is_system = false;
```

For each, read the full thread, then act on the admin's answer: implement (→
ship, `status='shipped'`), ask a follow-up (post another system reply, stay
`needs_input`), or — only if the admin explicitly agrees it's out of scope —
`rejected`. The stale-claim reaper never touches `needs_input` (it filters on
`status='in_progress'`), so a parked topic waits patiently for the answer.

## Guardrails

- **PR + auto-merge only** — the merge is gated on green build+tests. No direct
  pushes to `main`, no force-push.
- **The routine never sets `rejected`.** Discarding a topic is the admin's call
  alone, exercised by deleting it from the board. Anything the routine cannot
  ship goes to `needs_input` with a system reply; the admin keeps steering or
  deletes.
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
| `status`         | `open` \| `in_progress` \| `shipped` \| `needs_input` (routine-driven) · `rejected` = legacy/admin-only, never set by the routine |
| `ship_ref`       | PR/commit URL the routine attached                         |
| `processing_note`| routine's note (reject reason / red-build hint)            |
| `shipped_at`     | set when merged to `main`                                  |
| `processed_at`   | last time the routine acted on the row                     |

Per-topic replies live in `public.admin_feedback_messages` (see migration
`20260710160000_admin_feedback_threads.sql`):

| column        | meaning                                                       |
|---------------|--------------------------------------------------------------|
| `feedback_id` | FK → `admin_feedback.id` (cascade delete)                    |
| `author_id`   | FK → `profiles.id`; `null` for system/routine replies        |
| `is_system`   | `true` = written by the routine (service_role), not a human   |
| `body`        | markdown reply                                               |
| `created_at`  | thread order                                                 |

The routine authenticates as `service_role` and therefore bypasses RLS (so it
can insert `is_system=true` replies, which the RLS insert policy forbids for
regular admins).
