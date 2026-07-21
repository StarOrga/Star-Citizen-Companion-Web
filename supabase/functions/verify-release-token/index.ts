// supabase/functions/verify-release-token
// ---------------------------------------------------------------
// Concept § B2 — server-side check for the X-SC-Release-Token header.
// Called by `ingest-bundle` (Phase 2) before accepting an upload.
//
// Input:  POST { token: string }
// Output: 200 { ok: true, release: { id, version } }
//         403 { ok: false, error: "unknown_token" | "revoked" }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

interface Body {
  token?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), { status: 400 });
  }
  if (!body.token) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_token' }), { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // is_current was dropped by the desktop-channels migration; validity is now a
  // known + non-revoked token (mirrors desktop-latest / ingest-bundle). Separate
  // the query error from "no such token" so a schema drift surfaces as a 500
  // instead of masquerading as unknown_token.
  const { data, error } = await supabase
    .from('desktop_releases')
    .select('id, version, token_revoked')
    .eq('release_token', body.token)
    .maybeSingle();

  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: 'server_misconfigured', message: error.message }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
  if (!data) {
    return new Response(
      JSON.stringify({ ok: false, error: 'unknown_token' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }
  if (data.token_revoked) {
    return new Response(
      JSON.stringify({ ok: false, error: 'revoked', last_known_version: data.version }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response(
    JSON.stringify({ ok: true, release: { id: data.id, version: data.version } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});
