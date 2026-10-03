import {
  LOCALE_SHARD_COUNT,
  codexLocaleBase,
  fnv1a32,
  localeShardOf,
  parseLocaleBundles,
  shardStrings,
} from './codex-locale-shards';

const shardList = (n = LOCALE_SHARD_COUNT) => Array.from({ length: n }, (_, i) => `sha${i}`);

describe('codex-locale-shards', () => {
  it('matches the contract test vectors', () => {
    expect(fnv1a32('')).toBe(2166136261);
    expect(fnv1a32('a')).toBe(3826002220);
  });

  it('hashes UTF-8 bytes, not UTF-16 code units', () => {
    // 'ä' is two UTF-8 bytes (C3 A4); hashing the code unit would differ.
    let h = 2166136261;
    for (const b of [0xc3, 0xa4]) h = Math.imul(h ^ b, 16777619);
    expect(fnv1a32('ä')).toBe(h >>> 0);
  });

  it('maps every key into [0, 64)', () => {
    for (const k of ['', 'a', 'ui_role_bomber', 'vehicle_NameDRAK_Cutlass_Black']) {
      const s = localeShardOf(k);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(LOCALE_SHARD_COUNT);
      expect(s).toBe(fnv1a32(k) % 64);
    }
  });

  it('builds the shard base from the R2 host, null without one', () => {
    expect(codexLocaleBase('https://x.workers.dev/')).toBe('https://x.workers.dev/codex-locale/');
    expect(codexLocaleBase('')).toBeNull();
    expect(codexLocaleBase(undefined)).toBeNull();
  });

  it('keeps only languages with exactly 64 shard hashes', () => {
    const parsed = parseLocaleBundles({
      de: { v: 1, shards: shardList(), keys: 10, bytes: 99 },
      en: { v: 1, shards: shardList(63), keys: 10, bytes: 99 },
      fr: null,
    });
    expect(Object.keys(parsed)).toEqual(['de']);
    expect(parsed['de'].shards.length).toBe(64);
    expect(parseLocaleBundles({})).toEqual({});
    expect(parseLocaleBundles(null)).toEqual({});
    expect(parseLocaleBundles([])).toEqual({});
  });

  it('rejects shard hashes that are not URL-safe', () => {
    const bad = shardList();
    bad[3] = '../evil';
    expect(parseLocaleBundles({ de: { v: 1, shards: bad, keys: 1, bytes: 1 } })).toEqual({});
  });

  it('reads the strings map of a shard body', () => {
    expect(shardStrings({ v: 1, lang: 'de', shard: 7, strings: { a: 'b' } })).toEqual({ a: 'b' });
    expect(shardStrings({ v: 1 })).toBeNull();
    expect(shardStrings('nope')).toBeNull();
  });
});
