import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import {
  NewsService,
  VerseNewsItem,
  NewsChannel,
  pickRecentVideos,
  pruneExpiredVideos,
  VIDEO_RETENTION_DAYS,
} from './news.service';
import { ConsentService } from '../core/consent.service';

function item(id: string, channel: NewsChannel, publishedAt: string): VerseNewsItem {
  return {
    id,
    title: `Item ${id}`,
    url: `https://example.test/${id}`,
    publishedAt,
    channel,
    source: channel === 'youtube' ? 'youtube' : 'comm-link',
  };
}

// A spread of channels with videos deliberately out of chronological order so
// the sort is actually exercised.
function sampleFeed() {
  return {
    status: null,
    fetchedAt: '2026-07-24T12:00:00.000Z',
    news: [
      item('c1', 'comm-link', '2026-07-24T11:00:00.000Z'),
      item('v-old', 'youtube', '2026-07-20T09:00:00.000Z'),
      item('v-new', 'youtube', '2026-07-24T10:00:00.000Z'),
      item('s1', 'spectrum', '2026-07-23T08:00:00.000Z'),
      item('v-mid', 'youtube', '2026-07-22T09:00:00.000Z'),
    ],
  };
}

describe('pickRecentVideos (#146)', () => {
  const vids = [
    item('a', 'youtube', '2026-07-24T00:00:00.000Z'),
    item('b', 'youtube', '2026-07-23T00:00:00.000Z'),
    item('c', 'youtube', '2026-07-22T00:00:00.000Z'),
  ];

  it('returns the unwatched videos, capped at the limit', () => {
    const out = pickRecentVideos(vids, new Set(), 2);
    expect(out.map((v) => v.id)).toEqual(['a', 'b']);
  });

  it('excludes watched videos', () => {
    const out = pickRecentVideos(vids, new Set(['a']), 5);
    expect(out.map((v) => v.id)).toEqual(['b', 'c']);
  });

  it('falls back to the newest videos when every candidate is watched, so the rail never blanks', () => {
    const out = pickRecentVideos(vids, new Set(['a', 'b', 'c']), 2);
    expect(out.map((v) => v.id)).toEqual(['a', 'b']);
  });

  it('returns an empty list when there are no videos at all', () => {
    expect(pickRecentVideos([], new Set(), 5)).toEqual([]);
  });
});

describe('pruneExpiredVideos — video retention window (e7082310)', () => {
  const NOW = Date.parse('2026-07-28T12:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;
  const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

  it('keeps videos from today, this week and this month', () => {
    const kept = pruneExpiredVideos(
      [
        item('today', 'youtube', ago(0)),
        item('week', 'youtube', ago(4)),
        item('month', 'youtube', ago(28)),
      ],
      NOW,
    );
    expect(kept.map((v) => v.id)).toEqual(['today', 'week', 'month']);
  });

  it('drops videos older than the retention window', () => {
    const kept = pruneExpiredVideos(
      [item('fresh', 'youtube', ago(1)), item('ancient', 'youtube', ago(VIDEO_RETENTION_DAYS + 2))],
      NOW,
    );
    expect(kept.map((v) => v.id)).toEqual(['fresh']);
  });

  it('never touches non-video news, however old', () => {
    const old = [
      item('c-old', 'comm-link', ago(400)),
      item('s-old', 'spectrum', ago(400)),
      item('p-old', 'patch', ago(400)),
    ];
    expect(pruneExpiredVideos(old, NOW).map((n) => n.id)).toEqual(['c-old', 's-old', 'p-old']);
  });

  it('drops a video with an unparseable publish date', () => {
    expect(pruneExpiredVideos([item('broken', 'youtube', 'not-a-date')], NOW)).toEqual([]);
  });
});

describe('NewsService — videos + watched tracking (#146)', () => {
  let consentAllowed: boolean;

  function makeService(): NewsService {
    consentAllowed = true;
    TestBed.configureTestingModule({
      providers: [
        NewsService,
        { provide: HttpClient, useValue: {} },
        { provide: ConsentService, useValue: { preferencesAllowed: () => consentAllowed } },
      ],
    });
    return TestBed.inject(NewsService);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('allVideos lists only youtube items, newest first', () => {
    const svc = makeService();
    svc.feed.set(sampleFeed());
    expect(svc.allVideos().map((v) => v.id)).toEqual(['v-new', 'v-mid', 'v-old']);
  });

  it('bucketed drops videos from the default "Alle" view (they live in the rail)', () => {
    const svc = makeService();
    svc.feed.set(sampleFeed());
    const shown = [...svc.bucketed().today, ...svc.bucketed().week, ...svc.bucketed().older];
    expect(shown.some((n) => n.channel === 'youtube')).toBe(false);
    expect(shown.some((n) => n.id === 'c1')).toBe(true);
  });

  it('bucketed still lists videos when the YouTube channel is explicitly selected', () => {
    const svc = makeService();
    svc.feed.set(sampleFeed());
    svc.toggleChannel('youtube');
    const shown = [...svc.bucketed().today, ...svc.bucketed().week, ...svc.bucketed().older];
    expect(shown.every((n) => n.channel === 'youtube')).toBe(true);
    expect(shown.length).toBe(3);
  });

  it('markWatched is idempotent and reflected by isWatched', () => {
    const svc = makeService();
    expect(svc.isWatched('v-new')).toBe(false);
    svc.markWatched('v-new');
    svc.markWatched('v-new');
    expect(svc.isWatched('v-new')).toBe(true);
    expect(svc.watchedIds().size).toBe(1);
  });

  it('persists watched state to localStorage when preference consent is granted', () => {
    const svc = makeService();
    svc.markWatched('v-new');
    expect(JSON.parse(localStorage.getItem('sc-companion.news.watched')!)).toEqual(['v-new']);
  });

  it('does not persist watched state when preference consent is denied (#130)', () => {
    const svc = makeService();
    consentAllowed = false;
    svc.markWatched('v-new');
    expect(svc.isWatched('v-new')).toBe(true); // in-memory this session
    expect(localStorage.getItem('sc-companion.news.watched')).toBeNull(); // but not written
  });
});
