import { TestBed } from '@angular/core/testing';
import { LANG_STORAGE_KEY, LocaleService, REGION_STORAGE_KEY } from '../core/locale/locale.service';
import { activeNumberLocale, formatNumber, setNumberLocale } from './codex-format';
import { CodexNumberLocaleService } from './codex-number-locale';

/**
 * The wiring feedback dbdb2ffe asked for: the catalog's own number formatter
 * follows the UI language, so the ship page reads "1.636,88" in German and
 * "1,636.88" in English without any call site naming a locale.
 */
describe('CodexNumberLocaleService', () => {
  let locale: LocaleService;

  beforeEach(() => {
    localStorage.removeItem(LANG_STORAGE_KEY);
    localStorage.removeItem(REGION_STORAGE_KEY);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    locale = TestBed.inject(LocaleService);
    locale.setLanguage('en');
    TestBed.inject(CodexNumberLocaleService);
    TestBed.flushEffects();
  });

  afterEach(() => {
    // The formatter is module state — a leaked "de" would re-format every
    // later spec's expectations.
    setNumberLocale('en');
    localStorage.removeItem(LANG_STORAGE_KEY);
    localStorage.removeItem(REGION_STORAGE_KEY);
  });

  it('pushes the resolved UI language into the codex formatter', () => {
    expect(activeNumberLocale()).toBe('en');
    expect(formatNumber(1636.88)).toBe('1,636.88');
  });

  it('follows a later language switch', () => {
    locale.setLanguage('de');
    TestBed.flushEffects();
    expect(activeNumberLocale()).toBe('de');
    expect(formatNumber(1636.88)).toBe('1.636,88');
    expect(formatNumber(130.95)).toBe('130,95');

    locale.setLanguage('en');
    TestBed.flushEffects();
    expect(formatNumber(1636.88)).toBe('1,636.88');
  });
});
