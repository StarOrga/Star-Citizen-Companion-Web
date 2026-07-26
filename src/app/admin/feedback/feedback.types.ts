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

/**
 * The raw DB status vocabulary. Note the two "needs input" flavours, which mean
 * opposite things and have opposite visibility (feedback 5920cf8c):
 *
 * - `needs_input` — the ROUTINE asked the ADMIN. Admin-only; the feedback author
 *   of a user-submitted topic never learns it exists (it folds into their
 *   "in Bearbeitung").
 * - `needs_input_author` — the ADMIN asked the AUTHOR. Author-facing, and parked
 *   out of the routine's `open` queue until the answer arrives.
 */
export type FeedbackStatus =
  | 'open'
  | 'in_progress'
  | 'shipped'
  | 'rejected'
  | 'needs_input'
  | 'needs_input_author'
  | 'issue_created'
  | 'declined';

/**
 * Terminal statuses — a topic that reached one of these is done and lives in
 * the board's Archive tab (feedback eeba60e7). A topic ends either because it
 * shipped (`ship_ref` = PR url), because it was handed off to a GitHub issue
 * (`ship_ref` = issue url), or because the admin decided against implementing a
 * user-submitted topic (`declined`, `decision_note` = the explanation the
 * author is shown — feedback 5920cf8c). Legacy `rejected` rows are archived
 * too: the routine never sets that status any more, but old rows carry it and
 * would otherwise be orphaned in a view nobody opens.
 */
export const ARCHIVE_STATUSES: readonly FeedbackStatus[] = [
  'shipped',
  'issue_created',
  'rejected',
  'declined',
];

/**
 * True when a topic reached a terminal status (→ Archive). `shipped` is terminal
 * only *at rest*: when the admin replies to a shipped topic after the ship it is
 * reopened as a continuation (the routine's post-ship review loop, see
 * docs/feedback-routine "Post-ship review & continue"), so it belongs on the
 * active board again — pass its thread so that case is caught. Without the thread
 * the check falls back to status only (a shipped row reads as archived), matching
 * the old behaviour for callers that don't track replies.
 */
export function isArchived(row: FeedbackRow, replies?: readonly FeedbackMessage[]): boolean {
  return ARCHIVE_STATUSES.includes(row.status) && !isContinuedAfterShip(row, replies);
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
  /**
   * Who filed the topic (feedback 5920cf8c): `admin` = posted on the internal
   * board, `user` = submitted through the non-admin FAB by a viewer or
   * collaborator. Optional so the many test/fixture rows in the specs keep
   * compiling; absent means `admin`.
   */
  source?: 'admin' | 'user';
  /**
   * Release gate for the autonomous routine. A user-submitted topic enters
   * untriaged so an admin reads it before Claude may implement and ship it;
   * admin-authored rows are triaged by definition.
   */
  triaged?: boolean;
  /** The admin's explanation on a `declined` topic — shown to the author. */
  decision_note?: string | null;
}

/** True for a topic a non-admin filed through the user feedback FAB. */
export function isUserSubmitted(row: FeedbackRow): boolean {
  return row.source === 'user';
}

/**
 * True while a user-submitted topic waits for an admin to release it to the
 * routine — on first submission, and again after its author answered a question
 * (their answer is fresh outside text, so it gets re-read before an agent that
 * ships on its own acts on it). Admin-authored topics (and every row from before
 * feedback 5920cf8c) are never gated.
 */
