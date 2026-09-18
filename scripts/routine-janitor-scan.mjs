#!/usr/bin/env node
/**
 * routine-janitor-scan — classify the feedback routine's Desktop sessions for
 * the /routine-janitor sweep, from the app's own session records.
 *
 *   node scripts/routine-janitor-scan.mjs [--json] [--now <iso>] [--min-age-min <n>]
 *
 * Reads every %APPDATA%\Claude\claude-code-sessions\**\*.json whose
 * `scheduledTaskId` is one of the two routine tasks (the Desktop "Runs" pane
 * and `list_task_runs` cap at 50 per task and list NOTHING for the day task —
 * 2026-09-18 — so the records are the only complete source). Prints, as JSON:
 *
 *   archive: un-archived idle ticks + un-archived working runs beyond the 3
 *            newest (both tasks together)
 *   deferred: archive candidates younger than --min-age-min (empty by default)
 *   delete:  idle ticks (archived or not) whose last activity is > 60 min ago,
 *            oldest first, at most 25
 *   keep:    the working runs left un-archived
 *   running: records touched within the last 3 min (never touched)
 *
 * Idle vs working = duration (lastActivityAt − createdAt) < 180 s. Policy in
 * .claude/skills/routine-janitor/SKILL.md. Read-only: it never archives or
 * deletes — the interactive janitor does that with the session tools.
 *
 * The age gate (`--min-age-min`, default 0 = off) is a leftover of a refuted
 * hypothesis: on 2026-09-18 the scheduled janitor (bypass mode) got a consent
 * card for its archive calls and it looked as if only fresh targets drew it.
 * A timed probe the same evening archived a 64-min-old tick WITH a card and a
 * 27-min-old one 8 s later WITHOUT — the card is one per scheduled session,
 * on the first archive_session call, and the operator's click covers the
 * rest of that session (the card offers no "remember" option). Target age is
 * irrelevant, so nothing is deferred by default; the flag stays for
 * experiments. Details: .claude/deep-knowledge/scheduled-tasks.md.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { newestActivity, transcriptDirFor } from './routine-gate.mjs';

// The janitor's own scheduled runs are ticks too (one per firing) and are swept
// by the next one; the current run is protected by the 3-minute "running" rule.
export const TASK_IDS = new Set(['nightly-admin-feedback', 'nightly-admin-feedback-day', 'routine-janitor']);
export const WORKING_MS = 180_000;
export const RUNNING_MS = 3 * 60_000;
export const IDLE_DELETE_MS = 60 * 60_000;
export const KEEP_WORKING = 3;
export const DELETE_CAP = 25;
export const ARCHIVE_MIN_AGE_MS = 0;

export function sessionsRoot() {
  const appData = process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return join(appData, 'Claude', 'claude-code-sessions');
}

function* jsonFiles(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* jsonFiles(p);
    else if (e.name.endsWith('.json')) yield p;
  }
}

/** Load the routine's session records: {id, task, created, last, archived, title}. */
export function loadRecords(root = sessionsRoot()) {
  const out = [];
  for (const f of jsonFiles(root)) {
    let o;
    try { o = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    if (!TASK_IDS.has(o?.scheduledTaskId) || typeof o.sessionId !== 'string') continue;
    const created = Number(o.createdAt);
    let last = Number(o.lastActivityAt);
    if (!Number.isFinite(last)) { try { last = statSync(f).mtimeMs; } catch { last = created; } }
    // The record's lastActivityAt lags minutes behind a live session (2026-09-18
    // 16:05: a run that had taken the lock at 16:02 read as "idle, 3 min quiet"
    // and the archive call blocked 4 min before the app refused it). The CLI
    // transcript (own file + subagents) is written live — take the newer of the two.
    if (typeof o.cliSessionId === 'string' && typeof o.cwd === 'string') {
      const t = newestActivity(transcriptDirFor(o.cwd), o.cliSessionId);
      if (t !== null && t > last) last = t;
    }
    out.push({ id: o.sessionId, task: o.scheduledTaskId, created, last, archived: o.isArchived === true, title: o.title ?? '' });
  }
  return out;
}

/** Pure classification — see the header. */
export function classify(records, now = Date.now(), minAgeMs = ARCHIVE_MIN_AGE_MS) {
  const running = [];
  const idle = [];
  const working = [];
  for (const r of records) {
    if (!Number.isFinite(r.created)) continue;
    if (now - r.last < RUNNING_MS) { running.push(r); continue; }
    (r.last - r.created >= WORKING_MS ? working : idle).push(r);
  }
  working.sort((a, b) => b.created - a.created);
  const keep = working.filter((r) => !r.archived).slice(0, KEEP_WORKING);
  const keepIds = new Set(keep.map((r) => r.id));
  const candidates = [
    ...idle.filter((r) => !r.archived).map((r) => ({ ...r, why: 'idle tick' })),
    ...working.filter((r) => !r.archived && !keepIds.has(r.id)).map((r) => ({ ...r, why: 'older than the 3 newest working runs' })),
  ];
  const archive = candidates.filter((r) => now - r.last >= minAgeMs);
  const deferred = candidates.filter((r) => now - r.last < minAgeMs);
  const del = idle.filter((r) => now - r.last > IDLE_DELETE_MS).sort((a, b) => a.last - b.last);
  return {
    archive,
    deferred,
    delete: del.slice(0, DELETE_CAP),
    deletePending: Math.max(0, del.length - DELETE_CAP),
    keep,
    running,
    totals: { records: records.length, idle: idle.length, working: working.length },
  };
}

const iso = (t) => new Date(t).toISOString();
const brief = (r) => ({ id: r.id, task: r.task, started: iso(r.created), last: iso(r.last), archived: r.archived, ...(r.why ? { why: r.why } : {}) });

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  const args = process.argv.slice(2);
  const nowArg = args.indexOf('--now');
  const now = nowArg >= 0 ? Date.parse(args[nowArg + 1]) : Date.now();
  const ageArg = args.indexOf('--min-age-min');
  const minAgeMs = ageArg >= 0 ? Number(args[ageArg + 1]) * 60_000 : ARCHIVE_MIN_AGE_MS;
  const c = classify(loadRecords(), now, minAgeMs);
  const out = {
    archive: c.archive.map(brief),
    deferred: c.deferred.map(brief),
    delete: c.delete.map(brief),
    deletePending: c.deletePending,
    keep: c.keep.map(brief),
    running: c.running.map(brief),
    totals: c.totals,
  };
  process.stdout.write(JSON.stringify(out, null, args.includes('--json') ? 0 : 1) + '\n');
}
