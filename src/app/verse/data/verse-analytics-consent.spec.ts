import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '../../core/analytics.service';
import { ConsentService } from '../../core/consent.service';

/**
 * Verse hub events never leave the app and PostHog flags are never read
 * before the user opted into statistics. A fake client stands in for posthog-js.
 */
describe('Verse analytics consent gate', () => {
  let svc: AnalyticsService;
  let consent: ConsentService;
  let capture: jasmine.Spy;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [AnalyticsService, ConsentService, provideRouter([])] });
    svc = TestBed.inject(AnalyticsService);
    consent = TestBed.inject(ConsentService);
    capture = jasmine.createSpy('capture');
    (svc as unknown as { client: unknown }).client = { capture };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('sends no Verse event before any consent decision', () => {
    svc.captureVerse('verse_top_open', { key: 'news:a', kind: 'news', rank: 1, pinned: false });
    svc.captureVerse('verse_door_open', { door: 'gallery' });
    svc.captureVerse('verse_beta_toggle', { area: 'news', enabled: true });
    svc.captureVerse('starscape_share', { image_id: 'x', channel: 'copy' });
    svc.captureVerse('verse_star_earned', { patch_line: '4.3', star_key: 'notes' });
    expect(capture).not.toHaveBeenCalled();
  });

  it('sends no Verse event after declining statistics', () => {
    consent.essentialOnly();
    svc.captureVerse('verse_door_open', { door: 'news' });
    expect(capture).not.toHaveBeenCalled();
  });

  it('exposes no feature flags without consent', () => {
    (svc as unknown as { flagValues: { set(v: unknown): void } }).flagValues.set({ 'verse-beta-news': true });
    expect(svc.featureFlag('verse-beta-news')).toBeUndefined();
    consent.setStatistics(true);
    expect(svc.featureFlag('verse-beta-news')).toBeTrue();
  });

  it('sends the typed event once statistics consent is granted', () => {
    consent.setStatistics(true);
    svc.captureVerse('verse_door_open', { door: 'patches' });
    expect(capture).toHaveBeenCalledOnceWith('verse_door_open', { door: 'patches' });
  });
});
