import type { CodexSearchGroup } from '../../codex/search/codex-search-model';
import type { PolySearchHit } from '../../codex/codex-poly-search';
import {
  CAP_EXCLUDED,
  CAP_OTHER,
  CAP_PRIMARY,
  matchPlaces,
  neutralContext,
  searchContextOf,
  weightGroups,
} from './search-context';

function hit(kind: string, slug: string): PolySearchHit {
  return { kind, classNameSlug: slug } as unknown as PolySearchHit;
}

function group(kind: string, n: number, total = n): CodexSearchGroup {
  return {
    kind: kind as CodexSearchGroup['kind'],
    hits: Array.from({ length: n }, (_, i) => hit(kind, `${kind}-${i}`)),
    total,
    count: total,
    countIsFloor: false,
    folded: 0,
    foldedIsFloor: false,
    more: null,
  };
}

describe('search-context', () => {
  describe('searchContextOf', () => {
    it('maps the main areas', () => {
      expect(searchContextOf('/verse').key).toBe('verse');
      expect(searchContextOf('/verse/gallery/abc').key).toBe('gallery');
      expect(searchContextOf('/hq/hangar').key).toBe('hq');
      expect(searchContextOf('/codex').key).toBe('codex');
      expect(searchContextOf('/settings').key).toBe('all');
    });

    it('reads the index kind from the query', () => {
      const c = searchContextOf('/codex/index?kind=weapon&q=x');
      expect(c.key).toBe('codexIndex');
      expect(c.prefer).toEqual(['weapon']);
      expect(c.labelParams).toEqual({ kind: 'weapon' });
      expect(searchContextOf('/codex/index').prefer).toEqual(['ship']);
    });

    it('puts components and weapons first on a ship page', () => {
      const c = searchContextOf('/codex/ship/AEGS_Avenger_Stalker');
      expect(c.key).toBe('ship');
      expect(c.prefer).toEqual(['component', 'weapon']);
    });

    it('lets the gallery and HQ lead with places, HQ with own ships', () => {
      expect(searchContextOf('/verse/gallery').placesFirst).toBeTrue();
      const hq = searchContextOf('/hq');
      expect(hq.placesFirst).toBeTrue();
      expect(hq.ownedFirst).toBeTrue();
    });
  });

  describe('weightGroups', () => {
    it('reorders by context without dropping a group', () => {
      const groups = [group('ship', 6), group('weapon', 6), group('component', 6)];
      const out = weightGroups(groups, searchContextOf('/codex/ship/x'));
      expect(out.map((w) => w.group.kind)).toEqual(['component', 'weapon', 'ship']);
      expect(out.length).toBe(3);
    });

    it('caps preferred groups at the primary cap, others lower, keeping "all N"', () => {
      const groups = [group('ship', 5, 40), group('weapon', 5, 12)];
      const out = weightGroups(groups, searchContextOf('/codex/index?kind=weapon'), undefined, () => ({
        link: ['/codex/index'],
        queryParams: null,
      }));
      const weapon = out.find((w) => w.group.kind === 'weapon')!;
      const ship = out.find((w) => w.group.kind === 'ship')!;
      expect(weapon.shown.length).toBe(CAP_PRIMARY);
      expect(ship.shown.length).toBe(CAP_OTHER);
      expect(ship.more).not.toBeNull();
    });

    it('keeps the engine order in the neutral context', () => {
      const groups = [group('weapon', 2), group('ship', 2)];
      const out = weightGroups(groups, neutralContext());
      expect(out.map((w) => w.group.kind)).toEqual(['ship', 'weapon']);
      expect(out[0].shown.length).toBe(2);
      expect(out[0].more).toBeNull();
    });

    it('floats owned ships up in HQ', () => {
      const out = weightGroups([group('ship', 3)], searchContextOf('/hq'), (slug) => slug === 'ship-2');
      expect(out[0].shown[0].classNameSlug).toBe('ship-2');
    });
  });

  describe('matchPlaces', () => {
    it('finds places by keyword, boosted ones first', () => {
      const label = (p: { labelKey: string }) => p.labelKey;
      const inGallery = matchPlaces('starscape', searchContextOf('/verse/gallery'), label);
      expect(inGallery[0].id).toBe('gallery');
      expect(matchPlaces('', neutralContext(), label)).toEqual([]);
      expect(matchPlaces('hangar', searchContextOf('/hq'), label)[0].id).toBe('hangar');
    });
  });
});

