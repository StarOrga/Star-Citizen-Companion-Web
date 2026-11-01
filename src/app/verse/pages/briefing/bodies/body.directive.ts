import { DestroyRef, Directive, ElementRef, Injectable, NgZone, afterNextRender, inject, input, signal } from '@angular/core';
import { logWarn } from '../../../../core/log';
import { BodyEngine, BodyKind } from './body-engine';

/**
 * Owns the one shared {@link BodyEngine} of the page: created on the first
 * attached canvas, disposed with the last one, so the GPU context only lives
 * while the Verse stage does.
 */
@Injectable({ providedIn: 'root' })
export class VerseBodiesService {
  private readonly zone = inject(NgZone);
  private engine: BodyEngine | null = null;
  private failed = false;
  private users = 0;
  private onResize = (): void => this.engine?.redraw();

  attach(canvas: HTMLCanvasElement, kind: BodyKind, onReady: () => void): () => void {
    if (this.failed) return () => undefined;
    return this.zone.runOutsideAngular(() => {
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
      const detach = this.engine.attach(canvas, kind, () => this.zone.run(onReady));
      return () => {
        detach();
        if (--this.users === 0) {
          removeEventListener('resize', this.onResize);
          this.engine?.dispose();
          this.engine = null;
        }
      };
    });
  }
}

/**
 * `<canvas [scBody]="'arccorp'">` — draws a living body (rotating planet or
 * the stormy sun) into the canvas once its maps are ready and sets `.on` then.
 * Until that, or without WebGL, the CSS art underneath shows.
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
      const detach = bodies.attach(canvas, this.scBody(), () => this.ready.set(true));
      destroyRef.onDestroy(detach);
    });
  }
}
