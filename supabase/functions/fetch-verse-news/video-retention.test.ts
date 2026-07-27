// Tests for video-retention.ts. Pure logic, no Deno APIs, so it runs under both
// `deno test` (Edge parity) and Node 24's built-in test runner + type stripping:
//   node --test video-retention.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_RETENTION_DAYS, isWithinVideoRetention, videoRetentionCutoff } from './video-retention.ts';

const NOW = Date.parse('2026-07-28T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

test('keeps a video published today', () => {
  assert.equal(isWithinVideoRetention(iso(2 * 60 * 60 * 1000), NOW), true);
});

test('keeps a video published this week', () => {
  assert.equal(isWithinVideoRetention(iso(5 * DAY), NOW), true);
});

test('keeps a video published this month', () => {
  assert.equal(isWithinVideoRetention(iso(29 * DAY), NOW), true);
});

test('drops a video older than the retention window', () => {
  assert.equal(isWithinVideoRetention(iso((VIDEO_RETENTION_DAYS + 1) * DAY), NOW), false);
});

test('treats the cutoff itself as still inside the window', () => {
  assert.equal(isWithinVideoRetention(new Date(videoRetentionCutoff(NOW)).toISOString(), NOW), true);
});

test('treats a missing or unparseable date as expired', () => {
  assert.equal(isWithinVideoRetention(undefined, NOW), false);
  assert.equal(isWithinVideoRetention('', NOW), false);
  assert.equal(isWithinVideoRetention('not-a-date', NOW), false);
});

test('a future-dated video is kept (never prune something not yet aged)', () => {
  assert.equal(isWithinVideoRetention(new Date(NOW + DAY).toISOString(), NOW), true);
});
