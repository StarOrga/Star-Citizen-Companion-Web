// node --test supabase/functions/codex-patch-summary/_summary.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_LINES, MAX_LINE_CHARS, buildPrompt, clampLines, digestIsEmpty, parseSummary } from './_summary.ts';

describe('parseSummary', () => {
  it('clamps to three lines per language', () => {
    const r = parseSummary(JSON.stringify({ de: ['a', 'b', 'c', 'd'], en: ['1', '2', '3', '4', '5'] }));
    assert.deepEqual(r, { de: ['a', 'b', 'c'], en: ['1', '2', '3'] });
  });
  it('extracts JSON out of surrounding prose / code fences', () => {
    const r = parseSummary('Here:\n```json\n{"de":["x"],"en":["y"]}\n```');
    assert.deepEqual(r, { de: ['x'], en: ['y'] });
  });
  it('mirrors a missing language', () => {
    assert.deepEqual(parseSummary('{"de":["x"],"en":[]}'), { de: ['x'], en: ['x'] });
  });
  it('returns null for garbage or empty replies', () => {
    assert.equal(parseSummary('no json'), null);
    assert.equal(parseSummary('{"de":[],"en":[]}'), null);
    assert.equal(parseSummary('{"de": [1, null], "en": "x"}'), null);
    assert.equal(parseSummary('{bad'), null);
  });
});

describe('clampLines', () => {
  it('drops blanks and duplicates, trims, truncates long lines', () => {
    const long = 'x'.repeat(300);
    const out = clampLines(['  a  ', '', 'a', long, 'b', 'c']);
    assert.equal(out.length, MAX_LINES);
    assert.equal(out[0], 'a');
    assert.ok(out[1].length <= MAX_LINE_CHARS);
  });
  it('non-array gives []', () => assert.deepEqual(clampLines('x'), []));
});

describe('buildPrompt / digestIsEmpty', () => {
  it('embeds the digest and the no-itemised-list rule', () => {
    const p = buildPrompt({ patch: '4.4.0', has_previous: true, ships: { added: 2 } });
    assert.match(p, /4\.4\.0/);
    assert.match(p, /NEVER list items/);
    assert.match(p, /"added":2/);
  });
  it('empty when no previous build or no change', () => {
    assert.equal(digestIsEmpty(null), true);
    assert.equal(digestIsEmpty({ has_previous: false }), true);
    assert.equal(digestIsEmpty({ has_previous: true, ships: { added: 0, removed: 0, stat_changes: [] } }), true);
    assert.equal(digestIsEmpty({ has_previous: true, weapons: { added: 3 } }), false);
  });
});
