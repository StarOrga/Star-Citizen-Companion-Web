#!/usr/bin/env node
/**
 * check-routine-prompts — the headless feedback run reads its prompt from
 * ~/.claude/scheduled-tasks/scc-feedback-headless/SKILL.md, deliberately not
 * from the repo it merges into (concept 2026-09-13, E2a). The repo copy
 * docs/routine/tasks/scc-feedback-headless/SKILL.md is the source a fresh
 * machine is restored from, and this check keeps the two equal; it runs in
 * `prebuild`, so a drift fails every ship. Refresh with
 * `npm run sync:routine-prompts` (live → repo) or `-- --to-live`.
 *
 * A worktree only warns: its branch may be older or newer than the live prompt
 * without anything being wrong, and a failing prebuild there would stop a running
 * headless worker the moment the live prompt is updated.
 *
 * Exit 0: in sync — or no live prompt on this machine (CI, Vercel): SKIP.
 * Exit 1: drift.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const PROMPT = 'scc-feedback-headless';
const live = join(CONFIG_DIR, 'scheduled-tasks', PROMPT, 'SKILL.md');
const copy = join(REPO, 'docs', 'routine', 'tasks', PROMPT, 'SKILL.md');
const tag = '[check-routine-prompts]';
const norm = (s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '') + '\n';

if (!existsSync(live)) {
  console.log(`${tag} SKIP — no live prompt at ${live} (not the operator machine)`);
} else if (!existsSync(copy)) {
  console.error(`${tag} FAIL — repo copy missing: docs/routine/tasks/${PROMPT}/SKILL.md`);
  process.exitCode = 1;
} else {
  const a = norm(readFileSync(live, 'utf8')).split('\n');
  const b = norm(readFileSync(copy, 'utf8')).split('\n');
  const at = a.findIndex((l, i) => l !== b[i]);
  if (at >= 0 || a.length !== b.length) {
    const line = at >= 0 ? at : Math.min(a.length, b.length);
    const inWorktree = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO);
    console.error(`${tag} ${inWorktree ? 'WARN' : 'FAIL'} — the live prompt and docs/routine/tasks/${PROMPT}/SKILL.md differ at line ${line + 1}: run npm run sync:routine-prompts`);
    if (!inWorktree) process.exitCode = 1;
  } else {
    console.log(`${tag} OK — live prompt and repo copy in sync (${a.length} lines)`);
  }
}
