import { TestBed } from '@angular/core/testing';
import { fakeSupabase, type FakeCall, type FakeResult } from '../../testing/fake-supabase';
import { COMMUNITY_SHARE_KEY, HqCommunityService } from './hq-community.service';

describe('HqCommunityService', () => {
  let calls: FakeCall[];

  function setup(answer: (c: FakeCall) => FakeResult = () => ({ data: null, error: null })): HqCommunityService {
    const fake = fakeSupabase({ session: { access_token: 't', user: { id: 'u1' } }, answer });
    calls = fake.calls;
    TestBed.configureTestingModule({ providers: [fake.provider] });
    return TestBed.inject(HqCommunityService);
  }

  beforeEach(() => localStorage.removeItem(COMMUNITY_SHARE_KEY));
  afterEach(() => localStorage.removeItem(COMMUNITY_SHARE_KEY));

  it('reads the median through the RPC and coerces numerics', async () => {
    const svc = setup(() => ({ data: [{ location: 'Lorville', median: '125.5', n: '6', newest: '2026-10-31T10:00:00Z' }] }));
    const res = await svc.median('price', 'KLWE_LaserRepeater_S1');
    expect(calls[0].op).toBe('rpc');
    expect(calls[0].target).toBe('hq_community_median');
    expect(calls[0].args).toEqual({ p_kind: 'price', p_class_name: 'KLWE_LaserRepeater_S1' });
    expect(res).toEqual({ ok: true, rows: [{ location: 'Lorville', median: 125.5, n: 6, newest: '2026-10-31T10:00:00Z' }] });
  });

  it('turns an RPC error into an errors.* key', async () => {
    const svc = setup(() => ({ error: { message: 'boom', code: '500' } }));
    const res = await svc.median('stock', 'x');
    expect(res.ok).toBeFalse();
    if (!res.ok) expect(res.errorKey).toMatch(/^errors\./);
  });

  it('is opted out by default and sends nothing', async () => {
    const svc = setup();
    expect(svc.shareEnabled()).toBeFalse();
    const res = await svc.report([{ kind: 'price', class_name: 'a', location: 'b', value: 1 }]);
    expect(res).toEqual({ ok: false, skipped: true });
    expect(calls.length).toBe(0);
  });

  it('inserts valid reports once opted in and remembers the choice', async () => {
    const svc = setup();
    svc.setShare(true);
    expect(localStorage.getItem(COMMUNITY_SHARE_KEY)).toBe('1');
    const res = await svc.report([
      { kind: 'price', class_name: 'a', location: 'Lorville', value: 10 },
      { kind: 'price', class_name: ' ', location: 'Lorville', value: 10 },
      { kind: 'stock', class_name: 'a', location: 'Lorville', value: Number.NaN },
    ]);
    expect(res).toEqual({ ok: true });
    expect(calls.length).toBe(1);
    expect(calls[0].target).toBe('hq_community_reports');
    expect(calls[0].chain[0][0]).toBe('insert');
    expect((calls[0].chain[0][1][0] as unknown[]).length).toBe(1);
    svc.setShare(false);
    expect(localStorage.getItem(COMMUNITY_SHARE_KEY)).toBeNull();
  });

  it('reports an insert failure as an error key', async () => {
    const svc = setup(() => ({ error: { message: 'rate limit', code: 'P0001' } }));
    svc.setShare(true);
    const res = await svc.report([{ kind: 'price', class_name: 'a', location: 'b', value: 1 }]);
    expect('errorKey' in res).toBeTrue();
  });
});
