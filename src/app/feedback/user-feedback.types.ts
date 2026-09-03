/**
 * Shapes and pure helpers for the NON-ADMIN feedback channel (feedback
 * 5920cf8c): viewers and collaborators file feedback through their own FAB, and
 * the topic lands on the admins' existing board attributed to them.
 *
 * The whole point of this file is the asymmetry between the two sides:
 *
 * - The admin side keeps the full vocabulary of `feedback.types.ts` — raw
 *   status, processing notes, ship refs, the admin <-> routine thread.
 * - The author side sees a deliberately *coarse* status and nothing else. In
 *   particular `needs_input` — the routine asking the ADMIN something — is
 *   invisible to the author and reads as plain "in Bearbeitung". Only
 *   `needs_input_author`, the status set when an admin explicitly asks the
 *   author something, surfaces to them as a question.
 *
 * {@link coarseAuthorStatus} mirrors the `public.my_feedback` view's CASE
 * expression one-to-one, so the admin panel can render "this is what the author
 * currently sees" without a second round trip — and so the mapping is unit
 * tested on the client even though the database is the source of truth.
 * Everything here is side-effect free (see `user-feedback.types.spec.ts`).
 */

import { FeedbackStatus } from '../admin/feedback/feedback.types';

/** The four states a feedback author is ever shown. */
export type AuthorFeedbackStatus =
  /** Being worked on — covers open, in_progress, the routine's needs_input and issue_created. */
  | 'in_progress'
  /** An admin asked the author a question and is waiting on their answer. */
  | 'question'
  /** Implemented and shipped. */
  | 'done'
  /** The admin decided against it; `decision_note` carries the explanation. */
  | 'declined';

/** One message in the author-visible channel (`public.feedback_author_messages`). */
export interface AuthorFeedbackMessage {
  id: string;
  feedback_id: string;
  author_id: string | null;
  /** true = written by an admin to the author, false = the author's own reply. */
  from_admin: boolean;
  /** true only on an admin message that explicitly asks the author something. */
  is_question: boolean;
  body: string;
  created_at: string;
}

/** A row of `public.my_feedback` — the author-facing projection of a topic. */
export interface AuthorFeedbackRow {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  /** The admin's explanation, set when `author_status === 'declined'`. */
  decision_note: string | null;
  author_status: AuthorFeedbackStatus;
  /**
   * The area tag the author's own composer put on the topic (admin feedback
   * 835fec58). Projected into `my_feedback` because it is the author's own
   * statement about their topic — unlike every other admin-side column, showing
   * it back to them reveals nothing they did not write. `null` on topics filed
   * before the tag existed; optional so fixture rows keep compiling.
   */
  area?: string | null;
}

/**
 * The coarse status an author is shown for a topic — the client-side twin of the
 * `public.my_feedback` CASE expression, and the reason that mapping is unit
 * tested here even though the database is the source of truth.
 *
 * Driven by `status` alone. The two "needs input" flavours are the crux:
 * `needs_input_author` (an admin asked THIS author) is the only one that reads
 * as a question, while `needs_input` (the routine asking the admin) deliberately
 * folds into "in Bearbeitung" — that conversation does not exist for the author.
 */
export function coarseAuthorStatus(status: FeedbackStatus): AuthorFeedbackStatus {
  if (status === 'declined' || status === 'rejected') return 'declined';
  if (status === 'shipped') return 'done';
  if (status === 'needs_input_author') return 'question';
  return 'in_progress';
}

/**
 * One row of `public.feedback_read_state` — when this user last looked at one of
 * their own topics, and which coarse status was on screen at that moment.
 */
export interface FeedbackReadState {
  feedback_id: string;
  last_read_at: string;
  last_seen_status: AuthorFeedbackStatus;
}

/** Read markers by topic id. */
export type FeedbackReadStateMap = ReadonlyMap<string, FeedbackReadState>;

/** Author-visible messages grouped by topic id. */
export type AuthorThreadMap = ReadonlyMap<string, AuthorFeedbackMessage[]>;

/** Group a flat message list by `feedback_id`, preserving the input order. */
export function groupAuthorMessages(
  rows: readonly AuthorFeedbackMessage[],
): Map<string, AuthorFeedbackMessage[]> {
  const grouped = new Map<string, AuthorFeedbackMessage[]>();
  for (const row of rows) {
    const list = grouped.get(row.feedback_id);
    if (list) list.push(row);
    else grouped.set(row.feedback_id, [row]);
  }
  return grouped;
}

/**
 * The coarse status every topic is born in — `open` maps to `in_progress`.
 *
 * A topic the author has never had the panel open for carries no read marker, so
 * this is the baseline the status is compared against: a freshly sent topic
 * nobody has touched yet is not news to the person who just wrote it.
 */
export const AUTHOR_STATUS_ON_ARRIVAL: AuthorFeedbackStatus = 'in_progress';

/** Highest number the FAB badge spells out; anything above renders as "9+". */
export const UNREAD_BADGE_CAP = 9;

/**
 * Is there news on this topic for its author (admin feedback e684c946)?
 *
 * Two, and only two, things count as news:
 *
 * 1. A message from the team that arrived after the last read. The author's own
 *    replies never count — you are not unread on your own writing.
 * 2. The coarse status differs from the one that was on screen at the last read
 *    — "umgesetzt", "nicht umgesetzt", or a question opened.
 *
 * Deliberately NOT counted: `updated_at` on the topic. It moves for every
 * internal edit on the admin board (processing notes, triage, ship refs), none
 * of which the author is even allowed to see — a badge for those would send
 * people into an empty panel.
 */
export function topicHasNews(
  topic: AuthorFeedbackRow,
  messages: readonly AuthorFeedbackMessage[],
  read: FeedbackReadState | undefined,
): boolean {
  const seenStatus = read?.last_seen_status ?? AUTHOR_STATUS_ON_ARRIVAL;
  if (topic.author_status !== seenStatus) return true;
  const readAt = read ? Date.parse(read.last_read_at) : Number.NaN;
  return messages.some((m) => {
    if (!m.from_admin) return false;
    if (Number.isNaN(readAt)) return true;
    const at = Date.parse(m.created_at);
    return Number.isNaN(at) ? false : at > readAt;
  });
}

/** The ids of every topic that currently has news, in the given topic order. */
export function topicsWithNews(
  topics: readonly AuthorFeedbackRow[],
  threads: AuthorThreadMap,
  read: FeedbackReadStateMap,
): string[] {
  return topics
    .filter((t) => topicHasNews(t, threads.get(t.id) ?? [], read.get(t.id)))
    .map((t) => t.id);
}

/**
 * What the badge shows. Capped rather than truthful: a two-digit pill on a 56px
 * circle stops being a glance and starts being a label, and past nine the exact
 * number changes nothing about what the user should do.
 */
export function unreadBadgeText(count: number): string {
  return count > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(count);
}
