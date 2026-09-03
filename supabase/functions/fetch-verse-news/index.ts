// fetch-verse-news — aggregates RSI Comm-Link, Patch-Notes, YouTube, Spectrum
// and the real RSI Status page into one VerseFeed JSON.
// JWT verification is OFF (config.toml verify_jwt=false, #131): a public news feed
// of public sources, reachable by signed-out visitors; client sends sb_publishable_*.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { Buffer } from 'node:buffer';
import jpeg from 'npm:jpeg-js@0.4.4';
import { PNG } from 'npm:pngjs@7.0.0';
import { scoreWallpaper } from './wallpaper-quality.ts';
import { perceptualHash } from './perceptual-hash.ts';
import {
  type VariantAssignment,
  type VariantMember,
  buildThumb,
  decodeThumb,
  encodeThumb,
  groupVariants,
} from './variant-signature.ts';
import { isCommLinkArticleUrl } from './comm-link-url.ts';
import { heroOgTargets, promoteHero } from './hero-image.ts';
import { isWithinVideoRetention, videoRetentionCutoff } from './video-retention.ts';
import { isImageUrl } from './media-urls.ts';
import {
  MAX_PASSTHROUGH_BYTES,
  OPAQUE_WIDTH,
  VARIANT_CACHE_CONTROL,
  buildVariants,
  readImageSize,
  totalVariantBytes,
  variantPath,
} from './image-variants.ts';
import { edgeCodecs } from './image-codecs.ts';

type Channel = 'comm-link' | 'spectrum' | 'status' | 'patch' | 'youtube';

interface VerseNewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  channel: Channel;
  summary?: string;
  thumbnail?: string;
  // All candidate image URLs (first = thumbnail). The client picks a usable title
  // image by aspect ratio and falls back to a slideshow when there is no clear one.
  images?: string[];
  category?: string;
  source: 'comm-link' | 'patch-notes' | 'spectrum' | 'youtube' | 'status';
}

type StatusLevel = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance' | 'unknown';

interface VerseStatusComponent {
  name: string;
  status: StatusLevel;
}

interface VerseStatus {
  overall: StatusLevel;
  label: string;
  components: VerseStatusComponent[];
  updatedAt: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// `include=images` is REQUIRED — without it the API omits the images array entirely
// (only an `images_count` integer is returned), leaving every card without a thumbnail.
const COMM_LINK_API = 'https://api.star-citizen.wiki/api/v2/comm-links?limit=40&include=images';
const STATUS_PAGE_URL = 'https://status.robertsspaceindustries.com/';
// RSI YouTube channel ("Star Citizen", @RobertsSpaceInd). Override via env if needed.
const RSI_YT_CHANNEL_ID = Deno.env.get('RSI_YOUTUBE_CHANNEL_ID') ?? 'UCTeLqJq1mXUX5WWoNXLmOIA';
const YT_FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${RSI_YT_CHANNEL_ID}`;

const RSI_BASE = 'https://robertsspaceindustries.com';

function cleanXml(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

const RSI_HOST_ALLOWLIST = new Set([
  'robertsspaceindustries.com',
  'www.robertsspaceindustries.com',
  'status.robertsspaceindustries.com',
]);

function normalizeRsiUrl(raw: string | undefined, fallbackPath = ''): string {
  if (!raw) return RSI_BASE + fallbackPath;
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const u = new URL(raw);
      if (RSI_HOST_ALLOWLIST.has(u.hostname)) return raw;
      // Upstream gave a non-RSI host — preserve the path under canonical RSI.
      return RSI_BASE + (u.pathname || fallbackPath) + u.search + u.hash;
    } catch {
      return RSI_BASE + fallbackPath;
    }
  }
  return RSI_BASE + (raw.startsWith('/') ? raw : '/' + raw);
}

// --------------------- Comm-Link + Patch-Notes ---------------------
// star-citizen.wiki/api/v2 entry shape (relevant fields only):
//   id: number, title: string (often the generic series name),
//   rsi_url: string (canonical comm-link permalink), series/channel/category: string,
//   images: [{ rsi_url: string }] (only when ?include=images),
//   translations: { en_EN?: string, de_DE?: string, ... } — newline-joined body text.
async function fetchCommLinks(): Promise<VerseNewsItem[]> {
  try {
    const res = await fetch(COMM_LINK_API, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`comm-link HTTP ${res.status}`);
    const json = await res.json();
    const entries: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : [];
    const items = entries.map((entry) => {
      const series = String(entry['series'] ?? entry['channel'] ?? '').trim();
      const channel = classifyCommLinkChannel(series);
      // The wiki API field is `rsi_url` (the RSI permalink), NOT `url`. Falling back to a
      // path here is what made every link land on the /comm-link index page.
      const rawUrl = typeof entry['rsi_url'] === 'string' ? (entry['rsi_url'] as string) : '';
      return {
        id: String(entry['cig_id'] ?? entry['id'] ?? crypto.randomUUID()),
        title: String(entry['title'] ?? 'Untitled'),
        url: normalizeRsiUrl(rawUrl, '/comm-link'),
        publishedAt: String(entry['created_at'] ?? entry['published_at'] ?? new Date().toISOString()),
        channel,
        summary: summarizeTranslations(entry['translations'], series),
        thumbnail: firstImageUrl(entry['images']),
        images: allImageUrls(entry['images']),
        category: series && series !== 'None' ? series : undefined,
        source: channel === 'patch' ? 'patch-notes' : 'comm-link',
      } satisfies VerseNewsItem;
    });
    // Keep only entries whose "open on RSI" link is a real article permalink. The wiki
    // API also surfaces storefront ad promos (channel "Undefined", e.g. "Fly with D-Box"
    // → /promotions/<code>, which 404s) and, when an entry has no rsi_url, our own bare
    // /comm-link index fallback — both hand the user a card whose external link lands on
    // a dead or redirecting RSI error page instead of an article (the reported link bug).
    const articles = items.filter((it) => isCommLinkArticleUrl(it.url));
    await resolveHeroImages(articles);
    return articles;
  } catch (err) {
    console.error('fetchCommLinks failed:', err);
    return [];
  }
}

/* ---------------------------------------------------------------- *
 * Hero image resolution — RSI's own og:image, not "whatever came first"
 *
 * The wiki API's `images` array is the article's MEDIA LIST in document order,
 * not an editorial pick, so `images[0]` is only the hero by coincidence. "Letter
 * From The Chairman" (21301, 2026-08-27) is the case that broke: 8 images whose
 * first three are a portrait headshot and two `dividing-lines-*.webp` ornaments
 * — a 1000×8 rule. Cover-cropped into a 16/9 tile the ornament paints an empty
 * bar, so the card read as "no image" while the RSI page showed a banner. The
 * real hero (`lftcm-headerbanner-1.jpg`) sat at index 3.
 *
 * The page's own `og:image` IS the editorial pick — RSI publishes one on every
 * comm-link (verified across transmissions, Comm-links and Roadmap Roundups),
 * always as a `media.robertsspaceindustries.com/<id>/heap_thumb.jpg`, which the
 * existing variant-swap resolves to the ≤1140w `cover` copy. So we no longer
 * scrape it only as a last resort for entries with NO images: for the newest
 * entries — the ones a reader actually sees — it is fetched up front and put in
 * front of the media list.
 *
 * Cost is bounded three ways: only the newest `HERO_OG_LOOKAHEAD` entries plus
 * the still-imageless tail, a shared wall-clock budget, and a module-scope memo
 * that survives between requests on a warm isolate (a comm-link's og:image never
 * changes, so a hit is free and correct).
 * ---------------------------------------------------------------- */
const OG_FETCH_TIMEOUT_MS = 6000;
/** Newest entries whose hero is resolved from the page even if they have images. */
const HERO_OG_LOOKAHEAD = 12;
/** Additional older entries that have NO image at all (the historic fallback). */
const MAX_OG_FALLBACK = 10;
/** Hard ceiling on the whole og phase — callers wait on this request. */
const OG_PHASE_BUDGET_MS = 5000;
/** og:image sits ~8 KB into a ~34 KB page; stop reading well before the body. */
const OG_HEAD_BYTES = 64 * 1024;
/** A comm-link's og:image is immutable, so a memo hit needs no freshness proof. */
const OG_MEMO_TTL_MS = 6 * 60 * 60 * 1000;
const OG_MEMO_MAX = 300;

const ogMemo = new Map<string, { url: string | undefined; at: number }>();

async function memoizedOgImage(pageUrl: string, deadline: number): Promise<string | undefined> {
  const hit = ogMemo.get(pageUrl);
  if (hit && Date.now() - hit.at < OG_MEMO_TTL_MS) return hit.url;
  const budget = deadline - Date.now();
  if (budget <= 0) return hit?.url;
  const url = await fetchOgImage(pageUrl, Math.min(OG_FETCH_TIMEOUT_MS, budget));
  // A miss is memoized too — a page that has no usable og tag would otherwise be
  // re-fetched on every single request forever. Not memoized on a spent budget:
  // that is a timeout, not a verdict about the page.
  if (Date.now() < deadline || url) {
    if (ogMemo.size >= OG_MEMO_MAX) ogMemo.delete(ogMemo.keys().next().value as string);
    ogMemo.set(pageUrl, { url, at: Date.now() });
  }
  return url;
}

async function resolveHeroImages(items: VerseNewsItem[]): Promise<void> {
  const targets = heroOgTargets(items, RSI_BASE, HERO_OG_LOOKAHEAD, MAX_OG_FALLBACK);
  if (!targets.length) return;

  const deadline = Date.now() + OG_PHASE_BUDGET_MS;
  await Promise.allSettled(targets.map(async (it) => {
    const og = await memoizedOgImage(it.url, deadline);
    if (!og) return;
    it.images = promoteHero(it.images, og, MAX_IMAGE_URLS);
    it.thumbnail = og;
  }));
}

// Extract a social-share image (og:image / twitter:image / link rel=image_src)
// from an RSI permalink. Comm-link transmission pages are client-rendered, so the
// hero never appears in the static body — this <head> meta is the only image we can
// scrape server-side. Only RSI-hosted urls are accepted: the page is untrusted
// content, so we never surface an arbitrary external image url from it.
async function fetchOgImage(pageUrl: string, timeoutMs = OG_FETCH_TIMEOUT_MS): Promise<string | undefined> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(pageUrl, {
      headers: { 'Accept': 'text/html', 'User-Agent': 'SC-Companion/0.3 (+news-og-fallback)' },
      signal: ctrl.signal,
    });
    if (!res.ok) return undefined;
    const html = await readHead(res, OG_HEAD_BYTES);
    // property/name and content can appear in either order; og:image may also be
    // exposed as og:image:secure_url / og:image:url, or a <link rel="image_src">.
    const PROP = 'og:image(?::secure_url|:url)?|twitter:image(?::src)?';
    const raw =
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["'](?:${PROP})["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1] ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:${PROP})["']`, 'i'))?.[1] ??
      html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i)?.[1];
    const resolved = resolveRsiImageUrl(raw, pageUrl);
    return resolved;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

