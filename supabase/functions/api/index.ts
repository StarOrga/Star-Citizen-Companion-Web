// Public REST API entry point — Edge Function `api`.
// Concept §7: single function + internal router + chained middleware.
//
// Route table (also reflected in openapi.json):
//   Public — no auth:
//     GET    /openapi.json
//     GET    /docs
//   Bearer-auth + rate-limit:
//     GET    /v1/news        scope: news:read
//     GET    /v1/patch       scope: patch:read
//     GET    /v1/ships       scope: ships:read
//     GET    /v1/components  scope: components:read
//   Session-auth (admin JWT):
//     POST   /v1/tokens
//     GET    /v1/tokens
//     DELETE /v1/tokens/:id

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { Router } from './_router.ts';
import { corsMiddleware } from './_cors.ts';
import { authMiddleware } from './_auth.ts';
import { rateLimitMiddleware } from './_rate-limit.ts';

import * as tokens from './handlers/tokens.ts';
import * as news from './handlers/news.ts';
import * as patch from './handlers/patch.ts';
import * as ships from './handlers/ships.ts';
import * as components from './handlers/components.ts';
import * as openapi from './openapi.ts';
import * as docs from './docs.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const router = new Router()
  .use(corsMiddleware)
  .use(authMiddleware)
  .use(rateLimitMiddleware)
  // ---- Read endpoints (Bearer + scope) ----
  .get('/v1/news', news.list, { scope: 'news:read' })
  .get('/v1/patch', patch.get, { scope: 'patch:read' })
  .get('/v1/ships', ships.list, { scope: 'ships:read' })
  .get('/v1/components', components.list, { scope: 'components:read' })
  // ---- Token mgmt (session JWT + admin role, see handler) ----
  .post('/v1/tokens', tokens.create)
  .get('/v1/tokens', tokens.list)
  .delete('/v1/tokens/:id', tokens.revoke)
  // ---- Public docs ----
  .get('/openapi.json', openapi.serve, { public: true })
  .get('/docs', docs.serve, { public: true });

const handle = router.handler((_req, _url) => {
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env not set');
  }
  return {
    supabase: createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
});

Deno.serve(handle);
