// supabase/functions/starscape-summary
// -----------------------------------------------------------------------
// Public edge function that renders a cinematic, SCC-branded PNG wallpaper
// summarizing THIS WEEK's Verse News. Consumed by the Starscape desktop
// wallpaper app as the first wallpaper shown after PC boot.
//
// Pipeline: fetch-verse-news (JSON) → pick up to `count` items → inline
// each item's hero/thumbnail image as a base64 data: URI (SVG can't fetch
// remote urls) → build SVG (summary-svg.ts, pure/shared with the Node
// preview harness) → rasterize to PNG via @resvg/resvg-wasm.
//
// verify_jwt = false (public, unauthenticated — see supabase/config.toml).
// -----------------------------------------------------------------------

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { Buffer } from 'node:buffer';
import { Resvg, initWasm } from 'npm:@resvg/resvg-wasm@2.6.2';
import { buildSummarySvg, type SummaryItem } from './summary-svg.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const RSI_REFERER = 'https://robertsspaceindustries.com/';
const IMG_FETCH_TIMEOUT_MS = 6000;
const NEWS_FETCH_TIMEOUT_MS = 8000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type VerseChannel = 'comm-link' | 'spectrum' | 'status' | 'patch' | 'youtube';

interface VerseNewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  channel: VerseChannel;
  thumbnail?: string;
  images?: string[];
  category?: string;
  source: string;
}

// ---------------------------------------------------------------------
// Fonts — loaded once at module scope (cold-start cost only).
// The `new URL('./fonts/…', import.meta.url)` args are kept as STRING
// LITERALS on purpose: the Supabase deploy bundler only statically
// detects (and therefore includes) referenced files when the path is a
// literal — a dynamic `./fonts/${name}` would deploy without the TTFs and
// the function would fail closed to the plain-text fallback.
// ---------------------------------------------------------------------
const fontsPromise = Promise.all([
  Deno.readFile(new URL('./fonts/Orbitron-700.ttf', import.meta.url)),
  Deno.readFile(new URL('./fonts/Orbitron-500.ttf', import.meta.url)),
  Deno.readFile(new URL('./fonts/Rajdhani-500.ttf', import.meta.url)),
  Deno.readFile(new URL('./fonts/Rajdhani-600.ttf', import.meta.url)),
]);

