// sc-event-sheet - reads what an event asks, gives and where it applies out of official text and writes the event's
// data sheet (docs/contracts/event-sheet.md), so the HQ never depends on someone typing it in.
//
//   POST {}                         pg_cron (every 6 h): picks the events that need a pass (new comm-link, running
//                                   event once a day, upcoming event, one last pass after the end), max 3 LLM calls.
//   POST { eventId, force? }        re-extract ONE event; service-role key or a signed-in admin only.
//   -> { ok, runs: [{ eventId, status, ... }] }
//
// Flow per event: gather text (Comm-Link Wiki API; community wiki extract; the RSI page's meta tags - RSI serves
// nothing else to a plain fetch, so a failed/empty source is simply skipped) -> Anthropic tool call with the sheet
// schema -> sheetFromModel (normalise, sanity-check, confidence gate) -> mergeSheets with the stored draft (admin
// decisions stay) -> sc_event_sheet_apply(..., 'ai') = draft + public sheet + one history row. Fields under 0.8 stay
// unknown publicly and wait in the admin review. The key lives only here (ANTHROPIC_API_KEY); model override
// SC_EVENT_SHEET_MODEL. verify_jwt=false (supabase/config.toml): pg_cron has only the publishable key; the automatic
// mode is throttled and capped, the targeted mode checks the caller itself.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { normalizeSheet, type EventSheet } from '../_shared/event-sheet.ts';
import {
  EXTRACTOR_VERSION, MAX_LLM_CALLS_PER_RUN, SHEET_TOOL_NAME, SHEET_TOOL_SCHEMA,
  bundleSources, buildPrompt, extractMeta, hashText, mergeSheets, nameStem, parseModelAnswer, parseWikiExtract,
  pickEvents, selectSources, sheetFromModel,
  type EventInfo, type LinkInfo, type RunState, type SourceItem,
} from './_extract.ts';

const MODEL = Deno.env.get('SC_EVENT_SHEET_MODEL') ?? 'claude-sonnet-5-5';
const COMM_LINK_API = 'https://api.star-citizen.wiki/api/comm-links';
const WIKI_API = 'https://starcitizen.tools/api.php';
const USER_AGENT = 'SC-Companion/1.0 (+sc-event-sheet)';
const GLOBAL_THROTTLE_MS = 10 * 60_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function getJson(url: string, timeoutMs = 15_000): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
  return await res.json();
}

function toLink(raw: unknown): LinkInfo | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r.id !== 'number' || typeof r.title !== 'string' || typeof r.rsi_url !== 'string' || typeof r.created_at !== 'string') return null;
  if (!/^https:\/\/(www\.)?robertsspaceindustries\.com\//.test(r.rsi_url) || Number.isNaN(Date.parse(r.created_at))) return null;
  const en = (r.translations as Record<string, unknown> | undefined)?.en_EN;
  return { id: r.id, title: r.title.trim(), url: r.rsi_url, publishedAt: new Date(r.created_at).toISOString(), body: typeof en === 'string' ? en.slice(0, 60000) : '' };
}

async function fetchLinks(): Promise<LinkInfo[]> {
  const links: LinkInfo[] = [];
  for (let page = 1; page <= 2; page++) {
    try {
      const body = (await getJson(`${COMM_LINK_API}?page%5Bsize%5D=100&page%5Bnumber%5D=${page}`)) as { data?: unknown };
      for (const item of Array.isArray(body.data) ? body.data : []) {
        const l = toLink(item);
        if (l) links.push(l);
      }
    } catch (e) {
      console.warn(`[sc-event-sheet] comm-link page ${page}: ${(e as Error).message}`);
    }
  }
  return links;
}

/** Extra text beyond the comm-links; every failure is swallowed (these sources are best-effort). */
async function fetchExtraSources(event: EventInfo): Promise<SourceItem[]> {
  const out: SourceItem[] = [];
  const stem = nameStem(event.name);
  try {
    const wiki = parseWikiExtract(await getJson(`${WIKI_API}?action=query&format=json&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(stem)}`));
    if (wiki) out.push({ kind: 'wiki', label: `Star Citizen Wiki: ${stem} (community)`, url: `https://starcitizen.tools/${encodeURIComponent(stem.replace(/ /g, '_'))}`, text: wiki.slice(0, 7000) });
  } catch { /* wiki unreachable: fine */ }
  if (event.url) {
    try {
      const res = await fetch(event.url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, signal: AbortSignal.timeout(12_000) });
      if (res.ok) {
        const meta = extractMeta((await res.text()).slice(0, 200_000));
        if (meta) out.push({ kind: event.url.includes('/spectrum/') ? 'spectrum' : 'comm-link', label: 'RSI page meta tags', url: event.url, text: meta });
      }
    } catch { /* RSI blocks or serves a shell: fine */ }
  }
  return out;
}