export function awaitsTriage(row: FeedbackRow): boolean {
  return isUserSubmitted(row) && row.triaged === false;
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

/**
 * True when a *shipped* topic has been reopened by a human follow-up: its newest
 * thread reply is the admin's and it landed **after** the ship (`shipped_at`).
 * This is the board side of the routine's post-ship review loop
 * (docs/feedback-routine "Post-ship review & continue"): the admin looked at the
 * shipped change live and replied to keep iterating, so the topic is back on the
 * routine's pile even though its DB status is still `shipped` (the routine flips
 * it to `in_progress` on its next run, ~≤20 min). The routine's own review reply
 * is `is_system`, so only a *human* reply flips this on — the exact condition of
 * the routine's continuation query (d). The ship reference time mirrors that
 * query's `coalesce(shipped_at, processed_at, created_at)`.
 */
export function isContinuedAfterShip(
  row: FeedbackRow,
  replies?: readonly FeedbackMessage[],
): boolean {
  if (row.status !== 'shipped') return false;
  const last = replies && replies.length ? replies[replies.length - 1] : null;
  if (!last || last.is_system) return false;
  const shipRef = timeOf(row.shipped_at) || timeOf(row.processed_at) || timeOf(row.created_at);
  return timeOf(last.created_at) > shipRef;
}

// ---- Presentation buckets -------------------------------------------------

/**
 * The bucket a topic is *presented* in. This is the board's display vocabulary
 * and deliberately not the same thing as the DB status: `needs_input` splits in
 * two, because the two halves mean opposite things for the admin.
 *
 * - `awaiting_admin` — a Rückfrage the routine asked and nobody answered yet:
 *   the ball is with the admin.
 * - `awaiting_author` — the mirror image (feedback 5920cf8c): the admin asked the
 *   person who filed a user topic and waits on them. Active, but nothing for the
 *   admin or the routine to do — hence its own bucket rather than ToDo.
 * - `todo` — everything the *routine* still has to pick up. That is every
 *   untouched `open` topic **and** an already-answered Rückfrage (feedback
 *   34c44134): once the admin replied, the topic is back on the routine's pile,
 *   so it belongs to the ToDo bucket rather than into its own "answered" corner.
 * - `in_progress` — the routine is working on it right now.
 * - `shipped` / `issue_created` / `rejected` / `declined` — terminal, mirrors
 *   the status — except a `shipped` topic the admin replied to after the ship,
 *   which reopens as a continuation and buckets as `todo` (see
 *   {@link isContinuedAfterShip}). `declined` is the admin's "nicht umsetzen"
 *   on a user-submitted topic (feedback 5920cf8c).
 *
 * The DB status value is never touched by this — `open` stays `open` on the
 * wire, "ToDo" is purely the label the UI puts on the bucket.
 */
export type FeedbackBucket =
  | 'awaiting_admin'
  | 'awaiting_author'
  | 'todo'
  | 'in_progress'
  | 'shipped'
  | 'issue_created'
  | 'rejected'
  | 'declined';

/** Buckets that are still on the board's working set (the Active tab). */
export const ACTIVE_BUCKETS: readonly FeedbackBucket[] = [
  'awaiting_admin',
  'awaiting_author',
  'todo',
  'in_progress',
];

/**
 * The single bucketing rule for the whole board: status filter, day-grouped
 * list, TOC and dashboard all resolve a topic through this function instead of
 * re-deriving "is this really still open?" per view.
 */
export function feedbackBucket(
  row: FeedbackRow,
  replies?: readonly FeedbackMessage[],
): FeedbackBucket {
  switch (row.status) {
    case 'issue_created':
    case 'rejected':
    case 'declined':
      return row.status;
    case 'shipped':
      // Terminal at rest, but a human reply after the ship reopens it as a
      // continuation → back on the routine's pile → ToDo (see isContinuedAfterShip).
      return isContinuedAfterShip(row, replies) ? 'todo' : 'shipped';
    case 'in_progress':
      return 'in_progress';
    case 'needs_input_author':
      // The admin asked the topic's author and waits on them. There is no
      // "answered" half to split off here: the author's reply restores the status
      // the topic had before the question (database trigger on the author
      // channel), so this status always means "waiting on the author".
      return 'awaiting_author';
    case 'needs_input':
      // Answered → back on the routine's pile → ToDo. Still unanswered → the
      // admin owes the answer and keeps the distinct Rückfrage presentation.
      return isAwaitingAdmin(row, replies) ? 'awaiting_admin' : 'todo';
    default:
      return 'todo';
  }
}

/**
 * The status vocabulary a bucket is labelled with, so the UI can keep using the
 * existing `adminFeedback.status.*` translation keys: `todo` reads as the
 * (renamed) `open` label "ToDo", `awaiting_admin` as "Rückfrage",
 * `awaiting_author` as "Rückfrage an Absender".
 */
export function bucketLabelStatus(bucket: FeedbackBucket): FeedbackStatus {
  if (bucket === 'todo') return 'open';
  if (bucket === 'awaiting_admin') return 'needs_input';
  if (bucket === 'awaiting_author') return 'needs_input_author';
  return bucket;
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
    const bucket = feedbackBucket(row, replies);
    if (bucket === 'awaiting_admin') questions.push({ row, replies, kind: 'question' });
    // Only *untouched* ToDo topics are work for the admin. An already-answered
    // Rückfrage shares the ToDo bucket in the board views, but the admin is done
    // with it — it waits on the routine, so it stays out of this queue. So does
    // `awaiting_author`: the ball is with the topic's author, and their answer
    // returns the row to `open`, which re-enters it here on its own.
    else if (bucket === 'todo' && row.status === 'open') fresh.push({ row, replies, kind: 'new' });
  }

  return [...questions.sort(oldestFirst), ...fresh.sort(oldestFirst)];
}

