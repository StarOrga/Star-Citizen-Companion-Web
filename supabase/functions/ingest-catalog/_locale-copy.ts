// Copies one build's published R2 locale strings to another build's prefix
// (layout: _locale-shards.ts). Used when a re-upload of the same game build
// skipped the strings: the new build must serve the predecessor's strings from
// the moment it goes live, under its own id (the client, the translation
// pipeline and locale_gc all key on the build id).
//
// Order per language: every shard first, the index last (the index is the
// switch for clients), then a read-back of the index through the public path.
// A language whose target index already names a valid generation is skipped,
// so a retried finalize does not copy twice.

import { BUILD_ID_RE, indexKey, isLocaleIndex, LOCALE_ROOT, localeDir, shardKey } from './_locale-shards.ts';

export interface CopyDeps {
  listKeys(prefix: string): Promise<string[]>;
  /** The object as served by the public Worker, parsed; null on any miss. */
  readPublic(key: string): Promise<unknown>;
  putJson(key: string, body: string): Promise<void>;
}

export interface CopyResult {
  lang: string;
  status: 'copied' | 'exists' | 'no_source' | 'incomplete';
  shards: number;
  verified: boolean;
}

const COPY_CONCURRENCY = 8;

async function inPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** The languages a build has an index for, from a key listing of its prefix. */
export function langsOf(keys: readonly string[], buildId: string): string[] {
  const head = `${LOCALE_ROOT}/${buildId}/`;
  const langs = new Set<string>();
  for (const k of keys) {
    if (!k.startsWith(head) || !k.endsWith('/index.json')) continue;
    const lang = k.slice(head.length, -'/index.json'.length);
    if (lang && !lang.includes('/')) langs.add(lang);
  }
  return [...langs].sort();
}

export async function copyBuildLocales(deps: CopyDeps, fromId: string, toId: string): Promise<CopyResult[]> {
  if (!BUILD_ID_RE.test(fromId) || !BUILD_ID_RE.test(toId) || fromId === toId) {
    throw new Error('copyBuildLocales: two different build uuids required');
  }
  const keys = await deps.listKeys(`${LOCALE_ROOT}/${fromId}/`);
  const results: CopyResult[] = [];
  for (const lang of langsOf(keys, fromId)) {
    const existing = await deps.readPublic(indexKey(toId, lang));
    if (isLocaleIndex(existing, toId, lang)) {
      results.push({ lang, status: 'exists', shards: 0, verified: true });
      continue;
    }
    const index = await deps.readPublic(indexKey(fromId, lang));
    if (!isLocaleIndex(index, fromId, lang)) {
      results.push({ lang, status: 'no_source', shards: 0, verified: false });
      continue;
    }
    const genDir = `${localeDir(fromId, lang)}${index.gen}/`;
    const shardNames = keys.filter((k) => k.startsWith(genDir)).map((k) => k.slice(genDir.length).replace(/\.json$/, ''));
    let missing = false;
    await inPool(shardNames, COPY_CONCURRENCY, async (name) => {
      const body = await deps.readPublic(shardKey(fromId, lang, index.gen, name));
      if (body === null || body === undefined) {
        missing = true;
        return;
      }
      await deps.putJson(shardKey(toId, lang, index.gen, name), JSON.stringify(body));
    });
    // Never publish an index that points at shards we could not copy.
    if (missing || shardNames.length === 0) {
      results.push({ lang, status: 'incomplete', shards: shardNames.length, verified: false });
      continue;
    }
    await deps.putJson(indexKey(toId, lang), JSON.stringify({ ...index, build_id: toId }));
    const served = await deps.readPublic(indexKey(toId, lang));
    const verified = isLocaleIndex(served, toId, lang) && served.gen === index.gen;
    results.push({ lang, status: 'copied', shards: shardNames.length, verified });
  }
  return results;
}
