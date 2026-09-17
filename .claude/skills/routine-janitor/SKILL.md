---
name: routine-janitor
description: Sweep the feedback routine's finished Desktop sessions by policy — idle ticks DELETED after 1 h (one approval card per sweep), working runs archived beyond the 3 newest — from an INTERACTIVE session, where archive_session needs no consent card and delete_session gets one card per call. Run it as `/loop /routine-janitor` in a pinned session. Triggers on "/routine-janitor", "routine sessions aufräumen", "janitor".
---

# Routine janitor

The feedback routine (`nightly-admin-feedback` + `nightly-admin-feedback-day`,
see `.claude/deep-knowledge/scheduled-tasks.md`) leaves one Desktop session per
tick. A scheduled-task session cannot archive or delete sessions unattended
(every such call there blocks on a consent card), an interactive session can:
`archive_session` needs no card, `delete_session` shows ONE approval card per
call (≤ 25 sessions) that the operator clicks when convenient. This skill is
that interactive sweep. It must stay cheap: one scan, n archive calls, at most
one delete call, one report line — no runbook, no transcripts, no DB.

## Policy (the operator's words, 2026-09-17)

- **Idle ticks** (gate `idle` / `skip-cadence` / `running`, or a run that died
  at once): archive immediately, **delete** once older than 1 hour — they hold
  nothing worth keeping and would otherwise pile up in the task's run history.
- **Working runs** (the gate said `work`): keep the **3 newest un-archived**
  across both tasks, archive every older one. **Never delete** a working run —
  its transcript is the record of what shipped.
- **Never** touch a run whose status is `running`, and never any session that
  is not one of the two tasks' runs (other titles, other projects, this one).

Working vs idle is decided by **duration** — last activity − start: an idle
tick finishes in well under 3 minutes (gate call + report line), a working run
takes minutes to hours. Threshold: **≥ 180 s ⇒ working**. A run that failed
instantly (usage limit) is short and therefore idle.

## Steps

1. Load the tools if they are deferred: `ToolSearch
   select:mcp__scheduled-tasks__list_task_runs,mcp__ccd_session_mgmt__archive_session,mcp__ccd_session_mgmt__delete_session`.
2. **Scan.** `mcp__scheduled-tasks__list_task_runs` returns only the 50 newest
   runs per task, which is enough for an hourly sweep. For a catch-up after
   days off, scan the session records instead — every
   `%APPDATA%\Claude\claude-code-sessions\**\*.json` with `scheduledTaskId` in
   {`nightly-admin-feedback`, `nightly-admin-feedback-day`}; `createdAt`,
   `lastActivityAt`, `isArchived` are in the record. Both sources give the same
   fields: session id, started, last activity, archived.
3. Drop runs with `status: "running"` (run list) — a record newer than
   3 minutes counts as running too.
4. Classify: `working` if `lastActivity − started ≥ 180 000 ms`, else `idle`.
5. Candidates:
   - **archive**: every un-archived `idle` run; every un-archived `working` run
     except the 3 with the newest start (both tasks together);
   - **delete**: every `idle` run (archived or not) whose last activity is more
     than 60 minutes ago — at most 25 per sweep, oldest first; the rest wait
     for the next sweep.
6. `mcp__ccd_session_mgmt__archive_session` per archive candidate, reason
   `"routine janitor: idle tick"` / `"routine janitor: older than the 3 newest
   working runs"`. Then ONE `mcp__ccd_session_mgmt__delete_session` with the
   delete candidates (`session_ids`, reason `"routine janitor: idle ticks
   > 1 h — nothing to keep"`, never `force_worktree_cleanup`). The app shows the
   operator one card; until it is approved nothing is deleted, and the sweep
   does not wait for it. A refused or skipped call is reported, not retried.
7. Report exactly one line:
   `Janitor: archived <a> · delete card for <d> idle (<p> more pending) · kept <k> working, <r> running · next sweep in 1 h`
   Nothing after it.

## Running it

- Pin one lean interactive session in the primary checkout and type
  `/loop /routine-janitor` (dynamic mode — self-paced, 3600 s, no 7-day
  expiry). A fixed `/loop 1h …` also works but expires after 7 days.
- The loop lives as long as that session: after a Desktop restart, reopen the
  session and start the loop again. Sessions the janitor missed are caught up
  on the next sweep (idle backlog at 25 per sweep).
- The delete card is the only click the operator ever makes; declining it
  leaves the sessions archived, and they come back on the next card.
- The app's own "Archive inactive sessions" setting is global and stays the
  operator's; the janitor never depends on it.
