// translation-overlay — serves the published AI-translation overlay of one language.
//   GET ?lang=de[&build_id=<uuid>]   signed-in user JWT required (401), 404 when not published.
// The R2 object is streamed; it is never a public Worker path (contract § Data (R2)).
// verify_jwt = false in config.toml (the gateway cannot verify asymmetric session tokens);
// the user is checked here with auth.getUser().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { BUILD_ID_RE, LANG_RE } from '../ingest-catalog/_locale-shards.ts';
import { r2FromEnv } from '../ingest-skins/_r2.ts';
import { overlayObjectKey } from './_key.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const h = req.headers.get('authorization') ?? '';
  const jwt = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!jwt) return json({ error: 'unauthorized' }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  const key = overlayObjectKey(url.searchParams.get('lang'), url.searchParams.get('build_id'), LANG_RE, BUILD_ID_RE);
  if (!key) return json({ error: 'bad_params' }, 400);

  const r2 = r2FromEnv((k) => Deno.env.get(k));
  if (!r2) return json({ error: 'translate.r2_not_configured' }, 503);
  // Signed GET against the private bucket endpoint; the body is passed through unparsed.
  const res = await r2.client.fetch(`https://${r2.accountId}.r2.cloudflarestorage.com/${r2.bucket}/${key}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404 || res.status === 403) return json({ error: 'not_published' }, 404);
  if (!res.ok || !res.body) return json({ error: 'translate.internal' }, 502);
  return new Response(res.body, {
    status: 200,
    headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'private, max-age=300' },
  });
});
