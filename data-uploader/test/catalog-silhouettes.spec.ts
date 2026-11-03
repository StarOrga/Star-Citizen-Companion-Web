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
    // Incremental: ask which outlines the server has, send the rest, then
    // drop the build's rows this run no longer has (no wipe up front).
    expect(ops).toEqual(['carry', 'silhouettes', 'prune']);
  });

  it('falls back to clear + full rows when the server has no carry op', async () => {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { op: string };
      ops.push(body.op);
      if (body.op === 'carry') {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'invalid_body', message: "unknown op 'carry'" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    });
    const r = await uploadCatalog('jwt', outDir, () => {}, { backoffMs: () => 0, mode: 'silhouettes', buildId: 'b-1' });
    expect(r).toMatchObject({ ok: true, counts: { silhouettes: 1 } });
    expect(ops).toEqual(['carry', 'clear_silhouettes', 'silhouettes']);
  });

  it('silhouette mode refuses to run without the codex build id', async () => {
    const r = await uploadCatalog('jwt', outDir, () => {}, { mode: 'silhouettes' });
    expect(r).toMatchObject({ ok: false, errorCode: 'no_build_id' });
    expect(ops).toEqual([]);
  });

  it('sends the skip reasons after the outlines, and only when the build wrote them (#842)', async () => {
    const r1 = await uploadCatalog('jwt', outDir, () => {}, { backoffMs: () => 0, mode: 'silhouettes', buildId: 'b-1' });
    expect(r1.ok).toBe(true);
    expect(ops).not.toContain('silhouette_skips');

    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, stored: 1 }) });
    });
    writeFileSync(
      join(outDir, 'silhouettes', 'skips.json'),
      JSON.stringify({ skips: [{ kind: 'ship', className: 'SHIP_1', reason: 'no_mesh', detail: 'x' }] }),
    );
    const r2 = await uploadCatalog('jwt', outDir, () => {}, { backoffMs: () => 0, mode: 'silhouettes', buildId: 'b-1' });
    expect(r2.ok).toBe(true);
    const sent = bodies.find((b) => b.op === 'silhouette_skips');
    expect(sent).toMatchObject({ build_id: 'b-1', rows: [{ kind: 'ship', className: 'SHIP_1', reason: 'no_mesh' }] });
    expect(bodies.map((b) => b.op).indexOf('silhouette_skips')).toBeGreaterThan(bodies.map((b) => b.op).indexOf('prune'));
  });

  it('a failing skip upload does not fail the silhouette step', async () => {
    writeFileSync(join(outDir, 'silhouettes', 'skips.json'), JSON.stringify({ skips: [] }));
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { op: string };
      ops.push(body.op);
      if (body.op === 'silhouette_skips') {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'invalid_body', message: "unknown op 'silhouette_skips'" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    });
    const r = await uploadCatalog('jwt', outDir, () => {}, { backoffMs: () => 0, mode: 'silhouettes', buildId: 'b-1' });
    expect(r).toMatchObject({ ok: true, counts: { silhouettes: 1 } });
    expect(ops).toContain('silhouette_skips');
  });
});
