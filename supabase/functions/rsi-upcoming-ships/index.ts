// rsi-upcoming-ships — scrapes the public RSI Ship-Matrix and diffs it against
// the game-data ships we ingested from the desktop uploader (public.codex_ships).
// The difference — RSI ships that are NOT present in our extracted game data — is
// surfaced as "upcoming" ships (announced/purchasable on RSI, not yet flyable in
// the game data we hold). Read-only, public sources only.
//
// JWT verification is OFF (config.toml verify_jwt=false, mirrors fetch-verse-news):
// a public catalog of public data, reachable by signed-out visitors; the client
// sends its `sb_publishable_*` key (not a JWT), so the platform gate would reject
// anonymous calls outright. No user data flows through this function.
//
// Matching heuristic (why the diff is fuzzy): the game data localizes ship names
// WITH the manufacturer word ("Aegis Idris-M") and occasionally leaves raw entity
// tokens ("@vehicle_NameRSI_..."), while the RSI matrix carries the bare model
// name ("Idris-M") plus a separate manufacturer field. We normalize both sides
// (lowercase, strip diacritics + non-alphanumerics) and match on exact-or-contains.
// A ship counts as already-in-game when its normalized RSI name matches ANY
// normalized game name across every ingested build (conservative: fewer false
// "upcoming" positives). RSI's own `production_status` is returned alongside so a
// reviewer can see whether the diff and RSI agree.
//
// Artwork (why a candidate LIST, not one url): an RSI media entry advertises its
// whole derivative family in `images` — but that map is generated from a size
// template, so a listed variant is not guaranteed to exist on the CDN, and the
// map also carries non-art variants (avatar/logo/icon/banner/texture). Returning
// a single "first non-empty value" therefore produced two silent failures: a
// missing derivative rendered as the generic ship glyph forever (the client has
// no second url to try), and a ship whose first media entry is a manufacturer
// logo rendered the logo. We now emit an ORDERED, art-only candidate list per
// ship (`thumbnails`) that the client walks on <img> error.
//
// `gameShipArt` (added for the Codex): the same matcher already knows which RSI
// entry belongs to which ingested game ship, so we publish that mapping —
// normalized game-ship name → RSI art — instead of throwing it away. The Codex
// ship cards use it whenever the datamined preview render is missing, so RSI
// artwork is not an upcoming-ships-only feature.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const RSI_BASE = 'https://robertsspaceindustries.com';
const SHIP_MATRIX_URL = `${RSI_BASE}/ship-matrix/index`;
const SHIP_MATRIX_TIMEOUT_MS = 12_000;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Shortest normalized RSI name we allow a substring ("contains") match on. Below
// this, a bare token like "m50" risks matching an unrelated longer game name.
const MIN_CONTAINS_LEN = 4;

interface UpcomingShip {
  id: string;
  name: string;
  manufacturer: string | null;
  manufacturerCode: string | null;
  productionStatus: string | null; // RSI's own flag: "flight-ready" | "in-concept" | …
  type: string | null;
  focus: string | null;
  rsiUrl: string | null;
  /** Best candidate, kept for older clients. Always `thumbnails[0] ?? null`. */
  thumbnail: string | null;
  /** Ordered art candidates; the client falls through to the next on load error. */
  thumbnails: string[];
  // true only when RSI marks the ship flight-ready AND we found no game-data match
  // — i.e. the diff surfaced it even though RSI says it exists. Helps a reviewer
  // spot name-matching gaps vs genuinely just-released ships.
  flightReadyButMissing: boolean;
}

/** RSI artwork for a ship we DO hold game data for (keyed by normalized game name). */
interface RsiShipArt {
  /** RSI's own display name — lets a client show where the art came from. */
  name: string;
  rsiUrl: string | null;
  thumbnails: string[];
}

// --------------------- name normalization ---------------------
function normalizeName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // drop spaces, punctuation, hyphens
}

