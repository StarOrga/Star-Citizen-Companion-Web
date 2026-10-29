// translate-orchestrator — game-string translation job state machine.
// Contract: docs/translation/ARCHITECTURE.md. Operations: docs/translation/OPERATIONS.md.
//
//   POST { op: 'tick' }                              advance every open job one step
//   POST { op: 'approve' | 'cancel', job_id }        admin
//   POST { op: 'estimate', build_id, lang, mode? }   admin dry run, no writes
//   POST { op: 'start_full', build_id, lang }        admin, always parks in awaiting_approval
//
// AUTH (verify_jwt = false in config.toml; checked here):
//   * service-role key       -> every op
//   * the project's anon key -> `tick` ONLY (pg_cron has no vault for the service key). Safe:
//                               a tick only advances existing jobs and spends nothing unless
//                               settings.enabled and a job is queued/approved. Concurrent ticks
//                               are harmless: every transition is a compare-and-set.
//   * a user JWT whose profiles.role = 'admin' -> every op
// The Anthropic key is TRANSLATE_ANTHROPIC_API_KEY only; absent -> jobs fail with
// `translate.no_api_key`. It is never the sc-events-sync key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { deleteObject, getObject, putObject, r2FromEnv } from '../ingest-skins/_r2.ts';
import { BUILD_ID_RE, LANG_RE } from '../ingest-catalog/_locale-shards.ts';
import { makeLlm } from './_anthropic.ts';
import { makeDb } from './_db.ts';
import { approve, cancel, dryRun, startFull, tick, TranslateError } from './_machine.ts';
import type { Deps } from './_machine.ts';
import type { Store } from './_io.ts';

function logWarn(msg: string, data?: Record<string, unknown>): void {
  console.warn(`translate-orchestrator: ${msg}`, data ? JSON.stringify(data) : '');
}
function logError(msg: string, data?: Record<string, unknown>): void {
  console.error(`translate-orchestrator: ${msg}`, data ? JSON.stringify(data) : '');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

function bearer(req: Request): string {
  const h = req.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const op = String(body?.op ?? '');

  // ── auth ──
  const token = bearer(req) || (req.headers.get('apikey') ?? '');
  let actor: string | null = null; // admin user id; null for service role
  let allowed = false;
  if (token && serviceKey && token === serviceKey) allowed = true;
  else if (op === 'tick' && token && anonKey && token === anonKey) allowed = true;
  else if (token) {
    const { data: { user } } = await admin.auth.getUser(token);
    if (user) {
      const { data: p } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if ((p as { role?: string } | null)?.role === 'admin') {
        allowed = true;
        actor = user.id;
      } else return json({ error: 'forbidden' }, 403);
    }
  }
  if (!allowed) return json({ error: 'unauthorized' }, 401);

  const r2 = r2FromEnv((k) => Deno.env.get(k));
  if (!r2) return json({ error: 'translate.r2_not_configured' }, 503);
  const store: Store = {
    async getJson(key) {
      try {
        return JSON.parse(new TextDecoder().decode(await getObject(r2, key, 128 * 1024 * 1024)));
      } catch (e) {
        if (/HTTP 404/.test(String((e as Error).message))) return null;
        throw e;
      }
    },
    putJson: (key, value) => putObject(r2, key, JSON.stringify(value), 'application/json'),
    deleteKey: (key) => deleteObject(r2, key),
  };
  const apiKey = (Deno.env.get('TRANSLATE_ANTHROPIC_API_KEY') ?? '').trim();
  const deps: Deps = {
    db: makeDb(admin, () => new Date()),
    store,
    llm: apiKey ? makeLlm(apiKey) : null,
    now: () => new Date(),
    log: (msg, data) => logWarn(msg, data),
  };

  try {
    switch (op) {
      case 'tick': {
        const work = tick(deps);
        // A tick can outlast the response; the platform keeps the isolate alive for it.
        (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil?.(work.catch(() => {}));
        return json({ ok: true, jobs: await work });
      }
      case 'approve':
        if (!body.job_id) return json({ error: 'job_id_required' }, 400);
        return json({ ok: true, job: await approve(deps, String(body.job_id), actor) });
      case 'cancel':
        if (!body.job_id) return json({ error: 'job_id_required' }, 400);
        return json({ ok: true, job: await cancel(deps, String(body.job_id)) });
      case 'estimate':
      case 'start_full': {
        const build_id = String(body.build_id ?? '');
        const lang = String(body.lang ?? '');
        if (!BUILD_ID_RE.test(build_id) || !LANG_RE.test(lang)) return json({ error: 'bad_params' }, 400);
        if (op === 'start_full') return json({ ok: true, job: await startFull(deps, build_id, lang) });
        const mode = body.mode === 'full' ? 'full' : 'delta';
        let base: string | null = null;
        if (mode === 'delta') {
          base = BUILD_ID_RE.test(String(body.base_build_id ?? '')) ? String(body.base_build_id) : null;
        }
        return json({ ok: true, estimate: await dryRun(deps, build_id, lang, mode, base) });
      }
      default:
        return json({ error: 'unknown_op' }, 400);
    }
  } catch (e) {
    if (e instanceof TranslateError) return json({ error: e.key }, 409);
    logError('translate-orchestrator failed', { op, error: String((e as Error)?.message ?? e) });
    return json({ error: 'translate.internal' }, 500);
  }
});
