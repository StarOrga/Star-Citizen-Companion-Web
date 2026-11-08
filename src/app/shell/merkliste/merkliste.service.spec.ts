import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { ConsentService } from '../../core/consent.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqInventoryService } from '../../hq/data/hq-inventory.service';
import { SammlungService } from '../../hq/nachschub/sammlung.service';
import { NewsService } from '../../news/news.service';
import { WishCartService } from '../cart/wish-cart.service';
import { lastAdded, type CartItem } from '../cart/wish-cart.model';
import { RECENT_ROWS_KEY } from '../fusion-bar/search-recent-rows';
import { noteOpenedPage } from './merkliste-opened';
import { MerklisteService } from './merkliste.service';

const cartItem = (kind: string, className: string, createdAt: string, name: string | null = null, qty = 1): CartItem => ({
  kind, className, name, qty, forClassName: null, key: `${kind}:${className}`, createdAt, manufacturer: null, shipId: null,
});

interface Own {
  wishes?: CartItem[];
  stock?: { location: string; name: string; class_name: string | null; qty: number; unit: 'pcs' | 'scu'; updated_at: string }[];
  ships?: { id: string; shipClassName: string; customName: string | null; status: string; qty?: number; createdAt: string }[];
  collected?: string[];
}

function setup(own: Own = {}) {
  const items = signal<CartItem[]>(own.wishes ?? []);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: AuthService, useValue: { user: signal(null) } },
      {
        provide: WishCartService,
        useValue: {
          count: signal(own.wishes?.length ?? 0),
          newest: (n: number, keep?: (i: CartItem) => boolean) => lastAdded(keep ? items().filter(keep) : items(), n),
          nameOf: (i: { name: string | null; className: string }) => i.name ?? i.className,
        },
      },
      { provide: HangarService, useValue: { ships: signal(own.ships ?? []), loadAll: () => Promise.resolve() } },
      { provide: HqInventoryService, useValue: { items: signal(own.stock ?? []), load: () => Promise.resolve() } },
      { provide: SammlungService, useValue: { news: signal(new Set<string>(own.collected ?? [])) } },
      { provide: NewsService, useValue: { feed: signal(null), favoriteIds: signal(new Set<string>()), itemById: () => null, refresh: () => Promise.resolve() } },
      { provide: ConsentService, useValue: { preferencesAllowed: signal(true) } },
    ],
  });
  return TestBed.inject(MerklisteService);
}

