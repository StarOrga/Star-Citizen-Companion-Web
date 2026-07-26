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

  shipped ──admin replies in the thread (query (d))──▶ reopened as a continuation
     ▲                                                          │
     │                                                          ▼
     └── re-ship + fresh review reply ◀── in_progress (new -<msg> branch, STEP 3–4)

  rejected      ← the ADMIN decides this alone (by deleting the topic); the
                  routine NEVER sets it.
  issue_created ← the ADMIN archives a topic against a GitHub issue
                  (ship_ref = issue url); terminal, the routine NEVER sets it.
  declined      ← the ADMIN declines a USER-submitted topic ("nicht umsetzen &
                  löschen", decision_note = the explanation the author reads);
                  terminal, the routine NEVER sets it.
  needs_input_author
                ← the ADMIN asked the topic's AUTHOR something. Active but NOT
                  `open`, so it is parked out of the queue; the author's answer
                  flips it back to `open` (DB trigger). The routine NEVER sets it.
```

`issue_created`, `declined` and legacy `rejected` are **terminal** — nothing ever
picks them up again. `shipped` is terminal **at rest**, but it is deliberately
*not* a dead end: an admin reply on a shipped topic reopens it as a
**continuation** (the post-ship review loop — see "Post-ship review & continue"
below), so the admin can look at the change live and keep iterating in the same
thread. Together the four form the panel's Archive tab (see "Active vs. Archive"
below); a shipped topic the admin has replied to flips back into the active half
the moment the routine claims it. The routine works the active half (`open` /
`in_progress` / `needs_input`) plus these shipped-with-a-fresh-reply
continuations. `needs_input_author` is active too, but it belongs to the admin and
the author, never to the routine.

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

## Post-ship review & continue (the review step)

Shipping is **not** the end of the conversation. The moment a topic ships the
admin usually wants to **look at the change live**, and often has a follow-up
("close, but move it left"; "now do the same for X"). Two mechanisms make that a
first-class step of the routine instead of a dead end — and the loop is built to
**converge** (it never re-fires on the routine's own messages) and to **self-heal**
(an interrupted continuation is reaped and redone without ever double-shipping).

### 1) On every ship, post a review reply (per-item procedure step 5b)

Immediately after the ship UPDATE — for a fresh ship **and** for a continuation
re-ship, and also when marking an already-merged PR shipped — insert a
`is_system=true` reply that (a) links the PR, (b) says in one line what changed,
(c) points at where to see it **live**, and (d) invites the admin to reply
in-thread to continue. The live pointer depends on the area:

- **web** (`src/`, `public/`) → `https://sc-companion.vercel.app` + the exact
  route/view the change touches (e.g. `/hangar`, the admin feedback panel). Note
  Vercel needs ~1 min after the merge to redeploy.
- **migration / edge function** → it is live once `db push` / `functions deploy`
  ran; name where its effect shows.
- **desktop** (uploader / Starscape) → live only after the CI build + the
  `desktop_releases` row; point at the release/channel to update.

```sql
-- step 5b: post the review reply right after the ship UPDATE (service_role)
insert into public.admin_feedback_messages (feedback_id, is_system, body)
values ('<id>', true, '<review reply, markdown — PR link + what changed + live URL + invite>');
```

Example (German — the admin's language; the routine's system replies address the
admin directly):

> ✅ Geshipped in <PR-Link>. Geändert: <ein Satz>.
> Live ansehen: `https://sc-companion.vercel.app/<route>` (Vercel braucht nach dem
> Merge ~1 Min). Passt etwas nicht, oder willst du weiter dran arbeiten? Antworte
> einfach hier im Thread — die Routine nimmt das Thema dann automatisch wieder auf.

### 2) An admin reply to a shipped topic reopens it as a continuation

The queue read gains a fourth query, **(d)**: shipped topics whose newest thread
message is a **human** reply posted **after** `shipped_at`.

```sql
-- (d) continue-after-ship: shipped topics the admin replied to after the ship
select f.id, f.body, f.shipped_at, f.ship_ref
from public.admin_feedback f
join lateral (
  select is_system, created_at
  from public.admin_feedback_messages m
  where m.feedback_id = f.id
  order by m.created_at desc
  limit 1
) last on true
where f.status = 'shipped'
  and last.is_system = false
  and last.created_at > coalesce(f.shipped_at, f.processed_at, f.created_at)
order by f.created_at asc;
```

Because the routine's own review reply is `is_system=true`, a shipped topic
re-enters the queue **only** when a *human* posts after the ship — so the loop
converges: ship → review reply → quiet; admin replies → reopened → ship → review
reply → quiet.

### How a continuation is worked (the robust part)

A continuation is the same per-item procedure with three deltas, chosen so an
interrupted continuation self-heals exactly like a first-time item and **never
double-ships**:

- **Claiming clears `ship_ref`.**
  `update admin_feedback set status='in_progress', ship_ref=null, processed_at=now()
  where id=<id> and status='shipped'` (atomic single-flight; zero rows → another run
  took it, skip). Clearing `ship_ref` is load-bearing: it keeps the stale-claim
  reaper correct. A continuation in flight then looks exactly like any other
  interrupted claim (`in_progress`, `ship_ref IS NULL`), so if the run dies the
  reaper reopens it on a later tick — a bare `in_progress` is *never* misread as a
  review-hold and stranded. The previous PR link is not lost: it still lives in the
  thread's review reply. Claiming also flips the topic out of the Archive tab back
  into Active (`in_progress` = "In Arbeit"), so the admin sees the routine is on it.

- **Deterministic per-round branch** `feat/feedback-<short-id>-<trigger-msg-short>`,
  where `<trigger-msg-short>` is the first 8 chars of the id of the **triggering
  message** (the newest human reply newer than `shipped_at`). This is deterministic
  — a reaped redo recomputes the same branch and the STEP 3 idempotency check
  reconciles any PR the interrupted run already opened, unchanged — yet **distinct
  from the already-merged base branch** `feat/feedback-<short-id>`, so the base PR
  can never false-positive the "merged PR → mark shipped" short-circuit and skip the
  follow-up work. Each further round has a newer triggering message → a fresh branch,
  so multi-round back-and-forth stays clean.

- **Re-ship bumps `shipped_at`.** The green ship UPDATE sets `shipped_at=now()` and
  the new `ship_ref`, then posts a fresh review reply (step 5b). That pushes
  `shipped_at` past the triggering message, so query (d) no longer matches — unless
  the admin replied again meanwhile, which correctly starts the next round.

A continuation is otherwise a normal item: park it `needs_input` if the follow-up
needs a decision, hold it as a review-PR if it is sensitive/red, and count it toward
the batch cap and area-disjointness like any web item (its area is whatever files
the follow-up touches — usually the same subtree as the original, so two
continuations of the same feature serialise).

### Recognising a reaped continuation

After the reaper reopens a stranded continuation it is `status='open'` (not
`shipped`), so query (a) picks it up, not (d). It is still recognisable as a
continuation — and worked as one — by the same signal: **`shipped_at IS NOT NULL`
and a human message newer than `shipped_at`**. STEP 3's implementation therefore
checks that signal first: a continuation uses the continuation branch and does
**not** treat the already-merged base PR as "done"; a first-time `open` item
(`shipped_at IS NULL`) is unaffected.

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
     CI builds the desktop binary + register `desktop_releases` (`/devops-ship`
     does this end-to-end). Only once the deploy is done:
     `update admin_feedback set status='shipped', shipped_at=now(),
     ship_ref='<PR url>', processed_at=now(), processing_note=null where id=<id>`.
     **Then, step 5b — post the review reply** (see "Post-ship review & continue"):
     insert a `is_system=true` reply with the PR link, one line on what changed, the
     **live URL** for the area, and the invite to reply in-thread to continue. This
     runs on every ship, including a continuation re-ship and a mark-already-merged.
     If the rebase hits a real conflict (areas overlapped after all), don't force
     it — leave the item `open` for the next run (or hold it as a review-PR), and
     merge the remaining batch branches.
   - **Red, or a genuinely risky/irreversible call** (auth/RLS/secrets/payment, a
     destructive migration, data deletion) → don't auto-ship; the worker opens a
     PR for manual review and the item is left `status='in_progress'` with
     `ship_ref='<PR url>'` + a `processing_note`. `in_progress` is only ever valid
     **with** a `ship_ref` (a real review-hold) — never leave a bare `in_progress`
     (it jams the reaper + the oldest-first queue; see the reaper section).
6. Never touch rows in a terminal status — `issue_created` or `rejected`, and a
   `shipped` row **except** the one sanctioned re-entry: an admin reply after the
   ship reopens it as a continuation (query (d) / step 5b's invite). Never
   re-implement a `shipped` topic that has no fresh human reply.

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

## User-submitted feedback (viewers & collaborators) — feedback `5920cf8c`

Non-admins never see the admin panel, so until now they had no way to send
feedback at all. They now have their own FAB (`sc-user-feedback-fab` →
`sc-user-feedback-panel`, `src/app/feedback/`) that files a topic **on this very
board**: same table, same queue, same workflow — just `source = 'user'` and
attributed to that person, exactly as if the admin had posted it himself.

**Schema decision** (the admin never answered the question, so this is the
routine's own recommendation, applied deliberately): reuse `admin_feedback`
rather than add a parallel user-feedback table. One board, one status machine,
one search/queue/dashboard implementation. The non-admin half is carved out by
three additive columns (`source`, `triaged`, `decision_note`), a separate
message table and one restricted view.

### The privacy rule (hard, non-negotiable)

- **`admin_feedback_messages` is admins-only, always.** That is the admin ↔
  routine conversation. No policy in this feature grants a non-admin anything on
  it; its only SELECT policy is `public.is_admin()`.
- **Non-admins never read `admin_feedback` either.** They have an INSERT policy
  and nothing else. Their single read path is the security-definer view
  `public.my_feedback`, which projects only `id`, `body`, timestamps,
  `decision_note` and a **coarse** `author_status`, and hard-filters
  `author_id = auth.uid() and source = 'user'` inside its own body. So `status`,
  `processing_note`, `ship_ref`, `processed_at` never leave the admin side.
- **The author-visible channel is its own table**,
  `public.feedback_author_messages` — everything in it is readable by the topic's
  author by design. Splitting the two conversations by table (instead of by a
  flag inside one table) is what makes the rule structural rather than a matter
  of getting one policy predicate right.
- **The routine must therefore never write into `feedback_author_messages`.**
  Its voice is `admin_feedback_messages` (`is_system = true`). Anything an author
  should read is the admin's own message.

### What the author sees (coarse status)

| `author_status` in `my_feedback` | Raw statuses behind it | Label (DE/EN) |
|---|---|---|
| `in_progress` | `open`, `in_progress`, `needs_input`, `issue_created` | In Bearbeitung / In progress |
| `question` | `needs_input_author` | Rückfrage an dich / Question for you |
| `done` | `shipped` | Umgesetzt / Implemented |
| `declined` | `declined`, legacy `rejected` | Nicht umgesetzt / Not implemented (+ `decision_note`) |

`needs_input` folding into "in Bearbeitung" is deliberate and confirmed by the
admin: it means the routine is asking *the admin* — a conversation the author
must not even be able to detect. The client mirror of this mapping is
`coarseAuthorStatus()` in `src/app/feedback/user-feedback.types.ts`, unit-tested
in its spec.

### The two "needs input" flavours

| Status | Who asks whom | Where the question lives | Author sees it? | Routine queue |
|---|---|---|---|---|
| `needs_input` | routine → admin | `admin_feedback_messages` | **no** (reads as "in Bearbeitung") | resumed once the admin answers |
| `needs_input_author` | admin → topic author | `feedback_author_messages` (`is_question = true`) | **yes** | parked — not `open`, so out of the queue; the answer restores the previous status and re-arms the triage gate |

`needs_input_author` is maintained by a trigger on the author channel, never by
hand, and it works as a **parenthesis** rather than a reset:

- an admin question memorises the topic's current status in
  `status_before_author_question` and parks it at `needs_input_author` (only on a
  `source='user'` topic, never on a terminal one);
- the author's answer **restores** that status (default `open`) and clears the
  memo. That matters for the canonical case — the routine parks a user topic as
  `needs_input` ("what did the author mean?"), the admin passes the question on,
  and the answer must not throw the routine's own open question away;
- the answer also sets **`triaged = false`** again: it is fresh, unreviewed text
  from outside, and what waits behind `status='open'` is an agent that implements
  and merges on its own. So the admin releases it a second time. This is the only
  place a non-admin action touches `triaged`, and it can only ever move it towards
  *more* review.

The author may only write into the channel **while a question to them is open**
(`public.feedback_awaits_author()` gates the insert policy) — it is a channel for
answering, not an unsolicited chat with the admins. In the panel the status is its
own bucket, `awaiting_author` ("Rückfrage an Absender"), deliberately kept out of
the Abarbeiten queue: the ball is with the author, not the admin.

### Triage gate: `triaged`

A user topic enters `triaged = false`. **The routine must skip it** (queue read:
`status = 'open' and triaged`) until an admin presses "Für die Routine
freigeben". Rationale: an autonomous agent that implements and ships on its own
must not be drivable straight from a public feedback box by anyone with an
account. Every pre-existing (admin-authored) row defaults to `triaged = true`, so
the routine's behaviour on the existing board is unchanged.

The gate is enforced by the table, not by a client: a BEFORE-INSERT trigger forces
`triaged = false` on every `source='user'` row (a WITH CHECK alone would have made
any caller that omits the column fail with a bare permission error), pins the
insert's `created_at`/`updated_at` to `now()` (they drive the oldest-first queues,
so an unpinned `created_at` was a free "always first in line"), and rate-limits an
author to **10 topics per hour**. An author's answer re-opens the gate rather than
bypassing it (see above).

### What non-admins are granted, and why the grants are load-bearing

Supabase's default privileges grant **ALL** on everything new in `public` to
`anon` + `authenticated`. `public.my_feedback` is also *auto-updatable* and runs
with owner rights (`security_invoker = false`), so `grant select` on its own left
a write-through path around every RLS policy on `admin_feedback`: a signed-in
viewer could insert a topic that defaulted to `source='admin', triaged=true`
(landing **directly** in the routine's queue), rewrite a topic's body after the
admin had released it, or delete a topic and cascade the admin thread with it. The
migration therefore does an explicit `revoke all ... from public, anon,
authenticated` before every `grant`, on the view, on
`feedback_author_messages` and on both helper functions. **Keep that pattern for
anything new here** — it was a real, verified hole, not a theoretical one.

### One thing that is NOT secret: attachments

Screenshots go to the **public** `feedback-images` bucket (migration
`20260713000000`), shared by the admin composer and the author channel. Public
bucket objects are downloadable by URL and the bucket-wide read policy makes them
listable, so image attachments — including those in admin replies — are not
covered by the secrecy rule, which is about message *text*. Pre-existing, not
introduced by the user channel, and worth its own item.

### "Nicht umsetzen & löschen" (declining a user topic)

For a user-submitted topic the admin's delete button becomes **"Nicht umsetzen &
löschen"** with a **mandatory comment**. It writes `status = 'declined'` +
`decision_note` and also posts the comment into the author channel, so the author
gets "Nicht umgesetzt" **plus the reason** instead of a topic that silently
vanished. It is a soft close on purpose: a hard `DELETE` would cascade the
author's own thread away. Admin-authored topics keep the plain delete button, and
so does an **already archived** user topic — once it is declined/shipped and the
author has the outcome, an admin can still purge the row from the Archive.

**The routine never sets `declined`** — like `rejected` and `issue_created`, that
call belongs to the admin alone.

## The admin side: the feedback panel's three views

The routine's counterpart is the admins-only panel (`sc-feedback-fab` →
`sc-admin-feedback`, embedded in a FAB overlay reachable from every page). It
has one view switch at the top, available in the docked panel, the maximized
panel and on the full board page alike:

| View | Component | What it is for |
|------|-----------|----------------|
| **Übersicht** | `admin-feedback.component.ts` | the classic board — an Aktiv/Archiv tab pair (see "Active vs. Archive"), day-grouped topic list, fuzzy search (see below), status/author filters, new-topic composer |
| **Abarbeiten** | `feedback-workflow.component.ts` | guided one-at-a-time run through the queue: every Rückfrage still waiting on the admin first (oldest first), then untouched `open` topics. Shows topic + full thread + inline answer box, plus a "3 von 7" progress rail |
| **Fortschritt** | `feedback-dashboard.component.ts` | "Diesen Monat" and "All-time" side by side — donut (shipped share) + bars for shipped / ToDo / beantwortete Rückfragen |

**Abarbeiten is the default view** (feedback fda4e3ea). The panel opens in the
processing mode in all three shells — docked, maximized and full page — because
opening the board almost always means "what do I have to answer". The choice is
remembered per browser under `sc.adminFeedback.view` (behind the preferences
consent), so picking Übersicht or Fortschritt from the view switch still wins on
the next open; only the fallback changed. With an empty queue the mode shows its
"Alles abgearbeitet" screen, one click away from Fortschritt.

Two things the processing mode does so a Rückfrage never has to be hunted for:

- **It scrolls to the open Rückfrage.** The thread box opens at the message the
  admin is expected to react to — `workflowFocusIndex` in `feedback.types.ts`
  picks the *first* message of the trailing routine run (so a long question is
  read from its beginning, not its tail) and falls back to the thread end when
  the admin had the last word. That message is marked "Offene Rückfrage".
  Scrolling animates unless `prefers-reduced-motion: reduce` is set, and it
  happens once per message, so the board's polling refresh never yanks the
  thread back while it is being read.
- **The answer panel is pinned.** Composer and the Weiter/Erledigt controls sit
  in a sticky footer at the bottom edge of the scrollport, so however long the
  topic and its thread are, the reply box is always on screen.

Queue, aggregation and search rules live as pure functions in `feedback.types.ts`
(`buildWorkflowQueue`, `workflowFocusIndex`, `computeStats`, `isArchived`, `refKind`,
`feedbackBucket`, `searchFeedback`), unit-tested in `feedback.types.spec.ts`. All three views
share that vocabulary: a terminal topic is out of the processing queue, out of
the dashboard's ToDo bucket and in the overview's Archive tab, from the one
`isArchived` rule.

**Presentation buckets ≠ DB status.** What the panel shows is a topic's
*bucket* (`feedbackBucket`), not its raw status — the DB values are untouched:

| Bucket | Label (DE/EN) | Which rows |
|--------|---------------|------------|
| `todo` | **ToDo** | `status='open'` **and** a `needs_input` topic whose newest thread message is the admin's answer — the routine still has to pick it up, so it is ToDo, not "done" |
| `awaiting_admin` | Rückfrage / Needs input | `needs_input` whose newest message is the routine's (or none yet) — the ball is with the admin |
| `awaiting_author` | Rückfrage an Absender / Asked the sender | `needs_input_author` — the admin asked a user topic's author and waits on them |
| `in_progress` | In Arbeit / In progress | `status='in_progress'` |
| `shipped` / `issue_created` / `declined` / `rejected` | as before | terminal → Archive tab |

The status filter chips, the day-grouped list and the dashboard's ToDo counter
all resolve through that one rule. An answered Rückfrage keeps a small
"beantwortet" marker next to its ToDo pill (it records that the admin's part is
done) but is otherwise counted and filtered as ToDo. The "offen"/"Open" label
is gone from the UI — it reads **ToDo** everywhere (feedback 34c44134); the
status value on the wire is still `open`.

### Searching the board (feedback 12476cec)

The Übersicht carries a search field above the filter row (docked panel,
maximized panel and full board alike). It is dependency-free and lives in
`searchFeedback` / `scoreFeedbackRow` in `feedback.types.ts`:

- **What is searched** — the topic body, its `processing_note`, the author names
  **and every `admin_feedback_messages` reply**. A topic whose only match sits
  three replies down is a hit and is marked "im Thread" in its row.
- **How it matches** — text is normalized (lowercase, diacritics stripped, `ß` →
  `ss`, markdown punctuation dropped), then each term is matched per word:
  exact › prefix › infix › Damerau-Levenshtein typo (1 edit from 4 characters,
  2 from 7) › subsequence. Every term has to match *somewhere* (AND), so adding a
  word always narrows.
- **How results are ranked** — mean term quality × field weight (body `1.0` ›
  note `0.55` › thread `0.5` › author `0.35`), a density bonus for repeated hits,
  a bonus when the query appears verbatim, and topic recency as the tiebreaker.
- **How it interacts with the rest** — search narrows both tabs, the tab counts
  and the status chips. While a query is active the list is ordered by relevance,
  so the day headings collapse into one "N Treffer" heading; clearing the query
  restores the dated timeline.

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
| `status`         | `open` \| `in_progress` \| `shipped` \| `needs_input` (routine-driven) · `issue_created` = admin-driven hand-off to a GitHub issue · `declined` + `needs_input_author` = admin-driven, user topics only · `rejected` = legacy/admin-only, never set by the routine |
| `ship_ref`       | link that closed the topic: PR/commit URL for `shipped`, GitHub issue URL for `issue_created` (also set on a review-hold `in_progress` row) |
| `processing_note`| routine's note (reject reason / red-build hint) — **admin-only**, never shown to a feedback author |
| `shipped_at`     | set (and re-set) at each merge to `main`; the review loop's query (d) compares the newest reply against it to detect an admin's post-ship continuation |
| `processed_at`   | last time the routine acted on the row                     |
| `source`         | `admin` (default, all legacy rows) \| `user` = filed through the non-admin FAB (feedback `5920cf8c`) |
| `triaged`        | routine release gate; `true` for every admin row, `false` on a fresh user topic and again after its author answered, until an admin releases it |
| `decision_note`  | the admin's explanation on a `declined` user topic — **author-visible** (only while the topic is declined) |
| `status_before_author_question` | admin-only memo: the status a topic had when an admin asked its author something, restored by the answer |

### Active vs. Archive (`issue_created`)

Statuses split into two halves, which is exactly what the admin panel's
Active/Archive toggle inside the **overview** mode renders (migration
`20260724220000_admin_feedback_issue_created_status.sql`):

- **Active** — `open`, `in_progress`, `needs_input`, `needs_input_author`. The
  board the routine and the admin work on.
- **Archive** (terminal) — `shipped`, `issue_created`, `declined`, and legacy
  `rejected`. `issue_created`, `declined` and `rejected` are never picked up
  again. `shipped` is terminal **until the admin replies**: a reply on a shipped
  topic reopens it as a continuation (see "Post-ship review & continue"), and the
  routine flips it back to `in_progress` (Active) on its next run — so a shipped
  topic the admin is still iterating on does not rot in the Archive. Each row
  renders its `ship_ref` as a
  link, labelled "View change" for a shipped PR and "View issue" for an issue.
  (During an in-flight continuation `ship_ref` is briefly cleared; the shipping PR
  stays linked in the thread's review reply.)

`issue_created` is a **terminal, admin-set** status: the admin archives a topic
by pasting its GitHub issue URL in the panel (button "Issue created"), which
writes `status='issue_created'` + `ship_ref=<issue url>` + `processed_at=now()`.
Its purpose is the "tracked elsewhere, done here" case — the topic leaves the
active queue without being deleted and without pretending it shipped. **The
routine never sets `issue_created` and never touches a row that carries it** —
unlike `shipped`, which the post-ship review loop can reopen when the admin
replies. Legacy `rejected` rows are archived rather than hidden so they stay
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
regular admins). **Bypassing RLS is exactly why the routine must respect the
privacy rule by discipline:** it may read everything, but it writes its replies
only into `admin_feedback_messages` — never into the author-visible
`feedback_author_messages` (see "User-submitted feedback" above).

The author-visible channel for user-submitted topics lives in
`public.feedback_author_messages` (migration
`20260726120000_user_feedback_channel.sql`):

| column        | meaning                                                       |
|---------------|--------------------------------------------------------------|
| `feedback_id` | FK → `admin_feedback.id` (cascade delete)                    |
| `author_id`   | FK → `profiles.id`; who wrote the message                    |
| `from_admin`  | `true` = admin → author, `false` = the author's own reply (only while a question is open) |
| `is_question` | `true` only on an admin message that asks the author something → sets `status='needs_input_author'` |
| `body`        | markdown message (author-visible!)                           |
| `created_at`  | thread order                                                 |
