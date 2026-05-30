import { describe, it, expect } from 'vitest';
import { PROFILES, DEFAULT_PROFILE, estimateForSize } from '../src/lib/performance.js';

describe('performance profiles', () => {
  it('default is standard', () => {
    expect(DEFAULT_PROFILE).toBe('standard');
  });

  it('exposes all 4 profiles', () => {
    expect(Object.keys(PROFILES).sort()).toEqual(['auto', 'maximum', 'minimal', 'standard']);
  });

  it('estimates time per size — minimal is slowest, maximum is fastest', () => {
    const gb = 100;
    const sizeBytes = gb * 1024 ** 3;
    const minEta = estimateForSize('minimal', sizeBytes);
    const maxEta = estimateForSize('maximum', sizeBytes);
    expect(minEta.seconds).toBeGreaterThan(maxEta.seconds);
  });

  it('formats short durations as seconds', () => {
    const eta = estimateForSize('maximum', 1024 * 1024 * 1024); // 1 GB
    expect(eta.formatted).toMatch(/(s|min)$/);
  });
});
