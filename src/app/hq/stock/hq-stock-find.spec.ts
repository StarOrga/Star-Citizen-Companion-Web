import { placeOfName } from '../plan/map/hq-places';
import { StockQuery, StockRow, findStock, stockNames } from './hq-stock-find';

describe('findStock', () => {
  const rows: StockRow[] = [
    { location: 'Area18', name: 'Gold', qty: 20, unit: 'scu' },
    { location: 'Lorville', name: 'Gold', qty: 50, unit: 'scu' },
    { location: 'New Babbage', name: 'Gold', qty: 10, unit: 'scu' },
    { location: 'Mein Schiff', name: 'Gold', qty: 5, unit: 'scu' },
    { location: 'Area18', name: 'Gold', qty: 3, unit: 'pcs' },
    { location: 'Area18', name: 'Goldbarren', qty: 1, unit: 'scu' },
  ];
  const q = (over: Partial<StockQuery> = {}): StockQuery => ({
    term: 'Gold',
    unit: 'scu',
    want: 0,
    here: placeOfName('Area18'),
    sort: 'nearest',
    ...over,
  });

  it('lists only the asked unit and prefers the exact name', () => {
    const [g, ...rest] = findStock(rows, q());
    expect(rest.length).toBe(0);
    expect(g.name).toBe('Gold');
    expect(g.total).toBe(85);
    expect(g.hits.some((h) => h.qty === 3)).toBeFalse();
  });

  it('keeps different items apart on a partial term', () => {
    expect(findStock(rows, q({ term: 'gol' })).map((g) => g.name)).toEqual(['Gold', 'Goldbarren']);
  });

  it('sorts by distance from here, unknown places last', () => {
    const [g] = findStock(rows, q());
    expect(g.hits[0].location).toBe('Area18');
    expect(g.hits[0].tier).toBe('here');
    expect(g.hits[g.hits.length - 1].location).toBe('Mein Schiff');
    expect(g.hits[g.hits.length - 1].tier).toBe('unknown');
  });

  it('sorts by amount, largest first', () => {
    const [g] = findStock(rows, q({ sort: 'most' }));
    expect(g.hits.map((h) => h.qty)).toEqual([50, 20, 10, 5]);
  });

  it('highlights one place when it holds the amount alone', () => {
    const [g] = findStock(rows, q({ want: 30 }));
    expect(g.stops).toBe(1);
    expect(g.covered).toBeTrue();
    expect(g.hits.find((h) => h.take > 0)?.location).toBe('Lorville');
  });

  it('combines places when none holds it alone', () => {
    const [g] = findStock(rows, q({ want: 75 }));
    expect(g.covered).toBeTrue();
    expect(g.hits.filter((h) => h.take > 0).map((h) => [h.location, h.take])).toEqual([
      ['Area18', 20],
      ['New Babbage', 10],
      ['Lorville', 45],
    ]);
  });

  it('says so when all places together stay short', () => {
    const [g] = findStock(rows, q({ want: 500 }));
    expect(g.covered).toBeFalse();
    expect(g.stops).toBe(4);
  });

  it('finds nothing for an empty term', () => {
    expect(findStock(rows, q({ term: '  ' }))).toEqual([]);
  });

  it('offers the own names, most stock first', () => {
    expect(stockNames(rows, '', 'scu')).toEqual(['Gold', 'Goldbarren']);
    expect(stockNames(rows, 'barr', 'scu')).toEqual(['Goldbarren']);
    expect(stockNames(rows, '', 'pcs')).toEqual(['Gold']);
  });
});

describe('placeOfName', () => {
  it('reads the planet from a game id', () => {
    expect(placeOfName('Stanton4_NewBabbage')).toEqual(
      jasmine.objectContaining({ system: 'Stanton', planet: 'microTech', location: 'New Babbage' }),
    );
  });

  it('knows typed landing zones in any spelling', () => {
    expect(placeOfName('Area 18')?.planet).toBe('ArcCorp');
    expect(placeOfName('lorville cbd')?.planet).toBe('Hurston');
    expect(placeOfName('Area 18')?.id).toBe(placeOfName('Area18')?.id);
    expect(placeOfName('Stanton3_Area18')?.id).toBe(placeOfName('Area18')?.id);
  });

  it('returns null for a name nothing is known about', () => {
    expect(placeOfName('Mein Schiff')).toBeNull();
    expect(placeOfName(' ')).toBeNull();
  });
});
