import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HqStartFeedService } from '../start/hq-start-feed.service';
import type { HqFleetPatch, HqInventoryItemRow, HqInventorySnapshotRow } from './hq-db.types';
import { HQ_STOCK_STALE_DAYS, groupLocations, snapshotAge } from './hq-inventory.service';
import { HqPatchService, formatPct, mapPatchLines } from './hq-patch.service';
import { HqStatsService, bucketKeys, normalizeStats, zeroFill } from './hq-stats.service';

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0); // Sunday 2026-11-01
const DAY = 86_400_000;

describe('snapshotAge', () => {
  it('counts minutes, hours and days', () => {
    expect(snapshotAge(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toEqual({ unit: 'minutes', n: 5, stale: false });
    expect(snapshotAge(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toEqual({ unit: 'hours', n: 3, stale: false });
    expect(snapshotAge(new Date(NOW - 2 * DAY).toISOString(), NOW)).toEqual({ unit: 'days', n: 2, stale: false });
  });

  it('turns stale exactly from 7 days', () => {
    expect(snapshotAge(new Date(NOW - (HQ_STOCK_STALE_DAYS * DAY - 1)).toISOString(), NOW).stale).toBeFalse();
    expect(snapshotAge(new Date(NOW - HQ_STOCK_STALE_DAYS * DAY).toISOString(), NOW).stale).toBeTrue();
  });

  it('treats a future or invalid timestamp as just now', () => {
    expect(snapshotAge(new Date(NOW + DAY).toISOString(), NOW).stale).toBeFalse();
    expect(snapshotAge('nope', NOW).n).toBe(0);
  });
});

describe('groupLocations', () => {
  const snap = (location: string, taken_at: string): HqInventorySnapshotRow => ({
    user_id: 'u', location, system: null, source: 'manual', taken_at, item_count: 0, created_at: taken_at, updated_at: taken_at,
  });
  const item = (location: string, name: string, unit: 'pcs' | 'scu'): HqInventoryItemRow => ({
    user_id: 'u', location, name, class_name: null, qty: 2, unit, updated_at: '',
  });

  it('is empty without data', () => {
    expect(groupLocations([], [])).toEqual([]);
  });

  it('sorts newest first and splits materials from pieces', () => {
    const out = groupLocations(
      [snap('A', '2026-10-01T00:00:00Z'), snap('B', '2026-10-20T00:00:00Z')],
      [item('B', 'Gold', 'scu'), item('B', 'Medpen', 'pcs'), item('A', 'Kupfer', 'scu')],
    );
    expect(out.map((l) => l.snapshot.location)).toEqual(['B', 'A']);
    expect(out[0].materials.map((i) => i.name)).toEqual(['Gold']);
    expect(out[0].pieces.map((i) => i.name)).toEqual(['Medpen']);
  });
});

describe('stats zero-fill', () => {
  it('lists 7 day buckets ending today', () => {
    const keys = bucketKeys('7d', 'day', NOW);
    expect(keys.length).toBe(7);
    expect(keys[6]).toBe('2026-11-01');
    expect(keys[0]).toBe('2026-10-26');
  });

  it('lists Monday week buckets for 90 days', () => {
    const keys = bucketKeys('90d', 'week', NOW);
    expect(keys.length).toBe(13);
    expect(keys[12]).toBe('2026-10-26');
  });

  it('fills gaps with zeros and keeps given values', () => {
    const out = zeroFill([{ bucket: '2026-10-30T00:00:00Z', value: 4 }], '7d', 'day', NOW);
    expect(out.map((p) => p.value)).toEqual([0, 0, 0, 0, 4, 0, 0]);
  });

  it('normalizes null / empty data to zeros, not an error', () => {
    const s = normalizeStats(null, '30d', NOW);
    expect(s.auec.series.length).toBe(30);
    expect(s.missions.total).toBe(0);
    expect(s.deaths_claims.series.every((p) => p.deaths === 0 && p.claims === 0)).toBeTrue();
  });
});

describe('HqStatsService', () => {
  function make(rpc: jasmine.Spy): HqStatsService {
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseClientProvider, useValue: { client: { rpc } } }],
    });
    return TestBed.inject(HqStatsService);
  }

  it('loads and zero-fills', async () => {
    const svc = make(jasmine.createSpy('rpc').and.resolveTo({ data: { range: '7d', bucket: 'day', missions: { total: 2, series: [] } }, error: null }));
    await svc.load('7d');
    expect(svc.stats()?.missions.total).toBe(2);
    expect(svc.stats()?.missions.series.length).toBe(7);
    expect(svc.error()).toBeNull();
  });

  it('records an error key on failure', async () => {
    const svc = make(jasmine.createSpy('rpc').and.resolveTo({ data: null, error: new Error('boom') }));
    await svc.load('7d');
    expect(svc.error()).toMatch(/^errors\./);
    expect(svc.stats()).toBeNull();
  });
});

