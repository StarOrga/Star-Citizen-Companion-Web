/**
 * Token freshness for the long catalog upload.
 *
 * A full catalog upload is hundreds of sequential requests over what can be
 * hours; a Supabase access token lives ~1h. The bug this guards: capturing one
 * token at stage start and reusing it, so every request past the ~1h mark 401s
 * ("logs itself out every hour"). The fix passes a token GETTER that is resolved
 * per request — wired in main to `ensureAccessToken`, which refreshes near
 * expiry. This proves the getter is consulted on EVERY request and that each
 * request carries whatever token the getter currently returns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadCatalog } from '../src/main/catalog-bridge.js';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let outDir: string;

function makeOutDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sc-token-'));
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ channel: 'LIVE', patch_version: '4.0.0', build_number: '9999', schema_version: 1, entity_counts: {} }),
  );
  mkdirSync(join(dir, 'manufacturers'));
  writeFileSync(join(dir, 'manufacturers', 'aegs.json'), JSON.stringify({ className: 'AEGS', name: 'Aegis' }));
  mkdirSync(join(dir, 'ships'));
  writeFileSync(join(dir, 'ships', 'ship0.json'), JSON.stringify({ className: 'SHIP_0', name: 'Ship 0', manufacturer: 'AEGS' }));
  return dir;
}

/** Stub server that records the Authorization header of every request. */
function stubFetchCapturingAuth(auths: string[]): void {
  vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string> }) => {
    auths.push(init.headers.authorization);
    return { ok: true, status: 200, json: async () => ({ build_id: 'build-fixed-1' }) };
  });
}

beforeEach(() => {
  outDir = makeOutDir();
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(outDir, { recursive: true, force: true });
});

describe('catalog upload — per-request token freshness', () => {
  it('resolves the token getter on every request (not once at the start)', async () => {
    const auths: string[] = [];
    stubFetchCapturingAuth(auths);

    // Getter returns a DIFFERENT token each call, standing in for a refresh that
    // rotated the access token partway through a long run.
    let n = 0;
    const getToken = vi.fn(() => Promise.resolve(`token-${++n}`));

    const res = await uploadCatalog(getToken, outDir, () => {});

    expect(res.ok).toBe(true);
    // Several requests went out (init + upserts + finalize).
    expect(auths.length).toBeGreaterThan(2);
    // The getter was consulted once per request — never cached.
    expect(getToken).toHaveBeenCalledTimes(auths.length);
    // Each request carried the freshly-resolved token, and they are not all the
    // same value — i.e. a mid-run rotation actually reaches the wire.
    expect(auths[0]).toBe('Bearer token-1');
    expect(new Set(auths).size).toBe(auths.length);
  });

  it('still accepts a plain string token (backwards-compatible)', async () => {
    const auths: string[] = [];
    stubFetchCapturingAuth(auths);

    const res = await uploadCatalog('static-token', outDir, () => {});

    expect(res.ok).toBe(true);
    expect(auths.every((a) => a === 'Bearer static-token')).toBe(true);
  });
});
