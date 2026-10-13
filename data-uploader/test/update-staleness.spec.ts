import { describe, it, expect } from 'vitest';
import { isStagedSuperseded, shouldReplaceStaged } from '../src/lib/update-staleness.js';

describe('isStagedSuperseded', () => {
  it('flags a staged update once a newer release is on the feed', () => {
    expect(isStagedSuperseded('0.53.0', '0.54.0')).toBe(true);
    expect(isStagedSuperseded('0.53.0-alpha.1', '0.53.0')).toBe(true);
  });

  it('keeps the staged update when the feed has nothing newer', () => {
    expect(isStagedSuperseded('0.53.0', '0.53.0')).toBe(false);
    expect(isStagedSuperseded('0.53.0', '0.52.0')).toBe(false);
  });

  it('never claims superseded without both versions', () => {
    expect(isStagedSuperseded(null, '0.54.0')).toBe(false);
    expect(isStagedSuperseded('0.53.0', null)).toBe(false);
  });
});

describe('shouldReplaceStaged', () => {
  it('downloads when nothing is staged', () => {
    expect(shouldReplaceStaged(null, '0.53.0')).toBe(true);
  });

  it('replaces the staged update only with a newer one', () => {
    expect(shouldReplaceStaged('0.53.0', '0.54.0')).toBe(true);
    expect(shouldReplaceStaged('0.53.0', '0.53.0')).toBe(false);
    expect(shouldReplaceStaged('0.54.0', '0.53.0')).toBe(false);
  });
});
