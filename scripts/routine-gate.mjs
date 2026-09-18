/**
 * Gate for the admin-feedback routine — everything an idle cycle needs, in one
 * token-free call, so Claude reads ONE line instead of a 123-KB runbook.
 *
 * Why this exists (concept 2026-09-13-feedback-routine-takt-anweisung, E4a):
 * 29 of the last 50 routine runs were empty, and each of them still read the
 * whole runbook, ran five SQL reads, swept 18 worktrees and rendered a card —
 * ≈2.3 min and a full context of tokens per cycle, 24× a day, competing with
 * the admin's own sessions for the same usage limit (18 % of runs died on it).
 * This script does the deterministic part of a cycle without a model:
 *
 *   check      (default)  1. run lock: is another run still working?
 *                         2. cadence: is THIS tick a working tick? (dense in the
 *                            evening, hourly by day, every 2 h at night — the
 *                            cron itself fires every 20 min around the clock)
 *                         3. reaper: reopen stale claims — but only those whose
 *                            worktree shows no activity (the liveness check the
 *                            red team demanded; a bare timer reopened live claims
 *                            before — memory feedback-reaper-reopens-live-claims)
 *                         4. one SQL with the queue counts (a)–(f), `and triaged`
 *                            included (the security gate the prompt had lost)
 *                         5. heartbeat stamp incl. `next_run_at` and `state`
 *                         → prints a summary line on stderr and ONE JSON line on
 *                           stdout. verdict ∈ idle | skip-cadence | running | work | error
 *   start-run             take the run lock (state=running); prints acquired:true|false
 *   end-run               release it (state=idle|paused, note)
 *   heartbeat             stamp only (mid-run proof of life)
 *
 * Fail-open by design: any SQL/token failure yields verdict=error, exit 2, and
 * the prompt then falls back to the manual path (heartbeat via MCP, reaper,
 * queue reads). A broken gate must never look like an empty queue — and never
 * paint the panel green while nothing is being processed (note=gate-error).
 *
 * Token: `--token <pat>` > env SUPABASE_ACCESS_TOKEN > Windows Credential
 * Manager entry "Supabase CLI:supabase" (what `supabase login` stores; read via
 * a throw-away PowerShell script, decoded as UTF-8 — see memory
 * supabase-headless-sql-via-cli-token). The token is never printed.
 *
 * Usage (from the repo root of the PRIMARY checkout, never a worktree):
 *   node scripts/routine-gate.mjs check [--force] [--in-run] [--now <iso>] [--dry-run]
 *   node scripts/routine-gate.mjs start-run --note claimed:3
 *   node scripts/routine-gate.mjs end-run --state idle --note shipped:2
 *   node scripts/routine-gate.mjs heartbeat --note running
 *   node scripts/routine-gate.mjs next-runs [--now <iso>]     (prints the cadence table check)
 *   node scripts/routine-gate.mjs sql --file <path.sql>          (or --query "<sql>", or stdin)
 *     Runs ONE statement through the same Management-API path the gate uses and
 *     prints the rows as a JSON array — the fallback for a working run whose
 *     Supabase MCP is not authorised (observed 2026-09-13 13:27 tick). Same power
 *     as the MCP (service role), same token rule: never on the command line.
 *   concept-publish --file <html> --title "<t>" [--feedback <uuid>] [--id <uuid>]
 *     Hosts an interactive concept page ON the website (admin feedback #224):
 *     inserts a `concept_pages` row (or, with --id, replaces its html/title and
 *     bumps `reload_counter` so an open page reloads itself) and prints ONE JSON
 *     line { id, url } — the url is what goes into the feedback thread.
 *   concept-read --id <uuid> [--mark-processed]
 *     Prints { id, title, decisions, submitted_at, processed_at } — what the
 *     admin chose on the hosted page. --mark-processed stamps processed_at so
 *     the page's panel returns to "ready". See docs/feedback-routine/concepts.md.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT_REF = 'hcnqhvzlavdycidqyaai';
const HEARTBEAT_ID = 'admin-feedback-routine';
const TZ = 'Europe/Berlin';
/** The cron fires at :00/:20/:40 local; the Desktop scheduler adds ~7 min jitter. */
const TICK_MIN = 20;
const JITTER_MIN = 7;
/** A run lock older than this belongs to a dead run and may be taken over. */
const RUN_LOCK_MAX_MIN = 180;
/** Reaper: a claim without a PR older than this is a candidate for reopening … */
const STALE_CLAIM_MIN = 60;
/** … unless its worktree showed git activity inside this window. */
const WORKTREE_LIVE_MIN = 60;
/**
 * Lock liveness (0.85.12): a run whose Desktop session — transcript plus its
 * subagents' transcripts — has not written for this long is dead (the app was
 * quit, the session crashed, the usage limit killed it) and its lock is released
 * on the next tick instead of after RUN_LOCK_MAX_MIN. 2026-09-17: the app quit
 * at 19:41 under a run started 19:14 and every tick until 22:14 would have said
 * "running" over two stranded worktrees.
 */
