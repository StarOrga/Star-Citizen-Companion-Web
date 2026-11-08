import { StabilityVerdict, rollingThresholds, stabilityWord } from './patch-stability';

function v(line: string, stability: number | null, insufficient = false): StabilityVerdict {
  return { line, stability, insufficient } as StabilityVerdict;
}

/** Finished lines with the given values, followed by a LIVE line (never counted). */
function history(values: (number | null)[], live = 10): StabilityVerdict[] {
  return [...values.map((s, i) => v('L' + i, s, s === null)), v('LIVE', live)];
}

describe('rollingThresholds', () => {
  it('falls back to 75/45 with fewer than 5 finished lines', () => {
    expect(rollingThresholds(history([90, 80, 70, 60]))).toEqual({ stabilMin: 75, wackeligMin: 45, rolling: false });
    expect(rollingThresholds([])).toEqual({ stabilMin: 75, wackeligMin: 45, rolling: false });
  });

  it('derives the terciles (linear interpolation) from exactly 5 lines', () => {
    // sorted 40 50 60 80 90: pos 2.667 -> 60 + 20*0.667 = 73.3; pos 1.333 -> 50 + 10*0.333 = 53.3
    expect(rollingThresholds(history([90, 40, 60, 80, 50]))).toEqual({ stabilMin: 73, wackeligMin: 53, rolling: true });
  });

  it('uses only the last 7 finished lines', () => {
    const t = rollingThresholds(history([5, 5, 40, 50, 60, 80, 90, 70, 65]));
    const same = rollingThresholds(history([40, 50, 60, 80, 90, 70, 65]));
    expect(t).toEqual(same);
    expect(t.rolling).toBe(true);
  });

  it('never counts the newest (LIVE) line', () => {
    expect(rollingThresholds(history([40, 50, 60, 80, 90], 0))).toEqual(rollingThresholds(history([40, 50, 60, 80, 90], 100)));
  });

  it('skips insufficient lines', () => {
    expect(rollingThresholds(history([40, null, 50, 60, 80])).rolling).toBe(false);
    expect(rollingThresholds(history([40, null, 50, 60, 80, 90])).rolling).toBe(true);
  });

  it('falls back when the values give no valid ordering', () => {
    expect(rollingThresholds(history([70, 70, 70, 70, 70]))).toEqual({ stabilMin: 75, wackeligMin: 45, rolling: false });
  });
});

describe('stabilityWord with thresholds', () => {
  const t = { stabilMin: 60, wackeligMin: 30 };
  it('applies the given cut-offs', () => {
    expect(stabilityWord(60, t)).toBe('stabil');
    expect(stabilityWord(59.9, t)).toBe('wackelig');
    expect(stabilityWord(30, t)).toBe('wackelig');
    expect(stabilityWord(29, t)).toBe('instabil');
    expect(stabilityWord(null, t)).toBeNull();
  });
  it('defaults to 75/45', () => {
    expect(stabilityWord(75)).toBe('stabil');
    expect(stabilityWord(44)).toBe('instabil');
  });
});
