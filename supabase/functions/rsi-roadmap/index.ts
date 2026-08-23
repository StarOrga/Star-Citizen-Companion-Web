// rsi-roadmap — the patch board's window into RSI's own patch content.
//
// Answers two questions the Verse-News feed could never answer (feedback
// 961ab0a5), from two public, unauthenticated RSI endpoints:
//
//   GET  /rsi-roadmap
//        → what is PLANNED for the current and the next patch, from the roadmap
//          Release View board (/api/roadmap/v1/boards/1).
//   GET  /rsi-roadmap?notes=<slug>[,<slug>…]
//        → what a patch note actually SAYS: its headings and bullet points,
//          from the Spectrum thread the feed already links to.
//
// One function because they are one feature — "what is in this patch" — and one
// deployment/CDN/cache surface is cheaper to reason about than two. The two
// halves are otherwise independent: a roadmap outage does not cost you the
// outlines and vice versa.
//
// JWT verification is OFF (config.toml verify_jwt=false, mirrors fetch-verse-news
// and rsi-upcoming-ships): public data on a page signed-out visitors can open.
// The client sends its `sb_publishable_*` key, not a JWT, so the platform gate
// would reject anonymous calls outright. No user data flows through here.
//
// THE CLIENT NEVER TALKS TO RSI. Everything above is fetched server-side; the
// browser only ever sees this function's own origin (plus the RSI image CDN for
// <img>, which is already in the app's CSP img-src).
//
// Caching, in three layers, because RSI is the slow part:
//   1. public.rsi_patch_cache — a durable, shared, already-PARSED copy. The
//      board is ~800 KB of upstream JSON, a thread ~180 KB at ~1 s; neither is
//      worth re-fetching per visitor.
//   2. stale-serve — a refetch that fails leaves the old row in place and the
//      old payload on the wire. RSI being down degrades to yesterday's roadmap,
//      never to an error card.
//   3. Cache-Control — the Supabase CDN in front of this function.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { ROADMAP_BOARD_ID, RoadmapPayload, parseRoadmapBoard } from './roadmap.ts';
import { PatchOutline, isValidSlug, parseThreadOutline } from './patch-outline.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const RSI_BASE = 'https://robertsspaceindustries.com';
const BOARD_URL = `${RSI_BASE}/api/roadmap/v1/boards/${ROADMAP_BOARD_ID}`;
const SPECTRUM_THREAD_URL = `${RSI_BASE}/api/spectrum/forum/thread/nested`;
/** The SC "Patch Notes" forum — the same channel fetch-verse-news reads. */
const PATCH_NOTES_CHANNEL_ID = '190048';
const USER_AGENT = 'SC-Companion/0.6 (+patch-board)';

const BOARD_CACHE_KEY = `board:${ROADMAP_BOARD_ID}`;
const NOTE_CACHE_PREFIX = 'note:';

/** Roadmap moves on the weekly Roadmap-Roundup cadence; an hour is plenty. */
const BOARD_TTL_MS = 60 * 60 * 1000;
/**
 * Patch notes get edited after publication (a rolling "Hotfix Central" thread
 * grows all week), so their outlines expire too — just far more slowly than
 * they are read.
 */
const NOTE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How many outlines one request may fetch from RSI. Cached slugs are served on
 * top of this for free — the cap bounds the UPSTREAM cost (~1 s each), not the
 * answer size, so a fully warmed history still returns in one round trip.
 */
const MAX_NOTES_PER_REQUEST = 12;
const MAX_UPSTREAM_FETCHES = 5;

const BOARD_TIMEOUT_MS = 15_000;
const THREAD_TIMEOUT_MS = 12_000;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

interface CacheRow {
  cache_key: string;
  payload: unknown;
  fetched_at: string;
}

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function readCache(keys: string[]): Promise<Map<string, CacheRow>> {
  const out = new Map<string, CacheRow>();
  if (keys.length === 0) return out;
  try {
    const { data, error } = await admin()
      .from('rsi_patch_cache')
      .select('cache_key, payload, fetched_at')
      .in('cache_key', keys);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as CacheRow[]) out.set(row.cache_key, row);
  } catch (err) {
    // A cache miss must never be fatal — worst case we go upstream.
    console.error('rsi-patch-cache read failed:', err);
  }
  return out;
}

async function writeCache(key: string, payload: unknown): Promise<void> {
  try {
    const { error } = await admin()
      .from('rsi_patch_cache')
      .upsert({ cache_key: key, payload, fetched_at: new Date().toISOString() }, { onConflict: 'cache_key' });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(`rsi-patch-cache write failed for ${key}:`, err);
  }
}

