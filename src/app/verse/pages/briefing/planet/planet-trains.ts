import type { City, Edge, Vec3 } from './planet-world';
import { slerp } from './planet-world';

/**
 * The trains on the hub planet's night side: 2–5 visible at a time, random
 * start, destination and departure; they accelerate, brake, hold at the
 * station and sometimes run back the way they came. A leg never takes longer
 * than LEG_MAX_MS (the concept asked for "not endlessly long").
 */
export const TRAINS_MIN = 2;
export const TRAINS_MAX = 5;
export const LEG_MIN_MS = 25_000;
export const LEG_MAX_MS = 150_000;
export const DWELL_MIN_MS = 6_000;
export const DWELL_MAX_MS = 28_000;
/** The longest rail link (radians) — scales a leg's duration. */
const LONGEST_EDGE = 0.11;

export interface Train {
  from: number;
  to: number;
  edge: Edge;
  /** Progress along the leg, 0..1. */
  t: number;
  dur: number;
  dwell: number;
  /** Set by the renderer: on screen and on the night side. */
  visible: boolean;
}

/** Ease in-out: the train accelerates out of a station and brakes into the next. */
export const easeLeg = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function legDuration(edge: Edge, rnd: () => number): number {
  const base = LEG_MIN_MS + Math.min(1, edge.w / LONGEST_EDGE) * (LEG_MAX_MS - LEG_MIN_MS);
  return Math.min(LEG_MAX_MS, Math.max(LEG_MIN_MS, base * (0.85 + rnd() * 0.15)));
}

export class TrainNetwork {
  readonly trains: Train[] = [];
  /** How many should be visible right now — re-rolled every minute or two. */
  target = TRAINS_MIN + 1;
  private nextRoll = 0;
  private clock = 0;

  constructor(
    private readonly cities: readonly City[],
    private readonly edges: readonly Edge[],
    private readonly rnd: () => number,
  ) {}

  /** Where a train is right now, on the planet. */
  position(train: Train): Vec3 {
    return slerp(this.cities[train.from].v, this.cities[train.to].v, easeLeg(Math.min(1, train.t)));
  }

  /**
   * Advances by `dt` ms. `canSpawn(edge)` says whether a new train on that
   * edge would be seen (an end on the visible night side) — only those count.
   */
  step(dt: number, canSpawn: (edge: Edge) => boolean): void {
    this.clock += dt;
    if (this.clock >= this.nextRoll) {
      this.target = TRAINS_MIN + Math.floor(this.rnd() * (TRAINS_MAX - TRAINS_MIN + 1));
      this.nextRoll = this.clock + 45_000 + this.rnd() * 75_000;
    }
    const visible = this.trains.filter((t) => t.visible).length;
    if (visible < this.target && this.trains.length < TRAINS_MAX * 2 && this.rnd() < dt / 4000) this.spawn(canSpawn);

    for (let i = this.trains.length - 1; i >= 0; i--) {
      const tr = this.trains[i];
      if (tr.dwell > 0) {
        tr.dwell -= dt;
        continue;
      }
      tr.t += dt / tr.dur;
      if (tr.t < 1) continue;
      // Arrived: retire it, or hold and go on — sometimes straight back.
      const over = this.trains.filter((t) => t.visible).length > this.target;
      const here = this.cities[tr.to];
      if (over || !here.links.length || this.rnd() < 0.15) {
        this.trains.splice(i, 1);
        continue;
      }
      const back = this.rnd() < 0.35 ? here.links.find((l) => l.to === tr.from) : undefined;
      const next = back ?? here.links[Math.floor(this.rnd() * here.links.length)];
      this.leg(tr, tr.to, next.edge);
      tr.dwell = DWELL_MIN_MS + this.rnd() * (DWELL_MAX_MS - DWELL_MIN_MS);
    }
  }

  private spawn(canSpawn: (edge: Edge) => boolean): void {
    const cand = this.edges.filter(canSpawn);
    if (!cand.length) return;
    const edge = cand[Math.floor(this.rnd() * cand.length)];
    const tr = { visible: true } as Train;
    this.leg(tr, this.rnd() < 0.5 ? edge.a : edge.b, edge);
    tr.dwell = 0;
    this.trains.push(tr);
  }

  private leg(tr: Train, from: number, edge: Edge): void {
    tr.from = from;
    tr.to = edge.a === from ? edge.b : edge.a;
    tr.edge = edge;
    tr.t = 0;
    tr.dur = legDuration(edge, this.rnd);
  }
}

/**
 * The aurora: now and then, never on a countable timer — first after
 * 20–60 s, then every 40 s – 2.5 min, each lasting 45–90 s, faded in and out.
 */
export class AuroraClock {
  level = 0;
  private on = false;
  private clock = 0;
  private next: number;
  private end = 0;

  constructor(private readonly rnd: () => number) {
    this.next = 20_000 + rnd() * 40_000;
  }

  step(dt: number): number {
    this.clock += dt;
    if (!this.on && this.clock >= this.next) {
      this.on = true;
      this.end = this.clock + 45_000 + this.rnd() * 45_000;
    } else if (this.on && this.clock >= this.end) {
      this.on = false;
      this.next = this.clock + 40_000 + this.rnd() * 110_000;
    }
    this.level += ((this.on ? 1 : 0) - this.level) * Math.min(1, dt / 6000);
    return this.level;
  }
}
