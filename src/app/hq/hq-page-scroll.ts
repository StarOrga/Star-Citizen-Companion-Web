import { NgZone } from '@angular/core';
import { glideEase, inScroller, keyDirection, typing } from '../verse/pages/briefing/briefing-dock';
import { HQ_PAGES, HqPageId } from './hq-routes';
import { CDK_SCROLL_BLOCK_CLASS, pageScrollY } from '../core/page-scroll-y';

/** Length of a glide from one HQ page to the next. */
export const PAGE_GLIDE_MS = 700;
/** From here on the rail stands beside the pages; below it the phone bar and touch scrolling rule. */
export const PAGE_SCROLL_MIN_WIDTH = 1024;
/** After a glide: wheel events this close together are the touchpad's inertia, not a new gesture. */
export const PAGE_INERTIA_MS = 160;
/** A scroll that overshoots a page's end by less than this share of the viewport stays on that page. */
export const PAGE_OVERSHOOT = 0.25;

const EPS = 2;

/** Where the viewport may rest on one page: its top, down to where its end meets the viewport's end. */
export interface PageRange {
  top: number;
  bottom: number;
}

/** What a gesture does: leave it to the browser (`null`), or glide to a position. */
export function pageStep(y: number, ranges: readonly PageRange[], dir: number): number | null {
  const i = ranges.findIndex((r) => y >= r.top - EPS && y <= r.bottom + EPS);
  if (i === -1) return settleTarget(y, ranges, dir, 0);
  if (dir > 0) return y < ranges[i].bottom - EPS ? null : (ranges[i + 1]?.top ?? null);
  if (dir < 0) return y > ranges[i].top + EPS ? null : (ranges[i - 1]?.bottom ?? null);
  return null;
}

/**
 * Where a scroll that stopped between two pages finishes: in its direction; a small overshoot past
 * a page's end (a wheel tick while reading a long page) falls back to that end. Null when the
 * position is a valid resting place.
 */
export function settleTarget(y: number, ranges: readonly PageRange[], dir: number, viewport: number): number | null {
  const next = ranges.findIndex((r) => r.top - EPS > y);
  if (next <= 0) return null;
  const prev = ranges[next - 1];
  if (y <= prev.bottom + EPS) return null;
  const room = viewport * PAGE_OVERSHOOT;
  if (dir > 0) return y - prev.bottom < room ? prev.bottom : ranges[next].top;
  if (dir < 0) return ranges[next].top - y < room ? ranges[next].top : prev.bottom;
  return y - prev.bottom < ranges[next].top - y ? prev.bottom : ranges[next].top;
}

/**
 * Whole-page scrolling on the HQ landing (the Verse hub's glide, `briefing-dock.ts`, with more than
 * two stops): a gesture on a page that fits the viewport glides to the next page, and a scroll
 * never comes to rest with half of two pages on screen. A page TALLER than the viewport scrolls
 * normally until its end, because otherwise its lower part could never be read; the next gesture
 * then glides on. Only with the rail (wide screens) and without reduced motion.
 */
export function wireHqPageScroll(sections: () => readonly HTMLElement[], zone: NgZone): () => void {
  const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const wide = typeof matchMedia === 'function' ? matchMedia(`(min-width: ${PAGE_SCROLL_MIN_WIDTH}px)`) : null;
  let glideFrame = 0;
  let quietUntil = 0;
  let lastY = window.scrollY;
  let lastDir = 0;

  // A modal overlay blocks the page scroll: no glide behind it, and its frozen offset is no stop.
  const active = (): boolean =>
    !!wide?.matches && !reduce?.matches && !document.documentElement.classList.contains(CDK_SCROLL_BLOCK_CLASS);
  const maxScroll = (): number => document.documentElement.scrollHeight - window.innerHeight;

  const ranges = (): PageRange[] => {
    const vh = window.innerHeight;
    const out = sections().map((el, i) => {
      const r = el.getBoundingClientRect();
      const top = i === 0 ? 0 : Math.round(r.top + window.scrollY);
      return { top, bottom: Math.max(top, Math.round(r.bottom + window.scrollY - vh)) };
    });
    // The footer belongs to the last page.
    if (out.length) out[out.length - 1].bottom = Math.max(out[out.length - 1].top, maxScroll());
    return out;
  };

  const stopGlide = (): void => {
    if (glideFrame) cancelAnimationFrame(glideFrame);
    glideFrame = 0;
  };

  const glideTo = (to: number): void => {
    stopGlide();
    const from = window.scrollY;
    const t0 = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / PAGE_GLIDE_MS);
      window.scrollTo({ top: from + (to - from) * glideEase(t), behavior: 'instant' });
      if (t < 1) {
        glideFrame = requestAnimationFrame(step);
      } else {
        glideFrame = 0;
        quietUntil = performance.now() + PAGE_INERTIA_MS;
      }
    };
    glideFrame = requestAnimationFrame(step);
  };

  const onWheel = (e: WheelEvent): void => {
    if (!active() || e.ctrlKey || !e.deltaY || inScroller(e.target as Element | null)) return;
    const now = performance.now();
    if (glideFrame || now < quietUntil) {
      if (!glideFrame) quietUntil = now + PAGE_INERTIA_MS;
      e.preventDefault();
      return;
    }
    const to = pageStep(window.scrollY, ranges(), Math.sign(e.deltaY));
    if (to === null) return;
    e.preventDefault();
    glideTo(to);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Home' || e.key === 'End') return;
    const dir = keyDirection(e);
    if (!dir || !active() || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target as Element | null)) return;
    // Space on a control presses it, it does not scroll.
    if (e.key === ' ' && (e.target as Element | null)?.closest?.('button, a, summary, [role="button"]')) return;
    if (glideFrame) {
      e.preventDefault();
      return;
    }
    const to = pageStep(window.scrollY, ranges(), dir);
    if (to === null) return;
    e.preventDefault();
    glideTo(to);
  };

  const onScroll = (): void => {
    const y = pageScrollY();
    if (y !== lastY) lastDir = Math.sign(y - lastY);
    lastY = y;
  };

  // A scroll that stopped between two pages (scrollbar, focus, find in page, a long wheel run).
  const onScrollEnd = (): void => {
    if (glideFrame || !active()) return;
    const to = settleTarget(window.scrollY, ranges(), lastDir, window.innerHeight);
    if (to !== null && Math.abs(to - window.scrollY) > EPS) glideTo(to);
  };

  zone.runOutsideAngular(() => {
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', onScrollEnd);
  });

  return () => {
    stopGlide();
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('scrollend', onScrollEnd);
  };
}

const OPEN_DIALOG = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';

function dialogOpen(): boolean {
  return Array.from(document.querySelectorAll(OPEN_DIALOG)).some((d) => d.checkVisibility?.() ?? true);
}

/** The page a key press jumps to: digits 1 to 4, never with a modifier, while typing or under a dialog. */
export function hotkeyPage(e: KeyboardEvent, underDialog: boolean = dialogOpen()): HqPageId | null {
  if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (!/^[1-4]$/.test(e.key) || underDialog || typing(e.target as Element | null)) return null;
  return HQ_PAGES[Number(e.key)] ?? null;
}

/** Hotkeys 1 to 4 on the landing: Bestand, Jetzt, Planen, Statistik. */
export function wireHqPageHotkeys(go: (page: HqPageId) => void, zone: NgZone): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const page = hotkeyPage(e);
    if (!page) return;
    e.preventDefault();
    zone.run(() => go(page));
  };
  zone.runOutsideAngular(() => window.addEventListener('keydown', onKey));
  return () => window.removeEventListener('keydown', onKey);
}
