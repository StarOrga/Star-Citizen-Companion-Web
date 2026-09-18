// node --test scripts/routine-gate.liveness.test.mjs
// The lock-liveness helpers of the routine gate: which transcript counts, and
// when a lock holder is judged dead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newestActivity, runIsDead, transcriptActivity, transcriptDirFor } from './routine-gate.mjs';

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

test('transcriptActivity: the last real record counts, not the app\'s bookkeeping writes', () => {
  const now = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'gate-live-'));
  try {
    const dead = new Date(now - 40 * MIN).toISOString();
    const f = join(dir, 'run.jsonl');
    writeFileSync(f, [
      JSON.stringify({ type: 'assistant', timestamp: new Date(now - 50 * MIN).toISOString(), message: {} }),
      JSON.stringify({ type: 'user', timestamp: dead, message: {} }),
      JSON.stringify({ type: 'queue-operation', timestamp: new Date(now - 39 * MIN).toISOString() }),
      JSON.stringify({ type: 'custom-title', customTitle: 'x' }),
      JSON.stringify({ type: 'last-prompt', leafUuid: 'y' }),
      JSON.stringify({ type: 'mode', mode: 'normal' }),
      '',
    ].join('\n'));
    // The app touched the file just now — the mtime is fresh, the run is not.
    const t = now / 1000; utimesSync(f, t, t);
    assert.equal(transcriptActivity(f), Date.parse(dead), 'newest user/assistant record wins over mtime');

    // The app's synthetic resume pair (isMeta user + "<synthetic>" assistant) is not activity.
    const fresh = new Date(now - 2 * MIN).toISOString();
    writeFileSync(f, [
      JSON.stringify({ type: 'user', timestamp: dead, message: {} }),
      JSON.stringify({ type: 'user', timestamp: fresh, isMeta: true, message: { content: [{ type: 'text', text: 'Continue from where you left off.' }] } }),
      JSON.stringify({ type: 'assistant', timestamp: fresh, message: { model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }] } }),
      '',
    ].join('\n'));
    assert.equal(transcriptActivity(f), Date.parse(dead), 'synthetic resume pair is ignored');
    assert.equal(newestActivity(dir, 'run'), Date.parse(dead));
    assert.ok(runIsDead({ startedAt: now - 120 * MIN, newest: newestActivity(dir, 'run'), now }), 'dead 40 min after its last real record');

    const plain = join(dir, 'plain.jsonl');
    touch(plain, 3, now);
    assert.ok(Math.abs(now - transcriptActivity(plain) - 3 * MIN) < 5_000, 'no timestamped record → mtime fallback');
    assert.equal(transcriptActivity(join(dir, 'missing.jsonl')), null);
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
