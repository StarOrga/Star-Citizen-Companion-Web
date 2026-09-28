// node --test supabase/functions/ingest-telemetry/_detail.test.ts
// (also runs under `deno test` — only node:test + node:assert are imported)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DETAIL_BYTES, capDetail } from './_detail.ts';

/** A `{"s":"…"}` object whose JSON is exactly `bytes` bytes long (ASCII). */
const objectOfSize = (bytes: number) => ({ s: 'x'.repeat(bytes - '{"s":""}'.length) });

test('null and undefined → null', () => {
  assert.equal(capDetail(null), null);
  assert.equal(capDetail(undefined), null);
});

test('small object is returned unchanged (same reference)', () => {
  const v = { step: 'scan', ms: 1200, ok: true };
  assert.equal(capDetail(v), v);
});

test('exactly MAX_DETAIL_BYTES stays unchanged', () => {
  const v = objectOfSize(MAX_DETAIL_BYTES);
  assert.equal(JSON.stringify(v).length, 4096);
  assert.equal(capDetail(v), v);
});

test('one byte over → truncation marker with the real size', () => {
  const v = objectOfSize(MAX_DETAIL_BYTES + 1);
  assert.deepEqual(capDetail(v), { _truncated: true, bytes: 4097 });
});

test('a cycle → dropped as unserializable', () => {
  const v: Record<string, unknown> = { a: 1 };
  v['self'] = v;
  assert.deepEqual(capDetail(v), { _dropped: 'unserializable' });
});

test('a BigInt or a bare function → dropped as unserializable', () => {
  assert.deepEqual(capDetail({ n: 1n }), { _dropped: 'unserializable' });
  assert.deepEqual(capDetail(() => 1), { _dropped: 'unserializable' });
});

test('multi-byte characters count as bytes, not code units', () => {
  // "ä" is 2 bytes in UTF-8: 2000 of them + 8 wrapper bytes = 4008 bytes → fits;
  // 2045 of them = 4098 bytes → over the limit although only 2053 chars long.
  assert.deepEqual(capDetail({ s: 'ä'.repeat(2000) }), { s: 'ä'.repeat(2000) });
  const big = { s: 'ä'.repeat(2045) };
  assert.equal(JSON.stringify(big).length, 2053);
  assert.deepEqual(capDetail(big), { _truncated: true, bytes: 4098 });
});

test('custom max is honoured', () => {
  assert.deepEqual(capDetail({ a: 'xyz' }, 5), { _truncated: true, bytes: 11 });
});
