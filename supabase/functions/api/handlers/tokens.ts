// Token CRUD for the admin UI under /admin/api-tokens.
// Concept §0 (Block A) + §9 — these are session-authed (NOT bearer), gated on
// the caller being a profile-marked admin. The session JWT is forwarded via
// the standard Authorization: Bearer <jwt> header by the Supabase client.
//
// Routes:
//   POST   /v1/tokens        -> { plaintext, token: { ... } }   (plaintext shown ONCE)
//   GET    /v1/tokens        -> { data: [{ ...meta only }] }
//   DELETE /v1/tokens/:id    -> { ok: true }                    (soft-delete via revoked_at)

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import type { Context } from '../_router.ts';
import { json } from '../_router.ts';
import { sha256Hex } from '../_auth.ts';

const VALID_SCOPES = new Set([
  'news:read',
  'patch:read',
  'ships:read',
  'components:read',
  'keybinds:read',
  '*:read',
  'admin:tokens',
]);

interface CreateTokenBody {
  name?: string;
  scopes?: string[];
}

/**
 * Generate a fresh API token in the `scc_live_<32 base62-ish>` format.
 * We start from 24 random bytes -> base64url -> strip URL-safe punctuation -> slice 32.
 * 24 bytes = 192 bits of entropy; base62 stripping cuts a few bits but keeps
 * well above the ~120-bit floor we want for brute-force resistance.
 */
function generatePlaintextToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  // Browser-style base64url (no padding)
  let b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '')
    .replace(/\//g, '')
    .replace(/=/g, '')
    .replace(/-/g, '')
    .replace(/_/g, '');
  // If we lost too many chars due to filtering, top up with more randomness.
  while (b64.length < 32) {
    const extra = crypto.getRandomValues(new Uint8Array(8));
    b64 += btoa(String.fromCharCode(...extra)).replace(/[^A-Za-z0-9]/g, '');
  }
  return 'scc_live_' + b64.slice(0, 32);
}

/**
 * Build a session-bound Supabase client from the caller's JWT so RLS applies.
 * Returns null if the header is missing/invalid.
 */
async function getSessionContext(req: Request): Promise<
  | { userClient: SupabaseClient; userId: string; isAdmin: boolean }
  | { error: { code: string; message: string }; status: number }
> {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { error: { code: 'unauthorized', message: 'Missing session JWT.' }, status: 401 };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !anonKey) {
    return { error: { code: 'server_misconfigured', message: 'Supabase env missing.' }, status: 500 };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return { error: { code: 'unauthorized', message: 'Invalid session.' }, status: 401 };
  }

  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();
  const isAdmin = profile?.role === 'admin';
  if (!isAdmin) {
    return { error: { code: 'forbidden', message: 'Admin role required.' }, status: 403 };
  }

  return { userClient, userId: userData.user.id, isAdmin };
}

export async function create(ctx: Context): Promise<Response> {
  const session = await getSessionContext(ctx.req);
  if ('error' in session) return json({ error: session.error }, session.status, ctx.responseHeaders);

  let body: CreateTokenBody;
  try {
    body = (await ctx.req.json()) as CreateTokenBody;
  } catch {
    return json({ error: { code: 'invalid_body', message: 'JSON body required.' } }, 400, ctx.responseHeaders);
  }

  const name = (body.name ?? '').trim();
  const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s) => typeof s === 'string') : [];

  if (!name || name.length > 80) {
    return json(
      { error: { code: 'invalid_name', message: 'Name must be 1..80 chars.' } },
      400,
      ctx.responseHeaders,
    );
  }
  if (!scopes.length) {
    return json(
      { error: { code: 'invalid_scopes', message: 'At least one scope required.' } },
      400,
      ctx.responseHeaders,
    );
  }
  const unknown = scopes.filter((s) => !VALID_SCOPES.has(s));
  if (unknown.length) {
    return json(
      { error: { code: 'invalid_scopes', message: `Unknown scopes: ${unknown.join(', ')}` } },
      400,
      ctx.responseHeaders,
    );
  }

  const plaintext = generatePlaintextToken();
  const tokenHash = await sha256Hex(plaintext);
  const prefix = plaintext.slice(0, 'scc_live_'.length + 8); // "scc_live_8aF3kP9q"

  // Insert via the service-role client (ctx.supabase) — the session-bound
  // client would be blocked by the RLS policy on inserts where auth.uid()
  // doesn't equal owner_user_id when invoked through this edge function path.
  const { data, error } = await ctx.supabase
    .from('api_tokens')
    .insert({
      owner_user_id: session.userId,
      name,
      prefix,
      token_hash: tokenHash,
      scopes,
    })
    .select('id, name, prefix, scopes, created_at, last_used_at, revoked_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      // UNIQUE violation — almost always (owner_user_id, name)
      return json(
        { error: { code: 'duplicate_name', message: 'Token with this name already exists.' } },
        409,
        ctx.responseHeaders,
      );
    }
    console.error('create_token_failed', error);
    return json(
      { error: { code: 'create_failed', message: error.message } },
      500,
      ctx.responseHeaders,
    );
  }

  return json({ data: { plaintext, token: data } }, 201, ctx.responseHeaders);
}

export async function list(ctx: Context): Promise<Response> {
  const session = await getSessionContext(ctx.req);
  if ('error' in session) return json({ error: session.error }, session.status, ctx.responseHeaders);

  const { data, error } = await ctx.supabase
    .from('api_tokens')
    .select('id, name, prefix, scopes, created_at, last_used_at, revoked_at')
    .eq('owner_user_id', session.userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    return json(
      { error: { code: 'list_failed', message: error.message } },
      500,
      ctx.responseHeaders,
    );
  }

  return json({ data: data ?? [] }, 200, ctx.responseHeaders);
}

export async function revoke(ctx: Context): Promise<Response> {
  const session = await getSessionContext(ctx.req);
  if ('error' in session) return json({ error: session.error }, session.status, ctx.responseHeaders);

  const id = ctx.params.id;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return json(
      { error: { code: 'invalid_id', message: 'Token id must be a UUID.' } },
      400,
      ctx.responseHeaders,
    );
  }

  const { data, error } = await ctx.supabase
    .from('api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_user_id', session.userId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    return json(
      { error: { code: 'revoke_failed', message: error.message } },
      500,
      ctx.responseHeaders,
    );
  }
  if (!data) {
    return json(
      { error: { code: 'not_found', message: 'Token not found or already revoked.' } },
      404,
      ctx.responseHeaders,
    );
  }
  return json({ ok: true }, 200, ctx.responseHeaders);
}