// Which game-data names does this RSI ship match? Empty array = the ship is not
// in our extracted game data (→ it is part of the "upcoming" diff).
//
// Returns matches instead of a boolean so the caller can also publish the
// inverse mapping (game ship → RSI art) without re-running the fuzzy match.
// Each match carries a specificity score: an exact hit always wins, otherwise
// the LONGEST matching RSI name wins, so "aegisidrism" binds to "idrism" and
// not to the shorter, less specific "idris".
function matchGameData(rsiNorm: string, exact: Set<string>, all: string[]): { name: string; score: number }[] {
  if (!rsiNorm) return [];
  const out: { name: string; score: number }[] = [];
  if (exact.has(rsiNorm)) out.push({ name: rsiNorm, score: Number.MAX_SAFE_INTEGER });
  if (rsiNorm.length < MIN_CONTAINS_LEN) return out;
  // Manufacturer-prefixed game name contains the bare RSI model name
  // ("aegisidrism" ⊇ "idrism"), or the rare inverse (game name shorter).
  for (const g of all) {
    if (g.length < MIN_CONTAINS_LEN || g === rsiNorm) continue;
    if (g.includes(rsiNorm) || rsiNorm.includes(g)) out.push({ name: g, score: rsiNorm.length });
  }
  return out;
}

// --------------------- RSI thumbnail extraction ---------------------
// Only RSI-hosted urls are accepted (the matrix is untrusted content).
//
// `images` is a derivative map generated from a size template: every ship
// advertises the SAME ~48 variant names whether or not the file was rendered,
// so a listed url can 404. It also mixes in non-art variants. We therefore
// (a) allow-list art variants in preference order and (b) return every
// surviving candidate so the client can fall through on a load error.
const ART_VARIANTS = [
  'store_small',        // card-sized hero render — the intended thumbnail
  'store_large',
  'post_small',
  'post',
  'slideshow',
  'subscribers_vault_thumbnail',
  'wallpaper_thumb',
  'product_thumb_large',
  'store_hub_small',
] as const;

// Variants that exist on every media entry but never show the ship itself.
// Falling back to these is what turned "no store render" into "manufacturer
// logo on the card" — worse than the honest placeholder glyph.
const NON_ART_VARIANTS = new Set([
  'avatar', 'logo', 'icon', 'banner', 'cover', 'texture', 'background_blur',
  'manufacturer_logo_xs', 'heap_note', 'heap_thumb', 'heap_infobox',
  'slideshow_pager',
]);

/** Ordered, deduped, RSI-hosted art candidates across ALL media entries. */
function rsiThumbnails(media: unknown, limit = 5): string[] {
  if (!Array.isArray(media)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (out.length >= limit) return;
    const url = resolveRsiUrl(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  // Pass 1: the preferred variants, best-first, across every media entry — a
  // ship whose FIRST entry is a logo still reaches the render in entry two.
  for (const variant of ART_VARIANTS) {
    for (const entry of media) {
      if (!entry || typeof entry !== 'object') continue;
      const images = (entry as Record<string, unknown>)['images'];
      if (images && typeof images === 'object') push((images as Record<string, unknown>)[variant]);
    }
  }
  // Pass 2: the original upload, then any remaining art-ish variant. Last
  // resort — `source_url` is full-resolution, so it never leads the list.
  for (const entry of media) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    push(rec['source_url']);
    const images = rec['images'];
    if (!images || typeof images !== 'object') continue;
    for (const [key, value] of Object.entries(images as Record<string, unknown>)) {
      if (NON_ART_VARIANTS.has(key) || key.startsWith('wallpaper_')) continue;
      push(value);
    }
  }
  return out;
}

function resolveRsiUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  let v = raw.trim();
  if (v.startsWith('//')) v = 'https:' + v;
  try {
    const u = new URL(v, RSI_BASE);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname;
    if (host !== 'robertsspaceindustries.com' && !host.endsWith('.robertsspaceindustries.com')) return null;
    u.protocol = 'https:';
    return u.toString();
  } catch {
    return null;
  }
}

function normalizeShipUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return resolveRsiUrl(raw);
  return RSI_BASE + (raw.startsWith('/') ? raw : '/' + raw);
}

