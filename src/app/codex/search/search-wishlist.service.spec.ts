import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { WishRow, WishlistStore, wishKey } from '../../hq/data/wishlist.store';
import { failingChip } from './search-compose';
import { parseQuery } from './search-query-parse';
import { SearchWishlistService } from './search-wishlist.service';

function setup() {
  const rows = signal<WishRow[]>([]);
  const store = {
    byKey: () => new Map(rows().map((r) => [wishKey(r.kind, r.className, r.name), r] as const)),
    ensureLoaded: async () => undefined,
    add: async (e: { kind: string; className: string; name?: string | null }) => {
      rows.update((r) => [...r, { kind: e.kind, className: e.className, name: e.name ?? null, manufacturer: null, rsiUrl: null, notes: null, createdAt: '' }]);
      return true;
    },
    remove: async (kind: string, className: string, name?: string | null) => {
      rows.update((r) => r.filter((x) => wishKey(x.kind, x.className, x.name) !== wishKey(kind, className, name)));
      return true;
    },
  };
  const ships = signal<{ shipClassName: string; status: string; id: string }[]>([]);
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user: () => ({ id: 'u1' }) } },
      { provide: WishlistStore, useValue: store },
      { provide: HangarService, useValue: { ships, shipByClassName: (c: string) => ships().find((s) => s.shipClassName === c) ?? null } },
    ],
  });
  return { svc: TestBed.inject(SearchWishlistService), rows, ships };
}

describe('SearchWishlistService (A4 regression: announced ships)', () => {
  it('lights up a wished announced ship, matched by name although the search hit carries the feed id', () => {
    const { svc, rows } = setup();
    rows.set([{ kind: 'upcoming', className: 'idris', name: 'Idris', manufacturer: null, rsiUrl: null, notes: null, createdAt: '' }]);
    expect(svc.has('upcoming', 'feed-id-77', 'Idris')).toBeTrue();
    expect(svc.has('upcoming', 'feed-id-78', 'Polaris')).toBeFalse();
  });

  it('the toggle reports the truth: on, then off, and the key follows', async () => {
    const { svc } = setup();
    expect(await svc.toggle('upcoming', 'feed-id-77', 'Idris')).toBeTrue();
    expect(svc.has('upcoming', 'feed-id-77', 'Idris')).toBeTrue();
    expect(await svc.toggle('upcoming', 'feed-id-77', 'Idris')).toBeTrue();
    expect(svc.has('upcoming', 'feed-id-77', 'Idris')).toBeFalse();
  });

  it('a ship already owned cannot be wished (false, nothing changes)', async () => {
    const { svc, ships } = setup();
    ships.set([{ shipClassName: 'avenger', status: 'owned', id: 's1' }]);
    expect(await svc.toggle('ship', 'avenger')).toBeFalse();
    expect(svc.has('ship', 'avenger')).toBeFalse();
  });

  it('live ships on the hangar wishlist count', () => {
    const { svc, ships } = setup();
    ships.set([{ shipClassName: 'avenger', status: 'wishlist', id: 's1' }]);
    expect(svc.has('ship', 'Avenger')).toBeTrue();
  });
});

describe('search words for own data (A10)', () => {
  it('"gemerkt aegis" becomes a wished filter and searches "aegis"', () => {
    const p = parseQuery('gemerkt aegis');
    expect(p.rest).toBe('aegis');
    expect(p.chips[0].filter.wished).toBeTrue();
  });

  it('"fehlt mir" before a word is the Nachschub filter; "lager" the inventory filter', () => {
    expect(parseQuery('fehlt mir laser').chips[0].filter.needed).toBeTrue();
    expect(parseQuery('fehlt mir laser').rest).toBe('laser');
    expect(parseQuery('lager s3 laser').chips.some((c) => c.filter.ownKinds?.[0] === 'item')).toBeTrue();
  });

  it('the word alone stays plain text (nothing to filter yet)', () => {
    expect(parseQuery('gemerkt').chips.length).toBe(0);
    expect(parseQuery('gemerkt').rest).toBe('gemerkt');
  });

  it('the wished chip drops hits that are not on the list', () => {
    const chip = parseQuery('gemerkt x').chips[0];
    const hit = { kind: 'ship', classNameSlug: 'a' } as never;
    expect(failingChip(hit, [chip], { wished: () => false })).toBe(chip);
    expect(failingChip(hit, [chip], { wished: () => true })).toBeNull();
  });
});
