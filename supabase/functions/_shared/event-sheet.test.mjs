// Runs the shared sheet module under plain Node (the Deno functions import the very same file).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSheet, gateSheet, publicSheet, EVENT_SHEET_SCHEMA } from './event-sheet.ts';

test('normalises open ids and drops patch / game package prerequisites', () => {
  const s = normalizeSheet({
    fields: {
      venues: { value: ['Arena Commander', 'Verse'], confidence: 0.9, source: 'ai' },
      prerequisites: { value: { op: 'or', items: [{ gear: 'combat-ship' }, { gear: 'game package' }, { gear: 'fps-combat-set' }] }, confidence: 0.9, source: 'ai' },
    },
  });
  assert.equal(s.schema, EVENT_SHEET_SCHEMA);
  assert.deepEqual(s.fields.venues.value, ['arena-commander', 'verse']);
  assert.equal(s.fields.prerequisites.value.items.length, 2);
});

test('fields below 0.8 are pending and blank in the public sheet', () => {
  const s = gateSheet(normalizeSheet({ fields: { end: { value: '2026-11-20', confidence: 0.5, source: 'ai' } } }));
  assert.equal(s.fields.end.review, 'pending');
  assert.equal(publicSheet(s).fields.end.value, null);
});
