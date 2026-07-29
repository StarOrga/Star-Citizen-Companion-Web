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
import {
  imageCandidates,
  selectBestImage,
  type FetchedImage,
  type ImageFetcher,
} from './image-select.ts';
import { Orbitron_700, Orbitron_500, Rajdhani_500, Rajdhani_600 } from './fonts.ts';

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
// Budget for the whole news step, SHARED by both key attempts. It used to be a
// per-attempt 8s, so one slow upstream burned 16s and the wallpaper app's 12s
// boot gate had already given up — and because a timed-out fetch is
// indistinguishable from "no news", the render silently degraded to the empty
// "No Verse News this week" card instead of failing loudly.
const NEWS_FETCH_BUDGET_MS = 9000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Cap the rasterization width. resvg-wasm's render buffers scale with output size
// and blow the edge-runtime memory limit (WORKER_RESOURCE_LIMIT) at ≥2560px wide.
// The SVG viewBox stays at the requested w×h (layout/aspect unchanged) — only the
// pixel raster is capped; the wallpaper is cover-fit scaled to the screen anyway,
// so a 1440p/4K display just upscales this crisp-enough background imperceptibly.
const MAX_RENDER_WIDTH = 1920;

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
// Fonts — embedded as base64 in fonts.ts, part of the JS import graph so
// `supabase functions deploy` ALWAYS bundles them. Deno.readFile of static
// asset files is NOT included by the deploy bundler; the previous
// module-scope Promise.all(readFile(...)) rejected unhandled at boot and
// 503'd the whole isolate. Decoded synchronously here — nothing to reject.
// ---------------------------------------------------------------------
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const FONT_BUFFERS: Uint8Array[] = [
  b64ToBytes(Orbitron_700),
  b64ToBytes(Orbitron_500),
  b64ToBytes(Rajdhani_500),
  b64ToBytes(Rajdhani_600),
];

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
  const deadline = Date.now() + NEWS_FETCH_BUDGET_MS;

  const attempt = async (key: string) => {
    const left = deadline - Date.now();
    if (left <= 0) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), left);
    try {
      const res = await fetch(endpoint, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        console.error(`fetch-verse-news HTTP ${res.status}`);
        return null;
      }
      const json = await res.json();
      return Array.isArray(json?.news) ? (json.news as VerseNewsItem[]) : null;
    } catch (err) {
      console.error('fetch-verse-news request failed:', err);
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
// Peak memory, not bandwidth, is the constraint: every accepted image is held
// as raw bytes AND as a base64 data: URI AND decoded inside the resvg wasm
// heap. Five full-resolution sources at once is WORKER_RESOURCE_LIMIT, and the
// bucket still serves plenty of those — pre-#295 `cover.<ext>` objects that the
// compaction backfill has not rewritten into a ladder yet. So each role caps
// what it will accept and `selectBestImage` simply moves to the next candidate;
// an item with nothing small enough falls back to the branded placeholder,
// which is a far better outcome than a 546 and no wallpaper at all.
const HERO_MAX_BYTES = 3_000_000;
const THUMB_MAX_BYTES = 600_000;

function makeImageFetcher(maxBytes: number): ImageFetcher {
  return async (url: string): Promise<FetchedImage | undefined> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), IMG_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Referer: RSI_REFERER, 'User-Agent': 'sc-companion/1.0 (+starscape-summary)' },
        signal: ctrl.signal,
      });
      if (!res.ok) return undefined;
      const declared = Number(res.headers.get('content-length') ?? NaN);
      if (Number.isFinite(declared) && declared > maxBytes) return undefined;
      const contentType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length || bytes.length > maxBytes) return undefined;
      return { bytes, contentType };
    } catch {
      return undefined;
    } finally {
      clearTimeout(t);
    }
  };
}

function toDataUri(img: FetchedImage): string {
  return `data:${img.contentType};base64,${Buffer.from(img.bytes).toString('base64')}`;
}

// ---------------------------------------------------------------------
// Variant sizing — cached artwork advertises its whole ladder in the url
// (`…/<hash>/w<N>.<ext>`, the scheme mirrored in
// src/app/news/news-image-variants.ts). Asking for the top rung everywhere was
// what made this function fall over the moment it had real content to draw:
// five ≤1600px images inlined as base64 AND decoded into the resvg heap at once
// is WORKER_RESOURCE_LIMIT at a 1920px render. The strip paints ~120px boxes,
// so a 400px rung is already generous there.
// ---------------------------------------------------------------------
const RUNG_WIDTHS = [400, 800];
const VARIANT_URL_RE = /^(https?:\/\/.+\/)w(\d+)(\.[a-zA-Z0-9]+)$/;
const HERO_MAX_WIDTH = 800; // full-bleed background
const THUMB_MAX_WIDTH = 400; // ~120px box in the strip

/** Largest stored rung no wider than `maxWidth`; non-ladder urls pass through. */
function variantAtMost(url: string, maxWidth: number): string {
  const m = VARIANT_URL_RE.exec(url);
  if (!m) return url;
  const top = Number(m[2]);
  if (!Number.isFinite(top) || top <= 0) return url; // w0 = single opaque object
  const rungs = [...RUNG_WIDTHS.filter((w) => w < top), top];
  const pick = rungs.filter((w) => w <= maxWidth).pop() ?? rungs[0];
  return `${m[1]}w${pick}${m[3]}`;
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
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.min(width, MAX_RENDER_WIDTH) },
    font: {
      fontBuffers: FONT_BUFFERS,
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
    // The empty card is a legitimate render, so it never threw and nothing in
    // the logs said the wallpaper had gone blank. Say it out loud.
    if (!selected.length) {
      console.error(`starscape-summary: EMPTY summary — ${news.length} news item(s) reached selection`);
    }

    const heroFetcher = makeImageFetcher(HERO_MAX_BYTES);
    const thumbFetcher = makeImageFetcher(THUMB_MAX_BYTES);
    const chosen = await Promise.all(
      selected.map((it, i) => {
        const hero = i === 0;
        const cap = hero ? HERO_MAX_WIDTH : THUMB_MAX_WIDTH;
        return selectBestImage(
          imageCandidates(it).map((u) => variantAtMost(u, cap)),
          hero ? heroFetcher : thumbFetcher,
        );
      }),
    );
    const [heroDataUri, ...thumbDataUris] = chosen.map((c) => (c ? toDataUri(c) : undefined));

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