function isFresh(row: CacheRow | undefined, ttlMs: number): boolean {
  if (!row) return false;
  const t = Date.parse(row.fetched_at);
  return Number.isFinite(t) && Date.now() - t < ttlMs;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// --------------------- roadmap ---------------------

async function loadRoadmap(cached: CacheRow | undefined): Promise<RoadmapPayload | null> {
  if (isFresh(cached, BOARD_TTL_MS)) return (cached!.payload as RoadmapPayload) ?? null;
  try {
    const raw = await fetchJson(
      BOARD_URL,
      { headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT } },
      BOARD_TIMEOUT_MS,
    );
    const payload = parseRoadmapBoard(raw);
    // A null parse means the shape changed or RSI answered with an error
    // envelope. Keeping the stale row is strictly better than replacing a good
    // roadmap with nothing.
    if (!payload) throw new Error('board payload did not parse');
    await writeCache(BOARD_CACHE_KEY, payload);
    return payload;
  } catch (err) {
    console.error('rsi-roadmap board fetch failed:', err);
    return (cached?.payload as RoadmapPayload) ?? null;
  }
}

// --------------------- patch-note outlines ---------------------

async function fetchOutline(slug: string): Promise<PatchOutline | null> {
  try {
    const raw = await fetchJson(
      SPECTRUM_THREAD_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          // Community id (1 = Star Citizen), not the channel — same value the
          // news ingest sends. Without it Spectrum rejects the call.
          'X-Tavern-Id': '1',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({ slug, channel_id: PATCH_NOTES_CHANNEL_ID, sort: 'votes', page: 1 }),
      },
      THREAD_TIMEOUT_MS,
    );
    return parseThreadOutline(slug, raw);
  } catch (err) {
    console.error(`rsi-roadmap outline fetch failed for ${slug}:`, err);
    return null;
  }
}

/**
 * Outlines for the requested slugs.
 *
 * Cached-and-fresh rows cost nothing. Everything else is fetched in parallel up
 * to MAX_UPSTREAM_FETCHES; slugs beyond that budget are simply not in the
 * answer, and the client asks again for what it did not get. A stale cached row
 * still ships when its refetch fails.
 */
async function loadOutlines(slugs: string[], cache: Map<string, CacheRow>): Promise<PatchOutline[]> {
  const out: PatchOutline[] = [];
  const toFetch: string[] = [];
  for (const slug of slugs) {
    const row = cache.get(NOTE_CACHE_PREFIX + slug);
    if (isFresh(row, NOTE_TTL_MS)) {
      const payload = row!.payload as PatchOutline | null;
      if (payload) out.push(payload);
      continue;
    }
    if (toFetch.length < MAX_UPSTREAM_FETCHES) toFetch.push(slug);
    else if (row?.payload) out.push(row.payload as PatchOutline); // stale but real
  }

  const fetched = await Promise.all(toFetch.map(async (slug) => {
    const outline = await fetchOutline(slug);
    if (outline) {
      await writeCache(NOTE_CACHE_PREFIX + slug, outline);
      return outline;
    }
    // Upstream said no — fall back to whatever we already had for this slug.
    const row = cache.get(NOTE_CACHE_PREFIX + slug);
    return (row?.payload as PatchOutline | undefined) ?? null;
  }));
  for (const outline of fetched) if (outline) out.push(outline);
  return out;
}

/** `?notes=a,b,c` → validated, deduped, bounded slug list. */
function parseNotesParam(raw: string | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const slug = part.trim().toLowerCase();
    if (!slug || !isValidSlug(slug) || out.includes(slug)) continue;
    out.push(slug);
    if (out.length >= MAX_NOTES_PER_REQUEST) break;
  }
  return out;
}

// --------------------- server ---------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'server not configured' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const slugs = parseNotesParam(url.searchParams.get('notes'));
  // An outline request is a follow-up to a page that already has the roadmap;
  // re-sending it would double the payload for nothing.
  const wantRoadmap = slugs.length === 0;

  try {
    const cache = await readCache([
      ...(wantRoadmap ? [BOARD_CACHE_KEY] : []),
      ...slugs.map((s) => NOTE_CACHE_PREFIX + s),
    ]);

    const [roadmap, outlines] = await Promise.all([
      wantRoadmap ? loadRoadmap(cache.get(BOARD_CACHE_KEY)) : Promise.resolve(null),
      slugs.length > 0 ? loadOutlines(slugs, cache) : Promise.resolve([] as PatchOutline[]),
    ]);

    return new Response(
      JSON.stringify({ roadmap, outlines, fetchedAt: new Date().toISOString() }),
      {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
          // The roadmap changes on a weekly cadence and an outline barely at
          // all, so the CDN may hold both for a good while. Outline responses
          // vary by `?notes=`, which is part of the CDN cache key.
          'Cache-Control': 'public, max-age=900, s-maxage=3600',
        },
      },
    );
  } catch (err) {
    console.error('rsi-roadmap failed:', err);
    // The patch board hides the whole roadmap band on a null payload, so an
    // outage costs a section, never an error message the reader cannot act on.
    return new Response(JSON.stringify({ roadmap: null, outlines: [], error: 'upstream fetch failed' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