/**
 * Whose topics the processing mode walks through (feedback abfa97c6). The board
 * is shared by several admins, and working the queue is a personal chore: the
 * topics *you* raised are the ones you can answer without guessing. So the mode
 * runs on `mine` by default and the other two scopes are one click away.
 */
export type WorkflowScope = 'mine' | 'others' | 'all';

/** The three scopes in switch order — `mine` first, because it is the default. */
export const WORKFLOW_SCOPES: readonly WorkflowScope[] = ['mine', 'others', 'all'];

/** How many queue items each scope holds — the KPIs on the scope switch. */
export interface WorkflowScopeCounts {
  mine: number;
  others: number;
  all: number;
}

/**
 * True when a topic was raised by the current admin. A topic without an author
 * (orphaned / routine-created) is never "mine", so it surfaces under `others`
 * rather than disappearing from every scope.
 */
export function isOwnTopic(row: FeedbackRow, selfId: string | null | undefined): boolean {
  return !!selfId && row.author_id === selfId;
}

/**
 * Narrow an already-built queue to one scope. Without a known `selfId` (auth not
 * settled yet) ownership is unknowable, so the full queue is returned rather than
 * an empty one — a signed-in admin never stares at a blank mode because the user
 * object arrived a tick late.
 */
export function filterWorkflowScope(
  items: readonly WorkflowItem[],
  scope: WorkflowScope,
  selfId: string | null | undefined,
): WorkflowItem[] {
  if (scope === 'all' || !selfId) return [...items];
  const wantOwn = scope === 'mine';
  return items.filter((item) => isOwnTopic(item.row, selfId) === wantOwn);
}

/** Queue sizes per scope, for the switch's counts. `all` is the untouched total. */
export function workflowScopeCounts(
  items: readonly WorkflowItem[],
  selfId: string | null | undefined,
): WorkflowScopeCounts {
  let mine = 0;
  for (const item of items) if (isOwnTopic(item.row, selfId)) mine++;
  return { mine, others: items.length - mine, all: items.length };
}

/**
 * Which thread message the processing mode should put in front of the admin
 * (feedback fda4e3ea) — nobody should have to hunt for the open Rückfrage in a
 * long thread.
 *
 * The rule, oldest-first thread assumed:
 *
 * - thread empty → `null`, there is nothing to scroll to
 * - the thread ends with routine messages → the **first** of that trailing run,
 *   i.e. the top of the open Rückfrage, so a long question is read from its
 *   beginning rather than from its tail
 * - otherwise (the admin had the last word) → the last message, i.e. the
 *   thread end
 */
export function workflowFocusIndex(replies: readonly FeedbackMessage[]): number | null {
  const last = replies.length - 1;
  if (last < 0) return null;
  if (!replies[last].is_system) return last;
  let i = last;
  while (i > 0 && replies[i - 1].is_system) i--;
  return i;
}

// ---- Progress statistics --------------------------------------------------

