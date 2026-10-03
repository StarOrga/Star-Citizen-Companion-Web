import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOCALE_SHARD_COUNT,
  buildLocaleShards,
  fnv1a32,
  normaliseLocaleTable,
  shardOf,
} from '../src/lib/locale-shards.js';
import { uploadCatalog } from '../src/main/catalog-bridge.js';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('locale shard hashing', () => {
  it('matches the FNV-1a 32-bit contract vectors', () => {
    expect(fnv1a32('')).toBe(2166136261);
    expect(fnv1a32('a')).toBe(3826002220);
  });

  it('hashes UTF-8 bytes, not UTF-16 code units', () => {
    // "ä" is 2 UTF-8 bytes (0xC3 0xA4); hashing the code unit 0xE4 would differ.
    let h = 2166136261;
    for (const b of [0xc3, 0xa4]) h = Math.imul(h ^ b, 16777619) >>> 0;
    expect(fnv1a32('ä')).toBe(h);
  });

  it('maps every key into 0..63', () => {
    for (const k of ['', 'a', 'vehicle_NameAEGS_Gladius', 'ü€😀']) {
      const s = shardOf(k);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(LOCALE_SHARD_COUNT);
      expect(s).toBe(fnv1a32(k) % 64);
    }
  });
});

describe('buildLocaleShards', () => {
  it('always yields 64 shards, empty ones with a body', () => {
    const set = buildLocaleShards('de', new Map());
    expect(set.shards).toHaveLength(64);
    expect(set.keys).toBe(0);
    const s5 = set.shards[5];
    expect(s5.body.toString('utf8')).toBe('{"v":1,"lang":"de","shard":5,"strings":{}}');
    expect(s5.sha256).toBe(createHash('sha256').update(s5.body).digest('hex'));
    expect(s5.bytes).toBe(s5.body.length);
  });

  it('sorts keys and is independent of input order', () => {
    const keys = Array.from({ length: 300 }, (_, i) => `key_${i}`);
    const a = buildLocaleShards('en', new Map(keys.map((k) => [k, k.toUpperCase()])));
    const b = buildLocaleShards('en', new Map([...keys].reverse().map((k) => [k, k.toUpperCase()])));
    expect(a.shards.map((s) => s.sha256)).toEqual(b.shards.map((s) => s.sha256));
    expect(a.keys).toBe(300);
    expect(a.shards.reduce((n, s) => n + s.keys, 0)).toBe(300);
    for (const s of a.shards) {
      const parsed = JSON.parse(s.body.toString('utf8')) as { strings: Record<string, string> };
      const ks = Object.keys(parsed.strings);
      expect(ks).toEqual([...ks].sort());
      for (const k of ks) expect(shardOf(k)).toBe(s.shard);
    }
  });

  it('normalises keys: drops a leading @ and null values', () => {
    const m = normaliseLocaleTable({ '@a': 'A', b: 2, c: null });
    expect([...m.entries()]).toEqual([
      ['a', 'A'],
      ['b', '2'],
    ]);
  });
});

// ── bridge: sign → PUT → commit ─────────────────────────────────────────────

interface Call {
  method: string;
  url: string;
  op?: string;
  body?: Record<string, unknown>;
}

let outDir: string;

function makeOutDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sc-locale-'));
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ channel: 'LIVE', patch_version: '4.0.0', build_number: '1', entity_counts: {} }),
  );
  mkdirSync(join(dir, 'manufacturers'));
  writeFileSync(join(dir, 'manufacturers', 'a.json'), JSON.stringify({ className: 'AEGS', name: 'Aegis' }));
  mkdirSync(join(dir, 'ships'));
  writeFileSync(join(dir, 'ships', 's.json'), JSON.stringify({ className: 'S1', name: 'S', manufacturer: 'AEGS' }));
  mkdirSync(join(dir, 'localization'));
  writeFileSync(join(dir, 'localization', 'de.json'), JSON.stringify({ k1: 'Eins', k2: 'Zwei' }));
  writeFileSync(join(dir, 'localization', 'en.json'), JSON.stringify({ k1: 'One', k2: 'Two', k3: 'Three' }));
  writeFileSync(join(dir, 'localization', 'fr.json'), JSON.stringify({ k1: 'Un' }));
  return dir;
}

