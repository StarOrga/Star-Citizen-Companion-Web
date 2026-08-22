import type { VerseNewsItem, NewsChannel } from './news.service';
import type { PatchLineGroup } from './patch-notes';
import { groupPatchNotes } from './patch-notes';
import { buildStream, buildVerdict, pickStage, stageEligible, stageScore } from './news-stage';

/**
 * The stage is the fix for the defect this whole rethink started from: measured
 * in production on 2026-08-20, Verse News rendered NO hero at all, because the
 * hero was defined as "first item of the Today bucket" and that bucket was
 * empty. These specs pin the property that replaces it — the stage resolves
 * whenever the feed holds a single usable item, regardless of its age.
 */

const NOW = Date.parse('2026-08-20T18:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

function item(
  id: string,
  channel: NewsChannel,
  publishedAt: string,
  over: Partial<VerseNewsItem> = {},
): VerseNewsItem {
  return {
    id,
    title: `Item ${id}`,
    url: `https://example.test/${id}`,
    publishedAt,
    channel,
    source: channel === 'youtube' ? 'youtube' : 'comm-link',
    thumbnail: `https://example.test/${id}.jpg`,
    ...over,
  };
}

describe('pickStage — the entry can never be empty (2026-08-20 rethink)', () => {
  it('picks the freshest item on a busy day', () => {
    const news = [
      item('old', 'comm-link', daysAgo(6)),
      item('fresh', 'comm-link', daysAgo(0.2)),
      item('mid', 'comm-link', daysAgo(2)),
    ];
    expect(pickStage(news, NOW)?.id).toBe('fresh');
  });

  // The regression this module exists for: the old hero was bound to a "Today"
  // bucket, so a day with nothing newer than yesterday produced no hero at all.
  it('still fills the stage when NOTHING is from today', () => {
    const news = [item('a', 'comm-link', daysAgo(9)), item('b', 'spectrum', daysAgo(13))];
    expect(pickStage(news, NOW)?.id).toBe('a');
  });

  it('still fills the stage when everything is older than the scoring window', () => {
    // Every candidate scores 0 here, so the tie-break carries it — which is
    // exactly the quiet-day behaviour: the newest thing that exists.
    const news = [item('ancient', 'comm-link', daysAgo(400)), item('older', 'comm-link', daysAgo(900))];
    expect(pickStage(news, NOW)?.id).toBe('ancient');
  });

  it('weights a video above an article of the same age', () => {
    const news = [item('a', 'comm-link', daysAgo(1)), item('v', 'youtube', daysAgo(1))];
    expect(pickStage(news, NOW)?.id).toBe('v');
  });

  it('does not let the channel weight beat real freshness', () => {
    // A three-week-old video must not outrank today's article — the spread
    // between the channel weights is deliberately narrow.
    const news = [item('a', 'comm-link', daysAgo(0)), item('v', 'youtube', daysAgo(21))];
    expect(pickStage(news, NOW)?.id).toBe('a');
  });

  it('skips items that bring no artwork — the stage would render as a hole', () => {
    const news = [
      item('no-art', 'spectrum', daysAgo(0), { thumbnail: undefined, images: undefined }),
      item('art', 'comm-link', daysAgo(5)),
    ];
    expect(pickStage(news, NOW)?.id).toBe('art');
  });

  it('accepts an item whose artwork comes as an images array', () => {
    const only = item('gallery', 'comm-link', daysAgo(1), {
      thumbnail: undefined,
      images: ['https://example.test/a.jpg'],
    });
    expect(stageEligible(only)).toBeTrue();
    expect(pickStage([only], NOW)?.id).toBe('gallery');
  });

  it('never stages a patch note — those belong to the patch board', () => {
    const news = [item('p', 'patch', daysAgo(0)), item('c', 'comm-link', daysAgo(10))];
    expect(pickStage(news, NOW)?.id).toBe('c');
  });

  it('returns null only when there is genuinely nothing to show', () => {
    expect(pickStage([], NOW)).toBeNull();
    expect(pickStage([item('x', 'patch', daysAgo(0))], NOW)).toBeNull();
  });

  it('scores an unparseable date as zero rather than NaN', () => {
    expect(stageScore(item('broken', 'comm-link', 'not-a-date'), NOW)).toBe(0);
  });
});

describe('buildStream', () => {
  it('is flat, reverse-chronological and excludes the staged item', () => {
    const news = [
      item('b', 'comm-link', daysAgo(2)),
      item('a', 'comm-link', daysAgo(1)),
      item('c', 'spectrum', daysAgo(3)),
    ];
    const stage = pickStage(news, NOW)!;
    expect(stage.id).toBe('a');
    expect(buildStream(news, stage).map((n) => n.id)).toEqual(['b', 'c']);
  });

  it('keeps patch notes out entirely', () => {
    const news = [item('p', 'patch', daysAgo(0)), item('c', 'comm-link', daysAgo(1))];
    expect(buildStream(news, null).map((n) => n.id)).toEqual(['c']);
  });

  it('keeps items without artwork — only the STAGE needs a picture', () => {
    const news = [
      item('plain', 'spectrum', daysAgo(1), { thumbnail: undefined, images: undefined }),
      item('art', 'comm-link', daysAgo(2)),
    ];
    const stage = pickStage(news, NOW)!;
    expect(stage.id).toBe('art');
    expect(buildStream(news, stage).map((n) => n.id)).toEqual(['plain']);
  });
});

describe('buildVerdict — the one sentence the landing page owes the reader', () => {
  function note(id: string, title: string, publishedAt: string): VerseNewsItem {
    return {
      id,
      title,
      url: `https://robertsspaceindustries.com/${id}`,
      publishedAt,
      channel: 'patch',
      source: 'patch-notes',
    };
  }

  function groups(): PatchLineGroup[] {
    return groupPatchNotes([
      note('l1', 'Star Citizen Alpha 4.8 LIVE Release Notes', daysAgo(120)),
      note('l2', 'Star Citizen Alpha 4.9 LIVE Release Notes', daysAgo(60)),
      note('p1', 'Star Citizen Alpha 4.9 PTU Patch Notes 11000001', daysAgo(80)),
      note('p2', 'Star Citizen Alpha 4.10 PTU Patch Notes 12479687', daysAgo(20)),
    ]);
  }

  it('names the line you can actually play', () => {
    expect(buildVerdict(groups(), NOW).liveLine).toBe('4.9');
  });

  it('names the line currently in testing', () => {
    expect(buildVerdict(groups(), NOW).testLine).toBe('4.10');
  });

  it('reports an overdue patch as a negative day count, not as "soon"', () => {
    // 4.10 entered the PTU 20 days ago and the median lead time here is 20 days,
    // so the estimate sits on today; push the clock a week on and it must read
    // as overdue rather than silently rounding to zero.
    const v = buildVerdict(groups(), NOW + 7 * DAY);
    expect(v.daysUntilLive).not.toBeNull();
    expect(v.daysUntilLive!).toBeLessThan(0);
  });

  it('always carries the sample count behind the estimate', () => {
    const v = buildVerdict(groups(), NOW);
    expect(v.medianDays).not.toBeNull();
    expect(v.samples).not.toBeNull();
    expect(v.samples!).toBeGreaterThan(0);
  });

  it('degrades to an empty verdict rather than inventing a date', () => {
    const v = buildVerdict([], NOW);
    expect(v.liveLine).toBe('');
    expect(v.nextLiveAt).toBeNull();
    expect(v.daysUntilLive).toBeNull();
  });
});
