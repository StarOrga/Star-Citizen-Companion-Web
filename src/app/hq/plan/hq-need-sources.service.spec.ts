import type { BuyOption } from '../../codex/uex-shop.service';
import { bestSource, buyPlace, sourcesByDistance, toNeedSources } from './hq-need-sources.service';
import { placeOfName } from './map/hq-places';

describe('need sources', () => {
  const buy = (place: string | null, planet: string | null, price: number): BuyOption => ({
    price,
    priceAvg: null,
    terminal: `Shop ${place}`,
    location: place ?? '—',
    system: 'Stanton',
    planet,
    place,
  });

  it('turns a shop into a map place, without repeating a planet as its own planet', () => {
    expect(buyPlace(buy('Area 18', 'ArcCorp', 1))).toEqual({
      id: 'stanton/arccorp/area-18',
      system: 'Stanton',
      planet: 'ArcCorp',
      location: 'Area 18',
    });
    expect(buyPlace(buy('Hurston', 'Hurston', 1))?.planet).toBeNull();
    expect(buyPlace(buy(null, null, 1))).toBeNull();
  });

  it('keeps the cheapest shop per place, with its terminal', () => {
    const out = toNeedSources([buy('Area 18', 'ArcCorp', 100), buy('Area 18', 'ArcCorp', 200), buy('Lorville', 'Hurston', 150)]);
    expect(out.map((o) => [o.place.location, o.price, o.terminal])).toEqual([
      ['Area 18', 100, 'Shop Area 18'],
      ['Lorville', 150, 'Shop Lorville'],
    ]);
  });

  it('picks the nearest shop when the position is known, else the cheapest', () => {
    const options = toNeedSources([buy('Area 18', 'ArcCorp', 100), buy('Lorville', 'Hurston', 150)]);
    expect(bestSource(options, null)?.place.location).toBe('Area 18');
    expect(bestSource(options, placeOfName('Everus Harbor'))?.place.location).toBe('Lorville');
    expect(bestSource([], null)).toBeNull();
  });

  it('lists the nearest shops first when the position is known', () => {
    const options = toNeedSources([buy('Area 18', 'ArcCorp', 100), buy('Lorville', 'Hurston', 150)]);
    expect(sourcesByDistance(options, placeOfName('Everus Harbor')).map((o) => o.place.location)).toEqual(['Lorville', 'Area 18']);
    expect(sourcesByDistance(options, null).map((o) => o.place.location)).toEqual(['Area 18', 'Lorville']);
  });
});