describe('MerklisteService (Schnellzugriff)', () => {
  beforeEach(() => {
    localStorage.removeItem(RECENT_ROWS_KEY);
    localStorage.setItem('sc.consent', JSON.stringify({ preferences: true, statistics: false }));
  });
  afterEach(() => {
    localStorage.removeItem(RECENT_ROWS_KEY);
    localStorage.removeItem('sc.consent');
  });

  it('writes nothing without the preferences consent', () => {
    localStorage.setItem('sc.consent', JSON.stringify({ preferences: false, statistics: false }));
    noteOpenedPage({ kind: 'ship', className: 'AEGS_Gladius', title: 'Gladius', manufacturerCode: 'AEGS' });
    expect(localStorage.getItem(RECENT_ROWS_KEY)).toBeNull();
  });

  it('an opened Codex page shows under "Zuletzt geöffnet" without the search having opened it, up to seven', async () => {
    const svc = setup();
    await TestBed.inject(Router).navigateByUrl('/codex/ship/AEGS_Gladius');
    expect(svc.type()).toBe('ship');
    expect(svc.recent()).toEqual([]);
    for (let i = 0; i < 9; i++) noteOpenedPage({ kind: 'ship', className: `S${i}`, title: `S${i}`, manufacturerCode: null });
    svc.refresh();
    expect(svc.recent().length).toBe(7);
    expect(svc.recent()[0].title).toBe('S8');
    expect(svc.recent()[0].kind).toBe('ship');
    expect(svc.recent()[0].className).toBe('S8');
  });

  it('keeps the newest first, one row per page, and cuts by the page type', async () => {
    const svc = setup();
    await TestBed.inject(Router).navigateByUrl('/codex/ship/AEGS_Gladius');
    noteOpenedPage({ kind: 'ship', className: 'A', title: 'A', manufacturerCode: null });
    noteOpenedPage({ kind: 'weapon', className: 'W', title: 'W', manufacturerCode: null });
    noteOpenedPage({ kind: 'ship', className: 'B', title: 'B', manufacturerCode: null });
    noteOpenedPage({ kind: 'ship', className: 'A', title: 'A', manufacturerCode: null });
    svc.refresh();
    expect(svc.recent().map((r) => r.title)).toEqual(['A', 'B']);
  });

  it('ignores announced ships and kinds without a type', () => {
    setup();
    noteOpenedPage({ kind: 'upcoming', className: 'X', title: 'X', manufacturerCode: null });
    noteOpenedPage({ kind: 'ammunition', className: 'Y', title: 'Y', manufacturerCode: null });
    expect(localStorage.getItem(RECENT_ROWS_KEY)).toBeNull();
  });

  describe('Wunschliste: the last three added', () => {
    const wishes = [
      cartItem('weapon', 'w1', '2026-11-01T10:00:00Z', 'W1', 2),
      cartItem('weapon', 'w2', '2026-11-02T10:00:00Z', 'W2'),
      cartItem('weapon', 'w3', '2026-11-03T10:00:00Z', 'W3'),
      cartItem('weapon', 'w4', '2026-11-04T10:00:00Z', 'W4'),
      cartItem('item', 'i1', '2026-11-05T10:00:00Z', 'I1'),
    ];

    it('is cut by the page type: the newest three of that type', async () => {
      const svc = setup({ wishes });
      await TestBed.inject(Router).navigateByUrl('/codex/index?kind=weapon');
      expect(svc.wished().map((r) => r.title)).toEqual(['W4', 'W3', 'W2']);
      expect(svc.wished()[0].qty).toBe(1);
    });

    it('falls back to the newest overall when there are none of the type, with no hint', async () => {
      const svc = setup({ wishes });
      await TestBed.inject(Router).navigateByUrl('/codex/ship/AEGS_Gladius');
      expect(svc.wished().map((r) => r.title)).toEqual(['I1', 'W4', 'W3']);
    });

    it('a page without a type shows the newest overall', async () => {
      const svc = setup({ wishes });
      await TestBed.inject(Router).navigateByUrl('/hq');
      expect(svc.type()).toBeNull();
      expect(svc.wished().length).toBe(3);
    });

    it('material wishes take their place: the newest three are three rows, never fewer (AUD-9)', async () => {
      const mats = [1, 2, 3, 4].map((n) => ({ ...cartItem('material', `m${n}`, `2026-11-0${5 + n}T10:00:00Z`, `Mat ${n}`, 3), forClassName: 'BP_X' as string | null }));
      const svc = setup({ wishes: [...wishes, ...mats] });
      await TestBed.inject(Router).navigateByUrl('/hq');
      expect(svc.wished().map((r) => r.title)).toEqual(['Mat 4', 'Mat 3', 'Mat 2']);
      expect(svc.wished()[0].target?.link).toEqual(['/codex', 'blueprint', 'BP_X']);
    });

    it('a material wished for a blueprint is listed on a blueprint page', async () => {
      const m = { ...cartItem('material', 'iron', '2026-11-09T10:00:00Z', 'Iron', 2), forClassName: 'BP_X' as string | null };
      const svc = setup({ wishes: [...wishes, m] });
      await TestBed.inject(Router).navigateByUrl('/codex/blueprint/BP_X');
      expect(svc.wished().map((r) => r.title)).toEqual(['Iron']);
    });
  });

  describe('the context section (Inventar / Hangar / Sammlung)', () => {
    const stock = [
      { location: 'Bei mir', name: 'Karna', class_name: 'klwe_rifle_energy_01', qty: 1, unit: 'pcs' as const, updated_at: '2026-11-07T10:00:00Z' },
      { location: 'Bei mir', name: 'S-38', class_name: 'behr_pistol_ballistic_01', qty: 2, unit: 'pcs' as const, updated_at: '2026-11-06T10:00:00Z' },
      { location: 'Bei mir', name: 'Pembroke Helm', class_name: 'rsi_pembroke_helmet_01_01_01', qty: 1, unit: 'pcs' as const, updated_at: '2026-11-08T10:00:00Z' },
      { location: 'Bei mir', name: 'Titan', class_name: null, qty: 4, unit: 'scu' as const, updated_at: '2026-11-08T11:00:00Z' },
    ];

    it('Inventar on a weapon page: strictly the weapons, deep link carrying the type filter', async () => {
      const svc = setup({ stock });
      await TestBed.inject(Router).navigateByUrl('/codex/index?kind=weapon');
      const c = svc.context()!;
      expect(c.ctx.id).toBe('inventar');
      expect(c.rows.map((r) => r.title)).toEqual(['Karna', 'S-38']);
      expect(c.all.queryParams).toEqual(expect.objectContaining({ bestand: 'inventar', cat: 'weapons' }));
      expect(c.rows[0].target?.queryParams).toEqual(expect.objectContaining({ cat: 'weapons', focus: 'klwe_rifle_energy_01' }));
      expect(c.rows[1].qty).toBe(2);
    });

    it('Hangar on a ship page: the owned ships, newest first, linked to their HQ page', async () => {
      const svc = setup({
        ships: [
          { id: 's1', shipClassName: 'AEGS_Gladius', customName: null, status: 'owned', createdAt: '2026-11-01T00:00:00Z' },
          { id: 's2', shipClassName: 'DRAK_Cutter', customName: 'Meine Cutter', status: 'owned', qty: 2, createdAt: '2026-11-05T00:00:00Z' },
          { id: 's3', shipClassName: 'MISC_Prospector', customName: null, status: 'wishlist', createdAt: '2026-11-06T00:00:00Z' },
        ],
      });
      await TestBed.inject(Router).navigateByUrl('/codex/ship/AEGS_Gladius');
      const c = svc.context()!;
      expect(c.ctx.id).toBe('hangar');
      expect(c.rows.map((r) => r.title)).toEqual(['Meine Cutter', 'AEGS_Gladius']);
      expect(c.rows[0].target?.link).toEqual(['/hq/hangar', 's2']);
      expect(c.all.queryParams).toEqual(expect.objectContaining({ bestand: 'hangar' }));
    });

    it('Sammlung on a news page: the collected posts; on a blueprint page the collected blueprints', async () => {
      const svc = setup({
        collected: ['n1'],
        stock: [{ location: 'Blueprints', name: 'Gallant', class_name: 'bp_gallant', qty: 1, unit: 'pcs', updated_at: '2026-11-01T00:00:00Z' }],
      });
      await TestBed.inject(Router).navigateByUrl('/verse/news/abc');
      expect(svc.context()!.ctx.id).toBe('sammlung');
      await TestBed.inject(Router).navigateByUrl('/codex/blueprint/x');
      const c = svc.context()!;
      expect(c.rows.map((r) => r.title)).toEqual(['Gallant']);
      expect(c.rows[0].target?.link).toEqual(['/codex', 'blueprint', 'bp_gallant']);
    });

    it('no Bestand section on a page without a type (HQ start, Verse, Social)', async () => {
      const svc = setup({ stock });
      for (const url of ['/hq', '/verse', '/social']) {
        await TestBed.inject(Router).navigateByUrl(url);
        expect(svc.context()).toBeNull();
      }
    });
  });

  it('"Ganze Wunschliste" is this page with ?cart=1 (its own URL)', async () => {
    const svc = setup();
    await TestBed.inject(Router).navigateByUrl('/codex/index?kind=weapon#top');
    expect(svc.cartHref()).toContain('kind=weapon');
    expect(svc.cartHref()).toContain('cart=1');
  });
});
