# Appendix: the gate, the drain loop, the heartbeat

> Read when: a tick starts or ends, a new wave is about to be claimed, the usage
> brake may trip, or the admin asks what the panel's title colour means. Core contract: [`../feedback-routine.md`](../feedback-routine.md).

## The gate (STEP 0 — one script call before anything else)

The watcher (`scripts/routine-watcher.mjs`, see [`watcher.md`](watcher.md)) calls
this every 3 minutes without a model, from the repo root of the PRIMARY checkout:

```bash
node scripts/routine-gate.mjs check
```

It prints one JSON line (`verdict` ∈ `idle` · `running` ·
`work` · `error`) after doing, without a model:

1. **Run lock.** A live `running` lock (`routine_heartbeat.state='running'`,
   `run_started_at` younger than 3 h, not finished) means another tick is still
   working → `verdict: running`, heartbeat stamped, **stop**. "Läuft noch ein
   anderer Durchlauf?" is answered before anything is claimed.
2. **Reaper with liveness.** `in_progress`, `ship_ref is null`, older than 60
   min → reopened to `open` — **unless** an `scfb-<short-id>*` worktree shows
   git activity inside the last 60 min (then it is a live run's claim and is
   left alone; the JSON lists it under `skippedLive`). This is the check the
   old timer-only reaper lacked (memory `feedback-reaper-reopens-live-claims`).
3. **Counts (a)–(f)** in one SQL — (a) `open and triaged`, (b) answered
   `needs_input`, (c) open review-holds, (d) continuations, (e) answered holds,
   (f) `shipped and review_reply_pending` — plus `untriaged` and
   `bare_in_progress` for the report.
4. **Heartbeat** with `next_run_at`, `state` and a machine-readable `note`.

**Lock liveness (0.85.12).** `start-run` records the holder's session id in
`.claude/routine-run.json` (git-ignored, primary checkout). On every tick a
held lock is judged by that session's transcript writes — its own
`~/.claude/projects/<checkout>/<sid>.jsonl` plus `<sid>/subagents/*.jsonl` —
and released with `note=lock-reaped:dead-session` when nothing was written
for 30 min (15 min grace after `start-run`). Without a recorded session the
whole checkout's transcripts count, so a live session always keeps the lock
(safe direction). The JSON carries `lockReaped: {since, sid, idleMin}`; the
dead run's bare claims go through the ordinary reaper with its worktree
liveness. Before this, a run killed by an app quit (2026-09-17 19:41) held
the lock for the full 3 h while two worktrees sat stranded. "Writing" means
a real transcript record (user/assistant/system/progress); the app's
untimestamped bookkeeping records (title, last prompt, mode) that land
whenever a session is touched do not count (0.86.3), nor does the synthetic
"Continue from where you left off." / "No response requested." pair the
app appends without a model turn when it finds a session after a restart
(0.86.8). An interrupted run must
resume on its own — prompt RESUME RULE, `reaper.md` "An interrupted run".

The watcher does not call the gate while its own run is alive: it only stamps the
heartbeat then, because the reaper and the lock liveness are for runs nobody owns.
A broken gate must never look like an empty queue, which is why the script exits 2
and never prints `idle` on a failure.

The token the script needs is the Supabase CLI PAT: `--token`, then
`SUPABASE_ACCESS_TOKEN`, then the Windows Credential Manager entry the CLI
keeps (`supabase login`). Pass it via the environment, never on a command line
that ends up in a transcript.

## Liveness heartbeat (STEP 0.5 — the very first thing every cycle)

The routine runs on **Jerry's PC**, not in the cloud. When the machine is off or
nobody is logged in, the routine simply doesn't fire — and says nothing. From the board that is indistinguishable from "the
queue is empty and everything is fine": an admin files a topic, sees it sitting
at `open`, and has no way to tell whether it is queued at a working machine or
at a dark one. Feedback `a7573f0e` asked for exactly that missing bit — "zeig
mir an, ob der PC erreichbar ist" — and pointed at the obvious source: the
routine already polls this board on every tick, so **the poll itself is the
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

| row | title | tooltip / screen reader |
|---|---|---|
| `state = 'running'`, lock < 3 h | accent | "Dev-PC arbeitet gerade — … (Lebenszeichen vor 5 Minuten)." |
| `now() < next_run_at + 15 min` (legacy rows: `now() - last_seen_at < 45 min`) | green | "Dev-PC erreichbar — … hat sich vor 5 Minuten gemeldet. · Letzter Lauf: nichts offen" |
| same, but `state = 'paused'` | amber | "Routine pausiert — Nutzungskontingent fast aufgebraucht … · Die Routine läuft nur, solange der Dev-PC an ist …" |
| `next_run_at + 15 min` in the past | red | "Dev-PC nicht erreichbar — zuletzt vor 3 Stunden … · Die Routine läuft nur, solange …" |
| no row / query error | untinted | "Status unbekannt — bisher keine Rückmeldung. · Die Routine läuft nur, solange …" |

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

