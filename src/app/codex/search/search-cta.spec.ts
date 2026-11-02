import { searchContextOf } from '../../shell/fusion-bar/search-context';
import type { SearchContext } from '../../shell/fusion-bar/search-context';
import type { PolyHitKind } from '../codex-poly-search';
import type { SearchCtaId } from './search-result-model';
import { CtaRow, CTA_COLUMNS, CTA_MATRIX, CtaRowKey, resolveCta, resolveIcons } from './search-cta';

const OWN = { shipId: 'h1', equippedOnShipId: null, inSetIds: [], inLager: false };

function ctxFor(key: CtaRowKey): SearchContext {
  switch (key) {
    case 'chipShip': return searchContextOf('/codex/ship/AEGS_Gladius');
    case 'chipItem': return searchContextOf('/codex/weapon/BEHR_Rifle');
    case 'hqHangar': return searchContextOf('/hq/hangar');
    case 'hqStock': return searchContextOf('/hq', 'bestand');
    case 'hqPlan': return searchContextOf('/hq', 'planen');
    default: return searchContextOf('/codex');
  }
}

/** Row of each matrix column. */
function rowOf(col: (typeof CTA_COLUMNS)[number], extra: Partial<CtaRow> = {}): CtaRow {
  const kinds: Record<string, PolyHitKind | null> = {
    owned: 'ship', ship: 'ship', weaponComponent: 'weapon', fps: 'item', ammunition: 'ammunition',
    blueprint: 'blueprint', upcoming: 'upcoming', manufacturer: 'manufacturer', mission: null,
  };
  return {
    type: 'hit', kind: kinds[col], classNameSlug: 'X', manufacturerCode: 'AEGS',
    ownership: col === 'owned' ? OWN : null, target: { link: ['/x'], queryParams: null },
    flagshipClassName: 'DRAK_Cutlass', ...extra,
  };
}

