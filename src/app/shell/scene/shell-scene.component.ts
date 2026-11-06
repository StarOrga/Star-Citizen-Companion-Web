import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, ViewEncapsulation, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { BetaService } from '../../core/beta.service';
import { WindowFocusService } from '../../core/window-focus.service';
import { POSES, SceneKind, SceneMode, flightMs, isSubPage, sceneOf, sceneStep } from './scene.model';
import { StarSparkle } from './star-sparkle';
import { VerseWorld, verseWorldOf } from '../../verse/shared/verse-world';

/** Reduced-motion check; a field so specs can swap it. */
export function sceneReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * `<sc-shell-scene>` — the app's background, one fixed layer behind the page
 * (beta `shell` only; renders nothing otherwise). One camera over the sky,
 * the Codex holo glow and the HQ night surface: a navigation to a main page
 * (`/verse`, `/hq`, `/codex`) moves the camera into that area's pose with CSS
 * transitions (duration from the pose distance), so every route flies directly
 * from wherever the camera stands, an interrupted flight re-targets without a jump; a sub-page target cuts to its main page's pose and
 * stays static; reduced motion dissolves instead of moving. A sub-page
 * (`data-sub`) shows only the dimmed sky of its area.
 *
 * No View Transitions: the pose is plain state on one element, the
 * transitions run in a hidden tab and in a spec alike.
 */
@Component({
  selector: 'sc-shell-scene',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell-scene.component.html',
  styleUrl: './shell-scene.component.scss',
  // Global on purpose: it has to clear body's background (see the stylesheet); every rule is scoped by the host class.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'sc-shell-scene', 'aria-hidden': 'true' },
})
export class ShellSceneComponent {
  private readonly router = inject(Router);
  readonly on = inject(BetaService).isEnabled('shell');
  private readonly skyEl = viewChild<ElementRef<HTMLElement>>('sky');
  private readonly focus = inject(WindowFocusService);
  private readonly zone = inject(NgZone);
  private sparkle: StarSparkle | null = null;

  readonly scene = signal<SceneKind>(sceneOf(this.router.url));
  readonly mode = signal<SceneMode>('still');
  readonly from = signal<SceneKind | null>(null);
  /** Not a main page: deep space without the area's set pieces. */
  readonly sub = signal(isSubPage(this.router.url));
  /** A Verse subpage: a faint halo in its planet's colour (concept 2026-10-28 §3). */
  readonly world = signal<VerseWorld | null>(verseWorldOf(this.router.url));
  /** Flips per dissolve so the fade animation restarts. */
  readonly fadeTick = signal(0);
  /** Length of the current flight, written to `--scene-move`. */
  readonly moveMs = signal(0);
  readonly pose = computed(() => POSES[this.scene()]);

  /** Swappable for specs. */
  reducedMotion: () => boolean = sceneReducedMotion;

  constructor() {
    const sub = this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.apply(e.urlAfterRedirects);
    });
    const stopFocus = this.focus.onChange((focused) => (focused ? this.sparkle?.resume() : this.sparkle?.pause()));
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      stopFocus();
      this.sparkle?.stop();
    });
    effect(() => {
      const sky = this.skyEl()?.nativeElement;
      untracked(() => {
        this.sparkle?.stop();
        this.sparkle = null;
        if (!sky || this.reducedMotion() || typeof sky.animate !== 'function') return;
        this.sparkle = this.zone.runOutsideAngular(() => new StarSparkle(sky));
        if (!this.focus.focused()) this.sparkle.pause();
      });
    });
  }

  /** One navigation: decide the step, set the pose. Exposed for the spec. */
  apply(url: string): void {
    this.sub.set(isSubPage(url));
    this.world.set(verseWorldOf(url));
    const step = sceneStep(this.scene(), url, this.reducedMotion());
    if (!step) {
      // Same pose: keep the last mode, so a running camera move is never cut short.
      return;
    }
    this.from.set(this.scene());
    this.mode.set(step.mode);
    this.moveMs.set(step.mode === 'move' ? flightMs(this.scene(), step.scene) : 0);
    if (step.mode === 'fade') this.fadeTick.update((t) => t + 1);
    this.scene.set(step.scene);
  }
}
