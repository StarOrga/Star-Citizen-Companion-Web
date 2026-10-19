// sc-events-sync — keeps public.sc_events (the Star Citizen event timeline the
// desktop app reads via the `sc_events_feed()` RPC) in step with official RSI
// Comm-Links, without anyone touching it.
//
// Source: the Star Citizen Wiki API (api.star-citizen.wiki/api/comm-links),
// a public mirror of RSI Comm-Links incl. body text. We never scrape
// robertsspaceindustries.com — rows only LINK to the RSI post.
//
// Robustness contract (the reason this exists as a scheduled job):
//   * Every response is schema-checked; a changed shape or an empty parse marks
//     the run `degraded` and writes NOTHING — last-known-good data stays.
//   * Writes are idempotent upserts through sc_events_upsert_scraped(), which
//     enforces in SQL: locked rows untouched, confirmed never downgraded,
//     names/summaries of curated rows kept. Nothing is ever deleted.
//   * Every run is logged in sc_events_scrape_runs (status, counts, changes,
//     needs_review, error, parser_version) → sc_events_health().
//   * AI is a fallback only: event-family title but no parseable dates, and only
//     with ANTHROPIC_API_KEY / OPENAI_API_KEY / GROK_API_KEY set (that order). Accepts confidence >= 0.8 and
//     validated dates; otherwise the item is logged as needs_review.
//   * Self-throttled (one run per 5 min) so the public URL cannot be used to
//     hammer the wiki API. verify_jwt=false: pg_cron calls it with the
//     publishable key, like patch-stability-sample.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  type Candidate, type CommLink, type EventRow, FAMILIES, PARSER_VERSION, type Unsure,
  isIsoDate, isPlausible, matchCommLinks, parseCommLink, planUpserts,
} from './matcher.ts';

const API = 'https://api.star-citizen.wiki/api/comm-links';
const PAGES = 3; // 3 x 100 newest Comm-Links ≈ 4–6 months of posts
const FETCH_TIMEOUT_MS = 15_000;
const AI_TIMEOUT_MS = 25_000;
const AI_MAX_CALLS = 5;
const USER_AGENT = 'SC-Companion/1.0 (+sc-events-sync)';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCommLinks(): Promise<{ links: CommLink[]; rawCount: number; invalid: number; errors: string[] }> {
  const links: CommLink[] = [];
  const errors: string[] = [];
  let rawCount = 0;
  let invalid = 0;
  for (let page = 1; page <= PAGES; page++) {
    const url = `${API}?page%5Bsize%5D=100&page%5Bnumber%5D=${page}`;
    let body: unknown = null;
    for (let attempt = 0; attempt < 2 && body === null; attempt++) {
      try {
        body = await fetchJson(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
      } catch (e) {
        if (attempt === 1) errors.push(`page ${page}: ${(e as Error).message}`);
      }
    }
    if (body === null) continue;
    const data = (body as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      errors.push(`page ${page}: response shape changed (no data[])`);
      continue;
    }
    rawCount += data.length;
    for (const item of data) {
      const link = parseCommLink(item);
      if (link) links.push(link);
      else invalid++;
    }
  }
  return { links, rawCount, invalid, errors };
}

// ------------------------------------------------------------------ AI fallback

interface AiVerdict { matches_event_family: boolean; start: string | null; end: string | null; confidence: number }

function aiPrompt(u: Unsure): string {
  return [
    'You extract Star Citizen in-game event dates from an official RSI Comm-Link.',
    `Event family: "${FAMILIES.find((f) => f.series === u.series)?.name ?? u.series}".`,
    `Comm-Link title: "${u.title}" (published ${u.publishedAt.slice(0, 10)}).`,
    `Excerpt: """${u.excerpt}"""`,
    'Answer with ONLY a JSON object, no prose:',
    '{"matches_event_family": boolean, "start": "YYYY-MM-DD"|null, "end": "YYYY-MM-DD"|null, "confidence": number 0..1}',
    'Use real-world calendar dates (not in-game year 29xx). If the text does not state the event dates, set start/end null and confidence 0.',
  ].join('\n');
}

function parseVerdict(text: string): AiVerdict | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    if (typeof v.matches_event_family !== 'boolean' || typeof v.confidence !== 'number') return null;
    return { matches_event_family: v.matches_event_family, start: v.start ?? null, end: v.end ?? null, confidence: v.confidence };
  } catch {
    return null;
  }
}