describe('search-context · HQ pages (exclusion)', () => {
  it('keeps the plain HQ context for Start and the sub routes', () => {
    expect(searchContextOf('/hq', null).key).toBe('hq');
    expect(searchContextOf('/hq', 'start').key).toBe('hq');
    expect(searchContextOf('/hq/hangar', 'inventar').key).toBe('hq');
  });

  it('derives one context per landing page, with a chip label each', () => {
    const keys = (['planen', 'jetzt', 'inventar', 'statistik'] as const).map((p) => searchContextOf('/hq', p));
    expect(keys.map((c) => c.key)).toEqual(['hqPlan', 'hqNow', 'hqStock', 'hqStats']);
    expect(keys.map((c) => c.labelKey)).toEqual([
      'fusionBar.ctx.hqPlan',
      'fusionBar.ctx.hqNow',
      'fusionBar.ctx.hqStock',
      'fusionBar.ctx.hqStats',
    ]);
    expect(keys.every((c) => c.ownedFirst && c.placesFirst)).toBeTrue();
  });

  it('lets the Bestand chip follow the tab (I14); a link without a tab stays Inventar', () => {
    const label = (url: string): string => searchContextOf(url, 'inventar').labelKey;
    expect(label('/hq?bestand=alles#inventar')).toBe('fusionBar.ctx.hqStockAll');
    expect(label('/hq?bestand=hangar#inventar')).toBe('fusionBar.ctx.hqStockHangar');
    expect(label('/hq?bestand=sammlung#inventar')).toBe('fusionBar.ctx.hqStockSammlung');
    expect(label('/hq?bestand=inventar#inventar')).toBe('fusionBar.ctx.hqStock');
    expect(label('/hq#inventar')).toBe('fusionBar.ctx.hqStock');
    expect(searchContextOf('/hq?bestand=hangar#inventar', 'inventar').key).toBe('hqStock');
  });

  it('lets the Bestand chip follow the tab (I14); a link without a tab stays Inventar', () => {
    const label = (url: string): string => searchContextOf(url, 'inventar').labelKey;
    expect(label('/hq?bestand=alles#inventar')).toBe('fusionBar.ctx.hqStockAll');
    expect(label('/hq?bestand=hangar#inventar')).toBe('fusionBar.ctx.hqStockHangar');
    expect(label('/hq?bestand=sammlung#inventar')).toBe('fusionBar.ctx.hqStockSammlung');
    expect(label('/hq?bestand=inventar#inventar')).toBe('fusionBar.ctx.hqStock');
    expect(label('/hq#inventar')).toBe('fusionBar.ctx.hqStock');
    expect(searchContextOf('/hq?bestand=hangar#inventar', 'inventar').key).toBe('hqStock');
  });

  it('never hard-filters: an excluded group stays, collapsed to one row with its "all N" link', () => {
    const ctx = searchContextOf('/hq', 'inventar');
    expect(ctx.exclude).toContain('upcoming');
    const groups = [group('upcoming', 4, 9), group('ship', 4, 4), group('weapon', 4, 4)];
    const out = weightGroups(groups, ctx, () => false, () => ({ commands: ['/x'] }) as never);
    expect(out.map((w) => w.group.kind)).toEqual(['ship', 'weapon', 'upcoming']);
    const up = out.find((w) => w.group.kind === 'upcoming')!;
    expect(up.collapsed).toBeTrue();
    expect(up.shown.length).toBe(CAP_EXCLUDED);
    expect(up.more).not.toBeNull();
  });

  it('ranks deprioritized kinds after neutral ones and before excluded ones', () => {
    const ctx = searchContextOf('/hq', 'inventar');
    const out = weightGroups([group('upcoming', 1), group('component', 1), group('blueprint', 1)], ctx);
    expect(out.map((w) => w.group.kind)).toEqual(['blueprint', 'component', 'upcoming']);
  });

  it('the neutral context excludes nothing', () => {
    expect(neutralContext().exclude).toEqual([]);
    expect(neutralContext().deprioritize).toEqual([]);
  });
});
