import { MOODS_OFF, MoodSubject, estimateMinutes, matchesMoods, toggleMood } from './hq-moods';
import {
  PLAN_SELECTION_KEY,
  PlanContext,
  PlanNeed,
  PlanSet,
  applyMood,
  initialSelection,
  passesFilters,
  saveSelection,
  selectedFraction,
  setFraction,
  setReach,
  soonSetKeys,
  toggleNeed,
  togglePlace,
  toggleSet,
  toggleStepKind,
  top3,
  top3Selection,
  visibleNeeds,
} from './hq-plan-selection';
import { buildPlaceTree, filterTree, nodeFraction, toggleNode } from './hq-place-tree';
import type { MapPlace } from './map/hq-map.types';

const place = (system: string, planet: string | null, location: string): MapPlace => ({
  id: [system, planet, location].filter(Boolean).join('/').toLowerCase(),
  system,
  planet,
  location,
});

function need(id: string, setKey: string | null, patch: Partial<PlanNeed> = {}): PlanNeed {
  return {
    id, label: id, kind: 'buy', qty: 1, status: 'open', setKey, setName: setKey, className: null, place: null,
    activity: null, crew: 1, wanted: true, ...patch,
  };
}
const set = (key: string, name: string, favorite = false): PlanSet => ({ key, kind: 'ship', id: key, name, favorite });

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as unknown as Storage;
}

describe('mood pairs (D25)', () => {
  const s = (patch: Partial<MoodSubject>): MoodSubject => ({ kind: 'buy', activity: null, minutes: 10, crew: 1, ...patch });

  it('is a 3-way toggle per pair: on, switch side, off', () => {
    let m = toggleMood(MOODS_OFF, 'danger', 'left');
    expect(m.danger).toBe('left');
    m = toggleMood(m, 'danger', 'right');
    expect(m.danger).toBe('right');
    m = toggleMood(m, 'danger', 'right');
    expect(m.danger).toBeNull();
  });

  it('Friedlich / Kampf split on mission activity', () => {
    const peaceful = { ...MOODS_OFF, danger: 'left' as const };
    const combat = { ...MOODS_OFF, danger: 'right' as const };
    expect(matchesMoods(s({ kind: 'buy' }), peaceful)).toBeTrue();
    expect(matchesMoods(s({ kind: 'buy' }), combat)).toBeFalse();
    expect(matchesMoods(s({ kind: 'mission', activity: 'kopfgeld' }), combat)).toBeTrue();
    expect(matchesMoods(s({ kind: 'mission', activity: 'medizin' }), combat)).toBeFalse();
    expect(matchesMoods(s({ kind: 'mission', activity: 'medizin' }), peaceful)).toBeTrue();
  });

  it('Schnell is under 30 minutes, Zeitintensiv from 30', () => {
    expect(estimateMinutes('buy', 5)).toBe(15);
    expect(matchesMoods(s({ minutes: 29 }), { ...MOODS_OFF, time: 'left' })).toBeTrue();
    expect(matchesMoods(s({ minutes: 30 }), { ...MOODS_OFF, time: 'left' })).toBeFalse();
    expect(matchesMoods(s({ minutes: 30 }), { ...MOODS_OFF, time: 'right' })).toBeTrue();
  });

  it('Solo is crew <= 1, Gruppe crew >= 2, and pairs combine with AND', () => {
    expect(matchesMoods(s({ crew: 2 }), { ...MOODS_OFF, crew: 'left' })).toBeFalse();
    expect(matchesMoods(s({ crew: 2 }), { ...MOODS_OFF, crew: 'right' })).toBeTrue();
    const both = { danger: 'left' as const, time: 'left' as const, crew: null };
    expect(matchesMoods(s({ minutes: 50 }), both)).toBeFalse();
    expect(matchesMoods(s({ minutes: 10 }), both)).toBeTrue();
  });
});

