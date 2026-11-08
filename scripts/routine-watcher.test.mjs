import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BACKOFF_MIN, GATE_FETCH_TIMEOUT_MS, HARD_CAP_MIN, IDLE_KILL_MIN, MAX_ATTEMPTS, applyRun, ciVerdict, classifyBranch, classifyExit,
  describeSpawnFailure, emptyState, isHang, itemKey, mayRemoveRunFile, mergedSinceClaim, needsDeployCheck, parkMessage, planQueue,
  productionLive, runClaimVerdict, shortIdOfBranch, shouldNotify, watchdogStep,
} from './lib/routine-watcher-core.mjs';

const MIN = 60_000;
const item = (id, last_human_id = null) => ({ id, seq: 1, last_human_id });
const result = (o) => JSON.stringify({ type: 'result', ...o });

test('classifyExit: a clean result is ok', () => {
  assert.equal(classifyExit({ tail: result({ is_error: false, subtype: 'success' }), exit: 0 }).kind, 'ok');
});
test('classifyExit: the usage limit is never a crash, and uses the announced reset', () => {
  const now = 1_000_000;
  const tail = [JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 5000 } }), result({ is_error: true, subtype: 'error_during_execution' })].join('\n');
  const c = classifyExit({ tail, exit: 1, now });
  assert.equal(c.kind, 'usage-limit');
  assert.equal(c.until, 5_000_000);
  assert.equal(classifyExit({ tail: result({ is_error: true, api_error_status: 429 }), now }).kind, 'usage-limit');
  assert.equal(classifyExit({ tail: result({ is_error: true, result: 'Claude usage limit reached' }), now }).kind, 'usage-limit');
});
test('classifyExit: a later allowed rate event clears an earlier rejection', () => {
  const tail = [JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 5000 } }), JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }), result({ is_error: false, subtype: 'success' })].join('\n');
  assert.equal(classifyExit({ tail, exit: 0 }).kind, 'ok');
});
test('classifyExit: login and network problems are told apart from a crash', () => {
  assert.equal(classifyExit({ tail: result({ is_error: true, api_error_status: 401 }) }).kind, 'auth');
  assert.equal(classifyExit({ tail: 'Please run /login', exit: 1 }).kind, 'auth');
  assert.equal(classifyExit({ tail: result({ is_error: true, api_error_status: 529 }) }).kind, 'transient');
  assert.equal(classifyExit({ tail: 'fetch failed', exit: 1 }).kind, 'transient');
  assert.equal(classifyExit({ tail: 'segfault', exit: 3 }).kind, 'crash');
  assert.equal(classifyExit({ tail: '', exit: null }).kind, 'crash');
});
test('classifyExit: a watchdog kill wins over whatever the log says', () => {
  assert.equal(classifyExit({ tail: result({ is_error: false, subtype: 'success' }), killedFor: 'hung' }).kind, 'killed');
});

test('applyRun: a run that resolved nothing charges everything it was given', () => {
  const snapshot = [item('a'), item('b')];
  const { state, charged } = applyRun({ state: emptyState(), snapshot, unresolvedIds: ['a', 'b'], claimedIds: [], outcome: { kind: 'crash', reason: 'x' }, now: 0 });
  assert.deepEqual(charged, ['a', 'b']);
  assert.equal(state.items.a.attempts, 1);
  assert.equal(state.items.a.nextAttemptAt, BACKOFF_MIN[0] * MIN);
});
test('applyRun: progress charges only the claimed item, the unreached one stays free', () => {
  const snapshot = [item('a'), item('b'), item('c')];
  const { state, charged } = applyRun({ state: emptyState(), snapshot, unresolvedIds: ['b', 'c'], claimedIds: ['b'], outcome: { kind: 'ok' }, now: 0 });
  assert.deepEqual(charged, ['b']);
  assert.equal(state.items.c, undefined);
});
test('applyRun: a wave stopped by the time limit charges its claims, not the topics it never reached', () => {
  const snapshot = [item('a'), item('b'), item('c')];
  const { state, charged } = applyRun({ state: emptyState(), snapshot, unresolvedIds: ['a', 'b', 'c'], claimedIds: ['a'], outcome: { kind: 'killed', reason: 'hard cap' }, now: 0 });
  assert.deepEqual(charged, ['a']);
  assert.equal(state.items.b, undefined);
});
test('applyRun: a resolved item loses its history', () => {
  const start = { ...emptyState(), items: { a: { key: itemKey(item('a')), attempts: 2, nextAttemptAt: 0 } } };
  assert.equal(applyRun({ state: start, snapshot: [item('a')], unresolvedIds: [], claimedIds: [], outcome: { kind: 'ok' }, now: 0 }).state.items.a, undefined);
});
for (const kind of ['usage-limit', 'auth', 'transient']) {
  test(`applyRun: ${kind} never charges an item, it cools the whole watcher down`, () => {
    const { state, charged } = applyRun({ state: emptyState(), snapshot: [item('a')], unresolvedIds: ['a'], claimedIds: ['a'], outcome: { kind, until: 99 }, now: 0 });
    assert.deepEqual(charged, []);
    assert.equal(state.cooldownUntil, 99);
    assert.equal(state.cooldownReason, kind);
  });
}
test('applyRun: a PC shutdown charges nothing', () => {
  assert.deepEqual(applyRun({ state: emptyState(), snapshot: [item('a')], unresolvedIds: ['a'], claimedIds: ['a'], outcome: { kind: 'interrupted' }, now: 0 }).charged, []);
});