/**
 * First `limit` bytes of a response as text, then hang up.
 *
 * The meta tags we want live in the `<head>`; reading the rest of a page we
 * immediately throw away is pure egress. Cancelling the reader also releases the
 * connection instead of leaving it draining in the background. Falls back to a
 * plain `.text()` where the body is not a readable stream.
 */
async function readHead(res: Response, limit: number): Promise<string> {
  const body = res.body;
  if (!body) return res.text();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.length; }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

// Decode the handful of HTML entities RSI emits inside attribute values (media urls
// carry query strings, so `&amp;` is common), resolve protocol-relative/relative
// forms against the page, and reject anything not hosted on RSI.
function resolveRsiImageUrl(raw: string | undefined, pageUrl: string): string | undefined {
  if (!raw) return undefined;
  let v = raw
    .replace(/&amp;/g, '&').replace(/&#0*38;/g, '&')
    .replace(/&#x2[Ff];/g, '/').replace(/&#0*47;/g, '/')
    .replace(/&quot;/g, '"').replace(/&#0*34;/g, '"')
    .trim();
  if (v.startsWith('//')) v = 'https:' + v;
  try {
    const u = new URL(v, pageUrl);           // base resolves any relative path
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    const host = u.hostname;
    if (host !== 'robertsspaceindustries.com' && !host.endsWith('.robertsspaceindustries.com')) return undefined;
    u.protocol = 'https:';
    return u.toString();
  } catch {
    return undefined;
  }
}

// Pull the RSI CDN url of the first image from the `images` include (absent without it).
function firstImageUrl(images: unknown): string | undefined {
  return allImageUrls(images)?.[0];
}

// All distinct image urls from the `images` include, in API order, capped.
// Video assets of the same post are filtered out here — see media-urls.ts for
// why that mattered far beyond the card itself.
// The first comm-link image is usually the hero, but not always (e.g. event
// schedules lead with a tall portrait poster) — so we surface them all and let
// the client decide which to show / rotate.
const MAX_IMAGE_URLS = 10;
function allImageUrls(images: unknown): string[] | undefined {
  if (!Array.isArray(images)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const img of images) {
    const url = img && typeof img === 'object' ? (img as Record<string, unknown>)['rsi_url'] : null;
    if (typeof url === 'string' && url && isImageUrl(url) && !seen.has(url)) {
      seen.add(url);
      out.push(url);
      if (out.length >= MAX_IMAGE_URLS) break;
    }
  }
  return out.length ? out : undefined;
}

// Translations are newline-joined body text (the API has no dedicated summary field).
// Prefer EN, then DE, then any locale. Drop the leading line that just echoes the series
// header so the summary doesn't start by repeating the card's category.
function summarizeTranslations(translations: unknown, series: string): string | undefined {
  if (!translations || typeof translations !== 'object') return undefined;
  const t = translations as Record<string, unknown>;
  const raw = [t['en_EN'], t['de_DE'], ...Object.values(t)].find((v) => typeof v === 'string' && v.trim());
  if (typeof raw !== 'string') return undefined;
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length && series && lines[0].toLowerCase() === series.toLowerCase()) lines.shift();
  return lines.join(' ').slice(0, 280) || undefined;
}

function classifyCommLinkChannel(series: string): Channel {
  const v = series.toLowerCase();
  if (v.includes('patch') || v.includes('release') || v.includes('hotfix')) return 'patch';
  if (v.includes('spectrum')) return 'spectrum';
  return 'comm-link';
}

// --------------------- YouTube RSS ---------------------
async function fetchYouTube(): Promise<VerseNewsItem[]> {
  try {
    const res = await fetch(YT_FEED_URL, { headers: { 'Accept': 'application/atom+xml' } });
    if (!res.ok) throw new Error(`youtube HTTP ${res.status}`);
    const xml = await res.text();
    const entries = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)).slice(0, 15);
    const now = Date.now();
    const videos = entries.map((m) => {
      const body = m[1];
      const id = body.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/)?.[1] ?? crypto.randomUUID();
      const title = cleanXml(body.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'Video');
      const published = body.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? new Date().toISOString();
      const thumb = body.match(/<media:thumbnail\s+url="([^"]+)"/)?.[1];
      const desc = body.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1];
      return {
        id: 'yt-' + id,
        title,
        url: `https://www.youtube.com/watch?v=${id}`,
        publishedAt: published,
        channel: 'youtube',
        summary: desc ? cleanXml(desc).slice(0, 280) : undefined,
        thumbnail: thumb,
        images: thumb ? [thumb] : undefined,
        category: 'Video',
        source: 'youtube',
      } satisfies VerseNewsItem;
    });
    // Retention (feedback e7082310): a video outside the today/this-week/
    // this-month window is dropped here, BEFORE captureWallpapers/cacheImages
    // run — so an aged-out clip never gets a thumbnail written to storage in
    // the first place. `enforceVideoRetention` below cleans up the ones that
    // were cached while they were still fresh.
    return videos.filter((v) => isWithinVideoRetention(v.publishedAt, now));
  } catch (err) {
    console.error('fetchYouTube failed:', err);
    return [];
  }
}

// --------------------- Spectrum (internal JSON API) ---------------------
// Spectrum is a client-rendered SPA; the old __INITIAL_STATE__ HTML scrape broke
// when RSI stopped inlining that blob (page still 200s, just no threads). The
// forum's own JSON endpoint works without an auth token — only the X-Tavern-Id
// header is required. channel_id 1 = the SC "Announcements" forum (official CIG
// posts: patch updates, launcher notes), which is what belongs in a news feed.
const SPECTRUM_API = 'https://robertsspaceindustries.com/api/spectrum/forum/channel/threads';
const SPECTRUM_CHANNEL_ID = 1;
// X-Tavern-Id is the COMMUNITY id (1 = Star Citizen), not the channel — the same
// value for every forum we read. It used to be derived from SPECTRUM_CHANNEL_ID
// only because those two happened to be 1 as well.
const SPECTRUM_TAVERN_ID = 1;

