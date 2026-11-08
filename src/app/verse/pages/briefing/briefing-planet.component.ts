import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, afterNextRender, inject, input, output, signal } from '@angular/core';
import { logWarn } from '../../../core/log';
import { WindowFocusService } from '../../../core/window-focus.service';
import { PLANET_SOURCES, PlanetSources, loadBakedPlanet, nightSize } from './planet/planet-assets';
import { PlanetRenderer } from './planet/planet-gl';
import { PlanetBackend, PlanetScene, PlanetStatus, PlanetView } from './planet/planet-scene';
import { paintDay, paintNight } from './planet/planet-textures';
import { PLANET_LINK, PlanetLink } from './planet/planet-worker-link';
import { generateWorld } from './planet/planet-world';

/**
 * The hub's big planet, live (concept 2026-10-29 "Verse-Planet Nachtseite"):
 * a WebGL sphere that turns once in 30 minutes under a fixed sun, with city
 * lights on its night side, 2–5 trains on the rail network and an aurora that
 * never goes dark, drifting weaker and stronger. It draws into a sticky,
 * viewport-tall canvas inside the stage's
 * `.world-clip` and takes its geometry from the CSS planet (`anchor`). That one
 * is invisible: it is shown only when no live planet can come (no WebGL). While
 * the live one loads, the stars show — there is never a second, plainer planet
 * underneath it (owner feedback 2026-11-04: it showed through while scrolling).
 *
 * The turn follows the wall clock, so every visit shows another part of the
 * world. Under reduced motion the planet is drawn once and stands still.
 *
 * It draws in a worker where a worker can own a WebGL canvas (planet-worker-core),
 * so shader link and texture upload do not freeze the page; everywhere else, or
 * when that worker fails, the same scene runs right here. The page stays the
 * ruler either way: the anchor is measured here. At rest that is 15 times a second,
 * off a timer; while the planet moves on screen (scroll, resize, entrance, shake) it is
 * every frame. Without window focus it stands (WindowFocusService) and carries on softly.
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
  private readonly loader = inject(PLANET_SOURCES);
  private readonly focus = inject(WindowFocusService);
  private stopped = false;
  private cleanup: (() => void)[] = [];
  /**
   * The baked planet (public/planet/, scripts/bake-planet.mjs), requested as
   * the component is created rather than after its first render: the intro
   * waits for the planet, so the download starts as early as it can. In the
   * worker's case the worker fetches it, and this stays null.
   */
  private baked: Promise<PlanetSources> | null = null;
  /** A loader of its own (specs) cannot run in the worker: that planet draws here. */
  private readonly inWorker = this.loader === loadBakedPlanet;

  constructor() {
    const spawn = inject(PLANET_LINK);
    if (typeof window !== 'undefined' && !builtWorld) {
      if (this.inWorker) sessionLink ??= spawn(nightSize(innerWidth), document.baseURI);
      if (!this.inWorker || !sessionLink) this.requestBake();
    }
    afterNextRender(() => this.zone.runOutsideAngular(() => void this.start()));
    inject(DestroyRef).onDestroy(() => {
      this.stopped = true;
      for (const fn of this.cleanup) fn();
    });
  }

  private requestBake(): void {
    this.baked = this.loader(nightSize(innerWidth));
    // Handled in fromBake(); this only keeps an early failure from being reported as unhandled.
    this.baked.catch(() => undefined);
  }

  private async start(): Promise<void> {
    if (this.inWorker && sessionLink) {
      if (await this.startInWorker(sessionLink)) return;
      if (this.stopped) return;
      sessionLink = null;
      if (!builtWorld) this.requestBake();
    }
    const [glCanvas, trainCanvas] = Array.from(this.host.querySelectorAll('canvas'));
    let renderer: PlanetRenderer;
    try {
      renderer = new PlanetRenderer(glCanvas, accentRgb());
    } catch (err) {
      logWarn('verse.planet', 'WebGL unavailable, keeping the CSS planet', err);
      this.zone.run(() => this.markFailed());
      return;
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // The world + textures live for the whole document: coming back to the Verse inside the
    // session shows the planet at once (Kurz-Auftakt). The first time they come from the bake
    // (a download, decoded off the main thread); generating them here is the fallback.
    let built = builtWorld;
    this.instant.set(!!built);
    if (!built) {
      built = (await this.fromBake()) ?? (await this.generate());
      if (!built) {
        renderer.dispose();
        return;
      }
      builtWorld = built;
    }
    const { world, day, night, cloud } = built;
    renderer.setTextures(day, night, cloud);
    const scene = new PlanetScene({
      glCanvas,
      trainCanvas,
      world,
      reduce,
      renderer,
      rebuild: async () => {
        const next = new PlanetRenderer(glCanvas, accentRgb());
        next.setTextures(day, night, cloud);
        return next;
      },
      onStatus: (status) => this.onStatus(status),
    });
    this.cleanup.push(() => scene.dispose());
    this.stand();
    this.loop(scene, glCanvas, reduce);
  }

  /**
   * Hands the canvases to the worker, or back into this page when it holds them
   * from an earlier visit (the planet then stands at once: nothing is compiled or
   * uploaded again). False: the page has to draw this planet itself.
   */
  private async startInWorker(link: PlanetLink): Promise<boolean> {
    let [gl, trains] = Array.from(this.host.querySelectorAll('canvas'));
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const held = link.canvases;
    if (held && !link.alive) {
      link.terminate();
      return false; // its worker died while the planet was parked; the fresh canvases of this visit are untouched
    }
    if (held) {
      gl.replaceWith(held[0]);
      trains.replaceWith(held[1]);
      [gl, trains] = held;
      link.setAccent(accentRgb());
    } else {
      if (!(await link.capable) || this.stopped) return this.stopped;
      link.attach(gl, trains, accentRgb(), reduce);
    }
    this.instant.set(link.isReady);
    this.cleanup.push(() => {
      link.onStatus = null;
      link.park();
    });
    link.onStatus = (status) => this.onStatus(status);
    if (!(await link.settled)) {
      link.terminate();
      if (this.stopped) return true;
      // These two belong to the dead worker now: a canvas gives its control away only once.
      gl.replaceWith(gl.cloneNode(false));
      trains.replaceWith(trains.cloneNode(false));
      return false;
    }
    if (this.stopped) return true;
    this.stand();
    this.loop(link, gl, reduce);
    return true;
  }

  private stand(): void {
    performance.mark?.('sc-verse-planet-ready');
    this.zone.run(() => { this.ready.set(true); this.drawn.emit(); });
  }

  private markFailed(): void {
    this.failed.set(true);
    this.unavailable.emit();
  }

  /** A lost context that does not come back, or a dead worker: never a blank stage. */
  private onStatus(status: PlanetStatus): void {
    if (this.stopped) return;
    this.zone.run(() => {
      if (status === 'unavailable') this.markFailed();
      else this.failed.set(false);
    });
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

  /**
   * The page's half of the animation: measures the anchor and tells the planet. Following
   * the monitor's refresh at rest cost more than drawing the planet (175 measures and
   * messages a second at 179 Hz, for 15 pictures), so at rest a timer sets the pace, and
   * only a planet that moves on screen is followed every frame.
   */
  private loop(planet: PlanetBackend, glCanvas: HTMLCanvasElement, reduce: boolean): void {
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let followUntil = 0;
    let last: PlanetView | null = null;
    let suspended = false;
    let suspendedDraw = 0;
    const resize = () => planet.resize(glCanvas.clientWidth, glCanvas.clientHeight, devicePixelRatio);
    /** The planet in the canvas's own coordinates (the canvas is sticky, the anchor scrolls). */
    const geometry = (): PlanetView => {
      const a = this.anchor().getBoundingClientRect(), c = glCanvas.getBoundingClientRect();
      const r = a.width / 2;
      return { cx: a.left + r - c.left, cy: a.top + r - c.top, r, h: c.height, w: c.width };
    };
    // Off screen (scrolled past the stage, the sticky canvas left with it) nothing is drawn that
    // anyone sees, but the loop kept stepping the trains and redrawing the GL planet. It pauses
    // there and picks up again on return (dt is clamped by the scene, so the world just moves on).
    let onScreen = true;
    const halt = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const tick = (now: number) => {
      frame = 0;
      if (!onScreen || suspended) return;
      const v = geometry();
      if (last && (v.cx !== last.cx || v.cy !== last.cy || v.r !== last.r)) followUntil = now + FOLLOW_MS;
      last = v;
      planet.tick(v, now);
      if (now < followUntil) frame = requestAnimationFrame(tick);
      else timer = setTimeout(() => { timer = null; frame = requestAnimationFrame(tick); }, IDLE_TICK_MS);
    };
    /** The planet is about to move: follow it from the next frame, not from the next timer. */
    const follow = () => {
      followUntil = performance.now() + FOLLOW_MS;
      if (!onScreen || frame) return;
      halt();
      frame = requestAnimationFrame(tick);
    };
    /** A paused planet still has to stay under the page; it just does not turn. */
    const drawSuspended = () => {
      suspendedDraw ||= requestAnimationFrame(() => {
        suspendedDraw = 0;
        planet.draw(geometry(), performance.now());
      });
    };

    resize();
    planet.resume(performance.now());
    const onResize = () => {
      resize();
      if (reduce) planet.draw(geometry(), performance.now());
      else if (suspended) drawSuspended();
      else follow();
    };
    const onScroll = () => {
      if (reduce) planet.draw(geometry(), performance.now());
      else if (suspended) drawSuspended();
      else follow();
    };
    // Capture: the shell may scroll an inner element instead of the window.
    addEventListener('resize', onResize);
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen && !reduce && !suspended && !frame && timer === null) {
        planet.resume(performance.now());
        frame = requestAnimationFrame(tick);
      }
    });
    io?.observe(this.host);
    const stopFocus = reduce ? null : this.focus.onChange((focused) => {
      suspended = !focused;
      if (suspended) {
        halt();
        planet.suspend();
        return;
      }
      planet.wake(performance.now());
      last = null;
      if (onScreen && !frame && timer === null) frame = requestAnimationFrame(tick);
    });
    this.cleanup.push(() => {
      halt();
      cancelAnimationFrame(suspendedDraw);
      stopFocus?.();
      io?.disconnect();
      removeEventListener('resize', onResize);
      document.removeEventListener('scroll', onScroll, { capture: true });
    });
    // rAF pauses in a background tab by itself; reduced motion draws on demand only.
    if (reduce) planet.draw(geometry(), performance.now());
    else frame = requestAnimationFrame(tick);
  }
}

/** The page's measuring pace at rest; the scene draws the planet at the same 15 fps. */
const IDLE_TICK_MS = 66;
/** After the planet last moved on screen, keep following it every frame this long. */
const FOLLOW_MS = 250;

/** The worker holding the planet, kept for the session: coming back shows the planet at once. */
let sessionLink: PlanetLink | null = null;

/** The planet's world and its textures when the page draws it, kept for the session (see start()). */
let builtWorld: PlanetSources | null = null;

/** Specs only: forgets the session's planet. */
export function forgetPlanetSession(): void {
  sessionLink?.terminate();
  sessionLink = null;
  builtWorld = null;
}

/** `--sc-accent` as 0..1 RGB for the atmosphere (falls back to the default cyan). */
function accentRgb(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--sc-accent').trim();
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(raw);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.322, 0.757, 0.902];
}
