# Appendix: the watcher and its failure table

> Read when: something about starting, stopping or recovering a run looks wrong.
> Core contract: [`../feedback-routine.md`](../feedback-routine.md).

Since 2026-11-05 no model runs until the board holds work. A Windows Task
Scheduler job ("SCC Feedback Watcher", every 3 min and at logon, runs hidden)
starts `scripts/routine-watcher.mjs tick`, which needs only Node and no
`node_modules`. Before that, two Claude Desktop scheduled tasks opened about 33
sessions a day to find an empty queue: 8 topics and 4 human replies in the 30
days before the switch.

| Piece | Where |
|---|---|
| Tick and supervisor | `scripts/routine-watcher.mjs` |
| Every decision, pure and unit-tested | `scripts/lib/routine-watcher-core.mjs`, `scripts/routine-watcher.test.mjs` |
| Chaos test against the real board and origin, with a fake `claude` | `scripts/routine-watcher-chaos/` (`node scripts/routine-watcher-chaos/chaos.mjs`, about 4 min, cleans up after itself) |
| Prompt of the headless run | live `~/.claude/scheduled-tasks/scc-feedback-headless/SKILL.md`, repo copy `docs/routine/tasks/scc-feedback-headless/SKILL.md` (`prebuild` fails on drift) |
| Local state, run file, logs | `~/.claude/scc-routine/` (`state.json`, `run.json`, `logs/`, 14 days) |
| Status at a glance | `npm run watcher -- status` |
| Setup and removal | `npm run watcher -- install`, `npm run watcher -- uninstall` (primary checkout only) |

The prompt lives outside the repo on purpose: a run must not be able to rewrite
the instructions of the next run through a merge (concept 2026-09-13, E2a).

## One tick

1. Tick lock, so overlapping ticks cannot double-start anything.
2. `run.json` exists?
   - Its supervisor is alive: stamp the heartbeat and stop. Nothing else may run
     beside a live run.
   - It is gone: kill what is left of the session, run the postflight, stop.
3. `routine-gate.mjs check`: lock liveness, reaper, counts, heartbeat with
   `next_run_at = now + 3 min`.
4. Owed review replies (query f), no model: `verify-ship-live --once`, post the
   text it prints, clear the flag.
5. Hourly: orphan processes, worktrees, branch sweep, log pruning.
6. `planQueue`: items out of attempts are parked with a reply; items in backoff
   wait; the rest starts `supervise`, detached, so it outlives the tick.

## One run

`supervise` takes the run lock, keeps the PC awake, fast-forwards the primary
checkout and starts `claude -p` with a session id it knows. A watchdog checks once
a minute: 170 awake minutes at most, and 45 minutes without a transcript write
(subagents included) count as hung. Sleep counts as neither. Print mode ends with
the model's turn and kills what runs in the background, so the prompt forbids
`run_in_background`: workers are foreground Task calls in one message.

Afterwards the **postflight** runs, whatever happened, without a model:

1. Kill leftover processes, scoped by worktree path and session id, never by name.
2. Commit and push uncommitted work in `scfb-*` worktrees as `wip: rescued …`, then
   remove the worktree. A worktree whose push failed stays.
3. Reconcile every `in_progress` item (table below). A bare `in_progress` never
   survives a run.
4. Book attempts, delete branches of finished items, release the lock.

If the postflight cannot finish, `run.json` stays and the next tick repeats it.

## The end state of every item

| After the run | The watcher does | The admin sees |
|---|---|---|
| Shipped by the run | nothing | the ✅ reply of the run |
| PR merged, run died before marking it | marks `shipped`, sets the alpha tag, posts the owed reply | ✅ reply from `verify-ship-live` |
| Bare claim, no merged PR | back to `open` with a note; the next attempt resumes from the pushed branch | nothing yet, the item is still moving |
| Hold, no reply since the claim | posts why it waits | ⏸️ reply with the PR |
| Hold, PR merged by hand | marks `shipped` | ✅ reply |
| Hold, PR closed unmerged | `needs_input` | reply offering a new attempt |
| 3 failed attempts | parks: `needs_input` for an open or claimed item, the status stays for an answered hold or continuation | ⚠️ reply naming the reason and the branch or PR, with `[[Erneut versuchen\|Thema schließen]]` |

A new human message starts the attempts over. That is what makes the retry button
work. Attempts wait 15 and then 60 minutes.

**Branches:** a `feat/feedback-*` branch lives as long as its item is active, and
the thread names it when an item is parked. Once the item is finished the sweep
deletes it and closes a PR still open on it, unless the branch is younger than 2 h.
Branches that match no item are never touched.

## Failure table

| Failure | Detected by | Reaction | Charges an attempt? |
|---|---|---|---|
| PC off, shutdown or crash mid-run | `run.json` with a dead pid at the next tick | kill leftovers, rescue, reconcile, retry at once | no |
| Sleep mid-run | watchdog gap over 5 min | sleep does not count as run time or silence; keep-awake makes it rare | no |
| Supervisor killed | same | same | no |
| Supervisor wedged | alive, but no beat for 30 min while ticks prove the PC was awake | kill, then as above | no |
| Headless run hangs | watchdog | kill tree, postflight | yes |
| Run exceeds 170 min | watchdog | kill tree, postflight; the next run resumes | yes |
| Run crashes or exits without a result | `classifyExit` | postflight, backoff | yes |
| Run ends fine, item untouched | item still queued | backoff; only claimed items are charged when other items were resolved | yes |
| Usage limit | `rate_limit_event` rejected, 429, or message text | cool down until the announced reset, panel amber | no |
| Claude login expired | 401/403 or message text | 1 h cooldown, toast | no |
| API overload or no network | 5xx or message text | 10 min cooldown | no |
| Claude CLI missing | spawn error | counts as a crash, so the item gets a reply after 3 attempts | yes |
| GitHub down or `gh` logged out | `gh` fails | nothing is decided from "no PRs": the claim and the sweep wait | no |
| Board or PAT down during a tick | gate `error` | retried each tick, toast after 10 errors; the panel ages to red | no |
| Board or PAT down during the postflight | SQL error | `run.json` stays, the next tick repeats it | no |
| `end-run` lost | gate says `running`, holder is our last session | released by the next tick | no |
| Two ticks overlap | tick lock and `IgnoreNew` | the second one exits | no |
| Deploy never turns green | `verify-ship-live` fails for 60 min | posts the ⏳ or ❌ reply | no |

**What this cannot cover:** nothing runs while the PC is off or nobody is logged
in, because Credential Manager and the Claude login need the user session. The
panel shows that by turning red about 18 minutes after the last tick, and the
board is worked through at the next logon. A `claude -p` run does not appear in
the Desktop app; its stream is in `logs/run-<date>-<session>.jsonl` and its
transcript in `~/.claude/projects/`.
