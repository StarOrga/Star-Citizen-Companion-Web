#!/usr/bin/env node
/**
 * sync-routine-prompts — copy the LIVE Desktop scheduled-task prompts of this
 * project into the repo, so a lost machine can be rebuilt from git
 * (docs/routine/RESTORE.md) and so drift shows up in a diff.
 *
 *   node scripts/sync-routine-prompts.mjs            live → repo (default)
 *   node scripts/sync-routine-prompts.mjs --to-live  repo → live (a fresh machine:
 *                                                    writes the SKILL.md files the
 *                                                    Desktop app's task registry
 *                                                    is then pointed at, see RESTORE.md)
 *
 * Live files:  ~/.claude/scheduled-tasks/<taskId>/SKILL.md  (CLAUDE_CONFIG_DIR honoured)
 * Repo copies: docs/routine/tasks/<taskId>/SKILL.md          (byte-for-byte, LF)
 *              docs/routine/SKILL.snapshot.md                (header + evening file)
 *              docs/routine/JANITOR.snapshot.md              (header + janitor file)
 *
 * The evening file is the source of the shared body: the day file gets the
 * evening body under its own frontmatter (the two must stay identical —
 * scripts/check-routine-prompts.mjs enforces it in prebuild).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const TASK_DIR = join(CONFIG_DIR, 'scheduled-tasks');
export const TASKS = ['nightly-admin-feedback', 'nightly-admin-feedback-day', 'routine-janitor'];
const EVENING = 'nightly-admin-feedback';
const DAY = 'nightly-admin-feedback-day';
const JANITOR = 'routine-janitor';

const lf = (s) => s.replace(/\r\n/g, '\n');
const livePath = (t) => join(TASK_DIR, t, 'SKILL.md');
const repoPath = (t) => join(REPO, 'docs', 'routine', 'tasks', t, 'SKILL.md');

export function split(text) {
  const s = lf(text);
  if (!s.startsWith('---\n')) throw new Error('no YAML frontmatter');
  const end = s.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('unterminated frontmatter');
  return { frontmatter: s.slice(0, end + 5), body: s.slice(end + 5) };
}

const SNAPSHOT_HEADER = `<!-- SNAPSHOT of the scheduled-task prompt at C:\\Users\\Jerem\\.claude\\scheduled-tasks\\nightly-admin-feedback\\SKILL.md.
     The scheduler reads the file under ~/.claude, NOT this copy (concept 2026-09-13, E2a: the routine must never load
     its own prompt from a repo it merges into). This snapshot exists so drift between prompt and runbook shows up in a
     diff. Refresh it whenever the prompt changes: npm run sync:routine-prompts (keeps this header). -->
`;
const JANITOR_HEADER = `<!-- Snapshot of ~/.claude/scheduled-tasks/routine-janitor/SKILL.md (the live prompt of the
     Desktop scheduled task "SCC Web Routine Janitor", cron 0 */4 * * *). Refreshed by
     npm run sync:routine-prompts; checked by scripts/check-routine-prompts.mjs. -->
`;

function toRepo() {
  const missing = TASKS.filter((t) => !existsSync(livePath(t)));
  if (missing.length) throw new Error(`live task file(s) missing: ${missing.join(', ')} — nothing synced`);
  const evening = lf(readFileSync(livePath(EVENING), 'utf8'));
  // Day file = its own frontmatter + the evening body (the shared-body rule).
  const dayLive = lf(readFileSync(livePath(DAY), 'utf8'));
  const day = split(dayLive).frontmatter + split(evening).body;
  if (day !== dayLive) { writeFileSync(livePath(DAY), day); console.log(`[sync-routine-prompts] day task body refreshed from the evening file`); }
  const janitor = lf(readFileSync(livePath(JANITOR), 'utf8'));
  for (const [t, text] of [[EVENING, evening], [DAY, day], [JANITOR, janitor]]) {
    mkdirSync(dirname(repoPath(t)), { recursive: true });
    writeFileSync(repoPath(t), text);
  }
  writeFileSync(join(REPO, 'docs', 'routine', 'SKILL.snapshot.md'), SNAPSHOT_HEADER + evening);
  writeFileSync(join(REPO, 'docs', 'routine', 'JANITOR.snapshot.md'), JANITOR_HEADER + janitor);
  console.log(`[sync-routine-prompts] repo copies + snapshots refreshed from ${TASK_DIR}`);
}

function toLive() {
  for (const t of TASKS) {
    if (!existsSync(repoPath(t))) throw new Error(`repo copy missing: ${repoPath(t)}`);
    mkdirSync(dirname(livePath(t)), { recursive: true });
    writeFileSync(livePath(t), lf(readFileSync(repoPath(t), 'utf8')));
    console.log(`[sync-routine-prompts] wrote ${livePath(t)}`);
  }
  console.log('[sync-routine-prompts] now register the three tasks in the Desktop app (docs/routine/RESTORE.md, step 5)');
}

const isMain = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
  try {
    if (process.argv.includes('--to-live')) toLive(); else toRepo();
  } catch (e) {
    console.error(`[sync-routine-prompts] ${e.message}`);
    process.exitCode = 1;
  }
}
