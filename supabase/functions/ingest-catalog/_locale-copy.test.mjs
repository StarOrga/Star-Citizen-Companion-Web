// node --test supabase/functions/ingest-catalog/_locale-copy.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { copyBuildLocales, langsOf } from './_locale-copy.ts';
import { buildShards, indexKey, shardKey } from './_locale-shards.ts';

const FROM = '11111111-1111-4111-8111-111111111111';
const TO = '22222222-2222-4222-8222-222222222222';
const GEN = 'mabc1234';

/** An in-memory R2 bucket seen through the public Worker. */
function bucket() {
  const objects = new Map();
  const puts = [];
  return {
    objects,
    puts,
    deps: {
      listKeys: async (prefix) => [...objects.keys()].filter((k) => k.startsWith(prefix)).sort(),
      readPublic: async (key) => (objects.has(key) ? JSON.parse(objects.get(key)) : null),
      putJson: async (key, body) => {
        puts.push(key);
        objects.set(key, body);
      },
    },
  };
}

function publish(b, buildId, lang, entries) {
  const { index, shards } = buildShards(buildId, lang, GEN, entries);
  for (const [name, shard] of shards) b.objects.set(shardKey(buildId, lang, GEN, name), JSON.stringify(shard));
  b.objects.set(indexKey(buildId, lang), JSON.stringify(index));
  return index;
}

describe('langsOf', () => {
  it('lists the languages with an index, nothing else', () => {
    const keys = [
      `codex-locale/${FROM}/en/index.json`,
      `codex-locale/${FROM}/en/${GEN}/ui-0.json`,
      `codex-locale/${FROM}/de/index.json`,
      `codex-locale/${TO}/fr/index.json`,
    ];
    assert.deepEqual(langsOf(keys, FROM), ['de', 'en']);
  });
});

describe('copyBuildLocales', () => {
  it('copies every shard, then the index re-addressed to the new build', async () => {
    const b = bucket();
    const entries = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`ui_key_${i}`, `Value ${i}`]));
    const src = publish(b, FROM, 'en', entries);
    publish(b, FROM, 'de', { ui_a: 'A' });

    const res = await copyBuildLocales(b.deps, FROM, TO);
    assert.deepEqual(res.map((r) => [r.lang, r.status, r.verified]), [['de', 'copied', true], ['en', 'copied', true]]);

    const idx = JSON.parse(b.objects.get(indexKey(TO, 'en')));
    assert.equal(idx.build_id, TO);
    assert.equal(idx.gen, src.gen);
    assert.equal(idx.count, src.count);
    for (const [k, v] of b.objects) {
      if (!k.startsWith(`codex-locale/${FROM}/en/${GEN}/`)) continue;
      assert.equal(b.objects.get(k.replace(FROM, TO)), v, `shard ${k} copied byte for byte`);
    }
    // The index is the switch: it goes out after every shard of its language.
    const enPuts = b.puts.filter((k) => k.includes(`/${TO}/en/`));
    assert.equal(enPuts.at(-1), indexKey(TO, 'en'));
  });

  it('skips a language the new build already serves (retried finalize)', async () => {
    const b = bucket();
    publish(b, FROM, 'en', { ui_a: 'A' });
    await copyBuildLocales(b.deps, FROM, TO);
    const before = b.puts.length;
    const res = await copyBuildLocales(b.deps, FROM, TO);
    assert.deepEqual(res.map((r) => r.status), ['exists']);
    assert.equal(b.puts.length, before);
  });

  it('never writes an index whose shards could not all be read', async () => {
    const b = bucket();
    publish(b, FROM, 'en', { ui_a: 'A', item_b: 'B' });
    const realRead = b.deps.readPublic;
    b.deps.readPublic = async (key) => (key.includes(`/${GEN}/`) && key.includes(FROM) ? null : realRead(key));
    const res = await copyBuildLocales(b.deps, FROM, TO);
    assert.equal(res[0].status, 'incomplete');
    assert.equal(b.objects.has(indexKey(TO, 'en')), false);
  });

  it('refuses the same or a malformed id', async () => {
    const b = bucket();
    await assert.rejects(() => copyBuildLocales(b.deps, FROM, FROM));
    await assert.rejects(() => copyBuildLocales(b.deps, 'x', TO));
  });
});
