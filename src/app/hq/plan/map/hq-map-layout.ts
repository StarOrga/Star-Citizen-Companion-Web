import type { MapNeed, MapPlace, RouteStep } from './hq-map.types';
import { planetIndex, slug } from './hq-route';

/** The schematic stage: one system, star in the middle, planets on rings (plan §4.6). */
export const MAP_W = 640;
export const MAP_H = 280;
export const MAP_CX = 320;
export const MAP_CY = 150;

/** Six categorical need colours (D29 colour = need); see `--hq-need-*` in the map styles. */
export const NEED_PALETTE_SIZE = 6;

export type GlyphSize = 's' | 'm' | 'l';

/** Size = amount (D29), three steps. */
export function qtySize(qty: number): GlyphSize {
  return qty <= 5 ? 's' : qty <= 25 ? 'm' : 'l';
}

export interface PlanetView {
  key: string;
  name: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface NodeView {
  place: MapPlace;
  x: number;
  y: number;
  needs: MapNeed[];
  /** Route ords at this place ("Wie"). */
  ords: number[];
  isStart: boolean;
}

export interface LegView {
  from: { x: number; y: number };
  to: { x: number; y: number };
  leg: 'travel' | 'transport';
  d: string;
}

export interface SystemView {
  key: string;
  name: string;
  isStart: boolean;
  needs: MapNeed[];
  /** Needs ("Was") or route steps ("Wie") in this system — the strip count (D29). */
  steps: number;
  planets: PlanetView[];
  nodes: NodeView[];
  legs: LegView[];
}

/**
 * Lays out the needs (and route) as one schematic stage per system. Systems: the
 * start system first, then most steps, then name. Pure.
 */
export function layoutSystems(
  needs: readonly MapNeed[],
  route: readonly RouteStep[] | null,
  start: MapPlace | null,
): SystemView[] {
  const placed = needs.filter((n): n is MapNeed & { place: MapPlace } => n.place !== null);
  const startKey = start
    ? slug(start.system)
    : route?.length
      ? slug(route[0].place.system)
      : mostCommonSystem(placed.map((n) => n.place));

  const names = new Map<string, string>();
  const places = new Map<string, Map<string, MapPlace>>();
  const addPlace = (p: MapPlace) => {
    const k = slug(p.system);
    if (!names.has(k)) names.set(k, p.system);
    const m = places.get(k) ?? new Map<string, MapPlace>();
    if (!m.has(p.id)) m.set(p.id, p);
    places.set(k, m);
  };
  if (start) addPlace(start);
  placed.forEach((n) => addPlace(n.place));
  route?.forEach((s) => addPlace(s.place));

  const systems = [...places.keys()].map((key): SystemView => {
    const sysPlaces = [...places.get(key)!.values()];
    const sysNeeds = placed.filter((n) => slug(n.place.system) === key);
    const sysRoute = (route ?? []).filter((s) => slug(s.place.system) === key);
    const { planets, pos } = placeNodes(sysPlaces);
    const nodes = sysPlaces.map(
      (p): NodeView => ({
        place: p,
        ...pos.get(p.id)!,
        needs: sysNeeds.filter((n) => n.place.id === p.id),
        ords: sysRoute.filter((s) => s.place.id === p.id).map((s) => s.ord),
        isStart: !!start && start.id === p.id,
      }),
    );
    const legs: LegView[] = [];
    const all = route ?? [];
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1];
      const cur = all[i];
      const a = pos.get(prev.place.id);
      const b = pos.get(cur.place.id);
      if (!a || !b || prev.place.id === cur.place.id || slug(prev.place.system) !== key || slug(cur.place.system) !== key) continue;
      legs.push({ from: a, to: b, leg: cur.leg === 'transport' ? 'transport' : 'travel', d: curve(a, b) });
    }
    return {
      key,
      name: names.get(key)!,
      isStart: key === startKey,
      needs: sysNeeds,
      steps: route ? sysRoute.length : sysNeeds.length,
      planets,
      nodes: nodes.filter((n) => n.needs.length || n.ords.length || n.isStart),
      legs,
    };
  });

  return systems.sort(
    (a, b) => Number(b.isStart) - Number(a.isStart) || b.steps - a.steps || a.name.localeCompare(b.name),
  );
}

/** Colour slot per colour key, in order of first appearance (stable for the needs passed in). */
export function colorSlots(needs: readonly MapNeed[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of needs) if (!m.has(n.colorKey)) m.set(n.colorKey, m.size % NEED_PALETTE_SIZE);
  return m;
}

function mostCommonSystem(places: MapPlace[]): string | null {
  const count = new Map<string, number>();
  for (const p of places) count.set(slug(p.system), (count.get(slug(p.system)) ?? 0) + 1);
  let best: string | null = null;
  for (const [k, n] of count) if (best === null || n > count.get(best)! || (n === count.get(best)! && k < best)) best = k;
  return best;
}

const GOLDEN = 137.508;

function placeNodes(sysPlaces: MapPlace[]): { planets: PlanetView[]; pos: Map<string, { x: number; y: number }> } {
  const known = sysPlaces.map((p) => p.planet).filter((p): p is string => !!p);
  const planetKeys = [...new Set(known.map(slug))].sort((a, b) => {
    const pa = sysPlaces.find((p) => p.planet && slug(p.planet) === a)!;
    const pb = sysPlaces.find((p) => p.planet && slug(p.planet) === b)!;
    return planetIndex(pa, known) - planetIndex(pb, known) || a.localeCompare(b);
  });
  const n = planetKeys.length;
  const planets = planetKeys.map((key, k): PlanetView => {
    const rx = n <= 1 ? 150 : 80 + (k * (250 - 80)) / (n - 1);
    const ry = rx * 0.4;
    const t = ((200 + k * GOLDEN) * Math.PI) / 180;
    const name = sysPlaces.find((p) => p.planet && slug(p.planet) === key)!.planet!;
    return { key, name, rx, ry, x: MAP_CX + rx * Math.cos(t), y: MAP_CY + ry * Math.sin(t) };
  });

  const pos = new Map<string, { x: number; y: number }>();
  for (const pl of planets) {
    const locs = sysPlaces.filter((p) => p.planet && slug(p.planet) === pl.key).sort((a, b) => a.id.localeCompare(b.id));
    locs.forEach((p, j) => {
      const t = ((-90 + j * 70) * Math.PI) / 180;
      const r = locs.length === 1 ? 0 : 34;
      pos.set(p.id, clamp(pl.x + r * Math.cos(t), pl.y + r * 0.7 * Math.sin(t)));
    });
  }
  const free = sysPlaces.filter((p) => !p.planet).sort((a, b) => a.id.localeCompare(b.id));
  free.forEach((p, j) => {
    const t = ((20 + j * GOLDEN) * Math.PI) / 180;
    pos.set(p.id, clamp(MAP_CX + 290 * Math.cos(t), MAP_CY + 112 * Math.sin(t)));
  });
  return { planets, pos };
}

function clamp(x: number, y: number): { x: number; y: number } {
  return { x: Math.round(Math.min(MAP_W - 40, Math.max(40, x))), y: Math.round(Math.min(MAP_H - 30, Math.max(46, y))) };
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 - Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) / 4);
  return `M${a.x} ${a.y} Q ${Math.round(mx)} ${Math.round(my)} ${b.x} ${b.y}`;
}
