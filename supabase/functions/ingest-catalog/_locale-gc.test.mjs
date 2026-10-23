// node --test supabase/functions/ingest-catalog/_locale-gc.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gcLocalePrefixes, selectOrphanLocaleKeys } from './_locale-gc.ts';

const LIVE = 'a3fb1249-9115-4035-9039-2ffc6043d832';
const GONE = '11111111-2222-4333-8444-555555555555';
const k = (id, rest = 'en/index.json') => `codex-locale/${id}/${rest}`;

describe('selectOrphanLocaleKeys', () => {
  it('selects only prefixes whose build is gone', () => {
    const keys = [k(LIVE), k(LIVE, 'de/g1/ui-0.json'), k(GONE), k(GONE, 'en/g1/item-0.json')];
    const sel = selectOrphanLocaleKeys(keys, [LIVE]);
    assert.deepEqual([...sel.orphans.keys()], [GONE]);
    assert.equal(sel.orphans.get(GONE).length, 2);
    assert.deepEqual(sel.kept, [LIVE]);
  });

  it('never selects a live build, whatever the case', () => {
    const sel = selectOrphanLocaleKeys([k(LIVE.toUpperCase()), k(LIVE)], [LIVE]);
    assert.equal(sel.orphans.size, 0);
  });

  it('selects nothing when the live list is empty', () => {
    const sel = selectOrphanLocaleKeys([k(GONE), k(LIVE)], []);
    assert.equal(sel.orphans.size, 0);
    assert.equal(sel.ignored, 2);
  });

  it('ignores keys that are not codex-locale/<uuid>/<object>', () => {
    const keys = [
      'ship-skins/_hulls/x.glb',
      'codex-locale/not-a-uuid/en/index.json',
      `codex-locale/${GONE}`,
      `codex-locale/${GONE}/`,
      `codex-locale-extra/${GONE}/en/index.json`,
      `xcodex-locale/${GONE}/en/index.json`,
    ];
    const sel = selectOrphanLocaleKeys(keys, [LIVE]);
    assert.equal(sel.orphans.size, 0);
    assert.equal(sel.ignored, keys.length);
  });
});

describe('gcLocalePrefixes', () => {
  const mk = (live, keys) => {
    const deleted = [];
    return {
      deleted,
      deps: {
        liveBuildIds: async () => live,
        listKeys: async () => keys,
        deleteKey: async (key) => void deleted.push(key),
      },
    };
  };

  it('dry run reports but deletes nothing', async () => {
    const { deps, deleted } = mk([LIVE], [k(LIVE), k(GONE), k(GONE, 'de/index.json')]);
    const r = await gcLocalePrefixes(deps, { dryRun: true });
    assert.equal(deleted.length, 0);
    assert.equal(r.dry_run, true);
    assert.deepEqual(r.orphan_builds, [{ build_id: GONE, objects: 2 }]);
    assert.equal(r.objects_deleted, 0);
  });

  it('apply deletes exactly the orphan keys', async () => {
    const { deps, deleted } = mk([LIVE], [k(LIVE), k(GONE), k(GONE, 'de/index.json')]);
    const r = await gcLocalePrefixes(deps, { dryRun: false });
    assert.deepEqual(deleted.sort(), [k(GONE), k(GONE, 'de/index.json')].sort());
    assert.equal(r.objects_deleted, 2);
  });

  it('a failed live-id read aborts before anything is listed or deleted', async () => {
    const deleted = [];
    const deps = {
      liveBuildIds: async () => { throw new Error('db down'); },
      listKeys: async () => { throw new Error('must not list'); },
      deleteKey: async (key) => void deleted.push(key),
    };
    await assert.rejects(gcLocalePrefixes(deps, { dryRun: false }), /db down/);
    assert.equal(deleted.length, 0);
  });
});