// Each thread row already carries RSI's own preview of its first post's media as
// `media_preview: { type, thumbnail: { url } }` — so we get the hero image WITHOUT
// a per-thread content fetch (no extra request, no timeout budget to blow). Two url
// shapes appear, both upgraded to a card-worthy variant before host-allowlisting:
//   1. theverse uploads  …/<id>/tavern_upload_mini.<ext>  → swap to `_large`
//      (mini is ~2–20 KB / unusably small; large is ~70 KB–1.3 MB, source can be 5 MB+).
//   2. imager proxy  …/imager/<sig>/<WxH>/https://media…/<id>/source.jpg  → unwrap to
//      the inner media-CDN url so the existing post/cover variant pipeline sizes it.
// Threads with no media_preview keep no image → the client renders the spectrum default.
function spectrumImageUrl(mediaPreview: unknown): string | undefined {
  if (!mediaPreview || typeof mediaPreview !== 'object') return undefined;
  const thumb = (mediaPreview as Record<string, unknown>)['thumbnail'];
  const raw = thumb && typeof thumb === 'object' ? (thumb as Record<string, unknown>)['url'] : undefined;
  if (typeof raw !== 'string' || !raw) return undefined;
  const upgraded = upgradeTheverseVariant(unwrapImagerUrl(raw));
  return resolveRsiImageUrl(upgraded, RSI_BASE);
}

// `…/imager/<sig>/<WxH>/<innerAbsoluteUrl>` → the inner absolute url. The outer
// host prefix sits BEFORE `/imager/`, so the first http(s):// inside that segment
// is the wrapped original.
function unwrapImagerUrl(url: string): string {
  const i = url.indexOf('/imager/');
  if (i === -1) return url;
  const inner = url.slice(i).match(/https?:\/\/.+$/i);
  return inner ? inner[0] : url;
}

// theverse `tavern_upload_mini.<ext>` → `tavern_upload_large.<ext>` (universal,
// card-sized). No-op for any other url shape.
function upgradeTheverseVariant(url: string): string {
  return url.replace(/\/tavern_upload_mini(\.[a-zA-Z0-9]+)(\?|$)/, '/tavern_upload_large$1$2');
}

