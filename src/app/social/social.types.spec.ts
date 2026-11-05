import {
  SocialStats,
  compareRows,
  effectiveVisibility,
  friendPath,
  inviteLinkFor,
  isEmptyOverride,
  isValidGroupName,
  isValidInviteToken,
  socialErrorKey,
} from './social.types';

const stats = (over: Partial<SocialStats> = {}): SocialStats => ({
  ships: 1,
  sets: 2,
  einsaetze_planned: 3,
  einsaetze_done: 4,
  missions_30d: 5,
  kartograph_rank: 0,
  active_days_30: 7,
  desktop_connected: false,
  ...over,
});

describe('social.types', () => {
  it('isValidInviteToken accepts the minted shape and rejects a mangled URL', () => {
    expect(isValidInviteToken('a'.repeat(64))).toBeTrue();
    expect(isValidInviteToken('  ' + 'F'.repeat(32) + ' ')).toBeTrue();
    expect(isValidInviteToken('short')).toBeFalse();
    expect(isValidInviteToken('g'.repeat(64))).toBeFalse();
  });

  it('inviteLinkFor builds an absolute URL outside /social', () => {
    expect(inviteLinkFor('abc', 'https://sc.test')).toBe('https://sc.test/invite/abc');
  });

  it('friendPath prefers the handle and falls back to the id', () => {
    expect(friendPath({ user_id: 'u1', username: 'pilot' })).toEqual(['/social', 'pilot']);
    expect(friendPath({ user_id: 'u1', username: null })).toEqual(['/social', 'u1']);
  });

  it('isValidGroupName trims and enforces 1 to 60', () => {
    expect(isValidGroupName(' Wings ')).toBeTrue();
    expect(isValidGroupName('   ')).toBeFalse();
    expect(isValidGroupName('x'.repeat(60))).toBeTrue();
    expect(isValidGroupName('x'.repeat(61))).toBeFalse();
  });

  describe('effectiveVisibility', () => {
    const general = { hangar: true, flagship: true, presence: false, stats: true };

    it('is the general setting without an override', () => {
      expect(effectiveVisibility(general, null)).toEqual(general);
    });

    it('lets a set facet win in both directions and inherits a null one', () => {
      expect(effectiveVisibility(general, { hangar: false, flagship: null, presence: true, stats: null })).toEqual({
        hangar: false,
        flagship: true,
        presence: true,
        stats: true,
      });
    });
  });

  it('isEmptyOverride is true only when every facet inherits', () => {
    expect(isEmptyOverride({ hangar: null, flagship: null, presence: null, stats: null })).toBeTrue();
    expect(isEmptyOverride({ hangar: false, flagship: null, presence: null, stats: null })).toBeFalse();
  });

  describe('compareRows', () => {
    it('marks where I stand on every metric and leaves the boolean out', () => {
      const rows = compareRows(stats({ ships: 9, sets: 2, missions_30d: 1 }), stats({ ships: 1, sets: 2, missions_30d: 3 }));
      expect(rows.find((r) => r.metric === 'ships')?.standing).toBe('ahead');
      expect(rows.find((r) => r.metric === 'sets')?.standing).toBe('even');
      expect(rows.find((r) => r.metric === 'missions_30d')?.standing).toBe('behind');
      expect(rows.map((r) => r.metric as string)).not.toContain('desktop_connected');
      expect(rows[0].labelKey).toBe('social.compare.ships');
    });

    it('leaves only the presence metric open when the friend hides their presence', () => {
      const rows = compareRows(stats(), stats({ active_days_30: null, desktop_connected: null }));
      const days = rows.find((r) => r.metric === 'active_days_30');
      expect(days?.friend).toBeNull();
      expect(days?.standing).toBeNull();
      expect(rows.find((r) => r.metric === 'ships')?.standing).toBe('even');
    });

    it('has no friend value and no standing when the friend hides the stats', () => {
      const rows = compareRows(stats(), null);
      expect(rows.every((r) => r.friend === null && r.standing === null)).toBeTrue();
    });
  });

  describe('socialErrorKey', () => {
    it('maps the stable codes', () => {
      expect(socialErrorKey('invite_expired')).toBe('social.error.inviteExpired');
      expect(socialErrorKey('slot_taken')).toBe('social.error.slotTaken');
      expect(socialErrorKey('ship_unavailable')).toBe('social.error.shipUnavailable');
      expect(socialErrorKey('not_friends')).toBe('social.error.notFriends');
      expect(socialErrorKey('not approved')).toBe('social.error.notApproved');
    });

    it('does not confuse the two invite limits', () => {
      expect(socialErrorKey('invite_rate_limited')).toBe('social.error.inviteRateLimited');
      expect(socialErrorKey('invite_limit')).toBe('social.error.inviteLimit');
    });

    it('answers null for anything else, so a timeout stays a timeout', () => {
      expect(socialErrorKey('canceling statement due to statement timeout')).toBeNull();
      expect(socialErrorKey(null)).toBeNull();
    });
  });
});
