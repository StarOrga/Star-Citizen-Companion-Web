// supabase/functions/patch-stability-sample/index.ts
// patch-stability-sample — the daily sampler behind the patch board's
// stability indicator (spec: docs/superpowers/specs/2026-09-05-patch-stability-indicator-design.md).
//
// One run, once a day (pg_cron → pg_net → here):
//   1. Spectrum forum 190048 thread list → which LIVE lines exist, their
//      release-notes and Hotfix-Central threads → upsert patch_stability_patches.
//   2. For the newest line AND the one before it (its threads still receive
//      comments): both threads' nested payload → reply/vote counts, the 25
//      top-voted replies' Issue-Council ticket metrics, hotfix events.
//   3. status.robertsspaceindustries.com/issues/index.json → unplanned minutes
//      over the trailing 7 days, open incident.
//   4. CIG Known Issues article (Zendesk Help Center API) → entry count per
//      section, when its title names the line.
//   → one row per line in patch_stability_samples (upsert on the day).
//
// `?backfill=1` registers every LIVE line the forum still lists (6 pages ≈ two
// years) with its measured END-STATE, for lines that predate the sampler.
//
// verify_jwt=false (config.toml): public data, no user data. Self-throttled:
// a run is skipped when the newest sample is younger than 6 h, so a stray
// unauthenticated trigger costs one cheap query and nothing upstream.
//
// The formula is NOT here. Raw numbers only — see src/app/news/patch-stability.ts.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  LivePatch,
  ReplyRow,
  StatusIssue,
  ThreadRow,
  detectLiveThreads,
  draftBlocksOf,
  kbSnapshot,
  parseCigFixSentence,
  parseHotfixEvents,
  statusWindow,
  topReplyMetrics,
} from './parsers.ts';

const RSI_BASE = 'https://robertsspaceindustries.com';
const SPECTRUM_LIST_URL = `${RSI_BASE}/api/spectrum/forum/channel/threads`;
const SPECTRUM_THREAD_URL = `${RSI_BASE}/api/spectrum/forum/thread/nested`;
const PATCH_NOTES_CHANNEL_ID = 190048;
const STATUS_URL = 'https://status.robertsspaceindustries.com/issues/index.json';
const KB_URL = 'https://support.robertsspaceindustries.com/api/v2/help_center/en-us/articles/360056254754.json';
const USER_AGENT = 'SC-Companion/0.6 (+patch-stability)';

const LIST_PAGES_DAILY = 2;
const LIST_PAGES_BACKFILL = 6;
const THROTTLE_MS = 6 * 60 * 60 * 1000;
const WINDOW_DAYS = 7;
const TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const spectrumHeaders = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'X-Tavern-Id': '1',
  'User-Agent': USER_AGENT,
};

async function listThreads(pages: number): Promise<ThreadRow[]> {
  const rows: ThreadRow[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= pages; page++) {
    const json = await fetchJson(SPECTRUM_LIST_URL, {
      method: 'POST',
      headers: spectrumHeaders,
      body: JSON.stringify({ channel_id: PATCH_NOTES_CHANNEL_ID, page, sort: 'newest' }),
    }) as { data?: { threads?: unknown[] } };
    const threads = json?.data?.threads ?? [];
    if (threads.length === 0) break;
    for (const t of threads) {
      const r = t as Record<string, unknown>;
      const id = Number(r['id']);
      if (!Number.isFinite(id) || seen.has(id)) continue; // pinned threads repeat on every page
      seen.add(id);
      rows.push({
        id,
        slug: String(r['slug'] ?? ''),
        subject: String(r['subject'] ?? ''),
        time_created: Number(r['time_created']) || 0,
        replies_count: Number(r['replies_count']) || 0,
        votes: r['votes'] as { count?: number } | undefined,
      });
    }
  }
  return rows;
}

interface ThreadPayload {
  replies_count: number;
  votes: number;
  replies: ReplyRow[];
  content_blocks: unknown;
}

