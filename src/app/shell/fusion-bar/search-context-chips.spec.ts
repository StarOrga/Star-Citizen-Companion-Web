import { sectionChip, searchContextOf } from './search-context';

describe('search context chips (C1, C2)', () => {
  const ids = (url: string, hq: Parameters<typeof searchContextOf>[1] = null, section: string | null = null) =>
    searchContextOf(url, hq, section).chips.map((c) => c.id);

  it('a Codex index page makes a switchable kind chip that filters to that kind', () => {
    const [chip] = searchContextOf('/codex/index?kind=weapon').chips;
    expect(chip.source).toBe('route');
    expect(chip.filter.groups).toEqual(['weapon']);
    expect(chip.switchable).toBe(true);
    expect(chip.options!.length).toBeGreaterThan(5);
  });

  it('the page section from the #anchor becomes a chip (no longer stripped)', () => {
    expect(ids('/codex/ship/AEGS_Gladius#bewaffnung')).toEqual(['route:compat:ship', 'section:weapons']);
    expect(searchContextOf('/codex/ship/AEGS_Gladius#komponenten').chips[1].filter.groups).toEqual(['component']);
  });

  it('an explicit section id wins over the anchor', () => {
    expect(ids('/codex/ship/X#bewaffnung', null, 'komponenten')).toContain('section:components');
  });

  it('anchors that show no kind of data add no chip', () => {
    expect(ids('/codex/ship/X#stabilitaet')).toEqual(['route:compat:ship']);
  });

  it('a ship page names the ship for the fit badge without filtering', () => {
    const [chip] = searchContextOf('/codex/ship/AEGS_Gladius').chips;
    expect(chip.filter).toEqual({ compatWith: { kind: 'ship', className: 'AEGS_Gladius' } });
  });

  it('HQ sub pages and the Bestand page carry own-data chips', () => {
    expect(searchContextOf('/hq/hangar').chips[0].filter.ownKinds).toEqual(['ship', 'config']);
    expect(searchContextOf('/hq', 'inventar').chips[0].filter.ownKinds).toEqual(['item']);
    expect(searchContextOf('/hq/locker').chips[0].filter.ownKinds).toEqual(['set']);
  });

  it('a route chip and the same section are one chip', () => {
    expect(ids('/hq/hangar#hangar')).toEqual(['route:hangar']);
  });

  it('the gallery page filters to gallery images', () => {
    expect(searchContextOf('/verse/gallery').chips[0].filter.groups).toEqual(['gallery']);
  });

  it('sectionChip knows nothing about unknown anchors', () => {
    expect(sectionChip('sets')?.filter.ownKinds).toEqual(['set']);
    expect(sectionChip('whatever')).toBeNull();
    expect(sectionChip('')).toBeNull();
  });
});
