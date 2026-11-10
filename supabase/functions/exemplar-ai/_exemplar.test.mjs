// node --test supabase/functions/exemplar-ai/_exemplar.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CORS, NAME_MAX, SUMMARY_MAX, buildPrompt, clampText, limitOf, parseReply, parseRequest, preflight } from './_exemplar.ts';

const changes = [{ slot: 'Waffe 1', from: 'Omnisky VI', to: 'Laser Repeater S3' }];

describe('limits', () => {
  it('name 32, summary 90', () => {
    assert.equal(NAME_MAX, 32);
    assert.equal(SUMMARY_MAX, 90);
    assert.equal(limitOf('exemplar_name'), 32);
    assert.equal(limitOf('exemplar_summary'), 90);
  });
});

describe('clampText', () => {
  it('strips quotes and (for names) the trailing dot, cuts at a word', () => {
    const t = clampText('"Laser-Jäger mit Distortion und viel Kühlung für alle."', 32, true);
    assert.ok(Array.from(t).length <= 32);
    assert.ok(!t.startsWith('"') && !t.endsWith('.') && !t.endsWith(' '));
  });
  it('never splits a code point', () => {
    assert.equal(Array.from(clampText('😀'.repeat(200), 90, false)).length, 90);
  });
  it('removes bidi overrides and zero-width characters', () => {
    assert.equal(clampText('Fal‮ke​', 32, true), 'Falke');
  });
});

describe('parseReply', () => {
  it('reads the name / summary out of prose and fences', () => {
    assert.equal(parseReply('```json\n{"name":"Laser-Jäger"}\n```', 'exemplar_name'), 'Laser-Jäger');
    assert.equal(parseReply('Hier: {"summary":"Laser-Jäger mit Distortion-Sekundär, mehr Kühlung"}', 'exemplar_summary'),
      'Laser-Jäger mit Distortion-Sekundär, mehr Kühlung');
  });
  it('applies the hard limits', () => {
    assert.ok(Array.from(parseReply('{"name":"' + 'wort '.repeat(20) + '"}', 'exemplar_name')).length <= 32);
    assert.ok(Array.from(parseReply('{"summary":"' + 'wort '.repeat(40) + '"}', 'exemplar_summary')).length <= 90);
  });
  it('drops anything unusable or self-labelled as AI', () => {
    assert.equal(parseReply('nope', 'exemplar_name'), null);
    assert.equal(parseReply('{bad', 'exemplar_name'), null);
    assert.equal(parseReply('{"name":""}', 'exemplar_name'), null);
    assert.equal(parseReply('{"summary":"KI Zusammenfassung"}', 'exemplar_summary'), null);
    assert.equal(parseReply('{"name":"x"}', 'exemplar_summary'), null);
  });
});

describe('parseRequest', () => {
  it('accepts a clean request and caps fields', () => {
    const r = parseRequest({ kind: 'exemplar_name', locale: 'en', ship: ' Gladius ', changes: [...changes, { to: '' }, null] });
    assert.deepEqual(r, { kind: 'exemplar_name', locale: 'en', ship: 'Gladius', changes });
  });
  it('rejects no changes (nothing differs from Werk), bad kind, missing ship', () => {
    assert.equal(parseRequest({ kind: 'exemplar_name', ship: 'Gladius', changes: [] }), null);
    assert.equal(parseRequest({ kind: 'nachschub', ship: 'Gladius', changes }), null);
    assert.equal(parseRequest({ kind: 'exemplar_name', ship: '', changes }), null);
    assert.equal(parseRequest(null), null);
  });
  it('caps the number of changes', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ slot: `s${i}`, from: 'a', to: 'b' }));
    assert.equal(parseRequest({ kind: 'exemplar_summary', ship: 'X', changes: many }).changes.length, 24);
  });
});

describe('buildPrompt', () => {
  it('states limit, language and the swaps', () => {
    const p = buildPrompt(parseRequest({ kind: 'exemplar_summary', locale: 'de', ship: 'Gladius', changes }));
    assert.match(p, /At most 90 characters, in German/);
    assert.match(p, /Waffe 1: Omnisky VI -> Laser Repeater S3/);
    assert.match(p, /"summary"/);
    assert.match(buildPrompt(parseRequest({ kind: 'exemplar_name', locale: 'en', ship: 'Gladius', changes })), /At most 32 characters, in English/);
  });
});

describe('cors', () => {
  it('answers the preflight, ignores other methods', () => {
    assert.equal(preflight('OPTIONS').status, 200);
    assert.equal(preflight('POST'), null);
    assert.match(CORS['Access-Control-Allow-Headers'], /authorization/);
  });
});