async function fetchThread(slug: string): Promise<ThreadPayload | null> {
  try {
    const json = await fetchJson(SPECTRUM_THREAD_URL, {
      method: 'POST',
      headers: spectrumHeaders,
      body: JSON.stringify({ slug, channel_id: String(PATCH_NOTES_CHANNEL_ID), sort: 'votes', page: 1 }),
    }) as { data?: Record<string, unknown> };
    const d = json?.data;
    if (!d) return null;
    return {
      replies_count: Number(d['replies_count']) || 0,
      votes: Number((d['votes'] as { count?: number } | undefined)?.count) || 0,
      replies: Array.isArray(d['replies']) ? (d['replies'] as ReplyRow[]) : [],
      content_blocks: d['content_blocks'],
    };
  } catch (err) {
    console.error(`patch-stability: thread ${slug} failed:`, err);
    return null;
  }
}

async function fetchStatusIssues(): Promise<StatusIssue[] | null> {
  try {
    const json = await fetchJson(STATUS_URL, { headers: { 'User-Agent': USER_AGENT } }) as { pages?: Record<string, StatusIssue> };
    return json?.pages ? Object.values(json.pages) : [];
  } catch (err) {
    console.error('patch-stability: status fetch failed:', err);
    return null;
  }
}

async function fetchKbArticle(): Promise<{ title?: string; edited_at?: string; body?: string } | null> {
  try {
    const json = await fetchJson(KB_URL, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } }) as { article?: Record<string, unknown> };
    const a = json?.article;
    return a ? { title: String(a['title'] ?? ''), edited_at: String(a['edited_at'] ?? ''), body: String(a['body'] ?? '') } : null;
  } catch (err) {
    console.error('patch-stability: KB fetch failed:', err);
    return null;
  }
}

/** Merge the top-25 replies of both threads into one 50-reply population. */
function communityOf(rn: ThreadPayload | null, hf: ThreadPayload | null) {
  const replies = [...(rn?.replies ?? []), ...(hf?.replies ?? [])];
  return topReplyMetrics(replies);
}

async function upsertPatch(patch: LivePatch, rn: ThreadPayload | null, extra: Record<string, unknown> = {}) {
  const text = rn ? draftBlocksOf(rn.content_blocks).map((b) => b.text).join('\n') : '';
  const cig = text ? parseCigFixSentence(text) : null;
  const { error } = await admin().from('patch_stability_patches').upsert({
    patch_line: patch.line,
    live_at: patch.liveAt,
    notes_thread_id: patch.notes.id,
    notes_slug: patch.notes.slug,
    hotfix_thread_id: patch.hotfix?.id ?? null,
    hotfix_slug: patch.hotfix?.slug ?? null,
    cig_fixes: cig?.fixes ?? null,
    cig_fixes_ic: cig?.fromIssueCouncil ?? null,
    cig_crash_fixes: cig?.crashFixes ?? null,
    cig_exploit_fixes: cig?.exploitFixes ?? null,
    updated_at: new Date().toISOString(),
    ...extra,
  }, { onConflict: 'patch_line' });
  if (error) throw new Error(`patches upsert ${patch.line}: ${error.message}`);
}

