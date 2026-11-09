#!/usr/bin/env node
/**
 * Feedback watcher — replaces the Desktop scheduled tasks: nothing here spends a
 * token until the board really holds work, and whatever a headless run leaves
 * behind is settled without a model afterwards.
 *
 *   tick       every 3 min from Windows Task Scheduler (no model). Stamps the
 *              heartbeat, recovers a dead run, posts owed replies, parks items out
 *              of attempts, and starts `supervise` when work is due.
 *   supervise  owns one `claude -p` run: lock, keep-awake, watchdog, then postflight.
 *   status     prints what the watcher knows (JSON).
 *   install    registers the task and the live prompt (run from the primary checkout).
 *   uninstall  removes the task.
 *
 * Failure table and recovery rules: docs/feedback-routine/watcher.md.
 * Node stdlib only: this must run on a checkout without node_modules.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, fstatSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RUNNER_NAME, newestActivity, sql, transcriptDirFor } from './routine-gate.mjs';
import {
  REPLY_GIVE_UP_MIN, TERMINAL_STATUSES, WATCH_INTERVAL_MIN, applyRun, classifyBranch, classifyExit, describeSpawnFailure, emptyState,
  holdClosedMessage, holdMessage, isHang, itemKey, mayRemoveRunFile, mergedSinceClaim, needsDeployCheck, parkMessage, planQueue,
  plainShippedMessage, productionLive, runClaimVerdict, shortIdOfBranch, shouldNotify, watchdogStep,
} from './lib/routine-watcher-core.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(REPO, 'scripts', 'routine-gate.mjs');
// Not under AppData: an MSIX app (Claude Desktop) gets its own copy-on-write view of it, so a session and the
// real task would read different files with the same name. ~/.claude's backup allowlist does not include this folder.
const HOME = process.env.SCC_ROUTINE_HOME || join(homedir(), '.claude', 'scc-routine');
const LOGS = join(HOME, 'logs');
const STATE_FILE = join(HOME, 'state.json');
const RUN_FILE = join(HOME, 'run.json');
const TICK_LOCK = join(HOME, 'tick.lock');
const TASK_NAME = 'SCC Feedback Watcher';
const PROMPT_ID = 'scc-feedback-headless';
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const LIVE_PROMPT = join(CONFIG_DIR, 'scheduled-tasks', PROMPT_ID, 'SKILL.md');
const REPO_PROMPT = join(REPO, 'docs', 'routine', 'tasks', PROMPT_ID, 'SKILL.md');
const WORKTREES = join(REPO, '.claude', 'worktrees');
/** Where the headless session lives. Not the primary: its Bash calls would all count as "on main" and the main-branch guard refuses every git write, also a worker's `cd <worktree> && git commit`. */
const RUNNER = join(WORKTREES, RUNNER_NAME);
/** Tools that only make sense with someone watching, or that outlive a print-mode run. */
const DISALLOWED = 'AskUserQuestion,EnterPlanMode,ExitPlanMode,ScheduleWakeup,CronCreate,CronDelete,RemoteTrigger,Monitor,Workflow,EnterWorktree,ExitWorktree';
/**
 * Pinned, never inherited: without these the run took whatever the CLI default was that day
 * (Opus until 2026-11-06, then Sonnet). `complex` topics raise the effort per worker inside the run
 * (SKILL.md STEP 3), not here. Overridable for a one-off experiment via env.
 */
const RUN_MODEL = process.env.SCC_ROUTINE_MODEL || 'opus';
const RUN_EFFORT = process.env.SCC_ROUTINE_EFFORT || 'medium';
/**
 * Prompt cache for the headless run only: 5-minute TTL instead of the 1-hour one. A 1-hour write costs
 * 2x input, a 5-minute write 1.25x; the run is a dense loop, so the short TTL still hits on nearly
 * every turn. Caching stays ON: without it every turn re-pays the whole context at full price.
 */
const RUN_CACHE_ENV = { FORCE_PROMPT_CACHING_5M: '1' };
const LOG_KEEP_DAYS = 14;

mkdirSync(LOGS, { recursive: true });

const log = (...m) => {
  const line = `${new Date().toISOString()} ${m.join(' ')}`;
  console.error(line);
  try { writeFileSync(join(LOGS, `watcher-${line.slice(0, 10)}.log`), `${line}\n`, { flag: 'a' }); } catch { /* the console line is all we have */ }
};
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: REPO, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 << 20, ...opts }).trim();
const shOk = (cmd, args, opts) => { try { return sh(cmd, args, opts); } catch { return null; } };

