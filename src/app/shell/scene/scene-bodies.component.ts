import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, afterNextRender, inject, input, output } from '@angular/core';
import { VerseBodiesService } from '../../verse/pages/briefing/bodies/body.directive';
import type { BodyKind } from '../../verse/pages/briefing/bodies/body-gl';

/** The scene's three hub planets and the body each one is (the hub's doors draw the same: briefing-transmit `bodyOf`). */
export const SCENE_BODY_OF: Readonly<Record<'news' | 'patches' | 'gallery', BodyKind>> = { news: 'crusader', patches: 'arccorp', gallery: 'microtech' };

/** Past this the warm-up ends even if a body never reports (no WebGL, a lost context). */
const WARM_CAP_MS = 4000;

/**
 * `<sc-scene-bodies>` — draws the hub's living planets (the shared WebGL body engine,
 * `VerseBodiesService`) into the scene's News / Patches / Galerie pieces, so the big planet of a
 * Verse subpage is the hub's very planet, banded Crusader included (D8). Loaded with the scene's
 * deferred layer, so the engine stays out of the main bundle.
 *
 * It also keeps that engine warm for the whole session: its worker, context and shaders are made
 * once at boot instead of on the first switch to the Verse hub, where they held the GPU process —
 * and with it every frame of the camera's pan — for most of a second (D12). The canvases are
 * shown while they warm up (`warmed` ends that); afterwards only where a pose or the carry
 * shows a piece, so the engine pauses them everywhere else (it draws only what intersects the view).
 * Renders nothing itself.
 */
@Component({
  selector: 'sc-scene-bodies',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class SceneBodiesComponent {
  /** The pieces' canvases, keyed by door. */
  readonly canvases = input.required<Readonly<Record<'news' | 'patches' | 'gallery', HTMLCanvasElement>>>();
  /** Every body drew once (or the cap passed): the warm-up is over. */
  readonly warmed = output<void>();

  constructor() {
    const bodies = inject(VerseBodiesService);
    const destroyRef = inject(DestroyRef);
    const zone = inject(NgZone);
    afterNextRender(() => {
      const all = Object.entries(this.canvases()) as ['news' | 'patches' | 'gallery', HTMLCanvasElement][];
      let pending = all.length;
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(cap);
        zone.run(() => this.warmed.emit());
      };
      // Outside the zone: a pending cap must not hold the app unstable for seconds.
      const cap = zone.runOutsideAngular(() => setTimeout(finish, WARM_CAP_MS));
      const detach = all.map(([door, canvas]) =>
        bodies.attach(
          canvas,
          SCENE_BODY_OF[door],
          () => {
            canvas.classList.add('on');
            if (--pending <= 0) finish();
          },
          () => canvas.classList.remove('on'),
        ),
      );
      destroyRef.onDestroy(() => {
        clearTimeout(cap);
        detach.forEach((d) => d());
      });
    });
  }
}
