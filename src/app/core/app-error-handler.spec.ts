import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from './analytics.service';
import { AppErrorHandler, redactErrorText } from './app-error-handler';
import { ConsentService } from './consent.service';

describe('AppErrorHandler', () => {
  let handler: AppErrorHandler;
  let consent: ConsentService;
  let fakeClient: jasmine.SpyObj<{ captureException: (e: Error, p?: unknown) => void }>;

  beforeEach(() => {
    localStorage.clear();
    spyOn(console, 'error');
    TestBed.configureTestingModule({
      providers: [AppErrorHandler, AnalyticsService, ConsentService, provideRouter([])],
    });
    handler = TestBed.inject(AppErrorHandler);
    consent = TestBed.inject(ConsentService);
    fakeClient = jasmine.createSpyObj('PostHog', ['captureException']);
    // Pretend posthog-js finished loading without actually loading it.
    (TestBed.inject(AnalyticsService) as unknown as { client: unknown }).client = fakeClient;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('logs every unhandled error with the route', () => {
    consent.essentialOnly();
    const err = new Error('probe');
    handler.handleError(err);
    expect(console.error).toHaveBeenCalledTimes(1);
    const args = (console.error as jasmine.Spy).calls.mostRecent().args;
    expect(args[0]).toBe('[app] unhandled error');
    expect((args[1] as { error: unknown }).error).toBe(err);
    expect(typeof (args[1] as { route: unknown }).route).toBe('string');
  });

  it('sends nothing to PostHog without statistics consent', () => {
    consent.essentialOnly();
    handler.handleError(new Error('probe'));
    expect(fakeClient.captureException).not.toHaveBeenCalled();
  });

  it('with consent sends one redacted $exception per distinct error', () => {
    consent.acceptAll();
    handler.handleError(new Error('probe at https://x.test/a?token=1'));
    handler.handleError(new Error('probe at https://x.test/a?token=1'));
    expect(fakeClient.captureException).toHaveBeenCalledTimes(1);
    const [sent, props] = fakeClient.captureException.calls.mostRecent().args;
    expect(sent.message).toBe('probe at https://x.test/a');
    expect((props as Record<string, unknown>)['handled']).toBe(false);
  });

  it('stops after 10 distinct errors per session', () => {
    consent.acceptAll();
    for (let i = 0; i < 15; i++) handler.handleError(new Error(`e${i}`));
    expect(fakeClient.captureException).toHaveBeenCalledTimes(10);
  });

  it('never throws, even when the analytics service does', () => {
    consent.acceptAll();
    fakeClient.captureException.and.throwError('posthog exploded');
    expect(() => handler.handleError(new Error('probe'))).not.toThrow();
  });
});

describe('redactErrorText', () => {
  it('drops query strings and masks share-link tokens', () => {
    expect(redactErrorText('GET https://x.test/shared/loadout/abc?token=1 failed')).toBe(
      'GET https://x.test/shared/loadout/:token failed',
    );
    expect(redactErrorText('at /hangar/shared/xyz/ship')).toBe('at /hangar/shared/:token/ship');
  });

  it('masks Bearer tokens, JWTs and e-mail addresses', () => {
    const out = redactErrorText('Authorization: Bearer eyJhbGciOi.eyJzdWIi.sig by user@example.com');
    expect(out).not.toContain('eyJ');
    expect(out).not.toContain('user@example.com');
    expect(redactErrorText('token eyJa.eyJb.c here')).toBe('token *** here');
  });

  it('caps the text at 500 characters', () => {
    expect(redactErrorText('x'.repeat(900)).length).toBe(500);
  });
});
