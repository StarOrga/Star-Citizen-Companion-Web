# Admin-Feedback Routine (local scheduled task, gated every 20 min)

Autonomous routine that turns the admins-only feedback board
(`public.admin_feedback`) into shipped changes. Runs as a **local Claude
scheduled task** (`nightly-admin-feedback`, cron `0,20,40 * * * *` — but the
**working cadence is a table in `scripts/routine-gate.mjs`**: every 20 min in
the evening, hourly by day, every two hours at night; a tick outside its
window only stamps the heartbeat, see [`gate.md`](feedback-routine/gate.md)) — it fires
only while Claude is running on the dev machine, **not** a PC-independent
cloud agent. A true event-driven / PC-independent build would require a
claude.ai Cloud environment + Supabase INSERT webhook; considered and
declined 2026-07-07 (see `sc-admin-feedback-routine` memory).

This file is the contract of ONE run, top to bottom. Everything situational
lives in `docs/feedback-routine/` — the map says which file answers which
situation.

## Appendix map — which situation, which file

| Situation | File |
|---|---|
| Tick start/end, cadence, heartbeat + panel states, drain loop, usage brake, run lock | [`feedback-routine/gate.md`](feedback-routine/gate.md) |
| The gate reported `reaped` / `skippedLive` / a bare `in_progress`; resuming interrupted work | [`feedback-routine/reaper.md`](feedback-routine/reaper.md) |
| Queue read **(c)** returned open review-holds, or **(e)** an answered hold | [`feedback-routine/holds.md`](feedback-routine/holds.md) |
| An item just shipped, **(f)** owes a review reply, or **(d)**/**(e)** handed you a continuation | [`feedback-routine/continuation.md`](feedback-routine/continuation.md) |
| An item has to be parked, or **(b)** returned an answered `needs_input` topic | [`feedback-routine/needs-input.md`](feedback-routine/needs-input.md) |
| Any topic with `source = 'user'` — untriaged, author questions, attachments, declining | [`feedback-routine/user-feedback.md`](feedback-routine/user-feedback.md) |
| End of a working run: loose ends no query sees | [`feedback-routine/sweep.md`](feedback-routine/sweep.md) |
| The admin asks about the board UI (stream, Fortschritt, `#42`, search) | [`feedback-routine/admin-panel.md`](feedback-routine/admin-panel.md) |
| "Why is this rule here?" — the incident behind a rule | [`feedback-routine/history.md`](feedback-routine/history.md) |

## STEP 0 — the gate: one script call before anything else

**The first action of every tick**, from the repo root of the PRIMARY checkout:

```bash
node scripts/routine-gate.mjs check
```

Without a model it checks the run lock, the cadence window, the reaper (with a
worktree liveness check) and the counts (a)–(f), stamps the heartbeat, and
prints one JSON line. Cadence table, heartbeat semantics and what the admin sees:
[`gate.md`](feedback-routine/gate.md).

| verdict | what the tick does |
|---|---|
| `running` | another tick still works — heartbeat stamped, stop |
| `skip-cadence` | outside the working window — heartbeat stamped, stop |
| `idle` | nothing actionable — report one line, stop |
| `work` | take the run lock (`start-run --note work:<n>`; `acquired:false` → stand down), read this file, continue with STEP 1 |
| `error` | fail open: fall back to the manual path (heartbeat via MCP, reaper SQL, the six queue reads); the note `gate-error` tells the admin why the panel may lag |

An idle tick reports one line and stops **without reading this runbook**. Every
working run ends with `end-run` (STEP 6). Pass the Supabase CLI PAT via the
environment, never on a command line that ends up in a transcript.

**If the Supabase MCP is not authorised in the run's session**, every SQL of
STEPS 1–6 goes through the same script instead:
`node scripts/routine-gate.mjs sql --file <statement.sql>` (write the statement
to a temp file first; `--query` only for one-liners). It uses the gate's PAT and
prints the rows as JSON — same service-role power as the MCP, so the privacy
rule and the "never `rejected`" rule apply unchanged. Do not park an item or
skip a wave because the MCP is missing.

## Contract

Source of work: rows in `public.admin_feedback` with `status = 'open'`,
oldest `created_at` first.

> **The review gate (`reviewed_at`) is invisible to the routine — deliberately.**
> Shipping does not archive a topic; an admin signs it off, and a reply into a
> *finished* topic is itself the reopen (write order: reply, then reopen). A
> topic still in the loop (`open` / `in_progress` / `needs_input`) gets the reply
> only — a plain answer never resets a running claim. Four rounds of board
> redesign have not changed a line of this contract; the story is in
> [`history.md`](feedback-routine/history.md).

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

  in_progress + ship_ref (review-hold)
          ──admin replies in the thread (query (e))──▶ claimed back (ship_ref cleared),
                                                       steer implemented on the SAME PR branch

  shipped ──admin replies in the thread (query (d))──▶ reopened as a continuation
     ▲                                                          │
     │                                                          ▼
     └── re-ship + fresh review reply ◀── in_progress (new -<msg> branch, STEP 3–4)

  issue_created / declined / rejected ──admin replies in the thread──▶ open
     ▲                                    (DB trigger reopens directly to `open`,
     │                                     clearing ship_ref + decision_note)
     └── (terminal at rest until an admin replies)

  rejected      ← legacy; the ADMIN alone discards a topic, by deleting it.
  issue_created ← set ONLY by the ROUTINE, on an open **[ISSUE]** order in the
                  thread (ship_ref = issue url); goes through the sign-off gate.
  declined      ← the ADMIN declines a USER topic ("nicht umsetzen & löschen",
                  decision_note = the explanation the author reads).
  needs_input_author
                ← the ADMIN asked the topic's AUTHOR something; parked out of the
                  queue until the author answers (DB trigger flips it to `open`).
  All four: the routine NEVER sets them, and an admin reply reopens them.
```

All four terminal statuses reopen on a **human** admin reply (`is_system=false`;
the routine's own replies never reopen anything): `shipped` stays `shipped` on
the wire and query (d) claims it as a continuation (`shipped_at` must survive
for re-ship detection — `feedback-routine/continuation.md`); `issue_created` /
`declined` / legacy `rejected` are flipped straight to `open` by the DB trigger
(migration `20260726180000`), clearing `ship_ref` + `decision_note`, and query
(a) picks them up like any first-timer. The routine works the active half
(`open` / `in_progress` / `needs_input`) plus those continuations;
`needs_input_author` is active but belongs to the admin and the author.

### "Issue erstellen" — an order in the thread, not a status

An admin can decide a topic should become a **GitHub issue instead of a
change**. That decision is an *instruction to this routine*, so it rides in the
topic's thread: the board's "Issue erstellen" button posts an ordinary
(`is_system = false`) reply whose body starts with the literal, never-translated
token

```
**[ISSUE]**
```

and leaves the row exactly as it was — normally `status = 'open'`, in its place
in the oldest-first queue. Nothing is archived and no `ship_ref` is written, so
the admin can take the order back by deleting that message while it is still
undelivered (admin feedback 18e96ad3: "solange das issue noch nicht erstellt
wurde sondern nur in todo ist").

**When STEP 1 picks up a topic whose thread carries an open `**[ISSUE]**`
message, do not implement it.** File the GitHub issue instead, then close the
hand-off the same way a ship closes: `status = 'issue_created'`, `ship_ref` =
the issue url. From there the ordinary outcome path applies — the row goes into
the sign-off gate (`awaitsReview`) and reaches the Archive only when the admin
accepts it. The order is "open" exactly while `status <> 'issue_created'` and
`ship_ref is null`; once either is set the request has been carried out and the
undo disappears from the board.

**The queue is additionally gated on `triaged`.** A topic filed by a non-admin
through the user feedback FAB (`source = 'user'`) enters `triaged = false` and
is **not** work for the routine until an admin releases it — see "User-submitted
feedback" below. The routine's work-queue read is therefore:

```sql
select * from public.admin_feedback
where status = 'open' and triaged
order by created_at;
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

## Scope: the whole project, not just the web app

Feedback can target **any** part of the project and the routine ships all of it —
not only the Angular web app. The binaries for the desktop apps live in other
repos, but the source and the feedback live here, so they are **in scope**. Each
area has its own verify + release path; use the one(s) the change touches:

| Area | Verify (the gate) | Release / deploy |
|------|-------------------|------------------|
| **Web app** (`src/`, `public/`) | root `npm run typecheck && npm run build && npm test` | PR → squash-merge; Vercel auto-deploys on main-push — **5–10 min, and not guaranteed**: verify the Production deployment for the merge SHA before telling the admin it is live (step 5b) |
| **Data-uploader** (`data-uploader/`, Electron) | `cd data-uploader && npm ci && npm run typecheck && npm run build && npm test` (nested project — needs its own `npm ci`) | after merge, tag `data-uploader-v<ver>` → `data-uploader-build.yml` builds the binary → register the `desktop_releases` row (`/ship` extension rule 6 + `.claude/deep-knowledge/data-uploader-release.md`) |
| **Wallpaper-app / Starscape** (`wallpaper-app/`, Rust) | **no cargo in the routine env** — do NOT try `cargo build` locally; the gate is a **green CI build** | after merge: bump `wallpaper-app/Cargo.toml` + `Cargo.lock`, push the `wallpaper-app-v<ver>` tag → `wallpaper-app-build.yml` builds + publishes to the mirror + prints the register SQL, **THEN register the `desktop_releases` row (`product='starscape'`)** via the authenticated Supabase MCP — else `/starscape` stays on the old version. Full flow: `.claude/deep-knowledge/starscape-release.md` |
| **Supabase migrations** (`supabase/migrations/`) | additive change → apply headless `npm run db:push`; a **destructive** migration (drop/rename/data-loss) is a review-hold, never an auto-apply | `db push` to the cloud project IS the deploy — run it after/with the merge |
| **Supabase edge functions** (`supabase/functions/`) | deploy is the test: `npm run functions:deploy` (or `supabase functions deploy <name>`; CLI creds are stored) | the deploy after merge |

Three rules behind that table: **native builds go through CI**, never the
routine's machine (no Rust toolchain here — a Rust/Starscape change is merged
and the `*-build.yml` run is the gate, never a "no cargo" review-hold);
**out-of-band deploys don't ride the merge** — a migration or edge function is
live only after `db push` / `functions deploy`, so finish the deploy, then mark
`shipped`; and **the web deploy only *starts* at the merge** — the Vercel build
takes 5–10 min, can be queued, skipped or fail, and must be waited for and
verified before the admin is told anything (step 5b).

**Migration prefixes collide silently.** Before merging any PR with a migration,
check the prefix against `origin/main` (`ls supabase/migrations | grep <prefix>`)
and rename on collision (file name, header comment, docs). After each `db push`
read which files it names — silence about an expected file is the symptom; an
out-of-order version is refused loudly (`--include-all`).

## Bias to action — don't park what you can sensibly default

`needs_input` is expensive: it bounces the topic back to the admin and stalls it
for a cadence cycle or days. The admin's answer is very often just "ja, genau,
mach" — meaning defaulting-and-shipping would have been right. So the routine's
bias is to **decide and ship**, and to park only when it genuinely must:

- **Just do it** (implement + ship on a sensible default, note the choice in the
  PR): obvious UX/polish, a clearly-worded feature, a small A/B where one option
  is the reasonable default, wording/i18n/layout — anything a normal follow-up
  PR could reverse. If you'd only be asking to hear "yes", don't ask: ship it and
  say what you chose.
- **Park as `needs_input`** (a real question): a genuinely irreversible or risky
  call — auth / RLS / secrets / payment, a **destructive** DB migration, deleting
  user data; a real fork where the wrong pick is expensive to undo and no sensible
  default exists; or a missing external resource the routine can't supply (e.g. a
  readme.io API key).
- **Suspected noise**: park `needs_input` with "looks like a duplicate/spam —
  delete it if you agree"; the admin owns the discard.

When torn between asking and defaulting, prefer the default and keep the change
easy to revert. A reversible wrong guess costs one follow-up PR; an unnecessary
question costs a day.

## STEP 1 — the six queue reads (a)–(f)

Run all six every working run. **(f) comes first, before anything new is
claimed.** Each letter routes to its appendix; the SQL is the contract. Run
them through the Supabase MCP, or — when it is not authorised — through
`node scripts/routine-gate.mjs sql --file <statement.sql>` (STEP 0).

```sql
-- (a) the work queue: oldest first, and untriaged user topics are not work for the routine
select * from public.admin_feedback where status = 'open' and triaged order by created_at;

-- (b) answered Rueckfrage: needs_input topics whose newest message is human  -> needs-input.md
select f.id from public.admin_feedback f
join lateral (select is_system from public.admin_feedback_messages m
  where m.feedback_id = f.id order by m.created_at desc limit 1) last on true
where f.status = 'needs_input' and last.is_system = false;

-- (c) open review-holds: sensitive/red items parked for the admin (in_progress WITH a PR) -> holds.md
select id, ship_ref, processing_note, processed_at from public.admin_feedback
where status = 'in_progress' and ship_ref is not null order by processed_at asc;

-- (d) continue-after-ship: shipped topics the admin replied to after the ship -> continuation.md
select f.id, f.body, f.shipped_at, f.ship_ref from public.admin_feedback f
join lateral (select is_system, created_at from public.admin_feedback_messages m
  where m.feedback_id = f.id order by m.created_at desc limit 1) last on true
where f.status = 'shipped' and last.is_system = false
  and last.created_at > coalesce(f.shipped_at, f.processed_at, f.created_at)
order by f.created_at asc;

-- (e) answered review-hold: in_progress topics whose newest message is human -> holds.md
select f.id, f.ship_ref, f.body, m.created_at as answered_at from public.admin_feedback f
join lateral (select is_system, created_at from public.admin_feedback_messages m
  where m.feedback_id = f.id order by m.created_at desc limit 1) m on true
where f.status = 'in_progress' and m.is_system = false order by m.created_at asc;

-- (f) review reply still owed, e.g. by a run that died during the deploy wait -> continuation.md
select id, ship_ref, shipped_at from public.admin_feedback
where status = 'shipped' and review_reply_pending order by shipped_at asc;
```

An otherwise-empty `open` queue is not "nothing to do" while (c)–(f) have hits.
An (e) hit ranks by the **reply's** age, not the row's. The claim SQL for each
letter is in STEP 2.

## STEP 2 — Concurrency: isolated worktrees + up to 3 parallel disjoint-area threads

Runs can overlap (a run can outlast its tick; the gate's run lock makes a second
run stand down — `feedback-routine/gate.md`). The atomic claim stops two runs
taking the *same* item, but not two threads corrupting a **shared git
checkout** — so **every unit of work runs in its own isolated worktree**, never
the primary checkout, which stays the clean base (history: PR #204→#206).

**Up to three items may run in parallel, only if their implementation areas are
pairwise disjoint.** Area = the set of files/dirs an item will touch, judged at
two levels: *coarse* (the Scope table: `web` `src/`+`public/` · `data-uploader/`
· `wallpaper-app/` · `supabase/migrations/` · `supabase/functions/` — different
coarse areas are disjoint by construction) and *fine* (two same-coarse items are
disjoint only if their expected file sets do not overlap, e.g.
`admin/feedback-panel` vs `mobile-nav`). **Seam files** (`public/i18n/{de,en}.json`
additive keys, `package.json`/`CHANGELOG.md` version bump, global tokens) do not
make areas overlap but force the serial, rebased merge phase. Items that share an area are serialised, never parallelised. **When in doubt,
serialise**: a wrong "disjoint" guess costs a merge conflict, a wrong
"same-area" guess costs one wave — run the oldest now, leave the rest `open`.

**Selecting the wave:** order all actionable items ((a)+(b)+(d)+(e)) oldest-first;
greedily admit while the wave is `< 3` and the candidate's area is disjoint from
every admitted item; skip the rest (untouched, next wave); claim each admitted
item atomically before fanning out and drop any the claim did not win. A single
admitted item is a wave of one.

The claim is one guarded UPDATE per letter:

```sql
-- (a)/(b) first-time or answered pickup
update public.admin_feedback set status='in_progress', processed_at=now()
where id='<id>' and status in ('open','needs_input') returning id;

-- (d) continuation - clearing ship_ref is load-bearing (a bare in_progress is reaper-healable)
update public.admin_feedback set status='in_progress', ship_ref=null, processed_at=now()
where id='<id>' and status='shipped' returning id;

-- (e) answered review-hold - same shape, claimed back from the hold
update public.admin_feedback set status='in_progress', ship_ref=null, processed_at=now()
where id='<id>' and status='in_progress' and ship_ref is not null returning id;
```

**Never trust a status-guarded UPDATE to have happened — always `returning`,
always check exactly one row came back.** On zero rows, re-read the row and
reconcile against *reality*, not against the status you assumed: a merged PR
always wins.

## STEP 3 — the per-item procedure

Two things the claim itself writes before any code is touched:

**The topic's title (`summary`).** The routine is the one reader with the whole
topic in front of it, so it writes the title with the claim —
`update public.admin_feedback set summary='<one line>' where id='<id>';` — saying
what the topic **asks for**, not what it is about; one line, no markdown, no
trailing period, ≤ ~90 chars (column cap 120); the topic's own language and the
poster's own words, a restatement, never a verdict. Write it once, on the claim
(also on a reaped redo that has none); leave an existing summary alone unless a
continuation changed what the topic is about. `summary` is nullable (readers fall
back to the body-derived `displayTitle`) and admin-only — not in `my_feedback`.

**Complex topics (`complex = true`) are worked two reasoning/effort steps above
the default** (`high` → `max`, or the highest level the model offers) — for the
worker AND every sub-agent it fans out to, decided before the worker is spawned.
Two steps up is the ceiling, not a licence to widen the item: scope, gates and
ship rules are unchanged, one PR. With no adjustable level, read wider first and
prefer a design pass over a first-guess patch. The flag is admin-only input
(pinned to `false` for `source = 'user'` inserts by
`admin_feedback_normalize_user_insert`); the routine never writes it.

### Per-item procedure

This runs **once per admitted batch item** — for a batch of one, inline; for a
parallel batch (2–3 disjoint-area items), fanned out to one sub-worker per item,
each in its own isolated worktree (see "Concurrency"). Steps 1–4 (claim →
understand → implement → verify) plus *pushing the branch and opening the PR* run
**inside the worker**; the **merge in step 5 is hoisted out to the orchestrator's
serial, oldest-first merge phase** so two feedback PRs never merge at once. For a
batch of one the two phases collapse and it's a plain implement-then-merge.

For each admitted `open` row (process independently, most-recent context wins):

1. **Claim it (atomically).** `update admin_feedback set status='in_progress',
   processed_at=now() where id=<id> and status='open'`. If **zero** rows were
   updated, a concurrent run already claimed it — skip the item and move on.
   This atomic claim is the single-flight lock that makes overlapping runs
   safe; never process an item you did not successfully claim.
2. **Understand.** Read `body` (markdown) **and the topic's thread** (all
   `admin_feedback_messages` for this id, oldest first — the admin may have
   already answered a prior question). **Check `complex`** while you are there:
   a `true` means this item is worked two reasoning steps above the default (see
   "Complex topics are worked one gear higher"), and that has to be decided
   *before* the implementing agent is spawned, not after. Having read it, **write the topic's title**
   if it has none — `update admin_feedback set summary='<one line>' where
   id=<id>` (see "The topic's title" above; that is the only moment anybody has
   the whole topic in front of them). Then classify:
   - **Not shippable right now** — either apparent noise (spam, duplicate,
     empty/garbled) *or* it needs a human decision / clarification (product
     call, auth/RLS/privacy, a choice between options, or the body literally
     asks "create an issue / discuss") → **never reject.** Post a SYSTEM reply
     explaining why (the question, the options, or — for suspected noise — "this
     looks like a duplicate/spam; delete it if you agree"), set
     `status='needs_input'`, `processed_at=now()`; continue. Discarding is the
     admin's call, made by deleting the topic — not the routine's.
   - **Actionable now** → implement (step 3).
3. **Implement.** *First, decide the branch — continuation or first-time.* The
   item is a **continuation** iff `shipped_at IS NOT NULL` **and** a human message
   is newer than `shipped_at` (true for a query-(d) pickup, and still true for a
   reaped continuation that came back as `open`). A continuation's branch is
   `feat/feedback-<id-short>-<trigger-msg-short>` (first 8 chars of the triggering
   message's id); a first-time item's branch is the base `feat/feedback-<id-short>`.
   *Then an idempotency check on that branch* — a reaped item may already carry a
   branch/PR from the interrupted run (see the abort-window note above). The branch
   name is deterministic, so `gh pr list --state all --head <branch>` (+ `git
   ls-remote --heads origin <branch>`) first, and reconcile: **merged PR** → mark
   `shipped` from its `mergedAt`/url + post the review reply, no rebuild; **open
   PR** → resume + verify on that branch, no second PR; **stale branch, no PR** →
   delete it, rebuild; **nothing** → fresh branch off `main`. For a continuation,
   the already-merged **base** PR is *not* a match (the branch differs), so it never
   short-circuits the follow-up. Then implement, following repo conventions
   (CLAUDE.md): standalone components, signals, OnPush, ngx-translate for all
   strings, no keys in the bundle.
4. **Verify (the safety net).** Run the verify path(s) for the **area(s) the
   change touches** (see the Scope table) — not just root npm. A web change is
   `npm run typecheck && npm run build && npm test`; a data-uploader change also
   runs `cd data-uploader && npm ci && npm run typecheck && npm run build &&
   npm test`; a Rust/Starscape change is verified by a **green CI build** (no
   local cargo); a migration/function is verified by its headless apply/deploy.
   All gates relevant to the change must pass.
5. **Ship decision** (the worker pushes its branch + opens the PR; the
   orchestrator performs the merge in its serial, oldest-first phase — for a
   batch of one these collapse into a single inline step):
   - **All green** → the worker opens a PR (never force-push). The orchestrator,
     merging serially, first brings the branch up to current `origin/main`
     (rebase / update-branch) — on a clean rebase it squash-merges, then runs any
     **out-of-band deploy** the change needs — `npm run db:push` for a migration,
     `npm run functions:deploy` for an edge function, push the `*-v<ver>` tag so
     CI builds the desktop binary + register `desktop_releases` (`/ship`
     does this end-to-end). Only once the deploy is done:
     `update admin_feedback set status='shipped', shipped_at=now(),
     ship_ref='<PR url>', processed_at=now(), processing_note=null,
     review_reply_pending=true where id=<id>` — the flag is what lets the NEXT
     run post the reply if this one dies during the deploy wait (query (f)).
     **Then wait for the deploy before saying a word.** The merge does not make a
     web change live — it only starts a Vercel production build that takes 5–10
     minutes when it runs at all. Poll the **Production deployment for the merge
     SHA** until it reports `success`, bounded at 15 minutes (full rules and the
     `gh api` poll: "The review reply must not be posted before the change is
     reachable").
     **Then, step 5b — post the review reply** (see "Post-ship review & continue", `feedback-routine/continuation.md`):
     a `is_system=true` reply with the PR link, one line on what changed, the
     **live URL** for the area stated as a *verified fact* ("live seit HH:MM", never
     an estimate), the PWA hard-reload hint on any `src/`/`public/` change, and the
     invite to reply in-thread to continue. If the deployment is not ready inside
     the timeout or it failed, post the **not-yet-live** variant instead — never
     point the admin at a page that does not carry the change yet. The item is
     `shipped` either way. This runs on every ship, including a continuation
     re-ship and a mark-already-merged.
     If the rebase hits a real conflict (areas overlapped after all), don't force
     it — leave the item `open` for the next run (or hold it as a review-PR), and
     merge the remaining batch branches.
   - **Red, or a genuinely risky/irreversible call** (auth/RLS/secrets/payment, a
     destructive migration, data deletion) → don't auto-ship; the worker opens a
     PR for manual review and the item is left `status='in_progress'` with
     `ship_ref='<PR url>'` + a `processing_note`. `in_progress` is only ever valid
     **with** a `ship_ref` (a real review-hold) — never leave a bare `in_progress`
     (it jams the reaper + the oldest-first queue; see the reaper section).
6. Never touch rows in a terminal status directly. The only way a terminal topic
   returns to the routine is by being **reopened first**, always by an admin
   reply: `issue_created` / `declined` / `rejected` are flipped straight to `open`
   by the reopen trigger (then query (a) sees a plain `open` item), and `shipped`
   reopens as a continuation (query (d) / step 5b's invite). Never re-implement a
   still-terminal topic — a `shipped` topic with no fresh human reply, or an
   archived topic nobody replied to.

### Non-verifiable / decision-needed items → `needs_input`, never a bare `in_progress`

`in_progress` is a **transient** state, legitimate only while a run is actively
implementing an item *or* while it holds a real review-hold PR (`ship_ref` set).
The parking rules, the system-reply shape, the one-tap answer options and the
resume query are in [`needs-input.md`](feedback-routine/needs-input.md).

## STEP 4 — Merge phase is serial, even when implementation was parallel

Parallel *implementation* is safe in isolated worktrees; parallel *merge* is not.
Each fanned-out worker implements + verifies + pushes its branch + opens its PR,
but does **not** merge. The orchestrator then merges them **one at a time,
oldest-first**, bringing each branch up to the current `origin/main`
(rebase / update-branch) immediately before its squash-merge. This absorbs the
shared seam-file collisions (i18n keys, version bump) deterministically:

- A branch that rebases clean and stays green → squash-merge, run its out-of-band
  deploys, mark `shipped`.
- A branch that hits a genuine conflict on rebase (the areas turned out to overlap
  after all) → don't force it: leave that item `open`, or hold it as a review-PR
  with a `ship_ref` if a human should look, and let the next cadence run redo it
  against the now-merged main. **Never merge two feedback PRs simultaneously.**
- The merge itself goes through the `ship_release` MCP **with `tag: v<version>`**:
  that is the alpha ring tag (`alpha/v<version>`) a later `ship_promote` re-tags.
  A merge without it (#590, 2026-09-13) leaves `main` ahead of every ring and
  has to be tagged by hand — pass it every time.

Two hazards: **spawning sub-workers can reset a shared worktree to
`origin/main` mid-flight**, so the orchestrator never edits code while workers
run, every worker gets its own `git worktree add <sibling> feat/feedback-<id>`,
and every worker **commits and pushes before returning**. And **the edit-hook
reads the shell cwd**, not the edited file's path — `cd "<worktree path>"`
before the first Edit/Write of a thread, or a worktree edit is blocked as
"editing main".

## STEP 5 — drain the queue, wave by wave

A run is not one wave and done. After the serial merge, re-read the queue
(`node scripts/routine-gate.mjs check --in-run`) and, if anything actionable is
left, build the next wave of up to 3 disjoint-area items off the now-merged
`origin/main`. Keep going until the queue is empty or a brake trips. Brakes are
checked between waves only, never mid-item: under 20 % left in the 5-hour usage
window, stop with `end-run --state paused --note paused-usage-limit`; an
unreadable meter fails open. Each wave's worktrees are removed after its merge.
Details: [`gate.md`](feedback-routine/gate.md).

## STEP 6 — close the run

Report the open review-holds ([`holds.md`](feedback-routine/holds.md)) and run
the loose-ends sweep ([`sweep.md`](feedback-routine/sweep.md)) — every cycle,
queue empty or not. Re-read the queue right before writing the report, because a
parallel run may have shipped or parked items you thought you owned. Then
release the run lock with `node scripts/routine-gate.mjs end-run --state idle
--note shipped:<n>`, always — even the "nothing more to do" exit runs it.

## Guardrails

- **PR + auto-merge only** — the merge is gated on green build+tests. No direct
  pushes to `main`, no force-push.
- **The routine never sets `rejected`.** Discarding a topic is the admin's call
  alone, exercised by deleting it from the board. Anything the routine cannot
  ship goes to `needs_input` with a system reply; the admin keeps steering or
  deletes.
- One branch + PR per feedback item, so each ships/reverts independently.
- If an item would touch auth, RLS, secrets, or payment paths, or apply a
  **destructive** migration (drop/rename/data-loss) → do **not** auto-ship; open a
  PR and leave `in_progress` (with its `ship_ref`) for human review. Everything
  else the routine can sensibly default → ship it (see "Bias to action").
- **Parallel batch cap: up to 3 disjoint-area items per run**, implemented
  concurrently (one isolated worktree + sub-worker each) but merged serially,
  oldest-first (see "Concurrency: isolated worktrees + up to 3 parallel
  disjoint-area threads"). Same-area items are not parallelised — the oldest runs
  and the rest stay `open` for the next cadence run. Any actionable items beyond
  the batch of 3 also stay `open` for the next run.
- **Report loose ends every cycle, queue empty or not** — open review-holds
  ("Surfacing open review-holds") *and* the git/release residue that no query
  sees ("Loose-ends sweep"). Report-only: never promote, never delete a branch /
  worktree / stash, never PR a branch the routine doesn't own.
- **The gate runs first, every tick** (`node scripts/routine-gate.mjs check`);
  an idle tick never reads this runbook. Every working run takes the run lock
  and releases it (`start-run` / `end-run`), and drains the queue wave by wave
  until empty or the usage brake trips — brakes are checked between waves,
  never mid-item ("Drain loop and the usage brake").
- **Overlapping runs are expected** — the task fires every 20 min and a run can
  outlast that; the gate's run lock makes the second run stand down, and the
  atomic per-item claim stops two runs taking the *same* item,
  but it does **not** prevent shared-checkout corruption: every thread works in
  its own isolated worktree (see "Concurrency: isolated worktrees + up to 3
  parallel disjoint-area threads").

## Data model reference

`public.admin_feedback` (see migration `20260707190000_admin_feedback.sql`):

| column           | meaning                                                    |
|------------------|------------------------------------------------------------|
| `seq`            | the topic's **stable reference number** ("#42"), from sequence `admin_feedback_seq_seq` — see `feedback-routine/admin-panel.md` (feedback `21587480`) |
| `status`         | `open` \| `in_progress` \| `shipped` \| `needs_input` (routine-driven) · `issue_created` = hand-off to a GitHub issue, written by the routine on an open `**[ISSUE]**` order or by an admin recording an existing issue · `declined` + `needs_input_author` = admin-driven, user topics only · `rejected` = legacy/admin-only, never set by the routine |
| `ship_ref`       | link that closed the topic: PR/commit URL for `shipped`, GitHub issue URL for `issue_created` (also set on a review-hold `in_progress` row) |
| `processing_note`| routine's note (reject reason / red-build hint) — **admin-only**, never shown to a feedback author |
| `shipped_at`     | set (and re-set) at each merge to `main`; the review loop's query (d) compares the newest reply against it to detect an admin's post-ship continuation |
| `processed_at`   | last time the routine acted on the row                     |
| `source`         | `admin` (default, all legacy rows) \| `user` = filed through the non-admin FAB (feedback `5920cf8c`) |
| `triaged`        | routine release gate; `true` for every admin row, `false` on a fresh user topic and again after its author answered, until an admin releases it |
| `decision_note`  | the admin's explanation on a `declined` user topic — **author-visible** (only while the topic is declined) |
| `status_before_author_question` | admin-only memo: the status a topic had when an admin asked its author something, restored by the answer |
| `summary`        | the routine's one-line title for the topic (migration `20260906140000`, ≤ 120 chars) — written on the claim, `null` until then; the board falls back to the body. **Admin-only**, not in `my_feedback` — see "The topic's title" |
| `review_reply_pending` | `true` from the `shipped` UPDATE until the ✅/⏳ review reply is actually posted (migration `20260913131500`); query (f) picks these up first thing in a working run — see `feedback-routine/continuation.md` |
| `complex`        | admin opt-in (migration `20260907220000`, feedback `423e5130`): work this topic **two reasoning/effort steps above the default**. `not null default false`; ticked in the admin new-topic composer, pinned to `false` for `source = 'user'` inserts by `admin_feedback_normalize_user_insert`. Never written by the routine — see "Complex topics are worked one gear higher" |

`public.routine_heartbeat` (see migration `20260730173500_routine_heartbeat.sql`)
— one row per routine, overwritten in place; see `feedback-routine/gate.md`:

| column         | meaning                                                    |
|----------------|------------------------------------------------------------|
| `id`           | routine key, `admin-feedback-routine` for this routine      |
| `last_seen_at` | start of the most recent tick — the proof of life           |
| `next_run_at`  | when the gate expects the next tick to fire (cadence table + jitter); the panel is green while this + 15 min is ahead (migration `20260913121500`) |
| `state`        | `idle` · `running` (run lock held) · `paused` (usage brake) — see `feedback-routine/gate.md` |
| `run_started_at` / `run_finished_at` | the run lock; a `running` older than 3 h is dead and may be taken over |
| `note`         | machine key (`queue-empty`, `work:<n>`, `shipped:<n>`, `paused-usage-limit`, `skip-cadence`, `gate-error`, `running`) translated by the panel; anything else is shown verbatim — never secrets |
| `updated_at`   | bookkeeping, same instant as `last_seen_at` in practice      |

### Active vs. Archive

**Active** — `open`, `in_progress`, `needs_input`, `needs_input_author`.
**Archive** (terminal at rest, migration `20260724220000`) — `shipped`,
`issue_created`, `declined`, legacy `rejected`; all four reopen on an admin
reply as described under "Contract". `issue_created` is the "tracked elsewhere"
outcome with exactly one writer, the routine, on an open `**[ISSUE]**` order
(`status='issue_created'`, `ship_ref=<issue url>`, `processed_at=now()`); it
lands in the sign-off gate first. **The routine never touches a row while it
rests in `issue_created`** — an admin reply reopens it to `open` first. How the
panel renders the halves: `feedback-routine/admin-panel.md`.

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
regular admins). **Bypassing RLS is exactly why the routine must respect the
privacy rule by discipline:** it may read everything, but it writes its replies
only into `admin_feedback_messages` — never into the author-visible
`feedback_author_messages` (see `feedback-routine/user-feedback.md`).

The author-visible channel for user-submitted topics lives in
`public.feedback_author_messages` (migration
`20260726170000_user_feedback_channel.sql`):

| column        | meaning                                                       |
|---------------|--------------------------------------------------------------|
| `feedback_id` | FK → `admin_feedback.id` (cascade delete)                    |
| `author_id`   | FK → `profiles.id`; who wrote the message                    |
| `from_admin`  | `true` = admin → author, `false` = the author's own reply (only while a question is open) |
| `is_question` | `true` only on an admin message that asks the author something → sets `status='needs_input_author'` |
