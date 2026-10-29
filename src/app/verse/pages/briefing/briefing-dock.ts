import { NgZone, Signal, signal } from '@angular/core';
import { TX_DOORS } from './briefing-transmit.component';

/**
 * The scroll from the stage down to the hub (β shell): the page has two parts,
 * the stage on top and the hub columns plus footer below, one viewport each.
 * While the reader scrolls, the stage's three planets (with their area word)
 * fly into the hub's column heads and take the place of the mini planet and
 * the head's word — the hub's own mini planets and words only show once the
 * flight has landed, so there is always one planet and one word per area.
 *
 * Progress is the scroll position over the whole scroll range (the hub plus
 * the footer fill the last viewport), eased. Positions are taken from the
 * untransformed layout every frame, so late images, fonts or a resize never
 * leave a planet off its slot. Flight only with three hub columns (> 900px)
 * and without reduced motion; otherwise the hub keeps its own heads.
 *
 * With the flight on, the page knows only its two ends: a scroll gesture
 * (wheel, keys) glides all the way down or up ({@link DOCK_GLIDE_MS}), and a
 * scroll that stops half way (scrollbar, focus, find in page) finishes in the
 * direction it went — there is never a half-and-half picture.
 */

/** Columns stand side by side from here on (briefing-hub.component.scss). */
export const DOCK_MIN_WIDTH = 901;

/** Length of the glide from one end of the page to the other. */
export const DOCK_GLIDE_MS = 1100;

export type DockState = 'top' | 'fly' | 'docked';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Move {
  readonly tx: number;
  readonly ty: number;
  readonly k: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Scroll progress 0…1 over the page's scroll range (0 without one). */
export function dockProgress(scrollY: number, maxScroll: number): number {
  if (maxScroll <= 1) return 0;
  return Math.min(1, Math.max(0, scrollY / maxScroll));
}

/** Smoothstep: the planets lift off and land softly. */
export function dockEase(p: number): number {
  return p * p * (3 - 2 * p);
}

export function dockState(p: number): DockState {
  return p <= 0.001 ? 'top' : p >= 0.999 ? 'docked' : 'fly';
}

/** Transform (origin top left) that brings `src` towards `dst` at `e`; boxes in one coordinate space. */
export function planetMove(src: Box, dst: Box, e: number): Move {
  return { tx: (dst.x - src.x) * e, ty: (dst.y - src.y) * e, k: lerp(1, src.w ? dst.w / src.w : 1, e) };
}

/**
 * Transform (origin top left) for the planet's label, a child of the planet
 * that already carries `planet`: the label's box goes from `src` to `dst`
 * (scaled by height) on screen, so the parent's move is divided out.
 */
export function labelMove(planetSrc: Box, src: Box, dst: Box, planet: Move, e: number): Move {
  const k = lerp(1, src.h ? dst.h / src.h : 1, e);
  const x = lerp(src.x, dst.x, e);
  const y = lerp(src.y, dst.y, e);
  return {
    tx: (x - planetSrc.x - planet.tx) / planet.k - (src.x - planetSrc.x),
    ty: (y - planetSrc.y - planet.ty) / planet.k - (src.y - planetSrc.y),
    k: k / planet.k,
  };
}

/** easeInOutCubic: the glide starts and lands softly. */
export function glideEase(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Where a gesture or a stopped scroll goes: the end in its direction (`dir` > 0 = down). */
export function glideTarget(y: number, max: number, dir: number): number | null {
  if (max <= 1) return null;
  if (dir > 0) return y < max - 1 ? max : null;
  if (dir < 0) return y > 1 ? 0 : null;
  return null;
}

/** Keys that scroll the page, as a direction. */
export function keyDirection(e: Pick<KeyboardEvent, 'key' | 'shiftKey'>): number {
  switch (e.key) {
    case 'ArrowDown': case 'PageDown': case 'End': return 1;
    case 'ArrowUp': case 'PageUp': case 'Home': return -1;
    case ' ': return e.shiftKey ? -1 : 1;
    default: return 0;
  }
}

/** True if `el` (up to the body) sits in something that scrolls itself — that gesture is not the page's. */
function inScroller(el: Element | null): boolean {
  for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n instanceof HTMLElement && n.scrollHeight > n.clientHeight + 1) {
      const o = getComputedStyle(n).overflowY;
      if (o === 'auto' || o === 'scroll') return true;
    }
  }
  return false;
}

function typing(el: Element | null): boolean {
  return !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="listbox"], [role="dialog"]');
}

const css = (m: Move): string => `translate(${m.tx.toFixed(2)}px, ${m.ty.toFixed(2)}px) scale(${m.k.toFixed(4)})`;

