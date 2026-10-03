import {
  MANUFACTURER_ACCENTS,
  MIN_ACCENT_LUMINANCE,
  manufacturerAccent,
  manufacturerCode,
  readableAccent,
  relativeLuminance,
  rgbToken,
} from './holo-manufacturer';

const APP = [82, 193, 230] as const;

describe('holo-manufacturer', () => {
  it('reads the manufacturer code off a class name', () => {
    expect(manufacturerCode('AEGS_Gladius')).toBe('AEGS');
    expect(manufacturerCode('drak_cutlass_black')).toBe('DRAK');
    expect(manufacturerCode('RSI_Aurora_MR')).toBe('RSI');
    expect(manufacturerCode('Gladius')).toBeNull();
    expect(manufacturerCode(null)).toBeNull();
    expect(manufacturerCode('')).toBeNull();
  });

  it('resolves the big manufacturers to distinct accents', () => {
    const codes = ['AEGS', 'DRAK', 'RSI', 'ANVL', 'MISC', 'ORIG', 'CRUS'];
    const colours = codes.map((c) => rgbToken(manufacturerAccent(`${c}_Ship`, APP)));
    expect(new Set(colours).size).toBe(codes.length);
    expect(manufacturerAccent('DRAK_Cutlass_Black', APP)).toEqual(MANUFACTURER_ACCENTS['DRAK']);
  });

  it('falls back to the app accent for an unknown or missing prefix', () => {
    expect(manufacturerAccent('ZZZZ_Mystery', APP)).toEqual(readableAccent(APP));
    expect(manufacturerAccent('NoPrefix', APP)).toEqual(readableAccent(APP));
    expect(manufacturerAccent(undefined, APP)).toEqual(readableAccent(APP));
  });

  it('keeps every accent readable as a glow on the dark stage', () => {
    for (const [code, c] of Object.entries(MANUFACTURER_ACCENTS)) {
      expect(relativeLuminance(manufacturerAccent(`${code}_X`, APP)))
        .withContext(code)
        .toBeGreaterThanOrEqual(MIN_ACCENT_LUMINANCE - 0.005);
      expect(c.every((v) => v >= 0 && v <= 255)).withContext(code).toBeTrue();
    }
  });

  it('lifts a dark colour toward white, leaves a bright one alone', () => {
    const dark = readableAccent([40, 20, 120]);
    expect(relativeLuminance(dark)).toBeGreaterThanOrEqual(MIN_ACCENT_LUMINANCE - 0.005);
    expect(dark[2]).toBeGreaterThan(dark[1]); // still blue-violet, not grey
    expect(readableAccent([255, 210, 64])).toEqual([255, 210, 64]);
  });

  it('formats an rgb custom-property value', () => {
    expect(rgbToken([1, 2, 3])).toBe('1, 2, 3');
  });
});
