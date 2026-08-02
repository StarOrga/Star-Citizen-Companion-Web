import { TestBed } from '@angular/core/testing';
import { LANG_STORAGE_KEY, LocaleService, REGION_STORAGE_KEY } from './locale.service';

describe('LocaleService', () => {
  function make(): LocaleService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(LocaleService);
  }

  beforeEach(() => {
    localStorage.removeItem(LANG_STORAGE_KEY);
    localStorage.removeItem(REGION_STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(LANG_STORAGE_KEY);
    localStorage.removeItem(REGION_STORAGE_KEY);
  });

  it('reports "auto" until the user picks something', () => {
    const svc = make();
    svc.setBrowserSignals({ languages: ['en-US'] });
    expect(svc.languageSetting()).toBe('auto');
    expect(svc.regionSetting()).toBe('auto');
    expect(svc.languageIsAuto()).toBeTrue();
    expect(svc.language()).toBe('en');
    expect(svc.region()).toBe('US');
  });

  it('persists an explicit choice and restores it on the next visit', () => {
    const svc = make();
    svc.setBrowserSignals({ languages: ['en-US'] });
    svc.setLanguage('de');
    svc.setRegion('AT');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('de');
    expect(localStorage.getItem(REGION_STORAGE_KEY)).toBe('AT');

    // A fresh injector stands in for a reload.
    const reloaded = make();
    reloaded.setBrowserSignals({ languages: ['en-US'] });
    expect(reloaded.language()).toBe('de');
    expect(reloaded.region()).toBe('AT');
    expect(reloaded.dateOrder()).toBe('dmy');
    expect(reloaded.intlLocale()).toBe('de-AT');
  });

  it('hands the decision back to detection on "auto"', () => {
    const svc = make();
    svc.setBrowserSignals({ languages: ['en-US'] });
    svc.setRegion('AT');
    expect(svc.region()).toBe('AT');

    svc.setRegion('auto');
    expect(localStorage.getItem(REGION_STORAGE_KEY)).toBeNull();
    expect(svc.regionSetting()).toBe('auto');
    expect(svc.region()).toBe('US');
  });

  it('lets the profile win over the browser', () => {
    const svc = make();
    svc.setBrowserSignals({ languages: ['en-US'], timeZone: 'America/New_York' });
    svc.hydrateFromProfile('de', 'AT');
    expect(svc.language()).toBe('de');
    expect(svc.region()).toBe('AT');
    expect(svc.languageSetting()).toBe('de');
  });

  it('ignores unusable profile values (legacy languages, missing column)', () => {
    const svc = make();
    svc.setBrowserSignals({ languages: ['en-US'] });
    svc.hydrateFromProfile('fr', null);
    expect(svc.language()).toBe('en');
    expect(svc.region()).toBe('US');
    expect(svc.languageSetting()).toBe('auto');
  });

  it('keeps a choice made this session when the profile hydrates late', () => {
    // The shell fetches the profile asynchronously; a late answer must not
    // clobber the switch the user just made.
    const svc = make();
    svc.setBrowserSignals({ languages: ['en-US'] });
    svc.setLanguage('de');
    svc.hydrateFromProfile('en', 'US');
    expect(svc.language()).toBe('de');
  });

  it('drops the profile preferences on sign-out', () => {
    const svc = make();
    svc.setBrowserSignals({ languages: ['en-US'] });
    svc.hydrateFromProfile('de', 'AT');
    svc.clearProfile();
    // hydrateFromProfile mirrored the values into localStorage, so they survive
    // as the local choice — the point is only that nothing crashes and the
    // resolution keeps working.
    expect(svc.language()).toBe('de');
    expect(svc.region()).toBe('AT');
  });

  it('survives junk in localStorage', () => {
    localStorage.setItem(LANG_STORAGE_KEY, 'zz');
    localStorage.setItem(REGION_STORAGE_KEY, 'garbage');
    const svc = make();
    svc.setBrowserSignals({ languages: ['de-DE'] });
    expect(svc.language()).toBe('de');
    expect(svc.region()).toBe('DE');
  });
});
