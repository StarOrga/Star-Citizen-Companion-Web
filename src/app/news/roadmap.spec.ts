import {
  RoadmapCard,
  RoadmapPayload,
  RoadmapRelease,
  groupCardsByCategory,
  hasRoadmapContent,
  statusCounts,
} from './roadmap';

function card(id: string, category: string, status: RoadmapCard['status'] = 'committed'): RoadmapCard {
  return {
    id,
    slug: id,
    name: `Card ${id}`,
    description: '',
    body: '',
    status,
    category,
    thumbnail: null,
  };
}

function release(name: string, cards: RoadmapCard[]): RoadmapRelease {
  return { id: name, name, quarter: 'Q3 2026', status: 'committed', patchLine: name, cards };
}

function payload(over: Partial<RoadmapPayload> = {}): RoadmapPayload {
  return {
    current: null,
    next: null,
    later: [],
    liveVersion: '',
    ptuVersion: '',
    boardUrl: 'https://robertsspaceindustries.com/roadmap/board/1-Release-View',
    updatedAt: '',
    ...over,
  };
}

describe('groupCardsByCategory', () => {
  it('groups by discipline, alphabetically', () => {
    const groups = groupCardsByCategory([
      card('a', 'Ships and Vehicles'),
      card('b', 'Gameplay'),
      card('c', 'Ships and Vehicles'),
    ]);
    expect(groups.map((g) => g.category)).toEqual(['Gameplay', 'Ships and Vehicles']);
    expect(groups[1].cards.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('puts the uncategorized bucket last, never first', () => {
    const groups = groupCardsByCategory([card('a', ''), card('b', 'Gameplay')]);
    expect(groups.map((g) => g.category)).toEqual(['Gameplay', '']);
  });

  it('keeps the source order inside a group', () => {
    const groups = groupCardsByCategory([card('z', 'Core Tech'), card('y', 'Core Tech')]);
    expect(groups[0].cards.map((c) => c.id)).toEqual(['z', 'y']);
  });

  it('loses no card', () => {
    const cards = [card('a', 'X'), card('b', ''), card('c', 'Y'), card('d', 'X')];
    const total = groupCardsByCategory(cards).reduce((n, g) => n + g.cards.length, 0);
    expect(total).toBe(cards.length);
  });

  it('handles an empty release', () => {
    expect(groupCardsByCategory([])).toEqual([]);
  });
});

describe('statusCounts', () => {
  it('tallies each status', () => {
    const counts = statusCounts([
      card('a', 'X', 'released'),
      card('b', 'X', 'committed'),
      card('c', 'X', 'committed'),
    ]);
    expect(counts.get('released')).toBe(1);
    expect(counts.get('committed')).toBe(2);
    expect(counts.get('tentative')).toBeUndefined();
  });
});

describe('hasRoadmapContent — the band shows itself only when it has something to say', () => {
  it('is false without a payload', () => {
    expect(hasRoadmapContent(null)).toBe(false);
  });

  it('is false when both releases are missing or empty', () => {
    expect(hasRoadmapContent(payload())).toBe(false);
    expect(hasRoadmapContent(payload({ current: release('4.9', []) }))).toBe(false);
  });

  it('is true as soon as either release carries a card', () => {
    expect(hasRoadmapContent(payload({ current: release('4.9', [card('a', 'X')]) }))).toBe(true);
    expect(hasRoadmapContent(payload({ next: release('4.10', [card('b', 'X')]) }))).toBe(true);
  });
});
