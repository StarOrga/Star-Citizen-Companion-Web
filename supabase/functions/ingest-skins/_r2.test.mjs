// node --test supabase/functions/ingest-skins/_r2.test.mjs
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { register } from 'node:module';

// _r2.ts imports aws4fetch from esm.sh (Deno); stub that one specifier for Node.
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, n) {
      if (s.startsWith('https://esm.sh/aws4fetch')) return { url: 'data:text/javascript,export class AwsClient {}', shortCircuit: true };
      return n(s, c);
    }`),
);
const { BUCKET_BYTES_TTL_MS, bucketBytes, listObjects, resetBucketBytesCache } = await import('./_r2.ts');

const xml = (size) =>
  `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>a</Key><Size>${size}</Size></Contents></ListBucketResult>`;
const make = (responses) => {
  const calls = { n: 0 };
  return {
    calls,
    cfg: {
      accountId: 'acc',
      bucket: 'b',
      quotaBytes: 1,
      analyticsToken: '',
      client: {
        fetch: async () => {
          const r = responses[Math.min(calls.n++, responses.length - 1)];
          if (r instanceof Error) throw r;
          return r.clone();
        },
      },
    },
  };
};
const ok = (size) => new Response(xml(size), { status: 200 });

describe('listObjects retry', () => {
  beforeEach(() => resetBucketBytesCache());
  it('retries a 503 once', async () => {
    const { cfg, calls } = make([new Response('', { status: 503 }), ok(5)]);
    assert.equal((await listObjects(cfg, 'p')).length, 1);
    assert.equal(calls.n, 2);
  });
  it('retries a network error once, then gives up', async () => {
    const { cfg, calls } = make([new Error('reset')]);
    await assert.rejects(() => listObjects(cfg, 'p'), /reset/);
    assert.equal(calls.n, 2);
  });
  it('does not retry a 403', async () => {
    const { cfg, calls } = make([new Response('', { status: 403 })]);
    await assert.rejects(() => listObjects(cfg, 'p'), /HTTP 403/);
    assert.equal(calls.n, 1);
  });
});

describe('bucketBytes cache', () => {
  beforeEach(() => resetBucketBytesCache());
  it('lists the bucket once inside the TTL', async () => {
    const { cfg, calls } = make([ok(7)]);
    assert.equal(await bucketBytes(cfg, 1000), 7);
    assert.equal(await bucketBytes(cfg, 1000 + BUCKET_BYTES_TTL_MS - 1), 7);
    assert.equal(calls.n, 1);
    await bucketBytes(cfg, 1000 + BUCKET_BYTES_TTL_MS + 1);
    assert.equal(calls.n, 2);
  });
  it('lists afresh inside the TTL once the reading is at or above cacheBelow (near the quota)', async () => {
    const { cfg, calls } = make([ok(7), ok(7)]);
    assert.equal(await bucketBytes(cfg, 1000, 7), 7);
    assert.equal(await bucketBytes(cfg, 1001, 7), 7);
    assert.equal(calls.n, 2);
  });
});
