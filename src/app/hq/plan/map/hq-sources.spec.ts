import { parsePlace, resolveSources } from './hq-sources';
import type { MapPlace } from './hq-map.types';

const P = (id: string): MapPlace => ({ id, system: 'Stanton', planet: null, location: id });

describe('resolveSources (D43 order)', () => {
  it('returns nothing without inputs', () => {
    expect(resolveSources({})).toEqual([]);
  });

  it('orders log → search → community → OCR and lets the first source win a place', () => {
    const hits = resolveSources({
      ocr: [{ place: P('d'), price: 1 }, { place: P('a'), price: 2 }],
      community: [{ location: 'stanton/c', median: 50, n: 7, newest: '2026-10-30T00:00:00Z' }],
      codex: [{ place: P('b'), price: 30 }],
      log: [{ place: P('a') }],
      placeOf: (loc) => P(loc.split('/')[1]),
    });
    expect(hits.map((h) => [h.place.id, h.source])).toEqual([
      ['a', 'log'],
      ['b', 'search'],
      ['c', 'community'],
      ['d', 'ocr'],
    ]);
    expect(hits[0].price).toBe(2);
    expect(hits[0].priceSource).toBe('ocr');
    expect(hits[2].n).toBe(7);
  });

  it('ignores community rows under five reports and invalid prices', () => {
    const hits = resolveSources({
      community: [{ location: 'Stanton › X', median: 9, n: 4, newest: '' }],
      codex: [{ place: P('z'), price: -3 }, { place: P('y'), price: 12 }],
    });
    expect(hits.map((h) => h.place.id)).toEqual(['y', 'z']);
    expect(hits[1].price).toBeUndefined();
  });

  it('sorts inside a source by price, cheapest first', () => {
    const hits = resolveSources({ codex: [{ place: P('x'), price: 20 }, { place: P('w'), price: 10 }] });
    expect(hits.map((h) => h.place.id)).toEqual(['w', 'x']);
  });

  it('parses community locations', () => {
    expect(parsePlace('Stanton › Hurston › Lorville')).toEqual({
      id: 'stanton/hurston/lorville',
      system: 'Stanton',
      planet: 'Hurston',
      location: 'Lorville',
    });
    expect(parsePlace('stanton/port-tressler')?.planet).toBeNull();
    expect(parsePlace('  ')).toBeNull();
  });
});
