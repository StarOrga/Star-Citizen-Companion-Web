// Chaos test of the real watcher against the real board and origin, with a fake `claude`.
// Run from the checkout under test. Uses throw-away rows and cleans up after itself.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-chaos-'));
const REPO = process.cwd();
const cmd = path.join(HOME, 'fake.cmd');
fs.writeFileSync(cmd, `@echo off\r\n"${process.execPath}" "${path.join(HERE, 'fake-claude.mjs')}" %*\r\n`);
const sqlq = (query) => JSON.parse(execFileSync(process.execPath, ['scripts/routine-gate.mjs', 'sql', '--query', query], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop());
const q = (s) => `'${s.replace(/'/g, "''")}'`;
const author = sqlq(`select author_id from public.admin_feedback where source='admin' order by created_at desc limit 1`)[0].author_id;
const newItem = (t) => sqlq(`insert into public.admin_feedback (author_id, body, status, source, triaged, area) values (${q(author)}, ${q(`[watcher-test] ${t}`)}, 'open', 'admin', true, 'other') returning id`)[0].id;
const row = (id) => sqlq(`select status, ship_ref, processing_note, review_reply_pending from public.admin_feedback where id=${q(id)}`)[0];
const msgs = (id) => sqlq(`select body, is_system from public.admin_feedback_messages where feedback_id=${q(id)} order by created_at`);
const hb = () => sqlq(`select state, note from public.routine_heartbeat where id='admin-feedback-routine'`)[0];
const env = (mode, id, extra = {}) => ({ ...process.env, SCC_ROUTINE_HOME: HOME, SCC_CLAUDE_BIN: cmd, FAKE_MODE: mode, FAKE_ITEM: id, ...extra });
const tick = (mode, id, extra) => { const r = spawnSync(process.execPath, ['scripts/routine-watcher.mjs', 'tick'], { env: env(mode, id, extra), encoding: 'utf8' }); return r.stderr; };
const stateF = path.join(HOME, 'state.json'), runF = path.join(HOME, 'run.json');
const state = () => JSON.parse(fs.readFileSync(stateF, 'utf8'));
const clearCooldown = () => { const s = state(); s.cooldownUntil = null; s.lastSweepAt = Date.now(); fs.writeFileSync(stateF, JSON.stringify(s)); };
const skipBackoff = (id) => { const s = state(); s.items[id].nextAttemptAt = 0; fs.writeFileSync(stateF, JSON.stringify(s)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, what, ms = 150_000) => { const t = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t > ms) throw new Error(`timeout: ${what}`); await sleep(1000); } };
const runOver = () => until(() => !fs.existsSync(runF), 'run file gone');
const created = [];
const it = async (name, f) => { const t = Date.now(); try { await f(); console.log(`PASS ${name} (${Math.round((Date.now() - t) / 1000)}s)`); } catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };
fs.writeFileSync(stateF, JSON.stringify({ lastSweepAt: Date.now() }));

