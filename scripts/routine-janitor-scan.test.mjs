// node --test scripts/routine-janitor-scan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './routine-janitor-scan.mjs';

const MIN = 60_000;
const now = Date.parse('2026-09-18T14:00:00Z');
const rec = (id, startMinAgo, durMin, archived = false, task = 'nightly-admin-feedback') =>
  ({ id, task, created: now - startMinAgo * MIN, last: now - startMinAgo * MIN + durMin * MIN, archived, title: 't' });

test('classify: idle ticks archive at once and delete after 1 h; 3 newest working runs stay', () => {
  const c = classify([
    rec('run-now', 1, 0.5),                 // touched 30 s ago → running
    rec('idle-young', 20, 0.5),             // idle, 19.5 min old → archive only
    rec('idle-old', 90, 0.5),               // idle, 89.5 min → archive + delete
    rec('idle-old-archived', 200, 1, true), // already archived → delete only
    rec('w1', 30, 10), rec('w2', 120, 40), rec('w3', 300, 20), rec('w4', 600, 90), // working
    rec('w5-archived', 900, 30, true),
  ], now, 0);
  assert.deepEqual(c.running.map((r) => r.id), ['run-now']);
  assert.deepEqual(c.archive.map((r) => r.id), ['idle-young', 'idle-old', 'w4']);
  assert.deepEqual(c.delete.map((r) => r.id), ['idle-old-archived', 'idle-old'], 'oldest first, never a young idle tick');
  assert.deepEqual(c.keep.map((r) => r.id), ['w1', 'w2', 'w3']);
  assert.equal(c.deletePending, 0);
  assert.deepEqual(c.totals, { records: 9, idle: 3, working: 5 });
});

test('classify: delete is capped at 25 per sweep, both tasks count together', () => {
  const many = Array.from({ length: 30 }, (_, i) => rec(`i${i}`, 120 + i, 0.5, false, i % 2 ? 'nightly-admin-feedback-day' : 'nightly-admin-feedback'));
  const c = classify(many, now);
  assert.equal(c.delete.length, 25);
  assert.equal(c.deletePending, 5);
  assert.equal(c.delete[0].id, 'i29', 'oldest first');
});

test('classify: archive candidates quiet for less than 2 h are deferred, not archived (consent-card guard)', () => {
  const c = classify([
    rec('idle-fresh', 20, 0.5),   // quiet 19.5 min → deferred
    rec('idle-119', 120, 0.5),    // quiet 119.5 min → deferred
    rec('idle-old', 121, 0.5),    // quiet 120.5 min → archive
    rec('w1', 30, 10), rec('w2', 120, 40), rec('w3', 300, 20),
    rec('w4-fresh-end', 400, 390), // 4th newest, but its last activity is 10 min ago → deferred
    rec('w5', 600, 90),            // 5th newest, quiet 8.5 h → archive
  ], now);
  assert.deepEqual(c.archive.map((r) => r.id), ['idle-old', 'w5']);
  assert.deepEqual(c.deferred.map((r) => r.id), ['idle-fresh', 'idle-119', 'w4-fresh-end']);
  assert.deepEqual(c.keep.map((r) => r.id), ['w1', 'w2', 'w3']);
  assert.deepEqual(c.delete.map((r) => r.id), ['idle-old', 'idle-119'], 'the delete list is untouched by the age gate');
});
