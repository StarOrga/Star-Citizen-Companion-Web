import { currentPatchName, formerPatchName, samePatch } from './patch-alias';

describe('patch alias', () => {
  const map = { '4.11': '5.0', '5.0': '5.1' };
  it('resolves renames incl. chains and leaves others alone', () => {
    expect(currentPatchName('4.11')).toBe('5.0');
    expect(currentPatchName('4.10')).toBe('4.10');
    expect(currentPatchName('4.11', map)).toBe('5.1');
  });
  it('knows the former name from either side', () => {
    expect(formerPatchName('4.11')).toBe('4.11');
    expect(formerPatchName('5.0')).toBe('4.11');
    expect(formerPatchName('4.10')).toBeNull();
  });
  it('matches the same patch under both names', () => {
    expect(samePatch('4.11', '5.0')).toBe(true);
    expect(samePatch('4.10', '5.0')).toBe(false);
  });
});