const RUN_DEAD_MIN = 30;
/** …but a fresh lock gets this long before its transcript is judged at all. */
const RUN_LOCK_GRACE_MIN = 15;

/**
 * Cadence — the ONLY place it lives. Hours are local (Europe/Berlin), a tick
 * is "due" when its slot matches. Evening = every 20-min tick; day = the :00
 * tick of every hour; night = the :00 tick of every second hour.
 */
const CADENCE = [
  { name: 'evening', hours: [19, 20, 21, 22, 23, 0], slots: [0, 20, 40] },
  { name: 'day', hours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], slots: [0] },
  { name: 'night', hours: [1, 3, 5, 7], slots: [0] },
  { name: 'night-off', hours: [2, 4, 6], slots: [] },
];

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'check';
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes(`--${n}`);
const log = (...m) => console.error('[routine-gate]', ...m);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---------------------------------------------------------------- time
function localParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  return { hour: get('hour'), minute: get('minute') };
}
function windowFor(hour) {
  return CADENCE.find((w) => w.hours.includes(hour)) ?? { name: 'unknown', slots: [] };
}
/** Slot start (UTC ms) of the tick that fired at `date` — minutes floor to the 20-min grid. */
function slotStart(date) {
  const t = date.getTime();
  const min = date.getUTCMinutes();
  return t - ((min % TICK_MIN) * 60_000) - date.getUTCSeconds() * 1000 - date.getUTCMilliseconds();
}
function slotIsDue(slotMs) {
  const d = new Date(slotMs);
  const { hour, minute } = localParts(d);
  return windowFor(hour).slots.includes(minute);
}
/** Next due slot strictly after the given slot, as the instant the scheduler will fire (slot + jitter). */
function nextRunAt(fromSlotMs) {
  for (let i = 1; i <= (24 * 60) / TICK_MIN; i++) {
    const s = fromSlotMs + i * TICK_MIN * 60_000;
    if (slotIsDue(s)) return new Date(s + JITTER_MIN * 60_000);
  }
  return new Date(fromSlotMs + 24 * 3_600_000);
}

// ---------------------------------------------------------------- token
function readCredentialManagerToken() {
  if (process.platform !== 'win32') return null;
  const dir = mkdtempSync(join(tmpdir(), 'rg-'));
  const ps1 = join(dir, 'cred.ps1');
  writeFileSync(ps1, `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class CredMan {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, uint type, uint flags, out IntPtr cred);
}
"@
$p=[IntPtr]::Zero
if(-not [CredMan]::CredRead("Supabase CLI:supabase",1,0,[ref]$p)){ exit 3 }
$c=[Runtime.InteropServices.Marshal]::PtrToStructure($p,[type][CredMan+CREDENTIAL])
$b=New-Object byte[] $c.CredentialBlobSize
[Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$b,0,$c.CredentialBlobSize)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))
`);
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], { encoding: 'utf8' });
    const tok = (r.stdout || '').trim();
    return r.status === 0 && tok.startsWith('sbp_') && tok.length > 30 ? tok : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function resolveToken() {
  const t = flag('token') || process.env.SUPABASE_ACCESS_TOKEN || readCredentialManagerToken();
  if (!t) throw new Error('no Supabase access token (use --token, SUPABASE_ACCESS_TOKEN, or `supabase login`)');
  return t;
}

