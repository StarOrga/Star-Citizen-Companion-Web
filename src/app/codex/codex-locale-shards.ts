/**
 * Codex locale strings on R2: each build+lang is split into a fixed number of
 * immutable, content-addressed JSON shards. `codex_builds.locale_bundles` lists
 * the shard hashes per language; a key lives in shard `fnv1a32(key) % 64`
 * (key WITHOUT the leading `@`). The server side (ingest + Worker) uses the
 * same hash — the test vectors in the spec pin both ends to one contract.
 */

export const LOCALE_SHARD_COUNT = 64;

/** One language's entry of `codex_builds.locale_bundles`. */
export interface LocaleBundle {
  v: number;
  /** Shard content hashes, index = shard number; exactly LOCALE_SHARD_COUNT long. */
  shards: string[];
  keys: number;
  bytes: number;
}

export type LocaleBundles = Record<string, LocaleBundle>;

/** FNV-1a 32-bit over the UTF-8 bytes of `s`, as an unsigned integer. */
export function fnv1a32(s: string): number {
  let h = 2166136261;
  for (const byte of new TextEncoder().encode(s)) {
    h ^= byte;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Shard index of a locale key (without the leading `@`). */
export function localeShardOf(key: string): number {
  return fnv1a32(key) % LOCALE_SHARD_COUNT;
}

/**
 * Base URL of the codex-locale shards on the assets Worker, or null when no R2
 * host is configured (then the client stays on the Supabase table).
 */
export function codexLocaleBase(r2BaseUrl: string | null | undefined): string | null {
  const r2 = (r2BaseUrl ?? '').trim().replace(/\/+$/, '');
  return r2 ? `${r2}/codex-locale/` : null;
}

/**
 * Validated `locale_bundles` column value. Anything malformed — a missing
 * column, `{}`, a language whose shard list is not exactly 64 strings — is
 * dropped, so the caller falls back to the table for that language.
 */
export function parseLocaleBundles(raw: unknown): LocaleBundles {
  const out: LocaleBundles = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [lang, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const shards = e['shards'];
    if (
      !Array.isArray(shards) ||
      shards.length !== LOCALE_SHARD_COUNT ||
      !shards.every((s) => typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s))
    ) {
      continue;
    }
    out[lang] = {
      v: typeof e['v'] === 'number' ? e['v'] : 1,
      shards: shards as string[],
      keys: typeof e['keys'] === 'number' ? e['keys'] : 0,
      bytes: typeof e['bytes'] === 'number' ? e['bytes'] : 0,
    };
  }
  return out;
}

/** The `strings` map of a shard body, or null when the body is not a shard. */
export function shardStrings(body: unknown): Record<string, string> | null {
  if (!body || typeof body !== 'object') return null;
  const strings = (body as Record<string, unknown>)['strings'];
  if (!strings || typeof strings !== 'object' || Array.isArray(strings)) return null;
  return strings as Record<string, string>;
}
