import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { FakeCall, FakeResult, chainArgs, fakeSupabase } from '../../testing/fake-supabase';
import type { HqEinsatzRow, HqEinsatzStepRow } from './hq-db.types';
import { EINSATZ_CACHE_KEY, HqEinsatzService, NewEinsatz, STEPS_ID_CHUNK, einsatzBadge, einsatzCacheKey } from './hq-einsatz.service';

const steps: NewEinsatz['steps'] = [
  { kind: 'buy', label: 'S3 Repeater', location: 'Lorville', system: 'Stanton', className: 'REP_S3', qty: 1, supplyId: 's1', missionRef: null },
  { kind: 'mission', label: 'Bounty v3', location: 'Port Olisar', system: 'Stanton', className: null, qty: null, supplyId: null, missionRef: 'bounty-v3' },
  { kind: 'transport', label: 'Back home', location: null, system: null, className: null, qty: null, supplyId: null, missionRef: null },
];

describe('HqEinsatzService', () => {
  let einsaetze: HqEinsatzRow[];
  let stepRows: HqEinsatzStepRow[];
  let fake: ReturnType<typeof fakeSupabase>;

  const answer = (call: FakeCall): FakeResult => {
    const up = chainArgs(call, 'upsert');
    if (call.op === 'rpc' && call.target === 'hq_replace_einsatz_steps') {
      const a = call.args as { p_einsatz_id: string; p_steps: Partial<HqEinsatzStepRow>[] };
      stepRows = stepRows.filter((s) => s.einsatz_id !== a.p_einsatz_id);
      for (const r of a.p_steps) stepRows.push({ ...r, einsatz_id: a.p_einsatz_id } as HqEinsatzStepRow);
      return {};
    }
    if (call.target === 'hq_einsaetze') {
      const ids = chainArgs(call, 'in');
      if (ids) return { data: einsaetze.filter((e) => (ids[1] as string[]).includes(e.id)) };
      if (up) {
        if (rejectIds.size) {
          const rows = (up[0] as HqEinsatzRow[]).filter((r) => !rejectIds.has(r.id));
          return { data: rows.map((r) => ({ id: r.id })) };
        }
        for (const r of up[0] as HqEinsatzRow[]) {
          const i = einsaetze.findIndex((e) => e.id === r.id);
          const row = { ...r, synced_at: new Date().toISOString() } as HqEinsatzRow;
          if (i >= 0) einsaetze[i] = row;
          else einsaetze.push(row);
        }
        return { data: (up[0] as HqEinsatzRow[]).map((r) => ({ id: r.id })) };
      }
      return { data: einsaetze };
    }
    if (call.target === 'hq_einsatz_steps') {
      const ids = chainArgs(call, 'in')?.[1] as string[] | undefined;
      const range = chainArgs(call, 'range') as [number, number] | undefined;
      const all = stepRows
        .filter((s) => !ids || ids.includes(s.einsatz_id))
        .sort((a, b) => a.einsatz_id.localeCompare(b.einsatz_id) || a.ord - b.ord);
      if (truncateSteps) return { data: range && range[0] >= 10 ? [] : all.slice(0, 10), count: all.length };
      return { data: range ? all.slice(range[0], range[1] + 1) : all, count: all.length };
    }
    return {};
  };

  let rejectIds: Set<string>;
  let truncateSteps = false;
  const user = signal<{ id: string } | null>({ id: 'u1' });

  function make(): HqEinsatzService {
    TestBed.resetTestingModule();
    fake = fakeSupabase({ answer });
    TestBed.configureTestingModule({ providers: [fake.provider, { provide: AuthService, useValue: { user } }] });
    const s = TestBed.inject(HqEinsatzService);
    TestBed.flushEffects();
    return s;
  }

  function clearStorage(): void {
    localStorage.removeItem(EINSATZ_CACHE_KEY);
    localStorage.removeItem(einsatzCacheKey('u1'));
    localStorage.removeItem(einsatzCacheKey('u2'));
  }

  beforeEach(() => {
    einsaetze = [];
    stepRows = [];
    rejectIds = new Set();
    truncateSteps = false;
    user.set({ id: 'u1' });
    clearStorage();
  });
  afterEach(clearStorage);

  it('computes the badge: one step = Einsatz, two or more = Einsatz xN', () => {
    expect(einsatzBadge({ steps: steps.slice(0, 1) as never })).toEqual({ multi: false, n: 1 });
    expect(einsatzBadge({ steps: steps as never })).toEqual({ multi: true, n: 3 });
  });

  it('creates an Einsatz with ordered steps and refuses an empty one', () => {
    const s = make();
    expect(s.create({ title: '  ', steps })).toBeNull();
    expect(s.create({ title: 'Pembroke', steps: [] })).toBeNull();
    const e = s.create({ title: 'Pembroke run', steps })!;
    expect(e.steps.map((x) => x.ord)).toEqual([0, 1, 2]);
    expect(einsatzBadge(e).n).toBe(3);
    expect(s.upcoming().length).toBe(1);
  });

  it('pushes the Einsatz and its steps, and a second device pulls both', async () => {
    const s = make();
    s.create({ title: 'Pembroke run', steps });
    await s.sync();
    expect(einsaetze.length).toBe(1);
    expect(stepRows.length).toBe(3);
    localStorage.removeItem(einsatzCacheKey('u1'));
    const other = make();
    await other.sync();
    expect(other.items()[0].title).toBe('Pembroke run');
    expect(other.items()[0].steps.map((x) => x.kind)).toEqual(['buy', 'mission', 'transport']);
  });

  it('rewrites the steps through the replace RPC, never with an upsert + trim', async () => {
    const s = make();
    s.create({ title: 'Run', steps });
    await s.sync();
    const rpc = fake.calls.filter((c) => c.op === 'rpc');
    expect(rpc.length).toBe(1);
    expect(rpc[0].target).toBe('hq_replace_einsatz_steps');
    expect((rpc[0].args as { p_steps: unknown[] }).p_steps.length).toBe(3);
    expect(fake.calls.some((c) => c.target === 'hq_einsatz_steps' && (chainArgs(c, 'upsert') || chainArgs(c, 'delete')))).toBeFalse();
  });

  it('does not rewrite the steps of an Einsatz the server rejected as stale, and keeps the server version', async () => {
    const s = make();
    const e = s.create({ title: 'Mine', steps })!;
    einsaetze = [
      { user_id: 'u1', id: e.id, title: 'Server wins', activity: null, status: 'planned', planned_at: null, start_location: null,
        deleted_at: null, created_at: '', updated_at: '2099-01-01T00:00:00.000Z', synced_at: '2099-01-01T00:00:00.000Z' } as HqEinsatzRow,
    ];
    rejectIds.add(e.id);
    await s.sync();
    expect(fake.calls.some((c) => c.op === 'rpc')).toBeFalse();
    expect(s.items()[0].title).toBe('Server wins');
    expect(s.items()[0].dirty).toBeFalse();
  });

  it('pulls steps in chunks of 50 ids with explicit pages, and reads every row', async () => {
    const mk = (i: number) => `e${String(i).padStart(3, '0')}`;
    einsaetze = Array.from({ length: 60 }, (_, i) => ({
      user_id: 'u1', id: mk(i), title: `E${i}`, activity: null, status: 'planned', planned_at: null, start_location: null,
      deleted_at: null, created_at: '', updated_at: '2026-11-01T10:00:00.000Z', synced_at: `2026-11-01T10:00:${String(i % 60).padStart(2, '0')}.000Z`,
    })) as HqEinsatzRow[];
    stepRows = einsaetze.flatMap((e) =>
      Array.from({ length: 40 }, (_, ord) => ({ einsatz_id: e.id, user_id: 'u1', ord, kind: 'buy', label: 'L', location: null, system: null,
        class_name: null, qty: null, supply_id: null, mission_ref: null, state: 'todo', done_at: null, done_by: null }) as HqEinsatzStepRow),
    );
    const s = make();
    await s.sync();
    const stepCalls = fake.calls.filter((c) => c.target === 'hq_einsatz_steps');
    expect(stepCalls.length).toBe(3);
    expect((chainArgs(stepCalls[0], 'in')![1] as string[]).length).toBe(STEPS_ID_CHUNK);
    expect(chainArgs(stepCalls[0], 'range')).toEqual([0, 999]);
    expect(chainArgs(stepCalls[1], 'range')).toEqual([1000, 1999]);
    expect(s.items().length).toBe(60);
    expect(s.items().every((e) => e.steps.length === 40)).toBeTrue();
    expect(s.ready()).toBeTrue();
  });

  it('never merges a truncated step list: a short page makes the pull fail instead', async () => {
    einsaetze = [
      { user_id: 'u1', id: 'e1', title: 'E', activity: null, status: 'planned', planned_at: null, start_location: null, deleted_at: null,
        created_at: '', updated_at: '2026-11-01T10:00:00.000Z', synced_at: '2026-11-01T10:00:00.000Z' } as HqEinsatzRow,
    ];
    stepRows = Array.from({ length: 30 }, (_, ord) => ({ einsatz_id: 'e1', user_id: 'u1', ord, kind: 'buy', label: 'L', location: null,
      system: null, class_name: null, qty: null, supply_id: null, mission_ref: null, state: 'todo', done_at: null, done_by: null }) as HqEinsatzStepRow);
    truncateSteps = true;
    const s = make();
    await s.sync();
    expect(s.items()).toEqual([]);
    expect(s.syncError()).not.toBeNull();
    expect(s.ready()).toBeFalse();
  });

  it('caches per user and drops the cache after a final push on sign-out', async () => {
    const s = make();
    s.create({ title: 'Run', steps });
    await s.sync();
    expect(localStorage.getItem(einsatzCacheKey('u1'))).not.toBeNull();
    expect(localStorage.getItem(EINSATZ_CACHE_KEY)).toBeNull();
    s.setStatus(s.items()[0].id, 'active');
    user.set(null);
    TestBed.flushEffects();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(einsaetze[0].status).toBe('active');
    expect(localStorage.getItem(einsatzCacheKey('u1'))).toBeNull();
    expect(s.items()).toEqual([]);
  });

  describe('live agent API', () => {
    it('markStepDone ticks the first matching open step by live; unmarkStep reverts it', () => {
      const s = make();
      const e = s.create({ title: 'Run', steps })!;
      expect(s.markStepDone({ kind: 'buy', className: 'rep_s3' })).toEqual({ einsatzId: e.id, ord: 0 });
      expect(s.items()[0].steps[0].state).toBe('done');
      expect(s.items()[0].steps[0].doneBy).toBe('live');
      expect(s.markStepDone({ kind: 'buy', className: 'REP_S3' })).toBeNull();
      s.unmarkStep(e.id, 0);
      expect(s.items()[0].steps[0].state).toBe('todo');
      expect(s.items()[0].steps[0].doneBy).toBeNull();
    });

    it('does not match a step that contradicts the event, and matches missions by reference', () => {
      const s = make();
      s.create({ title: 'Run', steps });
      expect(s.markStepDone({ kind: 'buy', className: 'OTHER' })).toBeNull();
      expect(s.markStepDone({ kind: 'mission', missionRef: 'bounty-v2' })).toBeNull();
      expect(s.markStepDone({ kind: 'mission', missionRef: 'bounty-v3' })?.ord).toBe(1);
    });

    it('finishes the Einsatz when the last step is done and reopens it on undo', () => {
      const s = make();
      const e = s.create({ title: 'Run', steps: steps.slice(0, 1) })!;
      s.markStepDone({ kind: 'buy' });
      expect(s.items()[0].status).toBe('done');
      expect(s.upcoming()).toEqual([]);
      s.unmarkStep(e.id, 0);
      expect(s.items()[0].status).toBe('active');
    });
  });
});