export interface FeedbackStats {
  /** Topics whose ship landed inside the window. */
  shipped: number;
  /**
   * Topics raised inside the window that are still on the pile — every active
   * bucket (ToDo, awaiting the admin, in progress). Labelled "ToDo" in the UI.
   */
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
 *
 * "Still active" is resolved through {@link feedbackBucket}, so an answered
 * Rückfrage lands in the ToDo/open count exactly like the board's list does.
 */
export function computeStats(
  rows: readonly FeedbackRow[],
  threads: ThreadMap,
  from: number | null,
): FeedbackStats {
  const inWindow = (t: number) => from === null || t >= from;
  const stats: FeedbackStats = { shipped: 0, open: 0, answered: 0 };

  for (const row of rows) {
    const replies = threads.get(row.id);
    const bucket = feedbackBucket(row, replies);
    if (bucket === 'shipped') {
      if (inWindow(shippedTime(row))) stats.shipped++;
    } else if (ACTIVE_BUCKETS.includes(bucket)) {
      // Only non-terminal topics count as still open — an `issue_created` or
      // legacy `rejected` row is done, it just didn't ship from here.
      if (inWindow(timeOf(row.created_at))) stats.open++;
    }

    // An answered Rückfrage = a human reply that directly follows a routine
    // message in the same thread. Counting messages (not topics) keeps a
    // multi-round back-and-forth honest.
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

// ---- Fuzzy search ---------------------------------------------------------

/**
 * The board's search is deliberately dependency-free: a few hundred topics live
 * in memory anyway, so a hand-rolled scorer beats pulling a fuzzy-search library
 * into the bundle. It has to be forgiving (the admin types from memory, with
 * typos) and it has to look at the *whole* conversation, not just the generated
 * title — a topic is often only identifiable by what the routine answered three
 * replies down (feedback 12476cec).
 */

/**
 * Fold text into its comparable form: diacritics stripped (ä→a, é→e), German ß
 * unfolded to `ss`, lowercased, and every run of non-alphanumerics collapsed to
 * a single space. Markdown punctuation therefore disappears on its own, so a
 * query matches text that is bold, linked or fenced in the source.
 */
export function normalizeSearchText(text: string): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The query split into distinct normalized terms; empty for a blank query. */
export function searchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const seen = new Set<string>();
  for (const token of normalized.split(' ')) {
    if (token) seen.add(token);
  }
  return [...seen];
}

/**
 * How many single-character edits a term may be off and still count as a match.
 * Short terms get none — at three characters nearly everything is one edit away
 * from everything, which would turn the result list into noise.
 */
function editBudget(length: number): number {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  return 2;
}

/**
 * Damerau-Levenshtein distance with an early bail-out: once a whole DP row sits
 * above `max` the distance can only grow, so we stop and report `max + 1`.
 * Transpositions count as one edit, which is what most real typos are
 * ("Suhce" → "Suche").
 */
function boundedDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let beforePrev: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const current: number[] = new Array(b.length + 1);
    current[0] = i;
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, current[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, beforePrev[j - 2] + 1);
      }
      current[j] = value;
      if (value < rowBest) rowBest = value;
    }
    if (rowBest > max) return max + 1;
    beforePrev = prev;
    prev = current;
  }
  return prev[b.length];
}

/** True when every character of `needle` appears in `haystack`, in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return i === needle.length;
}

/**
 * Match quality of one term against one word, in `[0, 1]`:
 * exact `1` › prefix `0.78` › infix `0.6` › typo-distance `0.5 − 0.12·d` ›
 * subsequence `0.22`. The ladder is what makes the ranking explainable — a term
 * the admin typed in full always outranks the same term guessed from a typo.
 */
function wordQuality(term: string, word: string, budget: number): number {
  if (word === term) return 1;
  if (word.startsWith(term)) return 0.78;
  if (word.includes(term)) return 0.6;
  if (budget > 0) {
    const distance = boundedDistance(term, word, budget);
    if (distance <= budget) return 0.5 - 0.12 * distance;
  }
  // Abbreviations ("fdbk" → "feedback"), but only against a word of a plausible
  // length, so a long paragraph-word does not swallow every short term.
  if (term.length >= 3 && word.length <= term.length + 6 && isSubsequence(term, word)) return 0.22;
  return 0;
}

/**
 * Best quality of `term` anywhere in `words`, plus a small density bonus for
 * repeated solid hits (capped at three extra occurrences) — a topic that says
 * "search" five times is more about search than one that mentions it once.
 */
function termScore(term: string, words: readonly string[]): number {
  const budget = editBudget(term.length);
  let best = 0;
  let solidHits = 0;
  for (const word of words) {
    const quality = wordQuality(term, word, budget);
    if (quality >= 0.6) solidHits++;
    if (quality > best) best = quality;
    if (best === 1 && solidHits > 3) break;
  }
  if (best === 0) return 0;
  return best + Math.min(Math.max(solidHits - 1, 0), 3) * 0.04;
}