// ---------------------------------------------------------------- local state
function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  // A reader holding the file makes the rename fail on Windows for a moment.
  for (let i = 0; ; i++) {
    try { renameSync(tmp, file); return; } catch (e) {
      if (i >= 20) { rmSync(tmp, { force: true }); throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
const loadState = () => ({ ...emptyState(), ...(readJson(STATE_FILE) ?? {}) });
const saveState = (s) => writeJson(STATE_FILE, s);

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
/** Command line of a live pid — guards against a reused pid after a reboot. */
function commandLine(pid) {
  return shOk('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`]) ?? '';
}
const isOurs = (pid, needle) => pidAlive(pid) && commandLine(pid).includes(needle);
function killTree(pid) {
  if (pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
}
/** Every process of a run, found by the session id on its command line: a dead parent breaks the pid tree. */
function killSession(sid) {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -like '*${sid}*' } | ForEach-Object { $_.ProcessId }`;
  for (const pid of (shOk('powershell.exe', ['-NoProfile', '-Command', script]) ?? '').split(/\s+/).filter(Boolean)) {
    log(`killing leftover process ${pid} of run ${sid.slice(0, 8)}`);
    killTree(Number(pid));
  }
}
/** What a dead run left running inside its worktrees (ng, esbuild, Chrome). Scoped by path, never by name. */
function killWorktreeOrphans() {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -match 'worktrees[\\\\/]scfb-' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`;
  const out = shOk('powershell.exe', ['-NoProfile', '-Command', script]);
  if (out) log(`killed worktree orphans: ${out.replace(/\s+/g, ' ')}`);
}

function notify(state, kind, title, text) {
  const now = Date.now();
  if (!shouldNotify(state, kind, now)) return;
  state.notified = { ...state.notified, [kind]: now };
  const esc = (s) => s.replace(/'/g, "''");
  const ps = `Add-Type -AssemblyName System.Windows.Forms; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Warning; $n.Visible=$true; $n.ShowBalloonTip(15000,'${esc(title)}','${esc(text)}','Warning'); Start-Sleep 16; $n.Dispose()`;
  try { spawn('powershell.exe', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* a toast is a courtesy */ }
}

// ---------------------------------------------------------------- gate
const GATE_TIMEOUT_MS = 120_000;
/** One try. A child that never answered is described with its cause (timeout, signal, stderr tail), never a bare `exit null`. */
function gateOnce(args) {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd: REPO, encoding: 'utf8', windowsHide: true, timeout: GATE_TIMEOUT_MS });
  const line = (r.stdout || '').trim().split('\n').pop() || '';
  try { return { out: JSON.parse(line), r }; } catch { return { out: { verdict: 'error', error: describeSpawnFailure(r, GATE_TIMEOUT_MS).slice(-260) }, r }; }
}
function gate(args) {
  let { out, r } = gateOnce(args);
  // `check` and `heartbeat` are idempotent: a hang (no exit status) gets one more try before it counts as an error.
  if (out.verdict === 'error' && isHang(r) && ['check', 'heartbeat'].includes(args[0])) {
    log(`gate ${args[0]} hung (${out.error}), trying once more`);
    ({ out } = gateOnce(args));
  }
  return out;
}

// ---------------------------------------------------------------- board
const LAST = `left join lateral (select is_system, created_at from public.admin_feedback_messages m
    where m.feedback_id = f.id order by m.created_at desc limit 1) last on true`;
const LAST_HUMAN = `(select m.id from public.admin_feedback_messages m where m.feedback_id = f.id and m.is_system = false order by m.created_at desc limit 1)`;
/** The queues (a)(b)(d)(e) of the runbook — the same rules the gate counts. */
const queueItems = () => sql(`select f.id, f.seq, f.status, f.ship_ref, f.processed_at, ${LAST_HUMAN} as last_human_id
  from public.admin_feedback f ${LAST}
  where (f.status = 'open' and f.triaged)
     or (f.status = 'needs_input' and last.is_system = false)
     or (f.status = 'shipped' and last.is_system = false and last.created_at > coalesce(f.shipped_at, f.processed_at, f.created_at))
     or (f.status = 'in_progress' and f.ship_ref is not null and last.is_system = false)
  order by f.created_at asc`);
const reply = (id, body) => sql(`insert into public.admin_feedback_messages (feedback_id, is_system, body) values (${q(id)}, true, ${q(body)})`);

/** Every feedback PR GitHub knows. null when GitHub did not answer — never read that as "no PRs". */
function feedbackPrs() {
  const out = shOk('gh', ['pr', 'list', '--state', 'all', '--limit', '200', '--json', 'number,url,state,headRefName,mergedAt,mergeCommit,updatedAt']);
  if (out === null) return null;
  try { return JSON.parse(out).filter((p) => p.headRefName?.startsWith('feat/feedback-')); } catch { return null; }
}
const prsOf = (prs, shortId) => (prs ?? []).filter((p) => shortIdOfBranch(p.headRefName) === shortId);
function prByUrl(url) {
  const out = shOk('gh', ['pr', 'view', url, '--json', 'number,url,state,headRefName,mergedAt,mergeCommit,updatedAt']);
  try { return out ? JSON.parse(out) : null; } catch { return null; }
}

/** STEP 4.3 of the runbook for a merge whose run died before it got there. */
function ensureAlphaTag(sha) {
  try {
    sh('git', ['fetch', 'origin', 'main', '--quiet']);
    const version = JSON.parse(sh('git', ['show', `${sha}:package.json`])).version;
    const tag = `alpha/v${version}`;
    if (sh('git', ['ls-remote', '--tags', 'origin', tag])) return;
    sh('git', ['tag', '-a', tag, sha, '-m', JSON.stringify({ channel: 'alpha', version })]);
    sh('git', ['push', 'origin', tag]);
    log(`tagged ${tag} on ${sha.slice(0, 7)}`);
  } catch (e) { log(`alpha tag failed for ${sha.slice(0, 7)}: ${e.message}`); }
}

// ---------------------------------------------------------------- settle: no model involved
/** The review reply a merge still owes (query f). The ✅ wording only ever comes from verify-ship-live. */
async function settleReplies() {
  const rows = await sql(`select id, seq, ship_ref, shipped_at, summary, left(body, 140) as body from public.admin_feedback where status = 'shipped' and review_reply_pending`);
  for (const r of rows) {
    const changed = r.summary || r.body || '';
    const pr = r.ship_ref && /\/pull\/\d+/.test(r.ship_ref) ? prByUrl(r.ship_ref) : null;
    const sha = pr?.mergeCommit?.oid;
    if (!sha) {
      if (r.ship_ref && /\/pull\/\d+/.test(r.ship_ref) && !pr) continue; // GitHub is away: next tick
      await reply(r.id, plainShippedMessage(changed));
      await sql(`update public.admin_feedback set review_reply_pending = false where id = ${q(r.id)}`);
      continue;
    }
    const v = spawnSync(process.execPath, [join(REPO, 'scripts', 'verify-ship-live.mjs'), '--once', '--sha', sha, '--pr', r.ship_ref, '--changed', changed], { cwd: REPO, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
    const text = (v.stdout || '').trim();
    const age = Date.now() - Date.parse(r.shipped_at ?? 0);
    if (!text || (v.status !== 0 && age < REPLY_GIVE_UP_MIN * 60_000)) continue;
    await reply(r.id, text);
    await sql(`update public.admin_feedback set review_reply_pending = false where id = ${q(r.id)}`);
    log(`review reply posted for #${r.seq} (${v.status === 0 ? 'live' : 'not verified live'})`);
  }
}

/** Successful Production deployments, newest first, as { sha }. null when GitHub did not answer. */
function productionSuccesses() {
  const list = shOk('gh', ['api', 'repos/{owner}/{repo}/deployments?environment=Production&per_page=15']);
  if (list === null) return null;
  let deployments;
  try { deployments = JSON.parse(list); } catch { return null; }
  const successes = [];
  for (const d of deployments) {
    const st = shOk('gh', ['api', `repos/{owner}/{repo}/deployments/${d.id}/statuses?per_page=1`]);
    try { if (JSON.parse(st ?? '[]')[0]?.state === 'success') successes.push({ sha: d.sha }); } catch { /* next deployment */ }
  }
  return successes;
}
/**
 * "shipped" means online: a merged item gets `live_at` only once the Production deployment of its merge (or of a
 * later commit) succeeded. Until then the board shows it as merged-but-lagging and the author still sees "in progress".
 * Vercel Hobby skips builds at its rate limit, so the lag can last hours (2026-11-08: #1027 merged, production stayed behind).
 */
async function settleLive(state) {
  const rows = await sql(`select id, seq, ship_ref, shipped_at from public.admin_feedback where status = 'shipped' and live_at is null`);
  if (!rows.length) return;
  let successes;
  let fetched = false;
  for (const r of rows) {
    let live = !needsDeployCheck(r.ship_ref);
    let via = 'no PR';
    if (!live) {
      const pr = prByUrl(r.ship_ref);
      const sha = pr?.state === 'MERGED' ? pr.mergeCommit?.oid : null;
      if (!sha) continue; // GitHub is away, or the PR is not merged: next tick
      successes ??= productionSuccesses();
      if (successes === null) return;
      if (!fetched) { shOk('git', ['fetch', 'origin', 'main', '--quiet']); fetched = true; }
      const v = productionLive(sha, successes, (a, b) => shOk('git', ['merge-base', '--is-ancestor', a, b]) !== null);
      live = v.live; via = v.via?.slice(0, 10);
      if (!live && shouldNotify(state, `lag-${r.id}`, Date.now(), 3_600_000)) {
        state.notified = { ...state.notified, [`lag-${r.id}`]: Date.now() };
        saveState(state);
        log(`#${r.seq} merged ${Math.round((Date.now() - Date.parse(r.shipped_at ?? 0)) / 60_000)} min ago, production does not carry ${sha.slice(0, 10)} yet`);
      }
    }
    if (live) {
      await sql(`update public.admin_feedback set live_at = now() where id = ${q(r.id)} and status = 'shipped' and live_at is null`);
      log(`#${r.seq} is live (${via})`);
    }
  }
}

/** Parks an item out of attempts: a reply in the thread and out of the queue until a human answers. */
async function parkItem({ item, reason, attempts }, prs) {
  const shortId = item.id.slice(0, 8);
  const mine = prsOf(prs, shortId);
  const open = mine.find((p) => p.state === 'OPEN');
  const remote = shOk('git', ['ls-remote', '--heads', 'origin', `feat/feedback-${shortId}*`]) ?? '';
  const branch = /refs\/heads\/(\S+)/.exec(remote)?.[1] ?? null;
  const body = parkMessage({ attempts, reason, branch, prUrl: open?.url ?? null });
  await sql(`with u as (update public.admin_feedback
      set status = case when status = 'open' or (status = 'in_progress' and ship_ref is null) then 'needs_input' else status end,
          processing_note = ${q(`watcher: gave up after ${attempts} attempts: ${reason}`.slice(0, 500))}, processed_at = now()
      where id = ${q(item.id)} returning id)
    insert into public.admin_feedback_messages (feedback_id, is_system, body) select id, true, ${q(body)} from u`);
  log(`parked #${item.seq} after ${attempts} attempts: ${reason}`);
}

/** Uncommitted work of a dead run goes to the remote before the worktree does. */
function rescueWorktree(dir, runSid, reason) {
  const branch = shOk('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch || branch === 'HEAD' || !branch.startsWith('feat/feedback-')) return { branch, pushed: false };
  if (shOk('git', ['-C', dir, 'status', '--porcelain'])) {
    try {
      sh('git', ['-C', dir, 'add', '-A']);
      sh('git', ['-C', dir, 'commit', '-m', `wip: rescued by the feedback watcher (run ${runSid?.slice(0, 8) ?? '?'}: ${reason})`]);
      log(`rescued uncommitted work on ${branch}`);
    } catch (e) { log(`rescue commit failed on ${branch}: ${e.message}`); }
  }
  const head = shOk('git', ['-C', dir, 'rev-parse', 'HEAD']);
  const base = shOk('git', ['-C', dir, 'merge-base', 'HEAD', 'origin/main']);
  if (!head || head === base) return { branch, pushed: true, empty: true };
  try {
    sh('git', ['-C', dir, 'push', '-u', 'origin', `HEAD:refs/heads/${branch}`]);
    return { branch, pushed: true };
  } catch (e) {
    log(`push failed on ${branch}, worktree stays: ${e.message}`);
    return { branch, pushed: false };
  }
}
function removeWorktree(dir, branch) {
  const nm = join(dir, 'node_modules');
  // A junction must go first and only via rmdir: anything else follows it into the primary's deps.
  try { if (existsSync(nm) && shOk('cmd', ['/c', 'dir', '/AL', dir])?.includes('node_modules')) spawnSync('cmd', ['/c', 'rmdir', nm], { windowsHide: true }); } catch { /* checked again below */ }
  if (shOk('git', ['worktree', 'remove', '--force', dir]) === null) {
    if (existsSync(nm) && shOk('cmd', ['/c', 'dir', '/AL', dir])?.includes('node_modules')) { log(`worktree ${dir} keeps a junction, left alone`); return false; }
    spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', dir], { windowsHide: true });
    shOk('git', ['worktree', 'prune']);
  }
  if (branch) shOk('git', ['branch', '-D', branch]);
  return !existsSync(dir);
}
async function cleanWorktrees(runSid, reason) {
  if (!existsSync(WORKTREES)) return;
  const names = readdirSync(WORKTREES).filter((n) => n.startsWith('scfb-'));
  if (!names.length) return;
  const rows = await sql(`select left(id::text, 8) as short_id, status from public.admin_feedback`);
  const status = Object.fromEntries(rows.map((r) => [r.short_id, r.status]));
  for (const name of names) {
    const dir = join(WORKTREES, name);
    // A finished item's worktree holds nothing to save; pushing would only bring its merged branch back.
    if (TERMINAL_STATUSES.has(status[name.slice(5, 13)])) {
      removeWorktree(dir, shOk('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']));
      continue;
    }
    const r = rescueWorktree(dir, runSid, reason);
    if (r.pushed || !r.branch) removeWorktree(dir, r.pushed ? r.branch : null);
  }
}

/**
 * The contract: when a run is over, every item it touched is shipped, parked
 * with a reply, or a hold with a reply — or back in the queue for the next
 * attempt. A bare in_progress never survives a run.
 */
async function reconcileItems(reason) {
  const prs = feedbackPrs();
  const rows = await sql(`select f.id, f.seq, f.status, f.ship_ref, f.processed_at, f.processing_note, last.is_system as last_is_system, last.created_at as last_at
    from public.admin_feedback f ${LAST} where f.status = 'in_progress'`);
  for (const r of rows) {
    const shortId = r.id.slice(0, 8);
    if (r.ship_ref) {
      const pr = prByUrl(r.ship_ref);
      if (pr?.state === 'MERGED') await markShipped(r, pr);
      else if (pr?.state === 'CLOSED') {
        await sql(`with u as (update public.admin_feedback set status = 'needs_input', ship_ref = null, processing_note = 'watcher: hold PR closed unmerged', processed_at = now() where id = ${q(r.id)} and status = 'in_progress' returning id)
          insert into public.admin_feedback_messages (feedback_id, is_system, body) select id, true, ${q(holdClosedMessage(r.ship_ref))} from u`);
      } else if (pr && !(r.last_is_system && Date.parse(r.last_at) >= Date.parse(r.processed_at))) {
        // A hold nobody was told about is the silence this table exists to prevent.
        if (r.last_is_system !== false) await reply(r.id, holdMessage(r.ship_ref, r.processing_note));
      }
      continue;
    }
    if (prs === null) continue; // GitHub is away: decide next time, a false "no PR" would redo merged work
    const merged = mergedSinceClaim(prsOf(prs, shortId), r.processed_at);
    if (merged) { await markShipped(r, merged); continue; }
    const open = prsOf(prs, shortId).find((p) => p.state === 'OPEN');
    await sql(`update public.admin_feedback set status = 'open', processed_at = now(),
        processing_note = ${q(`watcher: run ended without finishing (${reason})${open ? ` — resume ${open.url}` : ''}`.slice(0, 500))}
      where id = ${q(r.id)} and status = 'in_progress' and ship_ref is null`);
    log(`#${r.seq} handed back to the queue (${reason})`);
  }
}
async function markShipped(r, pr) {
  const rows = await sql(`update public.admin_feedback set status = 'shipped', shipped_at = coalesce(${q(pr.mergedAt)}::timestamptz, now()), ship_ref = ${q(pr.url)},
      processing_note = null, processed_at = now(), review_reply_pending = true
    where id = ${q(r.id)} and status = 'in_progress' returning id`);
  if (rows.length && pr.mergeCommit?.oid) ensureAlphaTag(pr.mergeCommit.oid);
  log(`#${r.seq} marked shipped from ${pr.url}`);
}

/** A remote feedback branch lives exactly as long as its item is active. */
async function sweepBranches() {
  const prs = feedbackPrs();
  if (prs === null) { log('sweep skipped: GitHub did not answer'); return; }
  if (shOk('git', ['fetch', 'origin', '--prune', '--quiet', '+refs/heads/feat/feedback-*:refs/remotes/origin/feat/feedback-*']) === null) return;
  const refs = (shOk('git', ['for-each-ref', '--format=%(refname:strip=3)|%(committerdate:unix)', 'refs/remotes/origin/feat/feedback-*']) ?? '').split('\n').filter(Boolean);
  const branches = refs.map((l) => { const [branch, ts] = l.split('|'); return { branch, ts: Number(ts), shortId: shortIdOfBranch(branch) }; }).filter((b) => b.shortId);
  if (!branches.length) return;
  const ids = [...new Set(branches.map((b) => b.shortId))];
  const rows = await sql(`select left(id::text, 8) as short_id, status from public.admin_feedback where left(id::text, 8) in (${ids.map(q).join(',')})`);
  const status = Object.fromEntries(rows.map((r) => [r.short_id, r.status]));
  for (const b of branches) {
    const pr = prs.filter((p) => p.headRefName === b.branch).sort((x, y) => Date.parse(y.updatedAt) - Date.parse(x.updatedAt))[0];
    const action = classifyBranch({ status: status[b.shortId], prState: pr?.state ?? null, ageMin: (Date.now() / 1000 - b.ts) / 60 });
    if (action === 'keep') continue;
    if (action === 'close-delete') shOk('gh', ['pr', 'close', String(pr.number), '--comment', `Closed by the feedback watcher: the feedback item is ${status[b.shortId]}.`]);
    const tip = shOk('git', ['rev-parse', `refs/remotes/origin/${b.branch}`]);
    if (shOk('git', ['push', 'origin', '--delete', b.branch]) !== null) log(`deleted ${b.branch} (${status[b.shortId]}, tip ${tip?.slice(0, 10)})`);
  }
  // Local leftovers of the same branches.
  for (const local of (shOk('git', ['for-each-ref', '--format=%(refname:strip=2)', 'refs/heads/feat/feedback-*']) ?? '').split('\n').filter(Boolean)) {
    const s = status[shortIdOfBranch(local)];
    if (s && TERMINAL_STATUSES.has(s)) shOk('git', ['branch', '-D', local]);
  }
}
function pruneLogs() {
  const cut = Date.now() - LOG_KEEP_DAYS * 86_400_000;
  for (const f of readdirSync(LOGS)) {
    const p = join(LOGS, f);
    try { if (statSync(p).mtimeMs < cut) rmSync(p, { force: true }); } catch { /* next time */ }
  }
}

/** Everything after a run — also after a run nobody saw end. Throws when the board is unreachable, then it is retried. */
async function postflight(run, outcome) {
  log(`postflight run=${run.sid.slice(0, 8)} outcome=${outcome.kind}${outcome.reason ? ` (${outcome.reason})` : ''}`);
  killWorktreeOrphans();
  await cleanWorktrees(run.sid, outcome.reason ?? outcome.kind);
  const claimed = await sql(`select id from public.admin_feedback where processed_at >= ${q(run.startedIso)} and status = 'in_progress'`);
  await reconcileItems(outcome.reason ?? outcome.kind);
  const unresolved = await queueItems();
  const state = loadState();
  const stillQueued = new Set(unresolved.map((i) => i.id));
  const now = Date.now();
  const { state: next, charged } = applyRun({
    state, snapshot: run.snapshot, unresolvedIds: run.snapshot.filter((i) => stillQueued.has(i.id)).map((i) => i.id),
    claimedIds: claimed.map((c) => c.id), outcome, now,
  });
  next.lastSid = run.sid;
  if (outcome.kind === 'auth') notify(next, 'auth', 'SCC Feedback', 'Claude-Login abgelaufen: Feedback wartet, bis du dich neu anmeldest.');
  saveState(next);
  if (charged.length) log(`charged an attempt to: ${charged.map((c) => c.slice(0, 8)).join(', ')}`);
  await sweepBranches().catch((e) => log(`sweep failed: ${e.message}`));
  const usage = outcome.kind === 'usage-limit';
  const released = gate(['end-run', '--state', usage ? 'paused' : 'idle', '--note', usage ? 'paused-usage-limit' : `shipped:${run.snapshot.filter((i) => !stillQueued.has(i.id)).length}`]);
  if (!released.released) throw new Error(`end-run failed: ${released.error ?? 'no answer'}`);
}

// ---------------------------------------------------------------- tick
/**
 * Exclusive create, so two ticks cannot both hold it (the old read-remove-write let two ticks that started
 * together both pass). A stale lock is moved aside by rename: of two ticks that find it stale, one rename wins.
 */
function takeTickLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(TICK_LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') return false;
      const held = readJson(TICK_LOCK);
      // Unreadable = its writer is mid-write: held, unless the file is old.
      const fresh = held ? pidAlive(held.pid) && Date.now() - held.at < 15 * 60_000 : Date.now() - (statSync(TICK_LOCK, { throwIfNoEntry: false })?.mtimeMs ?? 0) < 60_000;
      if (fresh) return false;
      const aside = `${TICK_LOCK}.stale.${process.pid}`;
      try { renameSync(TICK_LOCK, aside); rmSync(aside, { force: true }); } catch { return false; }
    }
  }
  return false;
}
/**
 * The run file is claimed with an exclusive create before the supervisor is spawned. Two ticks that passed the
 * gate check together (one slow, 35 s later: 2026-11-06 15:24:04 / 15:24:39, #266) can no longer both start a run.
 */
function startSupervisor(snapshot, state) {
  const sid = randomUUID();
  const startedIso = new Date().toISOString();
  const run = { pid: process.pid, sid, startedIso, snapshot, attempts: Object.fromEntries(snapshot.map((i) => [i.id, (state.items[i.id]?.key === itemKey(i) ? state.items[i.id].attempts : 0) + 1])) };
  try { writeFileSync(RUN_FILE, JSON.stringify(run, null, 2), { flag: 'wx' }); } catch (e) {
    if (e.code === 'EEXIST') { log(`not starting a run: ${runClaimVerdict(true)} by another tick (${readJson(RUN_FILE)?.sid?.slice(0, 8) ?? 'unreadable'})`); return; }
    throw e;
  }
  let child;
  try {
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'supervise', sid], { cwd: REPO, detached: true, stdio: 'ignore', windowsHide: true });
    writeJson(RUN_FILE, { ...run, pid: child.pid });
  } catch (e) { rmSync(RUN_FILE, { force: true }); throw e; }
  child.unref();
  log(`started run ${sid.slice(0, 8)} for ${snapshot.map((i) => `#${i.seq}`).join(', ')}`);
}

async function tick() {
  if (!takeTickLock()) return;
  try {
    const run = readJson(RUN_FILE);
    // A file that exists but cannot be read is a run being written, not "no run".
    if (!run && existsSync(RUN_FILE)) { log('run file unreadable, leaving it to the next tick'); return; }
    const state = loadState();
    const now = Date.now();
    const awakeBefore = state.lastTickAt && now - state.lastTickAt < 10 * 60_000;
    state.lastTickAt = now;
    saveState(state);

    if (run) {
      if (isOurs(run.pid, 'routine-watcher')) {
        // Alive, but no sign of life over a stretch the PC was demonstrably awake ⇒ wedged.
        const beat = run.beatAt ?? Date.parse(run.startedIso);
        if (!(awakeBefore && now - beat > 30 * 60_000)) { gate(['heartbeat', '--note', 'running']); return; }
        log(`supervisor ${run.pid} is wedged, killing it`);
        killTree(run.pid);
      }
      // The supervisor is gone: PC shutdown, crash, kill. Its claude may still be running.
      killSession(run.sid);
      await postflight(run, run.outcome ?? { kind: 'interrupted', reason: 'run interrupted' });
      rmSync(RUN_FILE, { force: true });
      return;
    }

    const g = gate(['check']);
    if (g.verdict === 'error') {
      state.gateErrors = (state.gateErrors ?? 0) + 1;
      if (state.gateErrors >= 10) notify(state, 'gate', 'SCC Feedback', `Feedback-Watcher erreicht das Board nicht: ${String(g.error).slice(0, 120)}`);
      saveState(state);
      log(`gate error: ${g.error}`);
      return;
    }
    state.gateErrors = 0;
    if (g.verdict === 'running') {
      // A lock with no supervisor behind it: our own run whose end-run failed.
      const holder = readJson(join(REPO, '.claude', 'routine-run.json'));
      if (holder?.sid && holder.sid === state.lastSid) gate(['end-run', '--state', 'idle', '--note', 'queue-empty']);
      saveState(state);
      return;
    }

    if ((g.counts?.f ?? 0) > 0) await settleReplies();
    await settleLive(state).catch((e) => log(`settleLive failed: ${e.message}`));
    if (!state.lastSweepAt || now - state.lastSweepAt > 3_600_000) {
      state.lastSweepAt = now;
      saveState(state);
      syncPrimary(); // a watcher fix must not wait for the next feedback topic
      killWorktreeOrphans();
      await cleanWorktrees(state.lastSid, 'sweep');
      await reconcileBare();
      await sweepBranches().catch((e) => log(`sweep failed: ${e.message}`));
      pruneLogs();
    }

    const items = await queueItems();
    if (!items.length) return;
    const fresh = loadState();
    if (fresh.cooldownUntil && fresh.cooldownUntil > now) {
      if (fresh.cooldownReason === 'usage-limit') gate(['end-run', '--state', 'paused', '--note', 'paused-usage-limit']);
      return;
    }
    const prs = feedbackPrs();
    const { eligible, park } = planQueue(items, fresh, now);
    for (const p of park) {
      await parkItem(p, prs);
      delete fresh.items[p.item.id];
      notify(fresh, `park-${p.item.id}`, 'SCC Feedback', `Thema #${p.item.seq} ist ${p.attempts}× gescheitert und wartet auf dich.`);
    }
    saveState(fresh);
    if (eligible.length) startSupervisor(eligible, fresh);
  } finally {
    rmSync(TICK_LOCK, { force: true });
  }
}
/** Claims nobody owns any more (no run is alive here): back to the queue at once. */
async function reconcileBare() {
  const bare = await sql(`select id from public.admin_feedback where status = 'in_progress' and ship_ref is null limit 1`);
  if (bare.length) await reconcileItems('run no longer alive');
}

// ---------------------------------------------------------------- supervise
function claudeBin() {
  if (process.env.SCC_CLAUDE_BIN) return process.env.SCC_CLAUDE_BIN;
  const out = shOk('where', ['claude']);
  const hit = out?.split(/\r?\n/).find((p) => /\.(exe|cmd)$/i.test(p)) ?? out?.split(/\r?\n/)[0];
  if (!hit) throw new Error('claude CLI not found on PATH');
  return hit;
}
function keepAwake(pid) {
  // Without this a run dies with the idle timer. Ends by itself with the supervisor.
  const ps = `Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; [void][W.P]::SetThreadExecutionState(2147483649); Wait-Process -Id ${pid} -ErrorAction SilentlyContinue`;
  try { spawn('powershell.exe', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* the run still works, a sleeping PC just pauses it */ }
}
function syncPrimary() {
  shOk('git', ['fetch', 'origin', 'main', '--quiet']);
  const branch = shOk('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') { log(`primary checkout is on ${branch}, not fast-forwarding`); return; }
  if (shOk('git', ['merge', '--ff-only', 'origin/main', '--quiet']) === null) log('primary checkout could not fast-forward');
}
/** A detached checkout of origin/main, rebuilt when a sweep took it. It holds no work: every item has its own scfb-* worktree. */
function ensureRunner() {
  const reused = existsSync(join(RUNNER, '.git')) && shOk('git', ['-C', RUNNER, 'checkout', '--detach', '--force', 'origin/main', '--quiet']) !== null;
  if (!reused) {
    if (existsSync(RUNNER)) removeWorktree(RUNNER, null);
    shOk('git', ['worktree', 'prune']);
    sh('git', ['worktree', 'add', '--detach', '--force', RUNNER, 'origin/main', '--quiet']);
  }
  // Untracked, and it is what enables the Supabase MCP server for a checkout.
  const local = join(REPO, '.claude', 'settings.local.json');
  if (existsSync(local)) copyFileSync(local, join(RUNNER, '.claude', 'settings.local.json'));
  return RUNNER;
}
function buildPrompt(run) {
  const prompt = existsSync(LIVE_PROMPT) ? readFileSync(LIVE_PROMPT, 'utf8') : readFileSync(REPO_PROMPT, 'utf8');
  const body = prompt.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  const items = run.snapshot.map((i) => `#${i.seq} ${i.id} (attempt ${run.attempts?.[i.id] ?? 1} of 3)`).join('\n');
  return `${body}\n\nRUN CONTEXT (from the watcher)\nsession: ${run.sid}\nqueue at start:\n${items}\n`;
}
function tailOf(file, bytes = 256 * 1024) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ } }
}

async function supervise(sid) {
  const run = readJson(RUN_FILE) ?? await waitForRunFile(sid);
  if (!run || run.sid !== sid) { log(`supervise ${sid.slice(0, 8)}: no matching run file`); return; }
  const saveRun = (patch) => { Object.assign(run, patch); writeJson(RUN_FILE, run); };
  saveRun({ pid: process.pid });
  keepAwake(process.pid);

  let outcome = { kind: 'crash', reason: 'the supervisor failed before the run ended' };
  const lock = gate(['start-run', '--session', sid, '--note', `work:${run.snapshot.length}`]);
  if (!lock.acquired) {
    log(`run lock not acquired (${lock.error ?? 'held by another run'}), standing down`);
    // Only our own file: the loser of a double start used to delete the winner's run file.
    if (mayRemoveRunFile(readJson(RUN_FILE)?.sid, sid)) rmSync(RUN_FILE, { force: true });
    return;
  }
  try {
    syncPrimary();
    let cwd;
    try { cwd = ensureRunner(); } catch (e) {
      throw Object.assign(new Error(`runner checkout failed: ${e.message}`), { outcome: { kind: 'transient', until: Date.now() + 10 * 60_000, reason: 'runner checkout failed' } });
    }
    const logFile = join(LOGS, `run-${run.startedIso.slice(0, 10)}-${sid.slice(0, 8)}.jsonl`);
    const out = openSync(logFile, 'a');
    const env = { ...process.env, ...RUN_CACHE_ENV, SCC_ROUTINE_HEADLESS: '1', CLAUDE_CODE_SESSION_ID: sid };
    for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) delete env[k];
    const bin = claudeBin();
    const child = spawn(bin, ['-p', '--session-id', sid, '--model', RUN_MODEL, '--effort', RUN_EFFORT, '--dangerously-skip-permissions', '--disallowedTools', DISALLOWED, '--output-format', 'stream-json', '--verbose'],
      { cwd, env, stdio: ['pipe', out, out], windowsHide: true, shell: /\.cmd$/i.test(bin) });
    saveRun({ childPid: child.pid, logFile });
    child.stdin.on('error', () => { /* a process that died at start reports through its exit */ });
    child.stdin.end(buildPrompt(run));

    const startedAt = Date.now();
    const dir = transcriptDirFor(cwd);
    let dog = { awakeMs: 0, lastBeat: startedAt, quietFloor: startedAt };
    let killedFor = null;
    const beat = setInterval(() => {
      try { saveRun({ beatAt: Date.now() }); } catch (e) { log(`could not stamp the run file: ${e.message}`); }
      dog = watchdogStep(dog, { now: Date.now(), newestWrite: newestActivity(dir, sid), startedAt });
      if (dog.kill && !killedFor) { killedFor = dog.kill; log(`stopping run ${sid.slice(0, 8)}: ${dog.kill}`); killTree(child.pid); killSession(sid); }
    }, 60_000);
    const exit = await new Promise((res) => {
      child.on('exit', (code) => res(code));
      child.on('error', (e) => { log(`spawn failed: ${e.message}`); res(null); });
    });
    clearInterval(beat);
    closeSync(out);
    outcome = classifyExit({ tail: tailOf(logFile), exit, killedFor });
    saveRun({ outcome });
    log(`run ${sid.slice(0, 8)} ended: exit=${exit} ${outcome.kind}`);
  } catch (e) {
    log(`supervisor error: ${e.message}`);
    outcome = e.outcome ?? { kind: 'crash', reason: e.message.slice(0, 200) };
    saveRun({ outcome });
  }
  // The board can be away (network, PAT): the run file stays, the next tick repeats this.
  try {
    await postflight(run, outcome);
    rmSync(RUN_FILE, { force: true });
  } catch (e) { log(`postflight failed, the next tick repeats it: ${e.message}`); }
}
async function waitForRunFile(sid) {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const run = readJson(RUN_FILE);
    if (run?.sid === sid) return run;
  }
  return null;
}

