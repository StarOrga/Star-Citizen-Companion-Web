import { BodyKind, BodyStage } from './body-gl';
import { loadBakedMap } from './body-maps';

/** Main thread → worker. */
export type BodyCommand =
  | { readonly t: 'init'; readonly still: boolean; readonly base: string | null }
  | { readonly t: 'add'; readonly id: number; readonly canvas: OffscreenCanvas; readonly kind: BodyKind; readonly cssWidth: number; readonly dpr: number; readonly visible: boolean; readonly mapWidth: number }
  | { readonly t: 'remove'; readonly id: number }
  | { readonly t: 'visible'; readonly id: number; readonly visible: boolean }
  | { readonly t: 'size'; readonly id: number; readonly cssWidth: number; readonly dpr: number }
  | { readonly t: 'paused'; readonly paused: boolean }
  | { readonly t: 'redraw' }
  | { readonly t: 'map'; readonly name: string; readonly bitmap: ImageBitmap | null };

/** Worker → main thread. */
export type BodyEvent =
  | { readonly t: 'alive' }
  | { readonly t: 'capable'; readonly ok: boolean }
  | { readonly t: 'map'; readonly name: string; readonly width: number }
  | { readonly t: 'ready'; readonly id: number }
  | { readonly t: 'lost'; readonly id: number };

/** The bit of a dedicated worker's global this code uses (the `webworker` lib clashes with `dom`). */
export interface BodyWorkerScope {
  postMessage(event: BodyEvent): void;
  onmessage: ((e: MessageEvent<BodyCommand>) => void) | null;
}

/**
 * The worker's side of the living bodies. Unlike the big planet they need no
 * measure per frame (their canvases move with the page, the compositor carries
 * them), so this runs its own animation frames and the page only reports
 * changes: size, on screen, the stage pause. It loads the baked maps itself; only
 * when one fails does it ask the page, because rasterising an SVG takes a document.
 */
export function runBodyWorker(scope: BodyWorkerScope): void {
  let stage: BodyStage | null = null;
  const maps = new Map<string, (bitmap: ImageBitmap | null) => void>();

  scope.onmessage = ({ data: m }) => {
    switch (m.t) {
      case 'init':
        // First: the answer to the page's deadline. A first context can take long on a slow machine.
        scope.postMessage({ t: 'alive' });
        try {
          const base = m.base;
          if (typeof OffscreenCanvas !== 'function' || typeof requestAnimationFrame !== 'function') throw new Error('no worker canvas');
          stage = new BodyStage(new OffscreenCanvas(256, 256), {
            still: m.still,
            map: (name, width) => {
              const askPage = () => new Promise<ImageBitmap | null>((resolve) => {
                maps.set(name, resolve);
                scope.postMessage({ t: 'map', name, width });
              });
              return base === null ? askPage() : loadBakedMap(name, width, base).catch(askPage);
            },
            onReady: (id) => scope.postMessage({ t: 'ready', id }),
            onLost: (id) => scope.postMessage({ t: 'lost', id }),
          });
          scope.postMessage({ t: 'capable', ok: true });
        } catch {
          scope.postMessage({ t: 'capable', ok: false });
        }
        break;
      case 'add':
        stage?.add(m.id, m.canvas, m.kind, m.cssWidth, m.dpr, m.visible, m.mapWidth);
        break;
      case 'remove':
        stage?.remove(m.id);
        break;
      case 'visible':
        stage?.setVisible(m.id, m.visible);
        break;
      case 'size':
        stage?.setSize(m.id, m.cssWidth, m.dpr);
        break;
      case 'paused':
        stage?.setPaused(m.paused);
        break;
      case 'redraw':
        stage?.redraw();
        break;
      case 'map':
        maps.get(m.name)?.(m.bitmap);
        maps.delete(m.name);
        break;
    }
  };
}
