# Scheduled tasks — sessions are the cost, not the tokens

The admin-feedback routine (`nightly-admin-feedback`, prompt under
`~/.claude/scheduled-tasks/`, contract in `docs/feedback-routine.md`) runs as a
Claude Desktop scheduled task. Everything below is about what that runtime does
that a cron job on a server would not.

## Mental model

- **Every tick is its own Desktop session.** The scheduler opens a fresh session
  per firing, even when the tick does nothing but one gate call. Until
  2026-09-15 one cron (`0,20,40 * * * *`) fired 72 times a day while the
  *working* cadence in `scripts/routine-gate.mjs` used 34 of them; since 0.85.10
  two tasks with one prompt body fire only on those slots —
  `nightly-admin-feedback` (`0,20,40 19-23,0 * * *`, title "SCC Web
  Auto-Feedback Developpment") and `nightly-admin-feedback-day`
  (`0 1,3,5,7-18 * * *`, title "… (day)"). The gate is unchanged and still the
  authority; the cron only stops idle sessions from being born. A tick lands
  in its 20-min slot whatever the per-task jitter (≤ 10 min), so both tasks
  pass the same cadence check.
- **Two files, one body — enforced.** `scripts/check-routine-prompts.mjs` runs
  in `prebuild` (every `npm run build`, so every ship and every routine
  worker) and fails when the two SKILL.md bodies differ or
  `docs/routine/SKILL.snapshot.md` drifted from the evening file; it SKIPs
  where `~/.claude/scheduled-tasks` does not exist (CI, Vercel). Edit the
  evening file, copy its body (everything after the frontmatter) to the day
  file, refresh the snapshot — `npm run verify:routine-prompts` tells you when
  you are done.
- **An un-archived session is not "over".** After the next restart or crash the
  Desktop app restores every un-archived session as a tab — each with its own
  `claude.exe` (300–600 MB), a node service and all SessionStart hooks
  (graphify, plugin verify, git …). 2026-09-14: after a bluescreen ~120 routine
  sessions came back at once and pinned the NVMe at 100 % for 15 minutes;
  the backlog was ~570 un-archived routine sessions since 2026-07-18, swept by
  hand the same evening.
- **Nothing archives a scheduled session but the session itself — and it
  cannot do that unattended.** There is no auto-archive on completion, and
  every `archive_session` call made *from a scheduled-task session* (older
  sessions and `"self"` alike) blocks on an approval dialog that only the user
  can click, although the session runs in bypass-permissions mode and the same
  call needs no click from an interactive session. While the dialog waits the
  session counts as running, and the scheduler does not fire the task again:
  on 2026-09-14 the 21:47 tick hung 81 minutes on its self-archive and the
  22:07, 22:27 and 22:47 ticks never happened. Since 23:20 that day the
  archive step in the prompt is suspended; the sweep is done by hand from an
  interactive session (`list_sessions` → `archive_session` per routine
  session, no dialog there).

## The sanctioned cleanup: the app's own inactive auto-archive

Claude Desktop ships an `AutoArchiveEngine` (found in the 1.52386 bundle) with
two rules: *PR landed* (Settings → Local sessions → "Auto-archive after PR
merge or close", preference `ccAutoArchiveOnPrClose`) and *inactive*
(Settings → Local sessions → "Archive inactive sessions", preference
`ccAutoArchiveInactiveDays`, presets Never / 1 / 2 / 7 / 14 / 30 days, whole
days only, default Never). The engine sweeps on its own timer and archives a
session whose last activity *and* last focus are older than the limit,
holding back sessions that are running, pinned, on screen, awaiting input,
carrying losable work (dirty worktree) or unarchived by hand. It is the app's
own action, so it needs no consent card — the very thing the tick's
`archive_session` call cannot avoid. Routine sessions (no worktree, never
pinned, closed within a minute) qualify after the limit. With 1 day the
un-archived backlog is bounded at one day of ticks (72 with the current cron,
34 with a cron that fires only on cadence slots) instead of growing forever.
The preference lives under `preferences` in `%APPDATA%/Claude/claude_desktop_config.json`;
set it in the Settings UI, a file edit is only read at the next app start.

**Operator decision 2026-09-17: the setting stays on Never** — it is global and
would archive every other session after the same delay. The routine's sessions
are instead swept by `/routine-janitor` (`.claude/skills/routine-janitor/`):
idle ticks archived at once and **deleted** after 1 h, working runs archived
beyond the 3 newest and never deleted, running ones never touched; classified
by run duration (≥ 180 s ⇒ working). It runs as `/loop /routine-janitor` in
one pinned interactive session, because only an interactive session archives
without a consent card and `delete_session` gets one approval card per call
(≤ 25 sessions, every permission mode, unavailable in unattended sessions) —
the janitor issues at most one such card per sweep and never waits for it.
The task's run history in the Desktop "Ausführungen" pane lists archived
runs too; only deletion removes an entry there. It lives as long as that
session and is restarted after a Desktop restart. `list_task_runs` returns
50 runs per task at most; a catch-up scans the session records under
`%APPDATA%\Claude\claude-code-sessions` by `scheduledTaskId` instead
(2026-09-17: 835 routine records, 512 idle, deleted in cards of 25).

## Rules

1. **Every tick should end by cleaning up** — idle ticks and working runs
   alike: one `mcp__ccd_session_mgmt__list_sessions`, `archive_session` for
   every older non-running session carrying the routine's title (also the
   retired title "Nightly admin feedback"), the report line, then
   `archive_session` with `"self"` as the very last call. Never a running
   session, never another title. **Suspended** (see above) until an unattended
   session can archive without a click — never put a call that can block on a
   dialog into a scheduled prompt; one such call idles the whole task. The
   suspended step stays documented in the prompt (STEP 0 and STEP 6) and
   `docs/feedback-routine/gate.md` so it can be switched back on in one edit.
   The replacement is the `/routine-janitor` loop above (the app-level
   inactive auto-archive was rejected as too global), plus the two crons
   that fire only on cadence slots.
2. **Renaming the task renames the title** — the hygiene step matches on the
   title, so add the old title to the match list when the task is renamed
   (the day task already carries "… (day)"; the Desktop app refuses two
   tasks with the same title).
3. **Before changing the cron or the cadence table, do the arithmetic:** how
   many sessions per day will exist, how long each lives, and who archives
   them. The cadence lives in the gate AND the two crons mirror it; change
   both together or the panel's `next_run_at` lies. Two tasks also mean the
   scheduler's own "don't fire while running" guard is per task — a 00:40
   evening run and a 01:00 day run can overlap, and then the gate's run lock
   is the only brake (that is what it is for). "The scheduler fires and
   nobody cleans up" is never defensible.
4. **Quitting the app kills every running run — background workers included.**
   The orchestrator ends its turn while `run_in_background` workers write; an
   app quit takes all of them down and nothing commits (2026-09-17: 1.800
   uncommitted lines in two worktrees, lock held until the 3-h timeout). The
   gate now releases a lock whose session stopped writing for 30 min
   (`lockReaped`, `scripts/routine-gate.mjs`), workers push `wip:` commits
   early, and a merge that finds the ship MCP dead (plugin auto-update under a
   running session) goes through `scripts/ship-via-mcp.cjs`. Before quitting
   the app deliberately, look at the routine's heartbeat: `state=running` means
   a run is mid-flight.
5. **When the Desktop app restarts after a crash**, check `list_sessions` for
   routine sessions with `isArchived:false` before anything else; if there are
   more than one, sweep them first — it is the difference between a 30-second
   restart and a 15-minute disk stall.
