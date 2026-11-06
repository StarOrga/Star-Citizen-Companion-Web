import { DestroyRef, Directive, ElementRef, Injectable, NgZone, afterNextRender, inject, input, signal } from '@angular/core';
import { logWarn } from '../../../../core/log';
import { BodyEngine, BodyKind } from './body-engine';

/** How long the bodies' context waits for the reader to come back to the Verse stage. */
export const ENGINE_LINGER_MS = 5 * 60_000;

/**
 * Owns the one shared {@link BodyEngine} of the page: created on the first attached
 * canvas, and kept for a while after the last one. A new context on every visit held
 * the GPU process for 100 ms and more just as the page changed (2026-11-06). Without
 * a canvas it draws nothing, it only holds its shaders and maps.
 */
@Injectable({ providedIn: 'root' })
export class VerseBodiesService {
  private readonly zone = inject(NgZone);
  private engine: BodyEngine | null = null;
  private failed = false;
  private users = 0;
  private linger: ReturnType<typeof setTimeout> | null = null;
  private onResize = (): void => this.engine?.redraw();

  attach(canvas: HTMLCanvasElement, kind: BodyKind, onReady: () => void, onLost: () => void = () => undefined): () => void {
    if (this.failed) return () => undefined;
    return this.zone.runOutsideAngular(() => {
      if (this.linger !== null) clearTimeout(this.linger);
      this.linger = null;
      if (!this.engine) {
        const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.engine = BodyEngine.create({ still }, (err) => logWarn('verse.bodies', 'WebGL unavailable, keeping the CSS bodies', err));
        if (!this.engine) {
          this.failed = true;
          return () => undefined;
        }
        addEventListener('resize', this.onResize);
      }
      this.users++;
      const detach = this.engine.attach(canvas, kind, () => this.zone.run(onReady), () => this.zone.run(onLost));
      return () => {
        detach();
        if (--this.users === 0) {
          this.linger = setTimeout(() => {
            this.linger = null;
            removeEventListener('resize', this.onResize);
            this.engine?.dispose();
            this.engine = null;
          }, ENGINE_LINGER_MS);
        }
      };
    });
  }
}

/**
 * `<canvas [scBody]="'arccorp'">` — draws a living body (rotating planet or
 * the stormy sun) into the canvas once its maps are ready and sets `.on` then.
 * Until that, without WebGL, or after a lost context, the CSS art underneath shows.
 */
@Directive({
  selector: 'canvas[scBody]',
  standalone: true,
  host: { 'aria-hidden': 'true', '[class.on]': 'ready()' },
})
export class BodyCanvasDirective {
  readonly scBody = input.required<BodyKind>();
  readonly ready = signal(false);

  constructor() {
    const canvas = inject<ElementRef<HTMLCanvasElement>>(ElementRef).nativeElement;
    const bodies = inject(VerseBodiesService);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const detach = bodies.attach(canvas, this.scBody(), () => this.ready.set(true), () => this.ready.set(false));
      destroyRef.onDestroy(detach);
    });
  }
}
