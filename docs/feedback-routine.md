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
> **"Gespräch wieder aufnehmen" now carries a message.** In the run it opens the
> same answer box every thread has; sending posts the steer *and* sets
> `status = 'open'`. So a reopened topic reaches the routine with the reason
> already in the thread — which is what the continuation path (query (d) / the
> `shipped_at` + newer-human-message rule) reads anyway. The write order is
> reply-then-reopen: a failed reply reopens nothing, a failed reopen has at least
> kept the admin's words.

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

  rejected      ← the ADMIN decides this alone (by deleting the topic); the
                  routine NEVER sets it. Reopened to `open` by an admin reply.
  issue_created ← the topic became a GitHub ISSUE instead of a change
                  (ship_ref = issue url). Set ONLY by the ROUTINE, when the
                  thread carries an open **[ISSUE]** order (see "Issue
                  erstellen" below). Goes through the sign-off gate like a
                  ship. Reopened to `open` by an admin reply.
  declined      ← the ADMIN declines a USER-submitted topic ("nicht umsetzen &
                  löschen", decision_note = the explanation the author reads);
                  the routine NEVER sets it. Reopened to `open` by an admin reply.
  needs_input_author
                ← the ADMIN asked the topic's AUTHOR something. Active but NOT
                  `open`, so it is parked out of the queue; the author's answer
                  flips it back to `open` (DB trigger). The routine NEVER sets it.
```

`issue_created`, `declined`, legacy `rejected` and `shipped` are all terminal
**at rest** but none of them is a dead end: **an admin reply in the thread
reopens any of them** (feedback: "archived topic answered → back to ToDo").
The two reopen paths differ only in mechanism:

- **`shipped`** reopens as a **continuation** (the post-ship review loop — see
  "Post-ship review & continue" below): its status stays `shipped` on the wire
  and the routine's query (d) claims it, because `shipped_at` must be preserved
  for re-ship detection.
- **`issue_created` / `declined` / legacy `rejected`** are reopened **directly to
  `open`** by a DB trigger the instant a human admin replies (migration
  `20260726180000_admin_feedback_reopen_on_reply.sql`), clearing `ship_ref` and
  `decision_note`. No routine query change is needed: the row is a plain `open`
  item and query (a) picks it up like any first-timer. The trigger fires only on
  a human reply (`is_system=false`); the routine's own system replies never
  reopen a topic.

Together the four form the panel's Archive tab (see "Active vs. Archive" below);
any of them flips back into the active half as soon as it is reopened. The
routine works the active half (`open` / `in_progress` / `needs_input`) plus these
shipped-with-a-fresh-reply continuations. `needs_input_author` is active too, but
it belongs to the admin and the author, never to the routine.

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

This replaces the old motion, where "Issue erstellt" was a *record*: the admin
filed the issue by hand and the same click archived the topic. The panel's
by-hand record ("Issue-Link eintragen") is gone as well (admin feedback
18e96ad3, round 2) — the order in the thread is the only issue motion left, and
the routine is the only writer of `issue_created` + `ship_ref`.

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
| **Data-uploader** (`data-uploader/`, Electron) | `cd data-uploader && npm ci && npm run typecheck && npm run build && npm test` (nested project — needs its own `npm ci`) | after merge, tag `data-uploader-v<ver>` → `data-uploader-build.yml` builds the binary → register the `desktop_releases` row (`/ship` extension rule 6 + `.claude/deep-knowledge/data-uploader-release.md`) |
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

**How to apply:** before merging any PR that carries a migration, check the
prefix against current `origin/main` — `ls supabase/migrations | grep <prefix>` —
and rename on collision (also fix the filename echoed in the file's own header
comment and in any docs referencing it). After each `db push`, **read which files
it names**: silence about a file you expected is the symptom. A related but
*loud* failure is an out-of-order version (older than the newest applied one):
`db push` refuses it and demands `--include-all`.

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

**Edit-hook hazard — `cd` the shell into the worktree before the first edit.**
The devops `pre.edit.branch.js` guard resolves "the current branch" from the
**persisted Bash shell cwd**, not from the path of the file being edited (the
Edit/Write tools carry no cwd). A worktree file on a feature branch plus a shell
still parked in the primary checkout (which sits on `main`) is therefore blocked
as "editing main" — a false positive that cost three blocks on 2026-07-24. Run
one `cd "<worktree path>"` before the first Edit/Write of a thread, and `cd` back
in only for deliberate `git worktree` administration.

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

## Liveness heartbeat (STEP 0.5 — the very first thing every cycle)

The routine runs on **Jerry's PC**, not in the cloud. When the machine is off,
Claude isn't running, or the usage limit is reached, the routine simply doesn't
fire — and says nothing. From the board that is indistinguishable from "the
queue is empty and everything is fine": an admin files a topic, sees it sitting
at `open`, and has no way to tell whether it is queued at a working machine or
at a dark one. Feedback `a7573f0e` asked for exactly that missing bit — "zeig
mir an, ob der PC erreichbar ist" — and pointed at the obvious source: the
routine already polls this board every ~20 minutes, so **the poll itself is the
proof of life**. It only ever needed somewhere to leave a mark.

**Every cycle, as its FIRST action** — before STEP 1.5's reaper, before STEP 1's
queue read, and above all before any "queue empty → stop" exit — the routine
stamps `public.routine_heartbeat` (migration
`20260730173500_routine_heartbeat.sql`):

```sql
insert into public.routine_heartbeat (id, last_seen_at, note, updated_at)
values ('admin-feedback-routine', now(), '<short note>', now())
on conflict (id) do update
  set last_seen_at = now(), note = excluded.note, updated_at = now();
```

The ordering is the whole point. A cycle that finds nothing to do is still a
cycle that *ran*, and it is by far the most common kind — stamping after the
queue read (or after the reaper) would leave the title red through every quiet
stretch and train the admin to ignore it. `<short note>` is a one-liner for the
tooltip ("queue empty", "3 items claimed"); it is rendered verbatim to admins,
so nothing private goes in it.

### What the admin sees

**The panel's own title carries it — nothing else appears on screen.**
`src/app/admin/feedback/routine-status.directive.ts` (fed by
`routine-heartbeat.service.ts`) tints whichever element already says
"Feedback": the FAB panel head when docked or maximized, the `<h1>` on the full
board page. The tint rules are global (`src/styles.scss`, "ROUTINE LIVENESS
TINT") because the same signal has to reach all of those.

| `now() - last_seen_at` | title | tooltip / screen reader |
|---|---|---|
| < 45 min | green | "Dev-PC erreichbar — … hat sich vor 5 Minuten gemeldet." |
| ≥ 45 min | red | "Dev-PC nicht erreichbar — zuletzt vor 3 Stunden …" |
| no row / query error | untinted | "Status unbekannt — bisher keine Rückmeldung." |

The first cut of this was a line of its own — a dot plus the words "Dev-PC
erreichbar" above the view switch — and the admin sent it back: *"Es soll nicht
stehen 'Dev PC erreichbar' sondern nur der Titel oben 'Feedback' soll grün oder
Rot markiert sein, also nichts stark Offensichtliches sondern was dezentes aber
bemerkbares"*. A liveness light is glanced at, not read; it earns no real estate
of its own.

**The title is the word and nothing else.** The round after that one kept the
wording as a visually hidden `<span>` inside the heading — and it showed up on
screen as a prefix: *"Der Feedback Name ist aktuell (DEV-PC Erreichbar)Feedback
— Sollte aber NUR 'Feedback' heißen, und das dann Rot oder Grün entsprechend
einfärben"*. So the directive now injects **no DOM text at all**; a clip-rect
span is only invisible while every stylesheet that could reach it behaves, and
this one is a heading the admin looks at every day.

**Colour is still never the only carrier.** The state rides on `aria-label`
(`"Feedback — Dev-PC nicht erreichbar"`, composed from the title's own i18n key
that `scRoutineStatus="…"` carries) plus the `title` attribute naming the last
check-in on hover. Both are read by assistive tech and neither can leak into the
layout, whatever CSS does or fails to load.

**45 minutes, against a 20-minute cadence, is deliberate:** it tolerates ~2
missed cycles. A tighter window (say 25 min) would flip red every time a cycle
merely started late or ran long, and a status light that lies is worse than no
status light. A much wider one would hide a genuinely dead routine for most of
an hour.

**Grey is a real third state, not an error bucket.** A missing row, an expired
session, or a failed request says nothing whatsoever about the dev PC, and
painting that red would be a claim the admin then has to go and disprove.

**A usage-limit abort turns the title red on its own** — which is the property
the feedback predicted ("denke das System wird damit automatisch auch erkennen
wenn die Tokens verbraucht sind"). There is no token check anywhere: a run that
dies on a usage limit, or never starts because Claude is closed, simply never
reaches STEP 0.5, so `last_seen_at` stops advancing and ages past the window by
itself. The same is true for a powered-off PC, a crashed run, and a disabled
scheduled task. That is why the stamp must be **unconditional** — never guarded
by "did we do any work" — and why it must not be moved later in the cycle.

### Who may write it

`public.routine_heartbeat` has RLS on, a SELECT policy gated on
`public.is_admin()`, and **no insert/update/delete policy at all**. With RLS
enabled and no write policy, every API write is refused, while the service role
(which bypasses RLS) keeps stamping — that asymmetry is the security model.
The routine writes it through the Supabase MCP / service role like every other
STEP; the web app only ever reads. Do not add a write policy, and do not widen
the read to `anon`/`authenticated`: whether the dev machine is up is admin
business, and the table exists to answer that one question.

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
  implementing/building — 30 min is meant to exceed a normal single-item cycle
  while the ~20-min cadence keeps resumption prompt.

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

- The **30-minute `processed_at` guard means a gap.** A run at T+20 min skips
  the stranded item (still inside the window); only a run at ≥ T+30 min reopens
  it. So an item aborted by the usage limit can visibly sit `in_progress` for up
  to ~1.5 cadence cycles before it is picked up again. That delay is intended
  (it protects a legitimately overlapping in-flight run) — it is not a bug, but
  it does mean "stuck for half an hour" is expected, not lost.
- **Resumption re-enters at the item level — but it is *not* automatically a
  from-scratch rebuild.** The reaper reopens the row to `open` and the next run
  re-enters the per-item procedure; what it must *not* do is assume the previous
  attempt left nothing behind. See the next section.

### A reaped item usually still has recoverable work

The reaper reasons only about DB state (`ship_ref IS NULL`), which cannot see a
pushed branch, a CI verdict, or a dirty worktree — and every run works in a
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

### A hold decays — verify its state, don't just age it

Reporting "PR link + age" makes a claim about the hold's **existence**, not about
its **executability**. Those come apart: `main` keeps moving while the hold
stands still, and a hold can stop being mergeable — or stop being *deployable* —
without anything in `admin_feedback` changing. The age number cannot show that,
so a report built only from the SQL above reads as "still fine, just old" on
exactly the cycle where it has become "no longer works".

**PR #314 (feedback `40d2f925`), 2026-08-02.** Parked on 2026-07-30 as
"berührt auth/RLS + enthält eine noch nicht gepushte Migration". Correctly not
auto-merged — that call is the admin's. But over the 2.6 days it stood, two newer
migrations landed in `main` (`20260730173500_routine_heartbeat.sql`,
`20260731183000_profile_preferred_region.sql`), which made the hold's own
`20260730120000_protected_admins.sql` **out of order**: `db push` refuses a
version older than the newest applied one and demands `--include-all`. Merging it
would not have deployed it. Every cycle in between had dutifully reported "offen
seit X"; none had reported that it no longer runs.

**Every cycle, for each open hold, verify these three and report what you found**
— not just the row:

| Check | How | On decay |
|---|---|---|
| Mergeable + CI | `gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup` | `UNKNOWN` means GitHub has not computed it yet — re-poll, never report `UNKNOWN` as if it were a verdict |
| Behind `main` | `git rev-list --count origin/<branch>..origin/main` | bring it up via `gh pr update-branch` (merge-in, **never** force-push) |
| Migration order | the hold's `supabase/migrations/` prefixes vs. the newest in `origin/main` | renumber to a current prefix — and fix the filename echoed in the file's own header comment and in any docs referencing it |

**Repair the mechanical decay; leave the decision alone.** The human call is
*whether to merge* (auth / RLS / secrets / payment, destructive migration, data
deletion) — nothing else about the hold is a decision. Keeping its branch
rebased and its migration applicable is maintenance, and doing it means the
admin's "ja, merge" is executable the moment he says it instead of starting a
fresh debugging round. Still **never** merge a hold, and never `db push` a held
migration: both are the thing being held.

**Past ~24 h, escalate into the thread, not just into the run report.** The run
report is a channel the admin does not routinely read; the board is the one he
looks at. So post a `is_system=true` reply on the hold's own topic naming the PR,
why it is held, the verified state, and the single question he has to answer:

```sql
insert into public.admin_feedback_messages (feedback_id, is_system, body)
values ('<id>', true, '<PR + why held + verified state + the one decision>');
```

Post it only when the verified state has **changed** since the last system reply
in that thread (or when there is none yet) — that converges, so a hold nudges on
real news instead of once per cadence tick. Do **not** flip the row to
`needs_input` to make it visible: that drops the `ship_ref` and turns a real
review-hold into a bare claim the reaper will then reopen.

### A human reply to a hold is an ANSWER — and no queue read could see it

The decay rule above assumes the only thing that happens to a hold is that time
passes. Something far more important can happen: **the admin replies in the
thread.** He has just answered the question the hold was parked for — and until
2026-08-02 nothing in this routine looked at that.

Trace the four queue reads against a held row (`in_progress`, `ship_ref` set):

- **(a)** reads `open` — a hold is not `open`.
- **(b)** reads `needs_input` whose newest message is human — a hold is not
  `needs_input`.
- **(d)** reads `shipped` whose newest message is human — a hold is not `shipped`.
- **(c)** reads holds — but selects only `id, ship_ref, processing_note,
  processed_at`. It never reads the thread, so a reply on a hold is invisible
  to it by construction.

`in_progress` + a human reply was therefore a **black hole**: the one status
where an admin answer produced no effect whatsoever. And it is the status the
routine *itself* chose for exactly the topics where it most wanted an answer.

**Feedback `40d2f925` / PR #314 is the case.** Parked 2026-07-30 17:20 as
"sensitive — auth/RLS". At **19:28 the same day** the admin replied with a
concrete steer: no user may self-promote to admin, a downgrade must go through
an e-mail confirmation, and only admins may appoint admins. That reply sat
unread for three days while every cycle reported the row as "review-hold, offen
seit X" — technically true and completely beside the point. What looked from the
board like a routine that had stopped working was a routine that could not see
the answer.

**The fix is a fifth queue read, (e), run with the others:**

```sql
-- (e) answered review-hold: in_progress topics whose newest message is human
select f.id, f.ship_ref, f.body, m.created_at as answered_at
from public.admin_feedback f
join lateral (
  select is_system, created_at from public.admin_feedback_messages m
  where m.feedback_id = f.id order by m.created_at desc limit 1
) m on true
where f.status = 'in_progress' and m.is_system = false
order by m.created_at asc;
```

Treat an (e) hit as **actionable work, ranked by the reply's age, not the row's**
— the admin has been waiting since he wrote it. Claim it exactly like a (d)
continuation, with `ship_ref` **cleared**:

```sql
update public.admin_feedback set status='in_progress', ship_ref=null, processed_at=now()
where id='<id>' and status='in_progress' and ship_ref is not null returning id;
```

Clearing `ship_ref` is the same load-bearing move as in a continuation: while the
routine owns the topic again it must look like an ordinary claim, so an
interrupted run leaves a bare `in_progress` the reaper heals instead of a fake
hold that strands forever. The PR link is not lost — it is in the thread's own
hold reply. Then read the **full thread**, implement the steer **on the existing
PR branch** (the work is already there; do not start a second PR), re-verify, and
finish normally: ship if the steer resolved what made it sensitive, or re-hold
with a fresh `ship_ref` and a reply saying what is still open.

The general shape, worth remembering beyond this one query: **every status the
routine can park a topic in needs a path back out that a human reply triggers.**
`needs_input` had (b), `shipped` had (d), the archived statuses had the reopen
trigger — `in_progress` had nothing, and that is precisely where the routine
parks the topics it most wants an answer on.

## Loose-ends sweep — the same duty for work that isn't in the DB

The review-hold rule above closes the gap for one *row status*. But the routine
leaves a second class of unfinished work behind that **no query sees at all**,
because it lives in git and in the release rings rather than in
`admin_feedback`: a branch that was committed but never pushed, a pushed branch
that never got a PR, a worktree nobody will return to, an alpha version that was
never promoted. Every one of these is invisible to the reaper (it only reads
`admin_feedback`) and to the queue reads — so it rots exactly like PR #167 did,
and for the same reason: nothing ever looks at it again.

This is the *normal* residue of a usage-limit abort. The DB half self-heals (the
reaper reopens the claim, the redo is idempotent), but the git half does not: the
aborted run's commits sit in its worktree, unpushed and unmentioned, and the redo
starts a fresh branch beside them. Observed 2026-07-27: 14 commits of Codex-
Showroom work sat unpushed on `claude/3d-models-skins-codex-4b98b2` while the
routine reported a clean "No open feedback." — the SessionStart hook *had* flagged
"13 unpushed commits", but its only prescribed reaction is an `AskUserQuestion`,
which a non-interactive scheduled run cannot answer, so the finding evaporated.

**Every cycle, after the review-holds read, run the sweep and report what it
finds — even when the queue is empty.** Report-only: the routine gains a
*visibility* duty here, not cleanup or release authority (see "What the sweep
must not do").

| # | Check | Command |
|---|-------|---------|
| 1 | **Unpushed commits** — local work on no remote | `for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do n=$(git rev-list --count "$b" --not --remotes); [ "$n" -gt 0 ] && echo "$b: $n"; done` |
| 2 | **Pushed, no PR, not in main** — an orphan branch | `gh pr list --state all --limit 200 --json headRefName --jq '.[].headRefName' \| sort -u` vs. `git for-each-ref --format='%(refname:short)' refs/remotes/origin`, minus branches already an ancestor of `origin/main` (`git merge-base --is-ancestor origin/<b> origin/main`) |
| 3 | **Stale worktrees / stashes** — abandoned workbenches | `git worktree list` (branch merged or gone?) · `git stash list` |
| 4 | **Pending promote** — alpha ahead of beta/stable | desktop: the join below · web: newest `alpha/v*` tag vs. newest `stable/v*` / `beta/v*` tag |

```sql
-- pending promotes, desktop products (alpha ahead of beta/stable = a promote nobody ran)
select c.product, c.channel, r.version, c.updated_at
from public.desktop_channels c
join public.desktop_releases r on r.id = c.release_id
order by c.product, case c.channel when 'alpha' then 1 when 'beta' then 2 else 3 end;
```

Keep it cheap and quiet: all four are read-only, and each line appears in the
report **only when it finds something** — a clean sweep adds nothing to the
report. Cap each finding at ~5 entries with a "+N more" tail so a long-lived
branch graveyard can't drown the actual feedback report.

### What the sweep must not do

Its findings are almost all *someone else's* in-flight work — another session's
worktree, a WIP branch, a deliberate release decision. So:

- **Never promote.** `alpha → beta → stable` is a user decision by construction
  (`/promote`, same SHA, no rebuild); the sweep only reports the lag.
- **Never delete** a branch, worktree or stash. Branch hygiene is
  `/setup-cleanup`, user-triggered, with its own dry-run confirm.
- **Never open a PR** for a branch the routine doesn't own — an unpushed WIP
  branch may be mid-thought in a live session.
- **Do push what the routine itself owns.** A `feat/feedback-*` branch with
  unpushed commits is the routine's own work and STEP 3e already requires it to
  be pushed before the merge phase; the sweep is that rule's safety net, not an
  exception to it.

The asymmetry is deliberate: reporting a loose end costs one line, while acting
on another session's work can destroy it.

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
     CI builds the desktop binary + register `desktop_releases` (`/ship`
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
6. Never touch rows in a terminal status directly. The only way a terminal topic
   returns to the routine is by being **reopened first**, always by an admin
   reply: `issue_created` / `declined` / `rejected` are flipped straight to `open`
   by the reopen trigger (then query (a) sees a plain `open` item), and `shipped`
   reopens as a continuation (query (d) / step 5b's invite). Never re-implement a
   still-terminal topic — a `shipped` topic with no fresh human reply, or an
   archived topic nobody replied to.

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

How they *render* (feedback a660536a): `renderFeedbackBody()` lifts every
`![alt](src)` **out** of the markdown and returns it separately, so a body's HTML
never contains an `<img>`. `sc-feedback-attachments` puts those images at the end
of the message as a wrapping row of ~72 px thumbnails — chat-attachment style —
and clicking one opens it full size in a CDK overlay (ESC / backdrop to close).
The board, the workflow view and the author-facing panel all go through that one
path; a new surface that renders a feedback body should too.

The composer joins them (feedback 99723afc): its pending-image strip is the same
`sc-feedback-attachments` row with `removable` set, so the 72 px chip is defined
in exactly one place and an image looks identical from the moment it is pasted to
every later re-read of the thread. The row keeps the composer's own aria-label
via `labelKey`, and the enlarged view pages through a message's screenshots with
‹ › or the arrow keys instead of closing and reopening per image.

### "Nicht umsetzen & löschen" (declining a user topic)

For a user-submitted topic the admin's delete button (behind the card's "Weitere
Aktionen" disclosure since feedback 03d7e546) becomes **"Nicht umsetzen &
löschen"** with a **mandatory comment**. It writes `status = 'declined'` +
`decision_note` and also posts the comment into the author channel, so the author
gets "Nicht umgesetzt" **plus the reason** instead of a topic that silently
vanished. It is a soft close on purpose: a hard `DELETE` would cascade the
author's own thread away. Admin-authored topics keep the plain delete button, and
so does an **already archived** user topic — once it is declined/shipped and the
author has the outcome, an admin can still purge the row from the Archive.

The comment box is preceded by a row of **canned-reason chips** (feedback
d5a779da): Duplikat, Schon umgesetzt, Nicht reproduzierbar, Zu wenig Info, Passt
nicht zur Richtung, Kein verwertbares Feedback. A chip **pre-fills** the
textarea, it does not replace it — the note stays free text, and the chip lights
only for as long as the text still *is* that reason, so editing the sentence
quietly drops the selection. Both the labels and the sentences are ordinary i18n
keys (`adminFeedback.decline.reasons.*`), worded for the person who filed the
topic, because that is who reads them.

**The routine never sets `declined`** — like `rejected` and `issue_created`, that
call belongs to the admin alone.

## The admin side: the feedback panel's three views

The routine's counterpart is the admins-only panel (`sc-feedback-fab` →
`sc-admin-feedback`, embedded in a FAB overlay reachable from every page). It
has one view switch at the top, available in the docked panel, the maximized
panel and on the full board page alike:

| View | Component | What it is for |
|------|-----------|----------------|
| **Übersicht** | `admin-feedback.component.ts` | the classic board — an Aktiv/Archiv tab pair (see "Active vs. Archive"), day-grouped topic list with each topic's stable `#N` (see below), fuzzy search (see below), status/author filters, new-topic composer. Every topic is a **collapsible card** with at most two composers and one "Weitere Aktionen" disclosure (see below) |
| **Abarbeiten** | `feedback-workflow.component.ts` | guided one-at-a-time run through everything that waits on the admin — Rückfragen (oldest first) and, since feedback d4990269, the Abnahmen behind them — **and nothing else** (feedback b0cc6efc). Shows topic + thread + either the inline answer box or the Abnahme's two decisions, plus a "3 von 7" progress rail, "Überspringen", and two lenses: **wessen** (mine/others/all) and **welche Art** (Alle / Rückfragen / Abnahmen — the ex-Abnahme tab). The thread is folded to the message the run points at, with one "…" for the history |
| **Fortschritt** | `feedback-dashboard.component.ts` | "Diesen Monat" and "All-time" side by side — donut (shipped share) + bars for shipped / ToDo / beantwortete Rückfragen, plus pace, throughput and the live lifecycle map (see below) |

**Abarbeiten is the default view** (feedback fda4e3ea). The panel opens in the
processing mode in all three shells — docked, maximized and full page — because
opening the board almost always means "what do I have to answer". The choice is
remembered per browser under `sc.adminFeedback.view` (behind the preferences
consent), so picking Übersicht or Fortschritt from the view switch still wins on
the next open; only the fallback changed. With an empty queue the mode shows its
"Alles abgearbeitet" screen, one click away from Fortschritt.

**The queue holds only what waits on the admin** (feedback b0cc6efc). It used to
append untouched `open` ToDos after the Rückfragen, which made the mode read as a
backlog to work off — but an `open` topic is one the admin already wrote and that
now waits on the *routine*; there is nothing to answer there. A topic enters the
queue the moment the routine asks something back (`needs_input` with the routine's
message last = the `awaiting_admin` bucket) and leaves it the moment the admin
answers. ToDos stay fully visible in the Übersicht list and in the dashboard's
ToDo counter — the processing mode is the admin's *inbox*, not the board.

Three things the processing mode does so a Rückfrage never has to be hunted for
and no step goes unnoticed:

- **It scrolls to the open Rückfrage.** The thread box opens at the message the
  admin is expected to react to — `workflowFocusIndex` in `feedback.types.ts`
  picks the *first* message of the trailing routine run (so a long question is
  read from its beginning, not its tail) and falls back to the thread end when
  the admin had the last word. That message is marked "Offene Rückfrage".
  Scrolling animates unless `prefers-reduced-motion: reduce` is set, and it
  happens once per message, so the board's polling refresh never yanks the
  thread back while it is being read.
- **The answer panel is pinned.** Composer and the Überspringen/Erledigt controls
  sit in a sticky footer at the bottom edge of the scrollport, so however long the
  topic and its thread are, the reply box is always on screen.
- **Moving on is visible** (feedback 96872872). "Erledigt" pulls the topic out
  of the queue, so the card refills with the next topic in place — previously
  only the "3 von 7" counter moved and the admin could miss that a new topic was
  open. The next card now slides in (~380 ms), wears a short accent ring and a
  `role="status"` line names the step ("Erledigt – weiter mit 2 von 6"). Under
  `prefers-reduced-motion: reduce` the slide is dropped; ring and line stay, so
  the advance is still perceivable. Überspringen uses the same slide (without the
  line — the click itself is the explanation), and so does an Abnahme decision
  once the write came back and the topic left the queue. Draining the last topic
  reports itself through the "Alles abgearbeitet" screen instead.

### One topic card in the Übersicht (feedback 03d7e546)

Reviewing a topic on the board had grown into a wall: two thread lists at full
length, two composers, a per-message "mehr" clamp, the sign-off gate and a
permanent row of "Issue erstellt / freigeben / nicht umsetzen / löschen" buttons
under every card — and on the **full board page** the card could not even be
folded, because only the docked panel rendered a clickable head. The card is now
the same control in both shells:

- **The head is a button, everywhere.** Chevron · `#N` · generated title ·
  author · date (full board only — the panel's day heading carries it) · status
  pills. The panel keeps topics **collapsed** by default, the full board keeps
  them **open**; the component stores only the deviation from that default
  (`_flipped`), and "alle aus-/einklappen" exists in both shells. The
  two-sentence body clamp is gone with it: a card that folds does not need a
  second fold inside itself.
- **Both threads are folded to their two ends.** `foldThread` in
  `feedback.types.ts` returns `{ lead, hidden, tail }` — the conversation's
  first message, everything between it behind one "…" that names its count, and
  the newest message, which is what the admin has to react to. One rule, used by
  the admin ↔ routine thread *and* the author channel; the Abarbeiten run folds
  the same way (anchored at its focus index instead of at the thread start).
  Unfolding is per thread and session-local.
- **One question affordance per thread.** The admin ↔ routine thread has exactly
  one composer, the author channel exactly one — plus its single "als Rückfrage
  senden" switch, which is now **per topic** (it used to be one board-wide flag,
  so ticking it on one card armed every other open card's composer).
- **The rare acts sit behind one disclosure.** "Weitere Aktionen" reveals
  "Issue erstellen" (the order, with its undo), "nicht umsetzen & löschen" /
  "löschen" and their inline forms; closing it discards a half-typed form rather
  than leaving it open out of sight. `declined`, the triage release and the
  sign-off gate's two decisions all live one click deeper. `issue_created` is
  **not** among them: the panel has no by-hand write for it since admin feedback
  18e96ad3 — the routine sets it when it carries out an `**[ISSUE]**` order.
  The one action that stays in the open is "Für die Routine freigeben"
  on an untriaged topic: the topic is *blocked* on it, so hiding it would hide
  the reason nothing is happening.

### The run is a carousel with skip (feedback d4990269)

Two kinds of step share the queue, in a fixed order rather than interleaved by
date: **Rückfragen first** (they block the routine's next run), **Abnahmen after
them** (they close a topic out), each oldest-first inside its kind. An Abnahme
step is aged and dated by `reviewSince` (`shipped_at ?? processed_at ??
updated_at`) — the moment its outcome landed, which is how long it has actually
been waiting — while a Rückfrage keeps its `created_at`. Both live in
`buildWorkflowQueue`; a queue entry now carries a `kind` (`'question' |
'review'`) that decides the card's badge, the controls at its foot and the kind
lens. The rows and the `awaitsReview` rule behind them are unchanged; the two
decisions are still "Ins Archiv — erledigt" (→ `reviewed_at`) and "Gespräch
wieder aufnehmen" (→ `status='open'`).

Round 2 of the same feedback changed *how* the second one is taken and what the
card shows around it:

- **Reopening is an answer.** The button opens the run's composer instead of
  writing on the spot; the two decisions step aside while it is open, and sending
  posts the reply and reopens the topic in one handler
  (`workflowReopenBound` → `sendReply` → `reopenFromReview`). Backing out writes
  nothing. The draft has its own scope (`admin:workflow-reopen:<id>`), so a
  half-written steer can never surface in the Rückfrage box.
- **The thread is folded.** Only the message the run points at
  (`workflowFocusIndex`) and everything after it is on screen; the history sits
  behind one "…" that says how many messages it hides. The card already shows the
  topic's first post, so "erster Post → … → letzter Post" falls out of it — and
  because the fold is anchored to the focus index, the open Rückfrage is never
  the thing being hidden. Unfolding is per card and session-local; the next card
  starts folded again.
- **"Thema öffnen" is gone**, together with the Abnahme tab it belonged to: the
  card shows the whole topic, so there is nothing left to jump to.

**Überspringen** parks the current topic for this lap and steps to the next one
the lap has not shown yet. When nothing unseen is left, the lap closes and the
run comes back around to the parked topics (plus whatever arrived meanwhile),
announced by a `role="status"` line; the card that comes back wears an
"Übersprungen" badge, and a counter next to the progress rail says how many are
still owed a second look. Skipping is **session-local and never written**: no
column, no status value, no localStorage — exactly like the "Erledigt" tick-off,
it is a view-level "not now". A lap resets when either lens changes, and a
topic that gets answered, ticked off or decided is dropped from it, so the
carousel never promises to come back to something that is already gone.

Queue, aggregation and search rules live as pure functions in `feedback.types.ts`
(`buildWorkflowQueue`, `workflowFocusIndex`, `reviewSince`, `computeStats`, `computePace`,
`shippedPerWeek`, `lifecycleSnapshot`, `neededInput`, `isArchived`, `refKind`,
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

### What the Fortschritt view shows (feedback ef15ea67)

The dashboard is **read-only and always-on by design — no filters, pickers or
toggles**: the admin asked for a view that is informative the second it opens.
The "Diesen Monat / All-time" pair is a side-by-side layout, not a control. Three
blocks, all hand-rolled SVG/CSS on the existing tokens (no charting dependency):

1. **Windows** — the donut (shipped share) + the shipped / ToDo / answered bars,
   now with a **pace** footer per window: the **median time-to-ship**
   (`created_at → shipped_at`, measured only on rows that carry a real ship
   stamp) and the **Rückfrage rate** (share of topics raised in the window the
   routine had to ask about). Volume alone never showed whether the routine is
   getting faster or asking more; these two do.
2. **Durchsatz** — ships per calendar week over the last 12 weeks, the running
   week highlighted. A stalled or accelerating routine is a trend, not a number.
   A continuation counts once, in the week of its latest ship (`shipped_at` is
   bumped at each re-ship).
3. **Lebenszyklus** — this document's "Contract" diagram rendered **live**. The
   spine is the happy path (ToDo → In Arbeit → Geshipped); every branch is
   labelled with what triggers it: the routine's Rückfrage and the admin's answer
   back into ToDo, the reaper reopening a stale claim (`in_progress → open`), the
   review hold (`in_progress` **with** a `ship_ref`, waiting on a human merge),
   the post-ship continuation loop back into In Arbeit, and the terminal
   `issue_created` / legacy `rejected` stages. Each node carries its **current**
   occupancy plus the annotations that matter operationally — oldest active topic
   in days, how many ToDo items are answered Rückfragen / continuations /
   reaper-reopened, and how many `in_progress` rows are review holds rather than
   active work (the holds that this doc's "Surfacing open review-holds" section
   warns can rot unnoticed).

There is **no transition history** in the schema, so the map annotates occupancy,
never pass-through counts — `lifecycleSnapshot` derives everything from the rows
and threads the board already holds. The map is a plain `<ol>`/`<ul>`, so it
reads as text for assistive tech (dots, spine and meters are `aria-hidden`), and
it is a vertical spine rather than a horizontal flow chart precisely so it never
scrolls sideways in the docked panel.

### Referring to a topic by number (feedback 21587480)

Every topic carries a **stable sequential number**, shown as a quiet `#42` ahead
of the title in the Übersicht rows (both layouts) and in the Abarbeiten card. It
exists so a topic can be *named* in a conversation — "das aus #42" — instead of
being quoted or identified by its uuid.

It is a DB column, `admin_feedback.seq`, fed by the sequence
`admin_feedback_seq_seq` (migration
`20260726230000_admin_feedback_seq.sql`), **not** a position in the rendered
list. That distinction is the whole feature: the board is filtered by
author/status, re-ordered by relevance while searching, split into Aktiv/Archiv
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

The Übersicht carries a search field above the filter row (docked panel,
maximized panel and full board alike). It is dependency-free and lives in
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
- **Report loose ends every cycle, queue empty or not** — open review-holds
  ("Surfacing open review-holds") *and* the git/release residue that no query
  sees ("Loose-ends sweep"). Report-only: never promote, never delete a branch /
  worktree / stash, never PR a branch the routine doesn't own.
- **Overlapping runs are expected** — the task fires every ~20 min and a run can
  outlast that. The atomic per-item claim stops two runs taking the *same* item,
  but it does **not** prevent shared-checkout corruption: every thread works in
  its own isolated worktree (see "Concurrency: isolated worktrees + up to 3
  parallel disjoint-area threads").

## Data model reference

`public.admin_feedback` (see migration `20260707190000_admin_feedback.sql`):

| column           | meaning                                                    |
|------------------|------------------------------------------------------------|
| `seq`            | the topic's **stable reference number** ("#42"), from sequence `admin_feedback_seq_seq` — see "Referring to a topic by number" (feedback `21587480`) |
| `status`         | `open` \| `in_progress` \| `shipped` \| `needs_input` (routine-driven) · `issue_created` = hand-off to a GitHub issue, written by the routine on an open `**[ISSUE]**` order or by an admin recording an existing issue · `declined` + `needs_input_author` = admin-driven, user topics only · `rejected` = legacy/admin-only, never set by the routine |
| `ship_ref`       | link that closed the topic: PR/commit URL for `shipped`, GitHub issue URL for `issue_created` (also set on a review-hold `in_progress` row) |
| `processing_note`| routine's note (reject reason / red-build hint) — **admin-only**, never shown to a feedback author |
| `shipped_at`     | set (and re-set) at each merge to `main`; the review loop's query (d) compares the newest reply against it to detect an admin's post-ship continuation |
| `processed_at`   | last time the routine acted on the row                     |
| `source`         | `admin` (default, all legacy rows) \| `user` = filed through the non-admin FAB (feedback `5920cf8c`) |
| `triaged`        | routine release gate; `true` for every admin row, `false` on a fresh user topic and again after its author answered, until an admin releases it |
| `decision_note`  | the admin's explanation on a `declined` user topic — **author-visible** (only while the topic is declined) |
| `status_before_author_question` | admin-only memo: the status a topic had when an admin asked its author something, restored by the answer |

`public.routine_heartbeat` (see migration `20260730173500_routine_heartbeat.sql`)
— one row per routine, overwritten in place; see "Liveness heartbeat" above:

| column         | meaning                                                    |
|----------------|------------------------------------------------------------|
| `id`           | routine key, `admin-feedback-routine` for this routine      |
| `last_seen_at` | start of the most recent cycle — the whole signal           |
| `note`         | short one-liner shown in the admin tooltip; never secrets    |
| `updated_at`   | bookkeeping, same instant as `last_seen_at` in practice      |

### Active vs. Archive (`issue_created`)

Statuses split into two halves, which is exactly what the admin panel's
Active/Archive toggle inside the **overview** mode renders (migration
`20260724220000_admin_feedback_issue_created_status.sql`):

- **Active** — `open`, `in_progress`, `needs_input`, `needs_input_author`. The
  board the routine and the admin work on.
- **Archive** (terminal at rest) — `shipped`, `issue_created`, `declined`, and
  legacy `rejected`. **All four reopen on an admin reply**, so none rots in the
  Archive once the admin picks the conversation back up:
  - `shipped` reopens as a continuation (see "Post-ship review & continue"); the
    routine flips it back to `in_progress` (Active) on its next run.
  - `issue_created` / `declined` / `rejected` are flipped straight to `open`
    (Active) by the reopen trigger the instant a human admin replies (migration
    `20260726180000`), which also clears `ship_ref` and `decision_note`.

  Each still-archived row renders its `ship_ref` as a link, labelled "View change"
  for a shipped PR and "View issue" for an issue. (During an in-flight shipped
  continuation `ship_ref` is briefly cleared; the shipping PR stays linked in the
  thread's review reply. A reopened `issue_created` topic loses its issue link
  from `ship_ref` — the GitHub issue itself is untouched.)

`issue_created` is the "tracked elsewhere" outcome: the topic leaves the work
queue without being deleted and without pretending it shipped. It has exactly
one writer (admin feedback 18e96ad3): **the ROUTINE**, when the topic's thread
carries an open `**[ISSUE]**` order — it files the issue and writes
`status='issue_created'` + `ship_ref=<issue url>` + `processed_at=now()`. See
"Issue erstellen" near the top of this document.

The row lands in the sign-off gate first, not straight in the Archive. Until
feedback 18e96ad3 the ADMIN was the only writer and the button said "Issue
erstellt" — a record, filed by hand — which read as an order and was not one;
round 1 turned it into the order and kept the record as a second control
("Issue-Link eintragen"), round 2 removed that control, so the panel no longer
offers any by-hand way to set `issue_created`. **The routine never touches a row
while it rests in `issue_created`** —
but an admin reply reopens it to `open` first (the reopen trigger), and from then
on it is an ordinary `open` item the routine works. Legacy `rejected`
rows are archived rather than hidden so they stay reachable instead of being
orphaned in a view nobody opens — and they reopen on an admin reply the same way.

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
`20260726170000_user_feedback_channel.sql`):

| column        | meaning                                                       |
|---------------|--------------------------------------------------------------|
| `feedback_id` | FK → `admin_feedback.id` (cascade delete)                    |
| `author_id`   | FK → `profiles.id`; who wrote the message                    |
| `from_admin`  | `true` = admin → author, `false` = the author's own reply (only while a question is open) |
| `is_question` | `true` only on an admin message that asks the author something → sets `status='needs_input_author'` |
| `body`        | markdown message (author-visible!)                           |
| `created_at`  | thread order                                                 |
