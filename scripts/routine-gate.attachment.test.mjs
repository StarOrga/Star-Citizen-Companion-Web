// node --test scripts/routine-gate.attachment.test.mjs
// Which inputs the routine's `attachment` command accepts as a feedback-images
// object path (private bucket, AUD-115) — and which it refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackObjectPath } from './routine-gate.mjs';

const BASE = 'https://hcnqhvzlavdycidqyaai.supabase.co/storage/v1/object/public/feedback-images';
const UID = '0b5c2f7e-1d2a-4c3b-9e8f-123456789abc';

test('accepts the public object URL a body stores', () => {
  assert.equal(feedbackObjectPath(`${BASE}/${UID}/shot.jpg`), `${UID}/shot.jpg`);
});

test('accepts a bare <uid>/<file> path', () => {
  assert.equal(feedbackObjectPath(`${UID}/crash.log`), `${UID}/crash.log`);
});

test('drops a query string', () => {
  assert.equal(feedbackObjectPath(`${BASE}/${UID}/shot.jpg?download=1`), `${UID}/shot.jpg`);
  assert.equal(feedbackObjectPath(`${UID}/shot.jpg?x=1`), `${UID}/shot.jpg`);
});

test('refuses traversal', () => {
  assert.equal(feedbackObjectPath(`${UID}/../other/secret.jpg`), null);
  assert.equal(feedbackObjectPath(`${BASE}/${UID}/%2E%2E/x.jpg`), null);
  assert.equal(feedbackObjectPath('../x.jpg'), null);
});

test('refuses another bucket, a leading slash and empty input', () => {
  assert.equal(feedbackObjectPath('https://x.supabase.co/storage/v1/object/public/ship-skins/a/b.glb'), null);
  assert.equal(feedbackObjectPath(`/${UID}/shot.jpg`), null);
  assert.equal(feedbackObjectPath(''), null);
  assert.equal(feedbackObjectPath(undefined), null);
  assert.equal(feedbackObjectPath('shot.jpg'), null);
});
