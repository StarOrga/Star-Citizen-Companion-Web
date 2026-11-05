# Restoring the feedback routine on a fresh machine

The routine is a Windows Task Scheduler job plus one prompt file. Everything needed
to rebuild it is in this repo or in the home backup; the rest is a manual step.
Order matters. How it works: [`../feedback-routine/watcher.md`](../feedback-routine/watcher.md).

## What lives where

| Piece | Where | Backed up? |
|---|---|---|
| Prompt of the headless run | `docs/routine/tasks/scc-feedback-headless/SKILL.md`, live under `~/.claude/scheduled-tasks/`, checked by `prebuild` | yes (git, and the machine backup repo) |
| Watcher, gate, runbook, hooks, deep-knowledge, `.mcp.json`, `.claude/settings.json` | repo | yes |
| Task registration | Task Scheduler, written by `npm run watcher -- install` | recreated by that command |
| devops plugin (ship MCP, hooks) | `github.com/Jerry0022/dotclaude` marketplace | yes (re-install) |
| Supabase CLI PAT | Windows Credential Manager `Supabase CLI:supabase` and user env `SUPABASE_ACCESS_TOKEN` | **no: `supabase login` again** |
| GitHub auth for `gh` | `gh auth login` | **no** |
| Claude login | `claude` then `/login` | **no** |
| Project memory and `~/.claude/CLAUDE.md` | home backup (`claude-home` branch of the backup repo) | yes |
| Attempts and cooldowns | `~/.claude/scc-routine/state.json` | no, and not needed: they start over |

## Steps

1. **Clone and deps.** `git clone https://github.com/StarOrga/Star-Citizen-Companion-Web.git P:\Projects\Star-Citizen-Companion-Web`. The path matters: the prompt names it as REPO. On another path, edit the prompt and sync it.
2. **Claude CLI and plugin.** Install Claude Code (`claude` on PATH), `/login`, then `claude plugin marketplace add https://github.com/Jerry0022/dotclaude.git` and `claude plugin install devops@dotclaude`. Trust the folder once by running `claude` in the primary checkout.
3. **Auth.** `gh auth login` (the account that can open PRs on StarOrga), `supabase login`, then `powershell -ExecutionPolicy Bypass -File scripts/set-supabase-env.ps1`. Verify: `node scripts/routine-gate.mjs check --dry-run` prints a JSON verdict.
4. **Register.** From the primary checkout: `npm run watcher -- install`. It copies the prompt to `~/.claude/scheduled-tasks/scc-feedback-headless/SKILL.md` and registers "SCC Feedback Watcher" (every 3 min and at logon, hidden, for the logged-on user).
5. **Verify.** `npm run verify:routine-prompts` prints OK, `npm run watcher -- status` shows the task, and `public.routine_heartbeat.last_seen_at` moves within 3 minutes.

## Keeping the backup fresh

After a merged edit of the prompt, from the primary checkout: `npm run sync:routine-prompts -- --to-live`. A run reads the live file at its start, so a running run keeps its prompt. `npm run watcher -- status` shows `promptInSync`; `prebuild` fails on drift only in the primary checkout and just warns in a worktree, so updating the live file cannot stop a running worker.
