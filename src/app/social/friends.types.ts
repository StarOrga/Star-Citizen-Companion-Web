/**
 * Types + pure helpers for the social graph (migration 20260901181500).
 *
 * Everything the UI shows about another account comes from
 * `list_my_friend_edges()`: `public.profiles` is self-read only, so a raw
 * `from('profiles')` would return nothing for anyone but yourself. The RPC
 * projects display name + handle and deliberately nothing else.
 */

/** Which bucket of the friends page an edge belongs to. */
export type FriendEdgeKind = 'friend' | 'incoming' | 'outgoing' | 'blocked';

/** One row of `list_my_friend_edges()`. */
export interface FriendEdgeRow {
  kind: FriendEdgeKind;
  /** Set for `incoming`/`outgoing` only — the id accept/decline/withdraw needs. */
  request_id: string | null;
  user_id: string;
  display_name: string | null;
  username: string | null;
  since: string;
  /**
   * When a pending request dies (migration 20260904020000: `created_at + 7
   * days`), null for friends and blocks. Optional so a client running against
   * a DB that predates that migration still parses the RPC result — the
   * helpers below then simply render no deadline.
   */
  expires_at?: string | null;
}

/** The four buckets, ready to render. */
export interface FriendGraph {
  friends: FriendEdgeRow[];
  incoming: FriendEdgeRow[];
  outgoing: FriendEdgeRow[];
  blocked: FriendEdgeRow[];
}

/** One row of `find_user_by_username()`. */
export interface FoundUser {
  user_id: string;
  display_name: string | null;
  username: string | null;
}

/** Report categories — mirrors the CHECK constraint on `user_reports.category`. */
export const REPORT_CATEGORIES = [
  'spam',
  'harassment',
  'impersonation',
  'inappropriate',
  'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** Mirrors `user_reports_reason_len` — the client refuses before the DB does. */
export const REPORT_REASON_MAX = 1000;

/** Mirrors the `^[a-z0-9_]{3,20}$` rule enforced by `set_username()`. */
const USERNAME_RE = /^[a-z0-9_]{3,20}$/i;

export function emptyGraph(): FriendGraph {
  return { friends: [], incoming: [], outgoing: [], blocked: [] };
}

/**
 * Splits the flat RPC result into the four buckets.
 *
 * Unknown `kind` values are dropped rather than thrown on: a client that is a
 * deploy behind a future migration should render the buckets it understands,
 * not blank the whole page.
 */
export function groupFriendEdges(rows: readonly FriendEdgeRow[]): FriendGraph {
  const graph = emptyGraph();
  for (const row of rows) {
    switch (row.kind) {
      case 'friend':
        graph.friends.push(row);
        break;
      case 'incoming':
        graph.incoming.push(row);
        break;
      case 'outgoing':
        graph.outgoing.push(row);
        break;
      case 'blocked':
        graph.blocked.push(row);
        break;
      default:
        break;
    }
  }
  return graph;
}

/** Handle first, display name second, "—" last — never a raw uuid. */
export function edgeLabel(edge: Pick<FriendEdgeRow, 'display_name' | 'username'>): string {
  return edge.username ?? edge.display_name ?? '—';
}

/** Single uppercase initial for the avatar bubble. */
export function edgeInitial(edge: Pick<FriendEdgeRow, 'display_name' | 'username'>): string {
  const label = edgeLabel(edge);
  const first = label.trim().charAt(0);
  return first === '—' || first === '' ? '?' : first.toUpperCase();
}

/**
 * Client-side handle check, so an obvious typo never becomes a round trip.
 * The authority stays `find_user_by_username()`.
 */
export function isValidHandle(raw: string): boolean {
  return USERNAME_RE.test(raw.trim());
}

/** `true` when the reason is short enough for `user_reports_reason_len`. */
export function isValidReportReason(raw: string): boolean {
  return raw.trim().length <= REPORT_REASON_MAX;
}

/**
 * Whole days left before a pending request expires, clamped at 0. Days, not
 * hours: the window is a week, and a "6 d left" that ticks once a day is
 * information — a live countdown would just be noise on a page nobody keeps
 * open. `null` when there is no deadline (a friend, a block, or a
 * pre-migration DB that does not send one).
 */
export function daysUntilExpiry(
  edge: Pick<FriendEdgeRow, 'expires_at'>,
  now: Date = new Date(),
): number | null {
  if (!edge.expires_at) return null;
  const end = new Date(edge.expires_at).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

/**
 * True in the last 24 hours of a request's life — the point at which the
 * deadline stops being background information and becomes the reason to look
 * at the row.
 */
export function isExpiringSoon(
  edge: Pick<FriendEdgeRow, 'expires_at'>,
  now: Date = new Date(),
): boolean {
  const days = daysUntilExpiry(edge, now);
  return days !== null && days <= 1;
}

/**
 * Maps a PostgREST error message onto an i18n key. The RPCs raise stable
 * one-word codes exactly so the UI never has to render raw SQL text.
 */
export function friendErrorKey(message: string | null | undefined): string {
  const code = (message ?? '').toLowerCase();
  // Order matters: 'request_expired' is checked before the substring
  // 'blocked'/'request_not_found' tests below can claim it, and
  // 'account_suspended' before the generic fallback.
  if (code.includes('request_expired')) return 'friends.error.requestExpired';
  if (code.includes('account_suspended')) return 'friends.error.accountSuspended';
  if (code.includes('blocked')) return 'friends.error.blocked';
  if (code.includes('user_not_found')) return 'friends.error.userNotFound';
  if (code.includes('request_not_found')) return 'friends.error.requestNotFound';
  if (code.includes('invalid_target')) return 'friends.error.invalidTarget';
  if (code.includes('invalid_category')) return 'friends.error.invalidCategory';
  if (code.includes('reason_too_long')) return 'friends.error.reasonTooLong';
  if (code.includes('no_relation')) return 'friends.error.noRelation';
  if (code.includes('report_limit')) return 'friends.error.reportLimit';
  if (code.includes('not approved')) return 'friends.error.notApproved';
  return 'friends.error.generic';
}
