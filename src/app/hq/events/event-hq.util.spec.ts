import type { Nachschub } from '../nachschub/nachschub.model';
import type { EventRow, OpenEvent } from './event-logic';
import { eventBinding, eventSteps, boardTiles, endView, eventDrafts, eventOffer, eventsRewarding, looksLikeShip, nearestEndOf, prereqView, readPlaceReport } from './event-hq.util';
import { normalizeSheet } from './event-sheet';

const field = (value: unknown) => ({ value, confidence: 1, source: 'admin', review: 'approved' });
const sheet = (fields: Record<string, unknown>) => normalizeSheet({ schema: 1, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, field(v)])) });

function open(id: string, fields: Record<string, unknown>, endAt: string | null = '2026-12-01'): OpenEvent {
  const event: EventRow = { id, name: id, startDate: '2026-11-01', endDate: endAt ?? '', dateStatus: endAt ? 'confirmed' : 'estimated', status: 'scheduled', hidden: false, freeFly: false, sheet: sheet(fields) };
  return { event, end: endAt ? { at: endAt, basis: 'official' } : { at: null, basis: 'unknown' }, state: 'open' };
}
const nach = (id: string, createdAt: string, eventId: string | null = null): Nachschub => ({
  id, name: id, status: 'active', slot: 1, snapshot: {}, createdAt, archivedAt: null, type: eventId ? 'event' : 'normal', eventId,
});

describe('event-hq.util', () => {
  it('F1: row starts with the oldest, one plus at the end, none when full', () => {
    const a = nach('a', '2026-01-02'), b = nach('b', '2026-01-01'), c = nach('c', '2026-01-03');
    expect(boardTiles([a, b, c], 7).map((t) => t?.id ?? '+')).toEqual(['b', 'a', 'c', '+']);
    expect(boardTiles([a, b], 2).map((t) => t?.id)).toEqual(['b', 'a']);
    expect(boardTiles([], 7)).toEqual([null]);
  });

  it('C5/F8: end view names official, estimate and unknown', () => {
    expect(endView({ at: '2026-12-01', basis: 'official' }).key).toBe('hq.events.end.official');
    expect(endView({ at: '2026-12-01', basis: 'estimate' }).key).toBe('hq.events.end.estimate');
    expect(endView({ at: null, basis: 'unknown' }).key).toBe('hq.events.end.unknown');
  });

  it('F8: nearest end prefers a dated event', () => {
    expect(nearestEndOf([open('x', {}, null), open('y', {}, '2026-12-05')])?.event.id).toBe('y');
    expect(nearestEndOf([])).toBeNull();
  });

  it('F5/ev-a4: only the exact reward class counts', () => {
    const e = open('e', { rewards: [{ id: 'r', name: 'Keelback', className: 'ARGO_KEELBACK', channel: 'pledge' }] });
    expect(eventsRewarding([e], 'argo_keelback').length).toBe(1);
    expect(eventsRewarding([e], 'ARGO_MAXLIFT').length).toBe(0);
    expect(eventsRewarding([e], '').length).toBe(0);
  });

  it('F10: ship class names are recognised by manufacturer prefix', () => {
    expect(looksLikeShip('ARGO_KEELBACK')).toBe(true);
    expect(looksLikeShip('behr_rifle_ballistic_01')).toBe(false);
    expect(looksLikeShip(null)).toBe(false);
  });

  it('F13: AND / OR tree, lone gear becomes a one-item group', () => {
    const v = prereqView({ op: 'or', items: [{ gear: 'fps-combat-set', label: null }, { op: 'and', items: [{ gear: 'combat-ship', label: null }, { gear: 'salvage-ship', label: null }] }] });
    expect(v?.kind === 'group' && v.op).toBe('or');
    const lone = prereqView({ gear: 'salvage-ship', label: null });
    expect(lone?.kind === 'group' && lone.items.length).toBe(1);
    expect(prereqView(null)).toBeNull();
  });

  it('F6: event draft carries the area and venues instead of a place', () => {
    const e = open('e', { area: { kind: 'system', systems: ['stanton'], places: [] }, venues: ['verse', 'arena-commander'] });
    const [d] = eventDrafts([{ event: e, rewards: [{ name: 'Keelback', qty: 1 }] }]);
    expect(d.area).toEqual({ kind: 'system', systems: ['stanton'], places: [], venues: ['verse', 'arena-commander'] });
    expect(d.goods.length).toBe(1);
  });

  it('F6: two events in one Nachschub - every event gets its reward lines and its own steps', () => {
    const r = (id: string, cls: string) => ({ id, name: id, className: cls, channel: 'pledge' });
    const a = open('a', { rewards: [r('r1', 'ARGO_KEELBACK')], area: { kind: 'system', systems: ['stanton'], places: [] } });
    const b = open('b', { rewards: [r('r2', 'behr_rifle_01')], area: { kind: 'system', systems: ['pyro'], places: [] } });
    const ra = a.event.sheet!.fields.rewards.value!;
    const rb = b.event.sheet!.fields.rewards.value!;
    const plan = eventBinding([{ event: a, rewards: ra }, { event: b, rewards: rb }])!;
    expect(plan.eventId).toBe('a');
    expect(plan.type).toBe('event');
    expect(plan.rewards.map((x) => [x.eventId, x.className, x.ship])).toEqual([['a', 'ARGO_KEELBACK', true], ['b', 'behr_rifle_01', false]]);
    const drafts = eventDrafts([{ event: a, rewards: [{ name: 'Keelback', qty: 1, className: 'ARGO_KEELBACK' }] }, { event: b, rewards: [{ name: 'Rifle', qty: 1, className: 'behr_rifle_01' }] }]);
    const steps = drafts.flatMap((d) => eventSteps(d, (c) => 'line-' + c));
    expect(steps.map((s) => [s.eventId, s.supplyId])).toEqual([['a', 'line-ARGO_KEELBACK'], ['b', 'line-behr_rifle_01']]);
    expect(steps[1].area).toEqual(expect.objectContaining({ systems: ['pyro'] }));
    expect(eventBinding([])).toBeNull();
  });

  it('F9: offer inside the area, none without signal, dismissed until the place changes, AC by venue', () => {
    const e = open('e', { area: { kind: 'places', systems: ['stanton'], places: ['new-babbage'] }, venues: ['verse', 'arena-commander'] });
    const n = nach('n', '2026-01-01', 'e');
    const at = readPlaceReport({ location: { system: 'Stanton', place: 'New Babbage' } });
    expect(eventOffer([n], [e], at, true, null, null)?.nachschubId).toBe('n');
    expect(eventOffer([n], [e], at, false, null, null)).toBeNull();
    expect(eventOffer([n], [e], at, true, at.key, null)).toBeNull();
    const elsewhere = readPlaceReport({ location: { system: 'Stanton', place: 'Lorville' } });
    expect(eventOffer([n], [e], elsewhere, true, at.key, null)).toBeNull();
    const ac = readPlaceReport({ location: { system: 'Stanton', place: 'Lorville' }, event: { arenaCommander: true } });
    expect(eventOffer([n], [e], ac, true, at.key, null)?.arenaCommander).toBe(true);
    expect(eventOffer([n], [e], at, true, null, 'n')).toBeNull();
  });
});
