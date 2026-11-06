// node --test supabase/functions/patch-teaser/_teaser.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TEASER_MAX, VERSION_RE, buildPrompt, clampTitle, parseTeaser } from './_teaser.ts';

describe('clampTitle', () => {
  it('cuts at a word boundary to the hard limit', () => {
    const t = clampTitle('Neue Bergbau-Mechanik, Laser-Repeater und viele weitere Schiffsanpassungen');
    assert.ok(t.length <= TEASER_MAX);
    assert.ok(!t.endsWith(' '));
  });
  it('strips quotes and trailing dots', () => assert.equal(clampTitle('"Mining reloaded."'), 'Mining reloaded'));
});

describe('parseTeaser', () => {
  it('reads JSON out of prose and fences', () => {
    assert.deepEqual(parseTeaser('```json\n{"de":"Neuer Bergbau","en":"New mining"}\n```'), { de: 'Neuer Bergbau', en: 'New mining' });
  });
  it('never returns half a teaser', () => {
    assert.equal(parseTeaser('{"de":"x","en":""}'), null);
    assert.equal(parseTeaser('nope'), null);
    assert.equal(parseTeaser('{bad'), null);
  });
});

describe('inputs', () => {
  it('accepts three-part and two-part versions only', () => {
    assert.ok(VERSION_RE.test('4.10.3') && VERSION_RE.test('4.11'));
    assert.ok(!VERSION_RE.test('4.10.3-ptu') && !VERSION_RE.test('4; drop'));
  });
  it('prompt carries the limit and the bullets', () => {
    const p = buildPrompt('4.10.3', [{ kind: 'bullet', text: 'Laser repeater' }, { kind: 'text', text: 'prose' }]);
    assert.ok(p.includes('44') && p.includes('- Laser repeater') && !p.includes('prose'));
  });
});
