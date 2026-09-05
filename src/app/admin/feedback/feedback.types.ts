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

/** The two outcomes that go through the admin's sign-off (see {@link awaitsReview}). */
const REVIEWABLE_STATUSES: readonly FeedbackStatus[] = ['shipped', 'issue_created'];

/**
 * True while a finished topic still waits for an admin to sign it off
 * (migration 20260729130000).
 *
 * Shipping is not the end of a topic — somebody has to look at the result on the
 * live app and say "yes, that was it". Until they do, the topic stays on the
 * ACTIVE board with two ways out: accept it (→ Erledigt) or pick the
 * conversation back up (→ the routine's queue). `declined`/legacy `rejected` are
 * excluded on purpose: those already ARE an admin decision.
 *
 * `reviewed_at === undefined` means the caller never selected the column (a
 * fixture row, a projection) and is deliberately NOT treated as pending — same
 * convention as `source`/`triaged`, where an absent field means the legacy
 * default rather than a new state.
 */
export function awaitsReview(row: FeedbackRow, replies?: readonly FeedbackMessage[]): boolean {
  if (!REVIEWABLE_STATUSES.includes(row.status)) return false;
  if (row.reviewed_at !== null) return false;
  // A post-ship continuation is already back in the work loop; asking for a
  // sign-off on top of it would be a second, contradictory prompt.
  return !isContinuedAfterShip(row, replies);
}

/**
 * True when a topic reached a terminal status AND was signed off (→ Erledigt).
 * Two things keep a terminal row on the active board: a post-ship continuation
 * (the routine's review loop, docs/feedback-routine "Post-ship review &
 * continue") and a pending review (see {@link awaitsReview}). Pass the thread so
 * the first case is caught; without it the check falls back to status plus
 * sign-off, matching the old behaviour for callers that don't track replies.
 */
export function isArchived(row: FeedbackRow, replies?: readonly FeedbackMessage[]): boolean {
  return (
    ARCHIVE_STATUSES.includes(row.status) &&
    !isContinuedAfterShip(row, replies) &&
    !awaitsReview(row, replies)
  );
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
  /**
   * The author's role (`profiles.role`: admin / collaborator / viewer) — what
   * colours the avatar on the board (concept 2026-09-04: admin red, collaborator
   * light blue, user grey-blue). Optional: fixture rows and the viewer-side
   * projections do not carry it; absent renders as the neutral user colour.
   */
  role?: string | null;
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
  /**
   * The stable, sequential topic number (`admin_feedback.seq`) — the "#42" the
   * board shows next to a title so a topic can be referred to by number
   * (feedback 21587480). Server-side and immutable: it is NOT a list index, so
   * it survives filtering, searching, re-ordering and deletions. Optional
   * because the many fixture rows in the specs (and any row read through a
   * projection that omits it) have none; absent means "no number to show".
   */
  seq?: number | null;
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
  source?: FeedbackSource;
  /**
   * Release gate for the autonomous routine. A user-submitted topic enters
   * untriaged so an admin reads it before Claude may implement and ship it;
   * admin-authored rows are triaged by definition.
   */
  triaged?: boolean;
  /** The admin's explanation on a `declined` topic — shown to the author. */
  decision_note?: string | null;
  /**
   * Admin sign-off on a finished topic (migration 20260729130000). `null` on a
   * shipped / issue-created row means it is still in the review gate; a
   * timestamp means Erledigt. Optional so fixture rows and projections that omit
   * the column are not read as "pending" — see {@link awaitsReview}.
   */
  reviewed_at?: string | null;
  /**
   * Which part of the app the topic is about — set by the sender's composer
   * from the page they were on, correctable there (admin feedback 835fec58,
   * migration 20260903120000). `null` on every topic filed before the tag
   * existed, and that must render as NOTHING: a made-up default would be
   * indistinguishable from a real answer. Typed as a plain string here because
   * the value comes straight from the database — narrow it with
   * `asFeedbackArea()` before showing it.
   */
  area?: string | null;
  /**
   * The routine's one-line title for the topic (migration 20260906140000,
   * feedback d08f1983). Written when the routine claims the row, because that
   * is the moment somebody actually read the whole thing. `null`/absent on
   * every topic nobody summarised yet — see {@link displayTitle}, which then
   * falls back to the body.
   */
  summary?: string | null;
}

/**
 * Who a topic came from: an admin writing on the board, or a viewer sending
 * through their own feedback box. It is the axis the overview's source switch
 * splits on (admin feedback 18e96ad3) and it mirrors `admin_feedback.source`.
 */
export type FeedbackSource = 'admin' | 'user';

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

// ---- "Create an issue for this" (admin feedback 18e96ad3) ------------------

