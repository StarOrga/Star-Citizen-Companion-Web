/**
 * Pure merge logic for the feedback board's change-only poll (AUD-341,
 * AUD-155; plan D14).
 *
 * The RPC `admin_feedback_board_delta(p_since)` answers once with the whole
 * board (`full`), then per poll with only the topics updated/created and the
 * messages created since `p_since`, plus the live topic ids and the message
 * counts. This module folds such an answer into the board state the component
 * keeps — no Angular, no Supabase, unit-tested in `feedback-delta.spec.ts`.
 *
 * The one rule that matters for speed: when nothing actually changed, the
 * returned state is the SAME object (same `topics` array, same `threads` map,
 * same `authorMessages` array), so the component sets no signal and none of
 * its many `computed`s re-run.
 */
import { AuthorFeedbackMessage } from '../../feedback/user-feedback.types';
import { FeedbackMessage, FeedbackRow } from './feedback.types';

/** One answer of `admin_feedback_board_delta` (see the migration of that name). */
export interface BoardDelta {
  /** Server time of the read — the base of the next `p_since`. */
  now: string;
  /** True when `p_since` was null: the lists are the whole board. */
  full: boolean;
  topics: FeedbackRow[];
  messages: FeedbackMessage[];
  author_messages: AuthorFeedbackMessage[];
  /** Every live topic id — a topic missing here was deleted. */
  topic_ids: string[];
  message_count: number;
  author_message_count: number;
}

export interface BoardState {
  /** `created_at` ascending, like the board always ordered them. */
  topics: FeedbackRow[];
  /** Replies per topic id, each `created_at` ascending. */
  threads: Map<string, FeedbackMessage[]>;
  /** Flat, `created_at` ascending; the component groups it with `groupAuthorMessages()`. */
  authorMessages: AuthorFeedbackMessage[];
}

/** Overlap so a transaction that committed just after the last poll is never missed; merges are idempotent by id. */
export const DELTA_OVERLAP_MS = 30_000;
/** A full re-read every 10 min also picks up profile renames and anything a delta cannot see. */
export const FULL_RESYNC_MS = 10 * 60_000;

/** The `p_since` for the next poll: the server's `now` minus the overlap, as ISO. */
export function sinceFrom(now: string): string {
  return new Date(Date.parse(now) - DELTA_OVERLAP_MS).toISOString();
}

const byCreatedAt = (a: { created_at: string }, b: { created_at: string }): number =>
  Date.parse(a.created_at) - Date.parse(b.created_at);

function groupThreads(messages: readonly FeedbackMessage[]): Map<string, FeedbackMessage[]> {
  const out = new Map<string, FeedbackMessage[]>();
  for (const m of messages) {
    const list = out.get(m.feedback_id);
    if (list) list.push(m);
    else out.set(m.feedback_id, [m]);
  }
  for (const list of out.values()) list.sort(byCreatedAt);
  return out;
}

function threadTotal(threads: ReadonlyMap<string, readonly FeedbackMessage[]>): number {
  let n = 0;
  for (const list of threads.values()) n += list.length;
  return n;
}

function flatThreads(threads: ReadonlyMap<string, readonly FeedbackMessage[]>): FeedbackMessage[] {
  return [...threads.values()].flat().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A full snapshot equal to the current state is no change (the 10-min resync of a quiet board). */
function sameBoard(prev: BoardState, next: BoardState): boolean {
  return (
    JSON.stringify(prev.topics) === JSON.stringify(next.topics) &&
    JSON.stringify(flatThreads(prev.threads)) === JSON.stringify(flatThreads(next.threads)) &&
    JSON.stringify(prev.authorMessages) === JSON.stringify(next.authorMessages)
  );
}

function fromFull(d: BoardDelta): BoardState {
  return {
    topics: [...d.topics].sort(byCreatedAt),
    threads: groupThreads(d.messages),
    authorMessages: [...d.author_messages].sort(byCreatedAt),
  };
}

export function applyBoardDelta(
  prev: BoardState | null,
  d: BoardDelta,
): { state: BoardState; changed: boolean; consistent: boolean } {
  if (d.full || prev === null) {
    const next = fromFull(d);
    // A full snapshot is consistent by construction (one statement, one snapshot).
    if (prev !== null && sameBoard(prev, next)) return { state: prev, changed: false, consistent: true };
    return { state: next, changed: true, consistent: true };
  }

  const live = new Set(d.topic_ids);
  let changed = false;
  let topicsChanged = false;

  // ── topics: upsert by id, drop the ones no longer live ─────────────────────
  const topicsById = new Map(prev.topics.map((t) => [t.id, t]));
  for (const t of d.topics) {
    if (!live.has(t.id)) continue;
    const had = topicsById.get(t.id);
    // The overlap re-delivers the same row: same id and updated_at is no change.
    if (had && had.updated_at === t.updated_at) continue;
    topicsById.set(t.id, t);
    topicsChanged = true;
  }
  for (const id of [...topicsById.keys()]) {
    if (!live.has(id)) {
      topicsById.delete(id);
      topicsChanged = true;
    }
  }

  if (topicsChanged) changed = true;

  // ── replies: insert unseen ids into their thread ───────────────────────────
  let threads = prev.threads;
  const touched = new Set<string>();
  const ensureOwn = (): Map<string, FeedbackMessage[]> => {
    if (threads === prev.threads) threads = new Map(prev.threads);
    return threads;
  };
  for (const id of prev.threads.keys()) {
    if (!live.has(id)) {
      ensureOwn().delete(id);
      changed = true;
    }
  }
  for (const m of d.messages) {
    if (!live.has(m.feedback_id)) continue;
    const list = threads.get(m.feedback_id);
    if (list?.some((x) => x.id === m.id)) continue;
    const own = ensureOwn();
    // Copy a thread once per merge — the previous state's arrays stay untouched.
    const next = list && touched.has(m.feedback_id) ? list : [...(list ?? [])];
    next.push(m);
    next.sort(byCreatedAt);
    own.set(m.feedback_id, next);
    touched.add(m.feedback_id);
    changed = true;
  }

  // ── author channel: flat list, unseen ids appended ─────────────────────────
  let authorMessages = prev.authorMessages;
  if (authorMessages.some((a) => !live.has(a.feedback_id))) {
    authorMessages = authorMessages.filter((a) => live.has(a.feedback_id));
    changed = true;
  }
  const seenAuthor = new Set(authorMessages.map((a) => a.id));
  const fresh = d.author_messages.filter((a) => live.has(a.feedback_id) && !seenAuthor.has(a.id));
  if (fresh.length > 0) {
    authorMessages = [...authorMessages, ...fresh].sort(byCreatedAt);
    changed = true;
  }

  const state: BoardState = changed
    ? {
        topics: topicsChanged ? [...topicsById.values()].sort(byCreatedAt) : prev.topics,
        threads,
        authorMessages,
      }
    : prev;

  // Anything deleted (a reply, an author message) or missed shows up as a
  // count that no longer adds up — the component then re-reads in full.
  const consistent =
    d.topic_ids.every((id) => topicsById.has(id)) &&
    threadTotal(state.threads) === d.message_count &&
    state.authorMessages.length === d.author_message_count;

  return { state, changed, consistent };
}