// ---------------------------------------------------------------- sql
let TOKEN = null;
async function sql(query) {
  if (!TOKEN) TOKEN = resolveToken();
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// ---------------------------------------------------------------- pieces
async function readHeartbeat() {
  const rows = await sql(`select id, last_seen_at, note, next_run_at, run_started_at, run_finished_at, state
    from public.routine_heartbeat where id = ${q(HEARTBEAT_ID)}`);
  return rows[0] ?? null;
}
function lockHeldBy(hb, now) {
  if (!hb || hb.state !== 'running' || !hb.run_started_at) return false;
  const started = Date.parse(hb.run_started_at);
  const finished = hb.run_finished_at ? Date.parse(hb.run_finished_at) : null;
  if (finished !== null && finished >= started) return false;
  return now - started < RUN_LOCK_MAX_MIN * 60_000;
}
// ---- lock liveness: which session holds the lock, and is it still writing?
/** `.claude/routine-run.json` in the primary checkout — written by start-run, removed by end-run. Git-ignored. */
function runFile() {
  return join(repoRoots().root, '.claude', 'routine-run.json');
}
function recordRunSession(sid, startedAt) {
  try { writeFileSync(runFile(), JSON.stringify({ sid, startedAt }, null, 2)); } catch (e) { log(`could not record the run session: ${e.message}`); }
}
function readRunSession() {
  try { return JSON.parse(readFileSync(runFile(), 'utf8')); } catch { return null; }
}
function clearRunSession() {
  try { rmSync(runFile(), { force: true }); } catch { /* nothing to clear */ }
}
/** Claude Code keeps one transcript dir per checkout path: ~/.claude/projects/<path with every non-alphanumeric as '-'>. */
export function transcriptDirFor(root, home = homedir()) {
  return join(home, '.claude', 'projects', root.replace(/[^A-Za-z0-9]/g, '-'));
}
/**
 * Newest write (ms) among a session's transcript and its subagents' transcripts;
 * with sid=null the newest write of ANY session in that transcript dir (the
 * fallback when the lock holder was not recorded). null when nothing exists.
 */
const ACTIVITY_RECORD_TYPES = new Set(['user', 'assistant', 'system', 'progress']);
const ACTIVITY_TAIL_BYTES = 64 * 1024;
/**
 * When did this transcript last carry a REAL record — a user/assistant/system/
 * progress line with a timestamp? The Desktop app also appends untimestamped
 * bookkeeping records (custom-title, last-prompt, mode, queue-operation) whenever
 * a session is merely touched (listed, focused, retitled); those moved the file's
 * mtime on 2026-09-17 21:43 for a run that had been dead since 21:26 and kept
 * its lock alive. Falls back to the mtime when the tail holds no such record
 * (an empty or foreign file), which is the safe direction: a live session
 * always has a fresh real record.
 */
export function transcriptActivity(file) {
  let fd;
  try { fd = openSync(file, 'r'); } catch { return null; }
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, ACTIVITY_TAIL_BYTES);
    const buf = Buffer.alloc(len);
    if (len > 0) readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith('{')) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (!ACTIVITY_RECORD_TYPES.has(rec?.type) || !rec.timestamp) continue;
      // The Desktop app "resumes" a session it finds after a restart by appending
      // a synthetic pair — user "Continue from where you left off." (isMeta) and
      // assistant "No response requested." (model "<synthetic>") — without a model
      // turn. 2026-09-18 15:36: that pair kept a run dead since 01:24 "alive".
      if (rec.isMeta === true || rec.message?.model === '<synthetic>') continue;
      const t = Date.parse(rec.timestamp);
      if (Number.isFinite(t)) return t;
    }
    return fstatSync(fd).mtimeMs;
  } catch {
    return null;
  } finally {
    try { closeSync(fd); } catch { /* already closed */ }
  }
}
export function newestActivity(dir, sid = null) {
  let newest = null;
  const consider = (p) => { const t = transcriptActivity(p); if (t !== null && (newest === null || t > newest)) newest = t; };
  const subagentsOf = (id) => {
    const d = join(dir, id, 'subagents');
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) if (f.endsWith('.jsonl')) consider(join(d, f));
  };
  if (!existsSync(dir)) return null;
  if (sid) {
    consider(join(dir, `${sid}.jsonl`));
    subagentsOf(sid);
    return newest;
  }
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.jsonl')) { consider(join(dir, f)); subagentsOf(f.slice(0, -6)); }
  }
  return newest;
}
/** Pure verdict: is a lock started at `startedAt` dead, given the holder's newest transcript write? */
export function runIsDead({ startedAt, newest, now, graceMin = RUN_LOCK_GRACE_MIN, deadMin = RUN_DEAD_MIN }) {
  if (now - startedAt < graceMin * 60_000) return false;
  if (newest === null) return true; // never wrote a line after the grace period
  return now - newest > deadMin * 60_000;
}
function deadLock(hb, now) {
  const startedAt = Date.parse(hb.run_started_at);
  const run = readRunSession();
  // Only trust the recorded session when it belongs to THIS lock; a stale file
  // from an older run would judge the wrong transcript. Otherwise judge the whole
  // checkout: any session writing there keeps the lock (safe direction).
  const sid = run?.sid && run.startedAt === hb.run_started_at ? run.sid : null;
  const newest = newestActivity(transcriptDirFor(repoRoots().root), sid);
  const dead = runIsDead({ startedAt, newest, now });
  return { dead, sid, newest, idleMin: newest === null ? null : Math.round((now - newest) / 60_000) };
}