// --------------------- data sources ---------------------
async function fetchShipMatrix(): Promise<Record<string, unknown>[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SHIP_MATRIX_TIMEOUT_MS);
  try {
    const res = await fetch(SHIP_MATRIX_URL, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'SC-Companion/0.4 (+upcoming-ships)' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ship-matrix HTTP ${res.status}`);
    const json = await res.json();
    return Array.isArray(json?.data) ? json.data : [];
  } finally {
    clearTimeout(t);
  }
}

// Distinct, localized game-ship names across every ingested build. Raw entity
// tokens ("@vehicle_...") are excluded — they never match an RSI display name and
// only add noise to the contains-match.
async function fetchGameShipNames(): Promise<{ exact: Set<string>; all: string[] }> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const exact = new Set<string>();
  const all: string[] = [];
  const seen = new Set<string>();
  const { data, error } = await admin
    .from('codex_ships')
    .select('name_localized')
    .not('name_localized', 'is', null)
    .not('name_localized', 'like', '@%');
  if (error) throw new Error(`codex_ships query failed: ${error.message}`);
  for (const row of data ?? []) {
    const name = (row as { name_localized: string }).name_localized;
    const norm = normalizeName(name);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    exact.add(norm);
    all.push(norm);
  }
  return { exact, all };
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

  try {
    const [matrix, gameNames] = await Promise.all([fetchShipMatrix(), fetchGameShipNames()]);

    const ships: UpcomingShip[] = [];
    const seenIds = new Set<string>();
    // normalized game-ship name → best RSI art found for it (+ the score that won).
    const artByGameName = new Map<string, { art: RsiShipArt; score: number }>();
    for (const raw of matrix) {
      const name = typeof raw['name'] === 'string' ? (raw['name'] as string).trim() : '';
      if (!name) continue;
      const rsiNorm = normalizeName(name);
      const rsiUrl = normalizeShipUrl(raw['url']);
      const thumbnails = rsiThumbnails(raw['media']);
      const matches = matchGameData(rsiNorm, gameNames.exact, gameNames.all);

      if (matches.length > 0) {
        // Already in our game data → not part of the diff, but its artwork is
        // exactly what the Codex ship card wants when the datamined render is
        // missing. Most specific RSI name wins per game ship.
        if (thumbnails.length > 0) {
          for (const m of matches) {
            const cur = artByGameName.get(m.name);
            if (!cur || m.score > cur.score) {
              artByGameName.set(m.name, { art: { name, rsiUrl, thumbnails }, score: m.score });
            }
          }
        }
        continue;
      }

      const id = String(raw['id'] ?? rsiNorm);
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const mfr = raw['manufacturer'];
      const mfrRec = mfr && typeof mfr === 'object' ? (mfr as Record<string, unknown>) : null;
      const productionStatus = typeof raw['production_status'] === 'string' ? (raw['production_status'] as string) : null;

      ships.push({
        id,
        name,
        manufacturer: mfrRec && typeof mfrRec['name'] === 'string' ? (mfrRec['name'] as string) : null,
        manufacturerCode: mfrRec && typeof mfrRec['code'] === 'string' ? (mfrRec['code'] as string) : null,
        productionStatus,
        type: typeof raw['type'] === 'string' ? (raw['type'] as string) : null,
        focus: typeof raw['focus'] === 'string' ? (raw['focus'] as string) : null,
        rsiUrl,
        thumbnail: thumbnails[0] ?? null,
        thumbnails,
        flightReadyButMissing: productionStatus === 'flight-ready',
      });
    }

    const gameShipArt: Record<string, RsiShipArt> = {};
    for (const [gameName, entry] of artByGameName) gameShipArt[gameName] = entry.art;

    // Concept ships first (RSI still building them), then just-released/missing,
    // each block alphabetical — a stable, reviewer-friendly order.
    ships.sort((a, b) => {
      if (a.flightReadyButMissing !== b.flightReadyButMissing) return a.flightReadyButMissing ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    const payload = {
      ships,
      // normalized game-ship name → RSI artwork; consumed by the Codex ship
      // cards, not by the upcoming list.
      gameShipArt,
      counts: {
        total: ships.length,
        concept: ships.filter((s) => !s.flightReadyButMissing).length,
        flightReadyMissing: ships.filter((s) => s.flightReadyButMissing).length,
        rsiTotal: matrix.length,
        gameNames: gameNames.all.length,
        gameShipArt: Object.keys(gameShipArt).length,
      },
      fetchedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(payload), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        // RSI ship data changes at most a couple of times a day — cache hard on
        // the CDN (6 h) so the periodic refresh the admin asked for costs one
        // upstream fetch per window, not one per visitor.
        'Cache-Control': 'public, max-age=1800, s-maxage=21600',
      },
    });
  } catch (err) {
    console.error('rsi-upcoming-ships failed:', err);
    return new Response(JSON.stringify({ error: 'upstream fetch failed', ships: [], counts: null }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
