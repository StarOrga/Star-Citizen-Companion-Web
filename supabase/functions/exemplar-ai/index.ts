// exemplar-ai - a name (<= 32 chars) or a one-line summary (<= 90) for an own hangar exemplar that differs from Werk.
//
//   POST { kind: 'exemplar_name' | 'exemplar_summary', locale?: 'de' | 'en', ship, changes: [{ slot, from, to }] }
//   signed-in users only
//   -> { ok: true, status: 'generated', text } | { ok: true, status: 'no_key' | 'model_failed' | 'rate_limited' }
//
// Same pattern as nachschub-names: every failure is a 200 with a status and no text, the client then shows nothing /
// its own fallback. The key lives only here (ANTHROPIC_API_KEY secret); model override via EXEMPLAR_AI_MODEL.
// verify_jwt stays ON (default); the handler additionally requires a real user. Output is never labelled as AI.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS, buildPrompt, parseReply, parseRequest, preflight } from './_exemplar.ts';

const MODEL = Deno.env.get('EXEMPLAR_AI_MODEL') ?? 'claude-sonnet-5-5';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

// Per-user rate limit in instance memory (see nachschub-names): caps accidental loops, not a determined attacker.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const hits = new Map<string, number[]>();
function rateLimited(userId: string, now = Date.now()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(userId, recent);
    return true;
  }
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  return false;
}

async function askClaude(prompt: string, key: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 120, messages: [{ role: 'user', content: prompt }] }),
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
  if (rateLimited(user.user.id)) return json({ ok: true, status: 'rate_limited' });
  try {
    const text = parseReply(await askClaude(buildPrompt(request), key), request.kind);
    return text ? json({ ok: true, status: 'generated', text }) : json({ ok: true, status: 'model_failed' });
  } catch (e) {
    console.error(`exemplar-ai: ${(e as Error).message}`);
    return json({ ok: true, status: 'model_failed' });
  }
});