test('planQueue: the attempts run out, then the item is parked and never run again', () => {
  let state = emptyState();
  const it = item('a', 'm1');
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    state = applyRun({ state, snapshot: [it], unresolvedIds: ['a'], claimedIds: ['a'], outcome: { kind: 'crash', reason: 'boom' }, now: 0 }).state;
    assert.equal(state.items.a.attempts, i);
  }
  const plan = planQueue([it], state, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(plan.eligible, []);
  assert.equal(plan.park[0].attempts, MAX_ATTEMPTS);
  assert.equal(plan.park[0].reason, 'boom');
});
test('planQueue: backoff holds an item back until it is over', () => {
  const state = { ...emptyState(), items: { a: { key: itemKey(item('a')), attempts: 1, nextAttemptAt: 100 } } };
  assert.equal(planQueue([item('a')], state, 99).waiting.length, 1);
  assert.equal(planQueue([item('a')], state, 100).eligible.length, 1);
});
test('planQueue: a new human message starts over, also on a used-up item', () => {
  const state = { ...emptyState(), items: { a: { key: itemKey(item('a', 'm1')), attempts: MAX_ATTEMPTS, nextAttemptAt: 0 } } };
  assert.equal(planQueue([item('a', 'm2')], state, 0).eligible.length, 1);
});

test('watchdog: a live run is left alone', () => {
  const w = watchdogStep({ awakeMs: 0, lastBeat: 0, quietFloor: 0 }, { now: MIN, newestWrite: MIN, startedAt: 0 });
  assert.equal(w.kill, null);
});
test('watchdog: silence past the limit stops the run', () => {
  let w = { awakeMs: 0, lastBeat: 0, quietFloor: 0 };
  for (let t = MIN; t <= (IDLE_KILL_MIN + 1) * MIN; t += MIN) w = watchdogStep(w, { now: t, newestWrite: 0, startedAt: 0 });
  assert.match(w.kill, /no activity/);
});
test('watchdog: the hard cap stops even a busy run', () => {
  let w = { awakeMs: 0, lastBeat: 0, quietFloor: 0 };
  for (let t = MIN; t <= (HARD_CAP_MIN + 1) * MIN; t += MIN) w = watchdogStep(w, { now: t, newestWrite: t, startedAt: 0 });
  assert.match(w.kill, /hard cap/);
});
test('watchdog: a night of sleep is neither silence nor run time', () => {
  const night = 8 * 60 * MIN;
  const w = watchdogStep({ awakeMs: 20 * MIN, lastBeat: 20 * MIN, quietFloor: 0 }, { now: 20 * MIN + night, newestWrite: 20 * MIN, startedAt: 0 });
  assert.equal(w.kill, null);
  assert.equal(w.awakeMs, 20 * MIN);
});

