// CORS middleware — open for GET, restricted for POST/DELETE.
// Concept §0 + §8: read endpoints must be embeddable from any origin (third-party
// tools, AI agents pointing at /openapi.json). Mutating endpoints stay
// origin-locked to sc-companion.vercel.app to prevent CSRF via stolen tokens.

import type { Context, Middleware } from './_router.ts';
import { json } from './_router.ts';

const TRUSTED_ORIGINS = new Set([
  'https://sc-companion.vercel.app',
  'https://star-citizen-companion-website.vercel.app',
  'http://127.0.0.1:4200',
  'http://localhost:4200',
]);

const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type';

function applyCors(req: Request, headers: Headers, allowOrigin: '*' | string): void {
  headers.set('Access-Control-Allow-Origin', allowOrigin);
  if (allowOrigin !== '*') {
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  headers.set('Access-Control-Max-Age', '86400');
}

export const corsMiddleware: Middleware = async (ctx: Context, next) => {
  const origin = ctx.req.headers.get('origin') ?? '';
  const isMutating = ctx.req.method === 'POST' || ctx.req.method === 'DELETE';

  // Mutating requests must come from a trusted origin (or no Origin header at
  // all — server-to-server tokenized clients don't send one).
  const allowOrigin = isMutating
    ? (TRUSTED_ORIGINS.has(origin) ? origin : (origin ? '' : '*'))
    : '*';

  if (ctx.req.method === 'OPTIONS') {
    const headers = new Headers();
    applyCors(ctx.req, headers, allowOrigin || '*');
    return new Response(null, { status: 204, headers });
  }

  if (isMutating && origin && !TRUSTED_ORIGINS.has(origin)) {
    return json(
      { error: { code: 'forbidden_origin', message: 'Origin not allowed for write operations.' } },
      403,
    );
  }

  applyCors(ctx.req, ctx.responseHeaders, allowOrigin || '*');
  return next();
};
