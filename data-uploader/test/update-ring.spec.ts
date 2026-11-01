import { describe, expect, it } from 'vitest';
import { effectiveRing, highestRingFor, isRingPref } from '../src/lib/update-ring.js';

describe('update ring', () => {
  it('auto follows the highest ring the role reaches', () => {
    expect(highestRingFor('admin')).toBe('alpha');
    expect(highestRingFor('collaborator')).toBe('beta');
    expect(highestRingFor('viewer')).toBe('stable');
    expect(highestRingFor(null)).toBe('stable');
  });

  it('a pin wins over the resolved auto ring', () => {
    expect(effectiveRing('auto', 'alpha')).toBe('alpha');
    expect(effectiveRing('stable', 'alpha')).toBe('stable');
    expect(effectiveRing('beta', 'stable')).toBe('beta');
  });

  it('accepts only known preferences', () => {
    expect(isRingPref('auto')).toBe(true);
    expect(isRingPref('nightly')).toBe(false);
    expect(isRingPref(undefined)).toBe(false);
  });
});
