// fetch-verse-news — aggregates RSI Comm-Link, Patch-Notes, YouTube, Spectrum
// and the real RSI Status page into one VerseFeed JSON.
// JWT verification is on — only authenticated users can hit it.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

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
    await backfillMissingImages(items);
    return items;
  } catch (err) {
    console.error('fetchCommLinks failed:', err);
    return [];
  }
}

// Some comm-links come back from the wiki API with an empty `images` array even
// though the RSI page has a hero image — the "Roadmap Roundup" series is the
// recurring offender (every entry: images_count 0). For those, scrape the
// permalink's og:image so the card still gets a thumbnail. The og:image is a
// media-CDN url, so the existing variant/cache pipeline handles it unchanged.
const OG_FETCH_TIMEOUT_MS = 6000;
const MAX_OG_FALLBACK = 10;

async function backfillMissingImages(items: VerseNewsItem[]): Promise<void> {
  const missing = items
    .filter((it) => !it.images?.length && it.url.startsWith(RSI_BASE))
    .slice(0, MAX_OG_FALLBACK);
  if (!missing.length) return;
  await Promise.allSettled(missing.map(async (it) => {
    const og = await fetchOgImage(it.url);
    if (og) {
      it.images = [og];
      it.thumbnail = og;
    }
  }));
}

// Extract a social-share image (og:image / twitter:image / link rel=image_src)
// from an RSI permalink. Comm-link transmission pages are client-rendered, so the
// hero never appears in the static body — this <head> meta is the only image we can
// scrape server-side. Only RSI-hosted urls are accepted: the page is untrusted
// content, so we never surface an arbitrary external image url from it.
async function fetchOgImage(pageUrl: string): Promise<string | undefined> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OG_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(pageUrl, {
      headers: { 'Accept': 'text/html', 'User-Agent': 'SC-Companion/0.3 (+news-og-fallback)' },
      signal: ctrl.signal,
    });
    if (!res.ok) return undefined;
    const html = await res.text();
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
    if (typeof url === 'string' && url && !seen.has(url)) {
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
    return entries.map((m) => {
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

async function fetchSpectrum(): Promise<VerseNewsItem[]> {
  try {
    const res = await fetch(SPECTRUM_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Tavern-Id': String(SPECTRUM_CHANNEL_ID),
        'User-Agent': 'SC-Companion/0.3 (+https://sc-companion.vercel.app)',
      },
      body: JSON.stringify({ channel_id: SPECTRUM_CHANNEL_ID, page: 1, sort: 'newest' }),
    });
    if (!res.ok) throw new Error(`spectrum HTTP ${res.status}`);
    const json = await res.json();
    const threads: Record<string, unknown>[] = Array.isArray(json?.data?.threads) ? json.data.threads : [];
    const out: VerseNewsItem[] = [];
    for (const t of threads) {
      const id = t['id'];
      const subject = t['subject'];
      const slug = t['slug'];
      // time_created is a Unix timestamp in **seconds**.
      const created = Number(t['time_created']);
      // Skip malformed entries instead of fabricating ids/dates/urls — a synthetic
      // id (crypto.randomUUID) would change every fetch and falsely trip the
      // client's "new posts" counter; a missing slug yields a dead thread link.
      if (!id || typeof subject !== 'string' || !subject.trim() ||
          typeof slug !== 'string' || !slug || !Number.isFinite(created)) continue;
      const image = spectrumImageUrl(t['media_preview']);
      out.push({
        id: 'spec-' + String(id),
        title: subject,
        url: `${RSI_BASE}/spectrum/community/SC/forum/${SPECTRUM_CHANNEL_ID}/thread/${slug}`,
        publishedAt: new Date(created * 1000).toISOString(),
        channel: 'spectrum',
        source: 'spectrum',
        category: 'Spectrum',
        // First-post hero from media_preview; absent → client spectrum default.
        ...(image ? { thumbnail: image, images: [image] } : {}),
      });
      if (out.length >= 12) break;
    }
    return out;
  } catch (err) {
    console.error('fetchSpectrum failed:', err);
    return [];
  }
}

// --------------------- Status (HTML scrape) ---------------------
const STATUS_LABEL_MAP: Record<string, StatusLevel> = {
  'operational': 'operational',
  'degraded performance': 'degraded',
  'degraded': 'degraded',
  'partial outage': 'partial_outage',
  'partial': 'partial_outage',
  'major outage': 'major_outage',
  'major': 'major_outage',
  'under maintenance': 'maintenance',
  'maintenance': 'maintenance',
};

const STATUS_PRIORITY: Record<StatusLevel, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
  unknown: -1,
};

function parseStatusLevel(raw: string): StatusLevel {
  const k = raw.toLowerCase().trim();
  return STATUS_LABEL_MAP[k] ?? 'unknown';
}