/** One page of threads of a Spectrum forum channel, newest first. */
async function spectrumThreads(channelId: number, page: number): Promise<Record<string, unknown>[]> {
  const res = await fetch(SPECTRUM_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Tavern-Id': String(SPECTRUM_TAVERN_ID),
      'User-Agent': 'SC-Companion/0.3 (+https://sc-companion.vercel.app)',
    },
    body: JSON.stringify({ channel_id: channelId, page, sort: 'newest' }),
  });
  if (!res.ok) throw new Error(`spectrum HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.data?.threads) ? json.data.threads : [];
}

interface SpectrumMapOptions {
  channelId: number;
  channel: Channel;
  source: VerseNewsItem['source'];
  category: string;
  idPrefix: string;
  /** Patch-note threads are plain text; skipping media keeps them out of the image pipeline. */
  withImage: boolean;
}

/**
 * One Spectrum thread row → feed item, or null when the row is unusable.
 * Malformed rows are SKIPPED rather than patched up with fabricated values — a
 * synthetic id (crypto.randomUUID) would change every fetch and falsely trip the
 * client's "new posts" counter; a missing slug yields a dead thread link.
 * The timestamp upper bound (year 2100) keeps a finite-but-absurd value from
 * throwing RangeError in `new Date(...).toISOString()` — which, inside a
 * function-level try, would collapse an ENTIRE channel to [].
 */
function mapSpectrumThread(t: Record<string, unknown>, opt: SpectrumMapOptions): VerseNewsItem | null {
  const id = t['id'];
  const subject = t['subject'];
  const slug = t['slug'];
  // time_created is a Unix timestamp in **seconds**. `time_modified` looks like
  // an "edited at" but tracks the last REPLY (it moves in lockstep with
  // replies_count), so it is deliberately not surfaced — "updated 2 days ago"
  // would mean "someone commented", not "there are new notes".
  const created = Number(t['time_created']);
  if (!id || typeof subject !== 'string' || !subject.trim() ||
      typeof slug !== 'string' || !slug ||
      !Number.isFinite(created) || created <= 0 || created > 4102444800) return null;
  const image = opt.withImage ? spectrumImageUrl(t['media_preview']) : undefined;
  return {
    id: opt.idPrefix + String(id),
    title: subject,
    url: `${RSI_BASE}/spectrum/community/SC/forum/${opt.channelId}/thread/${slug}`,
    publishedAt: new Date(created * 1000).toISOString(),
    channel: opt.channel,
    source: opt.source,
    category: opt.category,
    // First-post hero from media_preview; absent → client channel default.
    ...(image ? { thumbnail: image, images: [image] } : {}),
  };
}

async function fetchSpectrum(): Promise<VerseNewsItem[]> {
  try {
    const threads = await spectrumThreads(SPECTRUM_CHANNEL_ID, 1);
    const out: VerseNewsItem[] = [];
    for (const t of threads) {
      const item = mapSpectrumThread(t, {
        channelId: SPECTRUM_CHANNEL_ID,
        channel: 'spectrum',
        source: 'spectrum',
        category: 'Spectrum',
        idPrefix: 'spec-',
        withImage: true,
      });
      if (!item) continue;
      out.push(item);
      if (out.length >= 12) break;
    }
    return out;
  } catch (err) {
    console.error('fetchSpectrum failed:', err);
    return [];
  }
}

// --------------------- Patch notes (Spectrum "Patch Notes" forum) ---------------------
// RSI publishes EVERY patch note as a thread in the SC Patch-Notes forum: the
// major LIVE release notes, each PTU/Evocati wave, the point releases and the
// rolling "Hotfix Central" threads. None of that reaches the Comm-Link wiki API,
// which is why the patch channel used to be all but empty — it was fed only by
// the odd comm-link whose *series* string happened to mention "patch", so 4.9 and
// its hotfixes never showed up at all (feedback 44e90e30).
//
// Two pages ≈ 100 threads ≈ the last half-dozen patch lines, which is what "show
// me everything" costs here: ~20 KB of JSON and no images at all (these threads
// carry no media_preview, and we do not ask for one — see withImage:false), so
// they add nothing to the image cache or the wallpaper crawl.
const PATCH_NOTES_CHANNEL_ID = 190048;
const PATCH_NOTES_PAGES = [1, 2];
const MAX_PATCH_NOTES = 120;

async function fetchPatchNotes(): Promise<VerseNewsItem[]> {
  try {
    // One slow page must not cost us the other one.
    const pages = await Promise.all(
      PATCH_NOTES_PAGES.map((page) =>
        spectrumThreads(PATCH_NOTES_CHANNEL_ID, page).catch((err) => {
          console.error(`fetchPatchNotes page ${page} failed:`, err);
          return [] as Record<string, unknown>[];
        })
      ),
    );
    const seen = new Set<string>();
    const out: VerseNewsItem[] = [];
    for (const t of pages.flat()) {
      const item = mapSpectrumThread(t, {
        channelId: PATCH_NOTES_CHANNEL_ID,
        channel: 'patch',
        source: 'patch-notes',
        category: 'Patch Notes',
        idPrefix: 'patch-',
        withImage: false,
      });
      // Pinned threads are repeated at the top of EVERY page — without this the
      // current release notes would appear once per page fetched.
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
      if (out.length >= MAX_PATCH_NOTES) break;
    }
    return out;
  } catch (err) {
    console.error('fetchPatchNotes failed:', err);
    return [];
  }
}

// --------------------- Status (HTML scrape) ---------------------
// RSI's status site is a STATIC S3/CloudFront export of the Atlassian Statuspage
// template, NOT a live Statuspage instance — its `/api/v2/*.json` endpoints 403
// (S3 AccessDenied), so we scrape the rendered HTML. Current markup (verified 2026-06):
//   <body class="status-homepage status-ok">                              ← overall
//   <div class="component"> Persistent Universe </a>
//     <span class="component-status" data-status="operational">…</span>   ← per component
// The previous selectors (data-component-status / component-inner-container / page-status)
// no longer exist in the export — that stale scrape is what made the chip read "unbekannt".

// Per-component `data-status` (Statuspage enum) → our StatusLevel.
// The static export's CSS/tag markup uses SHORT values (degraded/partial/major/
// maintenance — verified 2026-07 against the live page), while the classic
// Statuspage enum uses long ones. Map both: a component in a real incident
// carries the short form, and an unmapped value used to silently DROP the
// component from the drill-down exactly when it mattered (issue #20).
const COMPONENT_STATUS_MAP: Record<string, StatusLevel> = {
  operational: 'operational',
  degraded_performance: 'degraded',
  degraded: 'degraded',
  partial_outage: 'partial_outage',
  partial: 'partial_outage',
  major_outage: 'major_outage',
  major: 'major_outage',
  under_maintenance: 'maintenance',
  maintenance: 'maintenance',
};
// Overall body class `status-homepage status-<x>` → our StatusLevel.
const OVERALL_STATUS_MAP: Record<string, StatusLevel> = {
  ok: 'operational',
  none: 'operational',
  minor: 'degraded',
  major: 'partial_outage',
  critical: 'major_outage',
  maintenance: 'maintenance',
};

const STATUS_PRIORITY: Record<StatusLevel, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
  unknown: -1,
};

async function fetchStatus(): Promise<VerseStatus | null> {
  try {
    const res = await fetch(STATUS_PAGE_URL, {
      headers: { 'Accept': 'text/html', 'User-Agent': 'SC-Companion/0.3' },
    });
    if (!res.ok) throw new Error(`status HTTP ${res.status}`);
    const html = await res.text();
    // Each component: <div class="component"> NAME </a> … <span class="component-status" data-status="X">
    const compRe = /<div class="component"\s*>([\s\S]*?)<\/a>[\s\S]*?<span class="component-status"\s+data-status="([a-z_]+)"/gi;
    const components: VerseStatusComponent[] = [];
    let m: RegExpExecArray | null;
    while ((m = compRe.exec(html)) !== null) {
      const name = cleanXml(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      const status = COMPONENT_STATUS_MAP[m[2].toLowerCase()] ?? 'unknown';
      if (name && status !== 'unknown') components.push({ name, status });
    }
    // Overall from the body class `status-homepage status-<x>`; fall back to the worst component.
    const overallMatch = html.match(/status-homepage\s+status-([a-z-]+)/i);
    let overall: StatusLevel = overallMatch ? (OVERALL_STATUS_MAP[overallMatch[1].toLowerCase()] ?? 'unknown') : 'unknown';
    if (overall === 'unknown' && components.length) {
      overall = components.reduce<StatusLevel>(
        (acc, c) => (STATUS_PRIORITY[c.status] > STATUS_PRIORITY[acc] ? c.status : acc),
        'operational',
      );
    }
    return {
      overall,
      label: overall,
      components,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('fetchStatus failed:', err);
    return null;
  }
}

// --------------------- Server-side image cache ---------------------
// RSI's signed `/i/<sha1>/…` proxy urls expire and cross-origin hotlinking of the
// CDN is referer/rate limited, so client-rendered cards kept losing their images.
// We download each image once into the public `news-images` bucket and hand the
// client our own durable url instead.
//
// What we store has changed (news-images footprint, 2026-07-27). The first
// generation mirrored the upstream bytes verbatim under two names — `post.<ext>`
// and `cover.<ext>` — which for most sources were the SAME file at full RSI
// resolution, so the bucket grew a byte-identical twin of every multi-MB PNG and
// reached 809 MB of the 1 GB quota. Now each source is decoded once and stored as
// a ladder of genuinely different sizes (`w400`/`w800`/`w<top>`, see
// image-variants.ts) — no twins, nothing wider than the app ever paints.

const IMG_BUCKET = 'news-images';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUBLIC_BASE = `${SUPABASE_URL}/storage/v1/object/public/${IMG_BUCKET}`;
// Cap warm work per request so a cold cache can't blow the deferred pass's
// timeout OR its memory; the cache warms over a few request cycles, raw urls
// serve meanwhile. Misses are processed SEQUENTIALLY (see warmImageCache), but
// "sequential" only bounds concurrency, not the PEAK: one `/i/` original's decode
// reserves well over 100 MB (jpeg-js bookkeeping + edgeCodecs' RGBA copy), and
// that peak lands on top of captureWallpapers' decodes in the same deferred pass.
// 3, with the tighter MAX_SOURCE_PIXELS above, keeps the sum under the isolate
// limit. In steady
// state only a handful of genuinely new images arrive per day, so 3 is never the
// bottleneck.
const MAX_CACHE_PER_REQUEST = 3;
const IMG_FETCH_TIMEOUT_MS = 8000;
// Hard ceilings on a single source. RSI's `cover` variant is ≤1140px wide and
// tens of KB; the un-variantable signed-proxy originals are the only large
// ones. Both caps exist because an oversized source is not merely expensive —
// it can NEVER be cached (jpeg-js gives up at 512 MB of RGBA), so it stays a
// miss and is re-downloaded on every single request until someone notices.
// One 17.7 MB, 19k-pixel-wide panorama was costing ~2s and 17.7 MB of egress
// per call for exactly that reason. Rejecting it early is not a loss: the card
// keeps the raw RSI url and renders as before.
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
// jpeg-js's accounting covers far more than the output buffer, so a "big but not
// huge" source is still expensive. 16 MP was set against the smallest source
// that made jpeg-js *abort* (25 MP) — but aborting is not the failure that
// matters: a source well UNDER that ceiling still decodes, and a single 8.3 MP
// `/i/` original drove worker RSS +220 MB during the 2026-08-04 546 outage (see
// MAX_DECODE_PIXELS in image-variants.ts). 6 MP keeps the largest admitted
// decode under the 128 MB jpeg-js cap; larger sources keep their raw url.
const MAX_SOURCE_PIXELS = 6_000_000;
// Wall clock the cache warm-up may add to a request. Callers (the news page,
// and starscape-summary on a 9s budget) wait on this endpoint; warming is
// housekeeping and must never be what makes them time out.
const CACHE_WARM_BUDGET_MS = 6000;

// Swap the variant segment of an RSI **media** CDN url. Ingest only ever asks for
// `cover` (the ≤1140w variant we resize down from); other urls (signed proxy,
// ytimg, theverse uploads, …) have no variant segment → returned unchanged.
function mediaVariant(url: string, target: 'post' | 'cover'): string {
  const m = /^(https:\/\/media\.robertsspaceindustries\.com\/[^/]+\/)[^/.]+(\.[a-zA-Z0-9]+)$/.exec(url);
  return m ? `${m[1]}${target}${m[2]}` : url;
}

// Variant-stripped identity + file extension for a source image. Post/cover of
// the same media image share a base (so they cache under one folder); everything
// else keys on the query-stripped url.
function imageIdentity(url: string): { base: string; ext: string } {
  const m = /^(https:\/\/media\.robertsspaceindustries\.com\/[^/]+\/)[^/.]+(\.[a-zA-Z0-9]+)$/.exec(url);
  if (m) return { base: m[1], ext: m[2].slice(1).toLowerCase() };
  const noQuery = url.split('?')[0];
  const ext = (/\.([a-zA-Z0-9]{2,4})$/.exec(noQuery)?.[1] ?? 'jpg').toLowerCase();
  return { base: noQuery, ext };
}

async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchImage(url: string, ext: string): Promise<{ bytes: Uint8Array; ct: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), IMG_FETCH_TIMEOUT_MS);
  try {
    // A valid Referer is what unlocks RSI's CDN for non-browser clients.
    const res = await fetch(url, {
      headers: { 'Referer': RSI_BASE + '/', 'User-Agent': 'sc-companion/1.0 (+news-image-cache)' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    // Refuse obvious non-images and absurd payloads BEFORE reading the body:
    // the widest variant we store is 1140px, so nothing legitimate here comes
    // close to the cap. Without it a mislabelled url streams its whole body
    // into memory just to fail decoding (a 190 MB clip did exactly that).
    // Deny-list rather than requiring `image/*`: RSI occasionally serves real
    // artwork as octet-stream, and the decoder keys on magic bytes anyway.
    const declaredType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (/^(?:video|audio|text)\/|^application\/(?:json|zip|pdf)/.test(declaredType)) return null;
    const declaredLength = Number(res.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) return null;
    const ct = res.headers.get('content-type') ?? `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    return { bytes, ct };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// One `verse_image_cache` row. `top_width === null` marks a first-generation row
// whose objects are still the legacy `post`/`cover` pair — those keep resolving
// to the old url until scripts/news-image-compact.mjs has rewritten them, so the
// feed never points at an object that does not exist yet.
interface CacheRow {
  source_key: string;
  ext: string;
  top_width: number | null;
  bytes?: number | null;
}

/** Public url of the largest stored variant; the client derives the rest of the ladder. */
function cachedUrl(row: CacheRow): string {
  return row.top_width == null
    ? `${PUBLIC_BASE}/${row.source_key}/cover.${row.ext}`
    : `${PUBLIC_BASE}/${variantPath(row.source_key, row.top_width, row.ext)}`;
}

/**
 * Download one source image and store its whole variant ladder.
 *
 * Only ONE upstream request is made (the `cover` variant for RSI media urls —
 * ≤1140w, which is already the widest the app ever paints, and half the ingest
 * bandwidth of the old post+cover pair). Every stored size is derived from it.
 */
async function cacheOne(admin: SupabaseClient, hash: string, ext: string, sample: string): Promise<CacheRow | null> {
  const src = mediaVariant(sample, 'cover');
  const fetched = (await fetchImage(src, ext)) ?? (src === sample ? null : await fetchImage(sample, ext));
  if (!fetched) return null;

  // Header-only dimension check — skip the multi-second decode of something we
  // already know will exhaust the decoder's memory budget and fail anyway.
  const size = readImageSize(fetched.bytes);
  if (size && size.w * size.h > MAX_SOURCE_PIXELS) return null;

  const upload = (path: string, bytes: Uint8Array, contentType: string) =>
    admin.storage.from(IMG_BUCKET).upload(path, bytes, {
      contentType,
      upsert: true,
      cacheControl: VARIANT_CACHE_CONTROL,
    });

  const variants = buildVariants(fetched.bytes, ext, edgeCodecs);
  if (!variants) {
    // Undecodable (GIF/SVG/WebP or a corrupt payload). Small ones are mirrored
    // verbatim as the single `w0` object so the card keeps a durable url; large
    // ones are skipped entirely — parking a multi-MB blob is what we are fixing.
    if (fetched.bytes.length > MAX_PASSTHROUGH_BYTES) return null;
    const path = variantPath(hash, OPAQUE_WIDTH, ext);
    const { error } = await upload(path, fetched.bytes, fetched.ct);
    return error ? null : { source_key: hash, ext, top_width: OPAQUE_WIDTH, bytes: fetched.bytes.length };
  }

  const results = await Promise.all(
    variants.map((v) => upload(variantPath(hash, v.width, v.ext), v.bytes, v.contentType)),
  );
  if (results.some((r) => r.error)) return null;
  const top = variants[variants.length - 1];
  return { source_key: hash, ext: top.ext, top_width: top.width, bytes: totalVariantBytes(variants) };
}

// The image cache, split into a decode-free response step and a deferred warm.
// The request path only ever RE-USES what the index already has (no downloads,
// no decode → cannot OOM); the memory-heavy download+decode runs after the
// response via waitUntil. Misses keep their raw RSI url for the cycle and are
// warmed for the next one. This split is what makes an image OOM unable to 546
// the feed (the 546 outage class — see the size caps above for why one still
// shouldn't happen in the first place).
interface ImageCacheEntry {
  base: string;
  ext: string;
  sample: string;
  hash: string;
}

// Shared, DECODE-FREE prep for both the response rewrite and the deferred warm:
// the unique source identities across all items plus which of them the index
// already has. `isImageUrl` is re-applied here on purpose — extraction already
// drops video assets, but this is the boundary where a non-image sample turns
// into an unbounded, permanently-retried download, so no feed source gets to
// poison it. A failed lookup returns an empty `cached` map (rewrite leaves raw
// urls; warm treats everything as a miss), never a throw.
async function loadImageCache(
  admin: SupabaseClient,
  items: VerseNewsItem[],
): Promise<{ entries: ImageCacheEntry[]; entByBase: Map<string, ImageCacheEntry>; cached: Map<string, CacheRow> }> {
  const byBase = new Map<string, { ext: string; sample: string }>();
  for (const it of items) {
    for (const url of it.images ?? []) {
      if (!isImageUrl(url)) continue;
      const { base, ext } = imageIdentity(url);
      if (!byBase.has(base)) byBase.set(base, { ext, sample: url });
    }
  }
  const entries = await Promise.all(
    [...byBase.entries()].map(async ([base, v]) => ({ base, ...v, hash: await sha1Hex(base) })),
  );
  const entByBase = new Map(entries.map((e) => [e.base, e]));
  const cached = new Map<string, CacheRow>();
  if (!entries.length) return { entries, entByBase, cached };
  // `ext`/`top_width` come from the row, not the source url, so a PNG re-encoded
  // to JPEG resolves correctly.
  const { data, error } = await admin
    .from('verse_image_cache')
    .select('source_key, ext, top_width')
    .in('source_key', entries.map((e) => e.hash));
  if (error) {
    console.error('verse_image_cache lookup failed:', error.message);
    return { entries, entByBase, cached };
  }
  for (const r of (data ?? []) as CacheRow[]) cached.set(r.source_key, r);
  return { entries, entByBase, cached };
}

// Response-path image step: rewrite each item's urls to the cached copies the
// index ALREADY holds. Returns a rewritten COPY and never mutates `items` — the
// deferred warm/capture work below still needs the raw upstream urls. This does
// a DB lookup and nothing else: no downloads, no decode, so it cannot OOM. A
// source not yet cached keeps its raw RSI url for this cycle and is warmed for
// the next one by warmImageCache().
async function rewriteToCachedImages(items: VerseNewsItem[]): Promise<VerseNewsItem[]> {
  if (!SUPABASE_URL || !SERVICE_KEY) return items; // misconfigured → raw urls
  if (!items.some((it) => it.images?.length)) return items;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { entByBase, cached } = await loadImageCache(admin, items);
  if (!cached.size) return items;
  return items.map((it) => {
    if (!it.images) return it;
    // Non-image urls are left alone — they share a cache identity with the
    // artwork of the same media id, so rewriting them would silently turn a clip
    // url into a picture url.
    const images = it.images.map((url) => {
      if (!isImageUrl(url)) return url;
      const ent = entByBase.get(imageIdentity(url).base);
      const row = ent ? cached.get(ent.hash) : undefined;
      return row ? cachedUrl(row) : url;
    });
    return { ...it, images, thumbnail: images[0] ?? it.thumbnail };
  });
}

// Deferred, memory-heavy image step: download + decode + store the sources not
// yet cached, so the NEXT request's rewrite can serve them. This is the ONLY
// place a decode happens on the news path, and it runs AFTER the response via
// waitUntil — so even if a source slips the size caps and OOMs the isolate, the
// feed was already delivered. Bounded and one-at-a-time (MAX_CACHE_PER_REQUEST +
// a wall-clock budget) so a slow or hostile source can't extend the warm forever.
async function warmImageCache(items: VerseNewsItem[]): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return; // misconfigured → nothing to warm
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { entries, cached } = await loadImageCache(admin, items);
  if (!entries.length) return;

  const deadline = Date.now() + CACHE_WARM_BUDGET_MS;
  const misses = entries.filter((e) => !cached.has(e.hash)).slice(0, MAX_CACHE_PER_REQUEST);
  const freshlyCached: CacheRow[] = [];
  for (const [i, e] of misses.entries()) {
    if (Date.now() >= deadline) {
      console.warn(`verse_image_cache: warm budget spent, ${misses.length - i} miss(es) deferred`);
      break;
    }
    try {
      const row = await cacheOne(admin, e.hash, e.ext, e.sample);
      if (row) freshlyCached.push(row);
    } catch (err) {
      // One bad image must never cost the whole warm pass.
      console.error(`cacheOne failed for ${e.hash}:`, err);
    }
  }
  if (freshlyCached.length) {
    await admin.from('verse_image_cache').upsert(freshlyCached, { onConflict: 'source_key' });
  }
}

