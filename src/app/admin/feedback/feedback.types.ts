/**
 * Shared shapes and pure helpers for the admin feedback board.
 *
 * Extracted from `admin-feedback.component.ts` so the guided processing mode
 * (`feedback-workflow.component.ts`) and the progress dashboard
 * (`feedback-dashboard.component.ts`) can reuse the same types and the same
 * queue/aggregation rules without importing the (large) board component —
 * which would create an import cycle. Everything in here is side-effect free
 * and unit-tested in `feedback.types.spec.ts`.
 */

export type FeedbackStatus =
  | 'open'
  | 'in_progress'
  | 'shipped'
  | 'rejected'
  | 'needs_input'
  | 'issue_created';

/**
 * Terminal statuses — a topic that reached one of these is done and lives in
 * the board's Archive tab (feedback eeba60e7). A topic ends either because it
 * shipped (`ship_ref` = PR url) or because it was handed off to a GitHub issue
 * (`ship_ref` = issue url). Legacy `rejected` rows are archived too: the
 * routine never sets that status any more, but old rows carry it and would
 * otherwise be orphaned in a view nobody opens.
 */
export const ARCHIVE_STATUSES: readonly FeedbackStatus[] = ['shipped', 'issue_created', 'rejected'];

/** True when a topic reached a terminal status (→ Archive, never worked again). */
export function isArchived(row: FeedbackRow): boolean {
  return ARCHIVE_STATUSES.includes(row.status);
}

/**
 * Which kind of link a topic's `ship_ref` points at, so the UI can label it
 * ("View change" vs "View issue"). `issue_created` rows always carry an issue
 * url; other rows are sniffed from the url, so a manually attached issue link
 * on an older row is labelled correctly too.
 */
export function refKind(row: FeedbackRow): 'issue' | 'ship' {
  if (row.status === 'issue_created') return 'issue';
  return /\/issues\/\d+/.test(row.ship_ref ?? '') ? 'issue' : 'ship';
}

export interface FeedbackAuthor {
  display_name: string | null;
  username: string | null;
}

/** One reply in a topic's thread (human admin or the automated routine). */
export interface FeedbackMessage {
  id: string;
  feedback_id: string;
  author_id: string | null;
  is_system: boolean;
  body: string;
  created_at: string;
  author: FeedbackAuthor | null;
}

export interface FeedbackRow {
  id: string;
  author_id: string | null;
  body: string;
  status: FeedbackStatus;
  ship_ref: string | null;
  processing_note: string | null;
  created_at: string;
  updated_at: string;
  shipped_at: string | null;
  processed_at: string | null;
  author: FeedbackAuthor | null;
}

/** Replies grouped by topic id, oldest first — the board's thread cache. */
export type ThreadMap = ReadonlyMap<string, FeedbackMessage[]>;

// ---- Text helpers ---------------------------------------------------------

