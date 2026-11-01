import { STEP_KINDS } from '../../../shared/step/sc-step.component';
import type { MapNeed, MapPlace, RouteStep } from './hq-map.types';

/**
 * Route builder for the "Wie" view (plan §4.6): the start system first, then the
 * other systems (most stops first); inside a system nearest-neighbour by the
 * schematic distance (planet order on the ring, then location order). Needs of the
 * same kind at the same place share one stop; a transport need is always its own
 * step with a `transport` leg (D17). Done needs and needs without a place are
 * skipped. Pure.
 */
export function buildRoute(needs: readonly MapNeed[], start: MapPlace | null): RouteStep[] {
  const stops = groupStops(needs);
  if (stops.length === 0) return [];

  const systems = new Map<string, Stop[]>();
  for (const s of stops) {
    const key = slug(s.place.system);
    systems.set(key, [...(systems.get(key) ?? []), s]);
  }
  const startSystem = start ? slug(start.system) : null;
  const order = [...systems.keys()].sort(
    (a, b) =>
      Number(b === startSystem) - Number(a === startSystem) ||
      systems.get(b)!.length - systems.get(a)!.length ||
      a.localeCompare(b),
  );

  const out: Stop[] = [];
  for (const sys of order) {
    const pending = [...systems.get(sys)!];
    let at: MapPlace | null = start && slug(start.system) === sys ? start : null;
    while (pending.length) {
      let best = 0;
      for (let i = 1; i < pending.length; i++) {
        if (compareFrom(at, pending[i], pending[best]) < 0) best = i;
      }
      const [next] = pending.splice(best, 1);
      out.push(next);
      at = next.place;
    }
  }

  return out.map((s, i) => ({
    ord: i + 1,
    kind: s.kind,
    label: s.labels.join(', '),
    place: s.place,
    needIds: s.needIds,
    leg: i === 0 ? null : s.kind === 'transport' ? 'transport' : 'travel',
  }));
}

/** Known orbital order per system; anything unknown sorts after it, alphabetically. */
const PLANET_ORDER: Readonly<Record<string, readonly string[]>> = {
  stanton: ['hurston', 'crusader', 'arccorp', 'microtech'],
  pyro: ['pyro-i', 'monox', 'bloom', 'pyro-iv', 'pyro-v', 'terminus'],
  nyx: ['nyx-i', 'nyx-ii', 'nyx-iii', 'delamar'],
};

/** Ring index of a planet in its system (0 = innermost); a place in open space (planet null) sits outside all rings. */
export function planetIndex(place: MapPlace, known: readonly string[] = []): number {
  if (!place.planet) return 1000;
  const p = slug(place.planet);
  const order = PLANET_ORDER[slug(place.system)] ?? [];
  const i = order.indexOf(p);
  if (i >= 0) return i;
  const extra = [...new Set(known.map(slug))].filter((k) => !order.includes(k)).sort();
  const j = extra.indexOf(p);
  return order.length + (j >= 0 ? j : extra.length);
}

/** Schematic distance: 10 per ring between planets, 1 between two places on one planet, 0 on the same place. */
export function schematicDistance(a: MapPlace, b: MapPlace): number {
  if (slug(a.system) !== slug(b.system)) return 1000;
  if (a.id === b.id) return 0;
  const pa = planetIndex(a);
  const pb = planetIndex(b);
  if (pa === pb && slug(a.planet ?? '') === slug(b.planet ?? '')) return 1;
  return Math.abs(Math.min(pa, 50) - Math.min(pb, 50)) * 10 + 5;
}

export function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface Stop {
  kind: MapNeed['kind'];
  place: MapPlace;
  labels: string[];
  needIds: string[];
}

function groupStops(needs: readonly MapNeed[]): Stop[] {
  const stops: Stop[] = [];
  const byKey = new Map<string, Stop>();
  for (const n of needs) {
    if (!n.place || n.status === 'done') continue;
    const key = `${n.place.id}|${n.kind}`;
    const same = n.kind === 'transport' ? undefined : byKey.get(key);
    if (same) {
      same.labels.push(n.label);
      same.needIds.push(n.id);
      continue;
    }
    const stop: Stop = { kind: n.kind, place: n.place, labels: [n.label], needIds: [n.id] };
    stops.push(stop);
    if (n.kind !== 'transport') byKey.set(key, stop);
  }
  return stops;
}

/** Negative when `a` is the better next stop from `at`: nearer, then lower ring, then place id, then verb order (mine before refine before craft). */
function compareFrom(at: MapPlace | null, a: Stop, b: Stop): number {
  const da = at ? schematicDistance(at, a.place) : planetIndex(a.place);
  const db = at ? schematicDistance(at, b.place) : planetIndex(b.place);
  return (
    da - db ||
    planetIndex(a.place) - planetIndex(b.place) ||
    a.place.id.localeCompare(b.place.id) ||
    STEP_KINDS.indexOf(a.kind) - STEP_KINDS.indexOf(b.kind)
  );
}
