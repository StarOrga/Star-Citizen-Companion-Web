import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, afterNextRender, inject, input, output, signal } from '@angular/core';
import { logWarn } from '../../../core/log';
import { PLANET_SOURCES, PlanetNetwork, PlanetSources, nightSize } from './planet/planet-assets';
import { PlanetRenderer } from './planet/planet-gl';
import { paintDay, paintNight } from './planet/planet-textures';
import { AuroraClock, Train, TrainNetwork } from './planet/planet-trains';
import { DAY_MS, Vec3, generateWorld, project, seeded } from './planet/planet-world';

/**
 * The hub's big planet, live (concept 2026-10-29 "Verse-Planet Nachtseite"):
 * a WebGL sphere that turns once in 30 minutes under a fixed sun, with city
 * lights on its night side, 2–5 trains on the rail network and an aurora now
 * and then. It draws into a sticky, viewport-tall canvas inside the stage's
 * `.world-clip` and takes its geometry from the CSS planet (`anchor`). That one
 * is invisible: it is shown only when no live planet can come (no WebGL). While
 * the live one loads, the stars show — there is never a second, plainer planet
 * underneath it (owner feedback 2026-11-04: it showed through while scrolling).
 *
 * The turn follows the wall clock, so every visit shows another part of the
 * world. Under reduced motion the planet is drawn once and stands still.
 */
@Component({
  selector: 'sc-briefing-planet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[class.on]': 'ready()', '[class.instant]': 'instant() || snap()' },
  template: '<canvas class="bp-gl"></canvas><canvas class="bp-trains"></canvas>',
  styles: [`
    :host { position: sticky; top: 0; display: block; width: 100%; height: 100vh; height: 100dvh; pointer-events: none; opacity: 0; }
    /* It slides in from below the moment it stands — whenever that is; the entrance never waits
       for it (owner brief 2026-11-04). Built earlier in this document: it simply stands. */
    :host(.on) { opacity: 1; animation: planet-in 1.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
    :host(.on.instant) { animation: none; }
    @keyframes planet-in { from { opacity: 0; transform: translateY(16vh); } to { opacity: 1; transform: none; } }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    @media (prefers-reduced-motion: reduce) { :host(.on) { animation: none; } }
  `],
})
export class BriefingPlanetComponent {
  /** The CSS planet: the live one is drawn exactly over it. */
  readonly anchor = input.required<HTMLElement>();
  /** Appear at once instead of sliding in; also makes a fallback generation run in fat slices. */
  readonly snap = input(false);
  /** Fires once the planet is drawn for the first time. */
  readonly drawn = output<void>();
  /** Fires when no live planet will come (no WebGL). */
  readonly unavailable = output<void>();
  readonly ready = signal(false);
  /** No live planet will come (no WebGL, generation aborted): the CSS planet stands in. */
  readonly failed = signal(false);
  /** The world was already built this session: the planet stands without fading in. */
  readonly instant = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private stopped = false;
  private cleanup: (() => void)[] = [];
  /**
   * The baked planet (public/planet/, scripts/bake-planet.mjs), requested as
   * the component is created rather than after its first render: the intro
   * waits for the planet, so the download starts as early as it can.
   */
  private readonly baked: Promise<PlanetSources> | null =
    builtWorld || typeof window === 'undefined' ? null : inject(PLANET_SOURCES)(nightSize(innerWidth));

  constructor() {
    // Handled in fromBake(); this only keeps an early failure from being reported as unhandled.
    this.baked?.catch(() => undefined);
    afterNextRender(() => this.zone.runOutsideAngular(() => void this.start()));
    inject(DestroyRef).onDestroy(() => {
      this.stopped = true;
      for (const fn of this.cleanup) fn();
    });
  }

