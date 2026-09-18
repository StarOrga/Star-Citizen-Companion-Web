# Restoring the feedback routine on a fresh machine

The routine is three Claude **Desktop** scheduled tasks. They are **not** synced
to any cloud: the prompts live under `~/.claude/scheduled-tasks/<taskId>/SKILL.md`
and the registrations (cron, jitter, title, tool approvals) in the Desktop app's
local data. Everything needed to rebuild them is in this repo; everything else
below is a manual step. Order matters.

## What lives where

| Piece | Where | Backed up? |
|---|---|---|
| Task prompts (3 × SKILL.md, incl. frontmatter) | `docs/routine/tasks/<taskId>/SKILL.md` — byte copies of the live files, kept in sync by `npm run sync:routine-prompts` and checked by `prebuild` | yes (git) |
| Runbook, gate, janitor scan, hooks, skills, deep-knowledge, `.mcp.json`, `.claude/settings.json` | repo | yes |
| Task registrations (cron / jitter / title / description) | Desktop app | **no — table below** |
| devops plugin (hooks, ship MCP, completion card) | `github.com/Jerry0022/dotclaude` marketplace | yes (re-install) |
| Supabase CLI PAT | Windows Credential Manager `Supabase CLI:supabase` + user env `SUPABASE_ACCESS_TOKEN` | **no — `supabase login` again** |
| GitHub auth for `gh` (PR open/merge, mirror releases) | `gh auth login` | **no** |
| Claude's project memory (`~/.claude/projects/<slug>/memory/`) and the user-level `~/.claude/CLAUDE.md` | this machine only | **no** (operator's choice, 2026-09-18) |
| Session history / run history in the Desktop app | this machine only | no, and not needed |

## Steps

1. **Clone + deps.** `git clone https://github.com/StarOrga/Star-Citizen-Companion-Web.git C:\Users\<you>\IdeaProjects\Star-Citizen-Companion-Web && npm ci`. The path matters: the task prompts name the primary checkout `C:\Users\Jerem\IdeaProjects\Star-Citizen-Companion-Web` — with another user name, edit that path in all three prompts (and re-sync).
2. **Claude Desktop** with the Code tab; open the checkout as a project (this trusts the folder — scheduled runs refuse an untrusted folder). Settings → Claude Code: permission mode **bypass** for this project (the routine expects it), worktree location "inside the project" (`<repo>/.claude/worktrees`).
3. **devops plugin.** `claude plugin marketplace add https://github.com/Jerry0022/dotclaude.git` then `claude plugin install devops@dotclaude` (user scope; `local-llm@dotclaude` optional). The plugin provides the `ship_release` MCP the routine merges with; `scripts/ship-via-mcp.cjs` needs only its cache dir.
4. **Auth.** `gh auth login` (the account that can open PRs on StarOrga and publish to `Star-Citizen-Companion-Binaries`), `supabase login` (creates the Credential Manager entry), then `powershell -ExecutionPolicy Bypass -File scripts/set-supabase-env.ps1` and **restart the Desktop app**. Verify: `node scripts/routine-gate.mjs check --dry-run` prints a JSON verdict (needs the PAT) and the Supabase MCP connects in a project session.
5. **Register the three tasks.** Write the prompts first: `node scripts/sync-routine-prompts.mjs --to-live` (creates `~/.claude/scheduled-tasks/<taskId>/SKILL.md` from the repo copies). Then, in a Claude session of this project, ask for the three tasks to be created with **exactly** these parameters (tool `mcp__scheduled-tasks__create_scheduled_task` — it overwrites the SKILL.md with the prompt you pass, so pass the file's body verbatim, or create the task and then run `--to-live` again):

   | taskId | title | cron (local time) | jitter | notify |
   |---|---|---|---|---|
   | `nightly-admin-feedback` | `SCC Web Auto-Feedback Developpment` | `0,20,40 19-23,0 * * *` | 421 s | off |
   | `nightly-admin-feedback-day` | `SCC Web Auto-Feedback Developpment (day)` | `0 1,3,5,7-18 * * *` | 107 s | off |
   | `routine-janitor` | `SCC Web Routine Janitor` | `0 */4 * * *` | 0 | off |

   The descriptions are the `description:` lines of the three SKILL.md files. Jitter is set by the app on creation (cannot be chosen); the values above are what the current tasks have and only matter for the cadence explanation in `.claude/deep-knowledge/scheduled-tasks.md`. Titles must differ (the app refuses duplicates).
6. **Verify.** `npm run verify:routine-prompts` → OK (live files = repo copies, bodies identical). Click "Run now" on the janitor task once: its report line must show archive calls on sessions quiet for ≥ 2 h going through without a consent card (fresh ones are deferred by design, #624). Wait for the next feedback tick: the report must be one gate line plus the workspace-check line, and `public.routine_heartbeat` must move.
7. **Optional, recommended:** restore the memory directory from wherever you keep it (it is not in git); without it Claude starts this project without its accumulated hazards list — the repo's `.claude/deep-knowledge/` carries the routine-critical part.

## Keeping the backup fresh

- After every edit of a live prompt: `npm run sync:routine-prompts` (evening body → day file, all three → `docs/routine/tasks/`, snapshots refreshed), then ship. `prebuild` fails when the repo copies drift from the live files on the operator machine, so a forgotten sync cannot ship.
- Cron / title changes are made in the app and must be mirrored in the table above and in `.claude/deep-knowledge/scheduled-tasks.md`.
