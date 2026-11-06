import { searchContextOf } from '../../shell/fusion-bar/search-context';
import type { SearchContext } from '../../shell/fusion-bar/search-context';
import type { PolyHitKind } from '../codex-poly-search';
import type { SearchCtaId } from './search-result-model';
import { CtaRow, CTA_COLUMNS, CTA_MATRIX, CtaRowKey, resolveCta, resolveIcons } from './search-cta';

const OWN = { shipId: 'h1', equippedOnShipId: null, inSetIds: [], inLager: false, lagerQty: 0, fittedOn: [] };

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
    type: col === 'mission' ? 'mission' : 'hit', kind: kinds[col], classNameSlug: 'X', manufacturerCode: 'AEGS',
    ownership: col === 'owned' ? OWN : null, target: { link: ['/x'], queryParams: null },
    flagshipClassName: 'DRAK_Cutlass', ...extra,
  };
}

describe('search CTA matrix (round 3, q3-matrix)', () => {
  // Expected ids per context, cell by cell, with every "wie Neutral" and `*` fallback resolved by hand.
  const expected: Record<CtaRowKey, (SearchCtaId | null)[]> = {
    // A blueprint has a CTA only where its mission is known (below); no row names one yet.
    //            owned          ship           wc             fps       ammo     bp                  upcoming  mfr           mission
    neutral:   ['myLoadout', 'compareWith', 'fittingShips', 'inSet', 'fittingWeapons', null, 'atRsi', 'allProducts', 'toEinsatz'],
    // Montieren needs the reader's own ship of the chip's class; rowOf owns none, so the cell falls back.
    chipShip:  ['compareWith', 'compareWith', 'fittingShips', 'inSet', 'fittingWeapons', null, 'atRsi', 'allProducts', 'toEinsatz'],
    chipItem:  ['mount', 'compareWith', 'compareWith', 'compareWith', 'fittingWeapons', null, 'atRsi', 'allProducts', 'toEinsatz'],
    // Wo verbaut? on a piece fitted nowhere falls back to the neutral cell.
    hqHangar:  ['myLoadout', 'add', 'fittingShips', 'inSet', 'fittingWeapons', null, 'atRsi', 'allProducts', 'toEinsatz'],
    hqStock:   ['myLoadout', 'add', 'whereStored', 'whereStored', 'whereStored', null, null, 'allProducts', 'toEinsatz'],
    hqPlan:    ['planOps', 'sourceOf', 'sourceOf', 'sourceOf', 'sourceOf', null, 'atRsi', 'allProducts', 'toEinsatz'],
    signedOut: [null, 'add', 'fittingShips', 'inSet', 'fittingWeapons', null, 'atRsi', 'allProducts', 'toEinsatz'],
  };

  (Object.keys(expected) as CtaRowKey[]).forEach((key) => {
    CTA_COLUMNS.forEach((col, i) => {
      it(`${key} x ${col} -> ${expected[key][i] ?? 'none'}`, () => {
        const ctx = ctxFor(key);
        // chip item context: the chip is a weapon, so "same kind" compare only for weapons/components
        const row = rowOf(col, key === 'chipItem' && col === 'fps' ? { kind: 'weapon' } : {});
        const cta = resolveCta(ctx, row, key !== 'signedOut');
        expect(cta?.id ?? null).toBe(expected[key][i]);
      });
    });
  });

  it('Zur Mission: a link, and only where the row names the mission (A9)', () => {
    const target = { link: ['/codex', 'missions', 'm1'], queryParams: null };
    const cta = resolveCta(searchContextOf('/codex'), rowOf('blueprint', { missionTarget: target }), true);
    expect(cta).toEqual(jasmine.objectContaining({ id: 'toMission', type: 'link', target }));
    expect(resolveCta(searchContextOf('/codex'), rowOf('blueprint'), true)).toBeNull();
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
    // A component under a weapon chip is no "same kind": the neutral cell (Passende Schiffe) answers.
    expect(resolveCta(ctx, rowOf('weaponComponent', { kind: 'component' }), true)?.id).toBe('fittingShips');
  });

  describe('Wo verbaut? (HQ Hangar x Waffe/Komp., flipped * cell)', () => {
    const hangar = searchContextOf('/hq/hangar');
    const fitted = { ...OWN, shipId: null, equippedOnShipId: 'h9', fittedOn: [{ shipId: 'h7', name: 'Nachtfalke', count: 2 }] };
    it('links to the hangar ship the piece is fitted on, in its own wording', () => {
      const cta = resolveCta(hangar, rowOf('weaponComponent', { ownership: fitted }), true);
      expect(cta).toEqual(jasmine.objectContaining({ id: 'whereInstalled', labelKey: 'search.cta.whereInstalled', type: 'link', needsSignIn: false }));
      expect(cta?.target?.link).toEqual(['/hq/hangar', 'h7']);
    });
    it('also for components', () => {
      const cta = resolveCta(hangar, rowOf('weaponComponent', { kind: 'component', ownership: fitted }), true);
      expect(cta?.labelKey).toBe('search.cta.whereInstalled');
    });
    it('stays Mein Loadout outside the hangar context', () => {
      expect(resolveCta(searchContextOf('/codex'), rowOf('weaponComponent', { ownership: fitted }), true)?.labelKey).toBe('search.cta.myLoadout');
    });
    it('a piece fitted nowhere falls back to the neutral cell (Passende Schiffe)', () => {
      expect(resolveCta(hangar, rowOf('weaponComponent'), true)?.id).toBe('fittingShips');
    });
  });

  describe('Passende Schiffe (Neutral / Abgemeldet x Waffe/Komp.)', () => {
    it('links to the ship index filtered by the piece', () => {
      const cta = resolveCta(searchContextOf('/codex'), rowOf('weaponComponent', { classNameSlug: 'BEHR_LaserCannon_S3' }), true);
      expect(cta).toEqual(jasmine.objectContaining({ id: 'fittingShips', type: 'link', labelKey: 'search.cta.fittingShips' }));
      expect(cta?.target).toEqual({ link: ['/codex', 'index'], queryParams: { kind: 'ship', fits: 'BEHR_LaserCannon_S3' } });
    });
    it('is a plain link signed out too (reading needs no account)', () => {
      const cta = resolveCta(searchContextOf('/codex'), rowOf('weaponComponent', { kind: 'component' }), false);
      expect(cta).toEqual(jasmine.objectContaining({ id: 'fittingShips', needsSignIn: false }));
    });
  });

  describe('Passende Waffen (Neutral x Munition)', () => {
    it('links to the weapon index filtered by the round', () => {
      const cta = resolveCta(searchContextOf('/codex'), rowOf('ammunition', { classNameSlug: 'AMMO_S3_Laser' }), true);
      expect(cta?.id).toBe('fittingWeapons');
      expect(cta?.target).toEqual({ link: ['/codex', 'index'], queryParams: { kind: 'weapon', ammo: 'AMMO_S3_Laser' } });
    });
  });

  describe('Montieren', () => {
    const chipShip = searchContextOf('/codex/ship/AEGS_Gladius');
    it('Chip Schiff x Waffe/Komp.: onto the reader\'s own ship of the chip class, with ?mount=', () => {
      const cta = resolveCta(chipShip, rowOf('weaponComponent', { classNameSlug: 'BEHR_S3', chipShipId: 'h4' }), true);
      expect(cta).toEqual(jasmine.objectContaining({ id: 'mount', type: 'link', labelKey: 'search.cta.mount' }));
      expect(cta?.target).toEqual({ link: ['/hq/hangar', 'h4'], queryParams: { mount: 'BEHR_S3' } });
    });
    it('Chip Schiff without an own ship of that class falls back to Passende Schiffe', () => {
      expect(resolveCta(chipShip, rowOf('weaponComponent', { chipShipId: null }), true)?.id).toBe('fittingShips');
    });
    it('Chip Item x Besitz: the chip\'s piece onto the row\'s own ship', () => {
      const cta = resolveCta(searchContextOf('/codex/weapon/BEHR_Rifle'), rowOf('owned'), true);
      expect(cta?.id).toBe('mount');
      expect(cta?.target).toEqual({ link: ['/hq/hangar', 'h1'], queryParams: { mount: 'BEHR_Rifle' } });
    });
    it('Chip Item x an own ship row (Eigene Daten) mounts too', () => {
      const cta = resolveCta(searchContextOf('/codex/weapon/BEHR_Rifle'), { type: 'own', ownKind: 'ship', ownRefId: 'h2', kind: null }, true);
      expect(cta?.target).toEqual({ link: ['/hq/hangar', 'h2'], queryParams: { mount: 'BEHR_Rifle' } });
    });
  });

  describe('Bezugsquelle for ships (HQ Planen x Schiff)', () => {
    it('links to the ship page at its where-to-buy section', () => {
      const cta = resolveCta(searchContextOf('/hq', 'planen'), rowOf('ship', { target: { link: ['/codex', 'ship', 'AEGS_Gladius'], queryParams: null } }), true);
      expect(cta).toEqual(jasmine.objectContaining({ id: 'sourceOf', type: 'link' }));
      expect(cta?.target).toEqual({ link: ['/codex', 'ship', 'AEGS_Gladius'], queryParams: null, fragment: 'bezugsquelle' });
    });
  });

  describe('Zum Einsatz (Neutral / HQ Planen x Mission)', () => {
    it('is an action (a button), not a link', () => {
      const cta = resolveCta(searchContextOf('/hq', 'planen'), rowOf('mission'), true);
      expect(cta).toEqual(jasmine.objectContaining({ id: 'toEinsatz', type: 'action', target: null, needsSignIn: false }));
    });
    it('asks for sign-in when signed out', () => {
      expect(resolveCta(searchContextOf('/codex'), rowOf('mission'), false)?.needsSignIn).toBeTrue();
    });
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
      expect(resolveCta(searchContextOf('/codex'), rowOf('weaponComponent'), true)?.id).toBe('fittingShips');
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
  it('a blueprint has all three stops (A9)', () => {
    expect(icons('blueprint')).toEqual({ wishlist: true, lager: true, nachschub: true });
  });
  it('an announced ship can be wished for, not stored', () => {
    expect(icons('upcoming')).toEqual({ wishlist: true, lager: false, nachschub: false });
  });
  it('manufacturers have none', () => {
    expect(icons('manufacturer')).toEqual({ wishlist: false, lager: false, nachschub: false });
  });
});
