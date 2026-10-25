import { themesFirst } from '../verse-briefing.component';

describe('themesFirst', () => {
  it('leads with the first item of each kind and keeps the rest in order', () => {
    const items = [
      { kind: 'gallery', id: 1 },
      { kind: 'gallery', id: 2 },
      { kind: 'patch', id: 3 },
      { kind: 'gallery', id: 4 },
      { kind: 'news', id: 5 },
    ];
    expect(themesFirst(items).map((i) => i.id)).toEqual([1, 3, 5, 2, 4]);
  });

  it('returns an empty list unchanged', () => {
    expect(themesFirst([])).toEqual([]);
  });
});
