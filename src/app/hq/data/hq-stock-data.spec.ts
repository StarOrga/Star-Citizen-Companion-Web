import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HqStartFeedService } from '../start/hq-start-feed.service';
import { HqOwnershipService } from '../hq-ownership.service';
import type { HqFleetPatch, HqInventoryItemRow, HqInventorySnapshotRow } from './hq-db.types';
import { HQ_STOCK_STALE_DAYS, groupLocations, parsePreviousSnapshot, snapshotAge } from './hq-inventory.service';
import { HqPatchService, mapPatchHit } from './hq-patch.service';
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

  it('takes the most important hit only, the first line of the RPC, with a link to the set', () => {
    // A ship set's set_id is a variant id: it opens that variant on the ship's personal view.
    const variantLink = (id: string) => (id === 'sh1' ? { commands: ['/codex/ship', 'AEGS_Gladius'], queryParams: { v: 'sh1' } } : null);
    expect(mapPatchHit(patch, variantLink)).toEqual({
      plan: 'Bounty v3', build: '4.3.1', name: 'S3-Repeater', pct: 8, weaker: true,
      link: ['/codex/ship', 'AEGS_Gladius'], linkQuery: { v: 'sh1' },
    });
    // Unknown to the index: the hangar list, never the /hq/hangar/:id redirect (it looks up ship ids).
    expect(mapPatchHit(patch)?.link).toEqual(['/hq/hangar']);
    expect(mapPatchHit(patch)?.linkQuery).toBeUndefined();
    const fps: HqFleetPatch = { ...patch, lines: [patch.lines[1]] };
    expect(mapPatchHit(fps)?.link).toEqual(['/hq/locker', 'f1']);
    expect(mapPatchHit(fps)?.weaker).toBeFalse();
  });

  it('a hit without a set has no link, and a raw class name becomes readable', () => {
    const hit = mapPatchHit({ build: null, previous: null, lines: [{ ...patch.lines[2], class_name: 'KLWE_Repeater_S3' }] });
    expect(hit?.link).toBeUndefined();
    expect(hit?.plan).toBeNull();
    expect(hit?.name).toBe('KLWE Repeater S3');
  });

  it('maps nothing / empty to no hit', () => {
    expect(mapPatchHit(null)).toBeNull();
    expect(mapPatchHit({ build: null, previous: null, lines: [] })).toBeNull();
  });

  it('feeds HqStartFeedService after load and clears on failure', async () => {
    const rpc = jasmine.createSpy('rpc').and.resolveTo({ data: patch, error: null });
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: SupabaseClientProvider, useValue: { client: { rpc } } },
        { provide: AuthService, useValue: { user: signal<{ id: string } | null>(null) } },
        {
          provide: HqOwnershipService,
          useValue: {
            ensureLoaded: async () => undefined,
            configById: (id: string) => (id === 'sh1' ? { id: 'sh1', hangarShipId: 'hs1' } : null),
            index: signal(new Map([['AEGS_Gladius', { ship: { id: 'hs1', shipClassName: 'AEGS_Gladius' } }]])),
          },
        },
      ],
    });
    const svc = TestBed.inject(HqPatchService);
    const feed = TestBed.inject(HqStartFeedService);
    (TestBed.inject(AuthService).user as ReturnType<typeof signal<{ id: string } | null>>).set({ id: 'u1' });
    await svc.load();
    expect(feed.patchHit()?.name).toBe('S3-Repeater');
    // The variant id resolves through the ownership index to the ship's personal view.
    expect(feed.patchHit()?.link).toEqual(['/codex/ship', 'AEGS_Gladius']);
    expect(feed.patchHit()?.linkQuery).toEqual({ v: 'sh1' });
    rpc.and.resolveTo({ data: null, error: new Error('x') });
    await svc.load();
    expect(feed.patchHit()).toBeNull();
    expect(svc.error()).toBeTruthy();
  });

  it('shell beta: the variant id opens the HQ ship page with that variant', async () => {
    localStorage.setItem('sc.beta', JSON.stringify({ shell: true }));
    try {
      const rpc = jasmine.createSpy('rpc').and.resolveTo({ data: patch, error: null });
      TestBed.configureTestingModule({
        providers: [
          provideTranslateService({ fallbackLang: 'en' }),
          { provide: SupabaseClientProvider, useValue: { client: { rpc } } },
          { provide: AuthService, useValue: { user: signal<{ id: string } | null>(null) } },
          {
            provide: HqOwnershipService,
            useValue: {
              ensureLoaded: async () => undefined,
              configById: (id: string) => (id === 'sh1' ? { id: 'sh1', hangarShipId: 'hs1' } : null),
              index: signal(new Map([['AEGS_Gladius', { ship: { id: 'hs1', shipClassName: 'AEGS_Gladius' } }]])),
            },
          },
        ],
      });
      const svc = TestBed.inject(HqPatchService);
      (TestBed.inject(AuthService).user as ReturnType<typeof signal<{ id: string } | null>>).set({ id: 'u1' });
      await svc.load();
      const hit = TestBed.inject(HqStartFeedService).patchHit();
      expect(hit?.link).toEqual(['/hq/hangar', 'hs1']);
      expect(hit?.linkQuery).toEqual({ v: 'sh1' });
    } finally {
      localStorage.removeItem('sc.beta');
    }
  });
});

describe('parsePreviousSnapshot', () => {
  it('reads the desktop shape { snapshot, items } from docs/contracts/hq-live.md', () => {
    const snap = parsePreviousSnapshot({
      snapshot: { location: 'Area18', system: 'Stanton', source: 'ocr', taken_at: '2026-10-30T10:00:00Z' },
      items: [{ name: 'Gold', class_name: null, qty: 4, unit: 'scu' }],
    });
    expect(snap?.location).toBe('Area18');
    expect(snap?.source).toBe('ocr');
    expect(snap?.items).toEqual([{ name: 'Gold', class_name: null, qty: 4, unit: 'scu', quality: null }]);
  });

  it('still reads the flat shape and rejects a snapshot without location', () => {
    expect(parsePreviousSnapshot({ location: 'Lorville', items: [] })?.location).toBe('Lorville');
    expect(parsePreviousSnapshot({ snapshot: {}, items: [] })).toBeNull();
  });
});
