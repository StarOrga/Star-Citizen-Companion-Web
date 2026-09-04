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
 * Maps a PostgREST error message onto an i18n key. The RPCs raise stable
 * one-word codes exactly so the UI never has to render raw SQL text.
 */
export function friendErrorKey(message: string | null | undefined): string {
  const code = (message ?? '').toLowerCase();
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