**The freshness window is no longer a constant.** Every stamp carries
`next_run_at` — the instant the gate expects the scheduler to fire next, from
the watcher's interval — and the panel reads "online"
while `now < next_run_at + 15 min`. A fixed 45-minute window (the first cut,
calibrated for a 20-minute cron) turned red for a quarter of every healthy hour
the moment the cron moved to hourly, and a status light that lies is worse than
no status light. Rows without `next_run_at` (stamped before migration
20260913121500) still get the old 45-minute rule. Two more tints exist since
that migration: **running** (accent) while a run holds the lock, **paused**
(amber) while the usage brake is engaged — both alive, neither green-idle.
The tooltip (native `title`, so no markup) is also the honest availability
sentence: it names the last check-in, the last run's note (translated from the
gate's keys) and says that the routine only runs while the dev PC is up.

**Grey is a real third state, not an error bucket.** A missing row, an expired
session, or a failed request says nothing whatsoever about the dev PC, and
painting that red would be a claim the admin then has to go and disprove.

**A dead watcher turns the title red on its own** — which is the property
the feedback predicted ("denke das System wird damit automatisch auch erkennen
wenn die Tokens verbraucht sind"). Since the watcher a usage limit paints amber instead (it knows); anything that stops
the watcher itself simply stops the stamp, so `last_seen_at` stops advancing and ages past the window by
itself. The same is true for a powered-off PC and a disabled watcher task. That is why the stamp must be **unconditional** — never guarded
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

## Resuming interrupted work (stale-claim reaper) — see [`reaper.md`](reaper.md)

The routine's queue is `status = 'open'` only, so a claim that a dead run left
behind stays invisible until the reaper reopens it.

**What follows is the rest of the tick's own machinery — the drain loop, the
usage brake and the run lock.**

### Drain loop and the usage brake

A run is **not** one batch and done (concept 2026-09-13, E3a). After the serial
merge of a wave it re-reads the queue — `node scripts/routine-gate.mjs check
--in-run` (skips the lock and the cadence gate, refreshes counts and the
heartbeat) — and, if anything actionable is left, builds the next wave of up to
3 disjoint-area items **off the now-merged `origin/main`**. It keeps going until
the queue is empty or a brake trips. The 22-item evening of 2026-09-01 drained
over two days because every run stopped after one wave; it now drains in one.

**Brakes are checked only when a NEW wave is about to start, never mid-item**
(the admin's rule: a running feedback finishes, whatever the clock says):

- **Usage brake (6b).** Before claiming a wave, read the live usage
  (`mcp__plugin_devops_dotclaude__get_usage`). If the 5-hour window
  has less than 20 % left → do not claim; `end-run --state paused --note
  paused-usage-limit`; report; stop. The panel shows amber "pausiert" with the
  reason in the tooltip instead of a stale green. If the reader itself fails,
  **fail open** — carry on; an unreadable meter is not an empty one. Below 10 %
  a wave that is already implemented is still merged (the merge is fast); what
  is skipped is the *next* wave, never the current item.
- **Run lock.** `check --in-run` ignores it (it is ours); a fresh tick sees it
  and stands down. Release it at the end of the run, always — a `try/finally`
  in spirit: even the "nothing more to do" exit runs `end-run`.

**`sql --file <path.sql>` / `--query "<sql>"` / stdin** — runs one statement
through the Management API with the gate's PAT and prints the rows as a JSON
array. It exists for working runs whose session has no authorised Supabase MCP
(observed 2026-09-13 13:27: the tick reported the MCP as unauthorised — harmless
for an idle tick, a blocker for a working one). Since 0.84.7 the project MCP
authenticates with the same PAT as a request header (`.mcp.json` →
`SUPABASE_ACCESS_TOKEN`), so an unauthorised or unconnectable MCP now means
that variable is missing in the session's environment — report it, take the
fallback. Same service-role power, same
rules: never a secret on the command line, never `rejected`, replies only into
`admin_feedback_messages`.
- **Worktree hygiene.** Each wave's worktrees are removed after their merge
  (the routine's own `scfb-*` only), so a long drain does not pile them up.

### The atomic claim does not guard against a parallel *issue* runner

`admin_feedback`'s claim only serialises **runs that read that table**. The
pre-claim check is in the core, "Concurrency"; the incident is in
[`history.md`](history.md).
