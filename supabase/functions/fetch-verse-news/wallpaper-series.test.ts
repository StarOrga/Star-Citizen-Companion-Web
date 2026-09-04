// Tests for wallpaper-series.ts. Pure logic, no Deno APIs, so it runs under
// both `deno test` (Edge parity) and Node 24's built-in test runner + type
// stripping:
//   node --test wallpaper-series.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWallpaperSeries } from './wallpaper-series.ts';

test('drops the series that keeps republishing the same header art', () => {
  assert.equal(isWallpaperSeries('Roadmap Roundup'), false);
});

test('matches the series name the way the SQL side does — trimmed, case-blind', () => {
  // The wiki API is the only writer of this field and it has been consistent,
  // but a policy and a crawler that disagree about casing would quietly let
  // rows in that the gallery then hides forever.
  assert.equal(isWallpaperSeries('roadmap roundup'), false);
  assert.equal(isWallpaperSeries('ROADMAP ROUNDUP'), false);
  assert.equal(isWallpaperSeries('  Roadmap Roundup  '), false);
});

test('keeps every other series', () => {
  assert.equal(isWallpaperSeries('Release Info'), true);
  assert.equal(isWallpaperSeries('Patch Notes'), true);
  assert.equal(isWallpaperSeries('This Week in Star Citizen'), true);
});

test('a missing series is not a reason to reject', () => {
  // Most of the gallery has no series at all; rejecting those would empty it.
  assert.equal(isWallpaperSeries(null), true);
  assert.equal(isWallpaperSeries(undefined), true);
  assert.equal(isWallpaperSeries(''), true);
});

test('does not reject a series that merely contains the excluded name', () => {
  // Exact match, not substring — a future "Roadmap Roundup Special" is a
  // different series and deserves its own verdict, not this one by accident.
  assert.equal(isWallpaperSeries('Roadmap Roundup Special'), true);
});