test('shortIdOfBranch: base and continuation branches, nothing else', () => {
  assert.equal(shortIdOfBranch('feat/feedback-1a2b3c4d'), '1a2b3c4d');
  assert.equal(shortIdOfBranch('feat/feedback-1a2b3c4d-9f8e7d6c'), '1a2b3c4d');
  assert.equal(shortIdOfBranch('feat/feedback-widget'), null);
  assert.equal(shortIdOfBranch('fix/feedback-1a2b3c4d'), null);
});
test('classifyBranch: a branch lives as long as its item is active', () => {
  assert.equal(classifyBranch({ status: 'needs_input', prState: null, ageMin: 9999 }), 'keep');
  assert.equal(classifyBranch({ status: 'open', prState: 'OPEN', ageMin: 9999 }), 'keep');
  assert.equal(classifyBranch({ status: 'shipped', prState: 'MERGED', ageMin: 9999 }), 'delete');
  assert.equal(classifyBranch({ status: 'declined', prState: null, ageMin: 9999 }), 'delete');
  assert.equal(classifyBranch({ status: 'shipped', prState: 'OPEN', ageMin: 9999 }), 'close-delete');
});
test('classifyBranch: young or unknown branches are not touched', () => {
  assert.equal(classifyBranch({ status: 'shipped', prState: 'MERGED', ageMin: 5 }), 'keep');
  assert.equal(classifyBranch({ status: null, prState: null, ageMin: 9999 }), 'keep');
});
test('mergedSinceClaim: the base PR of a continuation does not finish the new claim', () => {
  const prs = [{ state: 'MERGED', mergedAt: '2026-11-01T00:00:00Z', url: 'old' }];
  assert.equal(mergedSinceClaim(prs, '2026-11-05T00:00:00Z'), null);
  assert.equal(mergedSinceClaim([...prs, { state: 'MERGED', mergedAt: '2026-11-05T01:00:00Z', url: 'new' }], '2026-11-05T00:00:00Z').url, 'new');
  assert.equal(mergedSinceClaim([{ state: 'OPEN', mergedAt: null }], '2026-11-05T00:00:00Z'), null);
});
test('parkMessage: says it failed, where the work is, and offers the retry', () => {
  const m = parkMessage({ attempts: 3, reason: 'boom', branch: 'feat/feedback-1a2b3c4d', prUrl: null });
  assert.match(m, /3× gescheitert \(boom\)/);
  assert.match(m, /feat\/feedback-1a2b3c4d/);
  assert.match(m, /\[\[Erneut versuchen\|Thema schließen\]\]$/);
  assert.match(parkMessage({ attempts: 3, reason: 'x', branch: 'b', prUrl: 'https://pr' }), /https:\/\/pr/);
});
test('ciVerdict: reads the newest run only', () => {
  assert.equal(ciVerdict([]).state, 'none');
  assert.equal(ciVerdict(null).state, 'none');
  assert.equal(ciVerdict([{ databaseId: 1, status: 'in_progress', conclusion: '' }]).state, 'running');
  assert.equal(ciVerdict([{ databaseId: 1, status: 'completed', conclusion: 'success' }]).state, 'green');
  assert.equal(ciVerdict([{ databaseId: 2, status: 'completed', conclusion: 'failure' }, { databaseId: 1, status: 'completed', conclusion: 'success' }]).state, 'red');
  assert.equal(ciVerdict([{ databaseId: 1, status: 'completed', conclusion: 'cancelled' }]).state, 'red');
});
test('shouldNotify: one toast per kind inside the window', () => {
  assert.equal(shouldNotify({ notified: {} }, 'auth', 1000), true);
  assert.equal(shouldNotify({ notified: { auth: 1000 } }, 'auth', 2000), false);
  assert.equal(shouldNotify({ notified: { auth: 1000 } }, 'gate', 2000), true);
});

