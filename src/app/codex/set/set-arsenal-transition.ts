import { Injectable, inject, signal } from '@angular/core';
import type { ViewTransitionInfo } from '@angular/router';

/**
 * The one shared `view-transition-name` of the set ⇄ arsenal hop. The set page
 * puts it on the clicked slot tile right before it navigates (source), the
 * arsenal list on its header band (destination) — and the other way round on
 * the way back. The global CSS for it lives in `src/styles.scss`,
 * "SET ⇄ ARSENAL VIEW TRANSITION".
 */
export const SET_SLOT_TRANSITION_NAME = 'set-slot';

export type SetArsenalDirection = 'toArsenal' | 'toSet';

export interface ArmedSetArsenalHop {
  slot: string;
  direction: SetArsenalDirection;
}

/** How long an armed hop waits for its navigation before it lapses. */
export const ARM_TTL_MS = 2000;

/**
 * One-shot permission for the router's view transition. The router is set up
 * with `withViewTransitions`, but only the set ⇄ arsenal hop may animate: the
 * page arms this right before navigating, `onViewTransitionCreated`
 * consumes it, and every navigation that finds nothing armed skips its
 * transition at once. An arm that no navigation picks up expires after
 * {@link ARM_TTL_MS}, so a cancelled click can never animate a later,
 * unrelated navigation.
 */
@Injectable({ providedIn: 'root' })
export class SetArsenalTransition {
  private armed: (ArmedSetArsenalHop & { at: number }) | null = null;

  /**
   * The hop whose transition is running right now, from the moment the router
   * created it until it finished. The DESTINATION reads it while it renders:
   * its element takes the shared name only while `active()` names its slot and
   * direction, so the name disappears on its own once the hop is over (two
   * elements with the same name on one page would abort the next transition).
   */
  readonly active = signal<ArmedSetArsenalHop | null>(null);

  arm(slot: string, direction: SetArsenalDirection): void {
    this.armed = { slot, direction, at: Date.now() };
  }

  /** The armed hop, once — `null` when nothing is armed or it has expired. */
  consume(): ArmedSetArsenalHop | null {
    const a = this.armed;
    this.armed = null;
    if (!a || Date.now() - a.at > ARM_TTL_MS) return null;
    return { slot: a.slot, direction: a.direction };
  }

  /** Whether the running hop lands on `slot` coming in `direction` — the destination's naming test. */
  isLandingOn(slot: string | null | undefined, direction: SetArsenalDirection): boolean {
    const a = this.active();
    return !!a && !!slot && a.slot === slot && a.direction === direction;
  }
}

/**
 * Sets or clears the shared transition name on one element. Set it on the
 * source right before `router.navigate` / the anchor's default action, and on
 * the destination when it renders; clear both once the transition is done
 * (two elements with the same name on one page abort the transition).
 */
export function nameForTransition(el: HTMLElement | null, on: boolean): void {
  if (!el) return;
  el.style.setProperty('view-transition-name', on ? SET_SLOT_TRANSITION_NAME : null);
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * `withViewTransitions({ onViewTransitionCreated })` — runs in an injection
 * context. Lets the transition run only for an armed set ⇄ arsenal hop and
 * never under prefers-reduced-motion; everything else skips immediately, so
 * the app's other navigations stay exactly as instant as before.
 */
export function onSetArsenalViewTransition({ transition }: ViewTransitionInfo): void {
  const svc = inject(SetArsenalTransition);
  const hop = svc.consume();
  // A skipped transition (ours below, or the browser's on a name clash) rejects
  // `ready` with an AbortError that nothing else awaits — left alone, every
  // ordinary navigation logs "Transition was skipped" as an error.
  Promise.resolve(transition.ready).catch(() => undefined);
  if (!hop || prefersReducedMotion()) {
    transition.skipTransition();
    return;
  }
  svc.active.set(hop);
  // `finished` settles either way (done, skipped, aborted) — the name must go in every case.
  const clear = () => {
    if (svc.active() === hop) svc.active.set(null);
  };
  Promise.resolve(transition.finished).then(clear, clear);
}
