// Community global.ini packs: parsing and source resolution (concept 2026-11-08).
// Plain, erasable TypeScript (node --test + Deno). Memory: packs are ~12 MB, so a pack is decoded
// ONCE, parsed line by line into a Map and the bytes are dropped by the caller. A zip is only
// inflated for its one entry (fflate `filter`).

export interface ParsedPack {
  /** normalised key → value (the Frontend_PU_Version header line is NOT in here). */
  map: Map<string, string>;
  /** Value of the first `Frontend_PU_Version=…` line (the pack's attribution), or null. */
  header: string | null;
  /** Lines that carried a `key=value` pair. */
  lines: number;
}

/** Lower-cased key without the trailing `,P` marker some packs carry. */
export function normalizeKey(k: string): string {
  let key = k.trim().toLowerCase();
  if (key.endsWith(',p')) key = key.slice(0, -2);
  return key;
}

/** UTF-8 (with/without BOM) and UTF-16 LE/BE (BOM, or NUL-heavy start) tolerant decode. */
export function decodeIni(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.length >= 4 && bytes[1] === 0 && bytes[3] === 0 && bytes[0] !== 0) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  return new TextDecoder('utf-8').decode(bytes);
}

const HEADER_KEY = 'frontend_pu_version';

/** `key=value` per line; later duplicates win; no regex over the whole text, no line array. */
export function parseIni(text: string): ParsedPack {
  const map = new Map<string, string>();
  let header: string | null = null;
  let lines = 0;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  while (pos < n) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = n;
    let stop = end;
    if (stop > pos && text.charCodeAt(stop - 1) === 13) stop--;
    const eq = text.indexOf('=', pos);
    if (eq !== -1 && eq < stop && eq > pos) {
      const key = normalizeKey(text.slice(pos, eq));
      const value = text.slice(eq + 1, stop);
      if (key) {
        lines++;
        if (key === HEADER_KEY) {
          if (header === null) header = value;
        } else map.set(key, value);
      }
    }
    pos = end + 1;
  }
  return { map, header, lines };
}

export function parsePack(bytes: Uint8Array): ParsedPack {
  return parseIni(decodeIni(bytes));
}

// ── source resolution ──

export type Resolver =
  | { kind: 'github-release'; owner: string; repo: string; asset: string }
  | { kind: 'zip-entry'; path: string };

/** `github-release:<owner>/<repo>:<asset>` · `zip-entry:<path>`; null when malformed. */
export function parseResolver(r: string | null | undefined): Resolver | null {
  if (!r) return null;
  if (r.startsWith('zip-entry:')) {
    const path = r.slice('zip-entry:'.length);
    return path && !path.includes('..') ? { kind: 'zip-entry', path } : null;
  }
  const m = /^github-release:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+):(.+)$/.exec(r);
  return m ? { kind: 'github-release', owner: m[1], repo: m[2], asset: m[3] } : null;
}

/** raw.githubusercontent.com/<owner>/<repo>/<branch>/<path> → parts (for the commits API). */
export function parseRawGithub(url: string): { owner: string; repo: string; branch: string; path: string } | null {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url);
  if (!m) return null;
  let path = m[4];
  try {
    path = decodeURIComponent(path);
  } catch { /* keep as is */ }
  return { owner: m[1], repo: m[2], branch: m[3], path };
}

export interface PackSource {
  id: string;
  raw_url: string | null;
  resolver: string | null;
}

