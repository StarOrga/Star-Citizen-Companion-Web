/**
 * Shapes and scope keys for account-bound composer drafts
 * (`public.feedback_drafts`, migration 20260729120000).
 *
 * A draft is identified by its SCOPE — the composer instance it belongs to, not
 * the topic. That keeps the three boxes a single thread can show (the admin
 * thread reply, the author-channel message, the workflow answer) from
 * overwriting each other, and it means a new composer needs a new constant
 * here, never a migration.
 */

/** One attachment of a draft: a pointer into `feedback-images`, never bytes. */
export interface DraftImageRef {
  id: string;
  name: string;
  url: string;
}

/** A stored draft, as the app works with it. */
export interface FeedbackDraft {
  scope: string;
  /** Topic the composer belongs to — drives the DB's ON DELETE CASCADE. */
  feedbackId: string | null;
  body: string;
  images: DraftImageRef[];
  updatedAt: string;
}

/** The row shape of `public.feedback_drafts` as PostgREST returns it. */
export interface FeedbackDraftRow {
  scope: string;
  feedback_id: string | null;
  body: string | null;
  images: unknown;
  updated_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every composer in the feedback surface, one key each.
 *
 * The `<uuid>` suffix is what `feedbackIdFromScope` reads back out, so the
 * caller never passes the topic id twice.
 */
export const draftScopes = {
  /** Non-admin panel, "Feedback senden" tab. */
  userNew: 'user:new',
  /** Non-admin panel, answer box on an admin question. */
  userReply: (feedbackId: string): string => `user:reply:${feedbackId}`,
  /** Admin board, new-topic box (pinned composer and the docked sheet share it). */
  adminNew: 'admin:new',
  /** Admin board, reply into the admin <-> routine thread. */
  adminThread: (feedbackId: string): string => `admin:thread:${feedbackId}`,
  /** Admin board, message into the author-visible channel. */
  adminAuthor: (feedbackId: string): string => `admin:author:${feedbackId}`,
  /** Workflow view, answer to the routine's open question. */
  adminWorkflow: (feedbackId: string): string => `admin:workflow:${feedbackId}`,
} as const;

/**
 * The topic a scope belongs to, or null for the two new-topic boxes.
 *
 * Only a well-formed UUID counts: the value goes into a real foreign key, and a
 * malformed suffix must degrade to "no topic" instead of failing the write and
 * costing the user their draft.
 */
export function feedbackIdFromScope(scope: string): string | null {
  const idx = scope.lastIndexOf(':');
  if (idx < 0) return null;
  const tail = scope.slice(idx + 1);
  return UUID_RE.test(tail) ? tail : null;
}

/**
 * Keep only well-formed attachment references.
 *
 * `images` is jsonb, so anything could be in there — an older client, a
 * hand-written row, a half-migrated shape. A draft that carries one unreadable
 * entry must still restore its text and its other images.
 */
export function normalizeDraftImages(raw: unknown): DraftImageRef[] {
  if (!Array.isArray(raw)) return [];
  const out: DraftImageRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, url } = entry as Partial<DraftImageRef>;
    if (typeof url !== 'string' || !url) continue;
    out.push({
      id: typeof id === 'string' && id ? id : crypto.randomUUID(),
      name: typeof name === 'string' ? name : 'image',
      url,
    });
  }
  return out;
}

/** Map a PostgREST row onto the app-side shape. */
export function parseDraftRow(row: FeedbackDraftRow): FeedbackDraft {
  return {
    scope: row.scope,
    feedbackId: row.feedback_id ?? null,
    body: row.body ?? '',
    images: normalizeDraftImages(row.images),
    updatedAt: row.updated_at,
  };
}

/**
 * Cache a per-topic scope string.
 *
 * The scope is a template binding, so building it fresh on every change
 * detection run would hand the composer a new string each time and look like an
 * input change. One map per composer kind keeps the identity stable.
 */
export function memoScope(
  cache: Map<string, string>,
  feedbackId: string,
  make: (id: string) => string,
): string {
  let scope = cache.get(feedbackId);
  if (!scope) {
    scope = make(feedbackId);
    cache.set(feedbackId, scope);
  }
  return scope;
}

/** Nothing worth keeping — the store deletes instead of writing such a row. */
export function isEmptyDraft(body: string, images: readonly unknown[]): boolean {
  return body.trim().length === 0 && images.length === 0;
}