async function stampHeartbeat({ note, next, state, keepRunning }) {
  const stateExpr = keepRunning
    ? `case when routine_heartbeat.state = 'running' and routine_heartbeat.run_started_at > now() - interval '${RUN_LOCK_MAX_MIN} minutes'
              and (routine_heartbeat.run_finished_at is null or routine_heartbeat.run_finished_at < routine_heartbeat.run_started_at)
         then 'running' else ${q(state)} end`
    : q(state);
  await sql(`insert into public.routine_heartbeat (id, last_seen_at, note, next_run_at, state, updated_at)
    values (${q(HEARTBEAT_ID)}, now(), ${q(note)}, ${next ? q(next.toISOString()) : 'null'}, ${q(state)}, now())
    on conflict (id) do update set last_seen_at = now(), note = excluded.note,
      next_run_at = coalesce(excluded.next_run_at, routine_heartbeat.next_run_at),
      state = ${stateExpr}, updated_at = now()`);
}

function repoRoots() {
  const root = resolve(flag('repo', process.cwd()));
  return { root, worktrees: join(root, '.claude', 'worktrees'), parent: resolve(root, '..') };
}
/** True when a worktree for this item exists and its git activity is younger than WORKTREE_LIVE_MIN. */
function worktreeLive(shortId, now) {
  const { worktrees, parent } = repoRoots();
  const candidates = [];
  for (const base of [worktrees, parent]) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      if (name.startsWith(`scfb-${shortId}`) || name.startsWith(`feedback-${shortId}`)) candidates.push(join(base, name));
    }
  }
  for (const dir of candidates) {
    try {
      const last = Number(execFileSync('git', ['-C', dir, 'log', '-1', '--format=%ct'], { encoding: 'utf8' }).trim()) * 1000;
      if (now - last < WORKTREE_LIVE_MIN * 60_000) return dir;
      const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
      if (dirty && now - statSync(dir).mtimeMs < WORKTREE_LIVE_MIN * 60_000) return dir;
    } catch { /* not a git dir any more — nothing live here */ }
  }
  return null;
}
async function reap(now, dryRun) {
  const stale = await sql(`select id from public.admin_feedback
    where status = 'in_progress' and ship_ref is null
      and processed_at < now() - interval '${STALE_CLAIM_MIN} minutes'`);
  const reaped = [], skippedLive = [];
  for (const { id } of stale) {
    const live = worktreeLive(id.slice(0, 8), now);
    if (live) { skippedLive.push({ id, worktree: live }); continue; }
    if (!dryRun) {
      await sql(`update public.admin_feedback set status = 'open',
        processing_note = 'auto-reopened: in_progress claim went stale (interrupted run) — resuming',
        processed_at = now() where id = ${q(id)} and status = 'in_progress' and ship_ref is null`);
    }
    reaped.push(id);
  }
  return { reaped, skippedLive };
}
const LAST_MSG = `join lateral (select is_system, created_at from public.admin_feedback_messages m
    where m.feedback_id = f.id order by m.created_at desc limit 1) last on true`;
