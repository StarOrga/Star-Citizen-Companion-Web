// concept-page — hosts the interactive concept pages ON the website
// (admin feedback #224, dbdb2ffe).
//
// The routine used to post concepts as text into a feedback thread, or as a
// local `docs/concepts/*.html` page that only works with a Python bridge on
// the admin's own machine. The admin asked for a link on the website —
// `https://sc-companion.vercel.app/konzept/<id>` — reachable only by admins
// and only through the link posted in the thread. That Angular route embeds
// THIS function's document route in an iframe; the stored html is the very
// same concept engine, and a small shim (shim.ts) redirects its bridge
// fetches back to this function, which answers the bridge protocol out of
// `public.concept_pages`.
//
// Routes (path after `/concept-page`):
//   POST /ticket                 { id } + `Authorization: Bearer <user JWT>`
//                                admin only → { url, title, expiresAt }
//   GET  /:id?t=                 the concept document (html + shim)
//   GET  /:id/decisions?t=       stored /decisions payload (+ _processed_at)
//   POST /:id/decisions?t=       store the payload; submitted_at on submitted,
//                                and a HUMAN summary reply into the feedback
//                                thread (echo.ts) so the routine's queue sees it
//   GET  /:id/reload?t=          { counter }
//   GET  /:id/heartbeat?t=       { ts, claude_ts, server_ts } — always "connected"
//   GET  /:id/draft?t=           { found, recovered }
//   POST /:id/draft?t=           merge the page's text fields into the mirror
//   POST /:id/attachments?t=     501 { reason: 'unsupported' } (v1)
//   OPTIONS                      CORS preflight
//
// Security model — read before changing anything here
// ---------------------------------------------------
//   * TWO gates, one secret. The ticket route needs a real admin session:
//     `auth.getUser(jwt)` on the service client, then `profiles.role =
//     'admin'` (the same column `public.is_admin()` reads). Everything else
//     is authorised by the TICKET alone: base64url(`<id>.<uid>.<exp>.<hmac>`),
//     HMAC-SHA256 over `<id>.<uid>.<exp>` keyed with SUPABASE_SERVICE_ROLE_KEY,
//     compared in constant time, 12 h lifetime, bound to one concept id AND
//     to the admin who minted it (`uid` = auth user id) — the submit echo
//     below is posted in that admin's name. The iframe cannot carry the
//     session (it is a cross-origin document), so the ticket IS the session
//     for this page — treat the link as such. Tickets from before the uid
//     was added (3 parts) simply fail verification; the app re-mints on open.
//   * The service-role key is the HMAC secret and never leaves the isolate;
//     it is not part of the ticket and not in any response.
//   * The html is served with `Cache-Control: no-store`, `X-Robots-Tag:
//     noindex` and a `frame-ancestors` CSP that names the app origins only.
//     No other CSP directive is set here: the document carries its own
//     <meta http-equiv="Content-Security-Policy"> from the concept template.
//   * The stored html is trusted content — it is written by the routine
//     (service role) through `scripts/routine-gate.mjs concept-publish` and
//     nothing a browser sends ever ends up in it. The page's POST bodies land
//     in jsonb columns, are size-capped and are never rendered as markup.
//   * verify_jwt is OFF (supabase/config.toml): the document is loaded by an
//     <iframe src> without headers, and the sub-requests carry the ticket in
//     the query string. Auth happens here.
//
// Status codes: 200 ok · 400 invalid_body/invalid_id · 401 unauthorized ·
//   403 forbidden · 404 not_found · 405 method_not_allowed ·
//   413 payload_too_large · 500 server_misconfigured/db_error ·
//   501 unsupported

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SHIM } from './shim.ts';
import { buildEchoBody, isReplayOf, type ConceptSubmission } from './echo.ts';