// ---- 2026-11-08 batch: W1 gate error cause, W2 double start, W3 merged vs online
test('W1: a gate child killed by the timeout is "timeout after Ns", not "exit null" (the real spawnSync shape)', () => {
  const r = spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 10000)'], { encoding: 'utf8', timeout: 300 });
  assert.equal(r.status, null);
  assert.equal(r.stderr, ''); // nothing printed: exactly the old `exit null` log line
  assert.equal(isHang(r), true);
  assert.match(describeSpawnFailure(r, 120_000), /^timeout after 120s — stderr empty$/);
});
test('W1: a signal, a spawn error, a plain exit and a stderr tail are told apart', () => {
  assert.match(describeSpawnFailure({ status: null, signal: 'SIGTERM', stderr: '' }, 1000), /^killed by SIGTERM/);
  assert.match(describeSpawnFailure({ status: null, error: { code: 'ENOENT' }, stderr: '' }, 1000), /^spawn ENOENT/);
  assert.match(describeSpawnFailure({ status: 2, stderr: 'a\nb\n[routine-gate] ERROR boom\n' }, 1000), /^exit 2 — stderr: a \| b \| \[routine-gate\] ERROR boom$/);
  assert.equal(isHang({ status: 2 }), false);
});
test('W1: the gate caps its SQL fetch below the watcher kill, so a dead socket ends as a readable error', () => {
  const src = readFileSync(new URL('./routine-gate.mjs', import.meta.url), 'utf8');
  assert.match(src, /AbortSignal\.timeout\(30_000\)/);
  assert.ok(GATE_FETCH_TIMEOUT_MS < 120_000);
});
test('W2: the run file is claimed exclusively; an existing file counts as a run', () => {
  assert.equal(runClaimVerdict(false), 'free');
  assert.equal(runClaimVerdict(true), 'taken');
});
test('W2: the loser of a double start removes only its own run file', () => {
  assert.equal(mayRemoveRunFile('a7aba95d', '767727d9'), false);
  assert.equal(mayRemoveRunFile('767727d9', '767727d9'), true);
  assert.equal(mayRemoveRunFile(undefined, '767727d9'), true);
});
test('W2: two exclusive creates cannot both win (the tick-lock / run-file primitive)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claim-'));
  const f = join(dir, 'run.json');
  let wins = 0;
  for (let i = 0; i < 2; i++) { try { writeFileSync(f, '{}', { flag: 'wx' }); wins++; } catch (e) { assert.equal(e.code, 'EEXIST'); } }
  assert.equal(wins, 1);
  rmSync(dir, { recursive: true, force: true });
});
test('W2: the watcher claims the run file before it spawns, and the tick lock is an exclusive create', () => {
  const src = readFileSync(new URL('./routine-watcher.mjs', import.meta.url), 'utf8');
  const claim = src.indexOf("writeFileSync(RUN_FILE, JSON.stringify(run, null, 2), { flag: 'wx' })");
  assert.ok(claim > 0);
  assert.ok(claim < src.indexOf("spawn(process.execPath, [fileURLToPath(import.meta.url), 'supervise'"));
  assert.match(src, /writeFileSync\(TICK_LOCK, .*\{ flag: 'wx' \}\)/);
});
test('W3: merged is not live until production carries the merge or a later commit', () => {
  const ancestor = (a, b) => a === 'merge' && b === 'later';
  assert.deepEqual(productionLive('merge', [{ sha: 'older' }], ancestor), { live: false, via: null }); // 2026-11-08: production stayed on ed5a51a7
  assert.deepEqual(productionLive('merge', [{ sha: 'merge' }], ancestor), { live: true, via: 'merge' });
  assert.deepEqual(productionLive('merge', [{ sha: 'later' }, { sha: 'older' }], ancestor), { live: true, via: 'later' }); // a skipped build, superseded by a descendant
  assert.deepEqual(productionLive('merge', [], ancestor), { live: false, via: null });
  assert.deepEqual(productionLive(null, [{ sha: 'later' }], ancestor), { live: false, via: null });
});
test('W3: only a PR ship_ref waits for a deploy', () => {
  assert.equal(needsDeployCheck('https://github.com/StarOrga/Verse-Companion-Web/pull/1027'), true);
  assert.equal(needsDeployCheck('https://github.com/StarOrga/Verse-Companion-Web/issues/12'), false);
  assert.equal(needsDeployCheck(null), false);
});
test('W3: the migration keeps the author view honest and carries live_at to the board', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261108221000_admin_feedback_live_at.sql', import.meta.url), 'utf8');
  assert.match(sql, /when f\.status = 'shipped' and f\.live_at is not null then 'done'/);
  assert.match(sql, /'live_at', f\.live_at/);
  assert.match(sql, /new\.live_at := null/);
});
