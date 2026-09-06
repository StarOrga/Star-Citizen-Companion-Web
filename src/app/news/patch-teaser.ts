import { Directive, ElementRef, OnDestroy, afterNextRender, inject, output } from '@angular/core';

/**
 * The patch board's roadmap teaser strip: how many thumbnails fit, and what is
 * left over (feedback fdaad6b7 — "von den roadmap icons mehr ergänzen! die
 * sind ja die spannenden — so viel wie platz ist und danach '…'").
 *
 * The strip used to show a hard-coded three icons plus the item NAMES as text.
 * The names ate the width the icons wanted, and three was three whether the
 * card was 380 px or 1100 px wide. The count is width-driven now, and the
 * arithmetic lives here — as a pure function over a measured box — so it can
 * be reasoned about and tested without a browser, and so the component never
 * has to guess at a breakpoint.
 */

/** One strip's measured geometry, in CSS pixels. */
export interface TeaserBox {
  /** Width available to the strip. */
  width: number;
  /** Rendered width of one thumbnail (`--tz-w`). */
  item: number;
  /** Gap between two thumbnails (`column-gap`). */
  gap: number;
  /** Width the trailing "…" needs when not everything fits (`--tz-rest`). */
  rest: number;
  /**
   * How many lines the strip may wrap onto (`--tz-rows`).
   *
   * The thumbnails doubled in size (feedback fdaad6b7 round 2 — "die roadmap
   * icons können noch ruhig doppelt so groß dargestellt werden … Mach aber
   * ruhig zwei Reihen"), so a single line would now hold half of what it used
   * to. The second row buys that back.
   */
  rows: number;
}

/** What a strip renders: the first `visible` items, and how many were left out. */
export interface TeaserFit {
  visible: number;
  rest: number;
}

/**
 * A cap for very wide screens. Beyond a dozen thumbnails the strip stops being
 * a teaser and starts being the dossier's contents list badly — and the "…"
 * that says "there is more" is the more honest end of a long row anyway.
 */
export const TEASER_MAX = 12;

/**
 * What to show before the strip has been measured — the pre-2026-09-06 count.
 * A first paint with three icons that grows to eight is a strip filling up;
 * starting at zero would be a strip popping into existence. The row height is
 * fixed either way, so neither shifts the page.
 */
export const TEASER_FALLBACK = 3;

/** Geometry fallbacks, mirroring the component's CSS for a headless caller. */
export const TEASER_BOX: TeaserBox = { width: 0, item: 96, gap: 6, rest: 40, rows: 2 };

/**
 * How many thumbnails fit into `box.rows` lines of `box.width`, and how many
 * that leaves over.
 *
 * The strip wraps, so the arithmetic is per line: every line but the last is
 * filled to the brim, and the last one has to end in the "…" whenever
 * something is left over. Three rules beyond that:
 *
 *  - room for the "…" is reserved whenever anything is left over, so the
 *    indicator can never be the thing that gets clipped;
 *  - the indicator lives on the LAST line — a strip that wrapped it onto a
 *    third line would be clipped away by the container's max-height;
 *  - at least one thumbnail is always rendered. A strip narrower than a single
 *    icon is a layout accident, and showing nothing but an ellipsis would hide
 *    the one thing this row is for.
 */
export function teaserFit(total: number, box: TeaserBox, cap: number = TEASER_MAX): TeaserFit {
  if (total <= 0) return { visible: 0, rest: 0 };
  const limit = Math.min(total, Math.max(1, cap));
  if (!(box.width > 0)) {
    const visible = Math.min(limit, TEASER_FALLBACK);
    return { visible, rest: total - visible };
  }
  const rows = Math.max(1, Math.floor(box.rows) || 1);
  // One thumbnail costs its own width plus the gap that follows it; the last
  // one in a line does not pay that gap, hence the `+ box.gap` on the width.
  const step = box.item + box.gap;
  const perRow = Math.max(1, Math.floor((box.width + box.gap) / step));
  // Everything, with nothing left to announce: no room reserved for the "…".
  if (limit === total && total <= perRow * rows) return { visible: total, rest: 0 };
  const lead = perRow * (rows - 1);
  // The last line: n thumbnails, each paying its gap, then the indicator.
  const lastRow = Math.max(0, Math.floor((box.width - box.rest) / step));
  const visible = Math.max(1, Math.min(limit, lead + lastRow));
  return { visible, rest: Math.max(0, total - visible) };
}

/**
 * Measure a teaser strip and report its box to the board.
 *
 * The strip is a flex row inside a stretched column, so its own width IS the
 * width available to it — independent of how many children it currently has,
 * which is what keeps the measure → render → measure loop from oscillating.
 *
 * Item width, gap and row count are read from CSS rather than restated in
 * TypeScript: the phone breakpoint shrinks the thumbnails (96 → 84 px), and a
 * second copy of that number in the component would be a silent lie on one of
 * the two branches. Emissions are deduplicated, so a resize that does not
 * change the box costs nothing.
 */
@Directive({ selector: '[scTeaserStrip]', standalone: true })
export class TeaserStripDirective implements OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly scTeaserStrip = output<TeaserBox>();

  private observer: ResizeObserver | null = null;
  private last = '';

  constructor() {
    // Observing from the constructor rather than from an after-render hook:
    // a ResizeObserver reports the element's FIRST box on its own, so the
    // strip is measured as soon as it has been laid out — including inside a
    // TestBed, where after-render hooks do not run.
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(this.el.nativeElement);
      return;
    }
    afterNextRender(() => this.measure());
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private measure(): void {
    const el = this.el.nativeElement;
    if (typeof getComputedStyle === 'undefined') return;
    const style = getComputedStyle(el);
    const box: TeaserBox = {
      width: Math.round(el.getBoundingClientRect().width),
      item: positive(style.getPropertyValue('--tz-w'), TEASER_BOX.item),
      gap: positive(style.columnGap, TEASER_BOX.gap),
      rest: positive(style.getPropertyValue('--tz-rest'), TEASER_BOX.rest),
      rows: positive(style.getPropertyValue('--tz-rows'), TEASER_BOX.rows),
    };
    const key = `${box.width}/${box.item}/${box.gap}/${box.rest}/${box.rows}`;
    if (key === this.last) return;
    this.last = key;
    this.scTeaserStrip.emit(box);
  }
}

/** A positive number out of a computed CSS value — px lengths and bare counts. */
function positive(value: string, fallback: number): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
