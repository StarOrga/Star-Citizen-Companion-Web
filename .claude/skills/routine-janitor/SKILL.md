---
name: routine-janitor
description: Archive the feedback routine's finished Desktop sessions by policy — idle ticks after 1 h, working runs beyond the 3 newest — from an INTERACTIVE session, where archive_session needs no consent card. Run it as `/loop /routine-janitor` in a pinned session. Triggers on "/routine-janitor", "routine sessions aufräumen", "janitor".
---

# Routine janitor

The feedback routine (`nightly-admin-feedback` + `nightly-admin-feedback-day`,
see `.claude/deep-knowledge/scheduled-tasks.md`) leaves one Desktop session per
tick. A scheduled-task session cannot archive sessions unattended (every
`archive_session` call there blocks on a consent card), an interactive session
can. This skill is that interactive sweep. It must stay cheap: two
`list_task_runs`, n `archive_session`, one report line, nothing else — no
runbook, no transcripts, no DB.

## Policy (the operator's words, 2026-09-17)

- **Working runs** (the gate said `work`): keep the **3 newest** across both
  tasks, archive every older one.
- **Idle ticks** (gate `idle` / `skip-cadence` / `running`, or a run that died
  at once): archive once they are **older than 1 hour**.
- **Never** archive a run whose status is `running`, and never any session that
  is not in the two tasks' run lists (other titles, other projects, this one).

Working vs idle is decided by **duration** — `last_activity_at − started_at`:
an idle tick finishes in well under 3 minutes (gate call + report line), a
working run takes minutes to hours. Threshold: **≥ 180 s ⇒ working**. A run
that failed instantly (usage limit) is short and therefore treated as idle.

## Steps

1. Load the tools if they are deferred:
   `ToolSearch select:mcp__scheduled-tasks__list_task_runs,mcp__ccd_session_mgmt__archive_session`.
2. `mcp__scheduled-tasks__list_task_runs` for `nightly-admin-feedback` and for
   `nightly-admin-feedback-day`, `limit: 50` each. Merge the two lists.
3. Drop runs with `archived: true` or `status: "running"`.
4. Classify each remaining run: `working` if
   `Date.parse(last_activity_at) − Date.parse(started_at) ≥ 180000`, else `idle`.
5. Candidates:
   - every `idle` run whose `last_activity_at` is more than 60 minutes ago;
   - every `working` run except the 3 with the newest `started_at` (across
     both tasks together).
6. `mcp__ccd_session_mgmt__archive_session` for each candidate, `session_id`
   from the run, `reason` `"routine janitor: idle tick > 1 h"` or
   `"routine janitor: older than the 3 newest working runs"`. A refused call
   is reported, not retried.
7. Report exactly one line:
   `Janitor: archived <i> idle + <w> working · kept <k> working, <r> running · next sweep in 1 h`
   Nothing after it.

## Running it

- Pin one lean interactive session in the primary checkout and type
  `/loop /routine-janitor` (dynamic mode — self-paced, pick 3600 s, no 7-day
  expiry). A fixed `/loop 1h …` also works but expires after 7 days.
- The loop lives as long as that session: after a Desktop restart, reopen the
  session and start the loop again. Sessions the janitor missed are caught up
  on the next sweep.
- It runs alongside the app's own "Archive inactive sessions" setting, which
  stays on **Never** by the operator's choice (that setting is global).