  private async start(): Promise<void> {
    const [glCanvas, trainCanvas] = Array.from(this.host.querySelectorAll('canvas'));
    let renderer: PlanetRenderer;
    try {
      renderer = new PlanetRenderer(glCanvas, accentRgb());
    } catch (err) {
      logWarn('verse.planet', 'WebGL unavailable, keeping the CSS planet', err);
      this.zone.run(() => { this.failed.set(true); this.unavailable.emit(); });
      return;
    }
    this.cleanup.push(() => renderer.dispose());

    // The world + textures live for the whole document: coming back to the Verse inside the
    // session shows the planet at once (Kurz-Auftakt). The first time they come from the bake
    // (a download, decoded off the main thread); generating them here is the fallback.
    let built = builtWorld;
    this.instant.set(!!built);
    if (!built) {
      built = (await this.fromBake()) ?? (await this.generate());
      if (!built) return;
      builtWorld = built;
    }
    const { world, day, night, cloud } = built;
    renderer.setTextures(day, night, cloud);

    performance.mark?.('sc-verse-planet-ready');
    this.zone.run(() => { this.ready.set(true); this.drawn.emit(); });
    this.loop(world, renderer, glCanvas, trainCanvas);
  }

  /** The baked planet, or null when it could not be loaded (the caller then generates it). */
  private async fromBake(): Promise<PlanetSources | null> {
    if (!this.baked) return null;
    try {
      const sources = await this.baked;
      // Kept for the session even when the page went away meanwhile: the next visit shows it at once.
      builtWorld ??= sources;
      return this.stopped ? null : sources;
    } catch (err) {
      logWarn('verse.planet', 'baked planet unavailable, generating it in the page', err);
      return null;
    }
  }

  /** Fallback: generates the world and paints its textures here; null when the page went away. */
  private async generate(): Promise<PlanetSources | null> {
    if (this.stopped) return null;
    const world = await this.slices(generateWorld());
    if (!world) return null;
    const { day, cloud } = paintDay(world);
    const night = await this.slices(paintNight(world, nightSize(innerWidth)));
    if (!night) return null;
    return { world, day, night, cloud };
  }

  /** Drives a generator in idle slices; null when the page went away meanwhile. */
  private slices<T>(gen: Generator<void, T>): Promise<T | null> {
    // First build: the page's intro waits for it, so slices are fat and follow each other at once.
    // Otherwise each slice takes the idle time the browser actually offers (at least 8 ms): with a
    // fixed 10 ms per idle callback and a 200 ms timeout, a page whose animations left little idle
    // time got ~5 % of the main thread, and the planet took 10–20 s to appear (profiled 2026-11-03).
    const urgent = this.snap();
    const idle = (fn: (budget: number) => void) =>
      urgent
        ? setTimeout(() => fn(28), 0)
        : 'requestIdleCallback' in window
          ? requestIdleCallback((d) => fn(Math.max(8, d.timeRemaining())), { timeout: 100 })
          : setTimeout(() => fn(10), 16);
    return new Promise((resolve) => {
      const step = (budget: number) => {
        if (this.stopped) return resolve(null);
        const until = performance.now() + budget;
        for (;;) {
          const r = gen.next();
          if (r.done) return resolve(r.value);
          if (performance.now() > until) break;
        }
        idle(step);
      };
      idle(step);
    });
  }

