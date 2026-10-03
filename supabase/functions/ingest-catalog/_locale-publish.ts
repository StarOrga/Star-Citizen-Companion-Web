// Publishes one build's localization strings from codex_locale_strings to R2
// (layout: _locale-shards.ts). The uploader still sends the strings in row
// chunks (`locale_strings` op), so the table is the staging area during an
// ingest; `finalize` and the `locale_publish` op turn it into shards here.
//
// Order per language, each step only after the previous one succeeded:
//   1. export the rows (one RPC, a single jsonb — no 1 000-row cap)
//   2. PUT every shard, then the index (the index is the switch for clients)
//   3. read the index back through the PUBLIC Worker: proves the read path
//      serves this generation, not just that R2 accepted the write
//   4. delete older generations of this language
//   5. only with deleteSource and a verified read-back: delete the rows
// A failure anywhere leaves the rows in place, and the client keeps reading
// them from the database (it only switches when the index exists).

import {
  buildShards,
  indexKey,
  isLocaleIndex,
  localeDir,
  newGen,
  shardKey,
} from './_locale-shards.ts';

export interface PublishDeps {
  /** All keys of one language of the build as one object. */
  exportLang(buildId: string, lang: string): Promise<Record<string, string>>;
  putJson(key: string, body: string): Promise<void>;
  /** The object as served by the public Worker, parsed; null on any miss. */
  readPublic(key: string): Promise<unknown>;
  listKeys(prefix: string): Promise<string[]>;
  deleteKey(key: string): Promise<void>;
  /** Deletes the build's rows of one language, returns how many went. */
  deleteRows(buildId: string, lang: string): Promise<number>;
  now?(): number;
}

export interface PublishResult {
  lang: string;
  count: number;
  shards: number;
  bytes: number;
  gen: string | null;
  verified: boolean;
  deleted: number;
  removed_objects: number;
}

const PUT_CONCURRENCY = 8;

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

export async function publishLocale(
  deps: PublishDeps,
  buildId: string,
  lang: string,
  opts: { deleteSource: boolean },
): Promise<PublishResult> {
  const entries = await deps.exportLang(buildId, lang);
  const count = Object.keys(entries).length;
  const empty: PublishResult = {
    lang, count: 0, shards: 0, bytes: 0, gen: null, verified: false, deleted: 0, removed_objects: 0,
  };
  if (count === 0) return empty;

  const gen = newGen(deps.now ? deps.now() : Date.now());
  const { index, shards } = buildShards(buildId, lang, gen, entries);
  let bytes = 0;
  const bodies: [string, string][] = [];
  for (const [name, shard] of shards) {
    const body = JSON.stringify(shard);
    bytes += body.length;
    bodies.push([shardKey(buildId, lang, gen, name), body]);
  }
  await inPool(bodies, PUT_CONCURRENCY, ([key, body]) => deps.putJson(key, body));
  const idxKey = indexKey(buildId, lang);
  await deps.putJson(idxKey, JSON.stringify(index));

  // Read-back through the public path: the index AND one shard must come back.
  const served = await deps.readPublic(idxKey);
  let verified = isLocaleIndex(served, buildId, lang) && served.gen === gen && served.count === count;
  if (verified) {
    const [sampleKey, sampleBody] = bodies[0];
    const sample = await deps.readPublic(sampleKey);
    verified = !!sample && JSON.stringify(sample) === sampleBody;
  }

  // Older generations: everything under the language dir except this gen and the index.
  const dir = localeDir(buildId, lang);
  const keep = `${dir}${gen}/`;
  const stale = (await deps.listKeys(dir)).filter((k) => k !== idxKey && !k.startsWith(keep));
  await inPool(stale, PUT_CONCURRENCY, (k) => deps.deleteKey(k));

  const deleted = opts.deleteSource && verified ? await deps.deleteRows(buildId, lang) : 0;
  return { lang, count, shards: bodies.length, bytes, gen, verified, deleted, removed_objects: stale.length };
}
