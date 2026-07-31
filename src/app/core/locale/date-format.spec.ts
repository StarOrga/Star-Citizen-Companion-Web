import { formatScDate, formatScTime, intlLocaleOf, toDateOrNull } from './date-format';

// Built from local parts on purpose: the formatter renders in the viewer's own
// zone, so an ISO string with a fixed offset would make the assertions depend
// on where the test runs.
const D = new Date(2026, 6, 31, 14, 5, 0); // 31 July 2026, 14:05 local
const JAN = new Date(2026, 0, 5, 9, 0, 0); // 05 January 2026, 09:00 local

describe('formatScDate', () => {
  it('renders day / spelled-out month / year for day-first regions', () => {
    expect(formatScDate(D, { language: 'de', region: 'DE' })).toBe('31 / Juli / 2026');
    expect(formatScDate(D, { language: 'en', region: 'GB' })).toBe('31 / July / 2026');
  });

  it('renders month first for month-first regions', () => {
    expect(formatScDate(D, { language: 'en', region: 'US' })).toBe('July / 31 / 2026');
  });

  it('renders year first for year-first regions', () => {
    expect(formatScDate(D, { language: 'en', region: 'JP' })).toBe('2026 / July / 31');
  });

  it('takes the month NAME from the language and the ORDER from the region', () => {
    // German UI, US region — both axes visible in one string.
    expect(formatScDate(D, { language: 'de', region: 'US' })).toBe('Juli / 31 / 2026');
  });

  it('pads the day to two digits', () => {
    expect(formatScDate(JAN, { language: 'de', region: 'DE' })).toBe('05 / Januar / 2026');
  });

  it('appends the clock for the datetime style', () => {
    expect(formatScDate(D, { language: 'de', region: 'DE', style: 'datetime' })).toBe(
      '31 / Juli / 2026 · 14:05',
    );
  });

  it('renders the clock alone for the time style', () => {
    expect(formatScDate(D, { language: 'de', region: 'DE', style: 'time' })).toBe('14:05');
  });

  it('accepts ISO strings, epoch millis and Date objects alike', () => {
    const iso = new Date(2026, 6, 31, 14, 5, 0).toISOString();
    expect(formatScDate(iso, { language: 'en', region: 'GB' })).toBe('31 / July / 2026');
    expect(formatScDate(D.getTime(), { language: 'en', region: 'GB' })).toBe('31 / July / 2026');
  });

  it('returns an empty string for missing or unparseable input', () => {
    for (const bad of [null, undefined, '', 'not a date', Number.NaN]) {
      expect(formatScDate(bad, { language: 'de', region: 'DE' })).toBe('');
    }
  });

  it('falls back to a readable format instead of throwing on a junk region', () => {
    expect(formatScDate(D, { language: 'de', region: '??' })).toContain('2026');
  });

  it('defaults unknown regions to day-first', () => {
    expect(formatScDate(D, { language: 'en', region: 'ZZ' })).toBe('31 / July / 2026');
  });
});

describe('formatScTime', () => {
  it('uses a 24-hour clock in 24-hour regions', () => {
    expect(formatScTime(D, 'de', 'DE')).toBe('14:05');
    expect(formatScTime(D, 'en', 'GB')).toBe('14:05');
  });

  it('uses a 12-hour clock in 12-hour regions — driven by region, not language', () => {
    expect(formatScTime(D, 'en', 'US')).toMatch(/^0?2:05\s?PM$/i);
    expect(formatScTime(D, 'de', 'US')).toMatch(/2:05/);
  });
});

describe('intlLocaleOf', () => {
  it('joins language and region into a BCP-47 tag', () => {
    expect(intlLocaleOf('de', 'AT')).toBe('de-AT');
    expect(intlLocaleOf('de-DE', 'us')).toBe('de-US');
  });

  it('drops an unusable region instead of emitting a broken tag', () => {
    expect(intlLocaleOf('en', '')).toBe('en');
    expect(intlLocaleOf('en', 'XYZ')).toBe('en');
  });
});

describe('toDateOrNull', () => {
  it('rejects everything that is not a real instant', () => {
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull('')).toBeNull();
    expect(toDateOrNull('nope')).toBeNull();
    expect(toDateOrNull(new Date('nope'))).toBeNull();
    expect(toDateOrNull(D)).toBe(D);
  });
});
