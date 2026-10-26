import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { BetaService } from '../../core/beta.service';
import { SceneKind, SceneMode, isVerseHome, sceneOf, sceneStep } from './scene.model';

/** Reduced-motion check; a field so specs can swap it. */
export function sceneReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Scroll-driven animations run on the compositor; without them a passive listener feeds the offset. */
function supportsScrollTimeline(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timeline: scroll()');
}

/**
 * `<sc-shell-scene>` — the app's background, one fixed layer behind the page
 * (beta `shell` only; renders nothing otherwise). One camera over sky,
 * planet, hangar and the Codex data plane: a navigation to a main page
 * (`/verse`, `/hq`, `/codex`) moves the camera into that area's pose with CSS
 * transitions, so every one of the six directed routes plays from wherever
 * the camera stands; a sub-page target cuts to its main page's pose and
 * stays static; reduced motion dissolves instead of moving. On `/verse` the
 * planet scrolls with the page so the hub's planet zone stays on it.
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

  readonly scene = signal<SceneKind>(sceneOf(this.router.url));
  readonly mode = signal<SceneMode>('still');
  readonly from = signal<SceneKind | null>(null);
  readonly home = signal(isVerseHome(this.router.url));
  /** Flips per dissolve so the fade animation restarts. */
  readonly fadeTick = signal(0);

  /** Swappable for specs. */
  reducedMotion: () => boolean = sceneReducedMotion;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const sub = this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.apply(e.urlAfterRedirects);
    });
    destroyRef.onDestroy(() => sub.unsubscribe());

    // Fallback for browsers without scroll-driven animations: the planet
    // follows the page through one custom property.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    if (!supportsScrollTimeline() && typeof window !== 'undefined') {
      effect((onCleanup) => {
        if (!this.on() || !this.home()) {
          host.style.removeProperty('--scene-scroll');
          return;
        }
        let frame = 0;
        const write = (): void => {
          frame = 0;
          host.style.setProperty('--scene-scroll', `${Math.round(window.scrollY)}px`);
        };
        const onScroll = (): void => {
          if (!frame) frame = requestAnimationFrame(write);
        };
        write();
        window.addEventListener('scroll', onScroll, { passive: true });
        onCleanup(() => {
          window.removeEventListener('scroll', onScroll);
          if (frame) cancelAnimationFrame(frame);
        });
      });
    }
  }

  /** One navigation: decide the step, set the pose. Exposed for the spec. */
  apply(url: string): void {
    this.home.set(isVerseHome(url));
    const step = sceneStep(this.scene(), url, this.reducedMotion());
    if (!step) {
      // Same pose: keep the last mode, so a running camera move is never cut short.
      return;
    }
    this.from.set(this.scene());
    this.mode.set(step.mode);
    if (step.mode === 'fade') this.fadeTick.update((t) => t + 1);
    this.scene.set(step.scene);
  }
}
