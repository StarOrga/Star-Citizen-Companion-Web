import { describe, it, expect } from 'vitest';
import { isNewerVersion, compareSemver } from '../src/lib/semver.js';

describe('compareSemver', () => {
  it('orders core versions numerically (not lexically)', () => {
    expect(compareSemver('0.21.1', '0.19.0')).toBe(1);
    expect(compareSemver('0.9.0', '0.10.0')).toBe(-1); // 9 < 10, not "9" > "1"
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('ranks a final release above its pre-releases', () => {
    expect(compareSemver('1.2.0', '1.2.0-alpha.1')).toBe(1);
    expect(compareSemver('1.2.0-beta.1', '1.2.0-alpha.9')).toBe(1);
    expect(compareSemver('1.2.0-alpha.2', '1.2.0-alpha.1')).toBe(1);
  });

  it('ignores build metadata and a leading v', () => {
    expect(compareSemver('v1.2.0+build.5', '1.2.0')).toBe(0);
  });
});

describe('isNewerVersion (updater downgrade guard)', () => {
  it('accepts a genuine upgrade', () => {
    expect(isNewerVersion('0.22.0', '0.21.1')).toBe(true);
    expect(isNewerVersion('0.21.2', '0.21.1')).toBe(true);
  });

  it('rejects the exact reported bug: stable ring offers 0.19.0 to a running 0.21.1', () => {
    expect(isNewerVersion('0.19.0', '0.21.1')).toBe(false);
  });

  it('rejects an equal version (no self-reinstall)', () => {
    expect(isNewerVersion('0.21.1', '0.21.1')).toBe(false);
  });

  it('rejects any lower version across a wider spread', () => {
    expect(isNewerVersion('0.1.0', '0.21.1')).toBe(false);
    expect(isNewerVersion('0.20.9', '0.21.0')).toBe(false);
  });
});