describe('set ring fraction and reachability (D28)', () => {
  it('is the wanted share of the set lines, never the catalog', () => {
    const needs = [need('a', 'ship:p'), need('b', 'ship:p'), need('c', 'ship:p', { wanted: false }), need('d', 'ship:p', { wanted: false })];
    expect(setFraction('ship:p', needs)).toBe(0.5);
    expect(setFraction('ship:p', [need('a', 'ship:p', { wanted: false })])).toBe(0);
    expect(setFraction('ship:p', needs.map((n) => ({ ...n, wanted: true })))).toBe(1);
    expect(setFraction('ship:none', needs)).toBe(0);
  });

  it('says full / partial / nothing for reachability', () => {
    const p = place('Stanton', 'Hurston', 'Lorville');
    expect(setReach('ship:p', [need('a', 'ship:p', { place: p }), need('b', 'ship:p', { place: p })])).toBe('full');
    expect(setReach('ship:p', [need('a', 'ship:p', { place: p }), need('b', 'ship:p')])).toBe('partial');
    expect(setReach('ship:p', [need('a', 'ship:p')])).toBeNull();
    expect(setReach('ship:p', [])).toBeNull();
  });
});

describe('Top 3 and the default on open (D24)', () => {
  const sets = [set('ship:z', 'Zeta'), set('ship:a', 'Alpha'), set('ship:m', 'Mid', true), set('ship:s', 'Soon'), set('ship:e', 'Empty', true)];
  const needs = [
    need('1', 'ship:z'), need('2', 'ship:a'), need('3', 'ship:m'), need('4', 'ship:s'),
    need('5', 'ship:e', { status: 'done' }), need('6', 'ship:a', { wanted: false }),
  ];
  const ctx: PlanContext = { needs, sets, soonSets: new Set(['ship:s']) };

  it('ranks favourite > Einsatz soon > gap, stable by name, and skips sets without an open gap', () => {
    expect(top3(ctx)).toEqual(['ship:m', 'ship:s', 'ship:a']);
  });

  it('Top 3 selects the wanted open lines of those sets', () => {
    const sel = top3Selection(ctx);
    expect(sel.origin).toBe('top3');
    expect([...sel.supplyIds].sort()).toEqual(['2', '3', '4']);
  });

  it('opens with Top 3 when nothing was stored (new tab / reload)', () => {
    expect(initialSelection(memory(), ctx).origin).toBe('top3');
    expect(initialSelection(null, ctx).origin).toBe('top3');
  });

  it('opens with the last selection once the user changed something, however often they jump around', () => {
    const session = memory();
    const changed = toggleStepKind(top3Selection(ctx), 'craft');
    saveSelection(session, changed);
    expect(session.getItem(PLAN_SELECTION_KEY)).toContain('"changed":true');
    for (let i = 0; i < 3; i++) {
      const again = initialSelection(session, ctx);
      expect(again.origin).toBe('custom');
      expect([...again.steps]).toEqual(['craft']);
      expect([...again.supplyIds].sort()).toEqual(['2', '3', '4']);
    }
  });

  it('survives corrupt storage', () => {
    const session = memory();
    session.setItem(PLAN_SELECTION_KEY, '{nope');
    expect(initialSelection(session, ctx).origin).toBe('top3');
  });
});

