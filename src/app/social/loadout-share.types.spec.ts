import {
  LoadoutShareRow,
  isLinkShare,
  isValidShareToken,
  shareErrorKey,
  shareItems,
  shareLinkFor,
} from './loadout-share.types';

function share(over: Partial<LoadoutShareRow>): LoadoutShareRow {
  return {
    id: 's1',
    token: null,
    shared_with: null,
    friend_name: null,
    friend_handle: null,
    created_at: '2026-09-04T10:00:00Z',
    ...over,
  };
}

describe('loadout-share.types — the two share shapes', () => {
  it('tells a link share from a friend share', () => {
    // `loadout_shares_one_shape` makes these mutually exclusive in the DB;
    // the panel renders them in two different blocks precisely because their
    // blast radius differs, so misreading one as the other would put a public
    // URL under the "with friends" heading.
    expect(isLinkShare(share({ token: 'a'.repeat(64) }))).toBe(true);
    expect(isLinkShare(share({ shared_with: 'u2' }))).toBe(false);
  });

  it('does not read an empty-string token as a link', () => {
    expect(isLinkShare(share({ token: '' }))).toBe(false);
  });
});

describe('loadout-share.types — token shape', () => {
  it('accepts what new_share_token() mints (64 hex chars)', () => {
    expect(isValidShareToken('0123456789abcdef'.repeat(4))).toBe(true);
  });

  it('refuses anything outside the DB length constraint or alphabet', () => {
    expect(isValidShareToken('')).toBe(false);
    expect(isValidShareToken('abc')).toBe(false);
    expect(isValidShareToken('z'.repeat(64))).toBe(false);
    expect(isValidShareToken('a'.repeat(129))).toBe(false);
  });

  it('tolerates surrounding whitespace from a pasted URL', () => {
    expect(isValidShareToken('  ' + 'a'.repeat(32) + ' ')).toBe(true);
  });
});

describe('loadout-share.types — link building and payloads', () => {
  it('builds an absolute URL on the given origin', () => {
    expect(shareLinkFor('abc123', 'https://sc-companion.vercel.app')).toBe(
      'https://sc-companion.vercel.app/shared/loadout/abc123',
    );
  });

  it('survives a null items payload (an empty loadout is legal)', () => {
    expect(shareItems({ items: null })).toEqual([]);
    expect(shareItems({ items: [{ slot: 'primary', className: 'X', kind: 'weapon' }] }).length).toBe(1);
  });

  it('maps not_friends to its own key — un-friending is the revoke path', () => {
    expect(shareErrorKey('not_friends')).toBe('share.error.notFriends');
    expect(shareErrorKey('share_not_found')).toBe('share.error.shareNotFound');
    expect(shareErrorKey('account_suspended')).toBe('share.error.suspended');
    expect(shareErrorKey('some raw pg text')).toBe('share.error.generic');
  });
});