/** Markdown stripped down to a single whitespace-collapsed plain-text line. */
export function plainText(body: string): string {
  return (body ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A concise, single-line title for a topic. Derived from the body's first
 * meaningful sentence with markup and images stripped, capped so it fits a
 * compact row. Falls back to a dash for image-only posts.
 */
export function topicTitle(body: string, max = 64): string {
  const text = plainText(body);
  if (!text) return '—';
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  const base = firstSentence.length <= max ? firstSentence : text;
  return base.length > max ? `${base.slice(0, max - 2).trimEnd()}…` : base;
}

// ---- Thread state ---------------------------------------------------------

/**
 * True when a topic still owes the admin's answer: it is `needs_input` and its
 * newest thread reply is *not* a human one — either the routine asked last, or
 * nobody replied at all yet (the question lives in the topic/processing note).
 */
export function isAwaitingAdmin(row: FeedbackRow, replies: readonly FeedbackMessage[] | undefined): boolean {
  if (row.status !== 'needs_input') return false;
  const last = replies && replies.length ? replies[replies.length - 1] : null;
  return !last || last.is_system;
}

/** Milliseconds for an ISO timestamp, or 0 when absent/unparseable. */
export function timeOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

// ---- Processing-mode queue ------------------------------------------------

/** Why an item is in the processing queue — drives its badge and copy. */
export type WorkflowKind = 'question' | 'new';

export interface WorkflowItem {
  row: FeedbackRow;
  replies: FeedbackMessage[];
  kind: WorkflowKind;
}

/**
 * Ids the admin ticked off in the processing mode, mapped to the topic's
 * `updated_at` at that moment. If the routine later touches the topic the
 * stamp no longer matches and the item resurfaces in the queue.
 */
export type HandledMap = ReadonlyMap<string, string>;

/**
 * The guided processing queue: first every Rückfrage still waiting on the
 * admin's answer, then untouched `open` topics — each group oldest first, so
 * the backlog is worked front to back.
 *
 * `in_progress` topics are deliberately excluded: the routine owns them and
 * there is nothing for the admin to do while it works.
 */
export function buildWorkflowQueue(
  rows: readonly FeedbackRow[],
  threads: ThreadMap,
  handled: HandledMap = new Map(),
): WorkflowItem[] {
  const oldestFirst = (a: WorkflowItem, b: WorkflowItem) =>
    timeOf(a.row.created_at) - timeOf(b.row.created_at);

  const questions: WorkflowItem[] = [];
  const fresh: WorkflowItem[] = [];

  for (const row of rows) {
    // Ticked off and untouched since → stays out of the queue.
    if (handled.get(row.id) === row.updated_at) continue;
    const replies = threads.get(row.id) ?? [];
    if (isAwaitingAdmin(row, replies)) questions.push({ row, replies, kind: 'question' });
    else if (row.status === 'open') fresh.push({ row, replies, kind: 'new' });
  }

  return [...questions.sort(oldestFirst), ...fresh.sort(oldestFirst)];
}

// ---- Progress statistics --------------------------------------------------

export interface FeedbackStats {
  /** Topics whose ship landed inside the window. */
  shipped: number;
  /** Topics raised inside the window that are still active (not shipped/rejected). */
  open: number;
  /** Answers the admin gave to a routine Rückfrage inside the window. */
  answered: number;
}

/** When a topic shipped — `shipped_at` if the routine set it, else its last update. */
function shippedTime(row: FeedbackRow): number {
  return timeOf(row.shipped_at) || timeOf(row.updated_at) || timeOf(row.created_at);
}

/**
 * Aggregate the board into one time window.
 *
 * `from` is an inclusive lower bound in epoch ms; pass `null` for all-time.
 * Every metric is attributed to the window by *its own* timestamp, so the
 * monthly and the all-time column are computed the exact same way:
 *
 * - `shipped`  — by the topic's ship time
 * - `open`     — by the topic's creation time (still active today)
 * - `answered` — by the answer message's creation time
 */
export function computeStats(
  rows: readonly FeedbackRow[],
  threads: ThreadMap,
  from: number | null,
): FeedbackStats {
  const inWindow = (t: number) => from === null || t >= from;
  const stats: FeedbackStats = { shipped: 0, open: 0, answered: 0 };

  for (const row of rows) {
    if (row.status === 'shipped') {
      if (inWindow(shippedTime(row))) stats.shipped++;
    } else if (!isArchived(row)) {
      // Only non-terminal topics count as still open — an `issue_created` or
      // legacy `rejected` row is done, it just didn't ship from here.
      if (inWindow(timeOf(row.created_at))) stats.open++;
    }

    // An answered Rückfrage = a human reply that directly follows a routine
    // message in the same thread. Counting messages (not topics) keeps a
    // multi-round back-and-forth honest.
    const replies = threads.get(row.id);
    if (!replies) continue;
    for (let i = 0; i < replies.length; i++) {
      const msg = replies[i];
      if (msg.is_system) continue;
      const prev = i > 0 ? replies[i - 1] : null;
      if (prev && !prev.is_system) continue;
      if (!prev && row.status !== 'needs_input') continue;
      if (inWindow(timeOf(msg.created_at))) stats.answered++;
    }
  }

  return stats;
}

/** Epoch ms for the first instant of the local month containing `now`. */
export function startOfMonth(now: number = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
