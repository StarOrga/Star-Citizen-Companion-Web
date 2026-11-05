import { logWarn } from '../../../../core/log';
import { afterNextPaint } from '../after-paint';
import { BodyKind, BodyStage, PLANETS } from './body-gl';
import type { BodyCommand, BodyEvent } from './body-worker-core';

export { PLANETS, SUN_DIR, SUN_DISC, turnAt } from './body-gl';
export type { BodyKind } from './body-gl';

export interface BodyEngineOptions {
  /** URL of a map by name (default `/img/verse/maps/<name>.svg`). */
  readonly mapUrl?: (name: string) => string;
  /** Draw once and stand still (prefers-reduced-motion). */
  readonly still?: boolean;
  /** Map raster width in pixels (height is half). */
  readonly mapWidth?: number;
  /** Starts the worker; null keeps the bodies on the page. Default: the real one, where supported. */
  readonly spawn?: () => Worker | null;
}

interface Entry {
  readonly id: number;
  readonly canvas: HTMLCanvasElement;
  readonly kind: BodyKind;
  readonly onReady?: () => void;
  readonly onLost?: () => void;
  visible: boolean;
  added: boolean;
  io?: IntersectionObserver;
  ro?: ResizeObserver;
}

/** The side that draws: a {@link BodyStage} on this page, or the same stage in a worker. */
interface BodyBackend {
  add(e: Entry, cssWidth: number, dpr: number): void;
  remove(id: number): void;
  setVisible(id: number, visible: boolean): void;
  setSize(id: number, cssWidth: number, dpr: number): void;
  setPaused(paused: boolean): void;
  redraw(): void;
  dispose(): void;
}

/** The worker's script has to run within this time, or the page draws itself. How long WebGL then takes is its own business. */
export const BODY_WORKER_DEADLINE_MS = 4000;
const PAUSE_CHECK_MS = 500;
/** A body grows this much under the pointer (`.pl:hover`). */
const HOVER_SCALE = 1.06;

/**
 * The raster width a body's maps need: at the disc's centre a map of width W puts
 * W / 2π texels on a radian and the screen r device pixels, so 1:1 takes W = 2πr.
 * A texture no screen pixel can show only costs GPU memory and upload: 1024 only
 * where a body is big enough for it, never below 1:1. Frozen-clock screenshots at
 * 1920x1080: 512 against 1024 differs by at most 2 of 255 per channel.
 */
export function bodyMapWidth(cssWidth: number, dpr: number): 512 | 1024 {
  if (cssWidth <= 0) return 1024; // not laid out yet: the safe side
  return Math.PI * cssWidth * Math.min(2, dpr || 1) * HOVER_SCALE <= 512 ? 512 : 1024;
}

