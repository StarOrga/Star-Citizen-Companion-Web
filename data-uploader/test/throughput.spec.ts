import { describe, expect, it } from 'vitest';
import { pruneSamples, throughput, type ThroughputSample } from '../src/lib/throughput';

describe('throughput', () => {
  it('needs two samples and a few seconds of span', () => {
    expect(throughput([{ t: 0, current: 0 }], 10_000)).toBeNull();
    expect(throughput([{ t: 0, current: 0 }, { t: 1000, current: 5 }], 2000)).toBeNull();
  });

  it('measures against now, so a stall decays the rate', () => {
    const s: ThroughputSample[] = [
      { t: 0, current: 0 },
      { t: 10_000, current: 20 },
    ];
    expect(throughput(s, 10_000)).toBeCloseTo(2);
    // 30 s later nothing moved: the rate halves... and keeps falling.
    expect(throughput(s, 20_000)).toBeCloseTo(1);
    expect(throughput(s, 40_000)).toBeCloseTo(0.5);
  });

  it('a short burst does not dominate a long slow phase', () => {
    // 60 items in the first 2 s (cache hits), then 1 item every 5 s.
    const s: ThroughputSample[] = [{ t: 0, current: 0 }, { t: 2000, current: 60 }];
    for (let i = 1; i <= 30; i++) s.push({ t: 2000 + i * 5000, current: 60 + i });
    const now = 2000 + 30 * 5000;
    pruneSamples(s, now);
    expect(throughput(s, now)).toBeCloseTo(0.2, 1);
  });

  it('prune keeps exactly one base sample before the window', () => {
    const s: ThroughputSample[] = [0, 10, 20, 70, 80].map((sec) => ({ t: sec * 1000, current: sec }));
    pruneSamples(s, 90_000, 60_000);
    expect(s.map((x) => x.t / 1000)).toEqual([20, 70, 80]);
  });
});
