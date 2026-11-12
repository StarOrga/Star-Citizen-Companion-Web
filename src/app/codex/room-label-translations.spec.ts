import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../core/supabase.client';
import { LOCALE_SHARD_FETCH } from './codex-locale-shards';
import { RoomLabelTranslations, toLabelMap } from './room-label-translations';

describe('RoomLabelTranslations', () => {
  function setup(token: string | null, respond: () => Response) {
    const calls: string[] = [];
    const fetchFn = (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(respond());
    };
    const client = {
      supabaseUrl: 'https://x.supabase.co',
      auth: { getSession: () => Promise.resolve({ data: { session: token ? { access_token: token } : null } }) },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseClientProvider, useValue: { client } },
        { provide: LOCALE_SHARD_FETCH, useValue: fetchFn },
      ],
    });
    return { svc: TestBed.inject(RoomLabelTranslations), calls };
  }
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it('loads the rooms slice once for German and exposes it', async () => {
    const body = { entries: { scc_room_mess_hall: { h: 'x', t: 'Messe' }, ui_other: { h: 'y', t: 'Nope' } } };
    const { svc, calls } = setup('jwt', () => new Response(JSON.stringify(body), { status: 200 }));
    expect(svc.labels('de').size).toBe(0);
    svc.labels('de');
    await settle();
    expect(calls).toEqual(['https://x.supabase.co/functions/v1/translation-overlay?lang=de&ns=rooms']);
    expect([...svc.labels('de')]).toEqual([['scc_room_mess_hall', 'Messe']]);
  });

  it('asks nothing for English or signed out', async () => {
    const { svc, calls } = setup(null, () => new Response('{}', { status: 200 }));
    svc.labels('en');
    svc.labels('de');
    await settle();
    expect(calls).toEqual([]);
    expect(svc.labels('de').size).toBe(0);
  });

  it('a 404 (nothing published) is an empty map', async () => {
    const { svc } = setup('jwt', () => new Response('{"error":"not_published"}', { status: 404 }));
    svc.labels('de');
    await settle();
    expect(svc.labels('de').size).toBe(0);
  });

  it('toLabelMap ignores malformed bodies', () => {
    expect(toLabelMap(null).size).toBe(0);
    expect(toLabelMap({ entries: { scc_room_a: { t: '  ' } } }).size).toBe(0);
  });
});
