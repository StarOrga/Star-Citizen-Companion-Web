// node --test supabase/functions/handoff-create/_handoff.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, hashCode, validateTargetPath } from './_handoff.ts';
import { hashCode as redeemHash, deviceLabel, looksLikeCode, sessionIdOf } from '../handoff-redeem/_hash.ts';

test('code is 43 base64url chars (256 bit) and unique', () => {
  const a = generateCode();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, generateCode());
  assert.ok(looksLikeCode(a));
});

test('create and redeem hash identically, hex sha256', async () => {
  const c = generateCode();
  const h = await hashCode(c);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await redeemHash(c));
  assert.notEqual(h, c);
});

test('looksLikeCode rejects wrong shapes', () => {
  for (const bad of ['', 'abc', 'x'.repeat(42), 'x'.repeat(44), 'a'.repeat(42) + '!', null, 5]) {
    assert.equal(looksLikeCode(bad), false);
  }
});

test('validateTargetPath accepts same-origin relative paths', () => {
  assert.equal(validateTargetPath('/codex/ship/aegs_gladius?tab=a#x'), '/codex/ship/aegs_gladius?tab=a#x');
  assert.equal(validateTargetPath('/'), '/');
});

test('validateTargetPath rejects open-redirect and abuse vectors', () => {
  const bad = [
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    'codex',
    '',
    '/a b',
    '/a\nb',
    '/handoff?c=x',
    '/login',
    '/' + 'a'.repeat(512),
    null,
    undefined,
    42,
  ];
  for (const b of bad) assert.equal(validateTargetPath(b), null, String(b));
});

test('deviceLabel is coarse', () => {
  assert.equal(
    deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'),
    'Android - Chrome',
  );
  assert.equal(deviceLabel(null), 'Device - Browser');
});

test('sessionIdOf reads the claim and tolerates garbage', () => {
  const payload = Buffer.from(JSON.stringify({ session_id: 'abc' })).toString('base64url');
  assert.equal(sessionIdOf(`h.${payload}.s`), 'abc');
  assert.equal(sessionIdOf('nope'), null);
});
