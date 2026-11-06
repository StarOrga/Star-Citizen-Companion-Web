import type { PlanetNetwork } from './planet-bake';
import type { PlanetFrame } from './planet-gl';
import { AuroraClock, Train, TrainNetwork } from './planet-trains';
import { DAY_MS, Vec3, project, seeded } from './planet-world';

/** The planet in its canvas's CSS pixels; measured on the main thread, every frame. */
export interface PlanetView {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly w: number;
  readonly h: number;
}

/** What the component's loop drives: a scene right here, or the same scene in a worker. */
export interface PlanetBackend {
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  /** One animation step: the world moves on, then it is drawn. */
  tick(view: PlanetView, now: number): void;
  /** Draws without moving the world (reduced motion). */
  draw(view: PlanetView, now: number): void;
  /** The loop starts or comes back: the time since its last tick does not count. */
  resume(now: number): void;
  /** The window lost focus: the turn stands until {@link wake}. */
  suspend(): void;
  /** The window is back: the turn carries on from where it stood, with a soft start. */
  wake(now: number): void;
}

/** `unavailable`: the live planet is gone (the CSS one stands in); `restored`: it is back. */
export type PlanetStatus = 'unavailable' | 'restored';

/** The part of PlanetRenderer the scene draws with. */
export interface PlanetDrawer {
  draw(frame: PlanetFrame, dpr: number): void;
  clear(): void;
  dispose(): void;
}

export interface PlanetSceneOptions {
  readonly glCanvas: HTMLCanvasElement | OffscreenCanvas;
  readonly trainCanvas: HTMLCanvasElement | OffscreenCanvas;
  readonly world: PlanetNetwork;
  readonly reduce: boolean;
  /** The renderer of the running context. */
  readonly renderer: PlanetDrawer;
  /** A new renderer with its textures, after a lost context came back. */
  readonly rebuild: () => Promise<PlanetDrawer>;
  readonly onStatus: (status: PlanetStatus) => void;
}

/** How long a lost context may take to come back before the CSS planet stands in. */
export const CONTEXT_LOST_GRACE_MS = 3000;
/** The shader cuts the halo off at this share of the radius (`r > 1.08` in FS). */
const HALO_REACH = 1.08;
/**
 * The canvases stay at CSS pixels: the night texture has 0.42 texels per CSS pixel at
 * 1920 wide, so a denser buffer computes more pixels without showing more detail.
 */
const MAX_DPR = 1;
/** The turn takes this long to come back up to speed after a pause. */
export const WAKE_RAMP_MS = 1500;

type Train2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * The planet's animation, free of the DOM, so that it runs unchanged in the
 * worker and in the main-thread fallback: planet pass at 15 fps (at once when
 * the planet moved on screen), trains at 30 fps, the aurora's clock.
 *
 * Two passes are skipped because they would change no pixel: the train layer
 * while no train is lit (it was cleared and handed to the compositor 30 times
 * a second, full screen, with nothing on it) and the planet pass while disc and
 * halo stand above the canvas. Everything that is drawn is drawn as before.
 */
export class PlanetScene implements PlanetBackend {
  private renderer: PlanetDrawer | null;
  private readonly tctx: Train2D;
  private readonly net: TrainNetwork;
  private readonly aurora: AuroraClock;
  private readonly trails = new Map<Train, Vec3[]>();
  private dpr = 1;
  private last = 0;
  private lastPlanet = 0;
  private lastTrains = 0;
  private lastCy = NaN;
  private time = 0;
  /** The train layer has something on it. */
  private trainsPainted = false;
  /** The planet pass last drew a canvas with nothing on it. */
  private planetBlank = false;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** Wall-clock time the turn did not run (pauses, soft starts), so it never jumps. */
  private clockOffset = 0;
  private suspendedAt: number | null = null;
  private wokenAt: number | null = null;

  constructor(private readonly o: PlanetSceneOptions) {
    this.renderer = o.renderer;
    this.tctx = (o.trainCanvas as HTMLCanvasElement).getContext('2d')!;
    const rnd = seeded(Date.now() & 0xffff);
    this.net = new TrainNetwork(o.world.cities, o.world.edges, rnd);
    this.aurora = new AuroraClock(rnd);
    o.glCanvas.addEventListener('webglcontextlost', this.onLost);
    o.glCanvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.dpr = Math.min(MAX_DPR, devicePixelRatio || 1);
    for (const c of [this.o.glCanvas, this.o.trainCanvas]) {
      c.width = Math.round(cssWidth * this.dpr);
      c.height = Math.round(cssHeight * this.dpr);
    }
    this.lastPlanet = 0;
    this.planetBlank = false;
    this.trainsPainted = false;
  }

  resume(now: number): void {
    this.last = now;
  }

  suspend(): void {
    this.suspendedAt ??= Date.now();
  }

  wake(now: number): void {
    this.last = now;
    if (this.suspendedAt === null) return;
    const t = Date.now();
    this.clockOffset += this.rampLag(this.suspendedAt) + (t - this.suspendedAt);
    this.suspendedAt = null;
    this.wokenAt = t;
  }

