import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { fakeSupabase } from '../../testing/fake-supabase';
import { HqSuppliesService, suppliesCacheKey } from '../hq-supplies.service';
import { Nachschub } from './nachschub.model';
import { NachschubService } from './nachschub.service';

interface RowsSignal {
  update: (f: (r: { dirty: boolean; deletedAt: string | null }[]) => unknown[]) => void;
}

describe('NachschubService undo (AUD-3)', () => {
  const pkg: Nachschub = { id: 'p1', name: 'Test', status: 'active', slot: 1, snapshot: {}, createdAt: '2026-11-01T10:00:00.000Z', archivedAt: null };
  let ns: NachschubService;
  let supplies: HqSuppliesService;

  /** What the sync does after a push: rows are clean and the clean tombstones leave the local rows. */
  const pushedAndDropped = (): void => {
    const rows = (supplies as unknown as { rows: RowsSignal }).rows;
    rows.update((r) => r.map((x) => ({ ...x, dirty: false })).filter((x) => x.deletedAt === null));
  };
  const markClean = (): void => {
    const rows = (supplies as unknown as { rows: RowsSignal }).rows;
    rows.update((r) => r.map((x) => ({ ...x, dirty: false })));
  };

  beforeEach(() => {
    localStorage.removeItem(suppliesCacheKey('u1'));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideTranslateService(), fakeSupabase().provider,{ provide: AuthService, useValue: { user: signal({ id: 'u1' }) } }],
    });
    ns = TestBed.inject(NachschubService);
    supplies = TestBed.inject(HqSuppliesService);
    TestBed.flushEffects();
    ns.packages.set([pkg]);
    supplies.add('Rifle', 3, { className: 'RIFLE', packageId: 'p1' });
    supplies.add('Helmet', 1, { className: 'HELM', packageId: 'p1' });
    markClean();
  });
  afterEach(() => localStorage.removeItem(suppliesCacheKey('u1')));

  it('undo of "Leeren" brings the lines back, dirty, after the tombstones were dropped', async () => {
    const res = await ns.empty('p1', false);
    expect(ns.linesOf('p1')).toEqual([]);
    pushedAndDropped();
    await res.undo!();
    expect(ns.linesOf('p1').map((l) => [l.name, l.qty, l.dirty])).toEqual([['Rifle', 3, true], ['Helmet', 1, true]]);
  });

  it('undo of "Löschen" brings the lines and the Nachschub back', async () => {
    const res = await ns.remove('p1', false);
    expect(ns.linesOf('p1')).toEqual([]);
    expect(ns.packages()).toEqual([]);
    pushedAndDropped();
    // The fake backend keeps no package row, so the revive write is answered here (the row exists in production).
    const internals = ns as unknown as { reload: () => Promise<void>; patch: () => Promise<string> };
    vi.spyOn(internals, 'reload').mockResolvedValue(undefined);
    vi.spyOn(internals, 'patch').mockResolvedValue('ok');
    expect((await res.undo!()).ok).toBe(true);
    expect(ns.linesOf('p1').map((l) => [l.name, l.dirty])).toEqual([['Rifle', true], ['Helmet', true]]);
    expect(ns.packages().map((p) => p.id)).toEqual(['p1']);
  });
});