/**
 * Stable, never-translated opening token of the thread message that asks the
 * routine to open a GitHub issue for a topic instead of implementing it.
 *
 * The instruction rides in the THREAD rather than in a column on purpose. It is
 * exactly that — an instruction to the agent, in the one channel the agent
 * already reads end to end — so it needs no schema change, it is visible to
 * every admin in the conversation where it was given, and taking it back is an
 * ordinary message delete. The status stays whatever it was (normally `open`),
 * which is what keeps the topic in the routine's queue: the routine works
 * `status = 'open'`, so a topic parked in a terminal status could never be
 * picked up to have its issue created (admin feedback 18e96ad3: "das ist ja die
 * anweisung das claude ein issue erstellen soll … solange das issue noch nicht
 * erstellt wurde sondern nur in todo ist").
 */
export const ISSUE_REQUEST_MARKER = '**[ISSUE]**';

/** True for the thread message that carries an issue request. */
export function isIssueRequest(msg: FeedbackMessage): boolean {
  return !msg.is_system && (msg.body ?? '').trimStart().startsWith(ISSUE_REQUEST_MARKER);
}

/**
 * The still-open issue request of a topic, or null.
 *
 * "Still open" means the routine has not delivered yet: the moment it files the
 * issue it writes `status = 'issue_created'` plus the issue url into `ship_ref`,
 * and from there the topic follows the ordinary outcome path (sign-off →
 * Erledigt). Only until then is the request undoable — the misclick the admin
 * asked to be able to take back.
 */
export function pendingIssueRequest(
  row: FeedbackRow,
  replies?: readonly FeedbackMessage[],
): FeedbackMessage | null {
  if (row.status === 'issue_created' || row.ship_ref) return null;
  for (let i = (replies?.length ?? 0) - 1; i >= 0; i--) {
    const msg = replies![i];
    if (isIssueRequest(msg)) return msg;
  }
  return null;
}

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

/**
 * What a card head calls a topic: the routine's summary when there is one, the
 * body-derived title otherwise (feedback d08f1983).
 *
 * The fallback is the whole point of the column being nullable — a row nobody
 * summarised yet must keep reading exactly as it did before, never as an empty
 * head. The summary goes through the same {@link plainText} + cap treatment as
 * a derived title, so a summary that arrives with markup or over-long (an older
 * writer, a hand-written value) cannot break the row layout.
 */
export function displayTitle(row: FeedbackRow, max = 64): string {
  const summary = plainText(row.summary ?? '');
  if (!summary) return topicTitle(row.body, max);
  return summary.length > max ? `${summary.slice(0, max - 2).trimEnd()}…` : summary;
}

/**
 * The topic's reference number, or `null` when it has none (a fixture row, or a
 * row from before the numbering migration if one ever slipped through). Numbers
 * start at 1, so `0` and negatives are treated as "no number" rather than
 * rendered as "#0".
 */
