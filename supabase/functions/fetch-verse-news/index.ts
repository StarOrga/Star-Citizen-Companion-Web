// fetch-verse-news — proxies RSI Comm-Link feed (Star-Citizen-Wiki API) +
// the public RSI status page, returns a unified VerseFeed JSON.
// JWT verification is on — only authenticated users can hit it.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

interface VerseNewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  channel: 'comm-link' | 'spectrum' | 'status' | 'patch';
  summary?: string;
  thumbnail?: string;
  category?: string;
}

interface VerseStatus {
  overall: string;
  services: Array<{ name: string; status: string; updated?: string }>;
  updatedAt: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const COMM_LINK_API = 'https://api.star-citizen.wiki/api/v2/comm-links?limit=30';
const STATUS_RSS = 'https://status.robertsspaceindustries.com/index.xml';

async function fetchCommLinks(): Promise<VerseNewsItem[]> {
  try {
    const res = await fetch(COMM_LINK_API, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`comm-link HTTP ${res.status}`);
    const json = await res.json();
    const items = Array.isArray(json?.data) ? json.data : [];
    return items.map((entry: Record<string, unknown>) => ({
      id: String(entry['cig_id'] ?? entry['id'] ?? entry['slug'] ?? crypto.randomUUID()),
      title: String(entry['title'] ?? 'Untitled'),
      url: typeof entry['url'] === 'string' ? entry['url'] : `https://robertsspaceindustries.com${entry['url'] ?? ''}`,
      publishedAt: String(entry['created_at'] ?? entry['published_at'] ?? new Date().toISOString()),
      channel: classifyChannel(String(entry['channel'] ?? entry['series'] ?? '')),
      summary: typeof entry['summary'] === 'string' ? entry['summary'] : undefined,
      thumbnail: typeof entry['image_url'] === 'string' ? entry['image_url'] : undefined,
      category: typeof entry['series'] === 'string' ? entry['series'] : undefined,
    }));
  } catch (err) {
    console.error('fetchCommLinks failed:', err);
    return [];
  }
}

function classifyChannel(raw: string): VerseNewsItem['channel'] {
  const v = raw.toLowerCase();
  if (v.includes('spectrum')) return 'spectrum';
  if (v.includes('patch') || v.includes('release')) return 'patch';
  if (v.includes('status')) return 'status';
  return 'comm-link';
}

async function fetchStatus(): Promise<VerseStatus | null> {
  try {
    const res = await fetch(STATUS_RSS);
    if (!res.ok) throw new Error(`status HTTP ${res.status}`);
    const xml = await res.text();
    // Very lightweight XML parsing — we only want overall + the most recent item title.
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0, 8);
    const services = items.map((m) => {
      const titleMatch = m[1].match(/<title>([\s\S]*?)<\/title>/);
      const dateMatch = m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      return {
        name: cleanXml(titleMatch?.[1] ?? 'Update'),
        status: 'updated',
        updated: dateMatch?.[1] ?? undefined,
      };
    });
    const overall = items.length === 0 ? 'operational' : 'operational';
    return { overall, services, updatedAt: new Date().toISOString() };
  } catch (err) {
    console.error('fetchStatus failed:', err);
    return null;
  }
}

function cleanXml(s: string): string {
  return s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const [news, status] = await Promise.all([fetchCommLinks(), fetchStatus()]);
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