function stub(calls: Call[], opts: { existing?: Set<string>; signError?: { status: number; error: string } } = {}): void {
  vi.stubGlobal('fetch', async (url: string, init: { method: string; body: unknown }) => {
    if (init.method === 'PUT') {
      calls.push({ method: 'PUT', url });
      return { ok: true, status: 200, json: async () => ({}) };
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ method: 'POST', url, op: String(body.op), body });
    if (body.op === 'locale_sign') {
      if (opts.signError) {
        return { ok: false, status: opts.signError.status, json: async () => ({ error: opts.signError?.error }) };
      }
      const shards = body.shards as { sha256: string }[];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          uploads: shards.map((s) => ({
            sha256: s.sha256,
            signedUrl: `https://r2.test/${s.sha256}`,
            exists: opts.existing?.has(s.sha256) ?? false,
          })),
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ build_id: 'b1' }) };
  });
}

beforeEach(() => {
  outDir = makeOutDir();
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(outDir, { recursive: true, force: true });
});

describe('uploadCatalog locale phase', () => {
  it('signs, PUTs and commits 64 shards for de and en only, never the row op', async () => {
    const calls: Call[] = [];
    stub(calls);
    const progress: { current: number; total: number }[] = [];
    const res = await uploadCatalog('t', outDir, (p) => {
      if (p.phase === 'codex_locale_shards') progress.push({ current: p.current, total: p.total });
    });
    expect(res.ok).toBe(true);
    expect(res.counts?.['locale_strings']).toBe(5);
    expect(calls.some((c) => c.op === 'locale_strings')).toBe(false);

    const signs = calls.filter((c) => c.op === 'locale_sign');
    expect(signs.map((c) => c.body?.lang)).toEqual(['de', 'en']);
    for (const s of signs) {
      expect(s.body?.build_id).toBe('b1');
      expect((s.body?.shards as unknown[]).length).toBe(64);
    }
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(128);

    const commits = calls.filter((c) => c.op === 'locale_commit');
    expect(commits.map((c) => [c.body?.lang, c.body?.keys])).toEqual([
      ['de', 2],
      ['en', 3],
    ]);
    expect((commits[0].body?.shards as string[]).length).toBe(64);
    // sign → all PUTs of that lang → commit, per language.
    const seq = calls.map((c) => c.op ?? 'PUT');
    expect(seq.indexOf('locale_commit')).toBeGreaterThan(seq.indexOf('locale_sign'));
    expect(seq.lastIndexOf('PUT')).toBeLessThan(seq.lastIndexOf('locale_commit'));
    expect(progress.at(-1)).toEqual({ current: 5, total: 5 });
  });

  it('skips the PUT for shards the server already holds', async () => {
    const calls: Call[] = [];
    const de = buildLocaleShards('de', new Map([['k1', 'Eins'], ['k2', 'Zwei']]));
    stub(calls, { existing: new Set(de.shards.map((s) => s.sha256)) });
    await uploadCatalog('t', outDir, () => {});
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(64); // en only
    expect(calls.filter((c) => c.op === 'locale_commit')).toHaveLength(2);
  });

  it('a resumed run skips languages already committed', async () => {
    const calls: Call[] = [];
    stub(calls);
    await uploadCatalog('t', outDir, () => {}, {
      buildId: 'b1',
      sentFor: (phase) => (phase === 'codex_locale_shards' ? 1 : 0),
    });
    expect(calls.filter((c) => c.op === 'locale_sign').map((c) => c.body?.lang)).toEqual(['en']);
  });

  it('stops on the R2 cost gate without retrying and reports its code', async () => {
    const calls: Call[] = [];
    stub(calls, { signError: { status: 507, error: 'r2_free_tier_guard' } });
    const res = await uploadCatalog('t', outDir, () => {}, { backoffMs: () => 0 });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('r2_free_tier_guard');
    expect(res.errorPhase).toBe('codex_locale_shards');
    expect(calls.filter((c) => c.op === 'locale_sign')).toHaveLength(1);
    expect(calls.some((c) => c.op === 'finalize')).toBe(false);
  });

  it('treats 503 r2_usage_unknown as a stop, not a retry', async () => {
    const calls: Call[] = [];
    stub(calls, { signError: { status: 503, error: 'r2_usage_unknown' } });
    const res = await uploadCatalog('t', outDir, () => {}, { backoffMs: () => 0 });
    expect(res.errorCode).toBe('r2_usage_unknown');
    expect(calls.filter((c) => c.op === 'locale_sign')).toHaveLength(1);
  });
});
