// node --test supabase/functions/nachschub-names/_sanitize.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampName, mentionsAi, parseName, parseRequest, stripInvisible } from './_names.ts';

// Built from code points so this file itself carries no invisible characters.
const cp = (...n) => String.fromCharCode(...n);

describe('invisible characters (L3)', () => {
  it('stripInvisible removes control, zero-width, soft hyphen and bidi characters', () => {
    const dirty = `Rat${cp(0x200b)}tler${cp(0x202e)}-Vor${cp(0)}rat${cp(7)}${cp(0xfeff)}${cp(0xad)}`;
    assert.equal(stripInvisible(dirty), 'Rattler-Vorrat');
  });
  it('clampName strips them from a name', () => {
    assert.equal(clampName(`Med${cp(0x2066)}pen${cp(0x200f)}-Set`, 28), 'Medpen-Set');
  });
  it('parseName strips them from the model reply', () => {
    assert.equal(parseName(`{"name":"Med${cp(0x2066)}pen${cp(0x200f)}-Set"}`, 28), 'Medpen-Set');
  });
  it('parseRequest cleans item names too', () => {
    const r = parseRequest({ kind: 'nachschub', items: [{ name: `Rat${cp(0x202e)}tler${cp(0x200d)}`, qty: 2 }] });
    assert.equal(r.items[0].name, 'Rattler');
  });
  it('whitespace controls still collapse to one space', () => {
    assert.equal(clampName('Rattler\n\tVorrat', 28), 'Rattler Vorrat');
  });
});

describe('never AI / KI in a name (L3)', () => {
  it('flags a standalone AI / KI', () => {
    for (const t of ['KI Vorrat', 'AI Loadout', 'Vorrat (KI)', 'A.I. Kit', 'ki-vorrat', 'Vorrat, AI']) assert.equal(mentionsAi(t), true, t);
  });
  it('drops a reply that calls itself AI or KI', () => {
    assert.equal(parseName('{"name":"KI Vorrat"}', 28), null);
    assert.equal(parseName('{"name":"AI Loadout"}', 28), null);
  });
  it('keeps words that merely contain the letters', () => {
    assert.equal(parseName('{"name":"Kiste Medpens"}', 28), 'Kiste Medpens');
    assert.equal(parseName('{"name":"Waisen-Kit"}', 28), 'Waisen-Kit');
    assert.equal(parseName('{"name":"Taifun"}', 28), 'Taifun');
  });
});