const TICKET_TTL_SEC = 12 * 60 * 60;
const MAX_BODY_BYTES = 1_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Where the Angular app may embed the document. Vercel preview deployments
// are deliberately NOT here — a preview that needs a concept page opens the
// production origin (the ticket travels in the link, not in a cookie).
const FRAME_ANCESTORS = [
  'https://sc-companion.vercel.app',
  'https://star-citizen-companion-website.vercel.app',
  'http://127.0.0.1:4200',
  'http://localhost:4200',
];

const CORS = {
  // `*` is fine: the ticket route carries the JWT in an explicit header (no
  // cookies, so no third-party origin can make the browser attach it), and
  // every other route is authorised by the ticket in the URL. Pinning would
  // only break preview deployments without adding a gate.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  });
}

// ── ticket ───────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array | null {
  try {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function mintTicket(
  secret: string,
  id: string,
  uid: string,
): Promise<{ ticket: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_SEC;
  const sig = await hmac(secret, `${id}.${uid}.${exp}`);
  const ticket = b64url(enc.encode(`${id}.${uid}.${exp}.${b64url(sig)}`));
  return { ticket, exp };
}

/**
 * The admin the ticket was minted for, when `ticket` is valid for exactly
 * this `id` and has not expired; null otherwise.
 */
async function verifyTicket(
  secret: string,
  id: string,
  ticket: string | null,
): Promise<{ uid: string } | null> {
  if (!ticket) return null;
  const raw = b64urlDecode(ticket);
  if (!raw) return null;
  const parts = new TextDecoder().decode(raw).split('.');
  if (parts.length !== 4) return null;
  const [tid, uid, expStr, sigStr] = parts;
  const exp = Number(expStr);
  if (tid !== id || !UUID_RE.test(uid) || !Number.isFinite(exp)) return null;
  if (exp < Math.floor(Date.now() / 1000)) return null;
  const given = b64urlDecode(sigStr);
  if (!given) return null;
  const expected = await hmac(secret, `${tid}.${uid}.${exp}`);
  return timingSafeEqual(given, expected) ? { uid } : null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Path after `/concept-page`, split into segments (no empties). */
function routeSegments(url: URL): string[] {
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.lastIndexOf('concept-page');
  return at === -1 ? parts : parts.slice(at + 1);
}

async function readJson(req: Request): Promise<unknown | undefined> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The stored html with the shim as the first child of <head>. */
function injectShim(html: string): string {
  const at = html.search(/<head[^>]*>/i);
  if (at === -1) return SHIM + html;
  const end = html.indexOf('>', at) + 1;
  return html.slice(0, end) + '\n' + SHIM + html.slice(end);
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      'content-security-policy': `frame-ancestors ${FRAME_ANCESTORS.join(' ')}`,
      ...CORS,
    },
  });
}

