import { TEASER_BOX, TEASER_FALLBACK, TEASER_MAX, TeaserBox, teaserFit } from './patch-teaser';

/**
 * The strip's arithmetic (feedback fdaad6b7): as many roadmap thumbnails as
 * the width holds, then "…".
 *
 * Both breakpoints are exercised explicitly. Karma renders at 749 px, i.e. in
 * the phone branch, so a rule that only holds for the 48 px desktop thumbnail
 * would pass here and be wrong where the admin looks.
 */
const DESKTOP: TeaserBox = { ...TEASER_BOX, width: 0 };
const PHONE: TeaserBox = { width: 0, item: 42, gap: 6, rest: 22 };

const at = (box: TeaserBox, width: number): TeaserBox => ({ ...box, width });

describe('Patch board — the roadmap teaser strip', () => {
  it('shows nothing for a release without roadmap items', () => {
    expect(teaserFit(0, at(DESKTOP, 600))).toEqual({ visible: 0, rest: 0 });
  });

  it('fills the width instead of stopping at three', () => {
    // 8 × 48 + 7 × 6 = 426 px — the old strip showed three here.
    const wide = teaserFit(10, at(DESKTOP, 426));
    expect(wide.visible).toBeGreaterThan(TEASER_FALLBACK);
    expect(wide.visible + wide.rest).toBe(10);
  });

  it('leaves room for the "…" whenever something is left over', () => {
    const box = at(DESKTOP, 426);
    const fit = teaserFit(10, box);
    const used = fit.visible * box.item + (fit.visible - 1) * box.gap + box.gap + box.rest;
    expect(fit.rest).withContext('10 items do not fit into 426 px').toBeGreaterThan(0);
    expect(used).withContext('items plus the "…" stay inside the strip').toBeLessThanOrEqual(box.width);
  });

  it('drops the "…" when everything fits — no room reserved for nothing', () => {
    // 4 × 48 + 3 × 6 = 210 px exactly.
    expect(teaserFit(4, at(DESKTOP, 210))).toEqual({ visible: 4, rest: 0 });
    // One pixel short: the fourth gives way to the indicator.
    const tight = teaserFit(4, at(DESKTOP, 209));
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
