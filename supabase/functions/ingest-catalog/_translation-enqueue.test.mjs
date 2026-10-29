// node --test supabase/functions/ingest-catalog/_translation-enqueue.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enqueueTranslationJobs } from './_translation-enqueue.ts';

const B = 'a3fb1249-9115-4035-9039-2ffc6043d832';
const ok = [{ lang: 'en', verified: true }, { lang: 'de', verified: true }, { lang: 'fr', verified: true }];

function fake({ enabled = true, approved = ['de'], prev = 'prev-build' } = {}) {
  const calls = { inserted: [], ticks: 0 };
  return {
    calls,
    db: {
      isEnabled: async () => enabled,
      approvedLangs: async () => approved,
      previousBuildId: async () => prev,
      insertJobs: async (rows) => { calls.inserted.push(...rows); },
    },
    tick: async () => { calls.ticks++; },
  };
}

describe('enqueueTranslationJobs', () => {
  it('opens one estimating job per approved language and ticks once', async () => {
    const f = fake({ approved: ['de', 'fr'] });
    const r = await enqueueTranslationJobs(f.db, B, ok, f.tick);
    assert.equal(r.status, 'enqueued');
    assert.deepEqual(f.calls.inserted.map((j) => j.lang), ['de', 'fr']);
    assert.ok(f.calls.inserted.every((j) => j.status === 'estimating' && j.build_id === B));
    assert.equal(f.calls.ticks, 1);
    assert.ok(f.calls.inserted.every((j) => j.mode === 'delta' && j.base_build_id === 'prev-build'));
  });
  it('still inserts the job without a previous build (orchestrator skips it)', async () => {
    const f = fake({ prev: null });
    await enqueueTranslationJobs(f.db, B, ok, f.tick);
    assert.equal(f.calls.inserted.length, 1);
    assert.equal(f.calls.inserted[0].base_build_id, null);
  });
  it('does nothing while translation is disabled', async () => {
    const f = fake({ enabled: false });
    assert.equal((await enqueueTranslationJobs(f.db, B, ok, f.tick)).status, 'disabled');
    assert.equal(f.calls.inserted.length, 0);
    assert.equal(f.calls.ticks, 0);
  });
  it('does nothing when any language is unverified or English is missing', async () => {
    const f = fake();
    const bad = [{ lang: 'en', verified: true }, { lang: 'de', verified: false }];
    assert.equal((await enqueueTranslationJobs(f.db, B, bad, f.tick)).status, 'unverified');
    assert.equal((await enqueueTranslationJobs(f.db, B, [{ lang: 'de', verified: true }], f.tick)).status, 'unverified');
    assert.equal((await enqueueTranslationJobs(f.db, B, [], f.tick)).status, 'unverified');
    assert.equal(f.calls.inserted.length, 0);
  });
  it('skips approved languages the build did not publish, and en', async () => {
    const f = fake({ approved: ['de', 'ja', 'en'] });
    await enqueueTranslationJobs(f.db, B, ok, f.tick);
    assert.deepEqual(f.calls.inserted.map((j) => j.lang), ['de']);
  });
  it('never throws: db and tick failures are contained', async () => {
    const f = fake();
    f.db.insertJobs = async () => { throw new Error('boom'); };
    assert.equal((await enqueueTranslationJobs(f.db, B, ok, f.tick)).status, 'error');
    const g = fake();
    const r2 = await enqueueTranslationJobs(g.db, B, ok, async () => { throw new Error('down'); });
    assert.equal(r2.status, 'enqueued');
  });
});
