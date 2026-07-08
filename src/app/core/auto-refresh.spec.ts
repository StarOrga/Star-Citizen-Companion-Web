import { isIdle, DEFAULT_IDLE_GRACE_MS, DEFAULT_REFRESH_INTERVAL_MS } from './auto-refresh';

describe('auto-refresh · isIdle', () => {
  it('is idle once the threshold has fully elapsed', () => {
    expect(isIdle(1_000, 1_000 + 10_000, 10_000)).toBe(true);
  });

  it('is idle when more than the threshold has elapsed', () => {
    expect(isIdle(1_000, 20_000, 10_000)).toBe(true);
  });

  it('is not idle before the threshold elapses', () => {
    expect(isIdle(1_000, 1_000 + 9_999, 10_000)).toBe(false);
  });

  it('treats a zero threshold as always idle', () => {
    expect(isIdle(5_000, 5_000, 0)).toBe(true);
  });

  it('ships sane defaults (idle grace clears the requested 5s floor)', () => {
    expect(DEFAULT_IDLE_GRACE_MS).toBeGreaterThanOrEqual(5_000);
    expect(DEFAULT_REFRESH_INTERVAL_MS).toBeGreaterThan(0);
  });
});