async function askModel(prompt: string, key: string): Promise<unknown> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      tools: [{ name: SHEET_TOOL_NAME, description: 'Record the structured data sheet of the event.', input_schema: SHEET_TOOL_SCHEMA }],
      tool_choice: { type: 'tool', name: SHEET_TOOL_NAME },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  return parseModelAnswer(((await res.json()) as { content?: unknown }).content);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const body = (await req.json().catch(() => ({}))) as { eventId?: unknown; force?: unknown };
  const targeted = typeof body.eventId === 'string' && body.eventId.length > 0 ? body.eventId : null;
  const force = body.force === true;

  // Targeted runs: the service-role key or a signed-in admin. The automatic mode needs no caller trust (throttled + capped).
  if (targeted) {
    const auth = req.headers.get('authorization') ?? '';
    let allowed = auth === `Bearer ${serviceKey}`;
    if (!allowed && auth) {
      const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { authorization: auth } }, auth: { persistSession: false } });
      const { data } = await user.rpc('is_admin');
      allowed = data === true;
    }
    if (!allowed) return json({ error: 'forbidden' }, 403);
  }

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: true, runs: [], status: 'no_key' });

  // Past AI runs: when, and on which source text (actor_id = `sc-event-sheet:<hash>`).
  const { data: hist, error: histErr } = await db.from('sc_event_sheet_history')
    .select('event_id, created_at, actor_id').eq('actor_kind', 'ai').order('created_at', { ascending: false }).limit(300);
  if (histErr) return json({ error: `history: ${histErr.message}` }, 500);
  const state = new Map<string, RunState>();
  for (const h of (hist ?? []) as Array<{ event_id: string; created_at: string; actor_id: string | null }>) {
    if (!state.has(h.event_id)) state.set(h.event_id, { lastAiAt: h.created_at, lastHash: h.actor_id?.startsWith('sc-event-sheet:') ? h.actor_id.slice(15) : null });
  }
  const newest = (hist ?? [])[0]?.created_at as string | undefined;
  if (!targeted && newest && Date.now() - Date.parse(newest) < GLOBAL_THROTTLE_MS) {
    return json({ ok: true, runs: [], status: 'throttled' }, 429);
  }

  const { data: rows, error: rowsErr } = await db.from('sc_events')
    .select('id, series, name, start_date, end_date, date_status, status, hidden, url, source_comm_link_id, source_published_at');
  if (rowsErr) return json({ error: `events: ${rowsErr.message}` }, 500);
  const events = (rows ?? []) as EventInfo[];

  const links = await fetchLinks();
  let picked: EventInfo[];
  if (targeted) {
    const one = events.find((e) => e.id === targeted);
    if (!one) return json({ error: 'event not found' }, 404);
    picked = [one];
  } else {
    const latestLinkAt = new Map<string, string>();
    for (const e of events) {
      const newestLink = selectSources(e, links).map((s) => s.label.match(/\((\d{4}-\d{2}-\d{2})\)$/)?.[1] ?? '').sort().pop();
      if (newestLink) latestLinkAt.set(e.id, `${newestLink}T23:59:59Z`);
    }
    picked = pickEvents(events, state, latestLinkAt, new Date());
  }

  const runs: Array<Record<string, unknown>> = [];
  let calls = 0;
  for (const event of picked) {
    if (calls >= MAX_LLM_CALLS_PER_RUN && !targeted) { runs.push({ eventId: event.id, status: 'deferred' }); continue; }
    try {
      const sources = [...selectSources(event, links), ...(await fetchExtraSources(event))];
      const bundle = bundleSources(sources);
      const hash = hashText(bundle);
      if (!force && bundle && state.get(event.id)?.lastHash === hash) { runs.push({ eventId: event.id, status: 'unchanged' }); continue; }
      calls++;
      const answer = await askModel(buildPrompt(event, bundle), key);
      if (!answer) { runs.push({ eventId: event.id, status: 'model_failed' }); continue; }
      const fresh = sheetFromModel(answer, event);

      const { data: draft } = await db.from('sc_event_sheet_drafts').select('sheet').eq('event_id', event.id).maybeSingle();
      const merged: EventSheet = mergeSheets(draft?.sheet ? normalizeSheet(draft.sheet) : null, fresh.sheet);
      const { error: applyErr } = await db.rpc('sc_event_sheet_apply', {
        p_event_id: event.id, p_sheet: merged, p_actor_kind: 'ai', p_actor_id: `sc-event-sheet:${hash}`,
      });
      if (applyErr) throw new Error(`apply: ${applyErr.message}`);
      runs.push({ eventId: event.id, status: 'written', sources: sources.length, issues: fresh.issues, extractor: EXTRACTOR_VERSION });
    } catch (e) {
      runs.push({ eventId: event.id, status: 'failed', error: (e as Error).message.slice(0, 300) });
    }
  }
  return json({ ok: true, llmCalls: calls, runs });
});
