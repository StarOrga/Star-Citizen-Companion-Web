import { PlanetSources, loadBakedPlanet } from './planet-bake';
import { PlanetRenderer } from './planet-gl';
import { PlanetScene, PlanetStatus, PlanetView } from './planet-scene';

type Accent = readonly [number, number, number];

/** Main thread → worker. */
export type PlanetCommand =
  | { readonly t: 'load'; readonly size: 2048 | 4096; readonly base: string }
  | { readonly t: 'probe' }
  | { readonly t: 'attach'; readonly gl: OffscreenCanvas; readonly trains: OffscreenCanvas; readonly accent: Accent; readonly reduce: boolean }
  | { readonly t: 'accent'; readonly accent: Accent }
  | { readonly t: 'resize'; readonly w: number; readonly h: number; readonly dpr: number }
  | { readonly t: 'tick' | 'draw'; readonly view: PlanetView; readonly now: number }
  | { readonly t: 'resume'; readonly now: number }
  | { readonly t: 'suspend' }
  | { readonly t: 'wake'; readonly now: number }
  | { readonly t: 'park' };

/** Worker → main thread. */
export type PlanetEvent =
  | { readonly t: 'alive' }
  | { readonly t: 'capable'; readonly ok: boolean }
  | { readonly t: 'ready' }
  | { readonly t: 'failed'; readonly reason: string }
  | { readonly t: 'status'; readonly status: PlanetStatus };

/** The bit of a dedicated worker's global this code uses (the `webworker` lib clashes with `dom`). */
export interface PlanetWorkerScope {
  postMessage(event: PlanetEvent): void;
  onmessage: ((e: MessageEvent<PlanetCommand>) => void) | null;
}

/** Can this worker draw WebGL at all? Answers before the page gives its canvases away. */
function canDraw(): boolean {
  try {
    if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') return false;
    const gl = new OffscreenCanvas(1, 1).getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** The GPU holds the textures now; a lost context downloads them again (a service-worker hit). */
function release(s: PlanetSources): void {
  for (const img of [s.day, s.night, s.cloud]) (img as ImageBitmap).close?.();
}

/**
 * The worker's side of the planet: downloads and decodes the bake, compiles the
 * shader, uploads the textures, and then draws what the page asks for. The page
 * stays the clock and the ruler: every animation frame it measures the anchor
 * and posts the result, and this draws at once on arrival, so the planet follows
 * scrolling as closely as a frame allows and stops with the page's rAF (hidden
 * tab, scrolled away, reduced motion) without any rule of its own.
 *
 * Shader link and texture upload are the waits that froze the page on boot
 * (real GPU, cold shader cache: docs/performance-plan.md). Here they block only
 * this thread.
 */
export function runPlanetWorker(scope: PlanetWorkerScope): void {
  let bake: Promise<PlanetSources> | null = null;
  let size: 2048 | 4096 = 2048, base = '';
  let accent: Accent = [0, 0, 0];
  let scene: PlanetScene | null = null;
  let renderer: PlanetRenderer | null = null;
  let last: { view: PlanetView; now: number } | null = null;

  // A burst of frames (this thread was busy) collapses into the newest one: the
  // MessageChannel's turn comes after everything already queued.
  let pending: Extract<PlanetCommand, { t: 'tick' | 'draw' }> | null = null;
  const yielder = new MessageChannel();
  yielder.port1.onmessage = () => {
    const m = pending;
    pending = null;
    if (!m || !scene) return;
    last = { view: m.view, now: m.now };
    if (m.t === 'tick') scene.tick(m.view, m.now);
    else scene.draw(m.view, m.now);
  };

  const rendererWith = async (gl: OffscreenCanvas, sources: Promise<PlanetSources>) => {
    const r = new PlanetRenderer(gl, accent);
    const s = await sources;
    r.setTextures(s.day, s.night, s.cloud);
    r.settle();
    release(s);
    return { r, world: s.world };
  };

  const start = async (c: Extract<PlanetCommand, { t: 'attach' }>) => {
    try {
      const { r, world } = await rendererWith(c.gl, bake!);
      renderer = r;
      scene = new PlanetScene({
        glCanvas: c.gl,
        trainCanvas: c.trains,
        world,
        reduce: c.reduce,
        renderer: r,
        rebuild: async () => {
          renderer = (await rendererWith(c.gl, loadBakedPlanet(size, base))).r;
          return renderer;
        },
        onStatus: (status) => scope.postMessage({ t: 'status', status }),
      });
      scope.postMessage({ t: 'ready' });
    } catch (err) {
      scope.postMessage({ t: 'failed', reason: err instanceof Error ? err.message : String(err) });
    }
  };

  scope.onmessage = ({ data: m }) => {
    switch (m.t) {
      case 'load': {
        size = m.size;
        base = m.base;
        // The answer to the page's deadline. A first context can take long on a slow machine.
        scope.postMessage({ t: 'alive' });
        // The download starts with the worker, not after the shader: the intro waits for it.
        bake = loadBakedPlanet(size, base);
        bake.catch(() => undefined); // reported when start() awaits it
        break;
      }
      case 'probe':
        scope.postMessage({ t: 'capable', ok: canDraw() });
        break;
      case 'attach':
        accent = m.accent;
        void start(m);
        break;
      case 'accent':
        accent = m.accent;
        renderer?.setAccent(m.accent);
        break;
      case 'resize':
        scene?.resize(m.w, m.h, m.dpr);
        // Same task as the resize: the canvas never goes out empty.
        if (scene && last) scene.draw(last.view, last.now);
        break;
      case 'tick':
      case 'draw':
        if (!pending) yielder.port2.postMessage(0);
        pending = m;
        break;
      case 'resume':
        scene?.resume(m.now);
        break;
      case 'suspend':
        pending = null;
        scene?.suspend();
        break;
      case 'wake':
        scene?.wake(m.now);
        break;
      case 'park':
        pending = null;
        last = null;
        scene?.clear();
        break;
    }
  };
}
