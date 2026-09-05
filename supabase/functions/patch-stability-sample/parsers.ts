// supabase/functions/patch-stability-sample/parsers.ts
// Pure parsers for the patch-stability sampler. No Deno APIs, no fetch — so
// the whole file is testable with `node --test` and shares nothing but shapes
// with index.ts. Sources and quirks are documented in
// .claude/deep-knowledge/patch-stability.md.

export interface ThreadRow {
  id: number;
  slug: string;
  subject: string;
  time_created: number;
  replies_count: number;
  votes?: { count?: number };
}

export interface LivePatch {
  line: string;
  liveAt: string;
  notes: ThreadRow;
  hotfix: ThreadRow | null;
}

export interface HotfixEvent { date: string; build: string; text: string; }
export interface CigFixes { fixes: number; fromIssueCouncil: number; crashFixes: number | null; exploitFixes: number | null; }
export interface Ticket { id: string; votes: number; excerpt: string; }
export interface TopReplyMetrics { count: number; ticketShare: number; ticketVoteShare: number; tickets: Ticket[]; }
export interface StatusWindow { unplannedMinutes: number; unplannedCount: number; openIncident: boolean; }
export interface KbSnapshot { openTotal: number; bySection: Record<string, number>; anchorIds: string[]; editedAt: string | null; }

export interface DraftBlock { type: string; text: string; depth?: number; }

const ALPHA_VERSION = /\balpha\s+v?(\d{1,2}(?:\.\d{1,2}){1,2})(?![\d.])/i;

/** 'Star Citizen Alpha 4.7.2 LIVE - Hotfix Central' → '4.7'; '' when no version. */
export function patchLineOfTitle(subject: string): string {
  const m = ALPHA_VERSION.exec(subject);
  return m ? m[1].split('.').slice(0, 2).join('.') : '';
}

const IS_LIVE_NOTES = (s: string) => /\bLIVE\b/.test(s) && /(Release|Patch) Notes/i.test(s) && !/\bPTU\b|Hotfix/i.test(s);
const IS_HOTFIX_CENTRAL = (s: string) => /\bLIVE\b/.test(s) && /Hotfix Central/i.test(s);

/**
 * Pair every LIVE release-notes thread with its line's Hotfix Central thread.
 * Newest line first. Point-release hotfix threads ("4.8.1 LIVE - Hotfix
 * 11952564") are neither — they are ordinary rows on the board.
 */
export function detectLiveThreads(rows: ThreadRow[]): LivePatch[] {
  const byLine = new Map<string, LivePatch>();
  for (const row of rows) {
    if (!IS_LIVE_NOTES(row.subject)) continue;
    const line = patchLineOfTitle(row.subject);
    if (!line || byLine.has(line)) continue;
    byLine.set(line, { line, liveAt: new Date(row.time_created * 1000).toISOString(), notes: row, hotfix: null });
  }
  for (const row of rows) {
    if (!IS_HOTFIX_CENTRAL(row.subject)) continue;
    const line = patchLineOfTitle(row.subject);
    const patch = byLine.get(line);
    if (patch && !patch.hotfix) patch.hotfix = row;
  }
  return [...byLine.values()].sort((a, b) => b.notes.time_created - a.notes.time_created);
}

/** Draft.js blocks of every `text` container, in reading order. */
export function draftBlocksOf(contentBlocks: unknown): DraftBlock[] {
  const out: DraftBlock[] = [];
  if (!Array.isArray(contentBlocks)) return out;
  for (const c of contentBlocks) {
    const rec = c && typeof c === 'object' ? (c as Record<string, unknown>) : null;
    if (!rec || rec['type'] !== 'text') continue;
    const data = rec['data'] && typeof rec['data'] === 'object' ? (rec['data'] as Record<string, unknown>) : null;
    const blocks = data ? data['blocks'] : null;
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      const rb = b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
      if (!rb) continue;
      out.push({ type: String(rb['type'] ?? ''), text: typeof rb['text'] === 'string' ? rb['text'] : '', depth: Number(rb['depth']) || 0 });
    }
  }
  return out;
}

const HOTFIX_LINE = /^►\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*:?\s*(.*)$/;

/**
 * Hotfix Central lists every hotfix as a blockquote "►M.D.YYYY: …". The date is
 * CIG's (US) calendar date, taken as-is; the build/CL number is the first
 * 7–9 digit run when there is one.
 */
export function parseHotfixEvents(contentBlocks: unknown): HotfixEvent[] {
  const events: HotfixEvent[] = [];
  for (const b of draftBlocksOf(contentBlocks)) {
    const m = HOTFIX_LINE.exec(b.text.trim());
    if (!m) continue;
    const [, mo, d, y, rest] = m;
    const text = rest.replace(/\s+/g, ' ').trim();
    const build = /\b(\d{7,9})\b/.exec(text)?.[1] ?? '';
    events.push({ date: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, build, text });
  }
  return events;
}

/**
 * "closes 479 bug fixes, with 101 of them originating from the issue council …
 * 47 crash and stability issues and 17 exploits" (4.10) or "contains over 166
 * bug and crash fixes … 73 of which originated from the issue council" (4.7–4.9).
 */
