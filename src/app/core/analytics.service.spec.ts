import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../environments/environment';
import { AnalyticsService, pageviewUrl } from './analytics.service';
import { ConsentService } from './consent.service';

/**
 * The shipped environments now carry the public PostHog project key (#139), so
 * these specs pin two contracts: a key is configured (EU region), and nothing
 * is captured or loaded until the user opts into the `statistics` category.
 * The original "inert until configured" path is still covered by temporarily
 * blanking the key — none of these specs actually load posthog-js.
 */
describe('AnalyticsService', () => {
  let svc: AnalyticsService;
  let consent: ConsentService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [AnalyticsService, ConsentService, provideRouter([])],
    });
    svc = TestBed.inject(AnalyticsService);
    consent = TestBed.inject(ConsentService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('ships with the public PostHog project key configured (EU)', () => {
    expect(environment.posthog.key).toMatch(/^phc_/);
    expect(environment.posthog.host).toContain('eu.i.posthog.com');
  });

  it('capture() does nothing without statistics consent', () => {
    consent.essentialOnly();
    expect(() => svc.capture('test_event')).not.toThrow();
    expect(Object.keys(localStorage).some((k) => k.startsWith('ph_'))).toBe(false);
  });

  it('init() stays inert without statistics consent, even with a key configured', () => {
    consent.essentialOnly();
    expect(() => svc.init()).not.toThrow();
    TestBed.flushEffects();
    // Consent is off, so the effect never opens the library — nothing loaded.
    expect(Object.keys(localStorage).some((k) => k.startsWith('ph_'))).toBe(false);
  });

  it('is a no-op when no key is configured, even with consent granted', () => {
    const originalKey = environment.posthog.key;
    environment.posthog.key = '';
    try {
      consent.acceptAll();
      expect(() => svc.init()).not.toThrow();
      TestBed.flushEffects();
      // Empty key short-circuits init() before any effect is registered.
      expect(Object.keys(localStorage).some((k) => k.startsWith('ph_'))).toBe(false);
    } finally {
      environment.posthog.key = originalKey;
    }
  });
});

/**
 * PostHog derives `$host`/`$pathname` from `$current_url`; a relative path
 * yields an empty host and Web Analytics drops the pageview. These pin the
 * `$current_url` sent for a route to an absolute URL, query/fragment stripped.
 */
describe('pageviewUrl', () => {
  it('prefixes the origin so PostHog can derive a non-empty $host', () => {
    expect(pageviewUrl('/codex/ships', 'https://sc-companion.vercel.app')).toBe(
      'https://sc-companion.vercel.app/codex/ships',
    );
  });

  it('drops the query string and fragment', () => {
    expect(pageviewUrl('/news?channel=rsi#top', 'https://sc-companion.vercel.app')).toBe(
      'https://sc-companion.vercel.app/news',
    );
  });

  it('handles the root path', () => {
    expect(pageviewUrl('/', 'https://sc-companion.vercel.app')).toBe('https://sc-companion.vercel.app/');
  });

  it('produces a URL whose parsed host is non-empty (the actual regression)', () => {
    expect(new URL(pageviewUrl('/starscape', 'https://sc-companion.vercel.app')).host).toBe(
      'sc-companion.vercel.app',
    );
  });
});