  private loop(world: PlanetNetwork, renderer: PlanetRenderer, glCanvas: HTMLCanvasElement, trainCanvas: HTMLCanvasElement): void {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rnd = seeded(Date.now() & 0xffff);
    const net = new TrainNetwork(world.cities, world.edges, rnd);
    const aurora = new AuroraClock(rnd);
    const trails = new Map<Train, Vec3[]>();
    const tctx = trainCanvas.getContext('2d')!;
    const rotNow = () => ((Date.now() % DAY_MS) / DAY_MS) * Math.PI * 2;
    let dpr = 1, frame = 0, last = performance.now(), lastPlanet = 0, lastTrains = 0, lastCy = NaN, time = 0;

    const resize = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      for (const c of [glCanvas, trainCanvas]) {
        c.width = Math.round(c.clientWidth * dpr);
        c.height = Math.round(c.clientHeight * dpr);
      }
      lastPlanet = 0;
    };
    /** The planet in the canvas's own coordinates (the canvas is sticky, the anchor scrolls). */
    const geometry = () => {
      const a = this.anchor().getBoundingClientRect(), c = glCanvas.getBoundingClientRect();
      const r = a.width / 2;
      return { cx: a.left + r - c.left, cy: a.top + r - c.top, r, h: c.height, w: c.width };
    };
    const draw = (now: number) => {
      const g = geometry();
      if (g.r <= 0 || g.cy - g.r > g.h) return; // planet below the viewport
      const rot = rotNow();
      if (now - lastPlanet > 66 || g.cy !== lastCy) {
        lastPlanet = now;
        lastCy = g.cy;
        renderer.draw({ cx: g.cx, cy: g.cy, r: g.r, rot, time, aurora: aurora.level }, dpr);
      }
      if (reduce || now - lastTrains < 33) return;
      lastTrains = now;
      tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tctx.clearRect(0, 0, g.w, g.h);
      for (const tr of net.trains) {
        const trail = trails.get(tr) ?? [];
        trail.push(net.position(tr));
        if (trail.length > 26) trail.shift();
        trails.set(tr, trail);
        const p = project(trail[trail.length - 1], rot, g.cx, g.cy, g.r);
        const night = Math.max(0, Math.min(1, -p.ndl / 0.08)), fore = Math.max(0, Math.min(1, p.z / 0.12));
        tr.visible = p.z > 0.05 && night > 0.2 && p.y > 0 && p.y < g.h;
        const a = night * fore;
        if (a <= 0.01) continue;
        for (let k = 0; k < trail.length - 1; k++) {
          const q = project(trail[k], rot, g.cx, g.cy, g.r);
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
      for (const tr of trails.keys()) if (!net.trains.includes(tr)) trails.delete(tr);
    };
    // Off screen (scrolled past the stage, the sticky canvas left with it) nothing is drawn that
    // anyone sees, but the loop kept stepping the trains and redrawing the GL planet. It pauses
    // there and picks up again on return (dt is clamped below, so the world just moves on).
    let onScreen = true;
    const tick = (now: number) => {
      if (!onScreen) {
        frame = 0;
        return;
      }
      const dt = Math.min(100, now - last);
      last = now;
      time += dt / 1000;
      const g = geometry(), rot = rotNow();
      net.step(dt, (e) => [world.cities[e.a].v, world.cities[e.b].v].some((v) => {
        const p = project(v, rot, g.cx, g.cy, g.r);
        return p.z > 0.05 && p.ndl < -0.02 && p.y > 0 && p.y < g.h;
      }));
      aurora.step(dt);
      draw(now);
      frame = requestAnimationFrame(tick);
    };

    resize();
    const onResize = () => { resize(); if (reduce) draw(performance.now()); };
    const onScroll = () => { if (reduce) draw(performance.now()); };
    // Capture: the shell may scroll an inner element instead of the window.
    addEventListener('resize', onResize);
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen && !reduce && !frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    });
    io?.observe(this.host);
    this.cleanup.push(() => {
      cancelAnimationFrame(frame);
      io?.disconnect();
      removeEventListener('resize', onResize);
      document.removeEventListener('scroll', onScroll, { capture: true });
    });
    // rAF pauses in a background tab by itself; reduced motion draws on demand only.
    if (reduce) draw(performance.now());
    else frame = requestAnimationFrame(tick);
  }
}

/** The planet's world and its textures, kept for the session (see start()). */
let builtWorld: PlanetSources | null = null;

/** `--sc-accent` as 0..1 RGB for the atmosphere (falls back to the default cyan). */
function accentRgb(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--sc-accent').trim();
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(raw);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.322, 0.757, 0.902];
}
