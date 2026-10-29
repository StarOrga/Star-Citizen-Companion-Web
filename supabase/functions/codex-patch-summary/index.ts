// codex-patch-summary — KI trend lines (<= 3, DE + EN) for one codex build.
//
//   POST { build_id: uuid, force?: boolean }  ->  { ok, status }
//   status: "generated" | "exists" | "empty_diff" | "no_key" | "model_failed"
//
// Called fire-and-forget by ingest-catalog `finalize` (afterResponse) and by hand
// for a backfill. SERVICE ROLE ONLY (Authorization: Bearer <service role key>):
// verify_jwt is off because the caller sends the service key, not a user JWT.
// Idempotent: a build that already has patch_summary is skipped unless force.
// Graceful: every failure leaves patch_summary null - the News button just stays
// hidden, nothing else depends on it. The key is an Edge-Function secret
// (ANTHROPIC_API_KEY, the same one sc-events-sync uses); model override via
// CODEX_SUMMARY_MODEL.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildPrompt, digestIsEmpty, parseSummary, type DiffDigest } from './_summary.ts';

const MODEL = Deno.env.get('CODEX_SUMMARY_MODEL') ?? 'claude-sonnet-5-5';
const AI_TIMEOUT_MS = 45_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function askClaude(prompt: string, key: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return body.content?.find((c) => c.type === 'text')?.text ?? '';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey || req.headers.get('authorization') !== `Bearer ${serviceKey}`) return json({ error: 'forbidden' }, 403);

  let body: { build_id?: string; force?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const buildId = String(body.build_id ?? '');
  if (!UUID_RE.test(buildId)) return json({ error: 'invalid_body', message: 'build_id (uuid) required' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, { auth: { persistSession: false } });
  try {
    const { data: row, error } = await admin.from('codex_builds').select('id, patch_summary').eq('id', buildId).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: 'not_found' }, 404);
    if (row.patch_summary && body.force !== true) return json({ ok: true, status: 'exists' });

    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ ok: true, status: 'no_key' });

    const { data: digest, error: dErr } = await admin.rpc('codex_build_diff_digest', { p_build_id: buildId });
    if (dErr) throw dErr;
    if (digestIsEmpty(digest as DiffDigest | null)) return json({ ok: true, status: 'empty_diff' });

    const summary = parseSummary(await askClaude(buildPrompt(digest as DiffDigest), key));
    if (!summary) return json({ ok: true, status: 'model_failed' });

    const patch_summary = { ...summary, model: MODEL, generated_at: new Date().toISOString() };
    const { error: wErr } = await admin.from('codex_builds').update({ patch_summary }).eq('id', buildId);
    if (wErr) throw wErr;
    return json({ ok: true, status: 'generated', lines: { de: summary.de.length, en: summary.en.length } });
  } catch (e) {
    console.error(`codex-patch-summary ${buildId}: ${(e as Error).message}`);
    return json({ ok: true, status: 'model_failed' });
  }
});