// ---------------------------------------------------------------- install / status
export function taskXml(user = shOk('whoami', [])) {
  const node = process.execPath;
  const script = join(REPO, 'scripts', 'routine-watcher.mjs');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const start = new Date(Date.now() + 60_000).toISOString().slice(0, 19);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Polls the Verse Companion feedback board without a model; starts a headless Claude run only when there is work. docs/feedback-routine/watcher.md</Description></RegistrationInfo>
  <Triggers>
    <TimeTrigger><Repetition><Interval>PT${WATCH_INTERVAL_MIN}M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>${start}</StartBoundary><Enabled>true</Enabled></TimeTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId>${esc(user)}</UserId></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>${esc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <ExecutionTimeLimit>PT15M</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>conhost.exe</Command><Arguments>--headless "${esc(node)}" "${esc(script)}" tick</Arguments><WorkingDirectory>${esc(REPO)}</WorkingDirectory></Exec></Actions>
</Task>`;
}
function install() {
  if (/[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO)) throw new Error('install runs from the primary checkout: a worktree can vanish under the task');
  mkdirSync(dirname(LIVE_PROMPT), { recursive: true });
  copyFileSync(REPO_PROMPT, LIVE_PROMPT);
  const xml = join(tmpdir(), `scc-watcher-${process.pid}.xml`);
  writeFileSync(xml, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(taskXml(), 'utf16le')]));
  try { sh('schtasks', ['/create', '/tn', TASK_NAME, '/xml', xml, '/f']); } finally { rmSync(xml, { force: true }); }
  console.log(`[routine-watcher] task "${TASK_NAME}" registered, every ${WATCH_INTERVAL_MIN} min and at logon. Live prompt: ${LIVE_PROMPT}`);
}
function uninstall() {
  sh('schtasks', ['/delete', '/tn', TASK_NAME, '/f']);
  console.log(`[routine-watcher] task "${TASK_NAME}" removed`);
}
function status() {
  const task = shOk('schtasks', ['/query', '/tn', TASK_NAME, '/fo', 'LIST']);
  const run = readJson(RUN_FILE);
  console.log(JSON.stringify({
    taskRegistered: Boolean(task),
    taskStatus: /Status:\s*(.+)/.exec(task ?? '')?.[1]?.trim() ?? null,
    promptInSync: existsSync(LIVE_PROMPT) && readFileSync(LIVE_PROMPT, 'utf8').replace(/\r\n/g, '\n') === readFileSync(REPO_PROMPT, 'utf8').replace(/\r\n/g, '\n'),
    home: HOME,
    run: run ? { ...run, alive: pidAlive(run.pid), claudeAlive: pidAlive(run.childPid) } : null,
    state: loadState(),
  }, null, 2));
}

// ---------------------------------------------------------------- main
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const [cmd, arg] = process.argv.slice(2);
  process.chdir(REPO);
  const handlers = { tick, supervise: () => supervise(arg), status, install, uninstall };
  try {
    // A tick in a worktree would start a real run against the live board from a folder that can vanish.
    if (['tick', 'supervise'].includes(cmd) && /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) && !process.env.SCC_ROUTINE_HOME) {
      throw new Error(`${cmd} runs from the primary checkout (a test sets SCC_ROUTINE_HOME)`);
    }
    const h = handlers[cmd];
    if (!h) throw new Error(`usage: routine-watcher.mjs ${Object.keys(handlers).join('|')}`);
    await h();
  } catch (e) {
    log(`ERROR ${cmd}: ${e.message}`);
    process.exitCode = 1;
  }
}
