// node --test supabase/functions/handoff-create/_handoff.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, hashCode, validateTargetPath } from './_handoff.ts';
import {
  hashCode as redeemHash,
  type Throttle,
  deviceLabel,
  isRateLimited,
  isThrottled,
  looksLikeCode,
  maskEmail,
  sessionIdOf,
  touch,
} from '../handoff-redeem/_hash.ts';
import { isRevokeUnavailable, revokeResponse } from '../handoff-revoke/_revoke.ts';

test('maskEmail reveals only first letters and the tld', () => {
  assert.equal(maskEmail('jane.doe@gmail.com'), 'j***@g***.com');
  assert.equal(maskEmail('a@b.de'), 'a***@b***.de');
  assert.equal(maskEmail('nonsense'), '***');
});

test('isRateLimited recognises GoTrue quota errors', () => {
  assert.equal(isRateLimited({ status: 429 }), true);
  assert.equal(isRateLimited({ code: 'over_email_send_rate_limit' }), true);
  assert.equal(isRateLimited({ status: 500 }), false);
  assert.equal(isRateLimited(null), false);
});

test('throttle counts every call, peek or redeem, and failures extra', () => {
  const m = new Map<string, Throttle>();
  let t = touch(m, 'ip', 0);
  for (let i = 0; i < 29; i++) t = touch(m, 'ip', 1);
  assert.equal(isThrottled(t), false); // 30 hits
  t = touch(m, 'ip', 2);
  assert.equal(isThrottled(t), true); // 31st
  const m2 = new Map<string, Throttle>();
  const f = touch(m2, 'x', 0);
  f.failures = 10;
  assert.equal(isThrottled(f), true);
  assert.equal(isThrottled(touch(m, 'ip', 11 * 60 * 1000)), false); // window over
});

test('touch prunes expired entries', () => {
  const m = new Map<string, Throttle>();
  touch(m, 'a', 0);
  touch(m, 'b', 0);
  touch(m, 'c', 11 * 60 * 1000);
  assert.deepEqual([...m.keys()], ['c']);
});

test('revokeResponse says revoked:true only when something changed', () => {
  for (const o of ['revoked', 'pending', 'burned']) assert.equal(revokeResponse(o).body.revoked, true);
  assert.equal(revokeResponse('already').body.revoked, false);
  assert.equal(revokeResponse('none').status, 404);
  assert.equal(revokeResponse(null).status, 500);
  assert.equal(revokeResponse(undefined).status, 500);
});

test('isRevokeUnavailable detects the distinct privilege error', () => {
  assert.equal(isRevokeUnavailable({ code: '42501' }), true);
  assert.equal(isRevokeUnavailable({ message: 'revoke_unavailable' }), true);
  assert.equal(isRevokeUnavailable({ message: 'timeout' }), false);
});

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
