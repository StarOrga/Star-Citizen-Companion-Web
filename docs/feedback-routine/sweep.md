# Appendix: the loose-ends sweep

> Read when: a working run is about to write its report — the sweep runs every
> cycle, queue empty or not. Core contract: [`../feedback-routine.md`](../feedback-routine.md).

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