/** Field weights — the topic body carries the intent, replies only support it. */
const FIELD_WEIGHT = {
  body: 1,
  note: 0.55,
  thread: 0.5,
  author: 0.35,
} as const;

/** A topic that matched, with the score it is ranked by and where it matched. */
export interface FeedbackSearchHit {
  row: FeedbackRow;
  /** Relevance, higher is better. Roughly `[0.1, 1.6]`; only the order matters. */
  score: number;
  /** The query hit the topic body itself. */
  inBody: boolean;
  /** The query hit one of the thread replies. */
  inThread: boolean;
}

/** The searchable text of one topic, normalized once per query pass. */
function haystack(row: FeedbackRow, replies: readonly FeedbackMessage[] | undefined) {
  const body = normalizeSearchText(row.body);
  const thread = normalizeSearchText((replies ?? []).map((r) => r.body).join(' \n '));
  const author = normalizeSearchText(
    [row.author?.display_name, row.author?.username, ...(replies ?? []).map((r) => r.author?.display_name)]
      .filter(Boolean)
      .join(' '),
  );
  return {
    body,
    bodyWords: body ? body.split(' ') : [],
    note: normalizeSearchText(row.processing_note ?? '').split(' ').filter(Boolean),
    thread,
    threadWords: thread ? thread.split(' ') : [],
    authorWords: author ? author.split(' ') : [],
  };
}

/**
 * Score one topic against the already-tokenized query. `0` means "not a match":
 * every term has to land *somewhere* (AND semantics), otherwise adding a word
 * would widen the result list instead of narrowing it.
 *
 * The score is the mean term quality (so a one-word and a four-word query stay
 * on the same scale), weighted by the field each term matched best in, plus a
 * phrase bonus when the query shows up verbatim.
 */
export function scoreFeedbackRow(
  row: FeedbackRow,
  replies: readonly FeedbackMessage[] | undefined,
  terms: readonly string[],
  phrase = terms.join(' '),
): FeedbackSearchHit | null {
  if (!terms.length) return null;
  const fields = haystack(row, replies);

  let total = 0;
  let inBody = false;
  let inThread = false;

  for (const term of terms) {
    const body = termScore(term, fields.bodyWords) * FIELD_WEIGHT.body;
    const note = termScore(term, fields.note) * FIELD_WEIGHT.note;
    const thread = termScore(term, fields.threadWords) * FIELD_WEIGHT.thread;
    const author = termScore(term, fields.authorWords) * FIELD_WEIGHT.author;
    const best = Math.max(body, note, thread, author);
    if (best === 0) return null;
    if (body > 0) inBody = true;
    if (thread > 0) inThread = true;
    total += best;
  }

  let score = total / terms.length;
  // Verbatim phrase beats the same words scattered across the conversation.
  if (terms.length > 1 && phrase) {
    if (fields.body.includes(phrase)) score += 0.35;
    else if (fields.thread.includes(phrase)) score += 0.15;
  }

  return { row, score, inBody, inThread };
}

/**
 * Fuzzy-search the board across topic bodies, processing notes, author names and
 * every thread reply, ranked by relevance.
 *
 * Ordering: score descending, ties broken by the topic's own recency, so equally
 * relevant hits still read newest-first. A blank query yields no hits at all —
 * callers treat that as "no search active" and keep their own list order (see
 * {@link rankFeedbackSearch}).
 */
export function searchFeedback(
  rows: readonly FeedbackRow[],
  threads: ThreadMap,
  query: string,
): FeedbackSearchHit[] {
  const terms = searchTokens(query);
  if (!terms.length) return [];
  const phrase = normalizeSearchText(query);

  const hits: FeedbackSearchHit[] = [];
  for (const row of rows) {
    const hit = scoreFeedbackRow(row, threads.get(row.id), terms, phrase);
    if (hit) hits.push(hit);
  }

  return hits.sort(
    (a, b) =>
      b.score - a.score ||
      (timeOf(b.row.updated_at) || timeOf(b.row.created_at)) -
        (timeOf(a.row.updated_at) || timeOf(a.row.created_at)),
  );
}

/**
 * Convenience wrapper for list views: the matching topics in relevance order,
 * or the input list untouched when the query is blank.
 */
export function rankFeedbackSearch(
  rows: readonly FeedbackRow[],
  threads: ThreadMap,
  query: string,
): FeedbackRow[] {
  if (!searchTokens(query).length) return [...rows];
  return searchFeedback(rows, threads, query).map((hit) => hit.row);
}

