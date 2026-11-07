/**
 * "Scroll on into the index": the desktop landing is one viewport, so a wheel
 * turn past its end has nowhere to go. Once the reader keeps turning down
 * there, the landing hands over to the Codex index (/codex/index) — the list
 * they would otherwise reach through two or three clicks.
 *
 * Pure parts only, so the gesture rules have a test; the landing owns the
 * listener and the navigation.
 */

/** Wheel distance (px, summed) past the page end that counts as "on into the index". */
export const INDEX_WHEEL_THRESHOLD = 160;
/** A pause longer than this (ms) between two wheel events starts the sum over. */
export const INDEX_WHEEL_GAP_MS = 450;

/**
 * True when `target` or one of its ancestors up to `stop` can still scroll
 * down itself — that wheel turn belongs to the pane, not to the page. An
 * element inside a `model-viewer` (the hologram zooms on the wheel) counts as
 * busy too.
 */
export function wheelBelongsToInner(target: EventTarget | null, stop: Element): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== stop) {
    if (el.tagName === 'MODEL-VIEWER') return true;
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
    el = el.parentElement;
  }
  return false;
}

/** The document is scrolled to its end (or does not scroll at all). */
export function atPageEnd(doc: Document = document, win: Window = window): boolean {
  const root = doc.scrollingElement ?? doc.documentElement;
  return win.innerHeight + win.scrollY >= root.scrollHeight - 2;
}

/**
 * Sums downward wheel distance at the page end; resets on an upward turn or a
 * pause. `push` answers true once the threshold is crossed.
 */
export class IndexWheelGate {
  private sum = 0;
  private last = 0;

  constructor(
    private readonly threshold = INDEX_WHEEL_THRESHOLD,
    private readonly gapMs = INDEX_WHEEL_GAP_MS,
  ) {}

  push(deltaY: number, now: number): boolean {
    if (deltaY <= 0 || now - this.last > this.gapMs) this.sum = 0;
    this.last = now;
    if (deltaY <= 0) return false;
    this.sum += deltaY;
    return this.sum >= this.threshold;
  }

  reset(): void {
    this.sum = 0;
  }
}
