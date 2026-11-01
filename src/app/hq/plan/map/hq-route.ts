import type { MapNeed, MapPlace, RouteStep } from './hq-map.types';

/**
 * Route builder for the "Wie" view (plan §4.6): the start system first, then
 * nearest stops. Pure. This is the shared stub; the map package replaces the
 * body with the real heuristic and keeps the signature.
 */
export function buildRoute(needs: readonly MapNeed[], start: MapPlace | null): RouteStep[] {
  const placed = needs.filter((n): n is MapNeed & { place: MapPlace } => n.place !== null && n.status !== 'done');
  const bySystem = (p: MapPlace) => (start && p.system === start.system ? 0 : 1);
  const sorted = [...placed].sort((a, b) => bySystem(a.place) - bySystem(b.place) || a.place.id.localeCompare(b.place.id));
  return sorted.map((n, i) => ({
    ord: i + 1,
    kind: n.kind,
    label: n.label,
    place: n.place,
    needIds: [n.id],
    leg: i === 0 ? null : n.kind === 'transport' ? 'transport' : 'travel',
  }));
}
