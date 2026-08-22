import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import {
  NewsService,
  VerseNewsItem,
  NewsChannel,
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
    // Artwork, because the stage only considers items that bring some — the
    // retention specs below never look at it.
    thumbnail: `https://example.test/${id}.jpg`,
  };
}

/** Hours before "now", so the stage/stream specs do not drift with the clock. */
function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

// A spread of channels with videos deliberately out of chronological order so
// the sort is actually exercised. Timestamps are relative to the current clock
// because the stage scores on recency.
function sampleFeed() {
  return {
    status: null,
    fetchedAt: new Date().toISOString(),
    news: [
      item('c1', 'comm-link', hoursAgo(1)),
      item('v-old', 'youtube', hoursAgo(100)),
      item('v-new', 'youtube', hoursAgo(2)),
      item('s1', 'spectrum', hoursAgo(28)),
      item('v-mid', 'youtube', hoursAgo(50)),
    ],
  };
}

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

describe('NewsService — videos are stream items (2026-08-20 rethink)', () => {
  function makeService(): NewsService {
    TestBed.configureTestingModule({
      providers: [
        NewsService,
        { provide: HttpClient, useValue: {} },
        { provide: ConsentService, useValue: { preferencesAllowed: () => true } },
      ],
    });
    return TestBed.inject(NewsService);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  // The rail was a 297 px band that, measured in production on 2026-08-20, held
  // exactly ONE clip. Videos are ordinary stream items now — and, being the
  // highest-weighted channel, the likeliest thing to carry the stage.
  it('lists videos in the stream alongside articles, newest first', () => {
    const svc = makeService();
    svc.feed.set(sampleFeed());
    // v-new takes the stage: two hours old and the highest-weighted channel.
    // The rest stays strictly reverse-chronological.
    expect(svc.stage()?.id).toBe('v-new');
    expect(svc.stream().map((n) => n.id)).toEqual(['c1', 's1', 'v-mid', 'v-old']);
  });

  it('never shows the staged item twice', () => {
    const svc = makeService();
    svc.feed.set(sampleFeed());
    const staged = svc.stage()!.id;
    expect(svc.stream().some((n) => n.id === staged)).toBeFalse();
  });

  it('keeps a video eligible for the stage', () => {
    const svc = makeService();
    svc.feed.set({
      status: null,
      fetchedAt: new Date().toISOString(),
      news: [item('v', 'youtube', hoursAgo(3)), item('c', 'comm-link', hoursAgo(80))],
    });
    expect(svc.stage()?.id).toBe('v');
  });
});
