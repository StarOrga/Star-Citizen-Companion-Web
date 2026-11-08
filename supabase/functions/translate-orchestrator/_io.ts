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

export interface OverlaySource {
  id: string;
  name: string;
  url: string;
  /** SPDX-ish licence of the source text. */
  license: string;
  /** Plain credit name shown in the attribution line. */
  attribution: string;
}

export interface Overlay {
  v: 1;
  lang: string;
  build_id: string;
  generated_at: string;
  count: number;
  entries: Record<string, { h: string; t: string }>;
  /** Every source that contributed at least one entry (+ 'scc-ai' when AI entries exist). */
  sources: OverlaySource[];
  /** One uniform credit line (de text for de, en text otherwise). */
  attribution: string;
  /** Data/Localization/<folder> the app writes into; null = the app's own mapping. */
  game_folder: string | null;
  /** false when the folder's CIG table is a different language (ru in the korean slot). */
  use_cig_table: boolean;
}

export type OverlayMeta = Partial<Pick<Overlay, 'sources' | 'attribution' | 'game_folder' | 'use_cig_table'>>;

export const overlayKey = (lang: string, buildOrLatest: string) => `translation-overlay/${lang}/${buildOrLatest}.json`;

/** Overlay v1 + the additive source/attribution fields; `meta` is optional (older callers). */
export function makeOverlay(
  lang: string,
  buildId: string,
  entries: Record<string, { h: string; t: string }>,
  at: string,
  meta: OverlayMeta = {},
): Overlay {
  return {
    v: 1,
    lang,
    build_id: buildId,
    generated_at: at,
    count: Object.keys(entries).length,
    entries,
    sources: meta.sources ?? [],
    attribution: meta.attribution ?? '',
    game_folder: meta.game_folder ?? null,
    use_cig_table: meta.use_cig_table ?? true,
  };
}

export interface SourceMetaRow {
  id: string;
  lang: string;
  name: string;
  repo_url: string | null;
  license: string;
  license_kind: string;
  attribution: string;
  game_folder: string | null;
  use_cig_table: boolean;
  enabled: boolean;
  status: string;
}

/** Source id of the AI contribution in `sources`. */
export const AI_SOURCE_ID = 'scc-ai';
const NC_SA = 'CC-BY-NC-SA-4.0';

/**
 * Uniform credit line, the same form for every language (d2-license note); only the words
 * follow the target language: `Community-Übersetzung: A, B (MIT) · KI-Ergänzung: SC Companion`.
 */
export function attributionLine(lang: string, sources: OverlaySource[]): string {
  const de = lang === 'de';
  const community = sources.filter((s) => s.id !== AI_SOURCE_ID);
  const parts: string[] = [];
  if (community.length) {
    const names = community.map((s) => s.attribution || s.name).join(', ');
    const lics = [...new Set(community.map((s) => s.license).filter(Boolean))].join(', ');
    parts.push(`${de ? 'Community-Übersetzung' : 'Community translation'}: ${names}${lics ? ` (${lics})` : ''}`);
  }
  if (sources.some((s) => s.id === AI_SOURCE_ID)) parts.push(`${de ? 'KI-Ergänzung' : 'AI supplement'}: SC Companion`);
  return parts.join(' · ');
}

/**
 * sources / attribution / game_folder / use_cig_table for one language's overlay.
 * `tm` is only read for the entries' hashes (`src` of community entries, `o` of the rest).
 * An NC-SA contribution makes the whole overlay CC-BY-NC-SA 4.0 (SCC stays free for it).
 */
export function buildOverlayMeta(
  lang: string,
  entries: Record<string, { h: string; t: string }>,
  tm: Record<string, { o: string; src?: string }>,
  sourceRows: SourceMetaRow[],
): Required<OverlayMeta> {
  const used = new Set<string>();
  let ai = false;
  for (const e of Object.values(entries)) {
    const hit = tm[e.h];
    if (!hit) continue;
    if (hit.o === 'community' && hit.src) used.add(hit.src);
    else if (hit.o === 'ai') ai = true;
  }
  const rows = sourceRows.filter((r) => r.lang === lang);
  const contributing = rows.filter((r) => used.has(r.id)).sort((a, b) => a.id.localeCompare(b.id));
  const nc = contributing.some((r) => r.license_kind === 'nc_sa');
  const sources: OverlaySource[] = contributing.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.repo_url ?? '',
    license: r.license,
    attribution: r.attribution || r.name,
  }));
  if (ai) {
    sources.push({
      id: AI_SOURCE_ID,
      name: 'SC Companion KI',
      url: 'https://sc-companion.vercel.app',
      license: nc ? NC_SA : 'SC Companion',
      attribution: 'SC Companion',
    });
  }
  // Folder and CIG-table flag come from the contributing source, else from any usable source.
  const usable = rows.filter((r) => r.enabled && (r.status === 'licensed' || r.status === 'permitted'));
  const ref = contributing[0] ?? usable[0];
  return {
    sources,
    attribution: attributionLine(lang, sources),
    game_folder: ref?.game_folder ?? null,
    use_cig_table: ref ? ref.use_cig_table : true,
  };
}

// ── work files of one job ──

export const workKey = (jobId: string, name: string) => `translation-work/${jobId}/${name}.json`;
