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
 * With the flight on, the page knows only its two ends — and the browser keeps
 * it that way: the stage and the hub are native CSS scroll-snap areas of the
 * document (`scroll-snap-type: y mandatory`, {@link wireSnap}), so a wheel turn,
 * a key, a touch fling or a stopped scrollbar all finish on one of the two ends,
 * on the compositor. (The scripted rAF glide this replaced re-set the scroll
 * position on the main thread every frame and is gone.)
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
export function inScroller(el: Element | null): boolean {
  for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n instanceof HTMLElement && n.scrollHeight > n.clientHeight + 1) {
      const o = getComputedStyle(n).overflowY;
      if (o === 'auto' || o === 'scroll') return true;
    }
  }
  return false;
}

/** True in a field or dialog: its keys and wheel are not the page's. */
export function typing(el: Element | null): boolean {
  return !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="listbox"], [role="dialog"]');
}

const css = (m: Move): string => `translate(${m.tx.toFixed(2)}px, ${m.ty.toFixed(2)}px) scale(${m.k.toFixed(4)})`;

function box(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/**
 * Native scroll-snap for a page with a stage on top and one lower part under it: the
 * document snaps (`y mandatory`) between `targets` (their top edges), only where the
 * stage flight / glide mechanism is on — wide screens, no reduced motion. A target
 * taller than the viewport (the Codex overview) scrolls freely inside itself, that is
 * how the spec treats an oversized snap area. Returns `release` (restores every inline
 * style it set).
 */
export function wireSnap(targets: () => readonly (HTMLElement | null)[]): () => void {
  if (typeof document === 'undefined' || typeof matchMedia !== 'function') return () => undefined;
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const wide = matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`);
  let marked: HTMLElement[] = [];
  const clear = (): void => {
    root.style.removeProperty('scroll-snap-type');
    for (const el of marked) el.style.removeProperty('scroll-snap-align');
    marked = [];
  };
  const apply = (): void => {
    clear();
    if (!wide.matches || reduce.matches) return;
    marked = targets().filter((el): el is HTMLElement => !!el);
    if (marked.length < 2) {
      marked = [];
      return;
    }
    for (const el of marked) el.style.setProperty('scroll-snap-align', 'start');
    root.style.setProperty('scroll-snap-type', 'y mandatory');
  };
  apply();
  wide.addEventListener('change', apply);
  reduce.addEventListener('change', apply);
  // The targets can mount after the first call (the hub builds in steps): look again after layout settles.
  const late = [400, 1600, 4000].map((ms) => setTimeout(apply, ms));
  return () => {
    late.forEach(clearTimeout);
    wide.removeEventListener('change', apply);
    reduce.removeEventListener('change', apply);
    clear();
  };
}

/** Smooth native scroll to `top` (the "Mehr im Verse" cue); instant under reduced motion. */
export function scrollToSmooth(top: number): void {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
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
  const maxScroll = (): number => document.documentElement.scrollHeight - window.innerHeight;
  const active = (): boolean => !!wide?.matches && !reduce?.matches;

  /** The cue's click: a native smooth scroll to the end in `dir`; true if the page is (or already was) there. */
  const glide = (dir: number): boolean => {
    if (!active()) return false;
    const to = glideTarget(window.scrollY, maxScroll(), dir);
    if (to === null) return true;
    scrollToSmooth(to);
    return true;
  };
  // Stage and hub are the two snap areas; the browser finishes every gesture on one of them.
  const releaseSnap = wireSnap(() => [
    host.querySelector<HTMLElement>('section'),
    host.querySelector<HTMLElement>('sc-briefing-hub'),
  ]);
  const onScroll = (): void => schedule();

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

  /** Whether the doors carry a transform that has to go again. */
  let moved = false;
  const update = (): void => {
    frame = 0;
    const doc = document.documentElement;
    const p = dockProgress(window.scrollY, doc.scrollHeight - window.innerHeight);
    const on = active();
    const st = dockState(p);
    // On the one element that reads it: on the host, a new value recalculated the whole page's
    // style in every scroll frame, about 10 ms, with 5.6 ms to spare at 179 Hz.
    host.querySelector<HTMLElement>('.more-cue')?.style.setProperty('--dock', p.toFixed(3));
    const moving = on && st !== 'top';
    if (!moving && !moved) {
      if (flying() !== on || state() !== st) zone.run(() => { flying.set(on); state.set(st); });
      return;
    }
    const all = parts();
    clear(all);
    moved = moving;
    if (moving) {
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
      releaseSnap();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
      wide?.removeEventListener('change', schedule);
      reduce?.removeEventListener('change', schedule);
      ro?.disconnect();
      clear(parts());
    },
  };
}
