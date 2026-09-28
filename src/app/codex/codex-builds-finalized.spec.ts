import { TestBed } from '@angular/core/testing';
import { CodexService } from './codex.service';
import { SupabaseClientProvider } from '../core/supabase.client';

// AUD-113 (plan D02 step 9): the Holotable patch picker (buildsForChannel)
// and the inline patch diff (recentLiveBuilds) read finalized builds only, so
// a running or abandoned import (finalized_at null) never shows up and never
// shifts "current + previous".
describe('CodexService finalized-only build lists', () => {
  type Step = [string, ...unknown[]];

  /** Records every builder call on codex_builds; the chain resolves to `result`. */
  function makeService(result: { data: unknown; error: unknown }) {
    const steps: Step[] = [];
    const from = (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {};
      for (const m of ['select', 'eq', 'not', 'order', 'limit']) {
        chain[m] = (...args: unknown[]) => {
          if (table === 'codex_builds') steps.push([m, ...args]);
          return chain;
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chain.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return chain;
    };
    TestBed.configureTestingModule({
      providers: [CodexService, { provide: SupabaseClientProvider, useValue: { client: { from } } }],
    });
    return { svc: TestBed.inject(CodexService), steps };
  }

  const row = { id: 'b1', channel: 'LIVE', patch_version: '4.3', build_number: '1', is_current: true };

  afterEach(() => TestBed.resetTestingModule());

  it('buildsForChannel filters on finalized_at', async () => {
    const { svc, steps } = makeService({ data: [row], error: null });
    const builds = await svc.buildsForChannel('PTU');
    expect(builds.length).toBe(1);
    expect(steps).toContain(['eq', 'channel', 'PTU']);
    expect(steps).toContain(['not', 'finalized_at', 'is', null]);
  });

  it('recentLiveBuilds filters on finalized_at', async () => {
    const { svc, steps } = makeService({ data: [row], error: null });
    const builds = await svc.recentLiveBuilds();
    expect(builds.length).toBe(1);
    expect(steps).toContain(['eq', 'channel', 'LIVE']);
    expect(steps).toContain(['not', 'finalized_at', 'is', null]);
  });

  it('both still return [] on a PostgREST error (e.g. column not pushed yet)', async () => {
    const err = { data: null, error: { code: '42703', message: 'column codex_builds.finalized_at does not exist' } };
    const a = makeService(err);
    expect(await a.svc.buildsForChannel()).toEqual([]);
    expect(await a.svc.recentLiveBuilds()).toEqual([]);
  });
});