export function parseCigFixSentence(text: string): CigFixes | null {
  const flat = text.replace(/\s+/g, ' ');
  const fixes = /(?:closes|contains over)\s+(\d+)\s+bug/i.exec(flat);
  const ic = /(\d+)\s+of\s+(?:them|which)\s+originat/i.exec(flat);
  if (!fixes || !ic) return null;
  const crash = /(\d+)\s+crash and stability/i.exec(flat);
  const exploits = /(\d+)\s+exploits?/i.exec(flat);
  return {
    fixes: Number(fixes[1]),
    fromIssueCouncil: Number(ic[1]),
    crashFixes: crash ? Number(crash[1]) : null,
    exploitFixes: exploits ? Number(exploits[1]) : null,
  };
}

/** Distinct STARC ids in reading order — bare `STARC-123` or inside an issue-council url. */
export function ticketIdsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/STARC-\d{3,7}/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

export interface ReplyRow {
  votes?: { count?: number };
  time_created?: number;
  content_blocks?: unknown;
}

const EXCERPT_CHARS = 120;
const MAX_TICKETS = 10;

/** The community metrics of one thread's top-voted replies (the API returns at most 25). */
export function topReplyMetrics(replies: ReplyRow[]): TopReplyMetrics {
  if (replies.length === 0) return { count: 0, ticketShare: 0, ticketVoteShare: 0, tickets: [] };
  let withTicket = 0;
  let votesAll = 0;
  let votesTicket = 0;
  const tickets: Ticket[] = [];
  for (const r of replies) {
    const votes = Number(r.votes?.count ?? 0) || 0;
    const text = draftBlocksOf(r.content_blocks).map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim();
    const ids = ticketIdsOf(text);
    votesAll += votes;
    if (ids.length > 0) {
      withTicket++;
      votesTicket += votes;
      const excerpt = text.length > EXCERPT_CHARS ? text.slice(0, EXCERPT_CHARS).trimEnd() + '…' : text;
      for (const id of ids) if (!tickets.some((t) => t.id === id)) tickets.push({ id, votes, excerpt });
    }
  }
  tickets.sort((a, b) => b.votes - a.votes);
  return {
    count: replies.length,
    ticketShare: withTicket / replies.length,
    ticketVoteShare: votesAll > 0 ? votesTicket / votesAll : 0,
    tickets: tickets.slice(0, MAX_TICKETS),
  };
}

export interface StatusIssue {
  is?: string;
  title?: string;
  createdAt?: string;
  severity?: string;
  resolved?: boolean;
  resolvedAt?: string;
  affected?: string[];
}

/** cState writes '2026-08-26 14:15:00 +0000 UTC' (createdAt) and '2026-08-26 18:30:00' (resolvedAt, UTC). */
export function parseCstateDate(s: string | undefined): number {
  if (!s) return NaN;
  const iso = s.replace(/ \+0000 UTC$/, 'Z').replace(/ UTC$/, 'Z').replace(' ', 'T');
  const t = Date.parse(/[Z+-]\d{0,4}$/.test(iso) ? iso : iso + 'Z');
  return t;
}

/**
 * Unplanned (`severity != maintenance`) incident minutes overlapping
 * [fromIso, toIso), clipped to the window; an unresolved incident runs to the
 * window end and flips `openIncident`.
 */
export function statusWindow(issues: StatusIssue[], fromIso: string, toIso: string): StatusWindow {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  let minutes = 0;
  let count = 0;
  let open = false;
  for (const p of issues) {
    if (p.is !== 'issue' || !p.createdAt || p.createdAt.startsWith('0001')) continue;
    if (!p.severity || p.severity === 'maintenance') continue;
    const start = parseCstateDate(p.createdAt);
    if (!Number.isFinite(start)) continue;
    const resolvedAt = p.resolved === false || !p.resolvedAt ? NaN : parseCstateDate(p.resolvedAt);
    const end = Number.isFinite(resolvedAt) ? resolvedAt : to;
    if (end <= from || start >= to) continue;
    count++;
    if (!Number.isFinite(resolvedAt) && end >= to) open = true;
    minutes += Math.max(0, Math.min(end, to) - Math.max(start, from)) / 60_000;
  }
  return { unplannedMinutes: Math.round(minutes), unplannedCount: count, openIncident: open };
}

export interface KbArticle { title?: string; edited_at?: string; body?: string; }

/**
 * CIG's Known Issues article: one evergreen page retitled per patch. Entries
 * are the anchored h2/h3 under h1 sections. Null when the title does not name
 * `line` — the sampler then stores null instead of another patch's list.
 */
export function kbSnapshot(article: KbArticle, line: string): KbSnapshot | null {
  const title = article.title ?? '';
  if (!new RegExp(`\\bAlpha\\s+${line.replace('.', '\\.')}(?![\\d.])`, 'i').test(title)) return null;
  const body = article.body ?? '';
  const bySection: Record<string, number> = {};
  const anchorIds: string[] = [];
  let section = '';
  const tag = /<(h1|h2|h3)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const m of body.matchAll(tag)) {
    const [, level, attrs, inner] = m;
    if (level.toLowerCase() === 'h1') {
      section = inner.replace(/<[^>]+>/g, '').trim();
      if (section && !(section in bySection)) bySection[section] = 0;
      continue;
    }
    const id = /\bid="(h_[^"]+)"/i.exec(attrs)?.[1];
    if (!id) continue;
    anchorIds.push(id);
    if (section) bySection[section] = (bySection[section] ?? 0) + 1;
  }
  return { openTotal: anchorIds.length, bySection, anchorIds, editedAt: article.edited_at ?? null };
}
