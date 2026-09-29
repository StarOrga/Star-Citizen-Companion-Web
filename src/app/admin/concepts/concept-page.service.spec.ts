import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { fakeSupabase } from '../../testing/fake-supabase';
import { ConceptPageService, ConceptTicketFailure } from './concept-page.service';

describe('ConceptPageService', () => {
  const ticketUrl = `${environment.supabase.url}/functions/v1/concept-page/ticket`;
  const goodUrl = `${environment.supabase.url}/functions/v1/concept-page/abc?t=sig`;
  let fetchSpy: jasmine.Spy;

  function setup(token: string | null = 'jwt-1'): ConceptPageService {
    const fake = fakeSupabase({ session: token ? { access_token: token, user: { id: 'u1' } } : null });
    TestBed.configureTestingModule({ providers: [fake.provider] });
    return TestBed.inject(ConceptPageService);
  }

  function reply(status: number, body?: unknown): void {
    fetchSpy.and.resolveTo({
      ok: status >= 200 && status < 300,
      status,
      json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
    } as unknown as Response);
  }

  async function kindOf(p: Promise<unknown>): Promise<string | undefined> {
    const err = await p.then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ConceptTicketFailure);
    return (err as ConceptTicketFailure | null)?.kind;
  }

  beforeEach(() => {
    fetchSpy = spyOn(window, 'fetch');
  });

  it('is forbidden without a session token and never calls fetch', async () => {
    expect(await kindOf(setup(null).mintTicket('abc'))).toBe('forbidden');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the concept id with the bearer and returns the ticket', async () => {
    reply(200, { url: goodUrl, title: 'T', expiresAt: '2030-01-01T00:00:00Z' });
    const ticket = await setup().mintTicket('abc');
    expect(ticket).toEqual({ url: goodUrl, title: 'T', expiresAt: '2030-01-01T00:00:00Z' });
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe(ticketUrl);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ id: 'abc' });
    expect(init.headers).toEqual(jasmine.objectContaining({ Authorization: 'Bearer jwt-1' }));
  });

  it('defaults a missing title and expiry to empty strings', async () => {
    reply(200, { url: goodUrl });
    expect(await setup().mintTicket('abc')).toEqual({ url: goodUrl, title: '', expiresAt: '' });
  });

  for (const [status, kind] of [
    [401, 'forbidden'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [400, 'notFound'],
    [500, 'error'],
    [502, 'error'],
  ] as const) {
    it(`maps HTTP ${status} to ${kind}`, async () => {
      reply(status, {});
      expect(await kindOf(setup().mintTicket('abc'))).toBe(kind);
    });
  }

  it('maps a network failure to error', async () => {
    fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
    expect(await kindOf(setup().mintTicket('abc'))).toBe('error');
  });

  it('rejects a body without a url', async () => {
    reply(200, { title: 'T' });
    expect(await kindOf(setup().mintTicket('abc'))).toBe('error');
  });

  it('rejects an unreadable body', async () => {
    reply(200, undefined);
    expect(await kindOf(setup().mintTicket('abc'))).toBe('error');
  });

  it('rejects a url that is not served by our own concept-page function', async () => {
    reply(200, { url: 'https://evil.example.com/concept-page/abc' });
    expect(await kindOf(setup().mintTicket('abc'))).toBe('error');
  });
});
