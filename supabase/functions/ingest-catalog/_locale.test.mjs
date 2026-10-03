// node --test supabase/functions/ingest-catalog/_locale.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GROUP_MIN_BYTES,
  SHARD_TARGET_BYTES,
  buildShards,
  fnv1a,
  indexKey,
  isLocaleIndex,
  keyGroup,
  shardFor,
  shardKey,
} from './_locale-shards.ts';
import { publishLocale } from './_locale-publish.ts';

const BUILD = 'a3fb1249-9115-4035-9039-2ffc6043d832';

// The client copy (src/app/codex/codex-locale-shards.ts) asserts the SAME
// vectors in codex-locale-shards.spec.ts. Change both or neither.
const GOLDEN_INDEX = { groups: { ui: 3, item: 26 }, misc: 4 };
const GOLDEN = [
  ['ui_CIEmergencyExitDescription_0', 1092807338, 'ui-2'],
  ['item_NameAEGS_Gladius', 39184882, 'item-22'],
  ['pu_foo', 2054069677, '_misc-1'],
  ['Human_First_Names_M_0602', 325737125, '_misc-1'],
  ['weird-key.x', 134492222, '_misc-2'],
  ['ä_umlaut', 591518336, '_misc-0'],
];

describe('locale shard layout', () => {
  it('matches the golden vectors the client is pinned to', () => {
    for (const [key, hash, shard] of GOLDEN) {
      assert.equal(fnv1a(key), hash, key);
      assert.equal(shardFor(GOLDEN_INDEX, key), shard, key);
    }
  });

  it('groups by the lower-cased first segment, never by an unsafe one', () => {
    assert.equal(keyGroup('UI_Foo'), 'ui');
    assert.equal(keyGroup('nounderscore'), 'nounderscore');
    assert.equal(keyGroup('../x_y'), '');
    assert.equal(keyGroup(''), '');
  });

  it('gives big groups their own shards, sends small ones to _misc, and loses no key', () => {
    const entries = {};
    // ui: ~3.5 targets of data → 4 shards
    const big = Math.ceil((SHARD_TARGET_BYTES * 3.5) / 106);
    for (let i = 0; i < big; i++) entries[`ui_Key_${i}`] = 'x'.repeat(90);
    // tiny group below GROUP_MIN_BYTES
    entries['dlg_hello'] = 'Hello';
    entries['weird-key'] = 'w';
    const { index, shards } = buildShards(BUILD, 'en', 'abc12345', entries);
    assert.equal(index.groups.ui, 4);
    assert.equal(index.groups.dlg, undefined);
    assert.ok(index.misc >= 1);
    assert.equal(index.count, Object.keys(entries).length);
    const merged = Object.assign({}, ...shards.values());
    assert.deepEqual(merged, entries);
    for (const [name, shard] of shards) {
      for (const k of Object.keys(shard)) assert.equal(shardFor(index, k), name);
      assert.ok(JSON.stringify(shard).length < SHARD_TARGET_BYTES * 2, `${name} stays near the target`);
    }
    assert.ok(GROUP_MIN_BYTES < SHARD_TARGET_BYTES);
    assert.ok(isLocaleIndex(index, BUILD, 'en'));
    assert.ok(!isLocaleIndex(index, BUILD, 'de'));
  });

  it('builds the keys the Worker serves', () => {
    assert.equal(indexKey(BUILD, 'pt-BR'), `codex-locale/${BUILD}/pt-BR/index.json`);
    assert.equal(shardKey(BUILD, 'en', 'mgaq1z2k', 'ui-0'), `codex-locale/${BUILD}/en/mgaq1z2k/ui-0.json`);
  });
});