try {
  await it('usage limit: no attempt charged, item untouched, panel paused, no new run during cooldown', async () => {
    const id = newItem('usage'); created.push(id);
    tick('usage', id); await runOver();
    assert.equal(row(id).status, 'open');
    assert.equal(state().items[id], undefined);
    assert.equal(state().cooldownReason, 'usage-limit');
    assert.equal(hb().state, 'paused');
    const log = tick('crash', id); assert.ok(!fs.existsSync(runF), `started during cooldown: ${log}`);
    clearCooldown();
    sqlq(`delete from public.admin_feedback where id=${q(id)} returning id`);
  });

  await it('login expired: no attempt charged, cooldown', async () => {
    const id = newItem('auth'); created.push(id);
    tick('auth', id); await runOver();
    assert.equal(state().items[id], undefined);
    assert.equal(state().cooldownReason, 'auth');
    clearCooldown();
    sqlq(`delete from public.admin_feedback where id=${q(id)} returning id`);
  });

  await it('3 crashes ⇒ parked with a reply; a human answer starts over', async () => {
    const id = newItem('crash'); created.push(id);
    for (let i = 1; i <= 3; i++) {
      tick('crash', id); await runOver();
      assert.equal(state().items[id].attempts, i);
      tick('crash', id); assert.ok(i === 3 || !fs.existsSync(runF), 'backoff ignored');
      if (i < 3) skipBackoff(id);
    }
    await sleep(500);
    assert.equal(row(id).status, 'needs_input');
    const m = msgs(id).at(-1);
    assert.ok(m.is_system && /3× gescheitert/.test(m.body), m.body);
    assert.equal(state().items[id], undefined);
    tick('crash', id); assert.ok(!fs.existsSync(runF), 'parked item ran again');
    sqlq(`insert into public.admin_feedback_messages (feedback_id, is_system, body, author_id) values (${q(id)}, false, 'nochmal', ${q(author)}) returning id`);
    tick('crash', id); await runOver();
    assert.equal(state().items[id].attempts, 1, 'human reply must start over');
    sqlq(`delete from public.admin_feedback where id=${q(id)} returning id`);
  });

  await it('a run that dies mid-work: uncommitted work pushed, worktree gone, item back in the queue, lock free', async () => {
    const id = newItem('claim-die'); created.push(id); const short = id.slice(0, 8);
    tick('claim-die', id); await runOver();
    assert.equal(row(id).status, 'open');
    assert.match(row(id).processing_note, /run ended without finishing/);
    assert.ok(!fs.existsSync(path.join(REPO, '.claude/worktrees', `scfb-${short}`)), 'worktree left');
    const remote = execFileSync('git', ['ls-remote', '--heads', 'origin', `feat/feedback-${short}`], { encoding: 'utf8' });
    assert.ok(remote.includes(short), 'branch not on the remote');
    execFileSync('git', ['fetch', 'origin', `feat/feedback-${short}`, '--quiet']);
    assert.match(execFileSync('git', ['show', '--name-only', '--format=%s', 'FETCH_HEAD'], { encoding: 'utf8' }), /wip: rescued[\s\S]*watcher-chaos-test\.txt/);
    assert.notEqual(hb().state, 'running');
    assert.equal(state().items[id].attempts, 1);
    execFileSync('git', ['push', 'origin', '--delete', `feat/feedback-${short}`], { stdio: 'ignore' });
    sqlq(`delete from public.admin_feedback where id=${q(id)} returning id`);
  });

  await it('supervisor killed (PC crash): next tick kills the orphan, hands the claim back, charges nothing', async () => {
    const id = newItem('hang'); created.push(id);
    const pidfile = path.join(HOME, 'hang.pid');
    tick('hang', id, { FAKE_PIDFILE: pidfile });
    await until(() => fs.existsSync(pidfile), 'fake started');
    const run = JSON.parse(fs.readFileSync(runF, 'utf8'));
    assert.equal(hb().state, 'running');
    tick('hang', id); assert.ok(fs.existsSync(runF), 'a live run must be left alone');
    spawnSync('taskkill', ['/PID', String(run.pid), '/F']);
    await sleep(1000);
    tick('hang', id);
    assert.ok(!fs.existsSync(runF), 'recovery did not finish');
    const fakePid = Number(fs.readFileSync(pidfile, 'utf8'));
    let alive = true; try { process.kill(fakePid, 0); } catch { alive = false; }
    assert.equal(alive, false, 'orphan claude still running');
    assert.equal(row(id).status, 'open');
    assert.notEqual(hb().state, 'running');
    assert.equal(state().items[id], undefined);
    sqlq(`delete from public.admin_feedback where id=${q(id)} returning id`);
  });

  await it('board unreachable during postflight: the run file survives and the next tick repeats it', async () => {
    const id = newItem('offline'); created.push(id);
    fs.writeFileSync(runF, JSON.stringify({ pid: 1, sid: '00000000-0000-4000-8000-000000000000', startedIso: new Date().toISOString(), snapshot: [{ id, seq: 0 }], outcome: { kind: 'crash', reason: 'x' } }));
    tick('ok-noop', id, { SUPABASE_ACCESS_TOKEN: 'sbp_invalid_token_for_the_chaos_test_0000000000' });
    assert.ok(fs.existsSync(runF), 'postflight failure must keep the run file');
    tick('ok-noop', id);
    assert.ok(!fs.existsSync(runF));
    assert.equal(state().items[id].attempts, 1);
    sqlq(`delete from public.admin_feedback where id=${q(id)} returning id`);
  });

  await it('a run that does nothing is charged; a shipped item without a PR still gets its reply', async () => {
    const a = newItem('noop'); created.push(a);
    tick('ok-noop', a); await runOver();
    assert.equal(state().items[a].attempts, 1);
    sqlq(`delete from public.admin_feedback where id=${q(a)} returning id`);
    const id = newItem('ship'); created.push(id);
    tick('ship', id); await runOver();
    assert.equal(row(id).status, 'shipped');
    tick('ok-noop', id);
    assert.equal(row(id).review_reply_pending, false);
    assert.match(msgs(id).at(-1).body, /Erledigt/);
    sqlq(`delete from public.admin_feedback where id=${q(id)} returning id`);
  });
} finally {
  for (const id of created) sqlq(`delete from public.admin_feedback where id=${q(id)} returning id`);
  spawnSync(process.execPath, ['scripts/routine-gate.mjs', 'end-run', '--state', 'idle', '--note', 'queue-empty']);
  console.log(`home: ${HOME}`);
}