// ---------------------------------------------------------------------
// resvg-wasm — the npm wrapper ships its own .wasm as a package subpath,
// which Deno's npm-specifier resolution doesn't expose as a readable local
// file inside the Edge Runtime sandbox. Fetching the exact pinned version
// from a CDN at cold start is the standard workaround for wasm bindings.
// ---------------------------------------------------------------------
const RESVG_WASM_URL = 'https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm';
let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = fetch(RESVG_WASM_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`resvg wasm fetch HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => initWasm(buf));
  }
  return wasmReady;
}

// ---------------------------------------------------------------------
// Verse news fetch + selection
// ---------------------------------------------------------------------
async function fetchVerseNews(): Promise<VerseNewsItem[]> {
  const endpoint = `${SUPABASE_URL}/functions/v1/fetch-verse-news`;
  const attempt = async (key: string) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), NEWS_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const json = await res.json();
      return Array.isArray(json?.news) ? (json.news as VerseNewsItem[]) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  if (ANON_KEY) {
    const news = await attempt(ANON_KEY);
    if (news) return news;
  }
  if (SERVICE_KEY) {
    const news = await attempt(SERVICE_KEY);
    if (news) return news;
  }
  return [];
}

function hasImage(it: VerseNewsItem): boolean {
  return !!(it.thumbnail || it.images?.length);
}

function itemImageUrl(it: VerseNewsItem): string | undefined {
  return it.thumbnail ?? it.images?.[0];
}

// Prefer comm-link (fallback patch) items with a usable image, published
// within the last 7 days; backfill with the most recent items overall if
// fewer than `count` qualify. Final list is newest-first.
function selectItems(news: VerseNewsItem[], count: number): VerseNewsItem[] {
  const now = Date.now();
  const withImages = news.filter(hasImage);
  const preferred = withImages
    .filter((it) => it.channel === 'comm-link' || it.channel === 'patch')
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const thisWeek = preferred.filter((it) => now - Date.parse(it.publishedAt) <= WEEK_MS);
  const selected: VerseNewsItem[] = thisWeek.slice(0, count);
  const seen = new Set(selected.map((it) => it.id));

  if (selected.length < count) {
    const backfillPool = [
      ...preferred,
      ...withImages.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)),
    ];
    for (const it of backfillPool) {
      if (selected.length >= count) break;
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      selected.push(it);
    }
  }

  return selected.slice(0, count).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

// ---------------------------------------------------------------------
// Image inlining — SVG (and resvg) can't fetch remote urls, so every hero
// / thumbnail image is downloaded server-side and embedded as base64.
// ---------------------------------------------------------------------
async function fetchImageAsDataUri(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), IMG_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Referer: RSI_REFERER, 'User-Agent': 'sc-companion/1.0 (+starscape-summary)' },
      signal: ctrl.signal,
    });
    if (!res.ok) return undefined;
    const contentType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return undefined;
    const b64 = Buffer.from(bytes).toString('base64');
    return `data:${contentType};base64,${b64}`;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------
// Week label — Monday..Sunday of the current UTC week, e.g. "WEEK OF JUL 14–20".
// ---------------------------------------------------------------------
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function computeWeekLabel(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  if (monday.getUTCMonth() === sunday.getUTCMonth()) {
    return `WEEK OF ${MONTHS[monday.getUTCMonth()]} ${monday.getUTCDate()}–${sunday.getUTCDate()}`;
  }
  return `WEEK OF ${MONTHS[monday.getUTCMonth()]} ${monday.getUTCDate()} – ${MONTHS[sunday.getUTCMonth()]} ${sunday.getUTCDate()}`;
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  const v = Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, v));
}

async function renderPng(svg: string, width: number): Promise<Uint8Array> {
  await ensureWasm();
  const [orbitron700, orbitron500, rajdhani500, rajdhani600] = await fontsPromise;
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontBuffers: [orbitron700, orbitron500, rajdhani500, rajdhani600],
      defaultFontFamily: 'Rajdhani',
      loadSystemFonts: false,
    },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

async function buildFallbackPng(width: number, height: number): Promise<Uint8Array> {
  const svg = buildSummarySvg([], { width, height, weekLabel: computeWeekLabel() });
  return renderPng(svg, width);
}

function pngResponse(bytes: Uint8Array): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const width = clampInt(url.searchParams.get('w'), 1920, 640, 3840);
  const height = clampInt(url.searchParams.get('h'), 1080, 360, 2160);
  const count = clampInt(url.searchParams.get('count'), 5, 1, 6);

  try {
    const news = await fetchVerseNews();
    const selected = selectItems(news, count);

    const [heroDataUri, ...thumbDataUris] = await Promise.all(
      selected.map((it) => fetchImageAsDataUri(itemImageUrl(it))),
    );

    const items: SummaryItem[] = selected.map((it) => ({
      title: it.title,
      channel: it.channel,
      category: it.category,
      publishedAt: it.publishedAt,
    }));

    const svg = buildSummarySvg(items, {
      width,
      height,
      weekLabel: computeWeekLabel(),
      heroDataUri,
      thumbDataUris,
    });

    const png = await renderPng(svg, width);
    return pngResponse(png);
  } catch (err) {
    console.error('starscape-summary failed, serving fallback:', err);
    try {
      const png = await buildFallbackPng(width, height);
      return pngResponse(png);
    } catch (fallbackErr) {
      console.error('starscape-summary fallback render also failed:', fallbackErr);
      return new Response('starscape-summary unavailable', { status: 200, headers: CORS_HEADERS });
    }
  }
});
