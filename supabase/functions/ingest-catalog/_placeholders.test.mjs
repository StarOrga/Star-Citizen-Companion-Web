// node --test supabase/functions/ingest-catalog/_placeholders.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nullUndefinedPlaceholders } from './_placeholders.ts';

describe('nullUndefinedPlaceholders', () => {
  it('nulls UNDEFINED sub_type / attach_type, any case', () => {
    const r = nullUndefinedPlaceholders({ class_name: 'A', sub_type: 'UNDEFINED', attach_type: 'undefined' });
    assert.deepEqual(r, { class_name: 'A', sub_type: null, attach_type: null });
  });
  it('nulls the placeholder inside payload and keeps the rest', () => {
    const r = nullUndefinedPlaceholders({ sub_type: 'Light', payload: { subType: 'UNDEFINED', attachType: 'Char_Armor_Torso', size: 1 } });
    assert.deepEqual(r, { sub_type: 'Light', payload: { subType: null, attachType: 'Char_Armor_Torso', size: 1 } });
  });
  it('leaves real values, null and non-objects untouched (same reference)', () => {
    const row = { sub_type: 'Gun', attach_type: null, payload: { subType: 'Gun' } };
    assert.equal(nullUndefinedPlaceholders(row), row);
    assert.equal(nullUndefinedPlaceholders(null), null);
    assert.equal(nullUndefinedPlaceholders('UNDEFINED'), 'UNDEFINED');
  });
  it('does not mutate its input', () => {
    const row = { sub_type: 'UNDEFINED' };
    nullUndefinedPlaceholders(row);
    assert.equal(row.sub_type, 'UNDEFINED');
  });
});
