import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { relativeDayBucket } from './date-format';
import { LANG_STORAGE_KEY, LocaleService, REGION_STORAGE_KEY } from './locale.service';
import { ScDateRelativePipe } from './sc-relative-date.pipe';

describe('relativeDayBucket', () => {
  // 14:05 local, so "one calendar day back" and "24 hours back" disagree — the
  // buckets must follow the calendar.
  const now = new Date(2026, 8, 7, 14, 5, 0);
  const daysAgo = (n: number, h = 14) => new Date(2026, 8, 7 - n, h, 5, 0);

  it('buckets by calendar day, not by elapsed hours', () => {
    expect(relativeDayBucket(daysAgo(0, 0), now)).toBe('today');
    expect(relativeDayBucket(daysAgo(0, 23), now)).toBe('today');
    // 23:59 yesterday is barely 14 hours ago and still "gestern".
    expect(relativeDayBucket(daysAgo(1, 23), now)).toBe('yesterday');
  });

  it('walks today → yesterday → week → month → earlier', () => {
    expect(relativeDayBucket(daysAgo(2), now)).toBe('lastWeek');
    expect(relativeDayBucket(daysAgo(7), now)).toBe('lastWeek');
    expect(relativeDayBucket(daysAgo(8), now)).toBe('lastMonth');
    expect(relativeDayBucket(daysAgo(31), now)).toBe('lastMonth');
    expect(relativeDayBucket(daysAgo(32), now)).toBe('earlier');
  });

  it('has no bucket for the future or for junk', () => {
    expect(relativeDayBucket(daysAgo(-1), now)).toBeNull();
    expect(relativeDayBucket('not a date', now)).toBeNull();
    expect(relativeDayBucket(null, now)).toBeNull();
  });

  it('defaults its reference point to now', () => {
    expect(relativeDayBucket(new Date())).toBe('today');
  });
});

describe('ScDateRelativePipe', () => {
  let locale: LocaleService;
  let pipe: ScDateRelativePipe;

  const dayOffset = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  };

  beforeEach(() => {
    localStorage.removeItem(LANG_STORAGE_KEY);
    localStorage.removeItem(REGION_STORAGE_KEY);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideTranslateService({ fallbackLang: 'en' })],
    });
    const translate = TestBed.inject(TranslateService);
    // Real sentences, so a missing key shows up as the raw key and fails.
    translate.setTranslation('en', {
      date: {
        relative: { today: 'Today', yesterday: 'Yesterday', lastWeek: 'Last week', lastMonth: 'Last month', earlier: 'Earlier' },
        relativeSince: { today: 'since today', yesterday: 'since yesterday', lastWeek: 'since last week', lastMonth: 'since last month', earlier: 'for a while now' },
      },
    });
    translate.use('en');
    locale = TestBed.inject(LocaleService);
    locale.setBrowserSignals({ languages: ['en-GB'] });
    pipe = TestBed.runInInjectionContext(() => new ScDateRelativePipe());
  });

  afterEach(() => {
    localStorage.removeItem(LANG_STORAGE_KEY);
    localStorage.removeItem(REGION_STORAGE_KEY);
  });

  it('labels the age instead of the calendar date', () => {
    expect(pipe.transform(dayOffset(0))).toBe('Today');
    expect(pipe.transform(dayOffset(1))).toBe('Yesterday');
    expect(pipe.transform(dayOffset(3))).toBe('Last week');
  });

  it('uses the prepositional form behind "since"', () => {
    expect(pipe.transform(dayOffset(1), 'since')).toBe('since yesterday');
    expect(pipe.transform(dayOffset(3), 'since')).toBe('since last week');
  });

  it('falls back to the absolute date when no bucket fits', () => {
    const future = new Date(2099, 0, 2, 12, 0, 0);
    expect(pipe.transform(future)).toBe('02 / January / 2099');
    expect(pipe.transform(null)).toBe('');
  });

  it('re-renders after the user switches language or region', () => {
    const future = new Date(2099, 0, 2, 12, 0, 0);
    expect(pipe.transform(future)).toBe('02 / January / 2099');
    locale.setRegion('US');
    expect(pipe.transform(future)).toBe('January / 02 / 2099');
  });

  it('serves the memoized label for a repeated call', () => {
    const first = pipe.transform(dayOffset(0));
    expect(pipe.transform(dayOffset(0))).toBe(first);
  });
});
