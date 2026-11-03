// node --test supabase/functions/ingest-catalog/_silhouette-skips.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_SKIPS, parseSkips } from './_silhouette-skips.ts';

const B = '00000000-0000-0000-0000-000000000001';

describe('parseSkips', () => {
  it('maps the uploader entries to rows of the build', () => {
    const rows = parseSkips([
      { kind: 'ship', className: 'RSI_Polaris', reason: 'convert_failed', detail: ' RuntimeError: no glb ' },
      { kind: 'ship', className: 'MISC_Hull_B', reason: 'no_mesh' },
    ], B);
    assert.deepEqual(rows, [
      { build_id: B, kind: 'ship', class_name: 'RSI_Polaris', reason: 'convert_failed', detail: 'RuntimeError: no glb' },
      { build_id: B, kind: 'ship', class_name: 'MISC_Hull_B', reason: 'no_mesh', detail: null },
    ]);
  });

  it('drops unknown reasons, kinds and junk class names', () => {
    const rows = parseSkips([
      { kind: 'ship', className: 'A', reason: 'other' },
      { kind: 'planet', className: 'A', reason: 'empty' },
      { kind: 'ship', className: "x'; drop", reason: 'empty' },
      null, 'x', [],
    ], B);
    assert.deepEqual(rows, []);
  });

  it('keeps the last entry per kind + class and caps the detail', () => {
    const rows = parseSkips([
      { kind: 'ship', className: 'A', reason: 'empty' },
      { kind: 'ship', className: 'A', reason: 'no_mesh', detail: 'x'.repeat(500) },
    ], B);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reason, 'no_mesh');
    assert.equal(rows[0].detail.length, 300);
  });

  it('refuses a non-list and an oversized list', () => {
    assert.equal(parseSkips({}, B), null);
    assert.equal(parseSkips(new Array(MAX_SKIPS + 1).fill({}), B), null);
    assert.deepEqual(parseSkips([], B), []);
  });
});
