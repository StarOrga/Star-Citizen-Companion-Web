import { NgZone, Signal, signal } from '@angular/core';
import { onScrollTick } from '../../../core/scroll-tick';
import { TX_DOORS } from './briefing-transmit.component';
import { setSnapTravelPx } from '../../../shared/snap-travel';

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

/** Where a gesture or a stopped scroll goes: the end in its direction (`dir` > 0 = down). */
export function glideTarget(y: number, max: number, dir: number): number | null {
  if (max <= 1) return null;
  if (dir > 0) return y < max - 1 ? max : null;
  if (dir < 0) return y > 1 ? 0 : null;
  return null;
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
 *
 * Options: `minWidth` (default {@link DOCK_MIN_WIDTH}) — below it the browser's own scroll
 * stays; `end` — an element snapped with its END edge (the footer under the last page, so
 * the end of the document stays a resting place); `zone` — the late re-checks run outside
 * Angular, so they never keep the app (or a spec's `whenStable()`) busy.
 *
 * Direction: `mandatory` snapping picks the snap position CLOSEST to where a scroll ends,
 * so a wheel notch or a short touchpad swipe on the stage (100–140 px of a 900 px step)
 * was pulled back to the stage — measured on the real GPU (perf-report "Wave 2c root
 * cause"): eight notches never reached the lower part, and every notch docked and undocked
 * the header (a full morph each time). A wheel gesture that native snapping would bounce
 * therefore finishes the step in its direction (a native smooth scroll to the next snap
 * position, the snap keeps it there); the rest of that gesture is swallowed. Inside an
 * area taller than the viewport the wheel scrolls natively.
 */
export function wireSnap(
  targets: () => readonly (HTMLElement | null)[],
  opts: { minWidth?: number; end?: () => HTMLElement | null; zone?: NgZone } = {},
): () => void {
  if (typeof document === 'undefined' || typeof matchMedia !== 'function') return () => undefined;
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const wide = matchMedia(`(min-width: ${opts.minWidth ?? DOCK_MIN_WIDTH}px)`);
  let marked: HTMLElement[] = [];
  const clear = (): void => {
    root.style.removeProperty('scroll-snap-type');
    for (const el of marked) {
      el.style.removeProperty('scroll-snap-align');
      el.style.removeProperty('scroll-margin-top');
    }
    marked = [];
    setSnapTravelPx(null);
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
    // The stage rests at the very top of the document (scrollY 0), not at its own top edge minus
    // the root's scroll-padding: the shell's frame puts the stage ~80 px down and the padding is
    // the docked bar's 64 px, so the snap held the page at 16 px - "not at the top" for everything
    // that waits for it (the projector relay, the names at rest; QA D1). A scroll-margin as tall
    // as the stage's offset puts its snap position above 0, which the browser clamps to 0.
    const stageTop = Math.ceil(marked[0].getBoundingClientRect().top + window.scrollY);
    if (stageTop > 0) marked[0].style.setProperty('scroll-margin-top', `${stageTop}px`);
    // The first snap step (stage → lower part): the header morph spans exactly this travel.
    const ps = snapPositions(marked);
    const travel = ps.length > 1 ? ps[1] - ps[0] : Math.round(marked[1].getBoundingClientRect().top - marked[0].getBoundingClientRect().top);
    setSnapTravelPx(travel);
    const end = opts.end?.();
    if (end && !marked.includes(end)) {
      end.style.setProperty('scroll-snap-align', 'end');
      marked.push(end);
    }
    root.style.setProperty('scroll-snap-type', 'y mandatory');
  };
  apply();
  wide.addEventListener('change', apply);
  reduce.addEventListener('change', apply);
  // The targets can mount after the first call (the hub builds in steps): look again after layout settles.
  const arm = (): ReturnType<typeof setTimeout>[] => [400, 1600, 4000].map((ms) => setTimeout(apply, ms));
  const late = opts.zone ? opts.zone.runOutsideAngular(arm) : arm();
  const stepper = snapStepper(() => marked);
  const listen = (): void => window.addEventListener('wheel', stepper.onWheel, { passive: false });
  if (opts.zone) opts.zone.runOutsideAngular(listen);
  else listen();
  return () => {
    window.removeEventListener('wheel', stepper.onWheel);
    stepper.stop();
    late.forEach(clearTimeout);
    wide.removeEventListener('change', apply);
    reduce.removeEventListener('change', apply);
    clear();
  };
}

/** Snap positions (document y) of the marked targets: start-aligned tops (minus scroll-margin), end-aligned bottoms. */
function snapPositions(marked: readonly HTMLElement[]): number[] {
  const y = window.scrollY;
  const vh = window.innerHeight;
  const root = getComputedStyle(document.documentElement);
  // The snapport is the viewport minus the root's scroll-padding (the docked bar's height).
  const padTop = parseFloat(root.scrollPaddingTop) || 0;
  const padBottom = parseFloat(root.scrollPaddingBottom) || 0;
  const max = Math.max(0, document.documentElement.scrollHeight - vh);
  const out = marked.map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const p = el.style.getPropertyValue('scroll-snap-align') === 'end'
      ? r.bottom + y - vh + padBottom + (parseFloat(cs.scrollMarginBottom) || 0)
      : r.top + y - padTop - (parseFloat(cs.scrollMarginTop) || 0);
    return Math.round(Math.min(max, Math.max(0, p)));
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * An area counts as taller than the viewport (free wheel inside) above this many viewports:
 * a viewport-high stage measures up to ~1.1 viewports between its snap positions, because
 * the docked header changes the layout above the lower part.
 */
const TALL_AREA = 1.3;

/**
 * Where a wheel step in `dir` goes from `y` between the snap positions `ps` (sorted), or
 * null when the native scroll must run (an area taller than the viewport, no next position).
 * An area of about one viewport is one step; from the end of a tall area the next step
 * is the next position.
 */
export function snapStepTarget(y: number, dir: number, ps: readonly number[], vh: number): number | null {
  if (!dir || ps.length < 2) return null;
  const at = [...ps].reverse().find((p) => p <= y + 1) ?? ps[0];
  const next = ps.find((p) => p > y + 1) ?? null;
  if (dir > 0) {
    if (next === null) return null;
    const tall = next - at > vh * TALL_AREA;
    return !tall || y + vh >= next - 1 ? next : null;
  }
  if (y > at + 1) {
    // Between two positions: inside a tall area the wheel is free, a short one steps back to its start.
    return next !== null && next - at > vh * TALL_AREA ? null : at;
  }
  const prev = [...ps].reverse().find((p) => p < at - 1) ?? null;
  if (prev === null) return null;
  // Up into a tall area scrolls natively (it is free inside); a short one is one step.
  return at - prev > vh * TALL_AREA ? null : prev;
}

/** Nested scroll containers (a list, a panel) keep their own wheel. */
function inOwnScroller(el: Element | null): boolean {
  for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1) {
      const o = getComputedStyle(n).overflowY;
      if (o === 'auto' || o === 'scroll') return true;
    }
  }
  return false;
}

/** How long after the last swallowed wheel event a gesture still counts as the same one (touchpad inertia). */
const STEP_GESTURE_GAP_MS = 220;
/** A step that never reports `scrollend` releases the wheel after this long. */
const STEP_MAX_MS = 1400;

function snapStepper(marked: () => readonly HTMLElement[]): { onWheel: (e: WheelEvent) => void; stop: () => void } {
  let dir = 0;
  let target = -1;
  let lastWheel = 0;
  let ended = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const done = (): void => {
    ended = true;
  };
  const stop = (): void => {
    dir = 0;
    target = -1;
    ended = true;
    if (timer) clearTimeout(timer);
    timer = null;
    window.removeEventListener('scrollend', done);
  };
  const onWheel = (e: WheelEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || !e.deltaY) return;
    const d = Math.sign(e.deltaY);
    const now = performance.now();
    // The rest of a step's own gesture (more notches, touchpad inertia): swallowed until it pauses.
    if (dir === d && (!ended || now - lastWheel < STEP_GESTURE_GAP_MS)) {
      lastWheel = now;
      e.preventDefault();
      return;
    }
    if (dir) stop();
    const els = marked();
    if (els.length < 2 || !document.documentElement.style.getPropertyValue('scroll-snap-type')) return;
    if (inOwnScroller(e.target as Element | null) || (e.target as Element | null)?.closest?.('model-viewer')) return;
    const to = snapStepTarget(window.scrollY, d, snapPositions(els), window.innerHeight);
    if (to === null || Math.abs(to - window.scrollY) < 2) return;
    e.preventDefault();
    dir = d;
    target = to;
    lastWheel = now;
    ended = false;
    window.addEventListener('scrollend', done, { once: true });
    timer = setTimeout(done, STEP_MAX_MS);
    scrollToSmooth(target);
  };
  return { onWheel, stop };
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
  ], { zone });
  let offScroll = (): void => undefined;

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
    offScroll = onScrollTick(update);
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
      offScroll();
      window.removeEventListener('resize', schedule);
      wide?.removeEventListener('change', schedule);
      reduce?.removeEventListener('change', schedule);
      ro?.disconnect();
      clear(parts());
    },
  };
}