function fakeDeps({ rows, serve = true, stale = [] }) {
  const bucket = new Map(stale.map((k) => [k, '{}']));
  const log = [];
  let left = Object.keys(rows).length;
  return {
    bucket,
    log,
    deps: {
      async exportLang() {
        log.push('export');
        return { ...rows };
      },
      async putJson(key, body) {
        log.push(`put ${key.endsWith('index.json') ? 'index' : 'shard'}`);
        bucket.set(key, body);
      },
      async readPublic(key) {
        log.push('read');
        return serve && bucket.has(key) ? JSON.parse(bucket.get(key)) : null;
      },
      async listKeys(prefix) {
        return [...bucket.keys()].filter((k) => k.startsWith(prefix));
      },
      async deleteKey(key) {
        log.push('delete-object');
        bucket.delete(key);
      },
      async deleteRows() {
        log.push('delete-rows');
        const n = left;
        left = 0;
        return n;
      },
      now: () => 1_759_500_000_000,
    },
  };
}

describe('publishLocale', () => {
  const rows = { ui_a: 'A', ui_b: 'B', item_Name_x: 'X', 'odd.key': 'O' };

  it('writes every shard before the index, verifies through the public path, then deletes the rows', async () => {
    const { deps, bucket, log } = fakeDeps({ rows });
    const res = await publishLocale(deps, BUILD, 'en', { deleteSource: true });
    assert.equal(res.count, 4);
    assert.equal(res.verified, true);
    assert.equal(res.deleted, 4);
    assert.equal(log.indexOf('put index'), log.lastIndexOf('put index'));
    assert.ok(log.lastIndexOf('put shard') < log.indexOf('put index'));
    assert.ok(log.indexOf('read') > log.indexOf('put index'));
    assert.equal(log.at(-1), 'delete-rows');
    const index = JSON.parse(bucket.get(indexKey(BUILD, 'en')));
    assert.equal(index.gen, (1_759_500_000_000).toString(36));
    const all = {};
    for (const [k, v] of bucket) if (!k.endsWith('index.json')) Object.assign(all, JSON.parse(v));
    assert.deepEqual(all, rows);
  });

  it('keeps the rows when the public Worker does not serve the new index', async () => {
    const { deps, log } = fakeDeps({ rows, serve: false });
    const res = await publishLocale(deps, BUILD, 'en', { deleteSource: true });
    assert.equal(res.verified, false);
    assert.equal(res.deleted, 0);
    assert.ok(!log.includes('delete-rows'));
  });

  it('never deletes rows without deleteSource', async () => {
    const { deps, log } = fakeDeps({ rows });
    const res = await publishLocale(deps, BUILD, 'en', { deleteSource: false });
    assert.equal(res.verified, true);
    assert.equal(res.deleted, 0);
    assert.ok(!log.includes('delete-rows'));
  });

  it('removes older generations of the same language only', async () => {
    const old = `codex-locale/${BUILD}/en/oldgen01/ui-0.json`;
    const otherLang = `codex-locale/${BUILD}/de/oldgen01/ui-0.json`;
    const { deps, bucket } = fakeDeps({ rows, stale: [old, otherLang] });
    const res = await publishLocale(deps, BUILD, 'en', { deleteSource: false });
    assert.equal(res.removed_objects, 1);
    assert.ok(!bucket.has(old));
    assert.ok(bucket.has(otherLang));
    assert.ok(bucket.has(indexKey(BUILD, 'en')));
  });

  it('does nothing for a language without rows', async () => {
    const { deps, log } = fakeDeps({ rows: {} });
    const res = await publishLocale(deps, BUILD, 'en', { deleteSource: true });
    assert.deepEqual(log, ['export']);
    assert.equal(res.count, 0);
    assert.equal(res.gen, null);
  });

  it('stops before the index when a shard write fails', async () => {
    const { deps, bucket } = fakeDeps({ rows });
    deps.putJson = async (key) => {
      if (!key.endsWith('index.json')) throw new Error('R2 put failed');
      bucket.set(key, '{}');
    };
    await assert.rejects(publishLocale(deps, BUILD, 'en', { deleteSource: true }), /R2 put failed/);
    assert.ok(!bucket.has(indexKey(BUILD, 'en')));
  });
});
