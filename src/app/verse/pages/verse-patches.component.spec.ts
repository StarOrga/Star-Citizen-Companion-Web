import { cometStrip } from './verse-patches.component';

describe('cometStrip', () => {
  it('is null without a parsable median', () => {
    expect(cometStrip(null, null)).toBeNull();
    expect(cometStrip('nope', null)).toBeNull();
  });

  it('centres a lone median', () => {
    const s = cometStrip('2026-11-06', null)!;
    expect(s.medianPct).toBe(50);
    expect(s.minePct).toBeNull();
  });

  it('places the own tip on the same axis as the median', () => {
    const s = cometStrip('2026-11-06', '2026-11-08')!;
    expect(s.minePct!).toBeGreaterThan(s.medianPct);
    expect(s.medianPct).toBeGreaterThan(0);
    expect(s.minePct!).toBeLessThan(100);
  });
});
