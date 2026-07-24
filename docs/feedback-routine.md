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

  rejected      ← the ADMIN decides this alone (by deleting the topic); the
                  routine NEVER sets it.
  issue_created ← the ADMIN archives a topic against a GitHub issue
                  (ship_ref = issue url); terminal, the routine NEVER sets it.
```

`shipped`, `issue_created` and legacy `rejected` are **terminal** — together
they form the panel's Archive tab (see "Active vs. Archive" below). The routine
only ever works the active half (`open` / `in_progress` / `needs_input`).

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
| **Web app** (`src/`, `public/`) | root `npm run typecheck && npm run build && npm test` | PR → squash-merge; Vercel auto-deploys on main-push |
| **Data-uploader** (`data-uploader/`, Electron) | `cd data-uploader && npm ci && npm run typecheck && npm run build && npm test` (nested project — needs its own `npm ci`) | after merge, tag `data-uploader-v<ver>` → `data-uploader-build.yml` builds the binary → register the `desktop_releases` row (`/devops-ship` rule 5 + `.claude/deep-knowledge/data-uploader-release.md`) |
| **Wallpaper-app / Starscape** (`wallpaper-app/`, Rust) | **no cargo in the routine env** — do NOT try `cargo build` locally; the gate is a **green CI build** | after merge: bump `wallpaper-app/Cargo.toml` + `Cargo.lock`, push the `wallpaper-app-v<ver>` tag → `wallpaper-app-build.yml` builds + publishes to the mirror + prints the register SQL, **THEN register the `desktop_releases` row (`product='starscape'`)** via the authenticated Supabase MCP — else `/starscape` stays on the old version. Full flow: `.claude/deep-knowledge/starscape-release.md` |
| **Supabase migrations** (`supabase/migrations/`) | additive change → apply headless `npm run db:push`; a **destructive** migration (drop/rename/data-loss) is a review-hold, never an auto-apply | `db push` to the cloud project IS the deploy — run it after/with the merge |
| **Supabase edge functions** (`supabase/functions/`) | deploy is the test: `npm run functions:deploy` (or `supabase functions deploy <name>`; CLI creds are stored) | the deploy after merge |

**Native builds go through CI, not the routine's machine.** The routine env has
Node + the Supabase CLI but **not** the Rust toolchain. So for Rust/Starscape the
routine must NOT self-certify locally — merge the source change and let the
existing `*-build.yml` workflow build the binary, watching that run as the gate.
This replaces the old failure where `a5783bed` (a wallpaper-app change) was
parked as a bare "no cargo toolchain" review-PR instead of being built by CI.

**Out-of-band deploys don't ride the merge.** A migration or edge function is NOT
live just because the PR merged — `db push` / `functions deploy` run separately
(the ship pre-flight flags these paths). Finish the deploy, then mark `shipped`.

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

## Concurrency: isolated worktrees + up to 3 parallel disjoint-area threads

Runs overlap (cron ~every 20 min; a run can outlast that). The atomic claim
(per-item `status` lock) stops two runs implementing the *same* item — but it
does **not** stop them colliding in a **shared git checkout**: two runs — or two
threads within one run — editing, branching, or `git checkout`-ing the same
working tree corrupt each other's uncommitted work (observed 2026-07-24: one
run's RSI-upcoming edits landed on another run's docs branch). So **every unit of
work runs in its own isolated git worktree**, never the shared primary checkout —
create/enter a per-thread worktree, do all edits/build/commit/ship there, and
leave the primary checkout as the clean base. (This reverses the earlier "work on
the primary checkout" guidance, which was the direct cause of the collision — see
the `feedback-routine-shared-checkout-collision` memory / PR #204→#206.)

### Up to 3 disjoint-area threads may run in parallel

A run MAY implement up to **three** feedback items **at the same time**, each in
its own isolated worktree (a fanned-out sub-worker per item), **but only if their
implementation areas are pairwise disjoint**. Items that share an area are
serialised, never parallelised. This makes real the concurrency for independent
work that was previously only a de-facto "one item per cadence", while keeping
same-area items safe from the contradictory-redesign / merge-hell failure of
2026-07-23 (see the `feedback-overlapping-items-serialize` memory).

**Implementation area = the set of files/dirs an item will touch.** Judge
disjointness at two levels:

- **Coarse area** (the Scope table): `web` (`src/`, `public/`) · `data-uploader/`
  · `wallpaper-app/` (Starscape) · `supabase/migrations/` · `supabase/functions/`.
  Two items in *different* coarse areas are disjoint by construction.
- **Fine area** (within the same coarse area — most often two `web` items): the
  concrete feature/component/route subtree each item will edit (e.g.
  `admin/feedback-panel` vs. `mobile-nav` vs. the `loadout` view). Two
  same-coarse items are disjoint only if their expected file sets do **not**
  overlap.

**Shared "seam" files don't by themselves make areas overlap, but they force
serial merges.** Independent items very often both touch a few global files —
`public/i18n/{de,en}.json` (additive new keys), `package.json` / `CHANGELOG.md`
(version bump), global tokens/styles. Adding keys at opposite ends of a JSON file
is not a design conflict, so it does **not** disqualify parallelism — but it *does*
mean the branches can't both merge blind. The merge phase (below) is therefore
serial + rebased, which absorbs these seam collisions deterministically.

**When in doubt, serialise.** If you can't cheaply convince yourself two items'
file sets are disjoint (e.g. both "rework the admin panel" — the 2026-07-23 case
where later items built structurally on the first), treat them as the same area:
run the oldest now, leave the rest `open` for the next cadence run against the
updated `origin/main`. A wrong "disjoint" guess costs a merge conflict; a wrong
"same-area" guess only costs one cadence cycle of latency — so bias to serial.

### Selecting the parallel batch (before implementing anything)

After the reaper (STEP 1.5) and the queue read (STEP 1), pick the batch:

1. Order all actionable items (`open`, plus answered `needs_input` resumes)
   oldest-first.
2. Greedily admit items into the batch while (a) the batch size is `< 3` **and**
   (b) the candidate's area is disjoint from every already-admitted item's area.
3. Skip (leave `open` / untouched) any candidate whose area overlaps an admitted
   item — it ships in a later run against the merged result.
4. Atomically claim **each** admitted item (the per-item `where status='open'`
   guard) before fanning out; drop from the batch any that another concurrent run
   already claimed (zero rows updated).

A single admitted item is just a batch of one (no fan-out overhead). The cap is
**3 per run**; the atomic claim keeps this safe even when another overlapping
cron run is also selecting a batch — the two runs can't claim the same item, and
merges are serial + rebased regardless.

### Merge phase is serial, even when implementation was parallel

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

**Spawn hazard — give every worker its OWN worktree and make it commit+push.**
Fanning out sub-workers can reset a shared worktree to `origin/main` mid-flight
(`sc-worktree-reset-hazard`). So the orchestrator must not edit code itself while
workers run: each worker gets a fresh `git worktree add <sibling> feat/feedback-<id>`,
and every worker **commits and pushes its branch before returning** so its work
is persisted remotely before the serial merge phase begins.

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
  implementing/building — 30 min comfortably exceeds a normal single-item
  cycle while the ~20-min cadence keeps resumption prompt. Worst case if a
  genuine build outruns 30 min: the item is reopened and re-done on a fresh
  branch+PR — wasted effort, never data corruption (the atomic claim still
  prevents two runs acting on it at the same instant, and each item ships via
  its own independent PR).

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

- The **30-minute `processed_at` guard means a gap.** A run at T+20 min skips
  the stranded item (still inside the window); only a run at ≥ T+30 min reopens
  it. So an item aborted by the usage limit can visibly sit `in_progress` for up
  to ~1.5 cadence cycles before it is picked up again. That delay is intended
  (it protects a legitimately overlapping in-flight run) — it is not a bug, but
  it does mean "stuck for half an hour" is expected, not lost.
- **Resumption is a full redo, not a continuation.** The reaper reopens the row
  to `open`; the next run re-implements it from scratch on a fresh branch+PR. No
  partial progress (a half-written branch, an un-pushed commit) is recovered —
  only the *item* resumes, from the beginning. This is safe (each item ships via
  its own PR, the atomic claim still serialises access) but means wasted work if
  the abort happened late in an item.

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

## Surfacing open review-holds (the reaper's mirror image)

A sensitive/red item the routine parks for the admin lives as `in_progress`
**with** a `ship_ref` (its PR) — and after that, **nothing ever looks at it
again**: the reaper skips it by design (`ship_ref IS NOT NULL` — it is an
intentional hold, not an orphaned claim) and the `needs_input`-resume query
never sees it (it is `in_progress`, not `needs_input`). So a green, mergeable
review-hold PR can sit unnoticed for days until the admin happens to ask.

That is exactly what happened to PR #167 (feedback `10cd9fd7`): parked
`in_progress` + `ship_ref` on 2026-07-14 as "green build/tests but sensitive
(auth flow)", it stayed green and `MERGEABLE` for a day and surfaced only when
the admin asked "is anything still open?". The routine had *correctly* not
auto-merged it — but it had also never mentioned it again.

**Every cycle, after the reaper, list open review-holds and report them**
(never auto-merge — sensitive/red is a human call; only make them visible):

```sql
-- open review-holds: sensitive/red items parked for the admin (in_progress WITH a PR)
select id, ship_ref, processing_note, processed_at
from public.admin_feedback
where status = 'in_progress' and ship_ref is not null
order by processed_at asc;
```

Critically: an otherwise-empty `open`/`needs_input` queue is **not** "nothing to
do" while a hold is open. Report each hold — PR link, `processing_note`, age —
instead of taking the silent "No open feedback." stop, so a parked PR the routine
can't merge itself still nudges the admin to review/merge it.

## Per-item procedure

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
3. **Implement.** *First, an idempotency check* — a reaped item may already
   carry a branch/PR from the interrupted run (see the abort-window note above).
   Since `feat/feedback-<id-short>` is deterministic, `gh pr list --state all
   --head feat/feedback-<id-short>` (+ `git ls-remote --heads origin
   feat/feedback-<id-short>`) first, and reconcile: **merged PR** → mark
   `shipped` from its `mergedAt`/url, no rebuild; **open PR** → resume + verify
   on that branch, no second PR; **stale branch, no PR** → delete it, rebuild;
   **nothing** → fresh branch off `main`. Then implement, following repo
   conventions (CLAUDE.md): standalone components, signals, OnPush,
   ngx-translate for all strings, no keys in the bundle.
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
     CI builds the desktop binary + register `desktop_releases` (`/devops-ship`
     does this end-to-end). Only once the deploy is done:
     `update admin_feedback set status='shipped', shipped_at=now(),
     ship_ref='<PR url>', processed_at=now(), processing_note=null where id=<id>`.
     If the rebase hits a real conflict (areas overlapped after all), don't force
     it — leave the item `open` for the next run (or hold it as a review-PR), and
     merge the remaining batch branches.
   - **Red, or a genuinely risky/irreversible call** (auth/RLS/secrets/payment, a
     destructive migration, data deletion) → don't auto-ship; the worker opens a
     PR for manual review and the item is left `status='in_progress'` with
     `ship_ref='<PR url>'` + a `processing_note`. `in_progress` is only ever valid
     **with** a `ship_ref` (a real review-hold) — never leave a bare `in_progress`
     (it jams the reaper + the oldest-first queue; see the reaper section).
6. Never touch rows in a terminal status — `shipped`, `issue_created` or
   `rejected`.

## Non-verifiable / decision-needed items → `needs_input`, never a bare `in_progress`

`in_progress` is a **transient** state, legitimate only while a run is actively
implementing an item *or* while it holds a real review-hold PR (`ship_ref` set).
An item the routine **cannot itself drive to a terminal state** must be parked as
`needs_input` (with a system reply) — never left sitting in `in_progress`. Two
classes qualify:

- **The npm gate can't verify it** — a native/desktop change (the Rust
  wallpaper-app / Starscape, the Electron uploader binary) or an external
  platform (readme.io). The routine may open a PR for a human, but it cannot
  self-certify `typecheck`+`build`+`test` green, so shipping it is the admin's
  call.
- **It needs an admin decision** — a product/UX call, an A/B choice,
  auth/RLS/secrets/privacy.

**Rule:** a persistent `in_progress` with `ship_ref IS NULL` is an anti-pattern.
`in_progress` is valid only *with* a `ship_ref`; otherwise park it `needs_input`
so it leaves the active queue and the admin can see it's on them.

**Why this is load-bearing (the 2026-07-23 starvation).** The queue is
oldest-first and a run admits only a small batch (up to 3 disjoint-area items).
A bare `in_progress` item (`ship_ref IS NULL`) the routine can't finish jams the
**head** of the queue: the reaper reopens it every ~30 min (it looks orphaned —
see the reaper's `ship_ref IS NULL` guard), oldest-first re-admits it first, and
a usage-limit abort then never reaches the newer, immediately-shippable items
behind it. Three trivially-actionable
feedback-panel web items (`c5b6b13c`, `d6e6fd5f`, `69f3f015`) sat
`processed_at = NULL` for >22 h behind exactly such an item (`a5783bed`, a
wallpaper-app change left `in_progress` + "npm-gate cannot verify") — surfacing
to the user as "3 days, nothing happened".

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

## The admin side: the feedback panel's three views

The routine's counterpart is the admins-only panel (`sc-feedback-fab` →
`sc-admin-feedback`, embedded in a FAB overlay reachable from every page). It
has one view switch at the top, available in the docked panel, the maximized
panel and on the full board page alike:

| View | Component | What it is for |
|------|-----------|----------------|
| **Übersicht** | `admin-feedback.component.ts` | the classic board — an Aktiv/Archiv tab pair (see "Active vs. Archive"), day-grouped topic list, status/author filters, new-topic composer |
| **Abarbeiten** | `feedback-workflow.component.ts` | guided one-at-a-time run through the queue: every Rückfrage still waiting on the admin first (oldest first), then untouched `open` topics. Shows topic + full thread + inline answer box, plus a "3 von 7" progress rail |
| **Fortschritt** | `feedback-dashboard.component.ts` | "Diesen Monat" and "All-time" side by side — donut (shipped share) + bars for shipped / offen / beantwortete Rückfragen |

Queue and aggregation rules live as pure functions in `feedback.types.ts`
(`buildWorkflowQueue`, `computeStats`, `isArchived`, `refKind`), unit-tested in
`feedback.types.spec.ts`. All three views share that vocabulary: a terminal
topic is out of the processing queue, out of the dashboard's "offen" bucket and
in the overview's Archive tab, from the one `isArchived` rule.

Two things the routine should be aware of:

- **"Erledigt" in the processing mode does not change `status`.** The routine
  owns the status machine; ticking an item off only takes it out of the admin's
  working queue (stored client-side against the topic's `updated_at`). As soon
  as the routine touches the topic, the stamp mismatches and the item comes
  back into the queue.
- **Answering happens through the normal thread insert** (`is_system=false`),
  i.e. exactly the resume condition above — the processing mode is just a
  faster way to produce those replies.

Answering a Rückfrage and a freshly `shipped` topic appearing between two polls
each trigger a short confetti burst (`celebration.service.ts`, hand-rolled Web
Animations API, no dependency). All of it is suppressed under
`prefers-reduced-motion: reduce`.

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
- **Overlapping runs are expected** — the task fires every ~20 min and a run can
  outlast that. The atomic per-item claim stops two runs taking the *same* item,
  but it does **not** prevent shared-checkout corruption: every thread works in
  its own isolated worktree (see "Concurrency: isolated worktrees + up to 3
  parallel disjoint-area threads").

## Data model reference

`public.admin_feedback` (see migration `20260707190000_admin_feedback.sql`):

| column           | meaning                                                    |
|------------------|------------------------------------------------------------|
| `status`         | `open` \| `in_progress` \| `shipped` \| `needs_input` (routine-driven) · `issue_created` = admin-driven hand-off to a GitHub issue · `rejected` = legacy/admin-only, never set by the routine |
| `ship_ref`       | link that closed the topic: PR/commit URL for `shipped`, GitHub issue URL for `issue_created` (also set on a review-hold `in_progress` row) |
| `processing_note`| routine's note (reject reason / red-build hint)            |
| `shipped_at`     | set when merged to `main`                                  |
| `processed_at`   | last time the routine acted on the row                     |

### Active vs. Archive (`issue_created`)

Statuses split into two halves, which is exactly what the admin panel's
Active/Archive toggle inside the **overview** mode renders (migration
`20260724220000_admin_feedback_issue_created_status.sql`):

- **Active** — `open`, `in_progress`, `needs_input`. The board the routine and
  the admin work on.
- **Archive** (terminal) — `shipped`, `issue_created`, and legacy `rejected`.
  Nothing here is ever picked up again. Each row renders its `ship_ref` as a
  link, labelled "View change" for a shipped PR and "View issue" for an issue.

`issue_created` is a **terminal, admin-set** status: the admin archives a topic
by pasting its GitHub issue URL in the panel (button "Issue created"), which
writes `status='issue_created'` + `ship_ref=<issue url>` + `processed_at=now()`.
Its purpose is the "tracked elsewhere, done here" case — the topic leaves the
active queue without being deleted and without pretending it shipped. **The
routine never sets it** and, like `shipped`, never touches a row that carries
it. Legacy `rejected` rows are archived rather than hidden so they stay
reachable instead of being orphaned in a view nobody opens.

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