async function sampleLine(patch: LivePatch, issues: StatusIssue[] | null, kb: Awaited<ReturnType<typeof fetchKbArticle>>, now: Date) {
  const [rn, hf] = await Promise.all([
    fetchThread(patch.notes.slug),
    patch.hotfix ? fetchThread(patch.hotfix.slug) : Promise.resolve(null),
  ]);
  if (!rn) throw new Error(`release-notes thread unavailable for ${patch.line}`);
  await upsertPatch(patch, rn);

  const community = communityOf(rn, hf);
  const window = issues
    ? statusWindow(issues, new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString(), now.toISOString())
    : { unplannedMinutes: 0, unplannedCount: 0, openIncident: false };
  const snap = kb ? kbSnapshot(kb, patch.line) : null;

  const { error } = await admin().from('patch_stability_samples').upsert({
    patch_line: patch.line,
    sampled_on: now.toISOString().slice(0, 10),
    sampled_at: now.toISOString(),
    rn_replies: rn.replies_count,
    rn_votes: rn.votes,
    hf_replies: hf?.replies_count ?? null,
    hf_votes: hf?.votes ?? null,
    top_ticket_share: community.ticketShare,
    top_ticket_vote_share: community.ticketVoteShare,
    top_tickets: community.tickets,
    hotfix_events: hf ? parseHotfixEvents(hf.content_blocks) : [],
    outage_min_7d: window.unplannedMinutes,
    open_incident: window.openIncident,
    kb_open_total: snap?.openTotal ?? null,
    kb_by_section: snap?.bySection ?? null,
    kb_anchor_ids: snap?.anchorIds ?? null,
    kb_edited_at: snap?.editedAt ?? null,
  }, { onConflict: 'patch_line,sampled_on' });
  if (error) throw new Error(`samples upsert ${patch.line}: ${error.message}`);
}

async function newestSampleAt(): Promise<number> {
  const { data } = await admin()
    .from('patch_stability_samples')
    .select('sampled_at')
    .order('sampled_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const t = data ? Date.parse(String((data as { sampled_at: string }).sampled_at)) : NaN;
  return Number.isFinite(t) ? t : 0;
}

async function runDaily(force: boolean): Promise<Response> {
  const now = new Date();
  if (!force && now.getTime() - (await newestSampleAt()) < THROTTLE_MS) {
    return json({ ok: true, skipped: true });
  }
  const rows = await listThreads(LIST_PAGES_DAILY);
  const lines = detectLiveThreads(rows).slice(0, 2); // newest + previous
  const [issues, kb] = await Promise.all([fetchStatusIssues(), fetchKbArticle()]);
  const done: string[] = [];
  for (const patch of lines) {
    try {
      await sampleLine(patch, issues, kb, now);
      done.push(patch.line);
    } catch (err) {
      console.error(`patch-stability: line ${patch.line} failed:`, err);
    }
  }
  return json({ ok: true, lines: done });
}

/**
 * End-state for every LIVE line on the board: replies and top-reply ticket
 * metrics of both threads, unplanned status minutes per live day over the
 * line's whole window (live_at → next line's live_at, or now).
 */
async function runBackfill(): Promise<Response> {
  const now = new Date();
  const rows = await listThreads(LIST_PAGES_BACKFILL);
  const lines = detectLiveThreads(rows); // newest first
  const issues = await fetchStatusIssues();
  let registered = 0;
  for (let i = 0; i < lines.length; i++) {
    const patch = lines[i];
    const endIso = i === 0 ? now.toISOString() : lines[i - 1].liveAt;
    const days = Math.max(1, (Date.parse(endIso) - Date.parse(patch.liveAt)) / DAY_MS);
    try {
      const [rn, hf] = await Promise.all([
        fetchThread(patch.notes.slug),
        patch.hotfix ? fetchThread(patch.hotfix.slug) : Promise.resolve(null),
      ]);
      if (!rn) continue;
      const community = communityOf(rn, hf);
      const window = issues ? statusWindow(issues, patch.liveAt, endIso) : null;
      await upsertPatch(patch, rn, {
        // RN only: Hotfix Central threads were locked before 4.9, so the RN
        // count is the one comparable across every line.
        final_replies: rn.replies_count,
        final_outage_min_per_day: window ? window.unplannedMinutes / days : null,
        final_ticket_share: community.ticketShare,
        final_ticket_vote_share: community.ticketVoteShare,
      });
      registered++;
    } catch (err) {
      console.error(`patch-stability backfill ${patch.line} failed:`, err);
    }
  }
  return json({ ok: true, registered });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: 'service role not configured' }, 500);
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('backfill') === '1') return await runBackfill();
    return await runDaily(url.searchParams.get('force') === '1');
  } catch (err) {
    console.error('patch-stability-sample failed:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