describe('patch feed', () => {
  const patch: HqFleetPatch = {
    build: '4.3.1',
    previous: '4.3.0',
    lines: [
      { class_name: 'S3-Repeater', entity_kind: 'part', category: 'weapon', path: 'weapon.dps', old: 100, new: 92, pct: -8, set_kind: 'ship', set_id: 'sh1', set_name: 'Bounty v3' },
      { class_name: 'Gladius', entity_kind: 'ship', category: 'flight', path: 'flight.scm', old: 1, new: 1.035, pct: 3.5, set_kind: 'fps', set_id: 'f1', set_name: 'Bunker' },
      { class_name: 'x', entity_kind: 'ship', category: 'a', path: 'a', old: 1, new: 2, pct: 100, set_kind: null, set_id: null, set_name: null },
    ],
  };

  it('formats percentages with a real minus and decimal comma', () => {
    expect(formatPct(-8)).toBe('−8 %');
    expect(formatPct(3.5)).toBe('+3,5 %');
  });

  it('maps at most two lines with links to the set', () => {
    const lines = mapPatchLines(patch, (s) => `betrifft ${s} ›`);
    expect(lines.length).toBe(2);
    expect(lines[0].category).toBe('4.3.1 · S3-Repeater −8 %');
    expect(lines[0].effect).toBe('betrifft Bounty v3 ›');
    expect(lines[0].link).toEqual(['/hq/hangar', 'sh1']);
    expect(lines[1].link).toEqual(['/hq/locker', 'f1']);
  });

  it('maps nothing / empty to no lines', () => {
    expect(mapPatchLines(null, (s) => s)).toEqual([]);
    expect(mapPatchLines({ build: null, previous: null, lines: [] }, (s) => s)).toEqual([]);
  });

  it('feeds HqStartFeedService after load and clears on failure', async () => {
    const rpc = jasmine.createSpy('rpc').and.resolveTo({ data: patch, error: null });
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: SupabaseClientProvider, useValue: { client: { rpc } } },
        { provide: AuthService, useValue: { user: signal<{ id: string } | null>(null) } },
      ],
    });
    TestBed.inject(TranslateService).setTranslation('en', { hq: { patch: { affects: 'affects {{set}}' } } });
    const svc = TestBed.inject(HqPatchService);
    const feed = TestBed.inject(HqStartFeedService);
    (TestBed.inject(AuthService).user as ReturnType<typeof signal<{ id: string } | null>>).set({ id: 'u1' });
    await svc.load();
    expect(feed.patchLines().length).toBe(2);
    expect(feed.patchLines()[0].effect).toBe('affects Bounty v3');
    rpc.and.resolveTo({ data: null, error: new Error('x') });
    await svc.load();
    expect(feed.patchLines()).toEqual([]);
    expect(svc.error()).toBeTruthy();
  });
});