async function counts() {
  const base = `select
    (select count(*) from public.admin_feedback where status = 'open' and triaged) as a,
    (select count(*) from public.admin_feedback f ${LAST_MSG} where f.status = 'needs_input' and last.is_system = false) as b,
    (select count(*) from public.admin_feedback where status = 'in_progress' and ship_ref is not null) as c,
    (select count(*) from public.admin_feedback f ${LAST_MSG} where f.status = 'shipped' and last.is_system = false
        and last.created_at > coalesce(f.shipped_at, f.processed_at, f.created_at)) as d,
    (select count(*) from public.admin_feedback f ${LAST_MSG} where f.status = 'in_progress' and f.ship_ref is not null and last.is_system = false) as e,
    (select count(*) from public.admin_feedback where status = 'open' and not triaged) as untriaged,
    (select count(*) from public.admin_feedback where status = 'in_progress' and ship_ref is null) as bare_in_progress`;
  let row;
  try {
    row = (await sql(`${base}, (select count(*) from public.admin_feedback where status = 'shipped' and review_reply_pending) as f`))[0];
  } catch (e) {
    // Migration 20260913131500 not applied yet — everything else still counts.
    row = { ...(await sql(base))[0], f: null };
  }
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? null : Number(v)]));
}
const actionable = (c) => (c.a ?? 0) + (c.b ?? 0) + (c.d ?? 0) + (c.e ?? 0) + (c.f ?? 0);

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// ---------------------------------------------------------------- commands
async function check() {
  const now = flag('now') ? Date.parse(flag('now')) : Date.now();
  const nowDate = new Date(now);
  const slot = slotStart(nowDate);
  const next = nextRunAt(slot);
  const inRun = has('in-run');
  const force = has('force');
  const dryRun = has('dry-run');
  const { hour, minute } = localParts(nowDate);
  const win = windowFor(hour).name;

  const hb = await readHeartbeat();
  let lockReaped = null;
  if (!inRun && lockHeldBy(hb, now)) {
    const liveness = deadLock(hb, now);
    if (!liveness.dead) {
      const note = 'running';
      if (!dryRun) await stampHeartbeat({ note, next, state: 'running', keepRunning: true });
      log(`another run holds the lock since ${hb.run_started_at} (session ${liveness.sid ?? 'unknown'} wrote ${liveness.idleMin ?? '?'} min ago) — nothing to do`);
      return emit({ verdict: 'running', lockedSince: hb.run_started_at, holderIdleMin: liveness.idleMin, nextRunAt: next.toISOString(), window: win });
    }
    // The holder stopped writing: app quit, crash, usage limit. Release the lock now;
    // its claims go through the normal reaper below (worktree liveness applies).
    lockReaped = { since: hb.run_started_at, sid: liveness.sid, idleMin: liveness.idleMin };
    if (!dryRun) {
      await sql(`update public.routine_heartbeat
        set state = 'idle', run_finished_at = now(), note = 'lock-reaped:dead-session', updated_at = now()
        where id = ${q(HEARTBEAT_ID)} and state = 'running' and run_started_at = ${q(hb.run_started_at)}`);
      clearRunSession();
    }
    log(`lock held since ${hb.run_started_at} by a DEAD run (session ${liveness.sid ?? 'unknown'}, last write ${liveness.idleMin ?? 'never'} min ago) — released`);
  }

  const due = force || inRun || slotIsDue(slot);
  const reaperResult = await reap(now, dryRun);
  if (lockReaped) reaperResult.lockReaped = lockReaped;
  const c = await counts();
  const work = actionable(c);

  if (!due) {
    const note = 'skip-cadence';
    if (!dryRun) await stampHeartbeat({ note, next, state: 'idle', keepRunning: true });
    log(`tick ${hour}:${String(minute).padStart(2, '0')} (${win}) is not a working slot — heartbeat only; work waiting: ${work}`);
    return emit({ verdict: 'skip-cadence', window: win, counts: c, ...reaperResult, nextRunAt: next.toISOString() });
  }

  const verdict = work > 0 ? 'work' : 'idle';
  const note = work > 0 ? `work:${work}` : 'queue-empty';
  if (!dryRun && !inRun) await stampHeartbeat({ note, next, state: 'idle', keepRunning: false });
  if (!dryRun && inRun) await stampHeartbeat({ note: 'running', next, state: 'running', keepRunning: false });
  log(`${verdict}: open(a)=${c.a} answered(b)=${c.b} holds(c)=${c.c} continuations(d)=${c.d} answeredHolds(e)=${c.e} replyPending(f)=${c.f ?? '–'} untriaged=${c.untriaged} bareInProgress=${c.bare_in_progress}; reaped=${reaperResult.reaped.length} liveSkipped=${reaperResult.skippedLive.length}`);
  return emit({ verdict, window: win, counts: c, actionable: work, ...reaperResult, nextRunAt: next.toISOString() });
}

