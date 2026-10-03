// node --test supabase/functions/ingest-catalog/_locale-shards.test.mjs
// Node 24 strips the TypeScript types of the imported .ts module on its own.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  SHARD_COUNT,
  bundleOf,
  buildShards,
  fnv1a,
  shardObjectKey,
  shardOf,
} from './_locale-shards.ts';

describe('fnv1a', () => {
  it('matches the published FNV-1a 32-bit vectors', () => {
    assert.equal(fnv1a(''), 2166136261);
    assert.equal(fnv1a('a'), 3826002220);
    assert.equal(fnv1a('foobar'), 0xbf9cf968);
  });

  it('hashes UTF-8 bytes, not UTF-16 code units', () => {
    // 'ä' is C3 A4 in UTF-8: two FNV rounds.
    let h = 2166136261;
    for (const b of [0xc3, 0xa4]) h = Math.imul(h ^ b, 16777619);
    assert.equal(fnv1a('ä'), h >>> 0);
  });

  it('shardOf stays in range', () => {
    for (const k of ['', 'a', 'item_NameRSI_Aurora', 'Ü@x']) {
      const s = shardOf(k);
      assert.ok(Number.isInteger(s) && s >= 0 && s < SHARD_COUNT);
    }
    assert.equal(shardOf('a'), 3826002220 % 64);
  });
});

describe('buildShards', () => {
  const strings = { item_Name_A: 'Alpha', item_Name_B: 'Beta „ü“', ui_x: '' };
  for (let i = 0; i < 300; i++) strings[`key_${i}`] = `value ${i}`;

  it('round-trips every key through its shard', async () => {
    const shards = await buildShards('de', strings);
    assert.equal(shards.length, SHARD_COUNT);
    const back = {};
    for (const s of shards) {
      const doc = JSON.parse(new TextDecoder().decode(s.body));
      assert.deepEqual(Object.keys(doc), ['v', 'lang', 'shard', 'strings']);
      assert.equal(doc.v, 1);
      assert.equal(doc.lang, 'de');
      assert.equal(doc.shard, s.shard);
      for (const [k, v] of Object.entries(doc.strings)) {
        assert.equal(shardOf(k), s.shard);
        back[k] = v;
      }
      assert.equal(s.sha256, createHash('sha256').update(s.body).digest('hex'));
      assert.equal(s.bytes, s.body.length);
    }
    assert.deepEqual(back, strings);
  });

  it('is deterministic regardless of input order and fills empty shards', async () => {
    const a = await buildShards('en', strings);
    const b = await buildShards('en', new Map(Object.entries(strings).reverse()));
    assert.deepEqual(a.map((s) => s.sha256), b.map((s) => s.sha256));
    const empty = await buildShards('en', {});
    assert.equal(empty.length, SHARD_COUNT);
    assert.equal(
      new TextDecoder().decode(empty[7].body),
      '{"v":1,"lang":"en","shard":7,"strings":{}}',
    );
  });

  it('bundleOf sums keys and bytes in shard order', async () => {
    const shards = await buildShards('de', strings);
    const bundle = bundleOf(shards);
    assert.equal(bundle.v, 1);
    assert.equal(bundle.shards.length, 64);
    assert.equal(bundle.keys, Object.keys(strings).length);
    assert.equal(bundle.bytes, shards.reduce((n, s) => n + s.body.length, 0));
    assert.equal(shardObjectKey(bundle.shards[0]), `codex-locale/${bundle.shards[0]}.json`);
  });
});
