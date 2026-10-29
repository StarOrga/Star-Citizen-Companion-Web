/**
 * `build_manifest.id` next to Data.p4k travels with the catalog `init` as
 * `game_build_manifest`; an absent or unreadable file leaves the field out.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGameBuildManifest, uploadCatalog } from '../src/main/catalog-bridge.js';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let root: string;
let outDir: string;
let gameDir: string;

const MANIFEST = { Data: { Branch: 'sc-alpha-4.4.0', BuildDateStamp: '2026-10-20', RequestedP4ChangeNum: '1234567', Version: '4.4.0' } };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sc-gbm-'));
  outDir = join(root, 'out');
  gameDir = join(root, 'LIVE');
  mkdirSync(outDir);
  mkdirSync(gameDir);
  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify({ channel: 'LIVE', patch_version: '4.0.0', build_number: '9999', schema_version: 1, entity_counts: {} }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe('readGameBuildManifest', () => {
  it('reads the JSON next to Data.p4k, BOM tolerated', async () => {
    writeFileSync(join(gameDir, 'build_manifest.id'), '﻿' + JSON.stringify(MANIFEST));
    expect(await readGameBuildManifest(join(gameDir, 'Data.p4k'))).toEqual(MANIFEST);
  });
  it('returns null when absent, malformed, not an object, or no path', async () => {
    const p4k = join(gameDir, 'Data.p4k');
    expect(await readGameBuildManifest(p4k)).toBeNull();
    writeFileSync(join(gameDir, 'build_manifest.id'), '{not json');
    expect(await readGameBuildManifest(p4k)).toBeNull();
    writeFileSync(join(gameDir, 'build_manifest.id'), '[1,2]');
    expect(await readGameBuildManifest(p4k)).toBeNull();
    expect(await readGameBuildManifest(null)).toBeNull();
  });
});

describe('uploadCatalog init', () => {
  async function initBody(p4kPath: string | null): Promise<Record<string, unknown>> {
    let init: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', async (_url: string, req: RequestInit) => {
      const body = JSON.parse(String(req.body)) as { op: string; build?: Record<string, unknown> };
      if (body.op === 'init') init = body.build ?? null;
      return { ok: true, status: 200, json: async () => ({ build_id: 'b' }) };
    });
    const r = await uploadCatalog('jwt', outDir, () => {}, { p4kPath, backoffMs: () => 0 });
    expect(r.buildId).toBe('b'); // init answered; an empty catalog fails later, irrelevant here
    return init as unknown as Record<string, unknown>;
  }

  it('sends game_build_manifest when the file exists', async () => {
    writeFileSync(join(gameDir, 'build_manifest.id'), JSON.stringify(MANIFEST));
    const build = await initBody(join(gameDir, 'Data.p4k'));
    expect(build.game_build_manifest).toEqual(MANIFEST);
  });
  it('omits the field when the file is absent', async () => {
    const build = await initBody(join(gameDir, 'Data.p4k'));
    expect('game_build_manifest' in build).toBe(false);
  });
});
