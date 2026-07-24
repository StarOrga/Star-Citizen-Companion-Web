// ship-link — write authority for user-supplied RSI pledge links (feedback f7d3bd9a)
//
// Our codex has no reliable per-ship RSI store slug, so users may pin the real
// pledge page for a ship themselves. The value is therefore attacker-controlled
// and later rendered as an `href`, which drives every decision here:
//
//   * STRICT ALLOWLIST, SERVER-SIDE. `_rsi-url.ts` parses the URL and rebuilds
//     it from verified parts; only
//     `https://robertsspaceindustries.com/en/pledge/ships/<slug>/<Name>` can
//     ever come out. The browser runs the same check, but purely for a friendly
//     error - nothing this function does trusts the client.
//   * THE URL IS DATA, NEVER AN INSTRUCTION. It is stored, returned as JSON and
//     rendered as a plain anchor. It is never executed, never interpolated into
//     markup and never placed into an LLM prompt.
//   * PRIVATE BY DEFAULT. `set`/`remove` write public.user_ship_links through
//     the CALLER'S OWN client, so owner-only RLS applies on top of this code.
//     Nothing here can read another user's link - not even for an admin.
//   * GLOBAL ONLY BY EXPLICIT ADMIN ACTION. `promote` writes
//     public.ship_pledge_links and requires role = 'admin' (checked here AND by
//     the table's RLS). It publishes the URL the admin submits; it never reads,
//     harvests or auto-promotes anybody's private link.
//
// Actions (POST JSON):
//   { action: 'set',       shipSlug, url }  -> upsert the caller's own link
//   { action: 'remove',    shipSlug }       -> delete the caller's own link
//   { action: 'promote',   shipSlug, url }  -> admin: publish for everyone
//   { action: 'unpromote', shipSlug }       -> admin: withdraw the global link
//
// Status codes: 200 ok · 400 invalid_body/invalid_url/invalid_slug ·
//   401 unauthorized · 403 forbidden · 405 method_not_allowed ·
//   429 rate_limited · 500 server_misconfigured/db_error
//
// verify_jwt: TRUE (see supabase/config.toml) — every action needs a real user.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { normalizeRsiPledgeShipUrl, normalizeShipSlug } from './_rsi-url.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

// ── rate limit ───────────────────────────────────────────────────────────────
// Cheap hardening: a per-user sliding window held in the isolate's memory (same
// approach as ingest-telemetry). It is not a distributed limit and is not the
// security boundary — the allowlist is. It exists so a single account cannot
// hammer the table with churn.
const RATE_LIMIT_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT_MAX_WRITES = 20;
const writeLog = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (writeLog.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_WRITES) {
    writeLog.set(userId, recent);
    return true;
  }
  recent.push(now);
  writeLog.set(userId, recent);
  // Keep the map from growing without bound in a long-lived isolate.
  if (writeLog.size > 5_000) {
    for (const [key, stamps] of writeLog) {
      if (stamps.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) writeLog.delete(key);
    }
  }
  return false;
}

type Body = {
  action?: unknown;
  shipSlug?: unknown;
  url?: unknown;
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !anonKey) return json({ error: 'server_misconfigured' }, 500);

  // The caller's own client: identity comes from their JWT and every query below
  // still passes through RLS. No service-role key is used anywhere in this
  // function — there is deliberately no code path that can read or write another
  // user's private link.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const action = typeof body.action === 'string' ? body.action : '';
  if (!['set', 'remove', 'promote', 'unpromote'].includes(action)) {
    return json({ error: 'invalid_body', message: 'unknown action' }, 400);
  }

  const shipSlug = normalizeShipSlug(body.shipSlug);
  if (!shipSlug) return json({ error: 'invalid_slug' }, 400);

  if (rateLimited(user.id)) return json({ error: 'rate_limited' }, 429);

  // ── per-user link ─────────────────────────────────────────────────────────
  if (action === 'set') {
    const url = normalizeRsiPledgeShipUrl(body.url);
    if (!url) return json({ error: 'invalid_url' }, 400);

    const { data, error } = await userClient
      .from('user_ship_links')
      .upsert(
        { user_id: user.id, ship_slug: shipSlug, url, created_by: user.id },
        { onConflict: 'user_id,ship_slug' },
      )
      .select('ship_slug, url, created_at, updated_at')
      .single();
    if (error) return json({ error: 'db_error', message: error.message }, 500);
    return json({ ok: true, link: data });
  }

  if (action === 'remove') {
    const { error } = await userClient
      .from('user_ship_links')
      .delete()
      .eq('user_id', user.id)
      .eq('ship_slug', shipSlug);
    if (error) return json({ error: 'db_error', message: error.message }, 500);
    return json({ ok: true });
  }

  // ── admin promotion ───────────────────────────────────────────────────────
  // Making a link visible to everyone is an explicit, deliberate admin act. The
  // admin supplies the URL they are publishing; this function never lifts a
  // link out of another user's private row, so promotion leaks nothing.
  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') return json({ error: 'forbidden' }, 403);

  if (action === 'promote') {
    const url = normalizeRsiPledgeShipUrl(body.url);
    if (!url) return json({ error: 'invalid_url' }, 400);

    const { data, error } = await userClient
      .from('ship_pledge_links')
      .upsert(
        { ship_slug: shipSlug, url, source_user_id: user.id, created_by: user.id },
        { onConflict: 'ship_slug' },
      )
      .select('ship_slug, url, created_at, updated_at')
      .single();
    if (error) return json({ error: 'db_error', message: error.message }, 500);
    return json({ ok: true, globalLink: data });
  }

  // action === 'unpromote'
  const { error } = await userClient
    .from('ship_pledge_links')
    .delete()
    .eq('ship_slug', shipSlug);
  if (error) return json({ error: 'db_error', message: error.message }, 500);
  return json({ ok: true });
});
