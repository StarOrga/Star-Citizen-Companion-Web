#!/usr/bin/env node
/**
 * sync-routine-prompts — keeps the headless run's live prompt and its repo copy equal.
 *
 *   node scripts/sync-routine-prompts.mjs            live → repo (default)
 *   node scripts/sync-routine-prompts.mjs --to-live  repo → live (edit in the repo, or a fresh machine)
 *
 * Live: ~/.claude/scheduled-tasks/scc-feedback-headless/SKILL.md (CLAUDE_CONFIG_DIR honoured)
 * Repo: docs/routine/tasks/scc-feedback-headless/SKILL.md
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const PROMPT = 'scc-feedback-headless';
const live = join(CONFIG_DIR, 'scheduled-tasks', PROMPT, 'SKILL.md');
const copy = join(REPO, 'docs', 'routine', 'tasks', PROMPT, 'SKILL.md');
const [from, to] = process.argv.includes('--to-live') ? [copy, live] : [live, copy];
if (!existsSync(from)) {
  console.error(`[sync-routine-prompts] missing: ${from}`);
  process.exitCode = 1;
} else {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`[sync-routine-prompts] ${from} → ${to}`);
}
