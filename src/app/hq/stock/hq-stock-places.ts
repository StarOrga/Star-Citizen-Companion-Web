import { formatLocationName } from '../now/hq-live.util';

/**
 * The place catalogue of the Bestand place filter (I10, `q-places=grouped`): every landing zone and station a
 * player can store things at, grouped by system and planet. Deterministic like the chips (F4): the list never
 * shrinks to the places the player holds; places only the player's data names join under their system (or
 * "other") so nothing is lost.
 */
export interface PlaceInfo {
  /** The stored location string (the filter value). */
  readonly id: string;
  /** Display name ("Area18"). */
  readonly name: string;
  /** System ("Stanton"), null when unknown. */
  readonly system: string | null;
  /** Planet / moon / Lagrange group ("ArcCorp"), null when unknown. */
  readonly body: string | null;
}

/** [system, body, place] — the major storage places of the current patch. */
const CATALOGUE: readonly (readonly [string, string, string])[] = [
  ['Stanton', 'ArcCorp', 'Area18'],
  ['Stanton', 'ArcCorp', 'Baijini Point'],
  ['Stanton', 'Crusader', 'Orison'],
  ['Stanton', 'Crusader', 'Seraphim Station'],
  ['Stanton', 'Hurston', 'Lorville'],
  ['Stanton', 'Hurston', 'Everus Harbor'],
  ['Stanton', 'microTech', 'New Babbage'],
  ['Stanton', 'microTech', 'Port Tressler'],
  ['Stanton', 'Lagrange', 'Grim HEX'],
  ['Pyro', 'Pyro', 'Ruin Station'],
  ['Pyro', 'Pyro', 'Checkmate'],
  ['Pyro', 'Pyro', 'Orbituary'],
  ['Pyro', 'Pyro', 'Starlight Service Station'],
  ['Nyx', 'Delamar', 'Levski'],
];

/** Body of the `StantonN_` prefix the game puts in front of a place's class name. */
const STANTON_BODIES: Readonly<Record<string, string>> = { '1': 'Hurston', '2': 'Crusader', '3': 'ArcCorp', '4': 'microTech' };
const SYSTEMS: Readonly<Record<string, string>> = { stanton: 'Stanton', pyro: 'Pyro', nyx: 'Nyx', terra: 'Terra' };

const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** System and body of a stored location string, from the catalogue or the class-name prefix. */
export function placeInfo(location: string): PlaceInfo {
  const name = formatLocationName(location);
  const f = fold(name);
  const hit = CATALOGUE.find(([, , p]) => fold(p) === f) ?? CATALOGUE.find(([, , p]) => f.includes(fold(p)));
  if (hit) return { id: location, name, system: hit[0], body: hit[1] };
  const m = /^(stanton|pyro|nyx|terra)(\d*)/i.exec(location.trim());
  if (m) {
    const system = SYSTEMS[m[1].toLowerCase()];
    const body = system === 'Stanton' ? (STANTON_BODIES[m[2]] ?? null) : null;
    return { id: location, name, system, body };
  }
  return { id: location, name, system: null, body: null };
}

/** "Area18 · Stanton" style label parts for a bay or a select trigger. */
export function placeSub(p: PlaceInfo): string | null {
  return p.body && p.body !== p.system ? p.body : p.system;
}

export interface PlaceGroup {
  readonly system: string | null;
  readonly bodies: readonly { readonly body: string | null; readonly places: readonly (PlaceInfo & { readonly amount: number })[] }[];
}

/**
 * The grouped place list: catalogue + every place the data names, by system then body, each with its amount
 * under the current filter (`amounts`, keyed by location id). Catalogue places the player has data for use the
 * stored id so the filter matches the rows. Systems in catalogue order, unknown last; places by amount, then name.
 */
export function groupPlaces(known: readonly string[], amounts: ReadonlyMap<string, number>, search = ''): PlaceGroup[] {
  const byFold = new Map<string, PlaceInfo>();
  for (const [system, body, place] of CATALOGUE) byFold.set(fold(place), { id: place, name: place, system, body });
  for (const loc of known) {
    const info = placeInfo(loc);
    byFold.set(fold(info.name), info);
  }
  const needle = fold(search);
  const systems = new Map<string | null, Map<string | null, (PlaceInfo & { amount: number })[]>>();
  for (const info of byFold.values()) {
    if (needle && !fold(`${info.name}${info.body ?? ''}${info.system ?? ''}`).includes(needle)) continue;
    const s = systems.get(info.system) ?? new Map();
    systems.set(info.system, s);
    const list = s.get(info.body) ?? [];
    s.set(info.body, list);
    list.push({ ...info, amount: amounts.get(info.id) ?? 0 });
  }
  const order = (s: string | null): number => {
    const i = CATALOGUE.findIndex(([sys]) => sys === s);
    return i < 0 ? 999 : i;
  };
  return [...systems.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || String(a[0]).localeCompare(String(b[0])))
    .map(([system, bodies]) => ({
      system,
      bodies: [...bodies.entries()].map(([body, places]) => ({
        body,
        places: places.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
      })),
    }));
}