export interface ResolvedPack {
  bytes: Uint8Array;
  /** Version marker of what was fetched (release tag, ETag …), best effort. */
  token: string | null;
  url: string;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const MAX_INI_BYTES = 40 * 1024 * 1024;
export const MAX_ZIP_BYTES = 120 * 1024 * 1024;

const GH_HEADERS = (token?: string): Record<string, string> => ({
  accept: 'application/vnd.github+json',
  'user-agent': 'sc-companion-translation',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) throw new Error('translate.source_too_large');
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > max) throw new Error('translate.source_too_large');
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new Error('translate.source_too_large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

async function getBytes(f: FetchFn, url: string, max: number, headers?: Record<string, string>): Promise<{ bytes: Uint8Array; res: Response }> {
  const res = await f(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`translate.source_fetch_${res.status}`);
  return { bytes: await readCapped(res, max), res };
}

export interface LatestRelease {
  tag: string;
  assetUrl: string;
  assetUpdated: string | null;
}

export async function latestRelease(f: FetchFn, r: Extract<Resolver, { kind: 'github-release' }>, ghToken?: string): Promise<LatestRelease> {
  const res = await f(`https://api.github.com/repos/${r.owner}/${r.repo}/releases/latest`, {
    headers: GH_HEADERS(ghToken),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`translate.source_fetch_${res.status}`);
  const rel = await res.json() as { tag_name?: string; assets?: { name: string; browser_download_url: string; updated_at?: string }[] };
  const asset = (rel.assets ?? []).find((a) => a.name === r.asset);
  if (!asset) throw new Error('translate.source_asset_missing');
  return { tag: String(rel.tag_name ?? ''), assetUrl: asset.browser_download_url, assetUpdated: asset.updated_at ?? null };
}

/** Extracts one entry of a zip; only that entry is inflated. fflate is loaded lazily (tests never need it). */
export type UnzipFn = (zip: Uint8Array, opts: { filter: (f: { name: string }) => boolean }) => Record<string, Uint8Array>;

/** `unzip` is injectable so tests can pass a node-side reader; the default is fflate (Deno `npm:`). */
export async function unzipEntry(zip: Uint8Array, path: string, unzip?: UnzipFn): Promise<Uint8Array> {
  const unzipSync: UnzipFn = unzip ?? (await import('npm:fflate@0.8.2')).unzipSync;
  const files = unzipSync(zip, { filter: (f: { name: string }) => f.name === path });
  const hit = files[path];
  if (!hit) throw new Error('translate.source_entry_missing');
  return hit;
}

/** Fetches the bytes of one source's global.ini (raw url · latest release asset · zip entry). */
export async function resolveSource(src: PackSource, f: FetchFn = fetch, ghToken?: string, unzip?: UnzipFn): Promise<ResolvedPack> {
  const r = parseResolver(src.resolver);
  if (src.resolver && !r) throw new Error('translate.source_resolver_invalid');
  if (r?.kind === 'github-release') {
    const rel = await latestRelease(f, r, ghToken);
    const { bytes } = await getBytes(f, rel.assetUrl, MAX_INI_BYTES, GH_HEADERS(ghToken));
    return { bytes, token: `${rel.tag}@${rel.assetUpdated ?? ''}`, url: rel.assetUrl };
  }
  if (!src.raw_url) throw new Error('translate.source_no_url');
  if (r?.kind === 'zip-entry') {
    const { bytes, res } = await getBytes(f, src.raw_url, MAX_ZIP_BYTES);
    const entry = await unzipEntry(bytes, r.path, unzip);
    return { bytes: entry, token: res.headers.get('etag') ?? res.headers.get('last-modified'), url: src.raw_url };
  }
  const { bytes, res } = await getBytes(f, src.raw_url, MAX_INI_BYTES);
  return { bytes, token: res.headers.get('etag'), url: src.raw_url };
}

/**
 * Cheap upstream version marker for the daily sync (no pack download):
 * raw GitHub file → newest commit sha touching the path · release → tag@asset time ·
 * zip / other → ETag or Last-Modified of a HEAD request. null when nothing can be learned.
 */
export async function upstreamToken(src: PackSource, f: FetchFn = fetch, ghToken?: string): Promise<string | null> {
  const r = parseResolver(src.resolver);
  if (r?.kind === 'github-release') {
    const rel = await latestRelease(f, r, ghToken);
    return `${rel.tag}@${rel.assetUpdated ?? ''}`;
  }
  if (!src.raw_url) return null;
  const gh = r ? null : parseRawGithub(src.raw_url);
  if (gh) {
    const q = new URLSearchParams({ path: gh.path, sha: gh.branch, per_page: '1' });
    const res = await f(`https://api.github.com/repos/${gh.owner}/${gh.repo}/commits?${q}`, {
      headers: GH_HEADERS(ghToken),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`translate.source_fetch_${res.status}`);
    const list = await res.json() as { sha?: string }[];
    return list[0]?.sha ?? null;
  }
  const head = await f(src.raw_url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!head.ok) throw new Error(`translate.source_fetch_${head.status}`);
  return head.headers.get('etag') ?? head.headers.get('last-modified');
}