async function startRun() {
  const note = flag('note', 'running');
  const rows = await sql(`update public.routine_heartbeat
    set state = 'running', run_started_at = now(), run_finished_at = null, note = ${q(note)}, updated_at = now()
    where id = ${q(HEARTBEAT_ID)}
      and not (state = 'running' and run_started_at > now() - interval '${RUN_LOCK_MAX_MIN} minutes'
               and (run_finished_at is null or run_finished_at < run_started_at))
    returning run_started_at`);
  const acquired = rows.length === 1;
  const sid = flag('session') || process.env.CLAUDE_CODE_SESSION_ID || null;
  if (acquired) recordRunSession(sid, rows[0].run_started_at);
  log(acquired ? `run lock acquired at ${rows[0].run_started_at} (session ${sid ?? 'unknown'})` : 'run lock is held by another run — do NOT claim anything');
  emit({ acquired, runStartedAt: rows[0]?.run_started_at ?? null, session: acquired ? sid : undefined });
  if (!acquired) process.exitCode = 1;
}

async function endRun() {
  const state = flag('state', 'idle');
  if (!['idle', 'paused'].includes(state)) throw new Error('--state must be idle|paused');
  const note = flag('note', state === 'paused' ? 'paused-usage-limit' : 'queue-empty');
  const next = nextRunAt(slotStart(new Date()));
  await sql(`update public.routine_heartbeat
    set state = ${q(state)}, run_finished_at = now(), note = ${q(note)}, next_run_at = ${q(next.toISOString())}, last_seen_at = now(), updated_at = now()
    where id = ${q(HEARTBEAT_ID)}`);
  clearRunSession();
  log(`run lock released → ${state} (${note})`);
  emit({ released: true, state, note, nextRunAt: next.toISOString() });
}

async function heartbeat() {
  const note = flag('note', 'running');
  const next = nextRunAt(slotStart(new Date()));
  await stampHeartbeat({ note, next, state: 'running', keepRunning: true });
  emit({ stamped: true, note, nextRunAt: next.toISOString() });
}

function nextRuns() {
  const now = flag('now') ? new Date(flag('now')) : new Date();
  let slot = slotStart(now);
  const out = [];
  for (let i = 0; i < 12; i++) {
    const n = nextRunAt(slot);
    out.push(n.toISOString());
    slot = slotStart(n);
  }
  const { hour, minute } = localParts(now);
  emit({ now: now.toISOString(), local: `${hour}:${String(minute).padStart(2, '0')}`, window: windowFor(hour).name, thisTickDue: slotIsDue(slotStart(now)), next: out });
}

async function runSql() {
  let query = flag('query');
  const file = flag('file');
  if (!query && file) query = readFileSync(file, 'utf8');
  if (!query && !process.stdin.isTTY) query = readFileSync(0, 'utf8');
  query = (query || '').trim();
  if (!query) throw new Error('sql: pass --file <path.sql>, --query "<sql>" or pipe the statement on stdin');
  const rows = await sql(query);
  log(`sql: ${Array.isArray(rows) ? rows.length : 0} row(s)`);
  emit(rows);
}