async function askAi(u: Unsure): Promise<AiVerdict | null> {
  const anthropic = Deno.env.get('ANTHROPIC_API_KEY');
  const openai = Deno.env.get('OPENAI_API_KEY');
  if (anthropic) {
    const res = await fetchJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': anthropic, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: Deno.env.get('SC_EVENTS_AI_MODEL') ?? 'claude-haiku-4-5',
        max_tokens: 200,
        messages: [{ role: 'user', content: aiPrompt(u) }],
      }),
    }, AI_TIMEOUT_MS) as { content?: Array<{ type: string; text?: string }> };
    return parseVerdict(res.content?.find((c) => c.type === 'text')?.text ?? '');
  }
  const grok = Deno.env.get('GROK_API_KEY');
  if (openai || grok) {
    // xAI's API is OpenAI-compatible; GROK_API_KEY is already set for other functions.
    const endpoint = openai ? 'https://api.openai.com/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions';
    const res = await fetchJson(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${openai ?? grok}` },
      body: JSON.stringify({
        model: Deno.env.get('SC_EVENTS_AI_MODEL') ?? (openai ? 'gpt-4o-mini' : 'grok-3-mini'),
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: aiPrompt(u) }],
      }),
    }, AI_TIMEOUT_MS) as { choices?: Array<{ message?: { content?: string } }> };
    return parseVerdict(res.choices?.[0]?.message?.content ?? '');
  }
  return null;
}

async function resolveUnsure(unsure: Unsure[], knownIds: Set<number>): Promise<{ candidates: Candidate[]; review: Array<Unsure & { ai?: string }> }> {
  const candidates: Candidate[] = [];
  const review: Array<Unsure & { ai?: string }> = [];
  const hasKey = Boolean(Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('OPENAI_API_KEY') || Deno.env.get('GROK_API_KEY'));
  let calls = 0;
  for (const u of unsure) {
    if (knownIds.has(u.commLinkId)) continue; // already applied from this post earlier
    if (!hasKey || calls >= AI_MAX_CALLS) { review.push({ ...u, ai: hasKey ? 'call budget exhausted' : 'no AI key' }); continue; }
    calls++;
    try {
      const v = await askAi(u);
      const fam = FAMILIES.find((f) => f.series === u.series)!;
      const ok = v && v.matches_event_family && v.confidence >= 0.8 && isIsoDate(v.start) && isIsoDate(v.end)
        && isPlausible(fam, { start: v.start!, end: v.end! }, new Date(u.publishedAt));
      if (ok) {
        candidates.push({ series: u.series, start: v!.start!, end: v!.end!, url: u.url, commLinkId: u.commLinkId, publishedAt: u.publishedAt, source: 'ai', freeFly: fam.freeFly });
      } else {
        review.push({ ...u, ai: v ? `rejected (confidence ${v.confidence}, ${v.start}..${v.end})` : 'unparseable answer' });
      }
    } catch (e) {
      review.push({ ...u, ai: `error: ${(e as Error).message}` });
    }
  }
  return { candidates, review: review.map(({ excerpt: _e, ...r }) => r as Unsure & { ai?: string }) };
}

// ------------------------------------------------------------------ handler

Deno.serve(async (req) => {
  // POST only: pg_cron posts, and a GET would let any link or <img> on the web start a run.
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const startedMs = Date.now();

  // Throttle + reap runs that died mid-flight (worker killed → stuck "running").
  await db.from('sc_events_scrape_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error: 'run did not finish (worker killed or timed out)' })
    .eq('status', 'running').lt('started_at', new Date(Date.now() - 30 * 60_000).toISOString());
  const { data: recent } = await db.from('sc_events_scrape_runs').select('id').gt('started_at', new Date(Date.now() - 5 * 60_000).toISOString()).limit(1);
  if (recent?.length) return json({ skipped: 'throttled: a run started less than 5 minutes ago' }, 429);

  const { data: run, error: runErr } = await db.from('sc_events_scrape_runs')
    .insert({ source: 'star-citizen-wiki:comm-links', status: 'running', parser_version: PARSER_VERSION }).select('id').single();
  if (runErr || !run) return json({ error: `cannot open run log: ${runErr?.message}` }, 500);

  const finish = async (fields: Record<string, unknown>) => {
    await db.from('sc_events_scrape_runs').update({ ...fields, finished_at: new Date().toISOString(), duration_ms: Date.now() - startedMs }).eq('id', run.id);
    return json({ runId: run.id, parserVersion: PARSER_VERSION, ...fields });
  };

  try {
    const { links, rawCount, invalid, errors } = await fetchCommLinks();
    const shapeBroken = rawCount > 0 && invalid / rawCount > 0.5;
    if (links.length === 0 || shapeBroken) {
      return await finish({
        status: 'degraded', parsed_count: links.length, matched_count: 0,
        error: [shapeBroken ? `schema check failed for ${invalid}/${rawCount} items` : 'parsed 0 comm-links', ...errors].join('; '),
      });
    }

    const { data: rows, error: rowsErr } = await db.from('sc_events')
      .select('id, series, kind, name, start_date, end_date, date_status, status, free_fly, url, locked, hidden, source, source_comm_link_id, source_published_at');
    if (rowsErr) throw new Error(`read sc_events: ${rowsErr.message}`);

    const { candidates, unsure } = matchCommLinks(links);
    const knownIds = new Set((rows as EventRow[]).map((r) => r.source_comm_link_id).filter((x): x is number => x !== null));
    const ai = await resolveUnsure(unsure, knownIds);
    const today = new Date().toISOString().slice(0, 10);
    const plan = planUpserts(rows as EventRow[], [...candidates, ...ai.candidates], today);

    let written = 0;
    if (plan.upserts.length) {
      const { data: n, error: upErr } = await db.rpc('sc_events_upsert_scraped', { p_events: plan.upserts });
      if (upErr) throw new Error(`upsert: ${upErr.message}`);
      written = Number(n ?? 0);
    }

    return await finish({
      status: errors.length || invalid / rawCount > 0.1 ? 'degraded' : 'ok',
      parsed_count: links.length,
      matched_count: candidates.length + ai.candidates.length,
      written_count: written,
      changes: plan.changes,
      needs_review: ai.review,
      skipped: plan.skipped,
      error: [...errors, invalid ? `${invalid}/${rawCount} items failed the schema check` : ''].filter(Boolean).join('; ') || null,
    });
  } catch (e) {
    return await finish({ status: 'failed', error: (e as Error).message.slice(0, 2000) });
  }
});