describe('selection transitions (D23)', () => {
  const sets = [set('ship:a', 'Alpha')];
  const lorville = place('Stanton', 'Hurston', 'Lorville');
  const needs = [
    need('1', 'ship:a', { place: lorville }),
    need('2', 'ship:a', { kind: 'mission', activity: 'kopfgeld', place: place('Stanton', 'Crusader', 'Port Olisar') }),
    need('3', null, { kind: 'mine' }),
  ];
  const ctx: PlanContext = { needs, sets };

  it('a mood click is "Nach Lust": the whole pool, filtered by the mood; all off returns to Top 3', () => {
    const sel = applyMood(top3Selection(ctx), 'danger', 'right', ctx);
    expect(sel.origin).toBe('mood');
    expect(visibleNeeds(sel, needs).map((n) => n.id)).toEqual(['2']);
    const back = applyMood(sel, 'danger', 'right', ctx);
    expect(back.origin).toBe('top3');
  });

  it('every manual change is "Gezielt"', () => {
    const base = top3Selection(ctx);
    expect(toggleStepKind(base, 'buy').origin).toBe('custom');
    expect(togglePlace(base, lorville.id).origin).toBe('custom');
    expect(toggleNeed(base, '3').origin).toBe('custom');
    expect(toggleSet(base, 'ship:a', needs).origin).toBe('custom');
  });

  it('unselected needs are hidden from list and map, filters narrow the rest', () => {
    let sel = toggleNeed(toggleNeed(top3Selection({ needs: [], sets: [] }), '1'), '3');
    expect(visibleNeeds(sel, needs).map((n) => n.id)).toEqual(['1', '3']);
    sel = toggleStepKind(sel, 'buy');
    expect(visibleNeeds(sel, needs).map((n) => n.id)).toEqual(['1']);
    sel = togglePlace(toggleStepKind(sel, 'buy'), lorville.id);
    expect(visibleNeeds(sel, needs).map((n) => n.id)).toEqual(['1']);
    expect(passesFilters(sel, needs[2])).toBeFalse();
  });

  it('clicking a set selects all its needs and clicking again removes them; the share follows', () => {
    const empty = top3Selection({ needs: [], sets: [] });
    const on = toggleSet(empty, 'ship:a', needs);
    expect([...on.supplyIds].sort()).toEqual(['1', '2']);
    expect(selectedFraction(on, 'ship:a', needs)).toBe(1);
    const half = toggleNeed(on, '2');
    expect(selectedFraction(half, 'ship:a', needs)).toBe(0.5);
    expect(toggleSet(on, 'ship:a', needs).supplyIds.size).toBe(0);
  });

  it('an Einsatz that is due soon marks its set', () => {
    const now = Date.parse('2026-11-01T10:00:00Z');
    const e = (plannedAt: string | null, status = 'planned') => ({ plannedAt, status, steps: [{ supplyId: '1' }] });
    expect(soonSetKeys([e('2026-11-02T10:00:00Z')], needs, now).has('ship:a')).toBeTrue();
    expect(soonSetKeys([e('2026-11-09T10:00:00Z')], needs, now).has('ship:a')).toBeFalse();
    expect(soonSetKeys([e(null, 'active')], needs, now).has('ship:a')).toBeTrue();
    expect(soonSetKeys([e('2026-11-02T10:00:00Z', 'done')], needs, now).has('ship:a')).toBeFalse();
  });
});

describe('place tree (D26)', () => {
  const places = [
    place('Stanton', 'Hurston', 'Lorville'),
    place('Stanton', 'Hurston', 'Everus Harbor'),
    place('Stanton', 'Crusader', 'Port Olisar'),
    place('Pyro', null, 'Ruin Station'),
  ];
  const tree = buildPlaceTree(places);

  it('builds System > Planet > Ort', () => {
    expect(tree.map((n) => n.label)).toEqual(['Pyro', 'Stanton']);
    const stanton = tree[1];
    expect(stanton.children.map((n) => n.label)).toEqual(['Crusader', 'Hurston']);
    expect(stanton.children[1].children.map((n) => n.label)).toEqual(['Everus Harbor', 'Lorville']);
    expect(stanton.leaves.length).toBe(3);
    expect(tree[0].children[0].depth).toBe(1);
  });

  it('is tri-state: partial, full, and a click completes or clears', () => {
    const hurston = tree[1].children[1];
    const one = new Set([places[0].id]);
    expect(nodeFraction(hurston, one)).toBe(0.5);
    const all = toggleNode(hurston, one);
    expect(nodeFraction(hurston, all)).toBe(1);
    expect(toggleNode(hurston, all).size).toBe(0);
  });

  it('mini search keeps matching branches', () => {
    const f = filterTree(tree, 'lorv');
    expect(f.length).toBe(1);
    expect(f[0].children[0].label).toBe('Hurston');
    expect(f[0].children[0].children.map((n) => n.label)).toEqual(['Lorville']);
    expect(filterTree(tree, 'stanton')[0].leaves.length).toBe(3);
    expect(filterTree(tree, 'zzz')).toEqual([]);
  });
});
