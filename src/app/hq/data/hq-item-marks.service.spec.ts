import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { chainArgs, fakeSupabase, type FakeCall, type FakeResult } from '../../testing/fake-supabase';
import { HqItemMarksService, type HqItemMark } from './hq-item-marks.service';

describe('HqItemMarksService', () => {
  let rows: HqItemMark[];
  let fake: ReturnType<typeof fakeSupabase>;
  let failWrites = false;
  const user = signal<{ id: string } | null>({ id: 'u1' });

  const answer = (call: FakeCall): FakeResult => {
    if (call.target !== 'hq_item_marks') return {};
    const up = chainArgs(call, 'upsert');
    if (failWrites && (up || call.chain.some(([m]) => m === 'delete'))) return { error: { message: 'boom' } };
    if (up) {
      const r = up[0] as HqItemMark;
      rows = [...rows.filter((x) => x.class_name !== r.class_name), r];
      return {};
    }
    return { data: rows };
  };

  function make(): HqItemMarksService {
    TestBed.resetTestingModule();
    fake = fakeSupabase({ answer });
    TestBed.configureTestingModule({ providers: [fake.provider, { provide: AuthService, useValue: { user } }] });
    return TestBed.inject(HqItemMarksService);
  }

  beforeEach(() => {
    rows = [];
    failWrites = false;
    user.set({ id: 'u1' });
  });

  it('loads the reader\'s marks once', async () => {
    rows = [{ class_name: 'A', note: 'keep', pinned_rank: 2 }];
    const s = make();
    await s.ensureLoaded();
    await s.ensureLoaded();
    expect(fake.calls.filter((c) => c.target === 'hq_item_marks').length).toBe(1);
    expect(s.noteOf('A')).toBe('keep');
    expect(s.isPinned('A')).toBeTrue();
    expect(s.isPinned('B')).toBeFalse();
  });

  it('saves a trimmed note per item and keeps an existing pin', async () => {
    const s = make();
    expect(await s.setPinned('A', true)).toBeTrue();
    expect(await s.setNote('A', '  for the Cutlass  ')).toBeTrue();
    expect(rows).toEqual([{ class_name: 'A', note: 'for the Cutlass', pinned_rank: 1 }]);
    expect(s.noteOf('A')).toBe('for the Cutlass');
  });

  it('refuses a note over 500 characters without a write', async () => {
    const s = make();
    expect(await s.setNote('A', 'x'.repeat(501))).toBeFalse();
    expect(fake.calls.length).toBe(0);
  });

  it('hands out the next free pin rank', async () => {
    const s = make();
    await s.setPinned('A', true);
    await s.setPinned('B', true);
    expect(s.markOf('A')?.pinned_rank).toBe(1);
    expect(s.markOf('B')?.pinned_rank).toBe(2);
  });

  it('a blank note on an unpinned item deletes the row', async () => {
    const s = make();
    await s.setNote('A', 'x');
    expect(await s.setNote('A', '   ')).toBeTrue();
    expect(s.markOf('A')).toBeNull();
    expect(fake.calls.at(-1)!.chain.some(([m]) => m === 'delete')).toBeTrue();
  });

  it('a failed write reports a translated key and leaves the state alone', async () => {
    const s = make();
    failWrites = true;
    expect(await s.setPinned('A', true)).toBeFalse();
    expect(s.error()).toMatch(/^errors\./);
    expect(s.isPinned('A')).toBeFalse();
  });

  it('signed out: nothing is read or written', async () => {
    const s = make();
    user.set(null);
    await s.ensureLoaded();
    expect(await s.setNote('A', 'x')).toBeFalse();
    expect(fake.calls.length).toBe(0);
  });
});
