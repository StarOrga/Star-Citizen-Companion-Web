import { signal } from '@angular/core';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { HqLiveEventRow, HqLiveStateRow } from '../data/hq-db.types';
import { HQ_LIVE_APPLY_TARGETS, HqLiveService, LIVE_PAGE_SIZE, LIVE_POLL_MS } from './hq-live.service';
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
  };

  function make(): HqLiveService {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: HqLiveStore, useValue: store },
        { provide: HQ_LIVE_APPLY_TARGETS, useValue: targets },
      ],
    });
    return TestBed.inject(HqLiveService);
  }

  beforeEach(() => {
    store = new FakeStore();
    Object.values(targets).forEach((s) => s.calls.reset());
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
