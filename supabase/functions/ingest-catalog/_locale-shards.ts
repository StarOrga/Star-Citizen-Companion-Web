// Localization strings in R2 — the shard layout (storage plan, 2026-10-03).
//
// One build's global.ini tables are ~31 MB of key→value pairs across 11
// languages (English alone ~10 MB, 90k keys). They used to sit in
// codex_locale_strings (185 MB with its index for two builds), the biggest
// consumer of the 500 MB Free database. They now live in the R2 assets bucket
// and are read through the public Worker.
//
// A page asks for a handful of keys (detail: a few, /codex/keybinds: ~1 250
// `ui_*` keys), so one file per language would be far too big and one file per
// key far too many. Keys are grouped by their first `_` segment (`ui`, `item`,
// `pu`, …), because a page's keys share it; a large group is split by hash into
// shards of about SHARD_TARGET_BYTES, and every group smaller than
// GROUP_MIN_BYTES goes into the hashed `_misc` shards. The per-language
// index.json records the split, so the client computes a key's shard without
// another lookup. Keybinds then needs ~3 shards, a detail page 1-5.
//
// Keys:
//   codex-locale/<build_id>/<lang>/index.json              (short cache)
//   codex-locale/<build_id>/<lang>/<gen>/<shard>.json      (immutable)
// `gen` is new on every publish, so a shard key never changes content and the
// Worker can serve it `immutable`; the index points at the current gen.
//
// This file is plain, erasable TypeScript on purpose: the edge function, the
// node tests and scripts/codex-locale-to-r2.mjs import it as is. The client's
// copy of the lookup (src/app/codex/codex-locale-shards.ts) is pinned to the
// same golden vectors in both test suites.

export const LOCALE_ROOT = 'codex-locale';
export const SHARD_TARGET_BYTES = 96 * 1024;
export const GROUP_MIN_BYTES = 16 * 1024;
export const MISC_GROUP = '_misc';

export const BUILD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,4})?$/;
const GROUP_RE = /^[a-z0-9]{1,24}$/;

export interface LocaleIndex {
  v: 1;
  build_id: string;
  lang: string;
  gen: string;
  /** Number of keys over all shards. */
  count: number;
  /** Shard count per own group; every other key is in `_misc`. */
  groups: Record<string, number>;
  misc: number;
}

/** FNV-1a over UTF-16 code units — tiny, and identical in Deno, Node and the browser. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The key's group (lower-cased first `_` segment), or '' when it cannot name a file. */
export function keyGroup(key: string): string {
  const head = key.split('_', 1)[0].toLowerCase();
  return GROUP_RE.test(head) ? head : '';
}

/** Shard name of `key` (without `.json`) under the given index. */
export function shardFor(index: Pick<LocaleIndex, 'groups' | 'misc'>, key: string): string {
  const group = keyGroup(key);
  const own = group ? index.groups[group] : undefined;
  if (own) return `${group}-${fnv1a(key) % own}`;
  return `${MISC_GROUP}-${fnv1a(key) % Math.max(1, index.misc)}`;
}

function entryBytes(key: string, value: string): number {
  // JSON overhead ("k":"v",) plus the characters; an estimate is enough to size shards.
  return key.length + value.length + 6;
}

/** Split one language's entries into shards. Pure; the caller writes them. */
export function buildShards(
  buildId: string,
  lang: string,
  gen: string,
  entries: Record<string, string>,
): { index: LocaleIndex; shards: Map<string, Record<string, string>> } {
  const groupBytes = new Map<string, number>();
  let miscBytes = 0;
  const keys = Object.keys(entries);
  for (const k of keys) {
    const g = keyGroup(k);
    const b = entryBytes(k, entries[k]);
    if (g) groupBytes.set(g, (groupBytes.get(g) ?? 0) + b);
    else miscBytes += b;
  }
  const groups: Record<string, number> = {};
  for (const [g, b] of [...groupBytes].sort(([a], [z]) => (a < z ? -1 : a > z ? 1 : 0))) {
    if (b >= GROUP_MIN_BYTES) groups[g] = Math.ceil(b / SHARD_TARGET_BYTES);
    else miscBytes += b;
  }
  const index: LocaleIndex = {
    v: 1,
    build_id: buildId,
    lang,
    gen,
    count: keys.length,
    groups,
    misc: Math.max(1, Math.ceil(miscBytes / SHARD_TARGET_BYTES)),
  };
  const shards = new Map<string, Record<string, string>>();
  for (const k of keys) {
    const name = shardFor(index, k);
    let shard = shards.get(name);
    if (!shard) shards.set(name, (shard = {}));
    shard[k] = entries[k];
  }
  return { index, shards };
}

export function localeDir(buildId: string, lang: string): string {
  return `${LOCALE_ROOT}/${buildId}/${lang}/`;
}

export function indexKey(buildId: string, lang: string): string {
  return `${localeDir(buildId, lang)}index.json`;
}

export function shardKey(buildId: string, lang: string, gen: string, shard: string): string {
  return `${localeDir(buildId, lang)}${gen}/${shard}.json`;
}

/** A new publish generation: base-36 milliseconds, lower-case [0-9a-z]. */
export function newGen(now = Date.now()): string {
  return now.toString(36);
}

/** True when `v` is an index this code can read for the given build and language. */
export function isLocaleIndex(v: unknown, buildId: string, lang: string): v is LocaleIndex {
  const i = v as LocaleIndex | null;
  return !!i && i.v === 1 && i.build_id === buildId && i.lang === lang &&
    typeof i.gen === 'string' && /^[0-9a-z]{6,16}$/.test(i.gen) &&
    Number.isInteger(i.count) && Number.isInteger(i.misc) && i.misc >= 1 &&
    !!i.groups && typeof i.groups === 'object';
}
