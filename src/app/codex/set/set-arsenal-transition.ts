import { DOCUMENT, ErrorHandler, Injectable, Injector, NgZone, afterNextRender, inject, signal } from '@angular/core';
import { Router, UrlTree } from '@angular/router';

/**
 * The one shared `view-transition-name` of the set ⇄ arsenal hop: the source
 * carries it while the browser captures the old page, the destination while it
 * captures the new one. The global CSS for it lives in `src/styles.scss`,
 * "SET ⇄ ARSENAL VIEW TRANSITION".
 */
export const SET_SLOT_TRANSITION_NAME = 'set-slot';

export type SetArsenalDirection = 'toArsenal' | 'toSet';

export interface SetArsenalHop {
  slot: string;
  direction: SetArsenalDirection;
}

/**
 * The set ⇄ arsenal hop: an open slot's tile grows into the arsenal's header
 * band, and after an armour equip the band shrinks back into its tile.
 *
 * Deliberately not the router's `withViewTransitions`: that opens a view
 * transition for EVERY navigation, so keeping the others instant means
 * skipping each one — and the router reports every skipped transition as an
 * error in dev mode ("Transition was skipped", or "…invalid state" in a hidden
 * tab). Here only this hop ever starts a transition; every other navigation in
 * the app never touches the API.
 */
@Injectable({ providedIn: 'root' })
export class SetArsenalTransition {
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly injector = inject(Injector);
  private readonly errors = inject(ErrorHandler);
  private readonly document = inject(DOCUMENT);
  private inFlight: Promise<boolean> | null = null;

  /**
   * The hop in flight, from the moment the page starts to change until the
   * transition is over. The DESTINATION reads it while it renders: its element
   * takes the shared name only while `active()` names its slot and direction,
   * so the name disappears on its own once the hop is over (two elements with
   * the same name on one page would abort the next transition).
   */
  readonly active = signal<SetArsenalHop | null>(null);

  /** Whether the running hop lands on `slot` coming in `direction` — the destination's naming test. */
  isLandingOn(slot: string | null | undefined, direction: SetArsenalDirection): boolean {
    const a = this.active();
    return !!a && !!slot && a.slot === slot && a.direction === direction;
  }

  /**
   * Navigates to `target` and morphs `source` into the element the destination
   * names for `hop`. A plain navigation without a source, without the View
   * Transition API or under prefers-reduced-motion. Resolves like
   * `Router.navigateByUrl`, except that a failed navigation goes to the
   * ErrorHandler and resolves `false` — callers fire and forget. A second hop
   * while one is still changing the page is the same hop (a double click).
   */
  hop(target: UrlTree, hop: SetArsenalHop, source: HTMLElement | null): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    if (!source || typeof this.document.startViewTransition !== 'function' || prefersReducedMotion()) {
      return this.navigate(target);
    }
    const run = new Promise<boolean>((resolve) => {
      nameForTransition(source, true);
      let transition: ViewTransition;
      try {
        transition = this.document.startViewTransition(() =>
          // The browser calls this outside Angular's zone, once the old page is captured.
          this.zone.run(async () => {
            nameForTransition(source, false);
            this.active.set(hop);
            const ok = await this.navigate(target);
            resolve(ok);
            // The new page is captured when this settles — after its first render.
            if (ok) await this.rendered();
          }),
        );
      } catch {
        nameForTransition(source, false);
        resolve(this.navigate(target));
        return;
      }
      const done = () => {
        nameForTransition(source, false);
        if (this.active() === hop) this.active.set(null);
      };
      // A skipped or aborted transition (another one started, hidden tab)
      // rejects these; the page change itself runs either way.
      transition.ready.catch(() => undefined);
      transition.updateCallbackDone.catch(() => undefined);
      transition.finished.then(done, done);
    });
    this.inFlight = run;
    const release = () => {
      if (this.inFlight === run) this.inFlight = null;
    };
    run.then(release, release);
    return run;
  }

  private navigate(target: UrlTree): Promise<boolean> {
    return this.router.navigateByUrl(target).catch((err: unknown) => {
      this.errors.handleError(err);
      return false;
    });
  }

  /** Settles after the next render and the microtasks it queued — what the router waits for, too. */
  private rendered(): Promise<void> {
    return new Promise((resolve) => {
      afterNextRender({ read: () => setTimeout(resolve) }, { injector: this.injector });
    });
  }
}

/**
 * Sets or clears the shared transition name on one element. Two elements with
 * the same name on one page abort the transition, so it never stays behind.
 */
export function nameForTransition(el: HTMLElement | null, on: boolean): void {
  if (!el) return;
  el.style.setProperty('view-transition-name', on ? SET_SLOT_TRANSITION_NAME : null);
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
