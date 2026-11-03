import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { AppTranslateLoader, FALLBACK_DELAY_MS } from './app-translate-loader';
import { LocaleService } from './locale.service';

/**
 * Guards the startup order: the active language never waits for the bundle's
 * own request when the boot script already has it, and the fallback table stays
 * off the wire until the page is up, unless English is really needed.
 */
describe('AppTranslateLoader', () => {
  const language = signal<'de' | 'en'>('de');
  let http: HttpTestingController;

  const setup = (boot?: Window['__scI18nBoot']): AppTranslateLoader => {
    window.__scI18nBoot = boot;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AppTranslateLoader,
        { provide: LocaleService, useValue: { language } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(AppTranslateLoader);
  };

  beforeEach(() => language.set('de'));
  afterEach(() => {
    delete window.__scI18nBoot;
    http.verify();
  });

  it('serves the active language from the boot request without a second fetch', fakeAsync(() => {
    const loader = setup({ lang: 'de', table: Promise.resolve({ a: 'boot' }) });
    let table: unknown;
    loader.getTranslation('de').subscribe((t) => (table = t));
    flushMicrotasks();
    expect(table).toEqual({ a: 'boot' });
  }));

  it('fetches itself when the boot request came back empty', fakeAsync(() => {
    const loader = setup({ lang: 'de', table: Promise.resolve(null) });
    let table: unknown;
    loader.getTranslation('de').subscribe((t) => (table = t));
    flushMicrotasks();
    http.expectOne('i18n/de.json').flush({ a: 'http' });
    expect(table).toEqual({ a: 'http' });
  }));

  it('uses the boot request only once, so a later reload gets fresh data', fakeAsync(() => {
    const loader = setup({ lang: 'de', table: Promise.resolve({ a: 'boot' }) });
    loader.getTranslation('de').subscribe();
    flushMicrotasks();
    loader.getTranslation('de').subscribe();
    http.expectOne('i18n/de.json').flush({ a: 'http' });
  }));

  it('ignores a boot request for another language', fakeAsync(() => {
    const loader = setup({ lang: 'de', table: Promise.resolve({ a: 'boot' }) });
    loader.getTranslation('fr').subscribe();
    http.expectOne('i18n/fr.json').flush({});
  }));

  it('holds the fallback table back until the delay has passed', fakeAsync(() => {
    const loader = setup();
    let table: unknown;
    loader.getTranslation('en').subscribe((t) => (table = t));
    TestBed.tick();
    tick(FALLBACK_DELAY_MS - 1);
    http.expectNone('i18n/en.json');
    tick(1);
    http.expectOne('i18n/en.json').flush({ a: 'en' });
    expect(table).toEqual({ a: 'en' });
  }));

  it('loads English at once when it becomes the active language', fakeAsync(() => {
    const loader = setup();
    loader.getTranslation('en').subscribe();
    TestBed.tick();
    http.expectNone('i18n/en.json');
    language.set('en');
    TestBed.tick();
    http.expectOne('i18n/en.json').flush({});
  }));

  it('does not delay English when it is active from the start', fakeAsync(() => {
    language.set('en');
    const loader = setup();
    loader.getTranslation('en').subscribe();
    TestBed.tick();
    http.expectOne('i18n/en.json').flush({});
  }));

  it('answers a second request for English at once, with one fetch', fakeAsync(() => {
    const loader = setup();
    let second: unknown;
    loader.getTranslation('en').subscribe();
    TestBed.tick();
    loader.getTranslation('en').subscribe((t) => (second = t));
    http.expectOne('i18n/en.json').flush({ a: 'en' });
    expect(second).toEqual({ a: 'en' });
  }));
});
