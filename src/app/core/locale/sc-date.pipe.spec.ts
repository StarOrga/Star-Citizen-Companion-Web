import { TestBed } from '@angular/core/testing';
import { LANG_STORAGE_KEY, LocaleService, REGION_STORAGE_KEY } from './locale.service';
import { ScDatePipe } from './sc-date.pipe';

describe('ScDatePipe', () => {
  const date = new Date(2026, 6, 31, 14, 5, 0);
  let locale: LocaleService;
  let pipe: ScDatePipe;

  beforeEach(() => {
    localStorage.removeItem(LANG_STORAGE_KEY);
    localStorage.removeItem(REGION_STORAGE_KEY);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    locale = TestBed.inject(LocaleService);
    locale.setBrowserSignals({ languages: ['en-GB'] });
    pipe = TestBed.runInInjectionContext(() => new ScDatePipe());
  });

  afterEach(() => {
    localStorage.removeItem(LANG_STORAGE_KEY);
    localStorage.removeItem(REGION_STORAGE_KEY);
  });

  it('formats with the resolved locale, date-only by default', () => {
    expect(pipe.transform(date)).toBe('31 / July / 2026');
    expect(pipe.transform(date, 'datetime')).toBe('31 / July / 2026 · 14:05');
  });

  it('re-renders after the user switches language or region', () => {
    expect(pipe.transform(date)).toBe('31 / July / 2026');
    locale.setLanguage('de');
    expect(pipe.transform(date)).toBe('31 / Juli / 2026');
    locale.setRegion('US');
    expect(pipe.transform(date)).toBe('Juli / 31 / 2026');
  });

  it('serves the memoized string for a repeated call', () => {
    const first = pipe.transform(date);
    expect(pipe.transform(date)).toBe(first);
    // Equal-but-distinct Date instances count as the same instant.
    expect(pipe.transform(new Date(date.getTime()))).toBe(first);
  });

  it('renders empty for a missing value', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });
});
