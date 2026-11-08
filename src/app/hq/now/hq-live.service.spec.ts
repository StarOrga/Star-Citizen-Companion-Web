import { WritableSignal, signal } from '@angular/core';
import { HqCommunityService } from '../data/hq-community.service';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { HqLiveEventRow, HqLiveStateRow } from '../data/hq-db.types';
import { HQ_LIVE_APPLY_TARGETS, HqLiveService, LIVE_PAGE_SIZE, LIVE_POLL_MS, findBlueprintByName } from './hq-live.service';
import { HqLiveStore, LiveSubscription } from './hq-live.store';

function ev(id: string, type: string, data: Record<string, unknown> = {}, over: Partial<HqLiveEventRow> = {}): HqLiveEventRow {
  return {
    user_id: 'u1', id, type, data, at: new Date().toISOString(), applied: null, undone: false,
    synced_at: '', updated_at: '', ...over,
  };
}

class FakeStore {
  rows: HqLiveEventRow[] = [];
  state: HqLiveStateRow | null = null;
  fetches = 0;
  patches: { id: string; patch: Record<string, unknown> }[] = [];
  sub: LiveSubscription | null = null;
  fetchState = async (): Promise<HqLiveStateRow | null> => this.state;
  fetchEvents = async (_u: string, limit: number, before?: string): Promise<HqLiveEventRow[]> => {
    this.fetches++;
    return this.rows.filter((r) => !before || r.at < before).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  };
  claim = async (_u: string, id: string): Promise<boolean> => {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.applied) return false;
    r.applied = { kind: 'pending' };
    return true;
  };
  reclaims: string[] = [];
  failUndoClaim = false;
  reclaimPending = async (_u: string, id: string): Promise<boolean> => {
    const r = this.rows.find((x) => x.id === id);
    if (!r || (r.applied as { kind?: string } | null)?.kind !== 'pending') return false;
    this.reclaims.push(id);
    r.applied = { kind: 'pending', at: new Date().toISOString() };
    return true;
  };
  claimUndo = async (_u: string, id: string): Promise<boolean> => {
    if (this.failUndoClaim) throw new Error('offline');
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.undone) return false;
    r.undone = true;
    this.patches.push({ id, patch: { undone: true } });
    return true;
  };
  patch = async (_u: string, id: string, patch: Record<string, unknown>): Promise<void> => {
    this.patches.push({ id, patch });
  };
  subscribe = (_u: string, cb: LiveSubscription): (() => void) => {
    this.sub = cb;
    return () => undefined;
  };
}

