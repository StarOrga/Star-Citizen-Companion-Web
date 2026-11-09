import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, ElementRef, NgZone, ViewEncapsulation, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { BriefingPlanetComponent } from '../../verse/pages/briefing/briefing-planet.component';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, NavigationStart, Router } from '@angular/router';
import { BetaService } from '../../core/beta.service';
import { SlowMotionService } from '../../core/slow-motion.service';
import { WindowFocusService } from '../../core/window-focus.service';
import {
  CameraPose,
  POSES,
  SCENE_FLIGHT_MS,
  SCENE_OBJECTS,
  SCENE_PUSH_MS,
  SCENE_PUSH_VEIL,
  SCENE_PUSH_ZOOM,
  ScenePoseId,
  doorRects,
  sceneTargetOf,
  zoomAbout,
} from './scene.model';
import { SceneCameraService } from './scene-camera.service';
import { SPARKLE_COUNT, StarSparkle } from './star-sparkle';

/** Marker on `<html>` while the scene is on: the VERSE FLIGHT styles keep it out of every View Transition snapshot. */
export const SCENE_HTML_ATTR = 'data-sc-scene';

/**
 * `<sc-shell-scene>` — the app's background (beta `shell` only; renders
 * nothing otherwise): one world, one camera (`SceneCameraService`). Every
 * route is a pose (`sceneTargetOf`); a navigation flies the camera on a
 * straight path from wherever it stands — 1100 ms between named poses, a
 * 700 ms push-in towards the clicked element for a page below its pose's page
 * (back pulls out again), a retarget from the current pose when the user
 * clicks on mid-flight. The flight starts on NavigationStart, so the camera is
 * already moving while the page loads; a cancelled navigation flies back.
 * Objects that do not belong to the target pose fade during the flight.
 * Reduced motion: a 420 ms crossfade instead of any flight.
 */
@Component({
  selector: 'sc-shell-scene',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BriefingPlanetComponent],
  templateUrl: './shell-scene.component.html',
  styleUrl: './shell-scene.component.scss',
  // Global on purpose: it has to clear body's background (see the stylesheet); every rule is scoped by the host class.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'sc-shell-scene', 'aria-hidden': 'true' },
})
export class ShellSceneComponent {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  readonly on = inject(BetaService).isEnabled('shell');
  readonly cam = inject(SceneCameraService);
  private readonly skyEl = viewChild<ElementRef<HTMLElement>>('sky');
  private readonly worldEl = viewChild<ElementRef<HTMLElement>>('world');
  private readonly focus = inject(WindowFocusService);
  private readonly slow = inject(SlowMotionService);
  private readonly zone = inject(NgZone);
  private sparkle: StarSparkle | null = null;

  /** Where the camera stands for the current URL (pose + push depth). */
  private at = sceneTargetOf(this.router.url);
  /** Last pointer-down in vw (the push-in aims there); null = centre of the view. */
  private pointer: { x: number; y: number } | null = null;

  /** The doors' pieces ride along with the camera while it leaves the hub (G1: one object, a camera move). */
  readonly carry = signal(false);
  private carryToken = 0;

  /** The live planet reports in (G1): the CSS planet steps back, the hub's entrance may go on. */
  onPlanet(state: 'drawn' | 'failed'): void {
    this.cam.planetState.set(state);
  }

  /** Object opacities and veil as custom properties (the stylesheet transitions them over the flight). */
  readonly vars = computed(() => {
    const def = POSES[this.cam.target()];
    const out: Record<string, string | number> = {
      '--scene-veil': Math.min(0.8, def.veil + (this.cam.pushed() ? SCENE_PUSH_VEIL : 0)),
      '--scene-move': `${this.cam.moveMs()}ms`,
    };
    for (const o of SCENE_OBJECTS) out[`--o-${o}`] = def.show[o] ?? 0;
    // The doors' pieces stand under the hub's doors (its lent layout).
    const doors = doorRects(this.cam.verseAnchors());
    for (const [d, r] of Object.entries(doors)) {
      out[`--r-${d}-x`] = `${r[0].toFixed(3)}vw`;
      out[`--r-${d}-y`] = `${r[1].toFixed(3)}vw`;
      out[`--r-${d}-s`] = `${r[2].toFixed(3)}vw`;
    }
    return out;
  });

