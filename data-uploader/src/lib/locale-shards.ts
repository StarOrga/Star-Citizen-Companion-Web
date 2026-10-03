/**
 * Codex locale strings as R2 shards — the client half of the
 * `locale_sign` / `locale_commit` contract in `ingest-catalog`.
 *
 * The web only ever reads German and English, so only those two languages are
 * uploaded. Each language is split into a fixed number of shards by hashing the
 * key, so the web can fetch the one shard that holds a key instead of the whole
 * table. The body of a shard is canonical (keys sorted, fixed field order), so
 * the same strings always produce the same bytes and the same sha256 — that is
 * what lets the server answer `exists` and a re-run skip the transfer.
 *
 * Pure apart from `node:crypto`; no Electron, no fs.
 */

import { createHash } from 'node:crypto';

/** Languages the web reads — nothing else is uploaded. */
export const LOCALE_LANGS = ['de', 'en'] as const;
export type LocaleLang = (typeof LOCALE_LANGS)[number];

/** Shards per language. Part of the server contract — never change alone. */
export const LOCALE_SHARD_COUNT = 64;

export function isLocaleLang(v: string): v is LocaleLang {
  return (LOCALE_LANGS as readonly string[]).includes(v);
}

/** FNV-1a 32-bit over the UTF-8 bytes of `s`, unsigned. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5; // 2166136261
  for (const byte of Buffer.from(s, 'utf8')) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0; // 16777619
  }
  return h >>> 0;
}

export function shardOf(key: string, count = LOCALE_SHARD_COUNT): number {
  return fnv1a32(key) % count;
}

export interface LocaleShard {
  shard: number;
  /** Exact bytes to PUT. */
  body: Buffer;
  sha256: string;
  bytes: number;
  /** Strings in this shard — progress unit. */
  keys: number;
}

export interface LocaleShardSet {
  lang: LocaleLang;
  shards: LocaleShard[];
  /** Total strings across all shards. */
  keys: number;
  /** Total body bytes across all shards. */
  bytes: number;
}

/**
 * Normalise one extractor table (`{ key: value }`) into the strings the rows
 * used to carry: a leading '@' is dropped, null values are skipped, every value
 * becomes a string.
 */
export function normaliseLocaleTable(table: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [rawKey, value] of Object.entries(table)) {
    if (value == null) continue;
    const key = rawKey.startsWith('@') ? rawKey.slice(1) : rawKey;
    if (!key) continue;
    out.set(key, String(value));
  }
  return out;
}

/** Build all shards of one language. Empty shards still get a body. */
export function buildLocaleShards(
  lang: LocaleLang,
  strings: Map<string, string> | Record<string, string>,
): LocaleShardSet {
  const entries = strings instanceof Map ? [...strings.entries()] : Object.entries(strings);
  const buckets: [string, string][][] = Array.from({ length: LOCALE_SHARD_COUNT }, () => []);
  for (const entry of entries) buckets[shardOf(entry[0])].push(entry);

  let totalBytes = 0;
  const shards = buckets.map((bucket, shard): LocaleShard => {
    bucket.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const obj: Record<string, string> = {};
    for (const [k, v] of bucket) obj[k] = v;
    const body = Buffer.from(JSON.stringify({ v: 1, lang, shard, strings: obj }), 'utf8');
    totalBytes += body.length;
    return {
      shard,
      body,
      sha256: createHash('sha256').update(body).digest('hex'),
      bytes: body.length,
      keys: bucket.length,
    };
  });
  return { lang, shards, keys: entries.length, bytes: totalBytes };
}
