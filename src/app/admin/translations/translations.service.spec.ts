import { TestBed } from '@angular/core/testing';
import { chainArgs, fakeSupabase, FakeCall } from '../../testing/fake-supabase';
import { TranslationsService } from './translations.service';

describe('TranslationsService', () => {
  let calls: FakeCall[];

  function setup(answer: (c: FakeCall) => { data?: unknown; error?: unknown; count?: number | null }): TranslationsService {
    const fake = fakeSupabase({ answer });
    calls = fake.calls;
    TestBed.configureTestingModule({ providers: [fake.provider] });
    return TestBed.inject(TranslationsService);
  }

  it('sums the ledger of the current UTC month', async () => {
    const svc = setup(() => ({ data: [{ usd: '1.5' }, { usd: 2 }] }));
    expect(await svc.monthSpend(new Date('2026-10-29T12:00:00Z'))).toBe(3.5);
    expect(calls[0].target).toBe('translation_ledger');
    expect(chainArgs(calls[0], 'eq')).toEqual(['month', '2026-10-01']);
  });

  it('loads the singleton settings as numbers', async () => {
    const svc = setup(() => ({ data: { enabled: true, upload_cap_usd: '20', monthly_cap_usd: '190' } }));
    expect(await svc.getSettings()).toEqual({ enabled: true, upload_cap_usd: 20, monthly_cap_usd: 190 });
    expect(chainArgs(calls[0], 'eq')).toEqual(['id', 1]);
  });

  it('throws a read error instead of returning an empty list', async () => {
    const svc = setup(() => ({ error: { message: 'boom' } }));
    await expectAsync(svc.listLanguages()).toBeRejected();
  });

  it('queries the glossary with search, filters and range', async () => {
    const svc = setup(() => ({ data: [], count: 120 }));
    const res = await svc.listGlossary({ search: 'hull', lang: 'de', origin: 'ai', category: null, page: 1 });
    expect(res.total).toBe(120);
    expect(chainArgs(calls[0], 'or')).toEqual(['source_term.ilike.%hull%,target_term.ilike.%hull%']);
    expect(chainArgs(calls[0], 'range')).toEqual([50, 99]);
  });

  it('flags a target edit as origin admin', async () => {
    const svc = setup(() => ({ data: null }));
    await svc.saveTarget('g1', 'Rumpf');
    const upd = chainArgs(calls[0], 'update')![0] as Record<string, unknown>;
    expect(upd['target_term']).toBe('Rumpf');
    expect(upd['origin']).toBe('admin');
    expect(chainArgs(calls[0], 'eq')).toEqual(['id', 'g1']);
  });

  it('restores the before snapshot on revert', async () => {
    const svc = setup(() => ({ data: null }));
    await svc.revert({ id: 1, glossary_id: 'g1', before: { target_term: 'Alt', locked: true, lang: 'de' }, after: null, at: '' });
    const upd = chainArgs(calls[0], 'update')![0] as Record<string, unknown>;
    expect(upd['target_term']).toBe('Alt');
    expect(upd['locked']).toBeTrue();
    expect('lang' in upd).toBeFalse();
  });

  it('turns an {error} answer of the orchestrator into a coded Error', async () => {
    const svc = setup(() => ({ data: { error: 'translate.no_api_key' } }));
    await expectAsync(svc.approve('j1')).toBeRejectedWith(jasmine.objectContaining({ code: 'translate.no_api_key' }));
    expect(calls[0].op).toBe('invoke');
    expect(calls[0].target).toBe('translate-orchestrator');
  });

  it('reads the full-run estimate', async () => {
    const svc = setup(() => ({ data: { ok: true, estimate: { string_count: 900, estimate_usd: 41.2 } } }));
    expect(await svc.estimateFull('b1', 'de')).toEqual({ string_count: 900, estimate_usd: 41.2 });
    expect((calls[0].args as { body: unknown }).body).toEqual({ op: 'estimate', build_id: 'b1', lang: 'de', mode: 'full' });
  });
});
