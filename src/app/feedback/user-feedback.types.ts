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
 *   invisible to the author and reads as plain "in Bearbeitung". Only a
 *   question an admin explicitly addressed to the author surfaces as its own
 *   status.
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
}

/**
 * True while an admin's question to the author is still the last word in the
 * channel. The author's own reply silently takes the topic back to
 * "in Bearbeitung" — there is no separate "answered" state on their side.
 */
export function hasPendingAuthorQuestion(
  messages: readonly AuthorFeedbackMessage[] | undefined,
): boolean {
  if (!messages || messages.length === 0) return false;
  const last = messages[messages.length - 1];
  return last.from_admin && last.is_question;
}

/**
 * The coarse status an author is shown for a topic — the client-side twin of
 * the `public.my_feedback` CASE expression.
 *
 * Terminal states win over a pending question: once a topic shipped or was
 * declined, an old unanswered question is moot.
 */
export function coarseAuthorStatus(
  status: FeedbackStatus,
  pendingQuestion: boolean,
): AuthorFeedbackStatus {
  if (status === 'declined' || status === 'rejected') return 'declined';
  if (status === 'shipped') return 'done';
  // `needs_input` lands here on purpose: that is the routine asking the ADMIN,
  // a conversation the author never sees, so it must read as "in Bearbeitung".
  return pendingQuestion ? 'question' : 'in_progress';
}

/**
 * Convenience overload for the admin panel: what does the author currently see
 * for this topic, given the author channel we already loaded?
 */
export function authorStatusOf(
  status: FeedbackStatus,
  messages: readonly AuthorFeedbackMessage[] | undefined,
): AuthorFeedbackStatus {
  return coarseAuthorStatus(status, hasPendingAuthorQuestion(messages));
}

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
