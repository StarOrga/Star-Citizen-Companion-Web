/**
 * A catalog request that hangs (stalled socket, silent server) must hit its
 * deadline and go through the existing retry loop instead of blocking a
 * multi-hour run forever (AUD-052).
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
  const dir = mkdtempSync(join(tmpdir(), 'sc-timeout-'));
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

beforeEach(() => {
  outDir = makeOutDir();
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(outDir, { recursive: true, force: true });
});

describe('uploadCatalog deadline', () => {
  it('retries a request that hung past its deadline', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        // The first request never answers; it only ends when its signal aborts.
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ build_id: 'b' }) });
    });

    const r = await uploadCatalog('jwt', outDir, () => {}, { requestTimeoutMs: 20, backoffMs: () => 0 });

    expect(r.ok).toBe(true);
    // 1 timed-out attempt + its retry + the rest of the protocol.
    expect(calls).toBeGreaterThan(2);
  });
});
