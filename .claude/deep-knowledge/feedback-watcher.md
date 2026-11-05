# Feedback watcher — what the docs do not say

The contract and the failure table are in `docs/feedback-routine/watcher.md`.
This is what bit during the build, and why the old setup is gone.

## Why not Desktop scheduled tasks any more

Removed on 2026-11-05. Every tick was its own Desktop session even when it only
called the gate: about 33 a day, each with a full context, for 8 topics a month.
They also brought their own failure class: a session restored as a tab per
un-archived tick after a crash, `archive_session` blocking on a consent card in
unattended sessions, a stored cwd that silently skipped every tick once its folder
vanished, and app quits killing runs. The full history is in git:
`.claude/deep-knowledge/scheduled-tasks.md` before that date.

The app setting "Archive inactive sessions = 1 day" was set for those ticks. Nothing
needs it now; it is the operator's call whether it stays.

## Hazards

- **`claude -p` ends with the model's turn.** Background Task or Bash work dies
  with it, so the prompt forbids `run_in_background`. A scheduled Desktop session
  could end its turn and be re-awoken by a notification; this cannot.
- **A killed supervisor breaks the pid tree.** `taskkill /T` on a remembered pid
  missed the real process when the parent was already gone. The chaos test caught
  it. `killSession` finds processes by the session id on their command line instead.
- **Never match a process pattern from a shell whose own command line contains it.**
  A `Stop-Process` filter run from Bash matched its own parent and killed the tool
  call (exit 255). The watcher excludes its own pid; do the same by hand.
- **`%LOCALAPPDATA%` lies inside a Claude Desktop session.** The app is MSIX, so tools
  started from a session write AppData to `Packages/AnthropicPBC.Claude_*/LocalCache/Local/`
  and read a merged view: the task's real `state.json` was shadowed by a session's older
  copy of the same name, while files only the task wrote showed through. That is why the
  watcher's home is `~/.claude/scc-routine/`.
- **Node `spawn` needs a real executable.** `where claude` gives the WinGet link
  `claude.exe`; a `.cmd` needs `shell: true`, which is only used by the chaos test's fake.
- **A failed `gh` is not an empty list.** `feedbackPrs()` returns null then, and
  nothing is decided from it (same trap as the 503 in the loose-ends sweep).
- **The gate must not run beside a live run.** Its reaper and lock liveness are for
  runs nobody owns; while `run.json` is alive a tick only stamps the heartbeat.
- **Rescue must not resurrect merged branches.** A finished item's worktree is
  removed without a push, otherwise the sweep has to delete the branch again.
- **The session must not sit in the primary.** The main-branch guard reads the
  hook's cwd, and a subagent's shell returns to the session folder after every
  call, so `cd <worktree> && git commit` is judged as "on main". Two 170-minute
  runs shipped nothing that way. The session lives in the detached
  `.claude/worktrees/scc-runner`; transcripts land under that path's project
  folder, and the gate's lock liveness looks at both.
- **Local builds do not scale here.** Three parallel builds took 10 to 30 minutes
  each, more with a game running. `web-ci` does the same in about 3 minutes, so
  workers wait for it with `scripts/routine-ci-wait.mjs`.
- **Attachments 404 by URL.** The bucket is private; a worker that gets the URL
  guesses at the screenshot. The orchestrator downloads them first.

## Before changing it

- Change a decision in `scripts/lib/routine-watcher-core.mjs` and add a case to
  `scripts/routine-watcher.test.mjs`. Change anything around the run lifecycle ⇒ run
  `node scripts/routine-watcher-chaos/chaos.mjs` from a worktree too. It writes
  `[watcher-test]` rows to the live board and deletes them; the watcher task should
  not be mid-run, because the test takes the same lock.
- `WATCH_INTERVAL_MIN` exists twice on purpose (core and gate), because the gate must
  stay importable without the watcher. Change both, then `npm run watcher -- install`.
- A silent routine: `npm run watcher -- status`, then
  `~/.claude/scc-routine/logs/watcher-<date>.log`.

## A full queue: read in this order

On 2026-11-05 the panel filled with "wartet auf Routine" for two separate reasons,
and neither was a broken scheduler.

1. `taskStatus` in `npm run watcher -- status`. "Deaktiviert" means a session paused
   the task on purpose; find it with a transcript search for `/DISABLE`. The panel
   has no state for this, it only ages to offline. Do not re-enable while that
   session is shipping a fix: the next tick starts a run on the old code.
2. `started run` and `postflight` lines in the watcher log. Runs that keep ending in
   `hard cap` or `interrupted` with nothing shipped are a throughput bug, not a
   scheduling one. Count `ship_*` calls in `logs/run-<date>-<sid>.jsonl`.

**Pausing the task makes its re-enable your job.** `schtasks /Change /DISABLE` has no
timer and nothing turns it back on. Put the re-enable on your task list in the same
step, and say so in your report. `npm run watcher -- install` also re-enables, since
its XML sets `Enabled=true`.

**Never call `routine-gate.mjs` without a subcommand to look at something.** The
default is `check`: it runs the reaper and stamps the heartbeat, so a paused routine
looks alive on the panel. Read-only inspection is `routine-gate.mjs sql --query`.
