import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { FakeCall, FakeResult, chainArgs, fakeSupabase } from '../testing/fake-supabase';
import type { HqSupplyRow } from './data/hq-db.types';
import {
  HqSuppliesService,
  SUPPLIES_CACHE_KEY,
  SUPPLIES_MAX_ITEMS,
  SUPPLIES_STORAGE_KEY,
  SUPPLY_QTY_MAX,
  suppliesCacheKey,
} from './hq-supplies.service';
import { ScConfirmService } from '../shared/dialog/sc-confirm.service';

function serverRow(id: string, patch: Partial<HqSupplyRow> = {}): HqSupplyRow {
  return {
    user_id: 'u1', id, name: `Part ${id}`, qty: 1, done: false, entity_kind: null, class_name: null, set_kind: null,
    set_id: null, step_kind: null, wanted: true, source: 'manual', deleted_at: null,
    created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z', synced_at: '2026-11-01T10:00:01.000Z',
    ...patch,
  };
}

describe('HqSuppliesService', () => {
  let user: ReturnType<typeof signal<{ id: string } | null>>;
  let server: HqSupplyRow[];
  let fake: ReturnType<typeof fakeSupabase>;
  let failPush = false;

  /** Ids whose upsert the (fake) server trigger rejects as stale: it keeps its row and returns nothing. */
  let rejectIds: Set<string>;
  let confirmAnswer = true;
  let confirmCalls = 0;
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  const answer = (call: FakeCall): FakeResult => {
    if (call.target !== 'hq_supplies') return { data: null };
    const upsert = chainArgs(call, 'upsert');
    if (upsert) {
      if (failPush) return { error: { message: 'offline', status: 0 } };
      const accepted: { id: string }[] = [];
      for (const r of upsert[0] as Partial<HqSupplyRow>[]) {
        if (rejectIds.has(r.id!)) continue;
        const i = server.findIndex((s) => s.id === r.id);
        const row = { ...(i >= 0 ? server[i] : serverRow(r.id!)), ...r, synced_at: new Date().toISOString() } as HqSupplyRow;
        if (i >= 0) server[i] = row;
        else server.push(row);
        accepted.push({ id: r.id! });
      }
      return { data: accepted };
    }
    const ids = chainArgs(call, 'in');
    if (ids) return { data: server.filter((s) => (ids[1] as string[]).includes(s.id)) };
    // Keyset filter `synced_at.gt.X[,and(synced_at.eq.X,id.gt.Y)]`
    const or = chainArgs(call, 'or')?.[0] as string | undefined;
    const gt = or?.match(/synced_at\.gt\.([^,]+)/)?.[1];
    const tie = or?.match(/id\.gt\.([^)]+)\)/)?.[1];
    const rows = server
      .filter((s) => !gt || Date.parse(s.synced_at) > Date.parse(gt) || (tie !== undefined && s.synced_at === gt && s.id > tie))
      .sort((a, b) => (a.synced_at === b.synced_at ? a.id.localeCompare(b.id) : a.synced_at.localeCompare(b.synced_at)));
    return { data: rows };
  };

  function make(signedIn = true): HqSuppliesService {
    TestBed.resetTestingModule();
    user = signal<{ id: string } | null>(signedIn ? { id: 'u1' } : null);
    fake = fakeSupabase({ answer });
    TestBed.configureTestingModule({
      providers: [
        fake.provider,
        { provide: AuthService, useValue: { user } },
        { provide: ScConfirmService, useValue: { confirm: async () => (confirmCalls++, confirmAnswer) } },
      ],
    });
    const s = TestBed.inject(HqSuppliesService);
    TestBed.flushEffects();
    return s;
  }

  function clearStorage(): void {
    localStorage.removeItem(SUPPLIES_STORAGE_KEY);
    localStorage.removeItem(SUPPLIES_CACHE_KEY);
    localStorage.removeItem(suppliesCacheKey('u1'));
    localStorage.removeItem(suppliesCacheKey('u2'));
  }

  beforeEach(() => {
    server = [];
    failPush = false;
    rejectIds = new Set();
    confirmAnswer = true;
    confirmCalls = 0;
    clearStorage();
  });
  afterEach(clearStorage);

  it('adds a line, merges the same open name like a cart', async () => {
    const s = make();
    await s.sync();
    expect(s.add('  Quantum drive ', 1)).toBeTrue();
    expect(s.add('quantum DRIVE', 2)).toBeTrue();
    expect(s.items().length).toBe(1);
    expect(s.items()[0].qty).toBe(3);
  });

  it('rejects empty names and clamps quantities', () => {
    const s = make();
    expect(s.add('   ', 1)).toBeFalse();
    s.add('Shield', 5000);
    expect(s.items()[0].qty).toBe(SUPPLY_QTY_MAX);
    s.setQty(s.items()[0].id, -4);
    expect(s.items()[0].qty).toBe(1);
  });

  it('ticks lines off, counts what is open and clears the ticked ones', () => {
    const s = make();
    s.add('A', 2);
    s.add('B', 3);
    s.toggle(s.items()[0].id);
    expect(s.open().map((i) => i.name)).toEqual(['B']);
    expect(s.openUnits()).toBe(3);
    s.clearDone();
    expect(s.items().map((i) => i.name)).toEqual(['B']);
    s.remove(s.items()[0].id);
    expect(s.items()).toEqual([]);
  });

  it('caps the list', () => {
    const s = make();
    for (let i = 0; i < SUPPLIES_MAX_ITEMS + 5; i++) s.add(`item ${i}`, 1);
    expect(s.items().length).toBe(SUPPLIES_MAX_ITEMS);
  });

  it('keeps set, step kind, class name and source of a line and groups by set', () => {
    const s = make();
    s.add('S3 Repeater', 2, { setKind: 'ship', setId: 'c1', stepKind: 'buy', className: 'REP_S3', source: 'set' });
    s.add('Core', 1, { setKind: 'ship', setId: 'c1' });
    s.add('Loose', 1, { setKind: 'ship' }); // set_kind without set_id is dropped (DB pair constraint)
    const i = s.items()[0];
    expect([i.setKind, i.setId, i.stepKind, i.className, i.source]).toEqual(['ship', 'c1', 'buy', 'REP_S3', 'set']);
    expect(s.bySet().get('ship:c1')?.length).toBe(2);
    expect(s.items()[2].setKind).toBeNull();
  });

  it('pushes a new line and a tombstone to the server', async () => {
    const s = make();
    s.add('Rifle', 2);
    await s.sync();
    expect(server.map((r) => [r.name, r.qty, r.deleted_at])).toEqual([['Rifle', 2, null]]);
    s.remove(s.items()[0].id);
    await s.sync();
    expect(server[0].deleted_at).not.toBeNull();
    expect(s.items()).toEqual([]);
    expect(s.syncError()).toBeNull();
  });

  it('keeps an offline add (dirty) across a reload and pushes it once online', async () => {
    failPush = true;
    const s = make();
    s.add('Offline part', 1);
    await s.sync();
    expect(server).toEqual([]);
    expect(s.syncError()).not.toBeNull();
    failPush = false;
    const again = make();
    expect(again.items().map((i) => i.name)).toEqual(['Offline part']);
    await again.sync();
    expect(server.map((r) => r.name)).toEqual(['Offline part']);
    expect(again.syncError()).toBeNull();
  });

  it('two devices converge: a newer remote edit wins, a newer local edit stays', async () => {
    server = [serverRow('a', { name: 'Remote name', updated_at: '2026-11-01T12:00:00.000Z' }), serverRow('b')];
    const s = make();
    await s.sync();
    expect(s.items().map((i) => i.name).sort()).toEqual(['Part b', 'Remote name']);
    // A newer edit on the other device arrives with a higher synced_at.
    server[1] = serverRow('b', { name: 'Edited elsewhere', updated_at: '2026-11-01T11:00:00.000Z', synced_at: '2026-11-01T11:00:00.000Z' });
    await s.sync();
    expect(s.items().find((i) => i.id === 'b')?.name).toBe('Edited elsewhere');
    // A remote tombstone removes the line here.
    server[0] = serverRow('a', { deleted_at: '2026-11-01T13:00:00.000Z', updated_at: '2026-11-01T13:00:00.000Z', synced_at: '2026-11-01T13:00:00.000Z' });
    await s.sync();
    expect(s.items().map((i) => i.id)).toEqual(['b']);
  });

  it('imports the old local list after sign-in only once the user confirms, then removes the key', async () => {
    localStorage.setItem(SUPPLIES_STORAGE_KEY, JSON.stringify([{ id: 'old1', name: 'Old shield', qty: 2, done: true }]));
    const s = make();
    await flush();
    await s.sync();
    expect(confirmCalls).toBe(1);
    expect(localStorage.getItem(SUPPLIES_STORAGE_KEY)).toBeNull();
    expect(server.map((r) => [r.id, r.name, r.qty, r.done])).toEqual([['old1', 'Old shield', 2, true]]);
    expect(s.items()[0].name).toBe('Old shield');
  });

  it('keeps the old local list out of the account when the user declines', async () => {
    confirmAnswer = false;
    localStorage.setItem(SUPPLIES_STORAGE_KEY, JSON.stringify([{ id: 'old1', name: 'Old shield', qty: 2, done: true }]));
    const s = make();
    await flush();
    await s.sync();
    expect(s.items()).toEqual([]);
    expect(server).toEqual([]);
    expect(localStorage.getItem(SUPPLIES_STORAGE_KEY)).not.toBeNull();
  });

  it('caches per user: a second account on the same browser never sees the first one\'s lines', async () => {
    const s = make();
    s.add('Mine', 1);
    await s.sync();
    expect(localStorage.getItem(suppliesCacheKey('u1'))).not.toBeNull();
    expect(localStorage.getItem(SUPPLIES_CACHE_KEY)).toBeNull();
    server = [];
    user.set({ id: 'u2' });
    TestBed.flushEffects();
    await flush();
    expect(s.items()).toEqual([]);
  });

  it('pushes once more on sign-out and then drops that account\'s cache', async () => {
    failPush = false;
    const s = make();
    await s.sync();
    s.add('Last second', 1);
    user.set(null);
    TestBed.flushEffects();
    await flush();
    await flush();
    expect(server.map((r) => r.name)).toEqual(['Last second']);
    expect(localStorage.getItem(suppliesCacheKey('u1'))).toBeNull();
  });

  it('keeps a row the server rejected as stale dirty, and takes the server version instead of marking it pushed', async () => {
    // Far in the future: the server's copy must stay newer than the local
    // edit's clock (a fixed "today" turned into the past and broke this).
    server = [serverRow('a', { name: 'Server wins', updated_at: '2099-01-01T00:00:00.000Z', synced_at: '2099-01-01T00:00:00.000Z' })];
    const s = make();
    await s.sync();
    rejectIds.add('a');
    s.setQty('a', 5);
    expect(s.items().find((i) => i.id === 'a')?.dirty).toBeTrue();
    await s.sync();
    const a = s.items().find((i) => i.id === 'a')!;
    expect(a.name).toBe('Server wins');
    expect(a.qty).toBe(1);
    expect(a.dirty).toBeFalse();
  });

  it('is not ready before the first pull and ready after', async () => {
    const s = make();
    expect(s.ready()).toBeFalse();
    await s.sync();
    expect(s.ready()).toBeTrue();
  });

  it('pulls with a keyset on (synced_at, id) and re-reads a few seconds before the watermark', async () => {
    server = [serverRow('a', { synced_at: '2026-11-01T10:00:10.000Z' })];
    const s = make();
    await s.sync();
    fake.calls.length = 0;
    server.push(serverRow('b', { synced_at: '2026-11-01T10:00:07.000Z' })); // committed late, older synced_at
    await s.sync();
    const pull = fake.calls.find((c) => c.target === 'hq_supplies' && chainArgs(c, 'or'))!;
    expect(chainArgs(pull, 'order')).toBeDefined();
    expect(pull.chain.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual(['synced_at', 'id']);
    expect(chainArgs(pull, 'or')![0]).toBe('synced_at.gt.2026-11-01T10:00:05.000Z');
    expect(s.items().map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('signed out it still works from the old local key', () => {
    localStorage.setItem(SUPPLIES_STORAGE_KEY, '{not json');
    expect(make(false).items()).toEqual([]);
    const s = make(false);
    s.add('Local', 1);
    expect(JSON.parse(localStorage.getItem(SUPPLIES_STORAGE_KEY)!).length).toBe(1);
    expect(fake.calls.length).toBe(0);
  });

  describe('live agent API', () => {
    it('tickByClassName covers a line, reduces a bigger one, and untick reverts exactly that', () => {
      const s = make();
      s.add('Repeater', 3, { className: 'REP_S3' });
      const id = s.items()[0].id;
      expect(s.tickByClassName('rep_s3', 1)).toBe(id);
      expect(s.items()[0].qty).toBe(2);
      expect(s.items()[0].done).toBeFalse();
      s.untick(id, 1);
      expect(s.items()[0].qty).toBe(3);
      expect(s.tickByClassName('REP_S3', 5)).toBe(id);
      expect(s.items()[0].done).toBeTrue();
      expect(s.items()[0].qty).toBe(3);
      s.untick(id, 5);
      expect(s.items()[0].done).toBeFalse();
      expect(s.items()[0].qty).toBe(3);
    });

    it('tickByClassName returns null without a match and ignores ticked lines', () => {
      const s = make();
      s.add('Repeater', 1, { className: 'REP_S3' });
      expect(s.tickByClassName('OTHER', 1)).toBeNull();
      expect(s.tickByClassName('REP_S3', 1)).not.toBeNull();
      expect(s.tickByClassName('REP_S3', 1)).toBeNull();
    });

    it('prefers a wanted line', () => {
      const s = make();
      s.add('A', 1, { className: 'X', wanted: false });
      s.add('B', 1, { className: 'X', setKind: 'fps', setId: 'f1', wanted: true });
      const id = s.tickByClassName('x', 1);
      expect(s.items().find((i) => i.id === id)?.name).toBe('B');
    });
  });
});
