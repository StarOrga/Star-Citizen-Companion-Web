// node --test supabase/functions/translation-overlay/_key.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { overlayObjectKey } from './_key.ts';
import { roomOverlayKey } from '../translate-orchestrator/_io.ts';

const LANG = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;
const BUILD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('overlayObjectKey', () => {
  it('latest and per build', () => {
    assert.equal(overlayObjectKey('de', null, LANG, BUILD), 'translation-overlay/de/latest.json');
    assert.equal(overlayObjectKey('de', ID, LANG, BUILD), `translation-overlay/de/${ID}.json`);
    assert.equal(overlayObjectKey('de', 'nope', LANG, BUILD), null);
    assert.equal(overlayObjectKey('../x', null, LANG, BUILD), null);
  });

  it('ns=rooms reads the slice the orchestrator writes (E14)', () => {
    assert.equal(overlayObjectKey('de', null, LANG, BUILD, 'rooms'), roomOverlayKey('de'));
    assert.equal(overlayObjectKey('de', '', LANG, BUILD, 'rooms'), 'translation-overlay/de/rooms.json');
    assert.equal(overlayObjectKey('de', ID, LANG, BUILD, 'rooms'), null);
    assert.equal(overlayObjectKey('de', null, LANG, BUILD, 'latest'), null);
    assert.equal(overlayObjectKey('de', null, LANG, BUILD, '../tm'), null);
  });
});
