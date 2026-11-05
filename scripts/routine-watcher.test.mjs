import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BACKOFF_MIN, HARD_CAP_MIN, IDLE_KILL_MIN, MAX_ATTEMPTS, applyRun, classifyBranch, classifyExit, emptyState, itemKey,
  mergedSinceClaim, parkMessage, planQueue, shortIdOfBranch, shouldNotify, watchdogStep,
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
test('shouldNotify: one toast per kind inside the window', () => {
  assert.equal(shouldNotify({ notified: {} }, 'auth', 1000), true);
  assert.equal(shouldNotify({ notified: { auth: 1000 } }, 'auth', 2000), false);
  assert.equal(shouldNotify({ notified: { auth: 1000 } }, 'gate', 2000), true);
});
