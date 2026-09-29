import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TEASER_BOX, TEASER_FALLBACK, TEASER_MAX, TeaserBox, TeaserStripDirective, teaserFit } from './patch-teaser';

/**
 * The strip's arithmetic (feedback fdaad6b7): as many roadmap thumbnails as
 * TWO rows of the measured width hold, then "…".
 *
 * Both breakpoints are exercised explicitly. Karma renders at 749 px, i.e. in
 * the phone branch, so a rule that only holds for the 96 px desktop thumbnail
 * would pass here and be wrong where the admin looks.
 */
const DESKTOP: TeaserBox = { ...TEASER_BOX, width: 0 };
const PHONE: TeaserBox = { width: 0, item: 84, gap: 6, rest: 34, rows: 2 };
const ONE_ROW: TeaserBox = { ...DESKTOP, rows: 1 };

const at = (box: TeaserBox, width: number): TeaserBox => ({ ...box, width });

/** How many thumbnails one line of `box` holds — the CSS wrap, in arithmetic. */
const perRow = (box: TeaserBox) => Math.max(1, Math.floor((box.width + box.gap) / (box.item + box.gap)));

/** The width the last line actually uses, indicator included. */
const lastRowWidth = (box: TeaserBox, fit: { visible: number; rest: number }) => {
  const onLast = fit.visible - perRow(box) * (box.rows - 1);
  const items = onLast * box.item + Math.max(0, onLast - 1) * box.gap;
  return fit.rest > 0 ? items + box.gap + box.rest : items;
};