// --------------------- Starscape wallpaper capture (#133) ---------------------
// Metadata-only: record the ORIGINAL full-res CDN url of every media.rsi news
// image in `verse_wallpapers`, deduped by CDN id. NO image bytes are stored —
// the gallery hotlinks RSI directly (maintainer directive: keep DB/storage
// lean; `source.<ext>` is the verified largest variant, ~4× the cover).
// Runs on the raw `news` urls in the deferred pass; warmImageCache no longer
// rewrites them in place, so this reads real media.rsi urls regardless of order.
//
// Visual duplicates are handled by GROUPING, not by rejection (feedback
// fcd956cf). Capture used to drop a candidate whose `perceptual-hash.ts` dHash
// was within 48 bits of a stored row. That check is gone, for two reasons:
//
//   1. It could not see the duplicates that were actually on screen. RSI
//      republishes one artwork in several CROPS (21:9, 16:9, square, HUD-framed
//      banner) and a crop shifts every cell of a global layout hash — measured
//      on the live table, the four visibly duplicated pairs sat 78-115 bits
//      apart while the threshold was 48. `variant-signature.ts` replaces it.
//   2. Rejecting is first-capture-wins, so a 1280px crop arriving first would
//      permanently lock out the 5852px one. Grouping picks the largest member
//      afterwards, which is what the maintainer asked for.
//
// `phash` is still written — it is what `scripts/wallpaper-dedupe.mjs` reads and
// it costs nothing extra, riding along on the same decode.

const MEDIA_URL_RE = /^https:\/\/media\.robertsspaceindustries\.com\/([^/]+)\/[^/.]+(\.[a-zA-Z0-9]+)$/;

// A comm-link body embeds inline icons, section patterns, logos and even trailer
// videos next to its hero artwork — the wiki API returns them all in one `images`
// array with no role hint. Two cheap, robust signals separate real wallpapers
// from that noise (verified against live capture data, #133 follow-up):
//   1. Format — only raster photos are wallpaper material. .mp4 trailers and
//      .gif/.svg UI assets are not (the extension gate skips a needless HEAD).
//   2. Byte size — inline icons/patterns are 2–3 KB; every real RSI wallpaper
//      observed is ≥190 KB. 100 KB cleanly splits the two via CDN content-length.
const WALLPAPER_EXT_RE = /^\.(jpe?g|png|webp)$/i;
const WALLPAPER_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MIN_WALLPAPER_BYTES = 100_000;
// A real desktop wallpaper is large and roughly landscape. Inline UI art, Twitch
// grabs, emoji/logo tiles and flat colour/pattern swatches fail one of these gates
// (feedback b5e070df: "minimum pixel count + must not be just a pattern/icon").
// These only ever ADD rejections — an unreadable size never empties the gallery.
const MIN_WALLPAPER_WIDTH = 1280;
const MIN_WALLPAPER_HEIGHT = 720;
const MIN_WALLPAPER_ASPECT = 1.2; // taller than ~5:4 → poster/portrait, not wallpaper
const MAX_WALLPAPER_ASPECT = 2.6; // wider than ~21:9 → banner/strip, not wallpaper
const WALLPAPER_PROBE_BYTES = 65_536;
const WALLPAPER_HEAD_TIMEOUT_MS = 6000;

