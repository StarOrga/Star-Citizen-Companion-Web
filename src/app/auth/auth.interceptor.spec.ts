import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { fakeSupabase, FakeSession } from '../testing/fake-supabase';
import { authInterceptor } from './auth.interceptor';

/**
 * AUD-054/073: the interceptor decides which requests carry the user's token.
 * Only the project's own edge functions may see it — a lookalike host or any
 * other URL must go out without a header.
 */
describe('authInterceptor', () => {
  const base = environment.supabase.url;
  const session: FakeSession = { access_token: 'user-jwt', user: { id: 'u1', email: 'pilot@example.com' } };

  function setup(s: FakeSession | null) {
    TestBed.configureTestingModule({
      providers: [
        fakeSupabase({ session: s }).provider,
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    return { http: TestBed.inject(HttpClient), ctrl: TestBed.inject(HttpTestingController) };
  }

  /** Fire a GET and return the request the backend saw (the session read is async). */
  async function send(url: string, s: FakeSession | null) {
    const { http, ctrl } = setup(s);
    const done = firstValueFrom(http.get(url));
    await new Promise((r) => setTimeout(r));
    const req = ctrl.expectOne(url);
    req.flush({});
    await done;
    ctrl.verify();
    return req.request;
  }

  it('sends the session token to an edge function', async () => {
    const req = await send(`${base}/functions/v1/x`, session);
    expect(req.headers.get('Authorization')).toBe('Bearer user-jwt');
    expect(req.headers.has('apikey')).toBeFalse();
  });

  it('sends only the publishable key when signed out', async () => {
    const req = await send(`${base}/functions/v1/x`, null);
    expect(req.headers.get('apikey')).toBe(environment.supabase.publishableKey);
    expect(req.headers.has('Authorization')).toBeFalse();
  });

  for (const url of [`${base}/rest/v1/x`, 'https://example.test/functions/x', `${base}.evil.test/functions/x`]) {
    it(`adds no header to ${url}`, async () => {
      const req = await send(url, session);
      expect(req.headers.has('Authorization')).toBeFalse();
      expect(req.headers.has('apikey')).toBeFalse();
    });
  }
});