describe('Patch board — the roadmap teaser strip', () => {
  it('shows nothing for a release without roadmap items', () => {
    expect(teaserFit(0, at(DESKTOP, 600))).toEqual({ visible: 0, rest: 0 });
  });

  it('fills the width instead of stopping at three', () => {
    // 4 × 96 + 3 × 6 = 402 px, so 426 px holds four per line.
    const wide = teaserFit(10, at(DESKTOP, 426));
    expect(wide.visible).toBeGreaterThan(TEASER_FALLBACK);
    expect(wide.visible + wide.rest).toBe(10);
  });

  /**
   * Round 2 of feedback fdaad6b7: "die roadmap icons können noch ruhig doppelt
   * so groß dargestellt werden … Mach aber ruhig zwei Reihen". Doubling the
   * thumbnail halves what one line holds, and the second line is what buys it
   * back — so the two have to be tested together, at one and the same width.
   */
  it('wraps onto a second row rather than showing half a strip', () => {
    const oneRow = teaserFit(10, at(ONE_ROW, 426));
    const twoRows = teaserFit(10, at(DESKTOP, 426));
    expect(oneRow.visible).withContext('four fit per line, minus the "…"').toBe(3);
    expect(twoRows.visible).withContext('the second line more than doubles that').toBe(7);
    expect(twoRows.visible + twoRows.rest).toBe(10);
  });

  it('leaves room for the "…" on the LAST row whenever something is left over', () => {
    for (const box of [at(DESKTOP, 426), at(PHONE, 380), at(DESKTOP, 700)]) {
      const fit = teaserFit(30, box);
      expect(fit.rest).withContext(`30 items do not fit into ${box.width}px`).toBeGreaterThan(0);
      expect(fit.visible)
        .withContext('never more rows than the strip can show').toBeLessThanOrEqual(perRow(box) * box.rows);
      expect(lastRowWidth(box, fit))
        .withContext(`items plus the "…" stay inside ${box.width}px`).toBeLessThanOrEqual(box.width);
    }
  });

  it('drops the "…" when everything fits — no room reserved for nothing', () => {
    // 2 × 96 + 6 = 198 px per line, two lines: four items fit exactly.
    expect(teaserFit(4, at(DESKTOP, 198))).toEqual({ visible: 4, rest: 0 });
    // One pixel short: the line holds one icon, so half the strip gives way.
    const tight = teaserFit(4, at(DESKTOP, 197));
    expect(tight.rest).toBeGreaterThan(0);
    expect(tight.visible).toBeLessThan(4);
  });

  it('grows and shrinks with the width, on BOTH breakpoints', () => {
    for (const box of [DESKTOP, PHONE]) {
      const narrow = teaserFit(20, at(box, 200)).visible;
      const wide = teaserFit(20, at(box, 700)).visible;
      expect(wide).withContext(`item ${box.item}px`).toBeGreaterThan(narrow);
      expect(narrow).withContext('a narrow strip still shows something').toBeGreaterThanOrEqual(1);
    }
  });

  it('never renders an empty strip, however narrow the card gets', () => {
    for (const box of [DESKTOP, PHONE]) {
      const fit = teaserFit(6, at(box, 20));
      expect(fit.visible).withContext(`item ${box.item}px`).toBe(1);
      expect(fit.rest).toBe(5);
    }
  });

  it('caps a very wide screen and says so with the "…"', () => {
    const fit = teaserFit(40, at(DESKTOP, 4000));
    expect(fit.visible).toBe(TEASER_MAX);
    expect(fit.rest).toBe(40 - TEASER_MAX);
  });

  it('falls back to the old count until the strip has been measured', () => {
    expect(teaserFit(9, DESKTOP)).toEqual({ visible: TEASER_FALLBACK, rest: 9 - TEASER_FALLBACK });
    expect(teaserFit(2, DESKTOP)).toEqual({ visible: 2, rest: 0 });
  });

  it('counts of visible and left over always add up to the release', () => {
    for (const total of [1, 3, 7, 12, 25]) {
      for (const width of [0, 30, 120, 300, 900, 2400]) {
        const fit = teaserFit(total, at(PHONE, width));
        expect(fit.visible + fit.rest)
          .withContext(`${total} items in ${width}px`).toBe(total);
        expect(fit.visible).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

@Component({
  standalone: true,
  imports: [TeaserStripDirective],
  template: `<div class="strip" (scTeaserStrip)="boxes.push($event)"
                  style="display:flex; column-gap:4px; --tz-w:50px; --tz-rest:20px; --tz-rows:3;"
                  [style.width.px]="width"></div>`,
})
class StripHostComponent {
  width = 300;
  readonly boxes: TeaserBox[] = [];
}

describe('TeaserStripDirective', () => {
  /** A ResizeObserver reports on its own schedule — poll instead of a fixed wait. */
  async function until(cond: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
  }

  it('measures the strip and reads item, gap, rest and rows from its CSS', async () => {
    const f = TestBed.createComponent(StripHostComponent);
    f.detectChanges();
    await until(() => f.componentInstance.boxes.length > 0);

    expect(f.componentInstance.boxes[0]).toEqual({ width: 300, item: 50, gap: 4, rest: 20, rows: 3 });
  });

  it('emits again only when the measured box changes', async () => {
    const f = TestBed.createComponent(StripHostComponent);
    f.detectChanges();
    await until(() => f.componentInstance.boxes.length > 0);

    f.componentInstance.width = 200;
    f.detectChanges();
    await until(() => f.componentInstance.boxes.length > 1);

    const { boxes } = f.componentInstance;
    expect(boxes.length).toBe(2);
    expect(boxes[1].width).toBe(200);
    // A same-size re-render must not produce a third emission.
    f.componentInstance.width = 200;
    f.detectChanges();
    await new Promise((r) => setTimeout(r, 60));
    expect(boxes.length).toBe(2);
  });

  it('stops observing when destroyed', async () => {
    const f = TestBed.createComponent(StripHostComponent);
    f.detectChanges();
    await until(() => f.componentInstance.boxes.length > 0);
    const { boxes } = f.componentInstance;
    f.destroy();
    await new Promise((r) => setTimeout(r, 60));
    expect(boxes.length).toBe(1);
  });
});
