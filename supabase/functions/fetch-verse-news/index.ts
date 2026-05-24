// fetch-verse-news — aggregates RSI Comm-Link, Patch-Notes, YouTube, Spectrum
// and the real RSI Status page into one VerseFeed JSON.
// JWT verification is on — only authenticated users can hit it.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

type Channel = 'comm-link' | 'spectrum' | 'status' | 'patch' | 'youtube';

interface VerseNewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  channel: Channel;
  summary?: string;
  thumbnail?: string;
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

const COMM_LINK_API = 'https://api.star-citizen.wiki/api/v2/comm-links?limit=40';
const STATUS_PAGE_URL = 'https://status.robertsspaceindustries.com/';
const SPECTRUM_FORUM_URL = 'https://robertsspaceindustries.com/spectrum/community/SC';
// RSI YouTube channel. Default is the RSI handle; override via env if needed.
const RSI_YT_CHANNEL_ID = Deno.env.get('RSI_YOUTUBE_CHANNEL_ID') ?? 'UCxNxIrNRGz0RmkFkjC25HKw';
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
async function fetchCommLinks(): Promise<VerseNewsItem[]> {
  try {
    const res = await fetch(COMM_LINK_API, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`comm-link HTTP ${res.status}`);
    const json = await res.json();
    const items: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : [];
    return items.map((entry) => {
      const series = String(entry['series'] ?? entry['channel'] ?? '').trim();
      const channel = classifyCommLinkChannel(series);
      const slug = typeof entry['slug'] === 'string' ? (entry['slug'] as string) : '';
      const rawUrl = typeof entry['url'] === 'string' ? (entry['url'] as string) : '';
      const fallbackPath = slug ? `/comm-link/${slug}` : '/comm-link';
      return {
        id: String(entry['cig_id'] ?? entry['id'] ?? slug ?? crypto.randomUUID()),
        title: String(entry['title'] ?? 'Untitled'),
        url: normalizeRsiUrl(rawUrl, fallbackPath),
        publishedAt: String(entry['created_at'] ?? entry['published_at'] ?? new Date().toISOString()),
        channel,
        summary: typeof entry['summary'] === 'string' ? entry['summary'] : undefined,
        thumbnail: typeof entry['image_url'] === 'string' ? entry['image_url'] : undefined,
        category: series || undefined,
        source: channel === 'patch' ? 'patch-notes' : 'comm-link',
      } satisfies VerseNewsItem;
    });
  } catch (err) {
    console.error('fetchCommLinks failed:', err);
    return [];
  }
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
        category: 'Video',
        source: 'youtube',
      } satisfies VerseNewsItem;
    });
  } catch (err) {
    console.error('fetchYouTube failed:', err);
    return [];
  }
}

// --------------------- Spectrum (HTML scrape, best-effort) ---------------------
async function fetchSpectrum(): Promise<VerseNewsItem[]> {
  try {
    const res = await fetch(SPECTRUM_FORUM_URL, {
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'SC-Companion/0.3 (+https://sc-companion.vercel.app)',
      },
    });
    if (!res.ok) throw new Error(`spectrum HTTP ${res.status}`);
    const html = await res.text();
    // Spectrum's SPA renders threads client-side, but the initial state dump
    // contains thread previews in a __INITIAL_STATE__ JSON blob. Best-effort
    // parse — if the structure shifts, return empty (no crash).
    const stateMatch = html.match(/__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (!stateMatch) return [];
    try {
      const state = JSON.parse(stateMatch[1]);
      const seen = new Set<string>();
      const threads = findSpectrumThreads(state, [], seen);
      return threads.slice(0, 12);
    } catch {
      return [];
    }
  } catch (err) {
    console.error('fetchSpectrum failed:', err);
    return [];
  }
}

// Recursively look for objects shaped like Spectrum threads: { id, subject/title, slug, created_at }.
// `seen` dedupes by thread id — __INITIAL_STATE__ typically references the same entity in multiple subtrees.
function findSpectrumThreads(node: unknown, out: VerseNewsItem[], seen: Set<string>): VerseNewsItem[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) findSpectrumThreads(child, out, seen);
    return out;
  }
  const obj = node as Record<string, unknown>;
  const subject = typeof obj['subject'] === 'string' ? obj['subject'] : typeof obj['title'] === 'string' ? obj['title'] : null;
  const slug = typeof obj['slug'] === 'string' ? obj['slug'] : null;
  const id = obj['id'] ?? obj['_id'];
  const created = typeof obj['created_at'] === 'string' ? obj['created_at'] : typeof obj['time_created'] === 'string' ? obj['time_created'] : null;
  if (subject && slug && id && created) {
    const key = String(id);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        id: 'spec-' + key,
        title: subject,
        url: `${RSI_BASE}/spectrum/community/SC/forum/1/thread/${slug}`,
        publishedAt: created,
        channel: 'spectrum',
        source: 'spectrum',
        category: 'Spectrum',
      });
    }
  }
  for (const v of Object.values(obj)) findSpectrumThreads(v, out, seen);
  return out;
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