// ---- Pace: how fast the routine turns topics around ------------------------

/**
 * Window metrics that describe the routine's *pace* rather than its volume.
 * Deliberately a second shape next to {@link FeedbackStats}: the dashboard's
 * shipped/ToDo/answered contract is load-bearing for the existing donut + bars,
 * so the newer numbers are computed in their own additive pass.
 */
export interface FeedbackPace {
  /**
   * Median hours from a topic's creation to its ship, over the topics whose
   * ship landed inside the window. `null` when nothing shipped in it.
   *
   * Only rows carrying a real `shipped_at` are measured — the `updated_at`
   * fallback {@link computeStats} uses for *attribution* would invent
   * durations for legacy rows that never got a ship stamp.
   */
  medianShipHours: number | null;
  /** Topics *raised* inside the window — the denominator of `questionRate`. */
  raised: number;
  /** ...of those, how many the routine had to ask a Rückfrage about. */
  questioned: number;
  /** `questioned / raised`, 0..1 — `0` for an empty window. */
  questionRate: number;
}

/**
 * True when the routine had to ask about this topic at least once.
 *
 * The routine posts exactly two kinds of system reply: the Rückfrage that parks
 * a topic, and the review reply it posts *after* a ship. So a system message is
 * a Rückfrage iff it predates the topic's ship stamp — or the topic never
 * shipped at all. A topic sitting in `needs_input` counts even when the question
 * lives in the processing note rather than the thread.
 */
export function neededInput(row: FeedbackRow, replies?: readonly FeedbackMessage[]): boolean {
  if (row.status === 'needs_input') return true;
  const shipped = timeOf(row.shipped_at);
  for (const msg of replies ?? []) {
    if (!msg.is_system) continue;
    if (!shipped || timeOf(msg.created_at) < shipped) return true;
  }
  return false;
}

/** Median of an unsorted list of numbers; `null` for an empty list. */
function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Aggregate the board's pace into one time window (`from` inclusive, `null` =
 * all-time), attributing each metric by its own timestamp exactly like
 * {@link computeStats}: ship duration by the ship stamp, the Rückfrage rate by
 * the topic's creation.
 */
export function computePace(
  rows: readonly FeedbackRow[],
  threads: ThreadMap,
  from: number | null,
): FeedbackPace {
  const inWindow = (t: number) => from === null || t >= from;
  const durations: number[] = [];
  let raised = 0;
  let questioned = 0;

  for (const row of rows) {
    const shipped = timeOf(row.shipped_at);
    const created = timeOf(row.created_at);
    if (shipped && created && shipped >= created && inWindow(shipped)) {
      durations.push((shipped - created) / 3_600_000);
    }
    if (!inWindow(created)) continue;
    raised++;
    if (neededInput(row, threads.get(row.id))) questioned++;
  }

  return {
    medianShipHours: median(durations),
    raised,
    questioned,
    questionRate: raised === 0 ? 0 : questioned / raised,
  };
}

// ---- Throughput over time -------------------------------------------------

/** One weekly bucket of the throughput chart. */
export interface ShipWeek {
  /** Epoch ms of the bucket's Monday, 00:00 local time. */
  start: number;
  /** Ships stamped inside the week. */
  count: number;
  /** True for the bucket containing "now" (its week is still running). */
  current: boolean;
}

/** Epoch ms for Monday 00:00 of the local week containing `now`. */
export function startOfWeek(now: number = Date.now()): number {
  const d = new Date(now);
  const mondayIndex = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayIndex).getTime();
}

/**
 * Ships per calendar week for the last `weeks` weeks, oldest bucket first and
 * the running week last — the dashboard's throughput sparkline.
 *
 * A ship is counted by its `shipped_at` stamp, so a topic reopened as a
 * continuation counts once, in the week of its *latest* ship (the re-ship bumps
 * `shipped_at`). Rows without a ship stamp are not throughput and are skipped.
 * Bucket starts are built with calendar arithmetic rather than a fixed 7×24 h
 * offset, so a DST switch inside the range does not shift the boundaries.
 */
