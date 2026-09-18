#!/usr/bin/env node
/**
 * check-routine-prompts — the feedback routine runs as THREE Desktop scheduled
 * tasks: two with one prompt body (evening cron + day/night cron) and the
 * janitor (see .claude/deep-knowledge/scheduled-tasks.md). Nothing in the
 * Desktop app keeps the two SKILL.md bodies identical, and nothing keeps the
 * repo copies (docs/routine/tasks/<taskId>/SKILL.md — the restore source, see
 * docs/routine/RESTORE.md) in step with the live prompts — this check does,
 * and it runs in `prebuild`, so a drift fails the build of every ship and of
 * every routine worker. Refresh with `npm run sync:routine-prompts`.
 *
 *   node scripts/check-routine-prompts.mjs
 *
 * Exit 0: bodies identical, repo copies and snapshots in sync — or no
 *         scheduled-task directory on this machine (CI, Vercel, a fresh
 *         clone): SKIP.
 * Exit 1: the two feedback bodies differ, a repo copy or snapshot drifted, or
 *         a task that exists in the repo is missing live (only the two
 *         feedback tasks are mandatory; a missing janitor is reported as a
 *         warning).
 *
 * "Body" = everything after the YAML frontmatter (name/description are
 * per-task by design). Line endings and trailing whitespace are normalised.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const TASK_DIR = join(CONFIG_DIR, 'scheduled-tasks');
const FEEDBACK = ['nightly-admin-feedback', 'nightly-admin-feedback-day'];
const JANITOR = 'routine-janitor';
const SNAPSHOTS = {
  'nightly-admin-feedback': join(REPO, 'docs', 'routine', 'SKILL.snapshot.md'),
  [JANITOR]: join(REPO, 'docs', 'routine', 'JANITOR.snapshot.md'),
};
const copyPath = (t) => join(REPO, 'docs', 'routine', 'tasks', t, 'SKILL.md');
const livePath = (t) => join(TASK_DIR, t, 'SKILL.md');

const tag = '[check-routine-prompts]';
const norm = (s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '') + '\n';

function body(text) {
  const s = text.replace(/\r\n/g, '\n');
  if (!s.startsWith('---\n')) return null;
  const end = s.indexOf('\n---\n', 4);
  if (end < 0) return null;
  return norm(s.slice(end + 5));
}

function firstDiff(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return { line: i + 1, a: la[i] ?? '<missing>', b: lb[i] ?? '<missing>' };
  }
  return null;
}

const errors = [];
const fail = (msg, d, aName, bName) => {
  errors.push(msg);
  if (d) { errors.push(`  ${aName}: ${d.a.slice(0, 120)}`); errors.push(`  ${bName}: ${d.b.slice(0, 120)}`); }
};

if (!existsSync(TASK_DIR)) {
  console.log(`${tag} SKIP — no scheduled-task directory at ${TASK_DIR} (not the operator machine)`);
  process.exit(0);
}
const feedbackLive = FEEDBACK.map(livePath).filter(existsSync);
if (feedbackLive.length === 0) {
  console.log(`${tag} SKIP — none of the routine tasks exist here (${FEEDBACK.join(', ')})`);
  process.exit(0);
}
if (feedbackLive.length !== FEEDBACK.length) {
  fail(`the routine needs both feedback tasks, found only: ${feedbackLive.join(', ')}`);
} else {
  const [evening, day] = FEEDBACK.map((t) => body(readFileSync(livePath(t), 'utf8')));
  if (!evening || !day) fail('a task SKILL.md has no YAML frontmatter');
  else if (evening !== day) fail(`the two feedback task bodies differ (first difference at body line ${firstDiff(evening, day).line}) — run npm run sync:routine-prompts`, firstDiff(evening, day), FEEDBACK[0], FEEDBACK[1]);
}

// Repo copies: byte-for-byte (normalised) equal to the live file, for every task that exists live.
const tasks = [...FEEDBACK, JANITOR];
for (const t of tasks) {
  const live = livePath(t);
  if (!existsSync(live)) {
    if (t === JANITOR) console.warn(`${tag} WARN — janitor task not registered on this machine (${live}); see docs/routine/RESTORE.md`);
    continue;
  }
  if (!existsSync(copyPath(t))) { fail(`repo copy missing: docs/routine/tasks/${t}/SKILL.md — run npm run sync:routine-prompts`); continue; }
  const a = norm(readFileSync(live, 'utf8'));
  const b = norm(readFileSync(copyPath(t), 'utf8'));
  if (a !== b) fail(`docs/routine/tasks/${t}/SKILL.md drifted from the live prompt (first difference at line ${firstDiff(a, b).line}) — run npm run sync:routine-prompts`, firstDiff(a, b), 'live', 'repo');
}

// Snapshots: header + the live file verbatim (body compared).
for (const [t, snap] of Object.entries(SNAPSHOTS)) {
  if (!existsSync(livePath(t))) continue;
  if (!existsSync(snap)) { fail(`snapshot missing: ${snap} — run npm run sync:routine-prompts`); continue; }
  const s = readFileSync(snap, 'utf8').replace(/\r\n/g, '\n');
  const headerEnd = s.indexOf('-->\n');
  const snapBody = headerEnd < 0 ? null : body(s.slice(headerEnd + 4));
  const live = body(readFileSync(livePath(t), 'utf8'));
  if (!snapBody) fail(`snapshot has no header/frontmatter: ${snap}`);
  else if (snapBody !== live) fail(`${snap.slice(REPO.length + 1)} drifted from the live prompt (first difference at body line ${firstDiff(live, snapBody).line}) — run npm run sync:routine-prompts`, firstDiff(live, snapBody), 'live', 'snapshot');
}

if (errors.length) {
  console.error(`${tag} FAIL —`);
  for (const e of errors) console.error(`  ${e}`);
  process.exitCode = 1;
} else {
  const n = body(readFileSync(livePath(FEEDBACK[0]), 'utf8')).split('\n').length;
  const j = existsSync(livePath(JANITOR)) ? ', janitor copy in sync' : '';
  console.log(`${tag} OK — both feedback bodies identical, repo copies + snapshots in sync (${n} lines${j})`);
}
