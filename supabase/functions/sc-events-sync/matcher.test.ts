// Tests for matcher.ts — `deno test` or `node --test matcher.test.ts` (Node 24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDateRanges, matchCommLinks, parseCommLink, planUpserts, type EventRow } from './matcher.ts';

const pub = new Date('2026-10-14T16:00:00Z');
const link = (id: number, title: string, body: string, at = '2026-10-14T16:00:00+00:00') =>
  parseCommLink({ id, title, rsi_url: `https://robertsspaceindustries.com/en/comm-link/transmission/${id}-x`, created_at: at, translations: { en_EN: body } })!;

test('date ranges: cross-month, same-month, explicit year, year rollover', () => {
  assert.deepEqual(extractDateRanges('runs October 21 – November 3, 2026.', pub).map((r) => [r.start, r.end]), [['2026-10-21', '2026-11-03']]);
  assert.deepEqual(extractDateRanges('From Oct. 14 to 27 watch', pub).map((r) => [r.start, r.end]), [['2026-10-14', '2026-10-27']]);
  assert.deepEqual(extractDateRanges('Dec 28 through Jan 4', new Date('2026-12-01Z')).map((r) => [r.start, r.end]), [['2026-12-28', '2027-01-04']]);
  assert.deepEqual(extractDateRanges('February 11–23', pub).map((r) => [r.start, r.end]), [['2027-02-11', '2027-02-23']]);
});

test('schema check rejects foreign hosts and missing fields', () => {
  assert.equal(parseCommLink({ id: 1, title: 'x', rsi_url: 'https://evil.example/x', created_at: '2026-01-01' }), null);
  assert.equal(parseCommLink({ id: 'a', title: 'x' }), null);
  assert.ok(parseCommLink({ id: 2, title: 'x', rsi_url: 'https://robertsspaceindustries.com/a', created_at: '2026-01-01T00:00:00Z', translations: null }));
});

test('title match confirms an estimated row; locked rows stay untouched', () => {
  const { candidates, unsure } = matchCommLinks([
    link(1, 'Day of the Vara 2956', 'Day of the Vara returns! The festivities run from October 21 to November 3.'),
    link(2, 'Luminalia 2956', 'Gifts are coming soon.'),
    link(3, 'Ship Showdown 2956 Winners', 'Voting ran July 28 – September 2.'),
  ]);
  assert.equal(candidates.length, 1);
  assert.deepEqual([candidates[0].series, candidates[0].start, candidates[0].end], ['day-of-the-vara', '2026-10-21', '2026-11-03']);
  assert.equal(unsure.length, 1);
  const row = (id: string, locked: boolean): EventRow => ({ id, series: 'day-of-the-vara', kind: 'seasonal', name: 'DotV', start_date: '2026-10-20', end_date: '2026-11-02', date_status: 'estimated', status: 'scheduled', free_fly: false, url: '', locked, hidden: false, source: 'seed', source_comm_link_id: null, source_published_at: null });
  const open = planUpserts([row('dotv-2956', false)], candidates, '2026-10-16');
  assert.equal(open.changes.find((c) => c.id === 'dotv-2956')?.action, 'confirm');
  const locked = planUpserts([row('dotv-2956', true)], candidates, '2026-10-16');
  assert.equal(locked.upserts.filter((u) => u.id === 'dotv-2956').length, 0);
});

test('TWISC mention with a range near the family name is a candidate', () => {
  const { candidates } = matchCommLinks([link(9, 'This Week in Star Citizen', 'Next up: Luminalia kicks off December 10 through December 22 across Stanton.')]);
  assert.deepEqual(candidates.map((c) => [c.series, c.start, c.end, c.source]), [['luminalia', '2026-12-10', '2026-12-22', 'twisc']]);
});

test('roll-forward adds next year as estimated when a series has nothing upcoming', () => {
  const past: EventRow = { id: 'aw-2956', series: 'alien-week', kind: 'seasonal', name: 'Alien Week 2956', start_date: '2026-06-17', end_date: '2026-07-06', date_status: 'confirmed', status: 'scheduled', free_fly: false, url: '', locked: true, hidden: false, source: 'seed', source_comm_link_id: null, source_published_at: null };
  const { upserts } = planUpserts([past], [], '2026-10-16');
  assert.deepEqual(upserts.map((u) => [u.id, u.start_date, u.date_status]), [['aw-2957', '2027-06-17', 'estimated']]);
});