interface WallpaperRow {
  image_id: string;
  source_url: string;
  preview_url: string;
  title: string | null;
  series: string | null;
  article_url: string;
  published_at: string | null;
  /** 256-bit dHash of the picture; null when the format could not be decoded. */
  phash: string | null;
  /**
   * Largest known pixel size of the artwork — the ORIGINAL's header when it
   * could be read, else the decoded cover's. Decides which member of a variant
   * group is the representative, and lets a client match its screen shape.
   */
  width: number | null;
  height: number | null;
  /** Encoded crop-tolerant signature (`variant-signature.ts`), or null. */
  thumb: string | null;
}

// HEAD the original CDN url and keep it only if it is a raster image of wallpaper
// size. Any failure (network, timeout, missing/odd headers) is treated as "not a
// wallpaper": the row is skipped and retried on the next crawl, so unverified
// noise never reaches the public gallery.
//
// Answers the ORIGINAL's pixel size on the way through — the ranged GET already
// carries the header bytes, and the variant grouper needs those numbers. `{}`
// means "a wallpaper, but the size header could not be read"; null means "not a
// wallpaper".
async function readWallpaperMedia(
  sourceUrl: string,
): Promise<{ width: number | null; height: number | null } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WALLPAPER_HEAD_TIMEOUT_MS);
  try {
    // One ranged GET gives us the content-type, the total size (Content-Range)
    // AND the leading bytes we need to read the pixel dimensions — no second
    // request. A valid Referer unlocks the CDN for non-browser clients.
    const res = await fetch(sourceUrl, {
      headers: { Range: `bytes=0-${WALLPAPER_PROBE_BYTES - 1}`, Referer: RSI_BASE + '/' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null; // 200 (full) or 206 (partial) both fine
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!WALLPAPER_CONTENT_TYPES.has(contentType)) return null;
    const total = totalSize(res);
    if (total > 0 && total < MIN_WALLPAPER_BYTES) return null;

    const head = new Uint8Array(await res.arrayBuffer());
    const dim = safeImageDimensions(head);
    if (dim) {
      // Confidently-bad size/shape → reject. Unknown dims fall through to the
      // size/type verdict above (never stricter than before).
      if (dim.w < MIN_WALLPAPER_WIDTH || dim.h < MIN_WALLPAPER_HEIGHT) return null;
      const aspect = dim.w / dim.h;
      if (aspect < MIN_WALLPAPER_ASPECT || aspect > MAX_WALLPAPER_ASPECT) return null;
      return { width: dim.w, height: dim.h };
    }
    return { width: null, height: null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Total resource size from a ranged response: prefer Content-Range's "/<total>",
// else Content-Length (which, on a 206, is only the partial length).
function totalSize(res: Response): number {
  const cr = res.headers.get('content-range'); // e.g. "bytes 0-65535/1234567"
  if (cr) {
    const slash = cr.lastIndexOf('/');
    const n = slash >= 0 ? Number(cr.slice(slash + 1)) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return Number(res.headers.get('content-length') ?? '0');
}

// Header-only size read (no decode) — shared with the variant pipeline, which
// uses it to refuse an image that is too large to decode safely.
function safeImageDimensions(b: Uint8Array): { w: number; h: number } | null {
  try {
    return readImageSize(b);
  } catch {
    return null;
  }
}

// Header checks (above) catch wrong format/size/aspect, but let through images
// that are technically big landscape rasters yet visually broken: truncated /
// corrupted JPEGs that render as glitch blocks, or near-blank pattern
// backgrounds with no real subject. `scoreWallpaper` (wallpaper-quality.ts)
// inspects decoded pixels to catch those. See module header for calibration.
// Bounds decode+score work per crawl. These decodes now run in the deferred pass
// (after the response), sharing that isolate's heap with warmImageCache's decodes
// — a big content batch (54 candidates the day this 546'd) must not stack 12
// decodes' worth of RGBA under the cache-warm decodes. An OOM there no longer
// fails the feed, but still recycles the worker, so the cap remains worthwhile. 6
// drains any backlog within a few crawls (stored ids are skipped; articles linger
// in the feed for weeks).
const MAX_CONTENT_SCORED_PER_RUN = 6;
const WALLPAPER_CONTENT_TIMEOUT_MS = 10_000;

// Decode + content-score a candidate's FULL cover image (the cover variant is
// ≤1140px wide — plenty for the scorer's internal 256px downscale — and far
// cheaper to fetch/decode than the multi-MB `source` original).
//
// Decoder choice (#133): npm:jpeg-js for JPEG, npm:pngjs for PNG — both pure
// JS, no wasm/native deps, safe on Supabase Edge (Deno). WebP has no
// lightweight pure-JS decoder available, so WebP candidates are accepted on
// header checks alone (content check skipped, logged) rather than pulling in
// a wasm decoder for one format.
//
// Decode-throw policy (parity-evidenced): a Node harness ran jpeg-js/pngjs
// against all 26 calibration images (wave-0 scratchpad, incl. all 6 known-bad
// rows) and reproduced the sharp-based verdicts 26/26 with ZERO decode
// throws. There is no observed case of a passing-header image throwing, so we
// keep the documented default behaviour: treat a decode throw as a reject for
// *this* crawl only. The row simply retries next crawl (identical semantics
// to any other captureWallpapers rejection), so a transient decode hiccup can
// never permanently drop a real wallpaper.
//
// The decoded pixels also yield the row's signatures — the perceptual hash
// (perceptual-hash.ts) and the crop-tolerant variant thumbnail
// (variant-signature.ts) both ride along on this one decode instead of costing
// a second fetch. A skipped or failed check yields neither, and a null
// signature never matches, so such an image is kept on its own rather than
// silently grouped away.
interface ContentVerdict {
  ok: boolean;
  phash: string | null;
  thumb: string | null;
  /** Cover dimensions — the fallback size when the original's header was unreadable. */
  coverWidth: number | null;
  coverHeight: number | null;
}

const SKIPPED_CONTENT: ContentVerdict = {
  ok: true,
  phash: null,
  thumb: null,
  coverWidth: null,
  coverHeight: null,
};
const FAILED_CONTENT: ContentVerdict = { ...SKIPPED_CONTENT, ok: false };

async function contentCheck(row: {
  image_id: string;
  preview_url: string;
}): Promise<ContentVerdict> {
  const ext = row.preview_url.slice(row.preview_url.lastIndexOf('.')).toLowerCase();
  if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') {
    console.log(`captureWallpapers: content check skipped (${ext || 'unknown ext'}) for ${row.image_id}`);
    return SKIPPED_CONTENT;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WALLPAPER_CONTENT_TIMEOUT_MS);
  try {
    const res = await fetch(row.preview_url, {
      headers: { Referer: RSI_BASE + '/' },
      signal: ctrl.signal,
    });
    if (!res.ok) return FAILED_CONTENT;
    const buf = new Uint8Array(await res.arrayBuffer());
    let rgba: Uint8Array;
    let width: number;
    let height: number;
    if (ext === '.jpg' || ext === '.jpeg') {
      // Held to 128 MB (matches image-codecs.ts) so an unexpectedly large cover
      // throws → this crawl rejects the row → retried next crawl, rather than
      // OOMing the isolate. Covers are ≤1140px, so nothing real needs more.
      const decoded = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 128 });
      rgba = decoded.data;
      width = decoded.width;
      height = decoded.height;
    } else {
      const decoded = PNG.sync.read(Buffer.from(buf));
      rgba = decoded.data;
      width = decoded.width;
      height = decoded.height;
    }
    const score = scoreWallpaper(rgba, width, height);
    if (!score.ok) {
      console.log(`captureWallpapers: content-rejected ${row.image_id} [${score.reasons.join(',')}]`);
      return FAILED_CONTENT;
    }
    const thumb = buildThumb(rgba, width, height);
    return {
      ok: true,
      phash: perceptualHash(rgba, width, height),
      thumb: thumb ? encodeThumb(thumb) : null,
      coverWidth: width,
      coverHeight: height,
    };
  } catch (err) {
    console.error(`captureWallpapers: content check threw for ${row.image_id}, rejecting this crawl:`, err);
    return FAILED_CONTENT;
  } finally {
    clearTimeout(timer);
  }
}

// --------------------- Variant grouping (feedback fcd956cf) ---------------------
//
// One artwork, one visible tile — see variant-signature.ts for the signal and
// the calibration, and 20260903170000_verse_wallpapers_variant_groups.sql for
// what the roles mean.
//
// Two bounded passes ride the same deferred budget as capture:
//
//   backfill — rows written before signatures existed carry `thumb = null` and
//              cannot be grouped. Each crawl thumbnails a few of them, sharing
//              MAX_CONTENT_SCORED_PER_RUN with new candidates so the total
//              number of decodes per crawl never rises above what it was. 49
//              live rows drain in ~9 crawls, and the pass is self-terminating:
//              once every row has a signature it costs one column read.
//   regroup  — recompute groups over the working set and write back only the
//              rows that actually moved. `groupVariants` is order-independent
//              and deterministic, so a steady state writes nothing at all.

/**
 * How many of the newest rows take part in grouping.
 *
 * Grouping is O(n^2) pairs (~200 ms for 1176 pairs measured on the live data),
 * so it is capped rather than left to grow with the table. RSI re-crops an
 * artwork inside a release cycle, not a year later, so a window of the newest
 * rows loses nothing real — and an older row simply keeps the grouping it was
 * last given.
 */
const VARIANT_WINDOW_ROWS = 240;

/** One row of the grouping working set, as read from the table. */
interface VariantRow {
  image_id: string;
  preview_url: string;
  thumb: string | null;
  width: number | null;
  height: number | null;
  variant_group: string | null;
  variant_role: string;
}

/**
 * Thumbnail up to `budget` rows that have no signature yet.
 *
 * Mutates the given rows in place so the regroup that follows sees the fresh
 * signatures without a second read. Returns how many rows gained one.
 */
async function backfillVariantSignatures(
  admin: SupabaseClient,
  rows: VariantRow[],
  budget: number,
): Promise<number> {
  if (budget <= 0) return 0;
  const pending = rows.filter((r) => !r.thumb).slice(0, budget);
  if (pending.length === 0) return 0;
  let filled = 0;
  for (const row of pending) {
    const verdict = await contentCheck(row);
    // A row that fails the content check today is left alone: it keeps
    // `thumb = null`, stays `single`, and is retried on a later crawl. The
    // gallery never loses it — an ungrouped row is a fully visible row.
    if (!verdict.thumb) continue;
    row.thumb = verdict.thumb;
    row.width ??= verdict.coverWidth;
    row.height ??= verdict.coverHeight;
    const { error } = await admin
      .from('verse_wallpapers')
      .update({ thumb: row.thumb, width: row.width, height: row.height })
      .eq('image_id', row.image_id);
    if (error) {
      console.error(`variant backfill: update failed for ${row.image_id}:`, error.message);
      continue;
    }
    filled++;
  }
  if (filled > 0) {
    const left = rows.filter((r) => !r.thumb).length;
    console.log(`variant backfill: signed ${filled} row(s), ${left} still without a signature`);
  }
  return filled;
}

/** Recompute groups over the working set and persist only what moved. */
async function regroupVariants(admin: SupabaseClient, rows: VariantRow[]): Promise<void> {
  const members: VariantMember[] = rows.map((r) => ({
    imageId: r.image_id,
    thumb: decodeThumb(r.thumb),
    width: r.width,
    height: r.height,
  }));
  let assignments: VariantAssignment[];
  try {
    assignments = groupVariants(members);
  } catch (err) {
    console.error('regroupVariants: grouping failed, leaving roles untouched:', err);
    return;
  }
  const current = new Map(rows.map((r) => [r.image_id, r]));
  const moved = assignments.filter((a) => {
    const row = current.get(a.imageId);
    if (!row) return false;
    // A `single` row keeps a null group — the column then reads "not grouped",
    // exactly what a freshly captured row looks like.
    const group = a.role === 'single' ? null : a.group;
    return row.variant_role !== a.role || (row.variant_group ?? null) !== group;
  });
  if (moved.length === 0) return;
  for (const a of moved) {
    const group = a.role === 'single' ? null : a.group;
    const { error } = await admin
      .from('verse_wallpapers')
      .update({ variant_group: group, variant_role: a.role })
      .eq('image_id', a.imageId);
    if (error) console.error(`regroupVariants: update failed for ${a.imageId}:`, error.message);
  }
  const hidden = assignments.filter((a) => a.role === 'ratio' || a.role === 'duplicate').length;
  console.log(
    `regroupVariants: ${moved.length} row(s) re-roled, ${hidden} of ${assignments.length} now hidden from the flat gallery`,
  );
}

async function captureWallpapers(items: VerseNewsItem[]): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return; // misconfigured → skip silently
  try {
    const rows = new Map<string, WallpaperRow>();
    for (const it of items) {
      // Only comm-link/patch articles carry the hero artwork worth keeping;
      // youtube thumbs and spectrum previews are not wallpaper material.
      if (it.source !== 'comm-link' && it.source !== 'patch-notes') continue;
      for (const url of it.images ?? []) {
        const m = MEDIA_URL_RE.exec(url);
        if (!m) continue;
        const [, id, ext] = m;
        if (!WALLPAPER_EXT_RE.test(ext)) continue; // .mp4/.gif/.svg → not wallpaper material
        if (rows.has(id)) continue;
        const base = `https://media.robertsspaceindustries.com/${id}/`;
        rows.set(id, {
          image_id: id,
          source_url: `${base}source${ext}`,
          preview_url: `${base}cover${ext}`,
          title: it.title || null,
          series: it.category ?? null,
          article_url: it.url,
          published_at: it.publishedAt || null,
          phash: null, // filled by contentCheck() from the decoded pixels
          width: null, // filled by readWallpaperMedia() from the original header
          height: null,
          thumb: null, // filled by contentCheck() from the decoded pixels
        });
      }
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    // Ids the gallery already holds. A failed read degrades to "gallery looks
    // empty": the crawl still captures, it just cannot skip this round.
    const { data: existing, error: readErr } = await admin
      .from('verse_wallpapers')
      .select('image_id');
    if (readErr) console.error('captureWallpapers: gallery read failed:', readErr.message);
    const knownIds = new Set(((existing ?? []) as { image_id: string }[]).map((r) => r.image_id));

    // Candidates already in the gallery are dropped HERE, before any network
    // work. They used to run the whole HEAD + download + decode gauntlet only
    // for `ignoreDuplicates` to throw the result away — and, since an article
    // stays in the feed for weeks, they consumed the MAX_CONTENT_SCORED_PER_RUN
    // budget every single crawl, deferring genuinely new artwork behind images
    // the gallery already had.
    const fresh = [...rows.values()].filter((row) => !knownIds.has(row.image_id));
    if (fresh.length < rows.size) {
      console.log(`captureWallpapers: ${rows.size - fresh.length} candidate(s) already in the gallery`);
    }
    let spentDecodes = 0;
    let inserted = 0;
    if (fresh.length > 0) {
      // Verify each candidate really is wallpaper-sized artwork before it reaches
      // the public gallery — this is what keeps inline icons/patterns/videos out (#133).
      const verified = await Promise.all(
        fresh.map(async (row) => {
          const media = await readWallpaperMedia(row.source_url);
          return media ? { ...row, width: media.width, height: media.height } : null;
        }),
      );
      const keep = verified.filter((row): row is WallpaperRow => row !== null);
      // Content-score at most MAX_CONTENT_SCORED_PER_RUN header-passed candidates
      // per run to bound CPU. Anything beyond the cap is skipped this run (not
      // upserted) and simply retried on the next crawl if the article is still in
      // the feed — same retry semantics as a header-check failure above.
      const toScore = keep.slice(0, MAX_CONTENT_SCORED_PER_RUN);
      if (keep.length > toScore.length) {
        console.log(
          `captureWallpapers: ${keep.length - toScore.length} header-passed candidate(s) deferred to next crawl (per-run cap)`,
        );
      }
      spentDecodes = toScore.length;
      const scored = await Promise.all(
        toScore.map(async (row) => {
          const verdict = await contentCheck(row);
          if (!verdict.ok) return null;
          return {
            ...row,
            phash: verdict.phash,
            thumb: verdict.thumb,
            // The original's header is the truth when it could be read; the
            // decoded cover is the fallback so a row is never sizeless.
            width: row.width ?? verdict.coverWidth,
            height: row.height ?? verdict.coverHeight,
          };
        }),
      );
      const passed = scored.filter((row): row is WallpaperRow => row !== null);
      if (passed.length > 0) {
        // First capture wins — rows are immutable source metadata, so duplicate
        // ids from later crawls are ignored instead of churning updated_at.
        const { error } = await admin
          .from('verse_wallpapers')
          .upsert(passed, { onConflict: 'image_id', ignoreDuplicates: true });
        if (error) console.error('captureWallpapers upsert failed:', error.message);
        else inserted = passed.length;
      }
    }
    await maintainVariantGroups(admin, MAX_CONTENT_SCORED_PER_RUN - spentDecodes, inserted > 0);
  } catch (err) {
    // Best-effort side effect — never fail the news feed for the gallery.
    console.error('captureWallpapers failed:', err);
  }
}

/**
 * Keep `variant_group` / `variant_role` true for the newest rows.
 *
 * Runs on every crawl, including the ones that capture nothing — that is the
 * whole point, since the rows that need fixing were written months before
 * signatures existed. Costs one indexed read when there is nothing to do.
 */
async function maintainVariantGroups(
  admin: SupabaseClient,
  decodeBudget: number,
  capturedSomething: boolean,
): Promise<void> {
  const { data, error } = await admin
    .from('verse_wallpapers')
    .select('image_id, preview_url, thumb, width, height, variant_group, variant_role')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('image_id', { ascending: false })
    .limit(VARIANT_WINDOW_ROWS);
  if (error) {
    console.error('maintainVariantGroups: read failed:', error.message);
    return;
  }
  const rows = (data ?? []) as VariantRow[];
  if (rows.length === 0) return;
  const filled = await backfillVariantSignatures(admin, rows, decodeBudget);
  // Nothing new and nothing newly signed means the last grouping still stands —
  // skip the O(n^2) pass entirely rather than recomputing the same answer.
  if (filled === 0 && !capturedSomething) return;
  await regroupVariants(admin, rows);
}

// --------------------- Video retention sweep (feedback e7082310) ---------------------
// The feed itself is already trimmed in fetchYouTube(); this is the storage
// side of the same rule — the `news-images` bucket must not keep growing with
// thumbnails of videos nobody can see any more.
//
// Two halves, both best-effort and both scoped to VIDEOS only:
//   1. tagVideoImages  — stamps the cache row of every live video thumbnail
//      with that video's publish date. Without the stamp there is no way to
//      tell a video thumbnail from comm-link artwork (the cache key is a SHA-1
//      of the source url, which cannot be reversed), and article artwork must
//      never be deleted by this sweep.
//   2. pruneVideoImages — removes the stored objects + cache row of every
//      stamped image whose video has aged out of the window.
//
// Rows cached before this shipped carry no stamp: those still in the feed get
// one on the next run, the rest stay (a bounded, one-time residue of ~30 KB
// YouTube thumbnails — not worth a risky heuristic that could delete article art).

const VIDEO_PRUNE_LIMIT = 40; // bound the per-request delete work

/** Cache key (storage folder) → publish date, for every video thumbnail in the feed. */
async function videoImageKeys(items: VerseNewsItem[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const it of items) {
    if (it.source !== 'youtube') continue;
    if (!Number.isFinite(Date.parse(it.publishedAt))) continue;
    for (const url of it.images ?? []) {
      // This runs on the raw `news` urls (the deferred pass no longer rewrites
      // them in place), so the key is normally the sha1 of the source identity —
      // the same key warmImageCache/rewriteToCachedImages derive. The public-copy
      // branch stays as a safety net for any already-cached url that reaches here.
      const key = url.startsWith(`${PUBLIC_BASE}/`)
        ? url.slice(PUBLIC_BASE.length + 1).split('/')[0]
        : await sha1Hex(imageIdentity(url).base);
      if (key) out.set(key, it.publishedAt);
    }
  }
  return out;
}

async function tagVideoImages(admin: SupabaseClient, items: VerseNewsItem[]): Promise<void> {
  const keys = await videoImageKeys(items);
  if (!keys.size) return;
  const { data, error } = await admin
    .from('verse_image_cache')
    .select('source_key, video_published_at')
    .in('source_key', [...keys.keys()]);
  if (error) {
    console.error('tagVideoImages lookup failed:', error.message);
    return;
  }
  const stale = (data ?? []).filter((row) => {
    const want = keys.get(row.source_key as string);
    const have = row.video_published_at as string | null;
    return want && (!have || Date.parse(have) !== Date.parse(want));
  });
  if (!stale.length) return;
  await Promise.allSettled(stale.map((row) =>
    admin
      .from('verse_image_cache')
      .update({ video_published_at: keys.get(row.source_key as string) })
      .eq('source_key', row.source_key),
  ));
}

async function pruneVideoImages(admin: SupabaseClient): Promise<void> {
  const cutoff = new Date(videoRetentionCutoff()).toISOString();
  // `lt` never matches NULL, so untagged rows (all article artwork + pre-stamp
  // legacy rows) are structurally out of reach of this delete.
  const { data, error } = await admin
    .from('verse_image_cache')
    .select('source_key')
    .lt('video_published_at', cutoff)
    .limit(VIDEO_PRUNE_LIMIT);
  if (error) {
    console.error('pruneVideoImages lookup failed:', error.message);
    return;
  }
  const keys = (data ?? []).map((r) => r.source_key as string).filter(Boolean);
  if (!keys.length) return;

  // List the folder instead of assuming file names: the stored variant set has
  // changed before and a hardcoded name would silently orphan the real objects.
  const removed: string[] = [];
  await Promise.allSettled(keys.map(async (key) => {
    const { data: files, error: listErr } = await admin.storage.from(IMG_BUCKET).list(key);
    if (listErr) throw new Error(listErr.message);
    const paths = (files ?? []).map((f) => `${key}/${f.name}`);
    if (paths.length) {
      const { error: rmErr } = await admin.storage.from(IMG_BUCKET).remove(paths);
      // Keep the row when the objects survive — the row is the ONLY handle on
      // them, so dropping it first would orphan the bytes forever. Retry next run.
      if (rmErr) throw new Error(rmErr.message);
    }
    removed.push(key);
  }));
  if (!removed.length) return;
  const { error: delErr } = await admin.from('verse_image_cache').delete().in('source_key', removed);
  if (delErr) console.error('pruneVideoImages row delete failed:', delErr.message);
  else console.log(`pruneVideoImages: dropped ${removed.length} expired video image(s)`);
}

async function enforceVideoRetention(items: VerseNewsItem[]): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return; // misconfigured → skip silently
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    await tagVideoImages(admin, items);
    await pruneVideoImages(admin);
  } catch (err) {
    // Housekeeping must never take the news feed down with it.
    console.error('enforceVideoRetention failed:', err);
  }
}

