// node --test supabase/functions/ingest-catalog/_carry.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCarryUnavailable, isRpcMissing, MAX_CARRY_ROWS, parseCarry, parsePrune } from './_carry.ts';

const H = 'a'.repeat(64);

describe('parseCarry', () => {
  it('accepts catalog rows keyed by class_name and keeps only the table stamp path', () => {
    const r = parseCarry({
      table: 'codex_items',
      rows: [{ k: ['ITEM_A'], h: H, extra: 1 }],
      set: { 'payload.source': { build: '2' }, 'payload.name': 'x' },
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, { table: 'codex_items', rows: [{ k: ['ITEM_A'], h: H }], set: { 'payload.source': { build: '2' } } });
  });
  it('a stamp absent from set stays absent (the copy drops it)', () => {
    const r = parseCarry({ table: 'codex_ships', rows: [{ k: ['S'], h: H }] });
    assert.deepEqual(r.value.set, {});
  });
  it('a null stamp is kept as null', () => {
    const r = parseCarry({ table: 'codex_silhouettes', rows: [{ k: ['ship', 'S'], h: H }], set: { 'meta.source': null } });
    assert.deepEqual(r.value.set, { 'meta.source': null });
  });
  it('entity strings take a 3-part key and no stamp', () => {
    const r = parseCarry({ table: 'codex_entity_strings', rows: [{ k: ['A', 'en', 'name'], h: H }], set: { 'payload.source': 1 } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.value.set, {});
    assert.equal(parseCarry({ table: 'codex_entity_strings', rows: [{ k: ['A'], h: H }] }).ok, false);
  });
  it('rejects unknown tables, bad hashes, empty and oversized batches', () => {
    assert.equal(parseCarry({ table: 'codex_keybinds', rows: [{ k: ['A'], h: H }] }).ok, false);
    assert.equal(parseCarry({ table: 'codex_items', rows: [{ k: ['A'], h: 'abc' }] }).ok, false);
    assert.equal(parseCarry({ table: 'codex_items', rows: [{ k: [''], h: H }] }).ok, false);
    assert.equal(parseCarry({ table: 'codex_items', rows: [] }).ok, false);
    const many = Array.from({ length: MAX_CARRY_ROWS + 1 }, (_, i) => ({ k: [`A${i}`], h: H }));
    assert.equal(parseCarry({ table: 'codex_items', rows: many }).ok, false);
    assert.equal(parseCarry({ table: 'codex_items', rows: [{ k: ['A'], h: H }], set: [] }).ok, false);
  });
});

describe('parsePrune', () => {
  it('accepts the silhouette key list', () => {
    const r = parsePrune({ table: 'codex_silhouettes', keys: [['ship', 'S'], ['weapon', 'W']] });
    assert.equal(r.ok, true);
  });
  it('never accepts an empty list (it would wipe the build) or another table', () => {
    assert.equal(parsePrune({ table: 'codex_silhouettes', keys: [] }).ok, false);
    assert.equal(parsePrune({ table: 'codex_items', keys: [['A']] }).ok, false);
    assert.equal(parsePrune({ table: 'codex_silhouettes', keys: [['ship']] }).ok, false);
  });
});

describe('isCarryUnavailable', () => {
  it('recognises a missing RPC or content_sha column', () => {
    assert.equal(isCarryUnavailable({ code: 'PGRST202', message: 'Could not find the function public.codex_carry_over' }), true);
    assert.equal(isCarryUnavailable({ code: '42703', message: 'column s.content_sha does not exist' }), true);
  });
  it('keeps real failures real', () => {
    assert.equal(isCarryUnavailable({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
    assert.equal(isCarryUnavailable({ code: '22023', message: 'codex_carry_over: unknown build x' }), false);
    assert.equal(isCarryUnavailable(null), false);
  });
});

describe('isRpcMissing', () => {
  it('names the missing function only', () => {
    assert.equal(isRpcMissing({ code: 'PGRST202', message: 'Could not find the function public.codex_upsert_rows(p_rows, p_table)' }, 'codex_upsert_rows'), true);
    assert.equal(isRpcMissing({ code: 'PGRST202', message: 'Could not find the function public.other' }, 'codex_upsert_rows'), false);
    assert.equal(isRpcMissing({ code: '23505', message: 'codex_upsert_rows duplicate key' }, 'codex_upsert_rows'), false);
  });
});
