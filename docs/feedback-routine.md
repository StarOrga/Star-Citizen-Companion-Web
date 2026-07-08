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
                                └──red / needs review──▶ (stays in_progress, PR opened)
                     └──not actionable──▶ rejected (with processing_note)
```

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
