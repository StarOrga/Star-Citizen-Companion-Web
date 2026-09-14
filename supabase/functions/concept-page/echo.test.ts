// Tests for echo.ts. Pure logic, no Deno APIs, so it runs under both
// `deno test` (Edge parity) and Node 24's built-in test runner + type
// stripping:
//   node --test supabase/functions/concept-page/echo.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEchoBody, conceptAction, decisionLines, isReplayOf, noteLines, ECHO_MAX_CHARS } from './echo.ts';

const ID = '2e0b5a3c-9b1f-4c6e-8d1a-0f7e6c5b4a39';

const submission = {
  submitted: true,
  template: 'decision',
  action: 'implement',
  decisions: [
    { id: 'layout', label: 'Layout der Waffenliste' },
    { id: 'sort', label: 'Sortierung' },
    { id: 'untouched', label: 'Offen gelassen' },
  ],
  comments: [
    { id: 'layout-comment', text: '  nur für Jäger,\n bitte kompakt ' },
    { id: 'general', text: '' },
  ],
  allFields: {
    'dec-layout': 'B (zwei Spalten)',
    'dec-sort': 'nach DPS',
    'layout-comment': '  nur für Jäger,\n bitte kompakt ',
  },
};

test('action falls back to iterate for anything that is not implement/finalize', () => {
  assert.equal(conceptAction('implement'), 'implement');
  assert.equal(conceptAction('finalize'), 'finalize');
  assert.equal(conceptAction('iterate'), 'iterate');
  assert.equal(conceptAction(undefined), 'iterate');
  assert.equal(conceptAction('ship'), 'iterate');
});

test('decisions join each block with its dec-<id> radio value', () => {
  assert.deepEqual(decisionLines(submission), [
    { label: 'Layout der Waffenliste', value: 'B (zwei Spalten)' },
    { label: 'Sortierung', value: 'nach DPS' },
    { label: 'Offen gelassen', value: null },
  ]);
});

test('notes drop empty texts and collapse whitespace', () => {
  assert.deepEqual(noteLines(submission), [{ id: 'layout-comment', text: 'nur für Jäger, bitte kompakt' }]);
});

test('design-template comments are flattened too', () => {
  const notes = noteLines({
    comments: { general: 'gesamt ok', designs: { hero: 'zu dunkel' }, screens: { s1: '' } },
  });
  assert.deepEqual(notes, [
    { id: 'general', text: 'gesamt ok' },
    { id: 'hero', text: 'zu dunkel' },
  ]);
});

test('the body names title, action, counts, bullets and the read-back command', () => {
  const body = buildEchoBody(ID, 'Layout Bewaffnung — Erstiteration', submission);
  assert.equal(
    body,
    [
      '**Konzept abgeschickt:** „Layout Bewaffnung — Erstiteration" — Mit Feedback implementieren (2 Entscheidungen, 1 Notiz).',
      '',
      'Entscheidungen:',
      '- Layout der Waffenliste → B (zwei Spalten)',
      '- Sortierung → nach DPS',
      '',
      'Notizen:',
      '- layout-comment: nur für Jäger, bitte kompakt',
      '',
      `Vollständig lesbar mit \`concept-read --id ${ID}\`.`,
    ].join('\n'),
  );
});

test('a bare submit still produces a readable line', () => {
  const body = buildEchoBody(ID, 'Leer', { submitted: true });
  assert.match(body, /^\*\*Konzept abgeschickt:\*\* „Leer" — Zur nächsten Iteration \(0 Entscheidungen, 0 Notizen\)\./);
  assert.match(body, /concept-read --id/);
});

test('more than eight decisions are folded, long notes are cut, the body stays under the cap', () => {
  const decisions = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, label: `Frage ${i}` }));
  const allFields: Record<string, string> = {};
  for (const d of decisions) allFields[`dec-${d.id}`] = 'x'.repeat(100);
  const comments = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, text: 'y'.repeat(600) }));
  const body = buildEchoBody(ID, 'Groß', { submitted: true, decisions, comments, allFields });
  assert.ok(body.length <= ECHO_MAX_CHARS, `body is ${body.length} chars`);
  assert.match(body, /- … und 4 weitere/);
  assert.ok(body.endsWith(`Vollständig lesbar mit \`concept-read --id ${ID}\`.`));
  assert.ok(!body.includes('y'.repeat(201)), 'a note is cut at ~200 chars');
});

test('replay detection: same submission_id on an already-submitted row', () => {
  const stored = { decisions: { submitted: true, submission_id: 'abc', action: 'finalize' }, submitted_at: '2026-09-14T10:00:00Z' };
  assert.equal(isReplayOf(stored, { submitted: true, submission_id: 'abc', action: 'finalize' }), true);
  assert.equal(isReplayOf(stored, { submitted: true, submission_id: 'def', action: 'finalize' }), false);
  assert.equal(isReplayOf({ ...stored, submitted_at: null }, { submitted: true, submission_id: 'abc' }), false);
});

test('replay detection without submission_id compares the whole payload, key order aside', () => {
  const stored = { decisions: { submitted: true, action: 'iterate', comments: [], decisions: [{ label: 'A', id: 'a' }] }, submitted_at: '2026-09-14T10:00:00Z' };
  assert.equal(isReplayOf(stored, { decisions: [{ id: 'a', label: 'A' }], comments: [], action: 'iterate', submitted: true }), true);
  assert.equal(isReplayOf(stored, { decisions: [{ id: 'a', label: 'A' }], comments: [{ id: 'x', text: 'neu' }], action: 'iterate', submitted: true }), false);
  // A draft row (never submitted) is never a replay source.
  assert.equal(isReplayOf({ decisions: { submitted: false }, submitted_at: null }, { submitted: true }), false);
});

test('an identical payload after the routine processed the row is a new answer, not a replay', () => {
  const payload = { submitted: true, action: 'iterate', comments: [], decisions: [{ id: 'a', label: 'A' }] };
  const processed = { decisions: payload, submitted_at: '2026-09-14T10:00:00Z', processed_at: '2026-09-14T10:07:00Z' };
  assert.equal(isReplayOf(processed, payload), false);
  // ...unless it carries the same submission_id — that id is random per submit.
  const fin = { ...payload, submission_id: 'f1' };
  assert.equal(isReplayOf({ ...processed, decisions: fin }, fin), true);
});
