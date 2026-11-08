import type { MapPlace } from './hq-map.types';
import { schematicDistance, slug } from './hq-route';

/** How far a place is from the reader, as words: only the schematic map is known, no real distance. */
export type PlaceTier = 'here' | 'body' | 'system' | 'far' | 'unknown';

interface Home {
  system: string;
  planet: string | null;
}

const STANTON_PLANETS = ['Hurston', 'Crusader', 'ArcCorp', 'microTech'];

/** Bodies and landing zones a typed or logged name can carry, compact-keyed (no spaces, lower case). */
const KNOWN: Readonly<Record<string, Home>> = {
  hurston: { system: 'Stanton', planet: 'Hurston' },
  lorville: { system: 'Stanton', planet: 'Hurston' },
  everusharbor: { system: 'Stanton', planet: 'Hurston' },
  arial: { system: 'Stanton', planet: 'Hurston' },
  aberdeen: { system: 'Stanton', planet: 'Hurston' },
  magda: { system: 'Stanton', planet: 'Hurston' },
  ita: { system: 'Stanton', planet: 'Hurston' },
  crusader: { system: 'Stanton', planet: 'Crusader' },
  orison: { system: 'Stanton', planet: 'Crusader' },
  seraphim: { system: 'Stanton', planet: 'Crusader' },
  cellin: { system: 'Stanton', planet: 'Crusader' },
  daymar: { system: 'Stanton', planet: 'Crusader' },
  yela: { system: 'Stanton', planet: 'Crusader' },
  grimhex: { system: 'Stanton', planet: 'Crusader' },
  arccorp: { system: 'Stanton', planet: 'ArcCorp' },
  area18: { system: 'Stanton', planet: 'ArcCorp' },
  baijini: { system: 'Stanton', planet: 'ArcCorp' },
  lyria: { system: 'Stanton', planet: 'ArcCorp' },
  wala: { system: 'Stanton', planet: 'ArcCorp' },
  microtech: { system: 'Stanton', planet: 'microTech' },
  newbabbage: { system: 'Stanton', planet: 'microTech' },
  porttressler: { system: 'Stanton', planet: 'microTech' },
  calliope: { system: 'Stanton', planet: 'microTech' },
  clio: { system: 'Stanton', planet: 'microTech' },
  euterpe: { system: 'Stanton', planet: 'microTech' },
  ruinstation: { system: 'Pyro', planet: null },
  checkmate: { system: 'Pyro', planet: null },
  orbituary: { system: 'Pyro', planet: null },
  levski: { system: 'Nyx', planet: 'Delamar' },
  delamar: { system: 'Nyx', planet: 'Delamar' },
};

const compact = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function place(system: string, planet: string | null, location: string): MapPlace {
  return {
    id: [slug(system), planet ? slug(planet) : null, compact(location)].filter(Boolean).join('/'),
    system,
    planet,
    location,
  };
}

/**
 * Where a name stands on the schematic map: a game id (`Stanton3_Area18`, with the planet in its
 * number), or a plain name the player typed ("Area 18", "Lorville CBD"). Null for a name nothing
 * is known about ("Mein Schiff") - that place keeps its entry but has no distance. Pure.
 */
export function placeOfName(name: string, system: string | null = null): MapPlace | null {
  const raw = name.trim();
  if (!raw) return null;
  const game = /^(stanton|pyro|nyx|terra)(\d*)[a-z]?_(.+)$/i.exec(raw);
  if (game) {
    const sys = game[1][0].toUpperCase() + game[1].slice(1).toLowerCase();
    const location = game[3].replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    const planet = sys === 'Stanton' ? (STANTON_PLANETS[Number(game[2]) - 1] ?? null) : null;
    return place(sys, planet, location);
  }
  const key = compact(raw);
  const hit = Object.keys(KNOWN).find((k) => key.includes(k));
  if (hit) return place(system ?? KNOWN[hit].system, KNOWN[hit].planet, raw);
  return system ? place(system, null, raw) : null;
}

/**
 * Places a reader can name for a line without a merchant (W5.5): the trading hubs the schematic map knows.
 * Display name, system and planet; ids are the same as `placeOfName` makes, so the route treats them alike.
 */
const PICKABLE: readonly (readonly [string, string])[] = [
  ['Stanton', 'Lorville'],
  ['Stanton', 'Area18'],
  ['Stanton', 'Orison'],
  ['Stanton', 'New Babbage'],
  ['Stanton', 'Everus Harbor'],
  ['Stanton', 'Baijini Point'],
  ['Stanton', 'Seraphim Station'],
  ['Stanton', 'Port Tressler'],
  ['Stanton', 'Grim HEX'],
  ['Pyro', 'Ruin Station'],
  ['Pyro', 'Checkmate'],
  ['Pyro', 'Orbituary'],
  ['Nyx', 'Levski'],
];

export function pickablePlaces(): MapPlace[] {
  return PICKABLE.flatMap(([system, location]) => placeOfName(location, system) ?? []);
}

/** Sort key of `to` seen from `from`; `Infinity` when either end is unknown. */
export function placeDistance(from: MapPlace | null, to: MapPlace | null): number {
  return from && to ? schematicDistance(from, to) : Infinity;
}

/** The word for {@link placeDistance}. */
export function placeTier(from: MapPlace | null, to: MapPlace | null): PlaceTier {
  if (!from || !to) return 'unknown';
  if (from.id === to.id) return 'here';
  if (slug(from.system) !== slug(to.system)) return 'far';
  return from.planet && slug(from.planet) === slug(to.planet ?? '') ? 'body' : 'system';
}
