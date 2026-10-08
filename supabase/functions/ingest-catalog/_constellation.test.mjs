// node --test supabase/functions/ingest-catalog/_constellation.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { earliestByClass, lockConstellation, patchLineOf, pickNewest, sanitizeCandidates } from './_constellation.ts';

const STARS = [[0.5, 0], [0.9, 0.4], [0.9, 0.5], [0.51, 1], [0.49, 1], [0.1, 0.5], [0.1, 0.4]];
const cand = (class_name, kind = 'ship') => ({ class_name, kind, points: STARS });

describe('patchLineOf', () => {
  it('keeps major.minor only', () => {
    assert.equal(patchLineOf('4.3.1'), '4.3');
    assert.equal(patchLineOf('4.3'), '4.3');
    assert.equal(patchLineOf('4.10.0-live'), '4.10');
  });
  it('rejects labels without a version', () => {
    assert.equal(patchLineOf('4.x'), null);
    assert.equal(patchLineOf(''), null);
    assert.equal(patchLineOf(undefined), null);
  });
});

describe('sanitizeCandidates', () => {
  it('accepts exactly seven in-range points and normalises kind', () => {
    const out = sanitizeCandidates([{ class_name: 'TMBL_Nova', kind: 'ground', points: STARS }, { class_name: 'X', kind: 'boat', points: STARS }]);
    assert.deepEqual(out.map((c) => [c.class_name, c.kind]), [['TMBL_Nova', 'ground'], ['X', 'ship']]);
  });
  it('drops malformed candidates and duplicates', () => {
    const out = sanitizeCandidates([
      { class_name: 'A', points: STARS.slice(0, 6) },
      { class_name: 'B', points: [...STARS.slice(0, 6), [1.2, 0]] },
      { class_name: 'C', points: [...STARS.slice(0, 6), [Number.NaN, 0]] },
      { class_name: '', points: STARS },
      { class_name: 'D', points: STARS },
      { class_name: 'D', kind: 'ground', points: STARS },
      null,
    ]);
    assert.deepEqual(out.map((c) => [c.class_name, c.kind]), [['D', 'ship']]);
    assert.deepEqual(sanitizeCandidates('nope'), []);
  });
});

describe('pickNewest', () => {
  it('prefers a class never seen in another build, ties by class_name', () => {
    const seen = new Map([['AEGS_Gladius', '2026-01-01T00:00:00.000Z']]);
    const pick = pickNewest([cand('AEGS_Gladius'), cand('RSI_Zeus_ES'), cand('RSI_Zeus_CL')], seen);
    assert.equal(pick.class_name, 'RSI_Zeus_CL');
  });
  it('falls back to the latest first appearance when nothing is new', () => {
    const seen = new Map([
      ['AEGS_Gladius', '2025-01-01T00:00:00.000Z'],
      ['TMBL_Nova', '2026-09-01T00:00:00.000Z'],
      ['ANVL_Arrow', '2026-03-01T00:00:00.000Z'],
    ]);
    const pick = pickNewest([cand('AEGS_Gladius'), cand('TMBL_Nova', 'ground'), cand('ANVL_Arrow')], seen);
    assert.deepEqual([pick.class_name, pick.kind], ['TMBL_Nova', 'ground']);
  });
  it('is order independent and empty-safe', () => {
    const seen = new Map();
    const a = pickNewest([cand('B'), cand('A')], seen);
    const b = pickNewest([cand('A'), cand('B')], seen);
    assert.equal(a.class_name, 'A');
    assert.equal(b.class_name, 'A');
    assert.equal(pickNewest([], seen), null);
  });
});

describe('earliestByClass', () => {
  it('keeps the earliest timestamp per class', () => {
    const m = earliestByClass([
      { class_name: 'A', created_at: '2026-05-01T10:00:00+00:00' },
      { class_name: 'A', created_at: '2026-04-01T10:00:00+00:00' },
      { class_name: 'B', created_at: '2026-06-01T10:00:00Z' },
    ]);
    assert.equal(m.get('A'), '2026-04-01T10:00:00.000Z');
    assert.equal(m.get('B'), '2026-06-01T10:00:00.000Z');
  });
});

/** In-memory verse_constellations with the PK on patch_line (ON CONFLICT DO NOTHING). */
function memoryStore() {
  const rows = new Map();
  const calls = { insert: 0, find: 0 };
  return {
    rows,
    calls,
    async find(line) {
      calls.find++;
      return rows.get(line) ?? null;
    },
    async insertIfAbsent(row) {
      calls.insert++;
      if (rows.has(row.patch_line)) return false;
      rows.set(row.patch_line, { ...row });
      return true;
    },
  };
}
const row = (patch_line, class_name, source_build_id, kind = 'ship') =>
  ({ patch_line, class_name, kind, points: STARS, source_build_id });

describe('lockConstellation', () => {
  it('writes the first pick of a patch line', async () => {
    const store = memoryStore();
    const res = await lockConstellation(store, row('4.3', 'RSI_Zeus_CL', 'b1'));
    assert.equal(res.created, true);
    assert.equal(res.row.class_name, 'RSI_Zeus_CL');
    assert.equal(store.rows.get('4.3').source_build_id, 'b1');
  });

  it('keeps the first vehicle when a later build of the same patch picks another', async () => {
    const store = memoryStore();
    await lockConstellation(store, row('4.3', 'RSI_Zeus_CL', 'b1'));
    const res = await lockConstellation(store, row('4.3', 'TMBL_Nova', 'b2', 'ground'));
    assert.equal(res.created, false);
    assert.deepEqual([res.row.class_name, res.row.kind, res.row.source_build_id], ['RSI_Zeus_CL', 'ship', 'b1']);
    assert.deepEqual(
      [store.rows.get('4.3').class_name, store.rows.get('4.3').source_build_id],
      ['RSI_Zeus_CL', 'b1'],
      'stored row untouched',
    );
  });

  it('a different patch line writes its own row', async () => {
    const store = memoryStore();
    await lockConstellation(store, row('4.3', 'RSI_Zeus_CL', 'b1'));
    const res = await lockConstellation(store, row('4.4', 'TMBL_Nova', 'b3', 'ground'));
    assert.equal(res.created, true);
    assert.deepEqual([...store.rows.keys()].sort(), ['4.3', '4.4']);
    assert.equal(store.rows.get('4.3').class_name, 'RSI_Zeus_CL');
    assert.equal(store.rows.get('4.4').class_name, 'TMBL_Nova');
  });

  it('two concurrent uploads of one patch: exactly one wins, both report it', async () => {
    const store = memoryStore();
    const [a, b] = await Promise.all([
      lockConstellation(store, row('4.5', 'AEGS_Gladius', 'b4')),
      lockConstellation(store, row('4.5', 'ANVL_Arrow', 'b5')),
    ]);
    assert.equal([a, b].filter((r) => r.created).length, 1);
    assert.equal(a.row.class_name, b.row.class_name);
    assert.equal(store.rows.size, 1);
  });

  it('only reads back the stored row after a conflict', async () => {
    const store = memoryStore();
    await lockConstellation(store, row('4.3', 'RSI_Zeus_CL', 'b1'));
    assert.equal(store.calls.find, 0);
    await lockConstellation(store, row('4.3', 'X', 'b2'));
    assert.equal(store.calls.find, 1);
  });
});