describe('HqLiveService', () => {
  let store: FakeStore;
  const targets = {
    tickByClassName: jasmine.createSpy('tick').and.returnValue('sup1'),
    untick: jasmine.createSpy('untick'),
    markStepDone: jasmine.createSpy('mark').and.returnValue({ einsatzId: 'e1', ord: 2 }),
    unmarkStep: jasmine.createSpy('unmark'),
    restoreSnapshot: jasmine.createSpy('restore').and.resolveTo(true),
    collectBlueprint: jasmine.createSpy('collect').and.resolveTo({ className: 'bp_p4ar', name: 'P4-AR Rifle' }),
    uncollectBlueprint: jasmine.createSpy('uncollect').and.resolveTo(true),
    pull: jasmine.createSpy('pull').and.resolveTo(),
    ready: undefined as unknown as WritableSignal<boolean>,
  };
  const reports: unknown[] = [];
  const community = { report: async (r: unknown) => (reports.push(r), { ok: true }) };

  function make(): HqLiveService {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: HqLiveStore, useValue: store },
        { provide: HQ_LIVE_APPLY_TARGETS, useValue: targets },
        { provide: HqCommunityService, useValue: community },
      ],
    });
    return TestBed.inject(HqLiveService);
  }

  beforeEach(() => {
    store = new FakeStore();
    targets.ready = signal(true);
    reports.length = 0;
    (['tickByClassName', 'untick', 'markStepDone', 'unmarkStep', 'restoreSnapshot', 'collectBlueprint', 'uncollectBlueprint', 'pull'] as const).forEach((k) => targets[k].calls.reset());
  });

  it('ticks a supply for a buy purchase and records exactly what it did', fakeAsync(() => {
    store.rows = [ev('a', 'shop.purchase', { item: 'ITEM_X', kind: 'buy', result: 'success', quantity: 2 })];
    const s = make();
    TestBed.tick();
    flushMicrotasks();
    flushMicrotasks();
    expect(targets.tickByClassName).toHaveBeenCalledWith('ITEM_X', 2);
    expect(store.patches[0].patch['applied']).toEqual({ kind: 'supply', id: 'sup1', qty: 2 });
    expect(s.toast()?.id).toBe('a');
    s.dismissToast();
  }));

  it('maps refinery and contract events to step marks', fakeAsync(() => {
    store.rows = [ev('r', 'refinery.complete', { location: 'Pyro' }), ev('c', 'contract.completed', { missionId: 'm9' })];
    make();
    TestBed.tick();
    flushMicrotasks();
    flushMicrotasks();
    expect(targets.markStepDone).toHaveBeenCalledWith({ kind: 'refine', location: 'Pyro' });
    expect(targets.markStepDone).toHaveBeenCalledWith({ kind: 'mission', missionRef: 'm9' });
  }));

  it('does not apply history, applied or failed events', fakeAsync(() => {
    store.rows = [
      ev('old', 'shop.purchase', { item: 'I', kind: 'buy' }, { at: new Date(Date.now() - 3 * 3600_000).toISOString() }),
      ev('done', 'shop.purchase', { item: 'I', kind: 'buy' }, { applied: { kind: 'none' } }),
      ev('fail', 'shop.purchase', { item: 'I', kind: 'buy', result: 'failed' }),
    ];
    make();
    TestBed.tick();
    flushMicrotasks();
    flushMicrotasks();
    expect(targets.tickByClassName).not.toHaveBeenCalled();
  }));

  it('undo reverts exactly the applied write and sets undone', fakeAsync(() => {
    store.rows = [ev('a', 'shop.purchase', { item: 'ITEM_X', kind: 'buy', quantity: 3 })];
    const s = make();
    TestBed.tick();
    flushMicrotasks();
    flushMicrotasks();
    void s.undo('a');
    flushMicrotasks();
    expect(targets.untick).toHaveBeenCalledWith('sup1', 3);
    expect(s.events()[0].undone).toBeTrue();
    expect(store.patches.at(-1)).toEqual({ id: 'a', patch: { undone: true } });
    store.rows = [ev('s', 'refinery.complete')];
    void s.refresh();
    flushMicrotasks();
    flushMicrotasks();
    void s.undo('s');
    flushMicrotasks();
    expect(targets.unmarkStep).toHaveBeenCalledWith('e1', 2);
  }));

  function settle(): void {
    TestBed.tick();
    for (let i = 0; i < 6; i++) flushMicrotasks();
  }

  it('blueprint.received puts the blueprint into the Sammlung, closes its mission step, and undo takes both back', fakeAsync(() => {
    store.rows = [ev('b', 'blueprint.received', { name: 'P4-AR Rifle' })];
    const s = make();
    settle();
    expect(targets.collectBlueprint).toHaveBeenCalledWith('P4-AR Rifle');
    expect(targets.markStepDone).toHaveBeenCalledWith({ kind: 'mission', missionRef: 'bp_p4ar' });
    expect(store.patches.find((p) => p.id === 'b' && (p.patch['applied'] as { kind?: string })?.kind === 'blueprint')?.patch['applied']).toEqual({
      kind: 'blueprint', className: 'bp_p4ar', name: 'P4-AR Rifle', einsatzId: 'e1', ord: 2,
    });
    expect(s.undoable(s.events()[0])).toBeTrue();
    void s.undo('b');
    for (let i = 0; i < 4; i++) flushMicrotasks();
    expect(targets.uncollectBlueprint).toHaveBeenCalledWith('bp_p4ar', 'P4-AR Rifle');
    expect(targets.unmarkStep).toHaveBeenCalledWith('e1', 2);
  }));

  it('a blueprint the Sammlung has already (or no blueprint at all) changes nothing', fakeAsync(() => {
    targets.collectBlueprint.and.resolveTo(null);
    store.rows = [ev('b', 'blueprint.received', { name: 'Unbekannt' })];
    make();
    settle();
    expect(targets.markStepDone).not.toHaveBeenCalled();
    expect(store.patches.find((p) => p.id === 'b' && 'applied' in p.patch && (p.patch['applied'] as { kind?: string }).kind !== 'pending')?.patch['applied']).toEqual({ kind: 'none' });
    targets.collectBlueprint.and.resolveTo({ className: 'bp_p4ar', name: 'P4-AR Rifle' });
  }));

  it('finds a blueprint by its display name, then by the base name without "(…)" when that is unique', async () => {
    const hit = (cls: string, en: string) => ({ kind: 'blueprint', classNameSlug: cls, nameLocalized: null, name: { en, de: en } });
    const codex = (hits: unknown[]) => ({ searchAll: async () => ({ hits, totals: {} }) }) as never;
    expect(await findBlueprintByName(codex([hit('bp_a', 'P4-AR Rifle'), hit('bp_b', 'P4-AR Rifle (Black)')]), 'P4-AR Rifle: ')).toEqual({ className: 'bp_a', name: 'P4-AR Rifle' });
    expect(await findBlueprintByName(codex([hit('bp_b', 'Arrowhead (Black)')]), 'Arrowhead')).toEqual({ className: 'bp_b', name: 'Arrowhead (Black)' });
    expect(await findBlueprintByName(codex([hit('bp_b', 'Arrowhead (Black)'), hit('bp_c', 'Arrowhead (Red)')]), 'Arrowhead')).toBeNull();
    expect(await findBlueprintByName(codex([{ kind: 'item', classNameSlug: 'x', nameLocalized: 'Arrowhead', name: null }]), 'Arrowhead')).toBeNull();
  });

  it('waits for the first supplies / Einsatz pull before auto-applying, then applies', fakeAsync(() => {
    targets.ready = signal(false);
    store.rows = [ev('a', 'shop.purchase', { item: 'ITEM_X', kind: 'buy' })];
    make();
    settle();
    expect(targets.tickByClassName).not.toHaveBeenCalled();
    (targets.ready as WritableSignal<boolean>).set(true);
    settle();
    expect(targets.tickByClassName).toHaveBeenCalledTimes(1);
    expect(targets.pull).toHaveBeenCalled();
    TestBed.resetTestingModule();
  }));

  it('reclaims a claim a crashed tab left pending for more than 2 minutes, not a fresh one', fakeAsync(() => {
    const old = new Date(Date.now() - 3 * 60_000).toISOString();
    store.rows = [
      ev('stale', 'shop.purchase', { item: 'ITEM_X', kind: 'buy' }, { applied: { kind: 'pending', at: old } }),
      ev('fresh', 'shop.purchase', { item: 'ITEM_Y', kind: 'buy' }, { applied: { kind: 'pending', at: new Date().toISOString() } }),
    ];
    make();
    settle();
    expect(store.reclaims).toEqual(['stale']);
    expect(targets.tickByClassName).toHaveBeenCalledTimes(1);
    expect(targets.tickByClassName).toHaveBeenCalledWith('ITEM_X', 1);
    TestBed.resetTestingModule();
  }));

  it('undo is a conditional claim: when another tab already undid it nothing is reverted here', fakeAsync(() => {
    store.rows = [ev('a', 'shop.purchase', { item: 'ITEM_X', kind: 'buy' })];
    const s = make();
    settle();
    store.rows[0].undone = true; // the other tab won
    void s.undo('a');
    settle();
    expect(targets.untick).not.toHaveBeenCalled();
    expect(s.events()[0].undone).toBeTrue();
    TestBed.resetTestingModule();
  }));

  it('does not revert local state when the undo write fails', fakeAsync(() => {
    store.rows = [ev('a', 'shop.purchase', { item: 'ITEM_X', kind: 'buy' })];
    const s = make();
    settle();
    store.failUndoClaim = true;
    void s.undo('a');
    settle();
    expect(targets.untick).not.toHaveBeenCalled();
    expect(s.events()[0].undone).toBeFalse();
    expect(s.error()).toMatch(/^errors\./);
    TestBed.resetTestingModule();
  }));

  it('treats a desktop inventory.snapshot ({replaced, previous}, no kind) as undoable and restores previous', fakeAsync(() => {
    const previous = { location: 'Lorville', items: [{ name: 'Rifle', qty: 1, unit: 'pcs' }] };
    store.rows = [ev('snap', 'inventory.snapshot', {}, { applied: { replaced: true, previous } })];
    const s = make();
    settle();
    expect(s.undoable(s.events()[0])).toBeTrue();
    void s.undo('snap');
    settle();
    expect(targets.restoreSnapshot).toHaveBeenCalledWith(previous);
    expect(s.events()[0].undone).toBeTrue();
    TestBed.resetTestingModule();
  }));

  it('hands the undo claim back when the snapshot restore fails', fakeAsync(() => {
    targets.restoreSnapshot.and.resolveTo(false);
    store.rows = [ev('snap', 'inventory.snapshot', {}, { applied: { replaced: true, previous: { location: 'X' } } })];
    const s = make();
    settle();
    void s.undo('snap');
    settle();
    expect(store.patches.at(-1)).toEqual({ id: 'snap', patch: { undone: false } });
    expect(s.events()[0].undone).toBeFalse();
    targets.restoreSnapshot.and.resolveTo(true);
    TestBed.resetTestingModule();
  }));

  it('reports an applied buy as a community price (unitPrice, else price / quantity) and ignores sells', fakeAsync(() => {
    store.rows = [
      ev('a', 'shop.purchase', { item: 'ITEM_X', kind: 'buy', shop: 'Lorville', price: 300, quantity: 3 }),
      ev('b', 'shop.purchase', { item: 'ITEM_Y', kind: 'buy', shop: 'Area18', price: 300, quantity: 3, unitPrice: 90 }),
      ev('c', 'shop.purchase', { item: 'ITEM_Z', kind: 'sell', shop: 'Area18', price: 10 }),
    ];
    make();
    settle();
    expect(reports).toContain(jasmine.arrayWithExactContents([{ kind: 'price', class_name: 'ITEM_X', location: 'Lorville', value: 100 }]));
    expect(reports).toContain(jasmine.arrayWithExactContents([{ kind: 'price', class_name: 'ITEM_Y', location: 'Area18', value: 90 }]));
    expect(reports.length).toBe(2);
    TestBed.resetTestingModule();
  }));

  it('polls every 30 s while Realtime is not subscribed, and stops when it is', fakeAsync(() => {
    make();
    TestBed.tick();
    flushMicrotasks();
    flushMicrotasks();
    const base = store.fetches;
    tick(LIVE_POLL_MS);
    expect(store.fetches).toBe(base + 1);
    store.sub?.onStatus('SUBSCRIBED');
    tick(LIVE_POLL_MS);
    expect(store.fetches).toBe(base + 1);
    store.sub?.onStatus('CLOSED');
    tick(LIVE_POLL_MS);
    expect(store.fetches).toBe(base + 2);
    TestBed.resetTestingModule();
  }));

  it('pages older events by LIVE_PAGE_SIZE', fakeAsync(() => {
    const t0 = Date.now() - 10 * 86_400_000;
    store.rows = Array.from({ length: 100 + LIVE_PAGE_SIZE + 5 }, (_, i) =>
      ev('e' + i, 'qt.arrived', {}, { at: new Date(t0 - i * 1000).toISOString(), applied: { kind: 'none' } }),
    );
    const s = make();
    TestBed.tick();
    flushMicrotasks();
    flushMicrotasks();
    expect(s.events().length).toBe(100);
    void s.loadMore();
    flushMicrotasks();
    expect(s.events().length).toBe(100 + LIVE_PAGE_SIZE);
    expect(s.hasMore()).toBeTrue();
    void s.loadMore();
    flushMicrotasks();
    expect(s.events().length).toBe(135);
    expect(s.hasMore()).toBeFalse();
    TestBed.resetTestingModule();
  }));
});
