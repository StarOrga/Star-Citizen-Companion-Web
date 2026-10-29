import { AuroraClock, DWELL_MAX_MS, LEG_MAX_MS, LEG_MIN_MS, TRAINS_MAX, TRAINS_MIN, TrainNetwork, easeLeg, legDuration } from './planet-trains';
import { DAY_MS, PlanetWorld, SUN, angle, buildWorldSync, project, seeded, slerp, sph } from './planet-world';

describe('Verse planet — world', () => {
  let world: PlanetWorld;
  beforeAll(() => (world = buildWorldSync(1337)));

  it('is the same world for the same seed', () => {
    const again = buildWorldSync(1337);
    expect(again.cities.length).toBe(world.cities.length);
    expect(again.cities[17].lat).toBe(world.cities[17].lat);
    expect(again.edges.length).toBe(world.edges.length);
  });

  it('has a populated planet with a rail network between neighbours', () => {
    expect(world.cities.length).toBeGreaterThan(600);
    expect(world.edges.length).toBeGreaterThan(world.cities.length * 0.5);
    for (const e of world.edges) expect(e.w).toBeLessThan(0.11);
  });

  it('keeps the cold north thinly settled', () => {
    // Cities per unit of area (a latitude band's area ∝ sin hi − sin lo).
    const density = (lo: number, hi: number) =>
      world.cities.filter((c) => c.lat >= lo && c.lat < hi).length / (Math.sin(hi) - Math.sin(lo));
    expect(density(0.95, 1.25)).toBeLessThan(density(-0.5, 0.5) / 4);
  });

  it('turns once per DAY_MS: half a turn carries a point from the front to the back', () => {
    expect(DAY_MS).toBe(30 * 60 * 1000);
    const p = sph(0, Math.PI / 2); // on the equator, facing the viewer at rot 0
    expect(project(p, 0, 0, 0, 1).z).toBeGreaterThan(0.5);
    expect(project(p, Math.PI, 0, 0, 1).z).toBeLessThan(-0.5);
    expect(project(p, 2 * Math.PI, 0, 0, 1).z).toBeCloseTo(project(p, 0, 0, 0, 1).z, 9);
  });

  it('keeps day and night fixed to the sun, whatever the turn', () => {
    // Light depends only on where a point stands in view (screen) space.
    for (const rot of [0, 1.3, 4]) {
      const p = project(sph(0.3, 1), rot, 0, 0, 1);
      expect(p.ndl).toBeCloseTo(p.x * SUN[0] - p.y * SUN[1] + p.z * SUN[2], 9);
    }
  });

  it('interpolates along the great circle', () => {
    const a = sph(0, 0), b = sph(0, 0.5);
    expect(angle(slerp(a, b, 0.5), a)).toBeCloseTo(0.25, 5);
  });
});

describe('Verse planet — trains', () => {
  const world = buildWorldSync(42);

  it('never takes longer than LEG_MAX_MS for a leg', () => {
    const rnd = seeded(3);
    for (const e of world.edges) {
      const d = legDuration(e, rnd);
      expect(d).toBeGreaterThanOrEqual(LEG_MIN_MS);
      expect(d).toBeLessThanOrEqual(LEG_MAX_MS);
    }
    expect(LEG_MAX_MS).toBeLessThan(5 * 60 * 1000);
  });

  it('accelerates out of a station and brakes into the next', () => {
    expect(easeLeg(0)).toBe(0);
    expect(easeLeg(1)).toBe(1);
    expect(easeLeg(0.1)).toBeLessThan(0.1);
    expect(easeLeg(0.9)).toBeGreaterThan(0.9);
  });

  it('keeps 2–5 trains running, holds them at stations and sends some back', () => {
    const net = new TrainNetwork(world.cities, world.edges, seeded(9));
    let dwelled = false, reversed = false, maxRunning = 0;
    const lastFrom = new Map<object, number>();
    for (let t = 0; t < 30 * 60 * 1000; t += 250) {
      net.step(250, () => true);
      expect(net.target).toBeGreaterThanOrEqual(TRAINS_MIN);
      expect(net.target).toBeLessThanOrEqual(TRAINS_MAX);
      maxRunning = Math.max(maxRunning, net.trains.length);
      for (const tr of net.trains) {
        if (tr.dwell > 0) {
          dwelled = true;
          expect(tr.dwell).toBeLessThanOrEqual(DWELL_MAX_MS);
        }
        const prev = lastFrom.get(tr);
        if (prev !== undefined && prev !== tr.from && tr.to === prev) reversed = true;
        lastFrom.set(tr, tr.from);
      }
    }
    expect(maxRunning).toBeGreaterThanOrEqual(TRAINS_MIN);
    expect(dwelled).toBeTrue();
    expect(reversed).toBeTrue();
  });
});

describe('Verse planet — aurora', () => {
  it('shows up now and then and fades back out', () => {
    const a = new AuroraClock(seeded(5));
    let on = 0, peaks = 0, wasHigh = false;
    for (let t = 0; t < 20 * 60 * 1000; t += 1000) {
      const l = a.step(1000);
      if (l > 0.5) on++;
      if (l > 0.9 && !wasHigh) peaks++;
      wasHigh = l > 0.9;
    }
    expect(peaks).toBeGreaterThanOrEqual(4);
    expect(on).toBeLessThan(20 * 60 * 0.75);
  });
});
