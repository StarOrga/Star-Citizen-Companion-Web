# Scheduled tasks — sessions are the cost, not the tokens

The admin-feedback routine (`nightly-admin-feedback`, prompt under
`~/.claude/scheduled-tasks/`, contract in `docs/feedback-routine.md`) runs as a
Claude Desktop scheduled task. Everything below is about what that runtime does
that a cron job on a server would not.

## Mental model

- **Every tick is its own Desktop session.** The scheduler opens a fresh session
  per firing, even when the tick does nothing but one gate call. The cron
  (`0,20,40 * * * *`) fires 72 times a day; the *working* cadence lives in
  `scripts/routine-gate.mjs`, so most of those 72 are idle.
- **An un-archived session is not "over".** After the next restart or crash the
  Desktop app restores every un-archived session as a tab — each with its own
  `claude.exe` (300–600 MB), a node service and all SessionStart hooks
  (graphify, plugin verify, git …). 2026-09-14: after a bluescreen ~120 routine
  sessions came back at once and pinned the NVMe at 100 % for 15 minutes;
  the backlog was ~570 un-archived routine sessions since 2026-07-18, swept by
  hand the same evening.
- **Nothing archives a scheduled session but the session itself.** There is no
  auto-archive on completion; `archive_session "self"` from inside the tick is
  the only cheap, reliable path (verified on the 21:07 tick of 2026-09-14).

## Rules

1. **Every tick ends by cleaning up** — idle ticks and working runs alike: one
   `mcp__ccd_session_mgmt__list_sessions`, `archive_session` for every older
   non-running session carrying the routine's title (also the retired title
   "Nightly admin feedback"), the report line, then `archive_session` with
   `"self"` as the very last call. Never a running session, never another
   title. The step is written into the prompt (STEP 0 and STEP 6) and
   `docs/feedback-routine/gate.md`; keep it there when the prompt is rewritten.
2. **Renaming the task renames the title** — the hygiene step matches on the
   title, so add the old title to the match list when the task is renamed.
3. **Before changing the cron or the cadence table, do the arithmetic:** how
   many sessions per day will exist, how long each lives, and who archives
   them. A cadence in the gate keeps the run-lock/jitter logic in one place but
   costs a session per idle firing; a cadence in the cron (several tasks, or a
   cron that fires only on working slots) creates no idle sessions but splits
   the lock/jitter reasoning across task definitions. Either is defensible;
   "the scheduler fires and nobody cleans up" is not.
4. **When the Desktop app restarts after a crash**, check `list_sessions` for
   routine sessions with `isArchived:false` before anything else; if there are
   more than one, sweep them first — it is the difference between a 30-second
   restart and a 15-minute disk stall.
