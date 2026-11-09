// node --test supabase/functions/nachschub-names/_names.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EINSATZ_MAX, NACHSCHUB_MAX, buildPrompt, clampName, limitOf, parseName, parseRequest } from './_names.ts';

describe('limits', () => {
  it('Nachschub 28, Einsatz 40', () => {
    assert.equal(NACHSCHUB_MAX, 28);
    assert.equal(EINSATZ_MAX, 40);
    assert.equal(limitOf('nachschub'), 28);
    assert.equal(limitOf('einsatz'), 40);
  });
});

describe('clampName', () => {
  it('cuts at a word boundary to the limit, strips quotes and the trailing dot', () => {
    const t = clampName('"Rattler-Raketen und Magazine fuer die Vanguard."', 28);
    assert.ok(t.length <= 28);
    assert.ok(!t.startsWith('"') && !t.endsWith('.') && !t.endsWith(' '));
  });
  it('never splits a code point', () => {
    assert.equal(Array.from(clampName('😀'.repeat(50), 28)).length, 28);
  });
});

describe('parseName', () => {
  it('reads JSON out of prose and fences and applies the limit', () => {
    assert.equal(parseName('```json\n{"name":"Rattler-Vorrat"}\n```', 28), 'Rattler-Vorrat');
    assert.ok(parseName('{"name":"' + 'wort '.repeat(20) + '"}', 28).length <= 28);
  });
  it('returns null for anything unusable', () => {
    assert.equal(parseName('nope', 28), null);
    assert.equal(parseName('{bad', 28), null);
    assert.equal(parseName('{"name":""}', 28), null);
  });
});

describe('parseRequest', () => {
  it('accepts a clean request and caps fields', () => {
    const r = parseRequest({ kind: 'nachschub', locale: 'en', items: [{ name: ' Rattler  II ', qty: 5000 }, { name: '' }, null] });
    assert.deepEqual(r, { kind: 'nachschub', locale: 'en', items: [{ name: 'Rattler II', qty: 999 }] });
  });
  it('defaults the locale to de and limits the item count', () => {
    const r = parseRequest({ kind: 'einsatz', items: Array.from({ length: 100 }, (_, i) => ({ name: `x${i}`, qty: 1 })) });
    assert.equal(r.locale, 'de');
    assert.equal(r.items.length, 30);
  });
  it('rejects bad kinds, bodies and empty lists', () => {
    assert.equal(parseRequest(null), null);
    assert.equal(parseRequest({ kind: 'paket', items: [{ name: 'a' }] }), null);
    assert.equal(parseRequest({ kind: 'nachschub', items: [] }), null);
    assert.equal(parseRequest({ kind: 'nachschub', items: 'x' }), null);
  });
});

describe('buildPrompt', () => {
  it('carries the limit, the language, the items, and never asks for an AI label', () => {
    const p = buildPrompt({ kind: 'nachschub', locale: 'de', items: [{ name: 'Rattler II', qty: 4 }] });
    assert.ok(p.includes('28') && p.includes('German') && p.includes('- 4x Rattler II'));
    assert.ok(/no mention of AI/.test(p));
    assert.ok(buildPrompt({ kind: 'einsatz', locale: 'en', items: [{ name: 'a', qty: 1 }] }).includes('40'));
  });

  it('rules out the generic words and the list form, and keeps quantities out of an Einsatz', () => {
    const n = buildPrompt({ kind: 'nachschub', locale: 'de', items: [{ name: 'Medpen', qty: 2 }, { name: 'Gallant', qty: 1 }] });
    assert.ok(n.includes('"Nachschub"') && n.includes('"neu"') && /not a list/.test(n));
    const e = buildPrompt({ kind: 'einsatz', locale: 'de', items: [{ name: 'Titan-Erz abbauen', qty: 1 }] });
    assert.ok(e.includes('- Titan-Erz abbauen') && !e.includes('1x'));
  });
});
