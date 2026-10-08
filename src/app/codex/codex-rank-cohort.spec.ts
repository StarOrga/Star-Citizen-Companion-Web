// The Holotable "Einordnung" stayed empty on load (holodeck walkthrough
// 2026-10-08): the fleet-wide payload read can lose a chunk to a statement
// timeout, getEntityPayloads swallowed that, and the half-fleet cohort was
// CACHED for the whole build. Now: one retry, never a cached partial cohort,
// and a still-incomplete read is an error the page offers a retry for.
import { TestBed } from '@angular/core/testing';
import { CodexService, FetchReport } from './codex.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { cohortCacheKey, readCohortCache } from './codex-rank';

const BUILD = { id: 'build-cohort-spec', channel: 'LIVE', patchVersion: '4.3' };

function service(): CodexService {
  TestBed.configureTestingModule({
    providers: [CodexService, { provide: SupabaseClientProvider, useValue: { client: {} } }],
  });
  const svc = TestBed.inject(CodexService);
  spyOn(svc, 'loadCurrentBuild').and.resolveTo(BUILD as never);
  spyOn(svc as unknown as { allShipRows: () => Promise<unknown[]> }, 'allShipRows').and.resolveTo([
    { classNameSlug: 'AEGS_Gladius', nameLocalized: 'Gladius', role: null, payload: { defaultLoadout: [{ itemPortName: 'gun', entityClassName: 'GUN' }] } },
  ]);
  spyOn(svc, 'getAmmoPayloads').and.resolveTo(new Map());
  return svc;
}

describe('CodexService.getRankCohort — incomplete reads', () => {
  const key = cohortCacheKey(BUILD.id, 'all');
  beforeEach(() => localStorage.removeItem(key));
  afterEach(() => {
    localStorage.removeItem(key);
    TestBed.resetTestingModule();
  });

  it('retries a failed payload chunk once and caches the complete cohort', async () => {
    const svc = service();
    let call = 0;
    const payloads = spyOn(svc, 'getEntityPayloads').and.callFake(async (_names: string[], report?: FetchReport) => {
      call++;
      if (call === 1 && report) report.failed++;
      return new Map([['GUN', { kind: 'weapon' as const, payload: {} }]]);
    });
    const cohort = await svc.getRankCohort();
    expect(payloads).toHaveBeenCalledTimes(2);
    expect(cohort.length).toBe(1);
    expect(readCohortCache(key)?.length).toBe(1);
  });

  it('still incomplete after the retry: throws and caches NOTHING', async () => {
    const svc = service();
    spyOn(svc, 'getEntityPayloads').and.callFake(async (_names: string[], report?: FetchReport) => {
      if (report) report.failed++;
      return new Map();
    });
    await expectAsync(svc.getRankCohort()).toBeRejected();
    expect(readCohortCache(key)).toBeNull();
  });
});
