import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { AnalyticsService } from '../../core/analytics.service';
import { VERSE_BETA_STORAGE_KEY, VerseBetaService } from './verse-beta.service';

describe('VerseBetaService', () => {
  let flags: WritableSignal<Record<string, boolean | string>>;
  let captureVerse: jasmine.Spy;

  function create(): VerseBetaService {
    TestBed.configureTestingModule({
      providers: [{ provide: AnalyticsService, useValue: { flags: () => flags(), captureVerse } }],
    });
    return TestBed.inject(VerseBetaService);
  }

  beforeEach(() => {
    localStorage.removeItem(VERSE_BETA_STORAGE_KEY);
    flags = signal<Record<string, boolean | string>>({});
    captureVerse = jasmine.createSpy('captureVerse');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.removeItem(VERSE_BETA_STORAGE_KEY);
  });

  it('defaults every area to off', () => {
    const svc = create();
    expect(Object.values(svc.state()).every((v) => v === false)).toBeTrue();
    expect(svc.anyEnabled()).toBeFalse();
  });

  it('persists a per-area choice and emits verse_beta_toggle', () => {
    const svc = create();
    svc.set('news', true);
    expect(svc.state().news).toBeTrue();
    expect(svc.state().gallery).toBeFalse();
    expect(svc.isEnabled('news')()).toBeTrue();
    expect(JSON.parse(localStorage.getItem(VERSE_BETA_STORAGE_KEY) ?? '{}')).toEqual({ news: true });
    expect(captureVerse).toHaveBeenCalledWith('verse_beta_toggle', { area: 'news', enabled: true });
    TestBed.resetTestingModule();
    expect(create().state().news).toBeTrue();
  });

  it('treats a flag true as default and a flag false as a kill switch', () => {
    const svc = create();
    flags.set({ 'verse-beta-gallery': true, 'verse-beta-news': false });
    expect(svc.state().gallery).toBeTrue();
    svc.set('news', true);
    expect(svc.state().news).toBeFalse();
    expect(svc.locked().news).toBeTrue();
    svc.set('gallery', false);
    expect(svc.state().gallery).toBeFalse();
  });

  it('survives unreadable and unwritable storage', () => {
    localStorage.setItem(VERSE_BETA_STORAGE_KEY, '{not json');
    const svc = create();
    spyOn(Storage.prototype, 'setItem').and.throwError('quota');
    expect(() => svc.toggle('starmap')).not.toThrow();
    expect(svc.state().starmap).toBeTrue();
  });
});
