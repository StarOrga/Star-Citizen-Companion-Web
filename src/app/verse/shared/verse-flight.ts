import { DOCUMENT, Injectable, Injector, NgZone, afterNextRender, inject } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, ResolveFn, Router } from '@angular/router';
import {
  VERSE_EMBLEM_TRANSITION_NAME,
  VERSE_FLY_ATTR,
  VerseFlightDirection,
  VerseWorld,
  verseFlightOf,
  verseFrameOf,
} from './verse-world';
import { BetaService } from '../../core/beta.service';

/** Upper bound of the frozen snapshot: past it the update callback settles regardless (slow chunk, lost router event). */
const LANDING_CAP_MS = 3000;

/** Reduced-motion check. */
export function flightReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The flight between the Verse hub and its subpages (concept 2026-10-28 §4):
 * one View Transition per frame hop, nothing else in the app.
 *
 *   down  hub → subpage: the hub rolls up and away (like scrolling down), the
 *         clicked planet flies to the head's 64px emblem, the page rises in
 *   up    subpage → hub (logo, subheader back link, browser back): the
 *         reverse — the page sinks, the emblem returns to its planet
 *   side  subpage → subpage: the page rolls up, the next planet rises into
 *         the emblem slot
 *
 * Why a route resolver and not the router's `withViewTransitions`: that opens
 * a transition for EVERY navigation and would abort the Codex set ⇄ arsenal
 * hop, which starts its own (see codex/set/set-arsenal-transition.ts). The
 * resolver (`verseFlightResolver`, on the five frame routes) runs last before
 * activation: it starts the transition, waits until the browser has captured
 * the old page, then lets the router activate; the update callback settles
 * after the new page's first render.
 *
 * The shared name `verse-emblem` sits statically on the head's emblem; on the
 * hub it is put on the flight source (`[data-verse-fly="news"]` …) only while
 * the hub is captured. Choreography: `src/styles.scss`, "VERSE FLIGHT".
 * Without the API, in a hidden tab or under reduced motion no transition
 * starts — the page's own entrance (`.sc-enter`, a fade under reduced motion)
 * is the crossfade.
 */
@Injectable({ providedIn: 'root' })
export class VerseFlight {
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly verseBeta = inject(BetaService).isEnabled('verse');

  private lastUrl: string | null = null;
  private clicked: HTMLElement | null = null;
  private running = false;

  /** Only the Verse β pages carry the emblem the flight lands on; swappable for specs. */
  enabled: () => boolean = () => this.verseBeta();
  /** Swappable for specs. */
  reducedMotion: () => boolean = flightReducedMotion;
  /** A hidden tab aborts every transition; swappable for specs (the Karma window may be in the background). */
  hidden: () => boolean = () => this.document.visibilityState !== 'visible';

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.lastUrl = e.urlAfterRedirects;
    });
    // Remember which flight source a click came from; capture phase, before the router reacts.
    this.document.addEventListener(
      'click',
      (e) => {
        const t = e.target instanceof Element ? e.target : null;
        const anchor = t?.closest('a');
        this.clicked =
          (t?.closest<HTMLElement>(`[${VERSE_FLY_ATTR}]`) ??
            (anchor?.matches(`[${VERSE_FLY_ATTR}]`) ? (anchor as HTMLElement) : anchor?.querySelector<HTMLElement>(`[${VERSE_FLY_ATTR}]`))) ??
          null;
      },
      true,
    );
  }

  /** The direction a navigation to `url` would fly, or null. Exposed for the spec. */
  directionTo(url: string): VerseFlightDirection | null {
    return verseFlightOf(this.lastUrl, url);
  }

  /**
   * Starts the flight for a navigation to `url` if it is a frame hop; resolves
   * once the old page is captured (null right away when nothing flies).
   */
  begin(url: string): Promise<null> | null {
    const dir = this.directionTo(url);
    const doc = this.document;
    const from = this.lastUrl ? verseFrameOf(this.lastUrl) : null;
    const to = verseFrameOf(url);
    if (
      !dir || !from || !to || this.running ||
      !this.enabled() ||
      typeof doc.startViewTransition !== 'function' ||
      this.hidden() ||
      this.reducedMotion()
    ) {
      this.clicked = null;
      return null;
    }

    const root = doc.documentElement;
    const named: HTMLElement[] = [];
    const nameEl = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.setProperty('view-transition-name', VERSE_EMBLEM_TRANSITION_NAME);
      named.push(el);
    };
    const unname = () => named.splice(0).forEach((el) => el.style.removeProperty('view-transition-name'));
    const cleanup = () => {
      unname();
      delete root.dataset['verseFlight'];
      this.running = false;
    };

    if (dir === 'down') nameEl(this.source(to as VerseWorld));
    this.clicked = null;
    root.dataset['verseFlight'] = dir;
    this.running = true;

    return new Promise<null>((started) => {
      let transition: ViewTransition;
      try {
        transition = doc.startViewTransition(() =>
          this.zone.run(() => {
            // The hub is captured: its source drops the name (a cancelled hop keeps the hub).
            unname();
            started(null);
            return this.landed(dir, from, nameEl);
          }),
        );
      } catch {
        cleanup();
        started(null);
        return;
      }
      transition.ready.catch(() => undefined);
      transition.updateCallbackDone.catch(() => undefined);
      transition.finished.then(cleanup, cleanup);
      // Never hold the navigation hostage: a skipped transition may not call back in time.
      setTimeout(() => started(null), 500);
    });
  }

  /** Settles after the navigation ended and the new page rendered; on `up` names the hub's planet first. */
  private landed(dir: VerseFlightDirection, from: string, nameEl: (el: HTMLElement | null) => void): Promise<void> {
    return new Promise((done) => {
      let settled = false;
      let sub: { unsubscribe(): void } | undefined;
      const resolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(cap);
        sub?.unsubscribe();
        done();
      };
      const cap = setTimeout(resolve, LANDING_CAP_MS);
      const land = () =>
        afterNextRender(
          {
            read: () => {
              if (dir === 'up' && from !== 'hub') {
                // Named until the flight is over (the cleanup drops it).
                nameEl(this.source(from as VerseWorld));
              }
              setTimeout(resolve);
            },
          },
          { injector: this.injector },
        );
      // The 500 ms release in begin() can let the navigation finish before this callback runs.
      if (!this.router.currentNavigation()) {
        land();
        return;
      }
      sub = this.router.events.subscribe((e) => {
        if (!(e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError || e instanceof NavigationSkipped)) return;
        if (e instanceof NavigationEnd) land();
        else resolve();
      });
    });
  }

  /** The hub element that flies for `world`: the clicked one, else the first in view. */
  private source(world: VerseWorld): HTMLElement | null {
    const c = this.clicked;
    if (c?.isConnected && c.getAttribute(VERSE_FLY_ATTR) === world) return c;
    const vh = this.document.defaultView?.innerHeight ?? 0;
    const all = Array.from(this.document.querySelectorAll<HTMLElement>(`[${VERSE_FLY_ATTR}="${world}"]`));
    return (
      all.find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < vh;
      }) ?? null
    );
  }
}

/** On the five Verse frame routes (hub + four subpages): starts the flight, see {@link VerseFlight}. */
export const verseFlightResolver: ResolveFn<null> = (_route, state) => inject(VerseFlight).begin(state.url) ?? null;
