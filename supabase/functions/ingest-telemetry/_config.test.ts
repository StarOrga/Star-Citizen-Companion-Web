// node --test supabase/functions/ingest-telemetry/_config.test.ts
// (also runs under `deno test` — only node:test + node:assert are imported)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_HASH_SALT, DEV_HMAC_KEY, resolveTelemetrySecrets } from './_config.ts';

const env = (vars: Record<string, string>) => (name: string) => vars[name];

test('both secrets set → ok, not dev', () => {
  const r = resolveTelemetrySecrets(env({ TELEMETRY_HMAC_KEY: 'k', TELEMETRY_HASH_SALT: 's' }));
  assert.deepEqual(r, { ok: true, hmacKey: 'k', hashSalt: 's', dev: false });
});

test('one secret missing → refused, names the missing one', () => {
  const r = resolveTelemetrySecrets(env({ TELEMETRY_HMAC_KEY: 'k' }));
  assert.deepEqual(r, { ok: false, missing: ['TELEMETRY_HASH_SALT'] });
  const r2 = resolveTelemetrySecrets(env({}));
  assert.deepEqual(r2, { ok: false, missing: ['TELEMETRY_HMAC_KEY', 'TELEMETRY_HASH_SALT'] });
});

test('an empty / whitespace value counts as missing', () => {
  const r = resolveTelemetrySecrets(env({ TELEMETRY_HMAC_KEY: '', TELEMETRY_HASH_SALT: '  ' }));
  assert.deepEqual(r, { ok: false, missing: ['TELEMETRY_HMAC_KEY', 'TELEMETRY_HASH_SALT'] });
});

test('TELEMETRY_DEV=1 opts into the dev literals', () => {
  const r = resolveTelemetrySecrets(env({ TELEMETRY_DEV: '1' }));
  assert.deepEqual(r, { ok: true, hmacKey: DEV_HMAC_KEY, hashSalt: DEV_HASH_SALT, dev: true });
});

test('TELEMETRY_DEV=0 does not', () => {
  const r = resolveTelemetrySecrets(env({ TELEMETRY_DEV: '0', TELEMETRY_HMAC_KEY: 'k' }));
  assert.deepEqual(r, { ok: false, missing: ['TELEMETRY_HASH_SALT'] });
});
