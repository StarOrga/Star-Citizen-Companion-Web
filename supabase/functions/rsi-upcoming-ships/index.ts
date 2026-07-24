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
  thumbnail: string | null;
  // true only when RSI marks the ship flight-ready AND we found no game-data match
  // — i.e. the diff surfaced it even though RSI says it exists. Helps a reviewer
  // spot name-matching gaps vs genuinely just-released ships.
  flightReadyButMissing: boolean;
}

// --------------------- name normalization ---------------------
function normalizeName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // drop spaces, punctuation, hyphens
}

// Does the RSI ship (by normalized name) already exist in the game-data name set?
function matchesGameData(rsiNorm: string, exact: Set<string>, all: string[]): boolean {
  if (!rsiNorm) return false;
  if (exact.has(rsiNorm)) return true;
  if (rsiNorm.length < MIN_CONTAINS_LEN) return false;
  // Manufacturer-prefixed game name contains the bare RSI model name
  // ("aegisidrism" ⊇ "idrism"), or the rare inverse (game name shorter).
  for (const g of all) {
    if (g.length < MIN_CONTAINS_LEN) continue;
    if (g.includes(rsiNorm) || rsiNorm.includes(g)) return true;
  }
  return false;
}

// --------------------- RSI thumbnail extraction ---------------------
// Only RSI-hosted urls are accepted (the matrix is untrusted content). RSI media
// entries expose several sized variants under `images`, plus a `source_url`.
function rsiThumbnail(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  for (const entry of media) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const images = rec['images'];
    const candidates: unknown[] = [];
    if (images && typeof images === 'object') {
      // Prefer a card-sized variant, fall back to whatever exists.
      const im = images as Record<string, unknown>;
      candidates.push(im['store_small'], im['post_small'], im['store_large'], im['subscribers_vault_thumbnail'], ...Object.values(im));
    }
    candidates.push(rec['source_url']);
    for (const c of candidates) {
      const url = resolveRsiUrl(c);
      if (url) return url;
    }
  }
  return null;
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
    for (const raw of matrix) {
      const name = typeof raw['name'] === 'string' ? (raw['name'] as string).trim() : '';
      if (!name) continue;
      const rsiNorm = normalizeName(name);
      const inGameData = matchesGameData(rsiNorm, gameNames.exact, gameNames.all);
      if (inGameData) continue; // already in our game data → not upcoming (the diff)

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
        rsiUrl: normalizeShipUrl(raw['url']),
        thumbnail: rsiThumbnail(raw['media']),
        flightReadyButMissing: productionStatus === 'flight-ready',
      });
    }

    // Concept ships first (RSI still building them), then just-released/missing,
    // each block alphabetical — a stable, reviewer-friendly order.
    ships.sort((a, b) => {
      if (a.flightReadyButMissing !== b.flightReadyButMissing) return a.flightReadyButMissing ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    const payload = {
      ships,
      counts: {
        total: ships.length,
        concept: ships.filter((s) => !s.flightReadyButMissing).length,
        flightReadyMissing: ships.filter((s) => s.flightReadyButMissing).length,
        rsiTotal: matrix.length,
        gameNames: gameNames.all.length,
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
