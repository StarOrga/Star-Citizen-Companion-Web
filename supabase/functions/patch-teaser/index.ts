// patch-teaser - a short AI headline (<= 44 chars, DE + EN) per patch version.
//
//   POST { sweep: true }                      daily cron (pg_cron, publishable key) or any caller
//   POST { version, slug, force? }            one version; SERVICE ROLE ONLY (Bearer service key)
//   -> { ok, status | results }   status: "generated" | "exists" | "no_note" | "no_key" | "model_failed"
//
// Sweep: takes the versions currently in a channel (patch_versions + running
// patch_channel_builds), finds each one's patch-note thread on Spectrum forum
// 190048 and generates ONLY for versions with no patch_teasers row. Safe to call
// openly: it cannot force or pick a version, spends at most SWEEP_MAX model
// calls per call, and a version attempted within RETRY_COOLDOWN_MS (success or
// not) is skipped (patch_teaser_tries), so repeated calls cost nothing.
// Source text: the outline rsi-roadmap parses and caches ("?notes=<slug>").
// Result: public.patch_teasers, read by the Verse hero; without a row the hero
// shows "Neues in <version>". Graceful: every failure leaves the table untouched.
// Key = ANTHROPIC_API_KEY secret; model override via PATCH_TEASER_MODEL.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { VERSION_RE, buildPrompt, parseTeaser, type OutlineNode } from './_teaser.ts';
import { RETRY_COOLDOWN_MS, pickSweepTargets, wantedVersions } from './_sweep.ts';

const MODEL = Deno.env.get('PATCH_TEASER_MODEL') ?? 'claude-sonnet-5-5';
const SPECTRUM_LIST_URL = 'https://robertsspaceindustries.com/api/spectrum/forum/channel/threads';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// deno-lint-ignore no-explicit-any
type Admin = any;

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

/** The patch-note outline of a thread, via rsi-roadmap (it parses and caches it). */
async function loadNodes(slug: string, serviceKey: string): Promise<OutlineNode[]> {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/rsi-roadmap?notes=${encodeURIComponent(slug)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return [];
  const body = (await res.json()) as { outlines?: Array<{ slug?: string; nodes?: OutlineNode[] }> };
  return body.outlines?.find((o) => o.slug === slug)?.nodes ?? [];
}

/** One version end to end. Never throws. */
async function generate(admin: Admin, version: string, slug: string, key: string, serviceKey: string): Promise<string> {
  try {
    const nodes = await loadNodes(slug, serviceKey);
    if (nodes.length === 0) return 'no_note';
    const teaser = parseTeaser(await askClaude(buildPrompt(version, nodes), key));
    if (!teaser) return 'model_failed';
    const { error } = await admin.from('patch_teasers')
      .upsert({ version, title_de: teaser.de, title_en: teaser.en, model: MODEL, generated_at: new Date().toISOString() });
    if (error) throw error;
    return 'generated';
  } catch (e) {
    console.error(`patch-teaser ${version}: ${(e as Error).message}`);
    return 'model_failed';
  }
}

async function sweep(admin: Admin, serviceKey: string): Promise<Response> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: true, status: 'no_key', results: [] });
  try {
    const since = new Date(Date.now() - RETRY_COOLDOWN_MS).toISOString();
    const [pv, builds, have, tries] = await Promise.all([
      admin.from('patch_versions').select('version'),
      admin.from('patch_channel_builds').select('version').eq('running', true),
      admin.from('patch_teasers').select('version'),
      admin.from('patch_teaser_tries').select('version').gt('tried_at', since),
    ]);
    for (const r of [pv, builds, have, tries]) if (r.error) throw r.error;
    const col = (r: { data: Array<{ version: unknown }> | null }) => (r.data ?? []).map((x) => x.version);
    const wanted = wantedVersions(col(pv), col(builds));
    const haveSet = new Set(col(have).map(String));
    // Nothing missing: no Spectrum call, no model call.
    if (wanted.every((v) => haveSet.has(v))) return json({ ok: true, results: [] });

    const list = await fetch(SPECTRUM_LIST_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-tavern-id': '1', 'user-agent': 'SC-Companion/0.6 (+patch-teaser)' },
      body: JSON.stringify({ channel_id: '190048', page: 1, sort: 'newest' }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!list.ok) throw new Error(`spectrum ${list.status}`);
    const raw = ((await list.json()) as { data?: { threads?: Array<Record<string, unknown>> } }).data?.threads ?? [];
    const threads = raw.map((t) => ({ slug: String(t['slug'] ?? ''), subject: String(t['subject'] ?? '') }));

    const targets = pickSweepTargets({ wanted, threads, have: haveSet, recentlyTried: new Set(col(tries).map(String)) });
    const results: Array<{ version: string; status: string }> = [];
    for (const t of targets) {
      // Recorded BEFORE the call: a crash or timeout still cools the version down.
      await admin.from('patch_teaser_tries').upsert({ version: t.version, tried_at: new Date().toISOString() });
      results.push({ version: t.version, status: await generate(admin, t.version, t.slug, key, serviceKey) });
    }
    return json({ ok: true, results });
  } catch (e) {
    console.error(`patch-teaser sweep: ${(e as Error).message}`);
    return json({ ok: true, results: [], status: 'sweep_failed' });
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  let body: { sweep?: boolean; version?: string; slug?: string; force?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, { auth: { persistSession: false } });

  // Sweep: open to any caller, missing rows only (see header). Nothing in the body steers it.
  if (body.sweep === true) return await sweep(admin, serviceKey);

  if (!serviceKey || req.headers.get('authorization') !== `Bearer ${serviceKey}`) return json({ error: 'forbidden' }, 403);
  const version = String(body.version ?? '');
  const slug = String(body.slug ?? '').toLowerCase();
  if (!VERSION_RE.test(version) || !/^[a-z0-9-]{1,160}$/.test(slug)) return json({ error: 'invalid_body' }, 400);
  try {
    if (body.force !== true) {
      const { data: have } = await admin.from('patch_teasers').select('version').eq('version', version).maybeSingle();
      if (have) return json({ ok: true, status: 'exists' });
    }
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ ok: true, status: 'no_key' });
    return json({ ok: true, status: await generate(admin, version, slug, key, serviceKey) });
  } catch (e) {
    console.error(`patch-teaser ${version}: ${(e as Error).message}`);
    return json({ ok: true, status: 'model_failed' });
  }
});
