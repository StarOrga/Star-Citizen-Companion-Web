import { NgZone, Signal, signal } from '@angular/core';
import { onScrollTick } from '../core/scroll-tick';
import { DOCK_MIN_WIDTH, scrollToSmooth, wireSnap } from '../verse/pages/briefing/briefing-dock';

/**
 * The "Mehr im Verse" scroll mechanism (verse/pages/briefing/briefing-dock.ts)
 * for a page that is a stage on top and one tall lower part under it (the
 * Codex: landing, then the overview). Same rules as the Verse dock, now as
 * native CSS scroll-snap ({@link wireSnap}): stage and lower part are the two
 * snap areas, so a scroll gesture on the stage finishes on the lower part, an
 * upward one at the top of the lower part finishes on the stage, and a scroll
 * that stops half way (scrollbar, focus, find in page) never shows a
 * half-and-half picture. Inside the lower part the page scrolls freely (it is
 * longer than a viewport). Narrow screens and reduced motion keep the
 * browser's own scroll. The scripted rAF glide is gone.
 */

export type PartState = 'top' | 'fly' | 'docked';

/** Where the lower part starts, as a scroll position: its top edge under the docked header. */
export function lowerStart(el: HTMLElement, scrollY = window.scrollY): number {
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  return Math.max(0, Math.round(el.getBoundingClientRect().top + scrollY - margin));
}

/** The part the scroll position stands in, for the lower part starting at `start`. */
export function partState(y: number, start: number): PartState {
  if (start <= 1 || y <= 1) return 'top';
  return y >= start - 1 ? 'docked' : 'fly';
}

/** Where a gesture goes: down from the stage to the lower part, up from the lower part's start to the stage; null = the page scrolls on its own. */
export function partTarget(y: number, start: number, dir: number): number | null {
  if (start <= 1) return null;
  if (dir > 0) return y < start - 1 ? start : null;
  if (dir < 0) return y > 1 && y <= start + 1 ? 0 : null;
  return null;
}

export interface PageGlide {
  readonly state: Signal<PartState>;
  /** Glides to the lower part (dir > 0) or the stage (dir < 0); false when it did not take over. */
  glide(dir: number): boolean;
  /** Jumps to the lower part without animation (deep link). */
  jumpToLower(): void;
  destroy(): void;
}

export function wirePageGlide(lower: () => HTMLElement | null, zone: NgZone, onState?: (state: PartState) => void): PageGlide {
  const state = signal<PartState>('top');
  const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const wide = typeof matchMedia === 'function' ? matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`) : null;
  const start = (): number => {
    const el = lower();
    return el ? lowerStart(el) : 0;
  };
  const active = (): boolean => !!wide?.matches && !reduce?.matches;

  const sync = (): void => {
    const next = partState(window.scrollY, start());
    if (next !== state()) {
      zone.run(() => {
        state.set(next);
        onState?.(next);
      });
    }
    // The cue fades with the scroll, like the Verse one (--dock).
    const s = start();
    document.querySelector<HTMLElement>('.cx-more-cue')?.style.setProperty('--dock', (s > 1 ? Math.min(1, window.scrollY / s) : 0).toFixed(3));
  };
  const glide = (dir: number): boolean => {
    if (!active()) return false;
    const to = partTarget(window.scrollY, start(), dir);
    if (to === null) return false;
    scrollToSmooth(to);
    return true;
  };
  let offScroll = (): void => undefined;
  // The stage (the lower part's previous sibling) and the lower part are the two snap areas.
  const releaseSnap = wireSnap(() => [lower()?.previousElementSibling as HTMLElement | null, lower()], { zone });

  zone.runOutsideAngular(() => {
    offScroll = onScrollTick(sync);
    window.addEventListener('resize', sync);
  });
  sync();

  return {
    state: state.asReadonly(),
    glide,
    jumpToLower: () => {
      window.scrollTo({ top: start(), behavior: 'instant' });
      sync();
    },
    destroy: () => {
      releaseSnap();
      offScroll();
      window.removeEventListener('resize', sync);
    },
  };
}

/** Longest a deep link to the lower part keeps re-landing on it while the page grows. */
export const LOWER_HOLD_MS = 10_000;

/**
 * A deep link to the lower part (`/codex#more`) lands on it although the page is still
 * growing (data, the stage load after the first render): re-land on every layout growth
 * until the reader takes over. The reader takes over with ANY own move — wheel, touch,
 * key, pointer, or a scroll that is not the hold's own (scrollbar, find in page) — and
 * from then on the hold never touches the scroll again (admin feedback #319: scrolling
 * up from the lower part must not be pulled back down). Returns the stop function.
 */
export function holdOnLower(
  g: Pick<PageGlide, 'jumpToLower'>,
  start: () => number,
  onStop: () => void,
  ms = LOWER_HOLD_MS,
): () => void {
  let on = true;
  let placed = -1;
  const land = (): void => {
    if (!on) return;
    g.jumpToLower();
    placed = window.scrollY;
  };
  const onScroll = (): void => {
    // A scroll away from where the hold put the page is the reader's (the router's own
    // anchor scroll lands on the lower part too, that one is not).
    const y = window.scrollY;
    if (placed >= 0 && Math.abs(y - placed) > 2 && Math.abs(y - start()) > 2) stop();
  };
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => land());
  const userEvents = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  const stop = (): void => {
    if (!on) return;
    on = false;
    ro?.disconnect();
    clearTimeout(timer);
    for (const t of userEvents) window.removeEventListener(t, stop, true);
    offScroll();
    onStop();
  };
  const offScroll = onScrollTick({ read: onScroll });
  const timer = setTimeout(stop, ms);
  for (const t of userEvents) window.addEventListener(t, stop, { capture: true, passive: true });
  ro?.observe(document.body);
  land();
  return stop;
}
