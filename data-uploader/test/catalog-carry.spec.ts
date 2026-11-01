/**
 * Per-object incremental codex upload (ingest-catalog op `carry`): a second
 * upload of an unchanged build sends no rows, a new build sends only the rows
 * whose content changed — against an in-memory server that answers `carry`
 * the way codex_carry_over() does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadCatalog } from '../src/main/catalog-bridge.js';
import { canonicalJson, carryKey, contentSha, planCarry, rowsToSend } from '../src/lib/catalog-carry.js';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const nat = (build: string) => ({ build_id: `b-${build}`, channel: 'LIVE', patch_version: '4.0.0', build_number: build });

describe('contentSha', () => {
  const row = (build: string, extra: Record<string, unknown> = {}) => ({
    ...nat(build),
    class_name: 'ITEM_A',
    size: 1,
    payload: { className: 'ITEM_A', source: { build, patch: '4.0.0', channel: 'LIVE' }, stats: { b: 2, a: 1 } },
    ...extra,
  });

  it('ignores the build coordinates and the payload build stamp', () => {
    expect(contentSha('codex_items', row('1'))).toBe(contentSha('codex_items', row('2')));
    expect(contentSha('codex_items', row('1'))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores key order but not content', () => {
    const reordered = row('1', { payload: { stats: { a: 1, b: 2 }, source: {}, className: 'ITEM_A' } });
    expect(contentSha('codex_items', reordered)).toBe(contentSha('codex_items', row('1')));
    expect(contentSha('codex_items', row('1', { size: 2 }))).not.toBe(contentSha('codex_items', row('1')));
  });

  it('a stored content_sha never feeds back into the hash', () => {
    expect(contentSha('codex_items', row('1', { content_sha: 'x' }))).toBe(contentSha('codex_items', row('1')));
  });

  it('silhouettes ignore meta.source and generated_at, not the path', () => {
    const sil = (build: string, path: string, at: string) => ({
      ...nat(build), kind: 'ship', class_name: 'S', path, meta: { source: { build }, toolVersion: 't' }, generated_at: at,
    });
    expect(contentSha('codex_silhouettes', sil('1', 'M0', 'x'))).toBe(contentSha('codex_silhouettes', sil('2', 'M0', 'y')));
    expect(contentSha('codex_silhouettes', sil('1', 'M0', 'x'))).not.toBe(contentSha('codex_silhouettes', sil('1', 'M1', 'x')));
  });

  it('canonicalJson drops undefined like JSON.stringify', () => {
    expect(canonicalJson({ b: undefined, a: [1, undefined] })).toBe('{"a":[1,null]}');
  });
});

describe('planCarry', () => {
  it('asks about keyed rows and stamps copies with the chunk stamp', () => {
    const rows = [
      { ...nat('2'), class_name: 'A', payload: { source: { build: '2' } } },
      { ...nat('2'), class_name: '', payload: { source: { build: '2' } } },
      { ...nat('2'), class_name: 'C', payload: { source: { build: 'other' } } },
      { ...nat('2'), class_name: 'D', payload: { source: { build: '2' } } },
    ];
    const plan = planCarry('codex_items', rows);
    expect(plan.carry.map((c) => c.k)).toEqual([['A'], ['D']]);
    expect(plan.carryIdx).toEqual([0, 3]);
    expect(plan.forced).toEqual([1, 2]);
    expect(plan.set).toEqual({ 'payload.source': { build: '2' } });
    // The server lacks D (index 1 of `carry`) -> send D plus the forced rows.
    expect(rowsToSend(plan, [1])).toEqual([1, 2, 3]);
  });

  it('a chunk without stamps sends an empty set, entity strings key on 3 columns', () => {
    const s = { ...nat('2'), entity_class_name: 'A', lang: 'en', field: 'name', value: 'x' };
    expect(carryKey('codex_entity_strings', s)).toEqual(['A', 'en', 'name']);
    expect(planCarry('codex_entity_strings', [s]).set).toEqual({});
  });
});

// ── in-memory ingest-catalog ──────────────────────────────────────────────────

type Stored = Map<string, Map<string, Map<string, string | null>>>; // build -> table -> key -> sha
const KEY_COLS: Record<string, string[]> = {
  codex_entity_strings: ['entity_class_name', 'lang', 'field'],
  codex_silhouettes: ['kind', 'class_name'],
};
const keyOf = (table: string, row: Record<string, unknown>) =>
  JSON.stringify((KEY_COLS[table] ?? ['class_name']).map((c) => row[c]));

let outDir: string;
let store: Stored;
let upserted: { table: string; rows: Record<string, unknown>[] }[];
let nextBuild: string;

function tableOf(store: Stored, build: string, table: string): Map<string, string | null> {
  if (!store.has(build)) store.set(build, new Map());
  const b = store.get(build)!;
  if (!b.has(table)) b.set(table, new Map());
  return b.get(table)!;
}

function server(op: string, body: Record<string, unknown>): Record<string, unknown> {
  if (op === 'init') return { ok: true, build_id: nextBuild };
  if (op === 'carry') {
    const table = String(body.table);
    const build = String(body.build_id);
    const target = tableOf(store, build, table);
    let kept = 0;
    let copied = 0;
    const missing: number[] = [];
    (body.rows as { k: string[]; h: string }[]).forEach((r, i) => {
      const k = JSON.stringify(r.k);
      if (target.get(k) === r.h) { kept++; return; }
      const src = [...store.entries()].find(([id, t]) => id !== build && t.get(table)?.get(k) === r.h);
      if (src) { target.set(k, r.h); copied++; return; }
      missing.push(i);
    });
    return { ok: true, kept, copied, missing };
  }
  const rowsOp: Record<string, string> = { upsert: '', strings: 'codex_entity_strings', silhouettes: 'codex_silhouettes' };
  if (op in rowsOp) {
    const table = rowsOp[op] || String(body.table);
    const rows = body.rows as Record<string, unknown>[];
    upserted.push({ table, rows });
    for (const r of rows) tableOf(store, String(r.build_id ?? body.build_id), table).set(keyOf(table, r), (r.content_sha as string) ?? null);
  }
  return { ok: true };
}

function writeOutDir(build: string, items: Record<string, number>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sc-carry-'));
  const source = { channel: 'LIVE', patch: '4.0.0', build };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ channel: 'LIVE', patch_version: '4.0.0', build_number: build, entity_counts: {} }));
  mkdirSync(join(dir, 'manufacturers'));
  writeFileSync(join(dir, 'manufacturers', 'aegs.json'), JSON.stringify({ className: 'AEGS', name: { en: 'Aegis' }, source }));
  mkdirSync(join(dir, 'ships'));
  writeFileSync(join(dir, 'ships', 's0.json'), JSON.stringify({ className: 'SHIP_0', name: { en: 'Ship 0', de: 'Schiff 0' }, source }));
  mkdirSync(join(dir, 'items'));
  for (const [cn, size] of Object.entries(items)) {
    writeFileSync(join(dir, 'items', `${cn}.json`), JSON.stringify({ className: cn, size, name: { en: cn }, source }));
  }
  return dir;
}

const sentRows = (table: string) => upserted.filter((u) => u.table === table).reduce((n, u) => n + u.rows.length, 0);

beforeEach(() => {
  store = new Map();
  upserted = [];
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    return Promise.resolve({ ok: true, status: 200, json: async () => server(String(body.op), body) });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('uploadCatalog incremental', () => {
  it('first upload sends every row with its content hash', async () => {
    nextBuild = 'b-1';
    outDir = writeOutDir('1', { I0: 1, I1: 2, I2: 3 });
    const r = await uploadCatalog('jwt', outDir, () => {}, { backoffMs: () => 0 });
    expect(r.ok).toBe(true);
    expect(sentRows('codex_items')).toBe(3);
    expect(upserted.find((u) => u.table === 'codex_items')!.rows.every((x) => /^[0-9a-f]{64}$/.test(String(x.content_sha)))).toBe(true);
    expect(r.transfer?.codex_items).toEqual({ sent: 3, kept: 0, copied: 0 });
  });

  it('a second upload of the unchanged build sends no rows at all', async () => {
    nextBuild = 'b-1';
    outDir = writeOutDir('1', { I0: 1, I1: 2, I2: 3 });
    await uploadCatalog('jwt', outDir, () => {}, { backoffMs: () => 0 });
    upserted = [];
    const r = await uploadCatalog('jwt', outDir, () => {}, { backoffMs: () => 0, buildId: 'b-1' });
    expect(r.ok).toBe(true);
    expect(upserted.filter((u) => u.table !== 'codex_locale_strings')).toEqual([]);
    expect(r.transfer?.codex_items).toEqual({ sent: 0, kept: 3, copied: 0 });
    expect(r.transfer?.codex_entity_strings?.sent).toBe(0);
  });

  it('a new build sends only the changed and the new rows', async () => {
    nextBuild = 'b-1';
    outDir = writeOutDir('1', { I0: 1, I1: 2, I2: 3 });
    await uploadCatalog('jwt', outDir, () => {}, { backoffMs: () => 0 });
    rmSync(outDir, { recursive: true, force: true });
    upserted = [];
    nextBuild = 'b-2';
    // New build stamp everywhere, I1 changed, I3 new, I2 gone.
    outDir = writeOutDir('2', { I0: 1, I1: 9, I3: 4 });
    const r = await uploadCatalog('jwt', outDir, () => {}, { backoffMs: () => 0 });
    expect(r.ok).toBe(true);
    const items = upserted.filter((u) => u.table === 'codex_items').flatMap((u) => u.rows.map((x) => x.class_name));
    expect(items.sort()).toEqual(['I1', 'I3']);
    expect(r.transfer?.codex_items).toEqual({ sent: 2, kept: 0, copied: 1 });
    expect(sentRows('codex_ships')).toBe(0);
    expect(sentRows('codex_manufacturers')).toBe(0);
  });

  it('a server without the migration gets full rows without content_sha', async () => {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (body.op === 'carry') return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, degraded: 'no_carry' }) });
      return Promise.resolve({ ok: true, status: 200, json: async () => server(String(body.op), body) });
    });
    nextBuild = 'b-1';
    outDir = writeOutDir('1', { I0: 1, I1: 2 });
    const r = await uploadCatalog('jwt', outDir, () => {}, { backoffMs: () => 0 });
    expect(r.ok).toBe(true);
    expect(sentRows('codex_items')).toBe(2);
    expect(upserted.every((u) => u.rows.every((x) => !('content_sha' in x)))).toBe(true);
  });
});
