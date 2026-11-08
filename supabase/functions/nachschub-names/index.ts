// nachschub-names - a short name for a Nachschub (what you get, <= 28 chars) or an Einsatz (what you do, <= 40).
//
//   POST { kind: 'nachschub' | 'einsatz', locale?: 'de' | 'en', items: [{ name, qty }] }   signed-in users only
//   -> { ok: true, status: 'generated', name } | { ok: true, status: 'no_key' | 'model_failed' }
//
// Graceful: every failure is a 200 with a status and no name; the client then uses its rule-based fallback, so the
// feature never depends on this function. The key lives only here (ANTHROPIC_API_KEY secret); model override via
// NACHSCHUB_NAMES_MODEL. verify_jwt stays ON (default) - the platform rejects calls without a session; the handler
// additionally requires a real user, not the bare publishable key. Output is never labelled as AI.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS, buildPrompt, limitOf, parseName, parseRequest, preflight } from './_names.ts';

const MODEL = Deno.env.get('NACHSCHUB_NAMES_MODEL') ?? 'claude-sonnet-5-5';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

async function askClaude(prompt: string, key: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 80, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return body.content?.find((c) => c.type === 'text')?.text ?? '';
}

Deno.serve(async (req) => {
  const pre = preflight(req.method);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // A real signed-in user, not just the anon/publishable key.
  const auth = req.headers.get('authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: user, error } = await sb.auth.getUser();
  if (error || !user?.user) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const request = parseRequest(body);
  if (!request) return json({ error: 'invalid_body' }, 400);

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: true, status: 'no_key' });
  try {
    const name = parseName(await askClaude(buildPrompt(request), key), limitOf(request.kind));
    return name ? json({ ok: true, status: 'generated', name }) : json({ ok: true, status: 'model_failed' });
  } catch (e) {
    console.error(`nachschub-names: ${(e as Error).message}`);
    return json({ ok: true, status: 'model_failed' });
  }
});