describe('search CTA matrix (round 3, q3-matrix)', () => {
  // Expected ids per context, cell by cell, with every "wie Neutral" and `*` fallback resolved by hand.
  const expected: Record<CtaRowKey, (SearchCtaId | null)[]> = {
    //            owned          ship           wc             fps       ammo     bp                  upcoming  mfr           mission
    neutral:   ['myLoadout', 'compareWith', null, 'inSet', null, 'materialToSupply', 'atRsi', 'allProducts', null],
    chipShip:  ['compareWith', 'compareWith', null, 'inSet', null, 'materialToSupply', 'atRsi', 'allProducts', null],
    chipItem:  ['myLoadout', 'compareWith', 'compareWith', 'compareWith', null, 'materialToSupply', 'atRsi', 'allProducts', null],
    hqHangar:  ['myLoadout', 'add', null, 'inSet', null, 'materialToSupply', 'atRsi', 'allProducts', null],
    hqStock:   ['myLoadout', 'add', 'whereStored', 'whereStored', 'whereStored', 'materialToSupply', null, 'allProducts', null],
    hqPlan:    ['planOps', 'compareWith', 'sourceOf', 'sourceOf', 'sourceOf', 'materialToSupply', 'atRsi', 'allProducts', null],
    signedOut: [null, 'add', null, 'inSet', null, 'materialToSupply', 'atRsi', 'allProducts', null],
  };

  (Object.keys(expected) as CtaRowKey[]).forEach((key) => {
    CTA_COLUMNS.forEach((col, i) => {
      if (col === 'mission') return; // there is no mission kind in the index yet
      it(`${key} x ${col} -> ${expected[key][i] ?? 'none'}`, () => {
        const ctx = ctxFor(key);
        // chip item context: the chip is a weapon, so "same kind" compare only for weapons/components
        const row = rowOf(col, key === 'chipItem' && col === 'fps' ? { kind: 'weapon' } : {});
        const cta = resolveCta(ctx, row, key !== 'signedOut');
        expect(cta?.id ?? null).toBe(expected[key][i]);
      });
    });
  });

  it('matrix table has one cell per column in every row', () => {
    for (const k of Object.keys(CTA_MATRIX) as CtaRowKey[]) expect(CTA_MATRIX[k].length).toBe(CTA_COLUMNS.length);
  });

  it('Mein Loadout links to the ship in the HQ, not the hangar list (D1)', () => {
    const cta = resolveCta(searchContextOf('/codex'), rowOf('owned'), true);
    expect(cta?.target?.link).toEqual(['/hq/hangar', 'h1']);
  });

  it('an owned item fitted on a ship leads to that ship', () => {
    const cta = resolveCta(searchContextOf('/codex'), rowOf('fps', { ownership: { ...OWN, shipId: null, equippedOnShipId: 'h9' } }), true);
    expect(cta?.id).toBe('myLoadout');
    expect(cta?.target?.link).toEqual(['/hq/hangar', 'h9']);
  });

  it('Gegenueberstellung needs a flagship in a neutral context', () => {
    expect(resolveCta(searchContextOf('/codex'), rowOf('ship', { flagshipClassName: null }), true)).toBeNull();
  });

  it('Hinzufuegen asks for sign-in when signed out', () => {
    const cta = resolveCta(searchContextOf('/codex'), rowOf('ship'), false);
    expect(cta).toEqual(jasmine.objectContaining({ id: 'add', needsSignIn: true }));
  });

  it('chip item compares only the same kind', () => {
    const ctx = searchContextOf('/codex/weapon/BEHR_Rifle');
    expect(resolveCta(ctx, rowOf('weaponComponent', { kind: 'weapon' }), true)?.id).toBe('compareWith');
    expect(resolveCta(ctx, rowOf('weaponComponent', { kind: 'component' }), true)).toBeNull();
  });

  describe('Vergleichen on Codex list pages', () => {
    const list = searchContextOf('/codex/index?kind=weapon');
    it('is the CTA for rows of the list kind', () => {
      expect(resolveCta(list, rowOf('weaponComponent'), true)?.id).toBe('compare');
    });
    it('does not apply to other kinds: they follow the neutral row', () => {
      expect(resolveCta(list, rowOf('ship'), true)?.id).toBe('compareWith');
    });
    it('never on announced ships or manufacturers', () => {
      const up = searchContextOf('/codex/upcoming');
      expect(resolveCta(up, rowOf('upcoming'), true)?.id).toBe('atRsi');
      const mfr = searchContextOf('/codex/index?kind=manufacturer');
      expect(resolveCta(mfr, rowOf('manufacturer'), true)?.id).toBe('allProducts');
    });
    it('is not offered outside list pages', () => {
      expect(resolveCta(searchContextOf('/codex'), rowOf('weaponComponent'), true)?.id).toBeUndefined();
    });
  });

  describe('rows without a CTA', () => {
    for (const type of ['patch', 'gallery', 'place'] as const) {
      it(`${type} has none`, () => {
        expect(resolveCta(searchContextOf('/codex'), { type }, true)).toBeNull();
        expect(resolveIcons({ type })).toEqual({ wishlist: false, lager: false, nachschub: false });
      });
    }
  });

  describe('own data rows', () => {
    const ctx = searchContextOf('/hq');
    it('a ship or loadout leads to its HQ page', () => {
      const cta = resolveCta(ctx, { type: 'own', ownKind: 'config', ownRefId: 'h2' }, true);
      expect(cta?.id).toBe('myLoadout');
      expect(cta?.target?.link).toEqual(['/hq/hangar', 'h2']);
    });
    it('a set opens the set', () => {
      expect(resolveCta(ctx, { type: 'own', ownKind: 'set', ownRefId: 's1' }, true)?.target?.link).toEqual(['/hq/locker', 's1']);
    });
    it('an inventory item asks where it is stored', () => {
      expect(resolveCta(ctx, { type: 'own', ownKind: 'item' }, true)?.id).toBe('whereStored');
    });
  });
});

describe('search icons (B9)', () => {
  const icons = (kind: PolyHitKind) => resolveIcons({ type: 'hit', kind });
  it('equipment, ships: all three', () => {
    for (const k of ['ship', 'weapon', 'component', 'item', 'ammunition'] as PolyHitKind[]) {
      expect(icons(k)).toEqual({ wishlist: true, lager: true, nachschub: true });
    }
  });
  it('a blueprint gets the wishlist only', () => {
    expect(icons('blueprint')).toEqual({ wishlist: true, lager: false, nachschub: false });
  });
  it('an announced ship can be wished for, not stored', () => {
    expect(icons('upcoming')).toEqual({ wishlist: true, lager: false, nachschub: false });
  });
  it('manufacturers have none', () => {
    expect(icons('manufacturer')).toEqual({ wishlist: false, lager: false, nachschub: false });
  });
});
