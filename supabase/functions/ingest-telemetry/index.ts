// supabase/functions/ingest-telemetry
// ---------------------------------------------------------------
// Anonymous crash + opt-in usage telemetry ingest for every desktop client
// (StarOrga/Star-Citizen-Companion-App#21). Wire contract v1.
//
// PRODUCTS — one endpoint, one table, one signature scheme for all of them:
//   scc-app       — the main Star Citizen Companion desktop app
//   data-uploader — the P4K extraction & upload tool (Electron)
//   starscape     — the native Windows wallpaper/screensaver tray app (Rust)
// `product` on the wire is what separates them in the admin dashboard.
//
// AUTH — no JWT (verify_jwt = false). The desktop app is an unauthenticated
// machine client; this function does its own HMAC auth:
//   X-SCC-Signature = hex HMAC-SHA256 over `${X-SCC-Timestamp}.${rawBody}`
//   key = env TELEMETRY_HMAC_KEY (dev fallback "scc-telemetry-dev-key-v1").
// Replay guard: |now - timestamp| must be <= 10 min.
//
// PRIVACY — no PII is stored. installId/sessionId and the caller IP are stored
// only as salted SHA-256 hashes; free text is truncated again server-side
// (the client already redacts). Writes use the service-role key (RLS denies
// everyone else); reads happen exclusively through the admin-only
// get_telemetry_stats RPC.
//
// Responses: 204 accepted · 400 bad payload · 401 bad/old signature ·
//            429 rate-limited (Retry-After) · 500 server error.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'content-type, x-scc-version, x-scc-timestamp, x-scc-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

const REPLAY_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_PER_IP = 1000; // events / 10 min / ip
const RATE_WINDOW = "10 minutes";
const MAX_BATCH = 200;
const HMAC_KEY = Deno.env.get('TELEMETRY_HMAC_KEY') ?? 'scc-telemetry-dev-key-v1';
const HASH_SALT = Deno.env.get('TELEMETRY_HASH_SALT') ?? 'scc-telemetry-salt-v1';

const enc = new TextEncoder();

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time-ish hex comparison.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const ROLES = new Set(['host', 'daemon', 'overlay', 'desktop', 'renderer']);
// 'alpha' exists because Starscape ships stable/beta/ALPHA rings. Without it an
// alpha install would be normalised to 'dev' below and the ring signal lost.
const CHANNELS = new Set(['stable', 'beta', 'alpha', 'dev']);
// Every reporting client. Must stay in sync with the telemetry_events.product
// CHECK constraint — an id accepted here but rejected there fails the INSERT.
const PRODUCTS = new Set(['scc-app', 'data-uploader', 'starscape']);

function clamp(s: unknown, n: number): string | null {
  if (s == null) return null;
  return String(s).slice(0, n);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // --- read RAW body first (HMAC must cover the exact bytes the client signed) ---
  const rawBody = await req.text();
  const ts = req.headers.get('x-scc-timestamp') ?? '';
  const sig = req.headers.get('x-scc-signature') ?? '';

  // --- replay window ---
  const tsNum = Number(ts);
  if (!ts || Number.isNaN(tsNum) || Math.abs(Date.now() - tsNum) > REPLAY_WINDOW_MS) {
    return json({ error: 'stale_or_missing_timestamp' }, 401);
  }

  // --- HMAC verify ---
  const expected = await hmacHex(HMAC_KEY, `${ts}.${rawBody}`);
  if (!sig || !safeEqual(expected, sig.toLowerCase())) {
    return json({ error: 'bad_signature' }, 401);
  }

  // --- parse + validate wire body ---
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const type = String(body.type ?? '');
  const events = body.events;
  if ((type !== 'crash' && type !== 'usage') || !Array.isArray(events) || events.length === 0) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (events.length > MAX_BATCH) {
    return json({ error: 'batch_too_large' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_misconfigured' }, 500);
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- anonymous, salted identifiers ---
  const ipRaw = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const ipHash = await sha256Hex(`${HASH_SALT}:ip:${ipRaw}`);
  const sessionHash = body.sessionId ? await sha256Hex(`${HASH_SALT}:s:${body.sessionId}`) : null;
  const installHash = body.installId ? await sha256Hex(`${HASH_SALT}:i:${body.installId}`) : null;

  // --- per-IP rate limit ---
  const { count } = await admin
    .from('telemetry_events')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('received_at', new Date(Date.now() - REPLAY_WINDOW_MS).toISOString());
  if ((count ?? 0) >= RATE_LIMIT_PER_IP) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '600', ...CORS },
    });
  }

  const appVersion = clamp(body.appVersion, 40) ?? 'unknown';
  const channel = CHANNELS.has(String(body.channel)) ? String(body.channel) : 'dev';
  const role = ROLES.has(String(body.role)) ? String(body.role) : null;
  // product identifies the sending client (scc-app | data-uploader | starscape).
  // Unknown / absent → null (legacy readers coalesce NULL to 'scc-app').
  const product = PRODUCTS.has(String(body.product)) ? String(body.product) : null;

  const rows = (events as Record<string, unknown>[]).map((ev) => {
    const isCrash = type === 'crash';
    return {
      event_type: type,
      app_version: appVersion,
      build_id: clamp(body.buildId, 80),
      channel,
      product,
      os: clamp(body.os, 20),
      os_release: clamp(body.osRelease, 40),
      arch: clamp(body.arch, 20),
      role,
      error_type: isCrash ? clamp(ev.errorType, 60) : null,
      error_name: isCrash ? clamp(ev.name, 120) : null,
      error_message: isCrash ? clamp(ev.message, 500) : null,
      error_stack: isCrash ? clamp(ev.stack, 8000) : null,
      metric: !isCrash ? clamp(ev.metric, 80) : null,
      metric_value: !isCrash && typeof ev.value === 'number' ? ev.value : null,
      session_hash: sessionHash,
      install_hash: installHash,
      ip_hash: ipHash,
      detail: (isCrash ? ev.extra : ev.detail) ?? null,
    };
  });

  const { error } = await admin.from('telemetry_events').insert(rows);
  if (error) return json({ error: 'insert_failed', message: error.message }, 500);

  return new Response(null, { status: 204, headers: CORS });
});
