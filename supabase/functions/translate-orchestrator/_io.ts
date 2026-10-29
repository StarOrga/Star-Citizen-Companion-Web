// R2 access for the orchestrator: locale tables (read through the ingest-catalog shard
// layout, imported not copied), the translation memory and the delivery overlay.

import { indexKey, isLocaleIndex, MISC_GROUP, shardKey } from '../ingest-catalog/_locale-shards.ts';
import type { TmEntry } from './_diff.ts';

export interface Store {
  /** Parsed JSON, or null when the object does not exist. */
  getJson(key: string): Promise<unknown | null>;
  putJson(key: string, value: unknown): Promise<void>;
  deleteKey(key: string): Promise<void>;
}

const READ_CONCURRENCY = 12;

export async function inPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

/** One build's table for one language, all shards merged; {} when the language was not published. */
export async function readLocaleTable(store: Store, buildId: string, lang: string): Promise<Record<string, string>> {
  const index = await store.getJson(indexKey(buildId, lang));
  if (!isLocaleIndex(index, buildId, lang)) return {};
  const names: string[] = [];
  for (const [g, n] of Object.entries(index.groups)) for (let i = 0; i < n; i++) names.push(`${g}-${i}`);
  for (let i = 0; i < index.misc; i++) names.push(`${MISC_GROUP}-${i}`);
  const out: Record<string, string> = {};
  await inPool(names, READ_CONCURRENCY, async (name) => {
    const shard = await store.getJson(shardKey(buildId, lang, index.gen, name));
    if (shard && typeof shard === 'object') Object.assign(out, shard as Record<string, string>);
  });
  return out;
}

// ── translation memory: translation-tm/<lang>/index.json + <hh>.json (first two hash chars) ──

export const tmIndexKey = (lang: string) => `translation-tm/${lang}/index.json`;
export const tmShardKey = (lang: string, hh: string) => `translation-tm/${lang}/${hh}.json`;
const HEX2 = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export async function loadTm(store: Store, lang: string): Promise<Record<string, TmEntry>> {
  const index = await store.getJson(tmIndexKey(lang)) as { shards?: string[] } | null;
  const names = index?.shards ?? [];
  const tm: Record<string, TmEntry> = {};
  await inPool(names, READ_CONCURRENCY, async (hh) => {
    const shard = await store.getJson(tmShardKey(lang, hh));
    if (shard && typeof shard === 'object') Object.assign(tm, shard as Record<string, TmEntry>);
  });
  return tm;
}

/** Read-modify-write of only the touched shards, then the index (idempotent for the same updates). */
export async function saveTm(store: Store, lang: string, updates: Record<string, TmEntry>): Promise<number> {
  const byShard = new Map<string, Record<string, TmEntry>>();
  for (const [h, e] of Object.entries(updates)) {
    const hh = h.slice(0, 2);
    if (!HEX2.includes(hh)) continue;
    let s = byShard.get(hh);
    if (!s) byShard.set(hh, (s = {}));
    s[h] = e;
  }
  const index = await store.getJson(tmIndexKey(lang)) as { shards?: string[]; count?: number } | null;
  const known = new Set(index?.shards ?? []);
  let added = 0;
  await inPool([...byShard], READ_CONCURRENCY, async ([hh, upd]) => {
    const cur = (await store.getJson(tmShardKey(lang, hh)) ?? {}) as Record<string, TmEntry>;
    for (const h of Object.keys(upd)) if (!(h in cur)) added++;
    await store.putJson(tmShardKey(lang, hh), { ...cur, ...upd });
    known.add(hh);
  });
  await store.putJson(tmIndexKey(lang), {
    v: 1,
    lang,
    shards: [...known].sort(),
    count: (index?.count ?? 0) + added,
    updated_at: new Date().toISOString(),
  });
  return added;
}

// ── overlay ──

export interface Overlay {
  v: 1;
  lang: string;
  build_id: string;
  generated_at: string;
  count: number;
  entries: Record<string, { h: string; t: string }>;
}

export const overlayKey = (lang: string, buildOrLatest: string) => `translation-overlay/${lang}/${buildOrLatest}.json`;

export function makeOverlay(
  lang: string,
  buildId: string,
  entries: Record<string, { h: string; t: string }>,
  at: string,
): Overlay {
  return { v: 1, lang, build_id: buildId, generated_at: at, count: Object.keys(entries).length, entries };
}

// ── work files of one job ──

export const workKey = (jobId: string, name: string) => `translation-work/${jobId}/${name}.json`;
