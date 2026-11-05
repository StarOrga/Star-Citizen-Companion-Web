// patch-teaser - a short AI headline (<= 44 chars, DE + EN) for one patch version.
//
//   POST { version: "4.10.3", slug: "<spectrum thread slug>", force?: boolean }
//   -> { ok, status }   status: "generated" | "exists" | "no_note" | "no_key" | "model_failed"
//
// Source: the already-parsed patch-note outline rsi-roadmap keeps in
// rsi_patch_cache ("note:<slug>"). Result: public.patch_teasers, which the Verse
// hero reads; without a row the hero shows "Neues in <version>".
// SERVICE ROLE ONLY (verify_jwt = false, own Bearer check, like codex-patch-summary).
// Graceful: every failure leaves the table untouched. Key = ANTHROPIC_API_KEY
// secret; model override via PATCH_TEASER_MODEL. Triggered by hand / backfill.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { VERSION_RE, buildPrompt, parseTeaser, type OutlineNode } from './_teaser.ts';

const MODEL = Deno.env.get('PATCH_TEASER_MODEL') ?? 'claude-sonnet-5-5';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function askClaude(prompt: string, key: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return body.content?.find((c) => c.type === 'text')?.text ?? '';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey || req.headers.get('authorization') !== `Bearer ${serviceKey}`) return json({ error: 'forbidden' }, 403);

  let body: { version?: string; slug?: string; force?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const version = String(body.version ?? '');
  const slug = String(body.slug ?? '').toLowerCase();
  if (!VERSION_RE.test(version) || !/^[a-z0-9-]{1,160}$/.test(slug)) return json({ error: 'invalid_body' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, { auth: { persistSession: false } });
  try {
    if (body.force !== true) {
      const { data: have } = await admin.from('patch_teasers').select('version').eq('version', version).maybeSingle();
      if (have) return json({ ok: true, status: 'exists' });
    }
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ ok: true, status: 'no_key' });

    const { data: note, error } = await admin.from('rsi_patch_cache').select('payload').eq('cache_key', `note:${slug}`).maybeSingle();
    if (error) throw error;
    const nodes = ((note?.payload as { nodes?: OutlineNode[] } | null)?.nodes ?? []) as OutlineNode[];
    if (nodes.length === 0) return json({ ok: true, status: 'no_note' });

    const teaser = parseTeaser(await askClaude(buildPrompt(version, nodes), key));
    if (!teaser) return json({ ok: true, status: 'model_failed' });

    const { error: wErr } = await admin.from('patch_teasers')
      .upsert({ version, title_de: teaser.de, title_en: teaser.en, model: MODEL, generated_at: new Date().toISOString() });
    if (wErr) throw wErr;
    return json({ ok: true, status: 'generated', de: teaser.de, en: teaser.en });
  } catch (e) {
    console.error(`patch-teaser ${version}: ${(e as Error).message}`);
    return json({ ok: true, status: 'model_failed' });
  }
});