function box(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/**
 * Wires the flight on `host` (the briefing): scroll + resize listeners outside
 * the zone, one rAF per change. Returns the state signal (`top` / `fly` /
 * `docked`), whether the flight is on, `glide(dir)` for the "Mehr im Verse"
 * cue (false when it did not take over) and a teardown.
 */
export function wireDock(
  host: HTMLElement,
  zone: NgZone,
): { state: Signal<DockState>; flying: Signal<boolean>; glide: (dir: number) => boolean; destroy: () => void } {
  const state = signal<DockState>('top');
  const flying = signal(false);
  const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const wide = typeof matchMedia === 'function' ? matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`) : null;
  let frame = 0;
  let glideFrame = 0;
  let lastY = window.scrollY;
  let lastDir = 0;
  const maxScroll = (): number => document.documentElement.scrollHeight - window.innerHeight;
  const active = (): boolean => !!wide?.matches && !reduce?.matches;

  const stopGlide = (): void => {
    if (glideFrame) cancelAnimationFrame(glideFrame);
    glideFrame = 0;
  };
  /** Glides to the end in `dir`; true if the page is (or already was) on its way there. */
  const glide = (dir: number): boolean => {
    if (!active()) return false;
    const to = glideTarget(window.scrollY, maxScroll(), dir);
    if (to === null) return true;
    stopGlide();
    const from = window.scrollY;
    const ms = Math.max(400, DOCK_GLIDE_MS * Math.min(1, Math.abs(to - from) / Math.max(1, maxScroll())));
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
    // While gliding (and for the touchpad's inertia after it) the page is not moved by hand.
    if (glideFrame || glide(Math.sign(e.deltaY))) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent): void => {
    const dir = keyDirection(e);
    if (!dir || !active() || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target as Element | null)) return;
    // Space on a control presses it, it does not scroll.
    if (e.key === ' ' && (e.target as Element | null)?.closest?.('button, a, summary, [role="button"]')) return;
    if (glideFrame || glide(dir)) e.preventDefault();
  };
  const onScroll = (): void => {
    const y = window.scrollY;
    if (y !== lastY) lastDir = Math.sign(y - lastY);
    lastY = y;
    schedule();
  };
  // A scroll that stopped half way (scrollbar, focus, find in page) finishes in its direction.
  const onScrollEnd = (): void => {
    if (glideFrame || !active()) return;
    const y = window.scrollY;
    const max = maxScroll();
    if (y > 1 && y < max - 1) glide(lastDir || (y > max / 2 ? 1 : -1));
  };

  const parts = () =>
    TX_DOORS.map((d) => ({
      pl: host.querySelector<HTMLElement>(`sc-briefing-transmit .pl[data-door="${d}"]`),
      lab: host.querySelector<HTMLElement>(`sc-briefing-transmit .pl[data-door="${d}"] .plab`),
      mini: host.querySelector<HTMLElement>(`sc-briefing-hub .mini[data-door="${d}"]`),
      word: host.querySelector<HTMLElement>(`sc-briefing-hub .colh[data-door="${d}"] .colh-t`),
    }));

  const clear = (all: ReturnType<typeof parts>) => {
    for (const p of all) {
      p.pl?.style.removeProperty('transform');
      p.lab?.style.removeProperty('transform');
    }
  };

  const update = (): void => {
    frame = 0;
    const doc = document.documentElement;
    const p = dockProgress(window.scrollY, doc.scrollHeight - window.innerHeight);
    const on = active();
    const st = dockState(p);
    host.style.setProperty('--dock', p.toFixed(3));
    const all = parts();
    clear(all);
    if (on && st !== 'top') {
      const e = dockEase(p);
      // Read everything untransformed first, then write: one style pass per frame.
      const boxes = all.map((x) => (x.pl && x.lab && x.mini && x.word ? { pl: box(x.pl), lab: box(x.lab), mini: box(x.mini), word: box(x.word) } : null));
      all.forEach((x, i) => {
        const b = boxes[i];
        if (!b || !x.pl || !x.lab) return;
        const m = planetMove(b.pl, b.mini, e);
        x.pl.style.transform = css(m);
        x.lab.style.transform = css(labelMove(b.pl, b.lab, b.word, m, e));
      });
    }
    if (flying() !== on || state() !== st) {
      zone.run(() => {
        flying.set(on);
        state.set(st);
      });
    }
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  zone.runOutsideAngular(() => {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', onScrollEnd);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', schedule);
  });
  wide?.addEventListener('change', schedule);
  reduce?.addEventListener('change', schedule);
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  ro?.observe(document.body);
  schedule();

  return {
    state: state.asReadonly(),
    flying: flying.asReadonly(),
    glide,
    destroy: () => {
      if (frame) cancelAnimationFrame(frame);
      stopGlide();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('scrollend', onScrollEnd);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', schedule);
      wide?.removeEventListener('change', schedule);
      reduce?.removeEventListener('change', schedule);
      ro?.disconnect();
      clear(parts());
    },
  };
}
