import { describe, it, expect } from 'vitest';
import {
  PROFILES,
  DEFAULT_PROFILE,
  SELECTABLE_PROFILES,
  estimateForSize,
  workersFor,
} from '../src/lib/performance.js';

describe('performance profiles', () => {
  it('default is standard', () => {
    expect(DEFAULT_PROFILE).toBe('standard');
  });

  it('exposes all 4 profiles', () => {
    expect(Object.keys(PROFILES).sort()).toEqual(['auto', 'maximum', 'minimal', 'standard']);
  });

  it('offers only the profiles that do what they say', () => {
    // `auto` stays defined — the throttle still accepts the id — but it is not
    // offered: as a pill it read "Smart" while its only real effect was
    // BelowNormal, so the smart-sounding choice made the run SLOWER than
    // Standard with nothing in the UI admitting it.
    expect([...SELECTABLE_PROFILES]).toEqual(['minimal', 'standard', 'maximum']);
    expect(SELECTABLE_PROFILES).not.toContain('auto');
  });

  it('declares no knob it does not actually apply', () => {
    // Every field here has to reach the sidecar or the OS. `diskThrottleMbps`
    // was removed for failing that test: `minimal` advertised "throttled disk
    // reads" and no code anywhere read the value.
    for (const p of Object.values(PROFILES)) {
      expect(p).not.toHaveProperty('diskThrottleMbps');
    }
  });
});

describe('workersFor', () => {
  it('scales the worker count with the level — this is what makes them differ', () => {
    expect(workersFor('minimal', 16)).toBe(1);
    expect(workersFor('standard', 16)).toBe(8);
    expect(workersFor('maximum', 16)).toBe(15);
  });

  it('leaves a core for the UI at maximum', () => {
    // Saturating every logical processor starves the Electron UI on the same
    // box — including the cancel button and the mode switch, i.e. exactly the
    // controls an operator reaches for when a run is too aggressive.
    for (const cores of [4, 8, 12, 16, 32, 64]) {
      expect(workersFor('maximum', cores)).toBe(cores - 1);
      expect(workersFor('maximum', cores)).toBeLessThan(cores);
    }
  });

  it('never returns zero, however small or broken the core count', () => {
    for (const cores of [1, 2, 0, -4, 1.7]) {
      for (const p of SELECTABLE_PROFILES) {
        expect(workersFor(p, cores)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('keeps minimal on the serial path', () => {
    // 1 worker means the sidecar runs the pre-parallel code path byte for byte
    // — no pool, no shared memory, no regression risk for the gentle profile.
    for (const cores of [1, 8, 64]) {
      expect(workersFor('minimal', cores)).toBe(1);
    }
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
