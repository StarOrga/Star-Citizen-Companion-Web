// node --test supabase/functions/rsi-paints-sync/_paints.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanPaintName, matchShipClass, normalizeName, pickImage, readListing, splitTitle, toPaintRow } from './_paints.ts';

const known = new Map([['gladius', 'Gladius'], ['idrism', 'Idris-M'], ['idris', 'Idris']]);
const classes = new Map([['aegisgladius', 'AEGS_Gladius'], ['aegisidrism', 'AEGS_Idris_M']]);

describe('splitTitle', () => {
  it('handles ship-first and paint-first order', () => {
    assert.deepEqual(splitTitle('Gladius - Ghoulish Green Paint', known), { ship: 'Gladius', paint: 'Ghoulish Green' });
    assert.deepEqual(splitTitle('Ghoulish Green Paint - Gladius', known), { ship: 'Gladius', paint: 'Ghoulish Green' });
  });
  it('prefers the most specific ship', () => {
    assert.equal(splitTitle('Idris-M - Red Paint', known)?.ship, 'Idris-M');
  });
  it('null when no known ship / no separator', () => {
    assert.equal(splitTitle('Foo - Bar', known), null);
    assert.equal(splitTitle('Gladius', known), null);
  });
});

describe('pickImage', () => {
  it('prefers store_small and accepts only RSI https urls', () => {
    assert.equal(pickImage({ thumbnails: { store_small: '/media/x/store_small.jpg', post: 'https://evil.example/x.jpg' } }),
      'https://robertsspaceindustries.com/media/x/store_small.jpg');
    assert.equal(pickImage({ thumbnail: { storeSmall: 'https://evil.example/x.jpg' } }), null);
    assert.equal(pickImage({ thumbnail: { storeSmall: 'http://robertsspaceindustries.com/x.jpg' } }), null);
    assert.equal(pickImage(undefined), null);
  });
});

describe('toPaintRow / matchShipClass', () => {
  it('builds a row with class mapping', () => {
    const row = toPaintRow({ id: 42, title: 'Gladius - Ghoulish Green Paint', url: '/pledge/skins/x', media: { thumbnails: { store_small: '//media.robertsspaceindustries.com/a.jpg' }, }, publishedAt: '2026-10-01T00:00:00Z' }, known, classes);
    assert.equal(row.rsi_id, '42');
    assert.equal(row.class_name, 'AEGS_Gladius');
    assert.equal(row.name, 'Ghoulish Green');
    assert.equal(row.released_at, '2026-10-01T00:00:00.000Z');
    assert.equal(row.image_url, 'https://media.robertsspaceindustries.com/a.jpg');
  });
  it('drops paints without an image', () => {
    assert.equal(toPaintRow({ id: 1, title: 'Gladius - X Paint', media: {} }, known, classes), null);
  });
  it('matchShipClass: exact, contains, short guard', () => {
    assert.equal(matchShipClass('gladius', classes), 'AEGS_Gladius');
    assert.equal(matchShipClass('roc', new Map([['greycatroc', 'GRIN_ROC']])), null);
    assert.equal(matchShipClass('', classes), null);
  });
});

describe('misc', () => {
  it('cleanPaintName / normalizeName', () => {
    assert.equal(cleanPaintName('Ghoulish Green Paint'), 'Ghoulish Green');
    assert.equal(normalizeName('Idris-M'), 'idrism');
  });
  it('readListing tolerates batch and object envelopes', () => {
    const env = { data: { store: { search: { resources: [{ id: 1 }], totalCount: 7 } } } };
    assert.deepEqual(readListing([env]), { resources: [{ id: 1 }], total: 7 });
    assert.deepEqual(readListing(env), { resources: [{ id: 1 }], total: 7 });
    assert.deepEqual(readListing(null), { resources: [], total: null });
  });
});