export function shippedPerWeek(
  rows: readonly FeedbackRow[],
  weeks = 12,
  now: number = Date.now(),
): ShipWeek[] {
  const span = Math.max(1, weeks);
  const base = new Date(startOfWeek(now));
  const buckets: ShipWeek[] = [];
  for (let back = span - 1; back >= 0; back--) {
    buckets.push({
      start: new Date(base.getFullYear(), base.getMonth(), base.getDate() - back * 7).getTime(),
      count: 0,
      current: back === 0,
    });
  }

  for (const row of rows) {
    const t = timeOf(row.shipped_at);
    if (!t || t < buckets[0].start) continue;
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (t >= buckets[i].start) {
        buckets[i].count++;
        break;
      }
    }
  }

  return buckets;
}

// ---- Lifecycle snapshot ---------------------------------------------------

/**
 * The reaper stamps every claim it reopens with this note prefix (see
 * docs/feedback-routine "Resuming interrupted work"), which is the only
 * evidence in the row data that a topic took the `in_progress → open` branch.
 */
const REOPENED_NOTE = /^\s*auto-reopened/i;

/**
 * A live reading of the status machine documented in docs/feedback-routine
 * ("Contract"): how many topics sit in each stage right now, plus the counts
 * behind the branches the lifecycle can take. Everything here is derivable from
 * the rows + threads the board already holds — there is no transition history
 * table, so the map annotates *occupancy*, not throughput.
 */
export interface LifecycleSnapshot {
  /** Live occupancy per presentation bucket (see {@link feedbackBucket}). */
  counts: Record<FeedbackBucket, number>;
  /** ToDo topics the reaper reopened after a stale claim — still on the pile. */
  reopened: number;
  /** ToDo topics that are an answered Rückfrage, handed back to the routine. */
  answered: number;
  /** ToDo topics that are a post-ship continuation waiting to be picked up. */
  continuations: number;
  /** `in_progress` topics the routine is implementing right now (no PR yet). */
  working: number;
  /** `in_progress` topics parked as a review hold — their PR waits for a human. */
  reviewHolds: number;
  /** Whole days the oldest topic in an active bucket has been open; `null` if none. */
  oldestActiveDays: number | null;
  /** Every topic on the board. */
  total: number;
}

/** All buckets at zero — the snapshot's starting point (and its empty state). */
function emptyBucketCounts(): Record<FeedbackBucket, number> {
  return {
    awaiting_admin: 0,
    awaiting_author: 0,
    todo: 0,
    in_progress: 0,
    shipped: 0,
    issue_created: 0,
    rejected: 0,
    declined: 0,
  };
}

/**
 * Aggregate the board into one lifecycle snapshot. Pure: `now` is injected so
 * the age metric is testable.
 */
export function lifecycleSnapshot(
  rows: readonly FeedbackRow[],
  threads: ThreadMap,
  now: number = Date.now(),
): LifecycleSnapshot {
  const snapshot: LifecycleSnapshot = {
    counts: emptyBucketCounts(),
    reopened: 0,
    answered: 0,
    continuations: 0,
    working: 0,
    reviewHolds: 0,
    oldestActiveDays: null,
    total: rows.length,
  };

  let oldestActive = 0;

  for (const row of rows) {
    const replies = threads.get(row.id);
    const bucket = feedbackBucket(row, replies);
    snapshot.counts[bucket]++;

    if (ACTIVE_BUCKETS.includes(bucket)) {
      const created = timeOf(row.created_at);
      if (created && (oldestActive === 0 || created < oldestActive)) oldestActive = created;
    }

    if (bucket === 'todo') {
      if (isContinuedAfterShip(row, replies)) snapshot.continuations++;
      // An answered Rückfrage keeps its `needs_input` status on the wire; the
      // bucket already resolved "answered" for us.
      else if (row.status === 'needs_input') snapshot.answered++;
      if (REOPENED_NOTE.test(row.processing_note ?? '')) snapshot.reopened++;
    } else if (bucket === 'in_progress') {
      // `in_progress` WITH a PR is an intentional review hold the reaper skips;
      // without one the routine is actively implementing (docs/feedback-routine
      // "Surfacing open review-holds").
      if (row.ship_ref) snapshot.reviewHolds++;
      else snapshot.working++;
    }
  }

  if (oldestActive) {
    snapshot.oldestActiveDays = Math.max(0, Math.floor((now - oldestActive) / 86_400_000));
  }

  return snapshot;
}
