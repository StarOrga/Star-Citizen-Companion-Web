import type { Nachschub, OpenLine, WishPosition } from '../nachschub/nachschub.model';
import { emptyState } from './event-logic';
import {
  abortEventNachschub,
  archiveAtEventEnd,
  claimPlan,
  claimReward,
  clearEventNachschub,
  completeEvent,
  defaultClaimChannel,
  nachschubTypeFor,
  resumeEventNachschub,
  rewardLineState,
  wishlistAfterClaim,
} from './event-nachschub';
import type { EventReward } from './event-sheet';

const nach = (over: Partial<Nachschub> = {}): Nachschub => ({
  id: 'n1', name: 'IAE', status: 'active', slot: 1, snapshot: {}, createdAt: '2026-11-01', archivedAt: null, type: 'event', eventId: 'iae', ...over,
});
const reward = (over: Partial<EventReward> = {}): EventReward => ({
  id: 'r1', name: 'Keelback', className: 'DRAK_Keelback_Event', variant: null, channel: 'pledge',
  timing: { kind: 'immediate', date: null }, trackId: null, tier: null, ...over,
});
const wish = (className: string, qty = 1, forClassName?: string): WishPosition => ({ kind: 'ship', className, name: className, qty, forClassName });

describe('event Nachschub rules', () => {
  it('type: no rewards = sightseeing, rewards = event (C8)', () => {
    expect(nachschubTypeFor([])).toBe('sightseeing');
    expect(nachschubTypeFor(null)).toBe('sightseeing');
    expect(nachschubTypeFor([reward()])).toBe('event');
  });

  it('abort keeps progress, returns nothing to the wishlist and can be resumed (C9)', () => {
    const r = abortEventNachschub(nach(), '2026-11-09');
    expect(r.nachschub.status).toBe('archived');
    expect(r.nachschub.slot).toBeNull();
    expect(r.eventStatus).toBe('aborted');
    expect(r.removeLineIds).toEqual([]);
    expect(r.wishlistReturn).toEqual([]);
    const back = resumeEventNachschub([r.nachschub], 'n1');
    expect(back?.nachschub.status).toBe('active');
    expect(back?.eventStatus).toBe('open');
    expect(resumeEventNachschub([nach({ type: 'normal', status: 'archived', slot: null })], 'n1')).toBeNull();
  });

  it('emptying an event Nachschub never puts lines back on the wishlist (C9)', () => {
    const lines: OpenLine[] = [{ id: 'l1', kind: 'ship', className: 'X', name: 'X', qty: 1, closed: false }];
    const out = clearEventNachschub(lines, []);
    expect(out.removeIds).toEqual(['l1']);
    expect(out.wishlist).toEqual([]);
  });

  it('archives at the OFFICIAL event end only (C12)', () => {
    const now = Date.parse('2026-11-20T00:00:00Z');
    const ends = new Map([
      ['iae', { at: '2026-11-19', basis: 'official' as const }],
      ['other', { at: '2026-11-19', basis: 'estimate' as const }],
    ]);
    const all = [nach(), nach({ id: 'n2', eventId: 'other', slot: 2 }), nach({ id: 'n3', type: 'normal', eventId: null, slot: 3 })];
    const out = archiveAtEventEnd(all, ends, now, 'at');
    expect(out.map((n) => n.status)).toEqual(['archived', 'active', 'active']);
  });

  it('after-end rewards wait for distribution until ticked (C12)', () => {
    const r = reward({ timing: { kind: 'after-end', date: null } });
    expect(rewardLineState(r, {})).toBe('waiting');
    expect(rewardLineState(reward(), {})).toBe('open');
    const s = claimReward(emptyState('iae', 'a'), 'r1', 'pledge', true, 'b');
    expect(rewardLineState(r, s.claimed)).toBe('claimed');
  });

  it('claim: pledge/ingame/both map to origin and Hangar vs Inventar; whole event done (C10)', () => {
    expect(claimPlan('pledge', true).grants).toEqual([{ origin: 'pledge', destination: 'hangar' }]);
    expect(claimPlan('ingame', false).grants).toEqual([{ origin: 'ingame', destination: 'inventory' }]);
    expect(claimPlan('both', false).grants.map((g) => g.origin)).toEqual(['pledge', 'ingame']);
    expect(defaultClaimChannel(reward({ channel: 'unknown' }))).toBe('ingame');
    expect(defaultClaimChannel(reward({ channel: 'both' }))).toBe('both');
    const s = claimReward(emptyState('iae', 'a'), 'r1', 'pledge', true, 'b', 'live');
    expect(s.claimed['r1']).toEqual({ channel: 'pledge', at: 'b', stored: true, by: 'live' });
    expect(completeEvent(s, 'c').status).toBe('done');
  });

  it('wishlist dedupe only for the exact reward class, never the base item (C11)', () => {
    const w = [wish('DRAK_Keelback_Event', 2), wish('DRAK_Keelback'), wish('DRAK_Keelback_Event', 1, 'bp')];
    const out = wishlistAfterClaim(w, reward());
    expect(out.map((x) => `${x.className}:${x.qty}`)).toEqual(['DRAK_Keelback_Event:1', 'DRAK_Keelback:1', 'DRAK_Keelback_Event:1']);
    expect(wishlistAfterClaim([wish('DRAK_Keelback_Event')], reward())).toEqual([]);
    expect(wishlistAfterClaim(w, reward({ className: null }))).toEqual(w);
  });
});
