import { NgZone, Signal, signal } from '@angular/core';
import { DOCK_GLIDE_MS, DOCK_MIN_WIDTH, glideEase, inScroller, keyDirection, typing } from '../verse/pages/briefing/briefing-dock';

/**
 * The "Mehr im Verse" scroll mechanism (verse/pages/briefing/briefing-dock.ts)
 * for a page that is a stage on top and one tall lower part under it (the
 * Codex: landing, then the overview). Same rules as the Verse dock:
 * a scroll gesture (wheel, keys) on the stage glides all the way to the lower
 * part ({@link DOCK_GLIDE_MS}), an upward gesture at the top of the lower part
 * glides back to the stage, and a scroll that stops half way (scrollbar, focus,
 * find in page) finishes in the direction it went — never a half-and-half
 * picture. Inside the lower part the page scrolls natively (it is longer than
 * a viewport). Narrow screens and reduced motion keep the browser's own scroll.
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
  let glideFrame = 0;
  let lastY = window.scrollY;
  let lastDir = 0;
  let lastScrollAt = 0;
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
  const stopGlide = (): void => {
    if (glideFrame) cancelAnimationFrame(glideFrame);
    glideFrame = 0;
  };
  const glide = (dir: number): boolean => {
    if (!active()) return false;
    const to = partTarget(window.scrollY, start(), dir);
    if (to === null) return false;
    stopGlide();
    const from = window.scrollY;
    const ms = Math.max(400, DOCK_GLIDE_MS * Math.min(1, Math.abs(to - from) / Math.max(1, start())));
    const t0 = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / ms);
      window.scrollTo({ top: from + (to - from) * glideEase(t), behavior: 'instant' });
      glideFrame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    zone.runOutsideAngular(() => (glideFrame = requestAnimationFrame(step)));
    return true;
  };

  const onWheel = (e: WheelEvent): void => {
    if (!active() || e.ctrlKey || !e.deltaY || inScroller(e.target as Element | null)) return;
    // The hologram zooms on the wheel: that turn is not the page's.
    if ((e.target as Element | null)?.closest?.('model-viewer')) return;
    const dir = Math.sign(e.deltaY);
    // The inertia of a native scroll up through the lower part must not flip straight on to the stage.
    if (dir < 0 && !glideFrame && performance.now() - lastScrollAt < 160 && lastDir < 0) return;
    if (glideFrame || glide(dir)) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent): void => {
    const dir = keyDirection(e);
    if (!dir || !active() || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target as Element | null)) return;
    if (e.key === ' ' && (e.target as Element | null)?.closest?.('button, a, summary, [role="button"]')) return;
    if (glideFrame || glide(dir)) e.preventDefault();
  };
  const onScroll = (): void => {
    const y = window.scrollY;
    if (y !== lastY) lastDir = Math.sign(y - lastY);
    lastY = y;
    lastScrollAt = performance.now();
    sync();
  };
  const onScrollEnd = (): void => {
    if (glideFrame || !active()) return;
    const y = window.scrollY;
    const s = start();
    if (y > 1 && y < s - 1) glide(lastDir || (y > s / 2 ? 1 : -1));
  };

  zone.runOutsideAngular(() => {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', onScrollEnd);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', sync);
  });
  sync();

  return {
    state: state.asReadonly(),
    glide,
    jumpToLower: () => {
      stopGlide();
      window.scrollTo({ top: start(), behavior: 'instant' });
      sync();
    },
    destroy: () => {
      stopGlide();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('scrollend', onScrollEnd);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', sync);
    },
  };
}
