import { InjectionToken } from '@angular/core';
import { logWarn } from '../../../../core/log';
import { afterFirstContentfulPaint } from '../after-paint';
import { PlanetBackend, PlanetStatus, PlanetView } from './planet-scene';
import type { PlanetCommand, PlanetEvent } from './planet-worker-core';

/** The worker's script has to run within this time, or the page draws itself. How long WebGL then takes is its own business. */
export const PLANET_WORKER_DEADLINE_MS = 4000;

/** The page's side of a planet in a worker; a seam so specs need no real worker. */
export interface PlanetLink extends PlanetBackend {
  /** False: this worker cannot draw (nothing was handed over yet), the page draws itself. */
  readonly capable: Promise<boolean>;
  /** True once the planet can be shown; false when the worker failed. */
  readonly settled: Promise<boolean>;
  readonly isReady: boolean;
  /** False once the worker died or its context stayed lost: its canvases show nothing any more. */
  readonly alive: boolean;
  /** The canvases the worker draws into, once handed over. They outlive the component. */
  readonly canvases: readonly [HTMLCanvasElement, HTMLCanvasElement] | null;
  onStatus: ((status: PlanetStatus) => void) | null;
  attach(gl: HTMLCanvasElement, trains: HTMLCanvasElement, accent: readonly [number, number, number], reduce: boolean): void;
  setAccent(accent: readonly [number, number, number]): void;
  /** The component leaves: the worker empties the canvases and keeps its GPU state. */
  park(): void;
  terminate(): void;
}

function supportsWorkerCanvas(): boolean {
  return typeof Worker === 'function' && typeof OffscreenCanvas === 'function'
    && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
}

export class PlanetWorkerLink implements PlanetLink {
  readonly capable: Promise<boolean>;
  readonly settled: Promise<boolean>;
  isReady = false;
  canvases: readonly [HTMLCanvasElement, HTMLCanvasElement] | null = null;
  onStatus: ((status: PlanetStatus) => void) | null = null;
  private dead = false;
  private lost = false;
  private answerCapable!: (ok: boolean) => void;
  private answerSettled!: (ok: boolean) => void;
  private readonly deadline: ReturnType<typeof setTimeout>;

  constructor(private readonly worker: Worker, size: 2048 | 4096, base: string) {
    this.capable = new Promise((r) => (this.answerCapable = r));
    this.settled = new Promise((r) => (this.answerSettled = r));
    this.deadline = setTimeout(() => this.fail('no answer'), PLANET_WORKER_DEADLINE_MS);
    worker.onmessage = ({ data }: MessageEvent<PlanetEvent>) => this.onEvent(data);
    // A dead URL after a deploy answers with HTML, CSP says no, the module does not parse: all land here.
    worker.onerror = (e) => { e.preventDefault(); this.fail(e.message || 'worker error'); };
    worker.onmessageerror = () => this.fail('message error');
    this.send({ t: 'load', size, base });
    afterFirstContentfulPaint(() => this.send({ t: 'probe' }));
  }

  get alive(): boolean {
    return !this.dead && !this.lost;
  }

  attach(gl: HTMLCanvasElement, trains: HTMLCanvasElement, accent: readonly [number, number, number], reduce: boolean): void {
    this.canvases = [gl, trains];
    const offGl = gl.transferControlToOffscreen(), offTrains = trains.transferControlToOffscreen();
    this.send({ t: 'attach', gl: offGl, trains: offTrains, accent, reduce }, [offGl, offTrains]);
  }

  setAccent(accent: readonly [number, number, number]): void { this.send({ t: 'accent', accent }); }
  resize(w: number, h: number, dpr: number): void { this.send({ t: 'resize', w, h, dpr }); }
  tick(view: PlanetView, now: number): void { this.send({ t: 'tick', view, now }); }
  draw(view: PlanetView, now: number): void { this.send({ t: 'draw', view, now }); }
  resume(now: number): void { this.send({ t: 'resume', now }); }
  park(): void { this.send({ t: 'park' }); }

  terminate(): void {
    this.dead = true;
    clearTimeout(this.deadline);
    this.worker.terminate();
  }

  private send(m: PlanetCommand, transfer: Transferable[] = []): void {
    if (!this.dead) this.worker.postMessage(m, transfer);
  }

  private onEvent(e: PlanetEvent): void {
    switch (e.t) {
      case 'alive':
        clearTimeout(this.deadline);
        break;
      case 'capable':
        this.answerCapable(e.ok);
        if (!e.ok) {
          this.answerSettled(false);
          this.terminate();
        }
        break;
      case 'ready':
        this.isReady = true;
        this.answerSettled(true);
        break;
      case 'failed':
        this.fail(e.reason);
        break;
      case 'status':
        this.lost = e.status === 'unavailable';
        this.onStatus?.(e.status);
        break;
    }
  }

  private fail(reason: string): void {
    if (this.dead) return;
    logWarn('verse.planet', 'planet worker failed, drawing in the page', reason);
    this.terminate();
    this.answerCapable(false);
    this.answerSettled(false);
    // A worker dying after the planet stood takes the picture with it.
    if (this.isReady) this.onStatus?.('unavailable');
  }
}

/** A planet worker, or null where a worker cannot own a WebGL canvas (the page then draws itself). */
export function spawnPlanetLink(size: 2048 | 4096, base: string): PlanetLink | null {
  if (!supportsWorkerCanvas()) return null;
  try {
    return new PlanetWorkerLink(new Worker(new URL('./planet.worker', import.meta.url), { type: 'module' }), size, base);
  } catch (err) {
    logWarn('verse.planet', 'planet worker refused, drawing in the page', err);
    return null;
  }
}

/** Starts the planet's worker; a token so a spec can answer without a real one. */
export const PLANET_LINK = new InjectionToken<typeof spawnPlanetLink>('PLANET_LINK', {
  providedIn: 'root',
  factory: () => spawnPlanetLink,
});