// ---------------------------------------------------------------- concepts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONCEPT_URL_BASE = 'https://sc-companion.vercel.app/konzept/';
/**
 * Dollar-quote a literal for SQL. The html is hundreds of KB of arbitrary
 * text (quotes, backslashes, `$$` inside the engine), so a quote-doubling
 * escape is fragile; a dollar tag with a random suffix cannot occur in it —
 * and if it did, the loop below picks another one.
 */
function dq(s) {
  let tag;
  do { tag = '$c' + Math.random().toString(36).slice(2, 10) + '$'; } while (s.includes(tag));
  return tag + s + tag;
}
async function conceptPublish() {
  const file = flag('file');
  const title = flag('title');
  const feedback = flag('feedback');
  const id = flag('id');
  if (!file || !title) throw new Error('concept-publish: --file <html> and --title "<t>" are required');
  if (feedback && !UUID_RE.test(feedback)) throw new Error('concept-publish: --feedback must be a uuid');
  if (id && !UUID_RE.test(id)) throw new Error('concept-publish: --id must be a uuid');
  const html = readFileSync(resolve(file), 'utf8');
  if (!/<html[\s>]/i.test(html) || !/<head[\s>]/i.test(html)) throw new Error('concept-publish: file is not a full html document');
  let rows;
  if (id) {
    rows = await sql(`update public.concept_pages
      set html = ${dq(html)}, title = ${q(title)}, reload_counter = reload_counter + 1
        ${feedback ? `, feedback_id = ${q(feedback)}` : ''}
      where id = ${q(id)}
      returning id, reload_counter`);
    if (!rows.length) throw new Error(`concept-publish: no concept_pages row with id ${id}`);
  } else {
    rows = await sql(`insert into public.concept_pages (feedback_id, title, html)
      values (${feedback ? q(feedback) : 'null'}, ${q(title)}, ${dq(html)})
      returning id, reload_counter`);
  }
  const row = rows[0];
  log(`concept ${id ? 'republished' : 'published'}: ${row.id} (${html.length} chars, reload_counter=${row.reload_counter})`);
  emit({ id: row.id, url: CONCEPT_URL_BASE + row.id, reloadCounter: row.reload_counter });
}
async function conceptRead() {
  const id = flag('id');
  if (!id || !UUID_RE.test(id)) throw new Error('concept-read: --id <uuid> is required');
  const rows = await sql(`select id, title, feedback_id, decisions, submitted_at, processed_at, reload_counter
    from public.concept_pages where id = ${q(id)}`);
  if (!rows.length) throw new Error(`concept-read: no concept_pages row with id ${id}`);
  const row = rows[0];
  if (has('mark-processed')) {
    const upd = await sql(`update public.concept_pages set processed_at = now()
      where id = ${q(id)} returning processed_at`);
    row.processed_at = upd[0]?.processed_at ?? row.processed_at;
    log(`concept ${id}: processed_at stamped`);
  }
  const submitted = row.decisions && row.decisions.submitted === true;
  log(`concept ${id}: ${submitted ? 'SUBMITTED ' + row.submitted_at : 'not submitted yet'}${row.processed_at ? ', processed ' + row.processed_at : ''}`);
  emit(row);
}

const handlers = { check, 'start-run': startRun, 'end-run': endRun, heartbeat, 'next-runs': nextRuns, sql: runSql, 'concept-publish': conceptPublish, 'concept-read': conceptRead };
// Only dispatch when run as a script — the liveness helpers are imported by the tests.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) try {
  const h = handlers[cmd];
  if (!h) throw new Error(`unknown command ${cmd}`);
  await h();
} catch (err) {
  log(`ERROR ${err.message}`);
  // Fail-open marker: the prompt falls back to the manual path. Try to leave an
  // honest note; if even that fails the panel simply ages out to red.
  try { if (cmd === 'check' && !has('dry-run')) await sql(`update public.routine_heartbeat set note = 'gate-error', updated_at = now() where id = ${q(HEARTBEAT_ID)}`); } catch { /* nothing more to do */ }
  emit({ verdict: 'error', error: String(err.message).slice(0, 200) });
  // exitCode, not process.exit(): on Windows an immediate exit while the failed
  // fetch's socket is still closing trips a libuv assertion (abort, exit 127)
  // and the promised "exit 2" never reaches the caller.
  process.exitCode = 2;
}
