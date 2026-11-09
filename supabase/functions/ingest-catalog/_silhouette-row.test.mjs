// node --test supabase/functions/ingest-catalog/_silhouette-row.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeSilhouetteRow } from './_silhouette-row.ts';

const base = { build_id: 'b', kind: 'item', class_name: 'X', view_box: '0 0 1000 1000', path: 'M0 0L1 1Z', bbox: {} };

describe('sanitizeSilhouetteRow', () => {
  it('keeps edges when present', () => {
    const out = sanitizeSilhouetteRow({ ...base, edges: 'M5 5L9 9', junk: 1 });
    assert.equal(out.edges, 'M5 5L9 9');
    assert.equal('junk' in out, false);
  });
  it('ingests rows without edges unchanged', () => {
    const out = sanitizeSilhouetteRow(base);
    assert.equal('edges' in out, false);
    assert.equal(out.path, 'M0 0L1 1Z');
  });
});