// Run best-effort work AFTER the response is flushed. EdgeRuntime.waitUntil keeps
// the isolate alive until the promise settles (Supabase Edge / Deno Deploy), so
// the deferred decode/DB work runs to completion without the client waiting on it
// — and without an OOM in it being able to fail the already-sent response. Where
// the global is absent (local `deno test` / dev) it degrades to fire-and-forget.
function scheduleDeferred(work: () => Promise<void>): void {
  const p = work().catch((err) => console.error('deferred work failed:', err));
  (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime?.waitUntil?.(p);
}

// --------------------- Server ---------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const [commLinks, youtube, spectrum, patchNotes, status] = await Promise.all([
    fetchCommLinks(),
    fetchYouTube(),
    fetchSpectrum(),
    fetchPatchNotes(),
    fetchStatus(),
  ]);

  const news = [...commLinks, ...youtube, ...spectrum, ...patchNotes]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  // Response path is DECODE-FREE: rewrite each item to the cached image copies the
  // index already holds (a DB lookup, no downloads). Everything memory-heavy —
  // wallpaper capture, cache WARMING, video retention — is deferred to AFTER the
  // response via waitUntil, so a decoder OOM can never take the feed down again
  // (the 546 outage class). `rewriteToCachedImages` returns a COPY; `news` keeps
  // its raw upstream urls, which the deferred work needs.
  let responseNews = news;
  try {
    responseNews = await rewriteToCachedImages(news);
  } catch (err) {
    console.error('rewriteToCachedImages failed, serving raw urls:', err);
  }

  const response = new Response(
    JSON.stringify({ status, news: responseNews, fetchedAt: new Date().toISOString() }),
    {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=900',
      },
    },
  );

  // Best-effort side effects, deferred until after the response is committed, on
  // `news` (raw upstream urls). captureWallpapers records full-res wallpaper
  // metadata from the raw media urls (#133); warmImageCache downloads+decodes the
  // sources the rewrite above couldn't serve yet, populating the cache for the
  // next request; enforceVideoRetention stamps/prunes video thumbnails (e7082310).
  // Order is no longer load-bearing (warmImageCache doesn't rewrite in place), but
  // capture stays first by convention. Each is independently guarded.
  scheduleDeferred(async () => {
    try { await captureWallpapers(news); } catch (err) { console.error('captureWallpapers failed:', err); }
    try { await warmImageCache(news); } catch (err) { console.error('warmImageCache failed:', err); }
    try { await enforceVideoRetention(news); } catch (err) { console.error('enforceVideoRetention failed:', err); }
  });

  return response;
});
