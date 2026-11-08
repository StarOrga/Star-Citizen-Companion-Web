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

/** The aurora never goes fully dark (admin feedback #324): its faintest phase. */
export const AURORA_FLOOR = 0.22;
/** The drifting base tops out here; only a burst lifts it to full strength. */
export const AURORA_BASE_MAX = 0.65;
/** Periods (ms) of the slow drift — incommensurate, so it never repeats visibly. */
const AURORA_DRIFT_MS = [83_000, 197_000, 461_000] as const;

/**
 * The aurora's resting intensity at `ms`: drifts smoothly between
 * AURORA_FLOOR (weak) and AURORA_BASE_MAX (strong) over minutes. `phases`
 * (radians, one per drift period) give every visit another pattern.
 */
export function auroraBase(ms: number, phases: readonly number[]): number {
  let w = 0;
  for (let i = 0; i < AURORA_DRIFT_MS.length; i++) {
    w += Math.sin((ms / AURORA_DRIFT_MS[i]) * Math.PI * 2 + (phases[i] ?? 0));
  }
  const k = (w / AURORA_DRIFT_MS.length + 1) / 2; // 0..1
  const eased = k * k * (3 - 2 * k);
  return AURORA_FLOOR + (AURORA_BASE_MAX - AURORA_FLOOR) * eased;
}

/** Base plus a burst (0..1) on top: never below the floor, never above 1. */
export function auroraLevel(base: number, burst: number): number {
  const b = Math.min(1, Math.max(0, burst));
  return Math.min(1, Math.max(AURORA_FLOOR, base + (1 - base) * b));
}

/**
 * The aurora: always there, drifting between weaker and stronger phases
 * (auroraBase), and now and then a strong burst on top, never on a countable
 * timer — first after 15–40 s, then every 30 s – 1.5 min, each lasting
 * 30–75 s, faded in and out.
 */
export class AuroraClock {
  level: number;
  private burst = 0;
  private on = false;
  private clock = 0;
  private next: number;
  private end = 0;
  private readonly phases: number[];

  constructor(private readonly rnd: () => number) {
    this.phases = AURORA_DRIFT_MS.map(() => rnd() * Math.PI * 2);
    this.next = 15_000 + rnd() * 25_000;
    this.level = auroraLevel(auroraBase(0, this.phases), 0);
  }

  step(dt: number): number {
    this.clock += dt;
    if (!this.on && this.clock >= this.next) {
      this.on = true;
      this.end = this.clock + 30_000 + this.rnd() * 45_000;
    } else if (this.on && this.clock >= this.end) {
      this.on = false;
      this.next = this.clock + 30_000 + this.rnd() * 60_000;
    }
    this.burst += ((this.on ? 1 : 0) - this.burst) * Math.min(1, dt / 6000);
    this.level = auroraLevel(auroraBase(this.clock, this.phases), this.burst);
    return this.level;
  }
}
