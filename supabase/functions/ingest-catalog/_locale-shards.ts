// Codex locale shards — the R2 storage contract for global.ini strings
// (storage.md "Codex locale strings in R2", 2026-10-03).
//
// Per (build, lang) the key→value map is split into SHARD_COUNT shards:
//   shard(key) = FNV-1a 32-bit over the UTF-8 bytes of the key (no leading '@',
//                exactly as codex_locale_strings stores it) >>> 0, mod 64.
// One shard is the JSON body {"v":1,"lang":"de","shard":7,"strings":{...}},
// stored content-addressed in R2 as `codex-locale/<sha256-hex-of-body>.json`.
// An empty shard still gets an object, so a bundle always lists 64 hashes.
//
// The uploader and the web client implement the same hash; this module is the
// reference. Pure logic only (WebCrypto + TextEncoder), so Deno imports it and
// the Node tests load it directly (`node --test`, Node 24 strips the types).

export const SHARD_COUNT = 64;
export const BUNDLE_VERSION = 1;
export const LOCALE_PREFIX = 'codex-locale/';
export const LOCALE_LANGS = ['de', 'en'] as const;
export type LocaleLang = (typeof LOCALE_LANGS)[number];

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const encoder = new TextEncoder();

export function isLocaleLang(x: unknown): x is LocaleLang {
  return x === 'de' || x === 'en';
}

/** FNV-1a 32-bit over the UTF-8 bytes of `s`, as an unsigned integer. */
export function fnv1a(s: string): number {
  let h = FNV_OFFSET;
  for (const b of encoder.encode(s)) {
    h ^= b;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

export function shardOf(key: string): number {
  return fnv1a(key) % SHARD_COUNT;
}

/** R2 key of a shard object. */
export function shardObjectKey(sha256: string): string {
  return `${LOCALE_PREFIX}${sha256}.json`;
}

export const SHA256_RE = /^[0-9a-f]{64}$/;

export interface Shard {
  shard: number;
  body: Uint8Array<ArrayBuffer>;
  sha256: string;
  bytes: number;
  keys: number;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Splits `strings` into SHARD_COUNT shard bodies. Keys are written in sorted
 * order, so the same map always yields the same bytes and therefore the same
 * content address (an unchanged shard is never uploaded twice).
 */
export async function buildShards(
  lang: LocaleLang,
  strings: Map<string, string> | Record<string, string>,
): Promise<Shard[]> {
  const entries = strings instanceof Map ? [...strings.entries()] : Object.entries(strings);
  const buckets: [string, string][][] = Array.from({ length: SHARD_COUNT }, () => []);
  for (const [k, v] of entries) buckets[shardOf(k)].push([k, v]);
  return Promise.all(
    buckets.map(async (pairs, shard) => {
      pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      // Null prototype: a key named __proto__ stays a plain own property.
      const map: Record<string, string> = Object.create(null);
      for (const [k, v] of pairs) map[k] = v;
      // new Uint8Array(...) pins the buffer type to ArrayBuffer (BodyInit, BufferSource).
      const body = new Uint8Array(encoder.encode(JSON.stringify({ v: BUNDLE_VERSION, lang, shard, strings: map })));
      return { shard, body, sha256: await sha256Hex(body), bytes: body.length, keys: pairs.length };
    }),
  );
}

/** The `codex_builds.locale_bundles[lang]` value for a set of shards. */
export interface LocaleBundle {
  v: number;
  shards: string[];
  keys: number;
  bytes: number;
}

export function bundleOf(shards: Shard[]): LocaleBundle {
  return {
    v: BUNDLE_VERSION,
    shards: shards.map((s) => s.sha256),
    keys: shards.reduce((n, s) => n + s.keys, 0),
    bytes: shards.reduce((n, s) => n + s.bytes, 0),
  };
}
