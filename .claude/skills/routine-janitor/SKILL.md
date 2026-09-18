---
name: routine-janitor
description: Sweep the feedback routine's finished Desktop sessions by policy — idle ticks DELETED after 1 h (one approval card per sweep), working runs archived beyond the 3 newest — from an INTERACTIVE session, where archive_session needs no consent card and delete_session gets one card per call. The archive half runs unattended as the Desktop scheduled task `routine-janitor` (every 4 h); type `/routine-janitor` interactively when the delete card should appear. Triggers on "/routine-janitor", "routine sessions aufräumen", "janitor".
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
   select:mcp__ccd_session_mgmt__archive_session,mcp__ccd_session_mgmt__delete_session`.
2. **Scan.** `node scripts/routine-janitor-scan.mjs` (primary checkout) reads
   the app's session records under `%APPDATA%\Claude\claude-code-sessions`
   (`scheduledTaskId` ∈ {`nightly-admin-feedback`, `nightly-admin-feedback-day`})
   and prints the classified lists as JSON: `archive`, `delete` (≤ 25, oldest
   first, `deletePending` = the rest), `keep`, `running`, `totals`. It is the
   only complete source: `list_task_runs` caps at 50 per task and lists
   nothing at all for the day task (2026-09-18), so a sweep built on it
   never sees the day ticks.
3. The script already drops records touched within 3 minutes (`running`).
4. It classifies `working` if `lastActivity − created ≥ 180 000 ms`, else
   `idle` (steps 5–6 below are what it computes; read them to know why).
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

- **Unattended (since 2026-09-18):** the Desktop scheduled task
  `routine-janitor` (title "SCC Web Routine Janitor", cron `0 */4 * * *`,
  prompt snapshot `docs/routine/JANITOR.snapshot.md`) runs the scan script
  and the archive calls every 4 h. A probe on 2026-09-18 16:00 showed that
  `archive_session` from a scheduled session in bypass mode returns in
  seconds without a consent card (app 2.1.274) — the 2026-09-14 hang is
  gone. `delete_session` stays unavailable unattended, so the task never
  deletes; its own runs are ticks of the third task id and are swept by the
  next run. No pinned session, no `/loop` needed any more.
- **Interactive:** type `/routine-janitor` in any session of this project
  when the delete card should appear (idle ticks > 1 h, ≤ 25 per card);
  declining it leaves the sessions archived. Sessions a sweep missed are
  caught up on the next one.
- The app's own "Archive inactive sessions" setting is global and stays the
  operator's; the janitor never depends on it.
