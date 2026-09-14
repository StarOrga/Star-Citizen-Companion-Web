#!/usr/bin/env node
/**
 * check-routine-prompts — the feedback routine runs as TWO Desktop scheduled
 * tasks with one prompt body (evening cron + day/night cron, see
 * .claude/deep-knowledge/scheduled-tasks.md). Nothing in the Desktop app keeps
 * the two SKILL.md files identical, and nothing keeps the repo snapshot in
 * step with the live prompt — this check does, and it runs in `prebuild`, so
 * a drift fails the build of every ship and of every routine worker.
 *
 *   node scripts/check-routine-prompts.mjs
 *
 * Exit 0: bodies identical and snapshot in sync — or no scheduled-task
 *         directory on this machine (CI, Vercel, a fresh clone): SKIP.
 * Exit 1: the two task bodies differ, the snapshot drifted, or only one of
 *         the two tasks exists.
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
const TASKS = ['nightly-admin-feedback', 'nightly-admin-feedback-day'];
const SNAPSHOT = join(REPO, 'docs', 'routine', 'SKILL.snapshot.md');

const tag = '[check-routine-prompts]';

function body(text) {
  const s = text.replace(/\r\n/g, '\n');
  if (!s.startsWith('---\n')) return null;
  const end = s.indexOf('\n---\n', 4);
  if (end < 0) return null;
  return s.slice(end + 5).replace(/[ \t]+$/gm, '').replace(/\n+$/, '') + '\n';
}

function firstDiff(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return { line: i + 1, a: la[i] ?? '<missing>', b: lb[i] ?? '<missing>' };
  }
  return null;
}

if (!existsSync(TASK_DIR)) {
  console.log(`${tag} SKIP — no scheduled-task directory at ${TASK_DIR} (not the operator machine)`);
  process.exit(0);
}

const files = TASKS.map((t) => join(TASK_DIR, t, 'SKILL.md'));
const present = files.filter((f) => existsSync(f));
if (present.length === 0) {
  console.log(`${tag} SKIP — none of the routine tasks exist here (${TASKS.join(', ')})`);
  process.exit(0);
}
if (present.length !== files.length) {
  console.error(`${tag} FAIL — the routine needs both tasks, found only: ${present.join(', ')}`);
  process.exitCode = 1;
} else {
  const [evening, day] = files.map((f) => body(readFileSync(f, 'utf8')));
  if (!evening || !day) {
    console.error(`${tag} FAIL — a task SKILL.md has no YAML frontmatter`);
    process.exitCode = 1;
  } else if (evening !== day) {
    const d = firstDiff(evening, day);
    console.error(`${tag} FAIL — the two task bodies differ (first difference at body line ${d.line}):`);
    console.error(`  ${TASKS[0]}: ${d.a.slice(0, 120)}`);
    console.error(`  ${TASKS[1]}: ${d.b.slice(0, 120)}`);
    console.error('  Edit the evening file, then copy its body (everything after the frontmatter) to the day file.');
    process.exitCode = 1;
  } else if (!existsSync(SNAPSHOT)) {
    console.error(`${tag} FAIL — snapshot missing: ${SNAPSHOT}`);
    process.exitCode = 1;
  } else {
    // The snapshot is a 4-line HTML comment header followed by the evening SKILL.md verbatim.
    const snap = readFileSync(SNAPSHOT, 'utf8').replace(/\r\n/g, '\n');
    const headerEnd = snap.indexOf('-->\n');
    const snapBody = headerEnd < 0 ? null : body(snap.slice(headerEnd + 4));
    if (!snapBody) {
      console.error(`${tag} FAIL — snapshot has no header/frontmatter: ${SNAPSHOT}`);
      process.exitCode = 1;
    } else if (snapBody !== evening) {
      const d = firstDiff(evening, snapBody);
      console.error(`${tag} FAIL — docs/routine/SKILL.snapshot.md drifted from the live prompt (first difference at body line ${d.line}):`);
      console.error(`  live:     ${d.a.slice(0, 120)}`);
      console.error(`  snapshot: ${d.b.slice(0, 120)}`);
      console.error('  Refresh: { head -4 docs/routine/SKILL.snapshot.md; cat ~/.claude/scheduled-tasks/nightly-admin-feedback/SKILL.md; } > docs/routine/SKILL.snapshot.md');
      process.exitCode = 1;
    } else {
      console.log(`${tag} OK — both task bodies identical, snapshot in sync (${evening.split('\n').length} lines)`);
    }
  }
}
