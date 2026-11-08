import { describe, expect, it } from 'vitest';
import { CPU_SMOOTH_ALPHA, SYSMON_STALE_MS, pickCpuTotal, smoothCpu } from '../src/lib/resource-limits';

describe('pickCpuTotal — whole-PC CPU source order', () => {
  it('prefers the process-attributed figure (Task Manager basis) over the wall-clock one', () => {
    // screenshot case: wall-clock counter 100, Task Manager 81
    const r = pickCpuTotal({ procPct: 81, timePct: 100, ageMs: 500, estimatePct: 97 });
    expect(r).toEqual({ pct: 81, source: 'proc' });
  });

  it('uses the wall-clock figure when sysmon sends no process figure', () => {
    expect(pickCpuTotal({ procPct: null, timePct: 42, ageMs: 900, estimatePct: 10 })).toEqual({ pct: 42, source: 'time' });
  });

  it('falls back to the estimate when the sample is stale, missing or the monitor never ran', () => {
    expect(pickCpuTotal({ procPct: 100, timePct: 100, ageMs: SYSMON_STALE_MS + 1, estimatePct: 37 })).toEqual({ pct: 37, source: 'estimate' });
    expect(pickCpuTotal({ procPct: 100, timePct: 100, ageMs: null, estimatePct: 12 })).toEqual({ pct: 12, source: 'estimate' });
    expect(pickCpuTotal({ procPct: 100, timePct: 100, ageMs: undefined, estimatePct: 12 }).source).toBe('estimate');
  });

  it('ignores NaN / non-finite figures and clamps to 0..100', () => {
    expect(pickCpuTotal({ procPct: Number.NaN, timePct: 55, ageMs: 100, estimatePct: 1 })).toEqual({ pct: 55, source: 'time' });
    expect(pickCpuTotal({ procPct: Number.NaN, timePct: Number.NaN, ageMs: 100, estimatePct: 64 }).source).toBe('estimate');
    expect(pickCpuTotal({ procPct: 140, timePct: null, ageMs: 100, estimatePct: 0 }).pct).toBe(100);
    expect(pickCpuTotal({ procPct: -4, timePct: null, ageMs: 100, estimatePct: 0 }).pct).toBe(0);
    expect(pickCpuTotal({ procPct: null, timePct: null, ageMs: null, estimatePct: Number.NaN }).pct).toBe(0);
  });
});

describe('smoothCpu', () => {
  it('takes the first value as is and then moves part of the way', () => {
    expect(smoothCpu(null, 80)).toBe(80);
    expect(smoothCpu(50, 100)).toBeCloseTo(50 + CPU_SMOOTH_ALPHA * 50);
  });

  it('does not stay pinned: a drop from 100 reaches the new level within a few ticks', () => {
    let v: number | null = 100;
    for (let i = 0; i < 6; i++) v = smoothCpu(v, 20);
    expect(v as number).toBeLessThan(30);
  });
});