/** The bodies' worker, where a worker can own a WebGL canvas. */
function spawnBodyWorker(): Worker | null {
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function'
    || typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== 'function') return null;
  try {
    return new Worker(new URL('./bodies.worker', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/**
 * The page's side of the living bodies: watches the canvases (on screen, size,
 * the stage pause) and rasterises the SVG maps, which only a document can do.
 * The drawing itself happens in a {@link BodyStage}: in a worker where possible,
 * so the shaders' link (the longest wait of the whole boot) freezes nothing, and
 * right here otherwise. A canvas goes to the worker only after the worker has
 * said it can draw, so a failed worker leaves the page free to draw itself.
 *
 * The caller's CSS art stays underneath as the fallback — no WebGL, maps still
 * loading, context lost — and the canvas only covers it once `onReady` fired.
 * A canvas whose computed `--sc-brief-play` is `paused` freezes time (the stage
 * pause).
 */
export class BodyEngine {
  private backend: BodyBackend | null = null;
  private worker: Worker | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private cancelStart: (() => void) | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private nextId = 1;
  private readonly entries: Entry[] = [];
  private disposed = false;

  /** Null when no side can draw: no worker, and WebGL missing or the shaders not compiling here. */
  static create(opts: BodyEngineOptions = {}, onError?: (err: unknown) => void): BodyEngine | null {
    const engine = new BodyEngine(opts, onError);
    if (!engine.worker && !engine.backend) return null;
    return engine;
  }

  private constructor(private readonly opts: BodyEngineOptions, private readonly onError?: (err: unknown) => void) {
    const spawn = opts.spawn ?? (opts.mapUrl ? () => null : spawnBodyWorker);
    this.worker = spawn();
    if (this.worker) this.waitForWorker(this.worker);
    else this.drawHere();
  }

  /**
   * Starts drawing `kind` into `canvas` (a 2D canvas the caller sizes with
   * CSS). Returns the detach function.
   */
  attach(canvas: HTMLCanvasElement, kind: BodyKind, onReady?: () => void, onLost?: () => void): () => void {
    if (this.disposed) return () => undefined;
    const e: Entry = { id: this.nextId++, canvas, kind, onReady, onLost, visible: true, added: false };
    if ('IntersectionObserver' in window) {
      e.io = new IntersectionObserver((xs) => {
        e.visible = xs.some((x) => x.isIntersecting);
        if (e.added) this.backend?.setVisible(e.id, e.visible);
        this.armPauseCheck();
      });
      e.io.observe(canvas);
    }
    if ('ResizeObserver' in window) {
      // Read here, where layout is clean: a body in flight changes size, and nobody polls for it.
      e.ro = new ResizeObserver(() => {
        if (e.added) this.backend?.setSize(e.id, canvas.clientWidth, devicePixelRatio);
      });
      e.ro.observe(canvas);
    }
    this.entries.push(e);
    this.add(e);
    return () => {
      e.io?.disconnect();
      e.ro?.disconnect();
      const i = this.entries.indexOf(e);
      if (i >= 0) this.entries.splice(i, 1);
      if (e.added) this.backend?.remove(e.id);
    };
  }

  /** Redraws every ready body once (resize, reduced motion). */
  redraw(): void {
    for (const e of this.entries) if (e.added) this.backend?.setSize(e.id, e.canvas.clientWidth, devicePixelRatio);
    this.backend?.redraw();
  }

  dispose(): void {
    this.disposed = true;
    if (this.deadline !== null) clearTimeout(this.deadline);
    if (this.pauseTimer !== null) clearTimeout(this.pauseTimer);
    this.cancelStart?.();
    for (const e of this.entries) {
      e.io?.disconnect();
      e.ro?.disconnect();
    }
    this.entries.length = 0;
    this.backend?.dispose();
    this.backend = null;
    this.worker?.terminate();
    this.worker = null;
  }

  private add(e: Entry): void {
    if (!this.backend || e.added) return;
    e.added = true;
    this.backend.add(e, e.canvas.clientWidth, devicePixelRatio);
    this.checkPause();
  }

  private waitForWorker(worker: Worker): void {
    this.deadline = setTimeout(() => this.workerFailed('no answer'), BODY_WORKER_DEADLINE_MS);
    worker.onmessage = ({ data }: MessageEvent<BodyEvent>) => {
      switch (data.t) {
        case 'alive':
          if (this.deadline !== null) clearTimeout(this.deadline);
          this.deadline = null;
          break;
        case 'capable':
          if (!data.ok) return this.workerFailed('cannot draw');
          this.backend = this.remote(worker);
          for (const e of this.entries) this.add(e);
          break;
        case 'map':
          void this.mapBitmap(data.name).then((bitmap) => {
            if (this.disposed) return bitmap?.close();
            worker.postMessage({ t: 'map', name: data.name, bitmap } satisfies BodyCommand, bitmap ? [bitmap] : []);
          });
          break;
        case 'ready':
          this.entries.find((e) => e.id === data.id)?.onReady?.();
          break;
        case 'lost':
          this.entries.find((e) => e.id === data.id)?.onLost?.();
          break;
      }
    };
    // A dead URL after a deploy answers with HTML, CSP says no, the module does not parse: all land here.
    worker.onerror = (ev) => {
      ev.preventDefault();
      this.workerFailed(ev.message || 'worker error');
    };
    this.cancelStart = afterNextPaint(() => worker.postMessage({ t: 'init', still: !!this.opts.still } satisfies BodyCommand));
  }

  /** The worker is out. Canvases it holds show the CSS art from here on; the others draw here. */
  private workerFailed(reason: string): void {
    if (this.disposed || !this.worker) return;
    logWarn('verse.bodies', 'bodies worker failed', reason);
    if (this.deadline !== null) clearTimeout(this.deadline);
    this.deadline = null;
    this.worker.terminate();
    this.worker = null;
    const handedOver = this.backend !== null;
    this.backend = null;
    if (handedOver) {
      for (const e of this.entries) if (e.added) e.onLost?.();
      return;
    }
    this.drawHere();
  }

  private drawHere(): void {
    try {
      const stage = new BodyStage(document.createElement('canvas'), {
        still: !!this.opts.still,
        map: (name) => this.rasterize(name),
        onReady: (id) => this.entries.find((e) => e.id === id)?.onReady?.(),
        onLost: (id) => this.entries.find((e) => e.id === id)?.onLost?.(),
      });
      this.backend = {
        add: (e, css, dpr) => {
          stage.add(e.id, e.canvas, e.kind, css, dpr, e.visible);
        },
        remove: (id) => stage.remove(id),
        setVisible: (id, v) => stage.setVisible(id, v),
        setSize: (id, css, dpr) => stage.setSize(id, css, dpr),
        setPaused: (p) => stage.setPaused(p),
        redraw: () => stage.redraw(),
        dispose: () => stage.dispose(),
      };
      for (const e of this.entries) this.add(e);
    } catch (err) {
      this.onError?.(err);
    }
  }

  private remote(worker: Worker): BodyBackend {
    const send = (m: BodyCommand, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
    return {
      add: (e, cssWidth, dpr) => {
        const canvas = e.canvas.transferControlToOffscreen();
        send({ t: 'add', id: e.id, canvas, kind: e.kind, cssWidth, dpr, visible: e.visible }, [canvas]);
      },
      remove: (id) => send({ t: 'remove', id }),
      setVisible: (id, visible) => send({ t: 'visible', id, visible }),
      setSize: (id, cssWidth, dpr) => send({ t: 'size', id, cssWidth, dpr }),
      setPaused: (paused) => send({ t: 'paused', paused }),
      redraw: () => send({ t: 'redraw' }),
      dispose: () => undefined, // dispose() terminates the worker, and its context with it
    };
  }

  /** The stage pause lives in CSS, so it is read here, twice a second while a body is on screen. */
  private checkPause(): void {
    const live = this.entries.filter((e) => e.added && e.visible);
    if (!live.length) return;
    const paused = live.some((e) => getComputedStyle(e.canvas).getPropertyValue('--sc-brief-play').trim() === 'paused');
    if (paused !== this.paused) {
      this.paused = paused;
      this.backend?.setPaused(paused);
    }
    this.armPauseCheck();
  }

  private armPauseCheck(): void {
    if (this.opts.still || this.disposed || this.pauseTimer !== null) return;
    if (!this.entries.some((e) => e.added && e.visible)) return;
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null;
      this.checkPause();
    }, PAUSE_CHECK_MS);
  }

  private async mapBitmap(name: string): Promise<ImageBitmap | null> {
    const c = await this.rasterize(name);
    if (!c) return null;
    try {
      // Straight alpha and no colour conversion: what the GPU got when the canvas itself was uploaded.
      return await createImageBitmap(c, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch {
      return null; // a tainted raster (map from another origin): keep the CSS art
    } finally {
      c.width = c.height = 0;
    }
  }

  /**
   * For the size this body can reach on this screen: a window that is not maximised
   * yet may still grow, and a map is rastered only once.
   */
  private mapWidthOf(name: string): 512 | 1024 {
    const e = this.entries.find((x) => x.kind !== 'sun' && Object.values(PLANETS[x.kind].layers).includes(name));
    if (!e) return 1024;
    const grow = Math.max(1, (screen?.availWidth || 0) / (innerWidth || 1));
    return bodyMapWidth(e.canvas.clientWidth * grow, devicePixelRatio);
  }

  /** The SVG map rasterised into a canvas (its filters run once, here). */
  private async rasterize(name: string): Promise<HTMLCanvasElement | null> {
    const w = this.opts.mapWidth ?? this.mapWidthOf(name);
    const img = new Image();
    img.decoding = 'async';
    img.src = this.opts.mapUrl ? this.opts.mapUrl(name) : `/img/verse/maps/${name}.svg`;
    try {
      await img.decode();
    } catch {
      return null;
    }
    // Let the page breathe between the heavy filter rasters.
    await new Promise<void>((r) => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout: 300 }) : setTimeout(r, 16)));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = w / 2;
    c.getContext('2d')!.drawImage(img, 0, 0, w, w / 2);
    return c;
  }
}
