import baked from '../../../../../../public/planet/world.json';
import { BakedWorld, nightSize, worldFromBake } from './planet-assets';
import { PlanetWorld, buildWorldSync } from './planet-world';

/**
 * The baked planet must be the generated one, not a look-alike: the trains run
 * on this network, and the night texture's lit corridors were painted from it.
 * `node scripts/bake-planet.mjs --check` (prebuild) catches a generator change
 * that was not re-baked; this spec catches a bake that does not round-trip.
 */
describe('Verse planet — baked assets', () => {
  let world: PlanetWorld;
  beforeAll(() => (world = buildWorldSync(1337)));

  it('rebuilds the generated cities exactly', () => {
    const net = worldFromBake(baked as unknown as BakedWorld);
    expect(net.cities.length).toBe(world.cities.length);
    net.cities.forEach((c, i) => {
      const g = world.cities[i];
      expect([c.lat, c.lon, c.size]).toEqual([g.lat, g.lon, g.size]);
      expect(c.v).toEqual(g.v);
      expect(c.links.map((l) => [l.to, l.edge.a, l.edge.b])).toEqual(g.links.map((l) => [l.to, l.edge.a, l.edge.b]));
    });
  });

  it('rebuilds the rail network exactly, in creation order', () => {
    const net = worldFromBake(baked as unknown as BakedWorld);
    expect(net.edges.map((e) => [e.a, e.b, e.w])).toEqual(world.edges.map((e) => [e.a, e.b, e.w]));
  });

  it('refuses a world it does not understand', () => {
    expect(() => worldFromBake({ v: 2 } as unknown as BakedWorld)).toThrow();
    expect(() => worldFromBake({ v: 1, seed: 1, cities: [], edges: [[0, 1]] })).toThrow();
  });

  it('picks the night texture by the same viewport rule as the generator path', () => {
    expect(nightSize(1440)).toBe(4096);
    expect(nightSize(1000)).toBe(4096);
    expect(nightSize(999)).toBe(2048);
    expect(nightSize(390)).toBe(2048);
  });
});
