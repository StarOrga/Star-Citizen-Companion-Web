import { PageRange, pageStep, settleTarget } from './hq-page-scroll';

describe('HQ page scrolling', () => {
  // Start (one viewport) · Planen (taller: 600 px more) · Jetzt (one viewport, last with the footer).
  const pages: PageRange[] = [
    { top: 0, bottom: 0 },
    { top: 1000, bottom: 1600 },
    { top: 2600, bottom: 2900 },
  ];

  describe('pageStep', () => {
    it('glides from a page that fits to the next one', () => {
      expect(pageStep(0, pages, 1)).toBe(1000);
    });

    it('leaves a tall page to the browser until its end', () => {
      expect(pageStep(1000, pages, 1)).toBeNull();
      expect(pageStep(1300, pages, 1)).toBeNull();
    });

    it('glides on from the end of a tall page', () => {
      expect(pageStep(1600, pages, 1)).toBe(2600);
    });

    it('goes up to the end of the page before', () => {
      expect(pageStep(2600, pages, -1)).toBe(1600);
      expect(pageStep(1300, pages, -1)).toBeNull();
      expect(pageStep(1000, pages, -1)).toBe(0);
    });

    it('stops at both ends of the landing', () => {
      expect(pageStep(0, pages, -1)).toBeNull();
      expect(pageStep(2900, pages, 1)).toBeNull();
    });
  });

  describe('settleTarget', () => {
    it('leaves a valid resting place alone', () => {
      expect(settleTarget(1300, pages, 1, 1000)).toBeNull();
      expect(settleTarget(0, pages, 0, 1000)).toBeNull();
    });

    it('finishes a stopped scroll in its direction', () => {
      expect(settleTarget(2300, pages, 1, 1000)).toBe(2600);
      expect(settleTarget(1900, pages, -1, 1000)).toBe(1600);
    });

    it('falls back after a small overshoot past a page end', () => {
      expect(settleTarget(1700, pages, 1, 1000)).toBe(1600);
      expect(settleTarget(2500, pages, -1, 1000)).toBe(2600);
    });

    it('takes the nearer end without a direction', () => {
      expect(settleTarget(1700, pages, 0, 1000)).toBe(1600);
      expect(settleTarget(2500, pages, 0, 1000)).toBe(2600);
    });
  });
});