export function topicNumber(row: FeedbackRow): number | null {
  const n = row.seq;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
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
 * - `review` — the work is done (shipped, or handed to a GitHub issue) and waits
 *   for the admin's sign-off. Still ACTIVE: this is the last point at which a
 *   result can be sent back into the loop instead of quietly landing in the
 *   archive (see {@link awaitsReview}).
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
  | 'review'
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
  'review',
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
    case 'rejected':
    case 'declined':
      return row.status;
    case 'issue_created':
      // Handing a topic to a GitHub issue is an outcome like a ship, so it goes
      // through the same sign-off before it counts as done.
      return awaitsReview(row, replies) ? 'review' : 'issue_created';
    case 'shipped':
      // Terminal at rest, but a human reply after the ship reopens it as a
      // continuation → back on the routine's pile → ToDo (see isContinuedAfterShip).
      if (isContinuedAfterShip(row, replies)) return 'todo';
      return awaitsReview(row, replies) ? 'review' : 'shipped';
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

/** Key under `adminFeedback.status.*` that labels a bucket. */
export type BucketLabelKey = FeedbackStatus | 'review';

/**
 * The vocabulary a bucket is labelled with — one place, so the filter chips, the
 * card pills, the lifecycle map and the charts cannot drift apart: `todo` reads
 * as the (renamed) `open` label "ToDo", `awaiting_admin` as "Rückfrage",
 * `awaiting_author` as "Rückfrage an Absender", `review` as "Abnahme".
 */
export function bucketLabelStatus(bucket: FeedbackBucket): BucketLabelKey {
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

/**
 * What a queue entry asks of the admin (feedback d4990269):
 *
 * - `triage` — a topic a *user* filed that the routine may not touch yet
 *   (feedback 89925995): read it and take one of the three decisions the
 *   Übersicht card has — release it to the routine, ask the author something,
 *   or decline it with an explanation.
 * - `question` — a Rückfrage the routine is waiting on: read it, answer it.
 * - `review` — a finished topic waiting for the Abnahme: look at the result and
 *   take one of its two decisions (accept → Archiv, or pick the conversation
 *   back up). Same rows the Abnahme tab holds, same two decisions — they are
 *   only *presented* here as well, one at a time, instead of as a tile grid.
 */
export type WorkflowItemKind = 'triage' | 'question' | 'review';

export interface WorkflowItem {
  row: FeedbackRow;
  replies: FeedbackMessage[];
  /** Which kind of step this is — decides the card's actions, never the status. */
  kind: WorkflowItemKind;
}

/**
 * When a finished topic's outcome landed — what an Abnahme entry is dated and
 * ordered by. Shared so the Abnahme tab and the processing queue cannot drift
 * apart on "which one has been waiting longest".
 */
export function reviewSince(row: FeedbackRow): string {
  return row.shipped_at ?? row.processed_at ?? row.updated_at;
}

/**
 * Ids the admin ticked off in the processing mode, mapped to the topic's
 * `updated_at` at that moment. If the routine later touches the topic the
 * stamp no longer matches and the item resurfaces in the queue.
 */
export type HandledMap = ReadonlyMap<string, string>;

/**
 * The guided processing queue: everything the admin — not the routine — has to
 * act on, in one predictable order.
 *
 * **Only topics that need the admin are in it** (feedback b0cc6efc). The mode
 * used to append untouched `open` ToDos after the questions, which read as a
 * backlog to work off — but an `open` topic is one the admin already wrote and
 * that now waits on the *routine*: there is nothing to answer there. It enters
 * the queue the moment the routine asks something back (→ `awaiting_admin`),
 * which is exactly when the admin can act on it.
 *
 * `todo` and `in_progress` topics are excluded for the same reason: the ball is
 * with the routine, not with the admin. They stay visible in the overview list
 * and count toward the dashboard's ToDo bucket — this queue is the admin's
 * inbox, not the board.
 *
 * The one exception is a **user-submitted topic still waiting for its triage**
 * (feedback 89925995). It buckets as `todo` like any other untouched topic, but
 * the ball is emphatically not with the routine: the routine's queue is gated on
 * `triaged`, so nothing at all happens to that topic until an admin releases it.
 * That makes it the purest kind of "waiting on the admin" there is, and it goes
 * to the FRONT of the run — ahead of the Rückfragen, which at least have a
 * routine cycle behind them.
 *
 * Since feedback d4990269 the Abnahme (`review` bucket) belongs to that inbox
 * too: a shipped result nobody has signed off is just as much "waiting on the
 * admin" as a Rückfrage. The two kinds are **not interleaved by date** —
 * Rückfragen come first (they block the routine's next run), Abnahmen after
 * them (they close a topic out), each oldest-first inside its own kind. That
 * keeps the run predictable: answer, then sign off. The rows themselves are
 * untouched — bucketing, status and the Abnahme's own two decisions stay
 * exactly as they are.
 */
export function buildWorkflowQueue(
  rows: readonly FeedbackRow[],
  threads: ThreadMap,
  handled: HandledMap = new Map(),
): WorkflowItem[] {
  const triage: WorkflowItem[] = [];
  const questions: WorkflowItem[] = [];
  const reviews: WorkflowItem[] = [];

  for (const row of rows) {
    // Ticked off and untouched since → stays out of the queue.
    if (handled.get(row.id) === row.updated_at) continue;
    const replies = threads.get(row.id) ?? [];
    const bucket = feedbackBucket(row, replies);
    // The triage gate wins over the bucket: a user topic nobody released is
    // blocked whatever else its row says. `awaiting_author` is the one active
    // bucket left out — there the admin already asked and waits on the author,
    // so the ball is not with them until the answer lands.
    if (awaitsTriage(row) && bucket !== 'awaiting_author' && ACTIVE_BUCKETS.includes(bucket)) {
      triage.push({ row, replies, kind: 'triage' });
    } else if (bucket === 'awaiting_admin') questions.push({ row, replies, kind: 'question' });
    else if (bucket === 'review') reviews.push({ row, replies, kind: 'review' });
  }

  triage.sort((a, b) => timeOf(a.row.created_at) - timeOf(b.row.created_at));
  questions.sort((a, b) => timeOf(a.row.created_at) - timeOf(b.row.created_at));
  // An Abnahme waits from the moment its outcome landed, not from the day the
  // topic was raised — so it is aged by the same stamp its card shows.
  reviews.sort((a, b) => timeOf(reviewSince(a.row)) - timeOf(reviewSince(b.row)));
  return [...triage, ...questions, ...reviews];
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
  // A triage step is in EVERY scope (feedback 89925995). The scope switch splits
  // admin topics by who raised them — "the ones you can answer without guessing"
  // — but a user-submitted topic was raised by neither admin, so `mine` would
  // hide it and the default run would never show the one thing that is blocking
  // the routine outright. It is nobody's topic and therefore everybody's job.
  return items.filter(
    (item) => item.kind === 'triage' || isOwnTopic(item.row, selfId) === wantOwn,
  );
}

/**
 * Which kind of step the processing mode is showing — the Abnahme tab's
 * successor (feedback d4990269, round 2).
 *
 * The tab was a second surface for rows the run already walks; the admin asked
 * for it to be dropped in favour of a lens *inside* the run ("den Abnahme Tab
 * können wir rausmachen und einfach in Abarbeiten eine filter möglichkeit nur
 * abnahmen einfügen"). `all` is the run as it was; the other two narrow it to
 * one kind without changing its order, its actions or a single row.
 */
export type WorkflowKind = 'all' | WorkflowItemKind;

/**
 * The lens in switch order — `all` first, because it is the default, then the
 * kinds in the order the run walks them (triage → Rückfragen → Abnahmen).
 */
export const WORKFLOW_KINDS: readonly WorkflowKind[] = ['all', 'triage', 'question', 'review'];

/** How many items each kind holds — the counts on the kind switch. */
export interface WorkflowKindCounts {
  all: number;
  triage: number;
  question: number;
  review: number;
}

/**
 * Narrow an already-scoped queue to one kind. Applied *after* the scope filter,
 * so the kind counts always describe what the current scope actually holds.
 */
export function filterWorkflowKind(
  items: readonly WorkflowItem[],
  kind: WorkflowKind,
): WorkflowItem[] {
  if (kind === 'all') return [...items];
  return items.filter((item) => item.kind === kind);
}

/** Item counts per kind, for the switch's KPIs. `all` is the untouched total. */
export function workflowKindCounts(items: readonly WorkflowItem[]): WorkflowKindCounts {
  let triage = 0;
  let review = 0;
  for (const item of items) {
    if (item.kind === 'triage') triage++;
    else if (item.kind === 'review') review++;
  }
  return { all: items.length, triage, question: items.length - triage - review, review };
}

/** Queue sizes per scope, for the switch's counts. `all` is the untouched total. */
export function workflowScopeCounts(
  items: readonly WorkflowItem[],
  selfId: string | null | undefined,
): WorkflowScopeCounts {
  let mine = 0;
  let others = 0;
  for (const item of items) {
    // A triage step sits in every scope (see filterWorkflowScope), so it counts
    // in every scope — the KPI has to describe what the chip will hand over.
    if (item.kind === 'triage') {
      mine++;
      others++;
    } else if (isOwnTopic(item.row, selfId)) mine++;
    else others++;
  }
  return { mine, others, all: items.length };
}

/*
 * `filterRowScope` / `rowScopeCounts` lived here for the Abnahme tab's own
 * scope switch. The tab is gone (feedback d4990269, round 2) and the Abnahmen
 * are worked inside the run, under the run's scope — so the row-level twins of
 * the two functions above have no caller left and were removed with it.
 */

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

/**
 * A thread folded to its two ends (feedback 03d7e546).
 *
 * A long conversation pushed the message the admin actually has to react to out
 * of sight, so every thread surface on the board shows the same three parts: the
 * **first** message (where the conversation started), one disclosure standing in
 * for everything between, and the **last** message(s) (what is waiting for an
 * answer). Nothing is dropped — the middle is one click away.
 */
export interface FoldedThread<T> {
  /** The conversation's first message, or `null` when nothing is folded away. */
  lead: T | null;
  /** The messages the disclosure stands in for — empty when nothing is folded. */
  hidden: readonly T[];
  /** The newest message(s): what the admin reacts to. */
  tail: readonly T[];
}

/**
 * Fold a thread to "first … last" (see {@link FoldedThread}). Threads short
 * enough to fit (`keepTail + 1` messages or fewer) are handed back whole, so a
 * two-message conversation never grows a control that hides nothing.
 *
 * Deliberately generic: the board runs it over both thread kinds — the admin ↔
 * routine thread and the author channel — and one rule keeps them identical.
 */
export function foldThread<T>(messages: readonly T[], keepTail = 1): FoldedThread<T> {
  const keep = Math.max(1, keepTail);
  if (messages.length <= keep + 1) return { lead: null, hidden: [], tail: messages };
  const cut = messages.length - keep;
  return { lead: messages[0], hidden: messages.slice(1, cut), tail: messages.slice(cut) };
}

// ---- Progress statistics --------------------------------------------------

/**
 * The four numbers the charts show. Deliberately the same four words the board's
 * filters use, and deliberately not one per bucket: a chart with nine bars says
 * less than one with four.
 *
 *   ToDo · Offen · Erledigt · Issue erstellt
 */
export interface FeedbackStats {
  /** Raised in the window, nobody has picked it up yet (bucket `todo`). */
  todo: number;
  /** Raised in the window and in flight: in Arbeit, Rückfragen, Abnahme. */
  open: number;
  /** Shipped inside the window and signed off by an admin. */
  done: number;
  /** Handed off to a GitHub issue and signed off. */
  issues: number;
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
 * - `done`     — by the topic's ship time
 * - `issues`   — by the topic's last processing time (when it was handed off)
 * - `todo` / `open` — by the topic's creation time (still active today)
 * - `answered` — by the answer message's creation time
 *
 * "Still active" is resolved through {@link feedbackBucket}, so an answered
 * Rückfrage lands in the ToDo count and a topic awaiting sign-off lands in
 * "Offen" exactly like the board's list does.
 */
export function computeStats(
  rows: readonly FeedbackRow[],
  threads: ThreadMap,
  from: number | null,
): FeedbackStats {
  const inWindow = (t: number) => from === null || t >= from;
  const stats: FeedbackStats = { todo: 0, open: 0, done: 0, issues: 0, answered: 0 };

  for (const row of rows) {
    const replies = threads.get(row.id);
    const bucket = feedbackBucket(row, replies);
    if (bucket === 'shipped') {
      if (inWindow(shippedTime(row))) stats.done++;
    } else if (bucket === 'issue_created') {
      if (inWindow(timeOf(row.processed_at) || timeOf(row.updated_at))) stats.issues++;
    } else if (bucket === 'todo') {
      if (inWindow(timeOf(row.created_at))) stats.todo++;
    } else if (ACTIVE_BUCKETS.includes(bucket)) {
      // Everything else still in flight — in Arbeit, both Rückfrage flavours and
      // the sign-off. A legacy `rejected`/`declined` row is done, it just didn't
      // ship from here.
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
 *
 * The one field that is matched *strictly* is the topic's reference number
 * (feedback 21587480): "#42" is a pointer, not a guess, so it resolves exactly
 * and outranks prose (see {@link numberQuality}).
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

/**
 * Field weights — the topic body carries the intent, replies only support it.
 *
 * `number` sits *above* the body on purpose: typing "42" or "#42" is not a guess
 * about wording, it is an unambiguous reference to one specific topic (feedback
 * 21587480), so topic #42 has to outrank every topic that merely mentions the
 * digits somewhere in its text.
 */
const FIELD_WEIGHT = {
  number: 1.2,
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
  /** The query named the topic's reference number ("42" / "#42"). */
  inNumber: boolean;
}

/**
 * Match quality of one term against the topic's reference number: `1` for the
 * exact digits, `0` otherwise.
 *
 * Deliberately exact-only — no prefix, no infix, no typo tolerance. A reference
 * number is either the one meant or a different topic; matching "4" against #42
 * (or #142 against "42") would turn a precise lookup back into a fuzzy one. The
 * `#` never reaches here: {@link normalizeSearchText} drops it as punctuation, so
 * "#42" and "42" arrive as the same term.
 */
function numberQuality(term: string, numberText: string | null): number {
  return numberText !== null && term === numberText ? 1 : 0;
}

/** The searchable text of one topic, normalized once per query pass. */
function haystack(row: FeedbackRow, replies: readonly FeedbackMessage[] | undefined) {
  // The routine's summary counts as part of the topic, not as a separate field:
  // it is what the board CALLS this row (feedback d08f1983), so searching for
  // the words on the card must find the card, and a hit there is an "in the
  // topic" hit like any other.
  const body = normalizeSearchText([row.summary ?? '', row.body].filter(Boolean).join(' \n '));
  const thread = normalizeSearchText((replies ?? []).map((r) => r.body).join(' \n '));
  const author = normalizeSearchText(
    [row.author?.display_name, row.author?.username, ...(replies ?? []).map((r) => r.author?.display_name)]
      .filter(Boolean)
      .join(' '),
  );
  const number = topicNumber(row);
  return {
    body,
    bodyWords: body ? body.split(' ') : [],
    note: normalizeSearchText(row.processing_note ?? '').split(' ').filter(Boolean),
    thread,
    threadWords: thread ? thread.split(' ') : [],
    authorWords: author ? author.split(' ') : [],
    numberText: number === null ? null : String(number),
  };
}

/**
 * Score one topic against the already-tokenized query. `0` means "not a match":
 * every term has to land *somewhere* (AND semantics), otherwise adding a word
 * would widen the result list instead of narrowing it.
 *
 * The score is the mean term quality (so a one-word and a four-word query stay
 * on the same scale), weighted by the field each term matched best in — the
 * topic's reference number included, see {@link numberQuality} — plus a phrase
 * bonus when the query shows up verbatim.
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
  let inNumber = false;

  for (const term of terms) {
    const number = numberQuality(term, fields.numberText) * FIELD_WEIGHT.number;
    const body = termScore(term, fields.bodyWords) * FIELD_WEIGHT.body;
    const note = termScore(term, fields.note) * FIELD_WEIGHT.note;
    const thread = termScore(term, fields.threadWords) * FIELD_WEIGHT.thread;
    const author = termScore(term, fields.authorWords) * FIELD_WEIGHT.author;
    const best = Math.max(number, body, note, thread, author);
    if (best === 0) return null;
    if (body > 0) inBody = true;
    if (thread > 0) inThread = true;
    if (number > 0) inNumber = true;
    total += best;
  }

  let score = total / terms.length;
  // Verbatim phrase beats the same words scattered across the conversation.
  if (terms.length > 1 && phrase) {
    if (fields.body.includes(phrase)) score += 0.35;
    else if (fields.thread.includes(phrase)) score += 0.15;
  }

  return { row, score, inBody, inThread, inNumber };
}

/**
 * Fuzzy-search the board across topic numbers, topic bodies, processing notes,
 * author names and every thread reply, ranked by relevance.
 *
 * Typing a bare number ("42") or a reference ("#42") finds that topic: the `#`
 * folds away in normalization and the number field is matched exactly, above the
 * body's weight, so #42 leads the list even when other topics mention "42".
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
  /** Topics in the sign-off gate that got there by shipping. */
  reviewShipped: number;
  /** Topics in the sign-off gate that got there via a GitHub issue. */
  reviewIssues: number;
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
    review: 0,
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
    reviewShipped: 0,
    reviewIssues: 0,
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
    } else if (bucket === 'review') {
      if (row.status === 'issue_created') snapshot.reviewIssues++;
      else snapshot.reviewShipped++;
    }
  }

  if (oldestActive) {
    snapshot.oldestActiveDays = Math.max(0, Math.floor((now - oldestActive) / 86_400_000));
  }

  return snapshot;
}

// ---- Canned decline reasons (feedback d5a779da) -----------------------------

/**
 * The canned reasons an admin can drop into a decline note with one click.
 *
 * Declining used to mean typing the same explanation for the fifth duplicate by
 * hand. The catalogue below is the shortlist that covers the recurring cases;
 * anything outside it is still a free-text note, the picker only PRE-FILLS the
 * textarea.
 *
 * Ordered by how often they come up, because the picker renders them in this
 * order. Every id is also the i18n key segment for its chip label and its text
 * ({@link declineReasonLabelKey} / {@link declineReasonTextKey}) — the note is
 * read by the person who filed the topic, so both live in `de.json`/`en.json`
 * and are worded for that reader, not for the admin.
 */
export type DeclineReasonId =
  | 'duplicate'
  | 'alreadyShipped'
  | 'notReproducible'
  | 'tooLittleInfo'
  | 'offRoadmap'
  | 'noise';

export const DECLINE_REASONS: readonly DeclineReasonId[] = [
  'duplicate',
  'alreadyShipped',
  'notReproducible',
  'tooLittleInfo',
  'offRoadmap',
  'noise',
];

/** i18n key for a reason's chip label — the short handle in the picker row. */
export function declineReasonLabelKey(id: DeclineReasonId): string {
  return `adminFeedback.decline.reasons.${id}.label`;
}

/** i18n key for the full sentence that lands in the note textarea. */
export function declineReasonTextKey(id: DeclineReasonId): string {
  return `adminFeedback.decline.reasons.${id}.text`;
}

/** Resolved canned texts by id — translating them is the caller's job. */
export type DeclineReasonTexts = Readonly<Partial<Record<DeclineReasonId, string>>>;

/**
 * Which canned reason the current note still IS, or `null` for a note the admin
 * wrote (or edited) themselves.
 *
 * This is what keeps the picker honest: the chip is not a mode the admin gets
 * stuck in, it is a statement about the text. Type one character into the
 * pre-filled sentence and the selection drops away on its own — nothing claims
 * "Duplikat" any more once the note no longer says so.
 *
 * Compared trimmed, because the textarea's value round-trips through the DOM
 * and the note is trimmed again before it is stored.
 */
export function matchDeclineReason(note: string, texts: DeclineReasonTexts): DeclineReasonId | null {
  const trimmed = note.trim();
  if (!trimmed) return null;
  for (const id of DECLINE_REASONS) {
    if ((texts[id] ?? '').trim() === trimmed) return id;
  }
  return null;
}

// ---- The stream (concept 2026-09-04, direction E) ---------------------------
//
// The board is one scroll in three bands ordered by WHOSE TURN it is — admin,
// routine, user, nobody — and every topic sits at one place on a four-station
// flight path. Both are pure derivations over the presentation bucket, so the
// bands, the filter sheet, the card glyph and the opened topic can never
// disagree about where a topic is or who holds the baton.

/** Who has to act next on a topic. `nobody` = terminal and signed off. */
export type FeedbackTurn = 'admin' | 'routine' | 'user' | 'nobody';

/** Band order of the stream: what waits on the admin first, done work last. */
export const TURN_ORDER: readonly FeedbackTurn[] = ['admin', 'routine', 'user', 'nobody'];

/**
 * Whose move it is. The admin's turn is every open Rückfrage, every pending
 * sign-off and every user topic still held back from the routine; the author's
 * turn is a question the admin asked them; everything else that is still open
 * is the routine's pile (untouched ToDo, answered Rückfrage, in progress,
 * post-ship continuation).
 */
export function turnOf(row: FeedbackRow, replies?: readonly FeedbackMessage[]): FeedbackTurn {
  if (awaitsTriage(row) && !isArchived(row, replies)) return 'admin';
  switch (feedbackBucket(row, replies)) {
    case 'awaiting_admin':
    case 'review':
      return 'admin';
    case 'awaiting_author':
      return 'user';
    case 'todo':
    case 'in_progress':
      return 'routine';
    default:
      return 'nobody';
  }
}

/**
 * What exactly the admin is asked for while it is their turn — the sentence
 * next to the card, and the inline action the first card of the band opens
 * with: answer the routine's question, sign the result off, or release a user
 * topic to the routine. `null` when it is not the admin's turn.
 */
export type AdminAsk = 'question' | 'review' | 'release';

export function adminAsk(row: FeedbackRow, replies?: readonly FeedbackMessage[]): AdminAsk | null {
  const bucket = feedbackBucket(row, replies);
  // A result in the sign-off gate is a review first — the old board offered
  // the release button only outside the gate, and so does the stream.
  if (bucket === 'review') return 'review';
  if (awaitsTriage(row) && !isArchived(row, replies)) return 'release';
  if (bucket === 'awaiting_admin') return 'question';
  return null;
}

/** The four stations of the flight path, in order. */
export type FeedbackStation = 'inbox' | 'work' | 'delivered' | 'accepted';

export const FLIGHT_STATIONS: readonly FeedbackStation[] = ['inbox', 'work', 'delivered', 'accepted'];

/**
 * A branch the path can end in instead of "accepted": handed to a GitHub issue
 * (still an outcome that gets signed off), declined by the admin, or the legacy
 * rejected. `null` on the main line.
 */
export type FeedbackBranch = 'issue' | 'declined' | 'rejected' | null;

export interface FlightPosition {
  station: FeedbackStation;
  branch: FeedbackBranch;
  /** A shipped topic sent back into the loop by a post-ship reply. */
  loop: boolean;
  /**
   * At "work" but not picked up yet — the routine's queue (ToDo) as opposed to
   * a topic it is working on right now. The one distinction the station alone
   * would lose, and the old board's ToDo / In Arbeit pills kept.
   */
  queued: boolean;
  /**
   * Queued because the admin answered a Rückfrage and the routine has not
   * picked the answer up yet — the old "✓ Beantwortet" marker (feedback
   * 34c44134): the admin's part is done, the topic only looks like a ToDo.
   */
  answered: boolean;
}

/**
 * Where a topic sits on the path. Every one of the eleven distinct states the
 * board used to spell out as pills is still distinguishable here — the pair
 * (station, branch) plus `loop` and {@link turnOf} carry the same information
 * as the old pill row, as a place on a line instead of a pile of words.
 */
export function flightPosition(row: FeedbackRow, replies?: readonly FeedbackMessage[]): FlightPosition {
  const bucket = feedbackBucket(row, replies);
  const at = (station: FeedbackStation, branch: FeedbackBranch, extra: Partial<FlightPosition> = {}): FlightPosition =>
    ({ station, branch, loop: false, queued: false, answered: false, ...extra });
  if (awaitsTriage(row) && bucket === 'todo') return at('inbox', null);
  switch (bucket) {
    case 'declined':
      return at('work', 'declined');
    case 'rejected':
      return at('work', 'rejected');
    case 'review':
      return at('delivered', row.status === 'issue_created' ? 'issue' : null);
    case 'shipped':
      return at('accepted', null);
    case 'issue_created':
      return at('accepted', 'issue');
    case 'todo':
      // The routine's queue: an untouched topic, an answered Rückfrage, or a
      // post-ship continuation waiting to be picked up again.
      return at('work', null, {
        queued: true,
        loop: isContinuedAfterShip(row, replies),
        answered: row.status === 'needs_input',
      });
    default:
      return at('work', null);
  }
}

/** Index of the station on the path (0..3) — what the glyph fills up to. */
export function stationIndex(station: FeedbackStation): number {
  return FLIGHT_STATIONS.indexOf(station);
}

/** i18n key for the baton sentence of a turn (`adminFeedback.turn.*`). */
export function turnLabelKey(turn: FeedbackTurn): string {
  return `adminFeedback.turn.${turn}`;
}

/** i18n key naming the place on the path, branch and loop included. */
export function stationLabelKey(pos: FlightPosition): string {
  if (pos.branch) return `adminFeedback.station.${pos.branch}`;
  if (pos.loop) return 'adminFeedback.station.loop';
  if (pos.answered) return 'adminFeedback.station.answered';
  if (pos.queued) return 'adminFeedback.station.queued';
  return `adminFeedback.station.${pos.station}`;
}

/**
 * Since when a topic has been waiting on the admin — the "Du bist dran" band is
 * ordered oldest-wait-first, so the topic that has been blocked the longest is
 * the one that opens. A Rückfrage waits since the routine asked it (its last
 * reply); a sign-off since the ship; a release since the topic (or the author's
 * latest answer) landed.
 */
export function waitingSince(row: FeedbackRow, replies?: readonly FeedbackMessage[]): number {
  const ask = adminAsk(row, replies);
  const last = replies && replies.length ? replies[replies.length - 1] : null;
  if (ask === 'question' && last) return timeOf(last.created_at);
  if (ask === 'review') return timeOf(row.shipped_at) || timeOf(row.processed_at) || timeOf(row.updated_at);
  return timeOf(row.updated_at) || timeOf(row.created_at);
}

/**
 * When a topic was done: the ship, else the routine's last touch, else the
 * row's own timestamps. Orders the Geliefert feed and decides the day a topic
 * is filed under.
 */
export function doneTime(row: FeedbackRow): number {
  return (
    timeOf(row.shipped_at) || timeOf(row.processed_at) || timeOf(row.updated_at) || timeOf(row.created_at)
  );
}

/** Local calendar-day key (Y-M-D) for a timestamp — the grouping bucket id. */
export function localDayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Start of the local day a timestamp falls in (ms). */
export function startOfLocalDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** One day of delivered topics — the "what's new" unit of the Geliefert band. */
export interface DeliveredDay {
  key: string;
  /** Start of the local day (ms) — for the heading. */
  day: number;
  items: FeedbackRow[];
}

/**
 * True for every topic that belongs in the Geliefert feed: an outcome exists —
 * shipped, handed to an issue, declined, legacy rejected — whether or not the
 * admin signed it off yet. A shipped topic that still waits for its Abnahme is
 * in the feed on its ship day (with the ✓ right in the row) AND in the "Du bist
 * dran" band; only a post-ship continuation leaves the feed again, because its
 * outcome is being reworked.
 */
export function isDelivered(row: FeedbackRow, replies?: readonly FeedbackMessage[]): boolean {
  return isArchived(row, replies) || awaitsReview(row, replies);
}

/**
 * Every delivered topic (see {@link isDelivered}) grouped by the local day it
 * was done, NEWEST DAY FIRST and newest topic first within a day. This is the
 * admin's "what shipped while I was away": the last day on top, so the panel
 * answers "what can I go and look at" before it answers anything else.
 */
export function deliveredByDay(
  rows: readonly FeedbackRow[],
  threads: ReadonlyMap<string, readonly FeedbackMessage[]>,
): DeliveredDay[] {
  const done = rows
    .filter((r) => isDelivered(r, threads.get(r.id)))
    .sort((a, b) => doneTime(b) - doneTime(a));
  const days: DeliveredDay[] = [];
  let current: DeliveredDay | null = null;
  for (const r of done) {
    const t = doneTime(r);
    const key = localDayKey(t);
    if (!current || current.key !== key) {
      current = { key, day: startOfLocalDay(t), items: [] };
      days.push(current);
    }
    current.items.push(r);
  }
  return days;
}

/**
 * Finished after the admin last looked at the Geliefert band — the "neu seit
 * deinem letzten Blick" marker. `lastSeen` 0 (never looked) marks nothing,
 * deliberately: a first visit must not paint the whole history as news.
 */
export function isNewSince(row: FeedbackRow, lastSeen: number): boolean {
  return lastSeen > 0 && doneTime(row) > lastSeen;
}

// ---- One-tap answer options ("[[A|B]]" convention) -------------------------

/**
 * A routine question may END in a marked option list — its last line nothing
 * but `[[Ja|Nein|Später]]` — and the board renders one button per option
 * (decision r2-options). The marker is stripped from the text; a click posts
 * the option's plain text as the admin's reply, so the routine reads exactly
 * the words it offered. Without the markup nothing changes: `null` means "no
 * options, plain text".
 *
 * The rule is deliberately narrow and mirrored word for word in
 * docs/feedback-routine.md § One-tap answer options: last non-empty line only
 * (a `[[…]]` mid-text is prose), two to four options, each 1–40 characters of
 * plain text. Anything else is not a choice and renders as it was written.
 */
export interface AnswerOptions {
  text: string;
  options: string[];
}

const ANSWER_OPTIONS_LINE_RE = /^\[\[([^\[\]\n]+)\]\]$/;
const MIN_ANSWER_OPTIONS = 2;
const MAX_ANSWER_OPTIONS = 4;
const MAX_ANSWER_OPTION_CHARS = 40;

export function parseAnswerOptions(body: string): AnswerOptions | null {
  const lines = (body ?? '').split('\n');
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') last--;
  if (last < 0) return null;
  const m = ANSWER_OPTIONS_LINE_RE.exec(lines[last].trim());
  if (!m) return null;
  const options = m[1].split('|').map((s) => s.trim());
  if (
    options.length < MIN_ANSWER_OPTIONS ||
    options.length > MAX_ANSWER_OPTIONS ||
    options.some((o) => o.length === 0 || o.length > MAX_ANSWER_OPTION_CHARS)
  ) {
    return null;
  }
  const text = lines.slice(0, last).join('\n').trim();
  return { text, options };
}

// ---- Long-message fold ------------------------------------------------------

/** Rough characters per rendered line in the docked panel — a fold heuristic, not a layout. */
const CHARS_PER_LINE = 56;

/**
 * True when a sent message would take more than `maxLines` lines and should
 * fold the rest behind "…" (round-3 feedback: long messages eat the vertical
 * space the panel does not have). Counts explicit line breaks AND wrapped
 * width, so a single 400-character paragraph folds like a five-line list does.
 * Images do not count: they are attachments, rendered as thumbnails.
 */
export function isLongMessage(body: string, maxLines = 3): boolean {
  // Like plainText(), but line breaks survive — they are what is being counted.
  const text = (body ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]/g, '')
    .replace(/[ 	]+/g, ' ')
    .trim();
  if (!text) return false;
  let lines = 0;
  for (const raw of text.split('\n')) {
    const len = raw.trim().length;
    lines += len === 0 ? 1 : Math.ceil(len / CHARS_PER_LINE);
    if (lines > maxLines) return true;
  }
  return false;
}
