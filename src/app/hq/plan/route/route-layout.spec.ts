import { RouteFilterStore, ROUTE_FILTER_KEY, routeFilterKey, sanitizeKinds } from './route-filter.store';
import { ROUTE_H, ROUTE_W, RouteGraphStep, kindsIn, layoutRoute } from './route-layout';

const step = (ord: number, kind: RouteGraphStep['kind'], location: string | null, system: string | null, state: 'todo' | 'done' = 'todo'): RouteGraphStep => ({
  ord,
  kind,
  label: `${kind} ${ord}`,
  location,
  system,
  state,
});

/** A 15-step route over Stanton and Pyro, as in the concept's stress case. */
const STRESS: RouteGraphStep[] = [
  step(1, 'pickup', 'Seraphim-Station', 'Stanton'),
  step(2, 'buy', 'Seraphim-Station', 'Stanton'),
  step(3, 'transport', 'Pyro-Gateway', 'Stanton'),
  step(4, 'mission', 'Ruin Station', 'Pyro'),
  step(5, 'mine', 'Pyro I', 'Pyro'),
  step(6, 'mine', 'Pyro I', 'Pyro'),
  step(7, 'mine', 'Monox', 'Pyro'),
  step(8, 'pickup', 'Ruin Station', 'Pyro'),
  step(9, 'refine', 'Ruin Station', 'Pyro'),
  step(10, 'transport', 'Stanton-Gateway', 'Pyro'),
  step(11, 'refine', 'CRU-L1', 'Stanton'),
  step(12, 'pickup', 'CRU-L1', 'Stanton'),
  step(13, 'pickup', 'Seraphim-Station', 'Stanton'),
  step(14, 'transport', 'Area18', 'Stanton'),
  step(15, 'craft', 'Area18', 'Stanton'),
];

describe('layoutRoute', () => {
  it('lays nothing out for no steps', () => {
    expect(layoutRoute([])).toEqual({ systems: [], nodes: [], legs: [] });
  });

  it('gives each star system its own area side by side and keeps every node inside the view box', () => {
    const l = layoutRoute(STRESS);
    expect(l.systems.map((s) => s.name)).toEqual(['Stanton', 'Pyro']);
    expect(l.systems[0].cx).toBeLessThan(l.systems[1].cx);
    for (const n of l.nodes) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(ROUTE_W);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(ROUTE_H);
      expect(n.nameY).toBeGreaterThan(0);
      expect(n.nameY).toBeLessThan(ROUTE_H);
    }
  });

  it('merges steps at one place into one node with all its ords, and draws a leg only between different places', () => {
    const l = layoutRoute(STRESS);
    const seraphim = l.nodes.find((n) => n.name === 'Seraphim-Station')!;
    expect(seraphim.ords).toEqual([1, 2, 13]);
    expect(l.nodes.length).toBe(8);
    expect(l.legs.length).toBe(9);
  });

  it('marks the legs that change the system as jumps', () => {
    const l = layoutRoute(STRESS);
    // Stanton -> Pyro (3 -> 4) and Pyro -> Stanton (10 -> 11).
    expect(l.legs.filter((x) => x.jump).length).toBe(2);
  });

  it('puts steps without a place on an open node of the system the route is in', () => {
    const l = layoutRoute([step(1, 'buy', 'Area18', 'Stanton'), step(2, 'mine', null, null)], { openLabel: 'Ort offen' });
    expect(l.systems.length).toBe(1);
    expect(l.nodes.map((n) => n.name)).toEqual(['Area18', 'Ort offen']);
    expect(l.nodes[1].location).toBe('');
  });

  it('hides badges of a hidden kind but keeps the stop; a node with nothing visible goes dim', () => {
    const l = layoutRoute(STRESS, { hidden: new Set(['mine']) });
    const monox = l.nodes.find((n) => n.name === 'Monox')!;
    expect(monox.badges).toEqual([]);
    expect(monox.dim).toBe(true);
    const pyroI = l.nodes.find((n) => n.name === 'Pyro I')!;
    expect(pyroI.dim).toBe(true);
    expect(l.nodes.find((n) => n.name === 'Area18')!.badges.map((b) => b.kind)).toEqual(['craft', 'transport']);
  });

  it('marks the current node and done nodes', () => {
    const steps = STRESS.map((s) => (s.ord <= 3 ? { ...s, state: 'done' as const } : s));
    const l = layoutRoute(steps, { current: 4 });
    expect(l.nodes.find((n) => n.name === 'Ruin Station')!.state).toBe('cur');
    expect(l.nodes.find((n) => n.name === 'Pyro-Gateway')!.state).toBe('done');
    expect(l.nodes.find((n) => n.name === 'Monox')!.state).toBe('todo');
  });

  it('lists the kinds present in legend order', () => {
    expect(kindsIn(STRESS)).toEqual(['buy', 'mission', 'mine', 'refine', 'craft', 'transport', 'pickup']);
    expect(kindsIn([step(1, 'craft', null, null), step(2, 'buy', null, null)])).toEqual(['buy', 'craft']);
  });
});

describe('RouteFilterStore', () => {
  beforeEach(() => localStorage.removeItem(ROUTE_FILTER_KEY));
  afterEach(() => localStorage.removeItem(ROUTE_FILTER_KEY));

  it('shows everything for an unknown route', () => {
    expect(new RouteFilterStore().hidden('x:y').size).toBe(0);
  });

  it('remembers the hidden kinds per route key and survives a reload', () => {
    const a = new RouteFilterStore();
    a.set(routeFilterKey('n1', 'e2'), new Set(['refine', 'mine']));
    a.set(routeFilterKey('n1', 'e3'), new Set(['buy']));
    const b = new RouteFilterStore();
    expect([...b.hidden('n1:e2')]).toEqual(['mine', 'refine']);
    expect([...b.hidden('n1:e3')]).toEqual(['buy']);
    expect(b.hidden('n2:e2').size).toBe(0);
  });

  it('drops a key once everything is visible again', () => {
    const s = new RouteFilterStore();
    s.set('k', new Set(['buy']));
    s.set('k', new Set());
    expect(s.all()['k']).toBeUndefined();
  });

  it('ignores junk in storage', () => {
    localStorage.setItem(ROUTE_FILTER_KEY, '{"k":["buy","nope",3],"j":"x"}');
    const s = new RouteFilterStore();
    expect([...s.hidden('k')]).toEqual(['buy']);
    expect(s.hidden('j').size).toBe(0);
    expect(sanitizeKinds('x')).toEqual([]);
  });
});
