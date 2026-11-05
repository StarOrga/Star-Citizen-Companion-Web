import { City, Edge, PlanetWorld, angle, sph } from './planet-world';

/**
 * The baked planet (scripts/bake-planet.mjs → public/planet/): the same world
 * the generator builds from the fixed seed, as lossless textures plus the rail
 * network's cities — so a visit downloads it once instead of computing it on
 * the main thread (~1.1 s on a fast desktop, seconds on a phone).
 */

/** Where the bake lives, relative to the document base (`<base href="/">`). */
export const PLANET_ASSET_DIR = 'planet/';

/** What the live planet needs at runtime: the network for the trains and the three textures. */
export type PlanetNetwork = Pick<PlanetWorld, 'cities' | 'edges'>;

export interface PlanetSources {
  readonly world: PlanetNetwork;
  readonly day: TexImageSource;
  readonly night: TexImageSource;
  readonly cloud: TexImageSource;
}

/** world.json as the bake writes it: exact coordinates, edges in creation order. */
export interface BakedWorld {
  readonly v: 1;
  readonly seed: number;
  readonly cities: readonly (readonly [number, number, number])[];
  readonly edges: readonly (readonly [number, number])[];
}

/** The night texture's width for this screen — the same rule the generator path uses. */
export function nightSize(viewportWidth: number): 2048 | 4096 {
  return viewportWidth >= 1000 ? 4096 : 2048;
}

/**
 * Rebuilds the cities and the rail network exactly as `generateWorld` left
 * them: positions from the stored angles, each edge's length recomputed from
 * the same vectors, and every city's link list filled in edge creation order
 * (which is the order the generator pushed them in).
 */
export function worldFromBake(raw: BakedWorld): PlanetNetwork {
  if (raw?.v !== 1 || !Array.isArray(raw.cities) || !Array.isArray(raw.edges)) throw new Error('planet: unknown world format');
  const cities: City[] = raw.cities.map(([lat, lon, size]) => ({ lat, lon, size, v: sph(lat, lon), links: [] }));
  const edges: Edge[] = [];
  for (const [a, b] of raw.edges) {
    const from = cities[a], to = cities[b];
    if (!from || !to) throw new Error('planet: edge points to a missing city');
    const edge: Edge = { a, b, w: angle(from.v, to.v) };
    edges.push(edge);
    from.links.push({ to: b, edge });
    to.links.push({ to: a, edge });
  }
  return { cities, edges };
}

/**
 * Loads the baked planet: four requests in parallel, images decoded off the
 * main thread (`createImageBitmap`) with no colour conversion or alpha
 * premultiplication — byte for byte what the generator painted. Rejects on any
 * failure; the caller then falls back to generating the world itself.
 */
export async function loadBakedPlanet(size: 2048 | 4096, base: string = document.baseURI): Promise<PlanetSources> {
  if (typeof createImageBitmap !== 'function') throw new Error('planet: createImageBitmap unavailable');
  const url = (file: string) => new URL(PLANET_ASSET_DIR + file, base).href;
  const get = async (file: string) => {
    const res = await fetch(url(file));
    if (!res.ok) throw new Error(`planet: ${file} answered ${res.status}`);
    return res;
  };
  const bitmap = async (file: string) =>
    createImageBitmap(await (await get(file)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const [world, day, night, cloud] = await Promise.all([
    get('world.json').then(async (r) => worldFromBake((await r.json()) as BakedWorld)),
    bitmap('day.webp'),
    bitmap(`night-${size}.webp`),
    bitmap('cloud.webp'),
  ]);
  return { world, day, night, cloud };
}