async function fetchStatus(): Promise<VerseStatus | null> {
  try {
    const res = await fetch(STATUS_PAGE_URL, {
      headers: { 'Accept': 'text/html', 'User-Agent': 'SC-Companion/0.3' },
    });
    if (!res.ok) throw new Error(`status HTTP ${res.status}`);
    const html = await res.text();
    // Statuspage components: <div class="component-inner-container ..." data-component-status="operational">
    //   <span class="name">Persistent Universe</span>
    //   <span class="component-status">Operational</span>
    // </div>
    const containerRe = /<div[^>]*class="[^"]*component-inner-container[^"]*"[^>]*data-component-status="([a-z_]+)"[\s\S]*?<span[^>]*class="name"[^>]*>([\s\S]*?)<\/span>/gi;
    const components: VerseStatusComponent[] = [];
    let m: RegExpExecArray | null;
    while ((m = containerRe.exec(html)) !== null) {
      const status = parseStatusLevel(m[1]);
      const name = cleanXml(m[2].replace(/<[^>]+>/g, '')).trim();
      if (name && status !== 'unknown') components.push({ name, status });
    }
    // Overall from page-status data attribute, fallback = worst component.
    const overallMatch = html.match(/class="page-status[^"]*status-([a-z_]+)"/i) || html.match(/data-page-status="([a-z_]+)"/i);
    let overall: StatusLevel = overallMatch ? parseStatusLevel(overallMatch[1]) : 'unknown';
    if (overall === 'unknown' && components.length) {
      overall = components.reduce<StatusLevel>((acc, c) => {
        return STATUS_PRIORITY[c.status] > STATUS_PRIORITY[acc] ? c.status : acc;
      }, 'operational');
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
// client our own durable url instead. Two variants are stored per source so the
// client's responsive srcset (post≤500w / cover≤1140w) keeps working.

const IMG_BUCKET = 'news-images';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUBLIC_BASE = `${SUPABASE_URL}/storage/v1/object/public/${IMG_BUCKET}`;
// Cap synchronous downloads per request so a cold cache can't blow the function
// timeout; the cache warms over a few request cycles, raw urls serve meanwhile.
const MAX_CACHE_PER_REQUEST = 16;
const IMG_FETCH_TIMEOUT_MS = 8000;

// Swap the variant segment of an RSI **media** CDN url (mirrors the client's
// rsiVariant). Other urls (signed proxy, ytimg, …) have no variant → unchanged.
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
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return null;
    const ct = res.headers.get('content-type') ?? `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    return { bytes, ct };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Download + store both variants of one source image. Returns true on success.
async function cacheOne(admin: SupabaseClient, hash: string, ext: string, sample: string): Promise<boolean> {
  const postSrc = mediaVariant(sample, 'post');
  const coverSrc = mediaVariant(sample, 'cover');
  let post = await fetchImage(postSrc, ext);
  // Non-media urls have one variant; reuse it for both keys.
  let cover = postSrc === coverSrc ? post : await fetchImage(coverSrc, ext);
  post = post ?? cover;
  cover = cover ?? post;
  if (!post || !cover) return false;

  const up = (variant: 'post' | 'cover', d: { bytes: Uint8Array; ct: string }) =>
    admin.storage.from(IMG_BUCKET).upload(`${hash}/${variant}.${ext}`, d.bytes, {
      contentType: d.ct,
      upsert: true,
      cacheControl: '31536000',
    });
  const [r1, r2] = await Promise.all([up('post', post), up('cover', cover)]);
  return !r1.error && !r2.error;
}

// Rewrite every item's image urls to our cached cover url where available.
// Misses (over the per-request cap or failed download) keep their raw RSI url so
// the card still has a chance to render and gets cached next cycle.
async function cacheImages(items: VerseNewsItem[]): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return; // misconfigured → leave raw urls untouched

  // Unique source identities across all items.
  const byBase = new Map<string, { ext: string; sample: string }>();
  for (const it of items) {
    for (const url of it.images ?? []) {
      const { base, ext } = imageIdentity(url);
      if (!byBase.has(base)) byBase.set(base, { ext, sample: url });
    }
  }
  if (!byBase.size) return;

  const entries = await Promise.all(
    [...byBase.entries()].map(async ([base, v]) => ({ base, ...v, hash: await sha1Hex(base) })),
  );
  const entByBase = new Map(entries.map((e) => [e.base, e]));

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Batch "already cached?" check.
  const cached = new Set<string>();
  const { data, error } = await admin
    .from('verse_image_cache')
    .select('source_key')
    .in('source_key', entries.map((e) => e.hash));
  if (error) {
    console.error('verse_image_cache lookup failed:', error.message);
    return; // index unreachable → leave raw urls, don't risk partial rewrites
  }
  for (const r of data ?? []) cached.add(r.source_key as string);

  // Download misses, bounded.
  const misses = entries.filter((e) => !cached.has(e.hash)).slice(0, MAX_CACHE_PER_REQUEST);
  const freshlyCached: { source_key: string; ext: string }[] = [];
  await Promise.allSettled(
    misses.map(async (e) => {
      if (await cacheOne(admin, e.hash, e.ext, e.sample)) {
        cached.add(e.hash);
        freshlyCached.push({ source_key: e.hash, ext: e.ext });
      }
    }),
  );
  if (freshlyCached.length) {
    await admin.from('verse_image_cache').upsert(freshlyCached, { onConflict: 'source_key' });
  }

  // Rewrite to cached cover urls; thumbnail tracks images[0].
  for (const it of items) {
    if (!it.images) continue;
    it.images = it.images.map((url) => {
      const ent = entByBase.get(imageIdentity(url).base);
      return ent && cached.has(ent.hash) ? `${PUBLIC_BASE}/${ent.hash}/cover.${ent.ext}` : url;
    });
    it.thumbnail = it.images[0] ?? it.thumbnail;
  }
}

// --------------------- Server ---------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const [commLinks, youtube, spectrum, status] = await Promise.all([
    fetchCommLinks(),
    fetchYouTube(),
    fetchSpectrum(),
    fetchStatus(),
  ]);

  const news = [...commLinks, ...youtube, ...spectrum]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  // Replace upstream RSI image urls with our durable cached copies (best-effort).
  await cacheImages(news);

  const payload = {
    status,
    news,
    fetchedAt: new Date().toISOString(),
  };

  return new Response(JSON.stringify(payload), {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300, s-maxage=900',
    },
  });
});
