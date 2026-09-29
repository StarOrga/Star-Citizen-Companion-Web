import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { AnalyticsService } from '../core/analytics.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ShipLinkService } from './ship-link.service';

const URL_A = 'https://robertsspaceindustries.com/en/pledge/ships/aegis-avenger/Avenger-Titan';
const URL_B = 'https://robertsspaceindustries.com/en/pledge/ships/drake-cutlass/Cutlass-Black';

/** Awaitable, chainable PostgREST stand-in: every method returns itself, `then` yields the result. */
function chain(result: () => unknown): unknown {
  const p: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(res, rej);
        }
        return () => p;
      },
    },
  );
  return p;
}

describe('ShipLinkService', () => {
  let invoke: jasmine.Spy;
  let tables: Record<string, { data: unknown; error: unknown }>;
  let capture: jasmine.Spy;
  let user: ReturnType<typeof signal<{ id: string } | null>>;

  function setup(): ShipLinkService {
    invoke = jasmine.createSpy('invoke').and.resolveTo({ data: { ok: true }, error: null });
    tables = {};
    capture = jasmine.createSpy('capture');
    user = signal<{ id: string } | null>({ id: 'u1' });
    const client = {
      from: (t: string) => chain(() => tables[t] ?? { data: null, error: null }),
      functions: { invoke },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseClientProvider, useValue: { client, realClient: client } },
        { provide: AuthService, useValue: { user } },
        { provide: AnalyticsService, useValue: { capture } },
      ],
    });
    return TestBed.inject(ShipLinkService);
  }

  function httpError(body: unknown): { data: null; error: { context: Response } } {
    return {
      data: null,
      error: { context: new Response(JSON.stringify(body), { status: 400 }) },
    };
  }

  it('maps edge error codes from the Response body to i18n suffixes', async () => {
    const svc = setup();
    const cases: [string, string][] = [
      ['invalid_url', 'invalidUrl'],
      ['invalid_slug', 'invalidUrl'],
      ['rate_limited', 'rateLimited'],
      ['quota_exceeded', 'rateLimited'],
      ['unauthorized', 'forbidden'],
      ['forbidden', 'forbidden'],
      ['boom', 'saveFailed'],
    ];
    for (const [code, key] of cases) {
      invoke.and.resolveTo(httpError({ error: code }));
      expect(await svc.setMyLink('avenger', URL_A)).withContext(code).toBe(key);
      expect(svc.error()).toBe(code);
      expect(svc.saving()).toBeFalse();
    }
    expect(svc.myLinks().size).toBe(0);
  });

  it('also reads the error code from a 2xx data envelope', async () => {
    const svc = setup();
    invoke.and.resolveTo({ data: { error: 'rate_limited' }, error: null });
    expect(await svc.removeMyLink('avenger')).toBe('rateLimited');
  });

  it('falls back to saveFailed on a network error without a Response', async () => {
    const svc = setup();
    invoke.and.resolveTo({ data: null, error: new TypeError('Failed to fetch') });
    expect(await svc.setMyLink('avenger', URL_A)).toBe('saveFailed');
    expect(svc.error()).toBe('unknown');
  });

  it('rejects an invalid pasted URL client-side without calling the edge function', async () => {
    const svc = setup();
    expect(await svc.setMyLink('avenger', 'https://evil.example/x')).toBe('invalidUrl');
    expect(await svc.promote('avenger', 'nope')).toBe('invalidUrl');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('stores and removes the own link on success and reports analytics', async () => {
    const svc = setup();
    expect(await svc.setMyLink('avenger', URL_A)).toBeNull();
    expect(invoke).toHaveBeenCalledWith('ship-link', {
      body: { action: 'set', shipSlug: 'avenger', url: URL_A },
    });
    expect(svc.effectiveLink('avenger')).toBe(URL_A);
    expect(capture).toHaveBeenCalledWith('ship_link_set', { shipSlug: 'avenger' });

    expect(await svc.removeMyLink('avenger')).toBeNull();
    expect(svc.effectiveLink('avenger')).toBeNull();
  });

  it('promotes and unpromotes the global link; own link wins in effectiveLink', async () => {
    const svc = setup();
    expect(await svc.promote('cutlass', URL_B)).toBeNull();
    expect(svc.globalLinks().get('cutlass')).toBe(URL_B);
    expect(svc.effectiveLink('cutlass')).toBe(URL_B);

    await svc.setMyLink('cutlass', URL_A);
    expect(svc.effectiveLink('cutlass')).toBe(URL_A);

    expect(await svc.unpromote('cutlass')).toBeNull();
    expect(svc.globalLinks().has('cutlass')).toBeFalse();
  });

  it('loadForShip fills own and global links, dropping rows outside the allowlist', async () => {
    const svc = setup();
    tables['ship_pledge_links'] = { data: { ship_slug: 'a', url: URL_B }, error: null };
    tables['user_ship_links'] = { data: { ship_slug: 'a', url: URL_A }, error: null };
    await svc.loadForShip(' a ');
    expect(svc.globalLinks().get('a')).toBe(URL_B);
    expect(svc.myLinks().get('a')).toBe(URL_A);

    tables['user_ship_links'] = { data: { ship_slug: 'a', url: 'javascript:alert(1)' }, error: null };
    await svc.loadForShip('a');
    expect(svc.myLinks().has('a')).toBeFalse();
    expect(svc.effectiveLink('a')).toBe(URL_B);
  });

  it('loadForShip skips the own-link read when signed out and ignores blank slugs', async () => {
    const svc = setup();
    tables['ship_pledge_links'] = { data: { url: URL_B }, error: null };
    user.set(null);
    await svc.loadForShip('a');
    expect(svc.globalLinks().get('a')).toBe(URL_B);
    expect(svc.myLinks().size).toBe(0);

    await svc.loadForShip('   ');
    expect(svc.globalLinks().size).toBe(1);
  });

  it('loadForShip never throws on a read error', async () => {
    const svc = setup();
    tables['ship_pledge_links'] = { data: null, error: { message: 'x' } };
    await expectAsync(svc.loadForShip('a')).toBeResolved();
    expect(svc.effectiveLink('a')).toBeNull();
  });
});
