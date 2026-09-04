import { FriendEdgeRow, daysUntilExpiry, friendErrorKey, isExpiringSoon } from './friends.types';

/**
 * The 7-day friend-request expiry (migration 20260904020000).
 *
 * The DB is the enforcement — `list_my_friend_edges()` hides an over-age
 * pending row and `respond_friend_request()` refuses it. These helpers only
 * decide what the row LOOKS like while it is still alive, so what is pinned
 * here is the boundary behaviour: the last day must not read "0 days left",
 * and a client talking to a DB that predates the migration (no `expires_at`
 * in the payload) must render no deadline at all rather than a wrong one.
 */
function pending(expiresAt: string | null | undefined): FriendEdgeRow {
  return {
    kind: 'incoming',
    request_id: 'req-1',
    user_id: 'u1',
    display_name: null,
    username: 'pilot',
    since: '2026-09-01T10:00:00Z',
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
  };
}

const NOW = new Date('2026-09-04T12:00:00Z');

describe('friends.types — request expiry', () => {
  it('rounds up to whole days, so "6 d left" covers the whole sixth day', () => {
    // 5 days and 1 hour out: the user still has parts of six days.
    expect(daysUntilExpiry(pending('2026-09-09T13:00:00Z'), NOW)).toBe(6);
  });

  it('reports 1 for anything inside the final 24 hours', () => {
    expect(daysUntilExpiry(pending('2026-09-05T11:00:00Z'), NOW)).toBe(1);
    expect(isExpiringSoon(pending('2026-09-05T11:00:00Z'), NOW)).toBe(true);
  });

  it('clamps an already-passed deadline to 0 instead of going negative', () => {
    // The server hides these, but a payload can be a few seconds stale — a
    // "-1 days left" would be a rendering bug on a legitimate race.
    expect(daysUntilExpiry(pending('2026-09-03T12:00:00Z'), NOW)).toBe(0);
    expect(isExpiringSoon(pending('2026-09-03T12:00:00Z'), NOW)).toBe(true);
  });

  it('says "no deadline" for a friend, a block and a pre-migration payload', () => {
    expect(daysUntilExpiry(pending(null), NOW)).toBeNull();
    expect(daysUntilExpiry(pending(undefined), NOW)).toBeNull();
    expect(isExpiringSoon(pending(undefined), NOW)).toBe(false);
  });

  it('treats an unparseable timestamp as no deadline, never as expired', () => {
    expect(daysUntilExpiry(pending('not-a-date'), NOW)).toBeNull();
  });

  it('maps request_expired to its own key, not to requestNotFound', () => {
    // Both come back from respond_friend_request() and mean different things
    // to the user: one is "gone", the other is "was never yours".
    expect(friendErrorKey('request_expired')).toBe('friends.error.requestExpired');
    expect(friendErrorKey('request_not_found')).toBe('friends.error.requestNotFound');
  });

  it('maps account_suspended ahead of the generic fallback', () => {
    expect(friendErrorKey('account_suspended')).toBe('friends.error.accountSuspended');
  });
});
