// node --test supabase/functions/ingest-catalog/_locale-body.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keepReadLangs, parseBackfill, parseCommit, parseSign } from './_locale-body.ts';

const BUILD = '0f8e6a3c-1b2d-4c5e-9f00-112233445566';
const sha = (i) => i.toString(16).padStart(64, '0');
const shas = Array.from({ length: 64 }, (_, i) => sha(i));

describe('parseSign', () => {
  it('accepts 64 shards', () => {
    const r = parseSign({ build_id: BUILD, lang: 'de', shards: shas.map((s) => ({ sha256: s, bytes: 10 })) });
    assert.equal(r.ok, true);
    assert.equal(r.value.shards.length, 64);
  });
  it('rejects wrong counts, langs, hashes and sizes', () => {
    const good = shas.map((s) => ({ sha256: s, bytes: 10 }));
    assert.equal(parseSign({ build_id: BUILD, lang: 'de', shards: good.slice(1) }).ok, false);
    assert.equal(parseSign({ build_id: BUILD, lang: 'fr', shards: good }).ok, false);
    assert.equal(parseSign({ build_id: 'x', lang: 'de', shards: good }).ok, false);
    assert.equal(parseSign({ build_id: BUILD, lang: 'de', shards: [{ sha256: 'A'.repeat(64), bytes: 1 }, ...good.slice(1)] }).ok, false);
    assert.equal(parseSign({ build_id: BUILD, lang: 'de', shards: [{ sha256: sha(0), bytes: 0 }, ...good.slice(1)] }).ok, false);
    assert.equal(parseSign({ build_id: BUILD, lang: 'de', shards: [{ sha256: sha(0), bytes: 5e6 }, ...good.slice(1)] }).ok, false);
  });
});

describe('parseCommit', () => {
  it('accepts 64 hashes with counts', () => {
    const r = parseCommit({ build_id: BUILD, lang: 'en', shards: shas, keys: 27000, bytes: 1234567 });
    assert.equal(r.ok, true);
    assert.equal(r.value.lang, 'en');
  });
  it('rejects bad input', () => {
    assert.equal(parseCommit({ build_id: BUILD, lang: 'en', shards: shas, keys: -1, bytes: 1 }).ok, false);
    assert.equal(parseCommit({ build_id: BUILD, lang: 'en', shards: [...shas.slice(1), 'zz'], keys: 1, bytes: 1 }).ok, false);
    assert.equal(parseCommit({ build_id: BUILD, lang: 'en', shards: shas.slice(2), keys: 1, bytes: 1 }).ok, false);
  });
});

describe('parseBackfill / keepReadLangs', () => {
  it('needs a uuid and de|en', () => {
    assert.equal(parseBackfill({ build_id: BUILD, lang: 'de' }).ok, true);
    assert.equal(parseBackfill({ build_id: BUILD, lang: 'es' }).ok, false);
  });
  it('drops languages the app never reads', () => {
    const rows = [{ lang: 'de' }, { lang: 'fr' }, { lang: 'en' }, { lang: 'ja' }, {}];
    assert.deepEqual(keepReadLangs(rows), [{ lang: 'de' }, { lang: 'en' }]);
  });
});