  tick(v: PlanetView, now: number): void {
    const dt = Math.min(100, now - this.last);
    this.last = now;
    this.time += dt / 1000;
    const rot = this.rot(), { cities } = this.o.world;
    this.net.step(dt, (e) => [cities[e.a].v, cities[e.b].v].some((c) => {
      const p = project(c, rot, v.cx, v.cy, v.r);
      return p.z > 0.05 && p.ndl < -0.02 && p.y > 0 && p.y < v.h;
    }));
    this.aurora.step(dt);
    this.draw(v, now);
  }

  draw(v: PlanetView, now: number): void {
    if (!this.renderer) return; // context lost
    if (v.r <= 0 || v.cy - v.r > v.h) return; // planet below the viewport
    const rot = this.rot();
    if (now - this.lastPlanet > 66 || v.cy !== this.lastCy) {
      this.lastPlanet = now;
      this.lastCy = v.cy;
      const above = v.cy + v.r * HALO_REACH < 0;
      if (!above || !this.planetBlank) {
        this.renderer.draw({ cx: v.cx, cy: v.cy, r: v.r, rot, time: this.time, aurora: this.aurora.level }, this.dpr);
        this.planetBlank = above;
      }
    }
    if (this.o.reduce || now - this.lastTrains < 33) return;
    this.lastTrains = now;
    this.drawTrains(v, rot);
  }

  /** Empties both canvases: the planet is leaving, and must not stand there when it comes back. */
  clear(): void {
    this.renderer?.clear();
    this.wipeTrains();
    this.planetBlank = false;
    // The next visit starts from the clock again: every visit shows another part of the world.
    this.clockOffset = 0;
    this.suspendedAt = this.wokenAt = null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.lostTimer !== null) clearTimeout(this.lostTimer);
    this.o.glCanvas.removeEventListener('webglcontextlost', this.onLost);
    this.o.glCanvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.renderer?.dispose();
    this.renderer = null;
  }

  private rot(): number {
    const t = this.suspendedAt ?? Date.now();
    const ms = t - this.clockOffset - this.rampLag(t);
    return ((((ms % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS) * Math.PI * 2;
  }

  /** How far the soft start has fallen behind at `t`: the speed rises linearly from 0 to 1 over the ramp. */
  private rampLag(t: number): number {
    if (this.wokenAt === null) return 0;
    const e = Math.min(WAKE_RAMP_MS, t - this.wokenAt);
    return (e * e) / (2 * WAKE_RAMP_MS);
  }

  private wipeTrains(): void {
    this.tctx.setTransform(1, 0, 0, 1, 0, 0);
    this.tctx.clearRect(0, 0, this.o.trainCanvas.width, this.o.trainCanvas.height);
    this.trainsPainted = false;
  }

  private drawTrains(v: PlanetView, rot: number): void {
    const { tctx, net, trails } = this;
    let lit = false;
    const wipe = () => {
      tctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      tctx.clearRect(0, 0, v.w, v.h);
    };
    for (const tr of net.trains) {
      const trail = trails.get(tr) ?? [];
      trail.push(net.position(tr));
      if (trail.length > 26) trail.shift();
      trails.set(tr, trail);
      const p = project(trail[trail.length - 1], rot, v.cx, v.cy, v.r);
      const night = Math.max(0, Math.min(1, -p.ndl / 0.08)), fore = Math.max(0, Math.min(1, p.z / 0.12));
      tr.visible = p.z > 0.05 && night > 0.2 && p.y > 0 && p.y < v.h;
      const a = night * fore;
      if (a <= 0.01) continue;
      if (!lit) wipe();
      lit = true;
      for (let k = 0; k < trail.length - 1; k++) {
        const q = project(trail[k], rot, v.cx, v.cy, v.r);
        tctx.fillStyle = `rgba(255,214,160,${(0.1 * k * a) / trail.length})`;
        tctx.fillRect(q.x - 0.5, q.y - 0.5, 1, 1);
      }
      const glow = tctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 3.2);
      glow.addColorStop(0, `rgba(255,236,200,${0.55 * a})`);
      glow.addColorStop(1, 'rgba(255,200,140,0)');
      tctx.fillStyle = glow;
      tctx.beginPath();
      tctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      tctx.fill();
      tctx.fillStyle = `rgba(255,250,236,${0.9 * a})`;
      tctx.fillRect(p.x - 0.6, p.y - 0.6, 1.2, 1.2);
    }
    // Last frame's train has gone dark: its pixels still have to go, once.
    if (this.trainsPainted && !lit) wipe();
    this.trainsPainted = lit;
    for (const tr of trails.keys()) if (!net.trains.includes(tr)) trails.delete(tr);
  }

  private readonly onLost = (e: Event): void => {
    e.preventDefault(); // without this the browser never restores the context
    this.renderer = null;
    this.wipeTrains();
    this.lostTimer ??= setTimeout(() => this.o.onStatus('unavailable'), CONTEXT_LOST_GRACE_MS);
  };

  private readonly onRestored = (): void => {
    this.o.rebuild().then((renderer) => {
      if (this.disposed) return renderer.dispose();
      this.renderer = renderer;
      this.lastPlanet = 0;
      this.planetBlank = false;
      if (this.lostTimer !== null) clearTimeout(this.lostTimer);
      this.lostTimer = null;
      this.o.onStatus('restored');
    }).catch(() => this.o.onStatus('unavailable'));
  };
}
