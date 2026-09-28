import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RoadmapService } from './roadmap.service';
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

describe('RoadmapService.requestOutlines — transport errors (AUD-096)', () => {
  let svc: RoadmapService;
  let http: HttpTestingController;

  beforeEach(() => {
    spyOn(console, 'warn');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(RoadmapService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  async function failOnce(): Promise<void> {
    const req = http.expectOne((r) => r.url.includes('rsi-roadmap') && r.url.includes('notes='));
    req.error(new ProgressEvent('error'), { status: 0 });
    // Let the batch's finally() and pump() settle.
    await new Promise((r) => setTimeout(r));
  }

  it('keeps a slug requestable after one transport error, files it as missing after the second', async () => {
    svc.requestOutlines(['a']);
    await failOnce();
    expect(svc.isMissing('a')).toBeFalse();
    expect(svc.pending().has('a')).toBeFalse();

    // An explicit ask ("load the rest", opening the row) tries again.
    svc.requestOutlines(['a']);
    await failOnce();
    expect(svc.isMissing('a')).toBeTrue();

    // Now it stays quiet — no third request.
    svc.requestOutlines(['a']);
    http.expectNone((r) => r.url.includes('notes='));
  });
});
