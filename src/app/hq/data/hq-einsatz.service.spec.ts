import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { FakeCall, FakeResult, chainArgs, fakeSupabase } from '../../testing/fake-supabase';
import type { HqEinsatzRow, HqEinsatzStepRow } from './hq-db.types';
import { EINSATZ_CACHE_KEY, HqEinsatzService, NewEinsatz, einsatzBadge } from './hq-einsatz.service';

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
    if (call.target === 'hq_einsaetze') {
      if (up) {
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
      if (up) {
        for (const r of up[0] as HqEinsatzStepRow[]) {
          stepRows = stepRows.filter((s) => !(s.einsatz_id === r.einsatz_id && s.ord === r.ord));
          stepRows.push(r);
        }
        return {};
      }
      if (chainArgs(call, 'delete')) return {};
      return { data: stepRows };
    }
    return {};
  };

  function make(): HqEinsatzService {
    TestBed.resetTestingModule();
    fake = fakeSupabase({ answer });
    TestBed.configureTestingModule({ providers: [fake.provider, { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } }] });
    const s = TestBed.inject(HqEinsatzService);
    TestBed.flushEffects();
    return s;
  }

  beforeEach(() => {
    einsaetze = [];
    stepRows = [];
    localStorage.removeItem(EINSATZ_CACHE_KEY);
  });
  afterEach(() => localStorage.removeItem(EINSATZ_CACHE_KEY));

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
    localStorage.removeItem(EINSATZ_CACHE_KEY);
    const other = make();
    await other.sync();
    expect(other.items()[0].title).toBe('Pembroke run');
    expect(other.items()[0].steps.map((x) => x.kind)).toEqual(['buy', 'mission', 'transport']);
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