  constructor() {
    const root = this.document.documentElement;
    const subs = this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) this.go(e.url);
      else if (e instanceof NavigationCancel || e instanceof NavigationError || e instanceof NavigationSkipped) this.go(this.router.url);
      else if (e instanceof NavigationEnd) this.go(e.urlAfterRedirects);
    });
    const onDown = (e: PointerEvent) => {
      const w = this.document.defaultView?.innerWidth || 1;
      this.pointer = { x: (e.clientX / w) * 100, y: (e.clientY / w) * 100 };
    };
    this.zone.runOutsideAngular(() => this.document.addEventListener('pointerdown', onDown, { capture: true, passive: true }));
    const stopFocus = this.focus.onChange((focused) => (focused ? this.sparkle?.resume() : this.sparkle?.pause()));
    const stopSlow = this.cam.reducedMotion() ? null : this.slow.start();
    let detach: (() => void) | null = null;
    inject(DestroyRef).onDestroy(() => {
      subs.unsubscribe();
      this.document.removeEventListener('pointerdown', onDown, { capture: true });
      stopFocus();
      stopSlow?.();
      this.sparkle?.stop();
      detach?.();
      root.removeAttribute(SCENE_HTML_ATTR);
    });
    effect(() => {
      const sky = this.skyEl()?.nativeElement;
      const world = this.worldEl()?.nativeElement;
      untracked(() => {
        detach?.();
        detach = null;
        this.sparkle?.stop();
        this.sparkle = null;
        if (!sky || !world) {
          root.removeAttribute(SCENE_HTML_ATTR);
          return;
        }
        root.setAttribute(SCENE_HTML_ATTR, '');
        detach = this.cam.attach(world, sky, this.at.pose);
        this.cam.pushed.set(this.at.depth > 0);
        if (this.cam.reducedMotion() || typeof sky.animate !== 'function') return;
        this.sparkle = this.zone.runOutsideAngular(() => new StarSparkle(sky, SPARKLE_COUNT, Math.random, (a) => this.slow.adopt(a)));
        if (!this.focus.focused()) this.sparkle.pause();
      });
    });
  }

  /** One navigation step: fly to the URL's pose (exposed for the spec). */
  go(url: string): void {
    const next = sceneTargetOf(url);
    const prev = this.at;
    if (next.pose === prev.pose && next.depth === prev.depth) return;
    this.at = next;
    const base = this.cam.camOf(next.pose);
    // Deeper than before: push in towards the click; shallower or a new pose: the pose itself (pull-out).
    const pushIn = next.depth > 0 && (next.pose !== prev.pose || next.depth > prev.depth);
    const dest: CameraPose = next.depth > 0 ? (pushIn ? this.pushPose(base) : this.cam.current()) : base;
    const ms = next.pose !== prev.pose ? SCENE_FLIGHT_MS : SCENE_PUSH_MS;
    this.cam.pushed.set(next.depth > 0);
    this.pointer = null;
    // Leaving the hub: its doors go with the page, the scene's pieces under them carry on with the camera.
    const token = ++this.carryToken;
    this.carry.set(prev.pose === 'verse' && next.pose !== 'verse');
    const flight = this.flyNamed(next.pose, dest, ms, next.depth > 0 && next.pose === prev.pose && !pushIn);
    void flight.then(() => {
      if (token === this.carryToken) this.carry.set(false);
    });
  }

  private flyNamed(pose: ScenePoseId, dest: CameraPose, ms: number, stay: boolean): Promise<void> {
    if (stay) {
      // Sideways between two detail pages: the camera stays pushed in.
      this.cam.target.set(pose);
      return Promise.resolve();
    }
    this.cam.target.set(pose);
    return this.cam.flyTo(dest, { durationMs: ms });
  }

  private pushPose(base: CameraPose): CameraPose {
    const w = this.document.defaultView;
    const px = this.pointer?.x ?? 50;
    const py = this.pointer?.y ?? (w ? ((w.innerHeight / (w.innerWidth || 1)) * 100) / 2 : 28);
    return zoomAbout(base, SCENE_PUSH_ZOOM, px, py);
  }
}
