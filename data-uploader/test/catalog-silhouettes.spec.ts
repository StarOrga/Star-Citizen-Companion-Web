/**
 * Vertical slices: the Codex step's catalog run goes live WITHOUT outlines, and
 * the Silhouetten step sends them afterwards to the SAME build row — no new
 * `init`, no second `finalize`.
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
let ops: string[];

function makeOutDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sc-sil-'));
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ channel: 'LIVE', patch_version: '4.0.0', build_number: '9999', schema_version: 1, entity_counts: {} }),
  );
  mkdirSync(join(dir, 'manufacturers'));
  writeFileSync(join(dir, 'manufacturers', 'aegs.json'), JSON.stringify({ className: 'AEGS', name: 'Aegis' }));
  mkdirSync(join(dir, 'ships'));
  writeFileSync(join(dir, 'ships', 'ship0.json'), JSON.stringify({ className: 'SHIP_0', name: 'Ship 0', manufacturer: 'AEGS' }));
  mkdirSync(join(dir, 'silhouettes', 'rows'), { recursive: true });
  writeFileSync(
    join(dir, 'silhouettes', 'rows', 'ship0.json'),
    JSON.stringify({ kind: 'ship', className: 'SHIP_0', silhouette: { path: 'M0 0L1 1Z', bbox: [0, 0, 1, 1] } }),
  );
  return dir;
}

beforeEach(() => {
  outDir = makeOutDir();
  ops = [];
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { op: string };
    ops.push(body.op);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ build_id: 'b-1', ok: true }) });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(outDir, { recursive: true, force: true });
});

describe('silhouettes as their own step', () => {
  it('the catalog run finalizes without sending any silhouette', async () => {
    const r = await uploadCatalog('jwt', outDir, () => {}, { backoffMs: () => 0 });
    expect(r.ok).toBe(true);
    expect(ops).toContain('init');
    expect(ops).toContain('finalize');
    expect(ops).not.toContain('silhouettes');
    expect(ops).not.toContain('clear_silhouettes');
    expect(ops).not.toContain('constellation');
  });

  it('silhouette mode sends only the outlines to the existing build', async () => {
    const r = await uploadCatalog('jwt', outDir, () => {}, { backoffMs: () => 0, mode: 'silhouettes', buildId: 'b-1' });
    expect(r).toMatchObject({ ok: true, buildId: 'b-1', counts: { silhouettes: 1 } });
    expect(ops).toEqual(['clear_silhouettes', 'silhouettes']);
  });

  it('silhouette mode refuses to run without the codex build id', async () => {
    const r = await uploadCatalog('jwt', outDir, () => {}, { mode: 'silhouettes' });
    expect(r).toMatchObject({ ok: false, errorCode: 'no_build_id' });
    expect(ops).toEqual([]);
  });
});