const EXPIRED_HTML = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Konzept</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#0b0f14;color:#e6edf3}p{max-width:36ch;text-align:center;padding:1rem}</style>
</head><body><p>Dieser Zugang ist abgelaufen. Bitte die Konzeptseite im Companion neu öffnen.</p></body></html>`;

type DraftBody = { state?: unknown; cleared?: unknown };

/**
 * The engine's draft mirror: the union of the last NON-EMPTY value per text
 * key, minus the keys the user cleared on purpose. Keys starting with `_`
 * are engine bookkeeping (`_savedAt`, `_pageVersion`) and never stored.
 */
function mergeDraft(current: unknown, body: DraftBody): Record<string, string> {
  const recovered: Record<string, string> = {};
  const prev = (current as { recovered?: unknown } | null)?.recovered;
  if (prev && typeof prev === 'object') {
    for (const [k, v] of Object.entries(prev as Record<string, unknown>)) {
      if (typeof v === 'string' && v) recovered[k] = v;
    }
  }
  if (body.state && typeof body.state === 'object') {
    for (const [k, v] of Object.entries(body.state as Record<string, unknown>)) {
      if (k.startsWith('_') || typeof v !== 'string' || !v) continue;
      recovered[k] = v;
    }
  }
  if (Array.isArray(body.cleared)) {
    for (const k of body.cleared) if (typeof k === 'string') delete recovered[k];
  }
  return recovered;
}

// ── handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_misconfigured' }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const url = new URL(req.url);
  const seg = routeSegments(url);

  // ── POST /ticket ───────────────────────────────────────────────────────────
  if (seg.length === 1 && seg[0] === 'ticket') {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const authHeader = req.headers.get('authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json({ error: 'unauthorized' }, 401);

    const {
      data: { user },
      error: authErr,
    } = await admin.auth.getUser(jwt);
    if (authErr || !user) return json({ error: 'unauthorized' }, 401);

    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (profile?.role !== 'admin') return json({ error: 'forbidden' }, 403);

    const body = (await readJson(req)) as { id?: unknown } | undefined;
    const id = typeof body?.id === 'string' ? body.id.trim().toLowerCase() : '';
    if (!UUID_RE.test(id)) return json({ error: 'invalid_id' }, 400);

    const { data: row, error } = await admin
      .from('concept_pages')
      .select('id, title')
      .eq('id', id)
      .maybeSingle();
    if (error) return json({ error: 'db_error', message: error.message }, 500);
    if (!row) return json({ error: 'not_found' }, 404);

    const { ticket, exp } = await mintTicket(serviceKey, id, user.id);
    // The function's own public base. Inside the edge runtime `req.url` has the
    // `/functions/v1` prefix stripped (see api/_router.ts) and may carry an
    // internal host, so the public URL is built from SUPABASE_URL instead.
    const base = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/concept-page`;
    return json({
      url: `${base}/${id}?t=${encodeURIComponent(ticket)}`,
      title: row.title,
      expiresAt: new Date(exp * 1000).toISOString(),
    });
  }

  // ── everything else is /:id[/sub]?t= ──────────────────────────────────────
  const id = (seg[0] ?? '').toLowerCase();
  const sub = seg[1] ?? '';
  if (!UUID_RE.test(id) || seg.length > 2) return json({ error: 'not_found' }, 404);

  const ticket = await verifyTicket(serviceKey, id, url.searchParams.get('t'));
  if (!ticket) {
    return sub === '' ? htmlResponse(EXPIRED_HTML, 401) : json({ error: 'unauthorized' }, 401);
  }

  // GET /:id — the document
  if (sub === '') {
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const { data: row, error } = await admin
      .from('concept_pages')
      .select('html')
      .eq('id', id)
      .maybeSingle();
    if (error) return json({ error: 'db_error', message: error.message }, 500);
    if (!row) return json({ error: 'not_found' }, 404);
    return htmlResponse(injectShim(row.html));
  }

  if (sub === 'heartbeat') {
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    // A hosted page has no Claude process to be "connected" to — the routine
    // reads submissions on its own cadence. The engine only needs a fresh
    // stamp to enable its submit buttons, so the bridge is always alive.
    const now = Date.now();
    return json({ ts: now, claude_ts: now, server_ts: now });
  }

  if (sub === 'reload') {
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const { data: row, error } = await admin
      .from('concept_pages')
      .select('reload_counter')
      .eq('id', id)
      .maybeSingle();
    if (error) return json({ error: 'db_error', message: error.message }, 500);
    if (!row) return json({ error: 'not_found' }, 404);
    return json({ counter: row.reload_counter ?? 0 });
  }

  if (sub === 'decisions') {
    if (req.method === 'GET') {
      const { data: row, error } = await admin
        .from('concept_pages')
        .select('decisions, processed_at')
        .eq('id', id)
        .maybeSingle();
      if (error) return json({ error: 'db_error', message: error.message }, 500);
      if (!row) return json({ error: 'not_found' }, 404);
      const decisions = row.decisions && typeof row.decisions === 'object' ? row.decisions : {};
      return json({
        ...(decisions as Record<string, unknown>),
        _processed_at: row.processed_at ?? null,
        // The engine's "Claude verarbeitet" step flips to done on this key.
        _picked_up_at: row.processed_at ?? null,
      });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json({ error: 'invalid_body' }, 400);
      }
      const payload = body as Record<string, unknown> & ConceptSubmission;
      const submitted = payload.submitted === true;

      // Read before write: the echo below must know whether this POST is the
      // engine replaying a submission the row already holds (offline queue,
      // lost response) — a second thread message would be a duplicate.
      const { data: cur, error: readErr } = await admin
        .from('concept_pages')
        .select('title, feedback_id, decisions, submitted_at, processed_at')
        .eq('id', id)
        .maybeSingle();
      if (readErr) return json({ error: 'db_error', message: readErr.message }, 500);
      if (!cur) return json({ error: 'not_found' }, 404);
      const replay = submitted && isReplayOf(cur, payload);

      const patch: Record<string, unknown> = { decisions: payload };
      if (submitted && !replay) {
        patch.submitted_at = new Date().toISOString();
        // A new submission is unprocessed by definition — otherwise the page
        // would see the OLD processed_at and reset its panel prematurely.
        patch.processed_at = null;
      }
      const { data: row, error } = await admin
        .from('concept_pages')
        .update(patch)
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) return json({ error: 'db_error', message: error.message }, 500);
      if (!row) return json({ error: 'not_found' }, 404);

      // Echo the submit into the topic's thread AS THE ADMIN (is_system =
      // false, author_id = the uid the ticket carries). The routine's queue
      // reads look at admin_feedback_messages only, and a human message is
      // exactly what makes queries (b)/(d) pick the topic up on the next run
      // (docs/feedback-routine/concepts.md). Drafts (`submitted !== true`)
      // and replays never post. The insert is best effort: the submission is
      // already durable, and the routine's manual `concept-read` path still
      // works, so a failed echo is logged and does not fail the page.
      let echoed = false;
      if (submitted && !replay && cur.feedback_id) {
        const { error: echoErr } = await admin.from('admin_feedback_messages').insert({
          feedback_id: cur.feedback_id,
          author_id: ticket.uid,
          is_system: false,
          body: buildEchoBody(id, cur.title ?? '', payload),
        });
        if (echoErr) console.error('concept-page: echo insert failed', id, echoErr.message);
        else echoed = true;
      }

      return json({
        ok: true,
        durable: true,
        echoed,
        submission_id: typeof payload.submission_id === 'string' ? payload.submission_id : null,
      });
    }
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (sub === 'draft') {
    if (req.method === 'GET') {
      const { data: row, error } = await admin
        .from('concept_pages')
        .select('draft')
        .eq('id', id)
        .maybeSingle();
      if (error) return json({ error: 'db_error', message: error.message }, 500);
      if (!row) return json({ error: 'not_found' }, 404);
      const recovered = (row.draft as { recovered?: Record<string, string> } | null)?.recovered ?? {};
      return json({ found: Object.keys(recovered).length > 0, recovered });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (!body || typeof body !== 'object') return json({ error: 'invalid_body' }, 400);
      const { data: cur, error: readErr } = await admin
        .from('concept_pages')
        .select('draft')
        .eq('id', id)
        .maybeSingle();
      if (readErr) return json({ error: 'db_error', message: readErr.message }, 500);
      if (!cur) return json({ error: 'not_found' }, 404);
      const recovered = mergeDraft(cur.draft, body as DraftBody);
      const { error } = await admin
        .from('concept_pages')
        .update({ draft: { recovered, updated_at: new Date().toISOString() } })
        .eq('id', id);
      if (error) return json({ error: 'db_error', message: error.message }, 500);
      return json({ ok: true });
    }
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (sub === 'attachments') {
    // v1: no attachment store behind the hosted page. The engine shows its
    // own copy for `error_unsupported` and keeps the note text.
    return json({ reason: 'unsupported' }, 501);
  }

  return json({ error: 'not_found' }, 404);
});
