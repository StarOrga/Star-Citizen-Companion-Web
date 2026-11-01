import { buildRoute, planetIndex, schematicDistance } from './hq-route';
import type { MapNeed, MapPlace } from './hq-map.types';

const place = (system: string, planet: string | null, location: string): MapPlace => ({
  id: [system, planet, location].filter(Boolean).join('/').toLowerCase(),
  system,
  planet,
  location,
});
const LORVILLE = place('Stanton', 'Hurston', 'Lorville');
const HUR_L1 = place('Stanton', 'Hurston', 'HUR-L1');
const ORISON = place('Stanton', 'Crusader', 'Orison');
const AREA18 = place('Stanton', 'ArcCorp', 'Area18');
const NEWBAB = place('Stanton', 'microTech', 'New Babbage');
const RUIN = place('Pyro', 'Pyro V', 'Ruin Station');

let seq = 0;
const need = (p: MapPlace | null, kind: MapNeed['kind'] = 'buy', status: MapNeed['status'] = 'open'): MapNeed => ({
  id: `n${++seq}`,
  label: `Item ${seq}`,
  kind,
  qty: 1,
  status,
  colorKey: 'set-a',
  place: p,
});

describe('buildRoute', () => {
  it('returns no steps for no placed open needs', () => {
    expect(buildRoute([], null)).toEqual([]);
    expect(buildRoute([need(null), need(ORISON, 'buy', 'done')], null)).toEqual([]);
  });

  it('visits the start system first, then nearest neighbour by ring order', () => {
    const route = buildRoute([need(RUIN), need(NEWBAB), need(LORVILLE), need(ORISON)], AREA18);
    expect(route.map((s) => s.place.location)).toEqual(['Orison', 'Lorville', 'New Babbage', 'Ruin Station']);
    expect(route.map((s) => s.ord)).toEqual([1, 2, 3, 4]);
    expect(route[0].leg).toBeNull();
    expect(route[1].leg).toBe('travel');
  });

  it('prefers a second place on the same planet over the next ring', () => {
    const route = buildRoute([need(ORISON), need(HUR_L1), need(LORVILLE)], LORVILLE);
    expect(route.map((s) => s.place.location)).toEqual(['Lorville', 'HUR-L1', 'Orison']);
  });

  it('merges same-kind needs at one place, keeps transport legs as their own steps', () => {
    const a = need(LORVILLE, 'buy');
    const b = need(LORVILLE, 'buy');
    const t1 = need(ORISON, 'transport');
    const t2 = need(ORISON, 'transport');
    const route = buildRoute([a, b, t1, t2], LORVILLE);
    expect(route.length).toBe(3);
    expect(route[0].needIds).toEqual([a.id, b.id]);
    expect(route[0].label).toBe(`${a.label}, ${b.label}`);
    expect(route.slice(1).map((s) => s.leg)).toEqual(['transport', 'transport']);
  });

  it('orders verbs at one place mine → refine → craft', () => {
    const route = buildRoute([need(LORVILLE, 'craft'), need(LORVILLE, 'refine'), need(LORVILLE, 'mine')], LORVILLE);
    expect(route.map((s) => s.kind)).toEqual(['mine', 'refine', 'craft']);
  });

  it('without a start, systems with more stops come first', () => {
    const route = buildRoute([need(LORVILLE), need(RUIN), need(place('Pyro', 'Pyro I', 'Checkmate'))], null);
    expect(route[0].place.system).toBe('Pyro');
  });

  it('schematic distance and ring index', () => {
    expect(planetIndex(LORVILLE)).toBe(0);
    expect(planetIndex(NEWBAB)).toBe(3);
    expect(planetIndex(place('Stanton', null, 'Port Tressler'))).toBeGreaterThan(100);
    expect(schematicDistance(LORVILLE, LORVILLE)).toBe(0);
    expect(schematicDistance(LORVILLE, HUR_L1)).toBe(1);
    expect(schematicDistance(LORVILLE, ORISON)).toBeLessThan(schematicDistance(LORVILLE, NEWBAB));
    expect(schematicDistance(LORVILLE, RUIN)).toBe(1000);
  });
});
