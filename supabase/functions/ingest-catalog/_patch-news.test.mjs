// node --test supabase/functions/ingest-catalog/_patch-news.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recordPatchNews } from './_patch-news.ts';

const B = '00000000-0000-0000-0000-000000000001';

describe('recordPatchNews', () => {
  it('calls the record RPC with the build id', async () => {
    const calls = [];
    const r = await recordPatchNews(async (fn, args) => {
      calls.push([fn, args]);
      return { data: { ok: true }, error: null };
    }, B);
    assert.deepEqual(calls, [['codex_record_patch_news', { p_build_id: B }]]);
    assert.deepEqual(r, { status: 'recorded', detail: { ok: true } });
  });

  it('degrades when the migration is not applied', async () => {
    const r = await recordPatchNews(async () => ({ data: null, error: { code: 'PGRST202', message: 'x' } }), B);
    assert.deepEqual(r, { status: 'degraded', reason: 'no_patch_news' });
  });

  it('reports other errors and throws without raising', async () => {
    const a = await recordPatchNews(async () => ({ data: null, error: { message: 'boom' } }), B);
    assert.deepEqual(a, { status: 'failed', message: 'boom' });
    const b = await recordPatchNews(async () => { throw new Error('net'); }, B);
    assert.deepEqual(b, { status: 'failed', message: 'net' });
  });
});
