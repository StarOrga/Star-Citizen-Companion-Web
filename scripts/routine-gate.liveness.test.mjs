// node --test scripts/routine-gate.liveness.test.mjs
// The lock-liveness helpers of the routine gate: which transcript counts, and
// when a lock holder is judged dead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newestActivity, runIsDead, transcriptDirFor } from './routine-gate.mjs';

const MIN = 60_000;
const touch = (p, ageMin, now) => { writeFileSync(p, '{}\n'); const t = (now - ageMin * MIN) / 1000; utimesSync(p, t, t); };

test('transcriptDirFor maps the checkout path the way Claude Code does', () => {
  assert.equal(
    transcriptDirFor('C:\\Users\\Jerem\\IdeaProjects\\Star-Citizen-Companion-Web', 'H'),
    join('H', '.claude', 'projects', 'C--Users-Jerem-IdeaProjects-Star-Citizen-Companion-Web'),
  );
});

test('newestActivity: a session counts its own transcript and its subagents', () => {
  const now = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'gate-live-'));
  try {
    touch(join(dir, 'aaa.jsonl'), 50, now);
    mkdirSync(join(dir, 'aaa', 'subagents'), { recursive: true });
    touch(join(dir, 'aaa', 'subagents', 'agent-1.jsonl'), 5, now);
    touch(join(dir, 'bbb.jsonl'), 1, now); // another session in the same checkout
    const own = newestActivity(dir, 'aaa');
    assert.ok(Math.abs(now - own - 5 * MIN) < 5_000, 'subagent write is the newest write of session aaa');
    const any = newestActivity(dir, null);
    assert.ok(Math.abs(now - any - 1 * MIN) < 5_000, 'without a sid the newest write of any session counts');
    assert.equal(newestActivity(dir, 'zzz'), null, 'unknown session has no activity');
    assert.equal(newestActivity(join(dir, 'missing'), null), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runIsDead: grace first, then the idle limit', () => {
  const now = 1_000_000 * MIN;
  const startedAt = now - 10 * MIN;
  assert.equal(runIsDead({ startedAt, newest: null, now }), false, 'inside the grace period nothing is dead');
  assert.equal(runIsDead({ startedAt: now - 20 * MIN, newest: null, now }), true, 'no transcript at all after the grace period');
  assert.equal(runIsDead({ startedAt: now - 60 * MIN, newest: now - 29 * MIN, now }), false, 'wrote 29 min ago → alive');
  assert.equal(runIsDead({ startedAt: now - 60 * MIN, newest: now - 31 * MIN, now }), true, 'wrote 31 min ago → dead');
  assert.equal(runIsDead({ startedAt: now - 60 * MIN, newest: now - 31 * MIN, now, deadMin: 45 }), false, 'limit is a parameter');
});
