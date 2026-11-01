import type { MapPlace } from './map/hq-map.types';

/** One node of the System › Planet › Ort tree (D26). `leaves` are the {@link MapPlace} ids below it. */
export interface PlaceNode {
  /** `system`, `system/planet` or the place id. */
  id: string;
  label: string;
  depth: 0 | 1 | 2;
  leaves: readonly string[];
  children: readonly PlaceNode[];
}

const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-');

/** Build the tree from the places of the needs; a place without a planet hangs directly under its system. */
export function buildPlaceTree(places: readonly MapPlace[]): PlaceNode[] {
  interface PlanetAcc { label: string; places: MapPlace[] }
  interface SystemAcc { label: string; planets: Map<string, PlanetAcc>; direct: MapPlace[] }
  const systems = new Map<string, SystemAcc>();
  for (const p of places) {
    const s: SystemAcc = systems.get(p.system) ?? { label: p.system, planets: new Map<string, PlanetAcc>(), direct: [] };
    systems.set(p.system, s);
    if (p.planet) {
      const pl = s.planets.get(p.planet) ?? { label: p.planet, places: [] };
      s.planets.set(p.planet, pl);
      if (!pl.places.some((x) => x.id === p.id)) pl.places.push(p);
    } else if (!s.direct.some((x) => x.id === p.id)) {
      s.direct.push(p);
    }
  }
  const leaf = (p: MapPlace, depth: 1 | 2): PlaceNode => ({ id: p.id, label: p.location, depth, leaves: [p.id], children: [] });
  const byLabel = (a: PlaceNode, b: PlaceNode) => a.label.localeCompare(b.label);
  return [...systems.entries()]
    .map(([sysKey, s]): PlaceNode => {
      const planets = [...s.planets.entries()].map(([plKey, pl]): PlaceNode => {
        const kids = pl.places.map((p) => leaf(p, 2)).sort(byLabel);
        return { id: `${slug(sysKey)}/${slug(plKey)}`, label: pl.label, depth: 1, leaves: kids.flatMap((k) => k.leaves), children: kids };
      });
      const direct = s.direct.map((p) => leaf(p, 1));
      const children = [...planets, ...direct].sort(byLabel);
      return { id: slug(sysKey), label: s.label, depth: 0, leaves: children.flatMap((c) => c.leaves), children };
    })
    .sort(byLabel);
}

/** Tri-state fraction of a node: selected leaves / all leaves. */
export function nodeFraction(node: PlaceNode, selected: ReadonlySet<string>): number {
  return node.leaves.length === 0 ? 0 : node.leaves.filter((l) => selected.has(l)).length / node.leaves.length;
}

/** Click on a node: anything but fully selected selects all its leaves, fully selected clears them. */
export function toggleNode(node: PlaceNode, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const full = node.leaves.length > 0 && node.leaves.every((l) => selected.has(l));
  for (const l of node.leaves) {
    if (full) next.delete(l);
    else next.add(l);
  }
  return next;
}

/** Keep nodes whose label matches or that have a matching descendant (a match keeps its whole subtree). */
export function filterTree(nodes: readonly PlaceNode[], query: string): PlaceNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...nodes];
  const walk = (n: PlaceNode): PlaceNode | null => {
    if (n.label.toLowerCase().includes(q)) return n;
    const kids = n.children.map(walk).filter((k): k is PlaceNode => k !== null);
    return kids.length ? { ...n, children: kids, leaves: kids.flatMap((k) => k.leaves) } : null;
  };
  return nodes.map(walk).filter((n): n is PlaceNode => n !== null);
}

/** Flatten the visible rows of the tree (open nodes only), for rendering and keyboard order. */
export function visibleRows(nodes: readonly PlaceNode[], open: ReadonlySet<string>, forceOpen: boolean): PlaceNode[] {
  const out: PlaceNode[] = [];
  const walk = (n: PlaceNode) => {
    out.push(n);
    if (n.children.length && (forceOpen || open.has(n.id))) n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}
