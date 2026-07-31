import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { NewsService, VerseNewsItem } from './news.service';
import { ConsentService } from '../core/consent.service';
import {
  compareVersionsDesc,
  groupPatchNotes,
  isHotfixTitle,
  parsePatchStage,
  parsePatchVersion,
  patchLineOf,
} from './patch-notes';

function patch(id: string, title: string, publishedAt: string): VerseNewsItem {
  return {
    id,
    title,
    url: `https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/${id}`,
    publishedAt,
    channel: 'patch',
    source: 'patch-notes',
  };
}

describe('parsePatchVersion — versions come from the data, never a hardcoded list (44e90e30)', () => {
  it('reads the version RSI writes after "Alpha"', () => {
    expect(parsePatchVersion('Star Citizen Alpha 4.9 LIVE Release Notes')).toBe('4.9');
    expect(parsePatchVersion('[Wave 1] Star Citizen Alpha 4.10 PTU Patch Notes 12358556')).toBe('4.10');
    expect(parsePatchVersion('Star Citizen Alpha 4.8.2 LIVE - Hotfix 12030094')).toBe('4.8.2');
    expect(parsePatchVersion('[All Backer PTU] Star Citizen Alpha 4.6.0 PTU 11135423 Patch Notes')).toBe('4.6.0');
  });

  it('picks up a line that does not exist yet — no code change for 4.11 or 5.0', () => {
    expect(parsePatchVersion('Star Citizen Alpha 4.11 LIVE Release Notes')).toBe('4.11');
    expect(parsePatchVersion('Star Citizen Alpha 5.0 LIVE Release Notes')).toBe('5.0');
  });

  it('ignores the build number, which is what a naive digit match would grab', () => {
    expect(parsePatchVersion('Star Citizen 12358556 Patch Notes')).toBe('');
  });

  it('ignores dates in the title — an "(Updated 7.30.2026)" hotfix stays on its own line', () => {
    expect(parsePatchVersion('Star Citizen Alpha 4.9 LIVE - Hotfix Central (Updated 7.30.2026)')).toBe('4.9');
    expect(parsePatchVersion('Hotfix Central (Updated 7.30.2026)')).toBe('');
  });

  it('returns an empty string when there is nothing version-shaped', () => {
    expect(parsePatchVersion('Patch Notes')).toBe('');
  });
});

describe('patch line + ordering', () => {
  it('folds a point release into its main line', () => {
    expect(patchLineOf('4.8.2')).toBe('4.8');
    expect(patchLineOf('4.6.0')).toBe('4.6');
    expect(patchLineOf('4.9')).toBe('4.9');
  });

  it('compares segments numerically — 4.10 is NEWER than 4.9', () => {
    expect(compareVersionsDesc([4, 10], [4, 9])).toBeLessThan(0);
    expect(compareVersionsDesc([4, 9], [4, 10])).toBeGreaterThan(0);
    expect(compareVersionsDesc([5, 0], [4, 11])).toBeLessThan(0);
  });

  it('treats a missing segment as zero (4.9 === 4.9.0)', () => {
    expect(compareVersionsDesc([4, 9], [4, 9, 0])).toBe(0);
    expect(compareVersionsDesc([4, 9, 1], [4, 9])).toBeLessThan(0);
  });
});

describe('parsePatchStage / isHotfixTitle', () => {
  it('names the release ring', () => {
    expect(parsePatchStage('Star Citizen Alpha 4.9 LIVE Release Notes')).toBe('live');
    expect(parsePatchStage('[Wave 1] Star Citizen Alpha 4.10 PTU Patch Notes')).toBe('ptu');
  });

  it('prefers the NDA ring when a title says both ("[Evo NDA] … PTU")', () => {
    expect(parsePatchStage('[Evo NDA] Star Citizen Alpha 4.9 PTU Patch Notes 12107679')).toBe('evocati');
    expect(parsePatchStage('[ETF NDA] Star Citizen Alpha 4.7 PTU Patch Notes')).toBe('evocati');
  });

  it('flags hotfix threads separately from the ring', () => {
    const title = 'Star Citizen Alpha 4.9 LIVE - Hotfix Central (Updated 7.30.2026)';
    expect(parsePatchStage(title)).toBe('live');
    expect(isHotfixTitle(title)).toBe(true);
    expect(isHotfixTitle('Star Citizen Alpha 4.9 LIVE Release Notes')).toBe(false);
  });
});

describe('groupPatchNotes — newest main patch on top, small patches nested (44e90e30)', () => {
  const news: VerseNewsItem[] = [
    patch('p-49-live', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-15T00:00:00.000Z'),
    patch('p-410-ptu', '[Wave 1] Star Citizen Alpha 4.10 PTU Patch Notes 12358556', '2026-07-30T00:00:00.000Z'),
    patch('p-482', 'Star Citizen Alpha 4.8.2 LIVE - Hotfix 12030094', '2026-06-17T00:00:00.000Z'),
    patch('p-49-hotfix', 'Star Citizen Alpha 4.9 LIVE - Hotfix Central (Updated 7.30.2026)', '2026-07-16T00:00:00.000Z'),
    patch('p-48-live', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2026-05-13T00:00:00.000Z'),
    patch('p-49-ptu', '[All Waves] Star Citizen Alpha 4.9 PTU RC1 Patch Notes 12218630', '2026-07-14T00:00:00.000Z'),
    {
      ...patch('c1', 'This Week in Star Citizen', '2026-07-27T00:00:00.000Z'),
      channel: 'comm-link',
      source: 'comm-link',
    },
  ];

  it('orders lines numerically, newest first — 4.10 above 4.9, not below it', () => {
    expect(groupPatchNotes(news).map((g) => g.line)).toEqual(['4.10', '4.9', '4.8']);
  });

  it('nests every entry of a line under it, newest first', () => {
    const line49 = groupPatchNotes(news).find((g) => g.line === '4.9')!;
    expect(line49.entries.map((e) => e.item.id)).toEqual(['p-49-hotfix', 'p-49-live', 'p-49-ptu']);
  });

  it('files a point release under its main line rather than opening a new one', () => {
    const line48 = groupPatchNotes(news).find((g) => g.line === '4.8')!;
    expect(line48.entries.map((e) => e.version)).toEqual(['4.8.2', '4.8']);
  });

  it('marks the line that has reached LIVE and dates it by its newest entry', () => {
    const [newest, live] = groupPatchNotes(news);
    expect(newest.hasLive).toBe(false); // 4.10 is PTU only
    expect(live.hasLive).toBe(true);
    expect(live.latestAt).toBe('2026-07-16T00:00:00.000Z');
  });

  it('calls exactly one line "currently live" — the newest that shipped, not every past one', () => {
    const groups = groupPatchNotes(news);
    expect(groups.filter((g) => g.isCurrentLive).map((g) => g.line)).toEqual(['4.9']);
    // 4.8 reached LIVE once too, but that is history, not the played build.
    expect(groups.find((g) => g.line === '4.8')!.hasLive).toBe(true);
  });

  it('claims no live line at all while only PTU notes exist', () => {
    const ptuOnly = groupPatchNotes([
      patch('a', '[Wave 1] Star Citizen Alpha 4.10 PTU Patch Notes 12358556', '2026-07-30T00:00:00.000Z'),
    ]);
    expect(ptuOnly.some((g) => g.isCurrentLive)).toBe(false);
  });

  it('ignores everything that is not a patch note', () => {
    const all = groupPatchNotes(news).flatMap((g) => g.entries);
    expect(all.some((e) => e.item.id === 'c1')).toBe(false);
    expect(all.length).toBe(6);
  });

  it('keeps unversioned notes visible, parked in a trailing group', () => {
    const groups = groupPatchNotes([...news, patch('p-x', 'Patch Notes', '2026-07-31T00:00:00.000Z')]);
    expect(groups.map((g) => g.line)).toEqual(['4.10', '4.9', '4.8', '']);
  });

  it('returns nothing when the feed has no patch notes at all', () => {
    expect(groupPatchNotes([])).toEqual([]);
  });
});

describe('NewsService — patch notes live in their own section, not in the time buckets', () => {
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

  const feed = {
    status: null,
    fetchedAt: '2026-07-31T12:00:00.000Z',
    news: [
      {
        ...patch('c1', 'This Week in Star Citizen', '2026-07-31T10:00:00.000Z'),
        channel: 'comm-link' as const,
        source: 'comm-link' as const,
      },
      patch('p-49-live', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-31T09:00:00.000Z'),
      patch('p-410-ptu', 'Star Citizen Alpha 4.10 PTU Patch Notes 12358556', '2026-07-31T08:00:00.000Z'),
    ],
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('groups the feed into patch lines', () => {
    const svc = makeService();
    svc.feed.set(feed);
    expect(svc.patchLines().map((g) => g.line)).toEqual(['4.10', '4.9']);
  });

  it('keeps patch notes out of the default stream', () => {
    const svc = makeService();
    svc.feed.set(feed);
    const shown = [...svc.bucketed().today, ...svc.bucketed().week, ...svc.bucketed().older];
    expect(shown.map((n) => n.id)).toEqual(['c1']);
  });

  it('keeps them out of the stream with the Patch-Notes chip on, too — the section owns them', () => {
    const svc = makeService();
    svc.feed.set(feed);
    svc.toggleChannel('patch');
    const shown = [...svc.bucketed().today, ...svc.bucketed().week, ...svc.bucketed().older];
    expect(shown).toEqual([]);
    expect(svc.patchLines().length).toBe(2);
  });

  it('still counts them for the filter chip, so the coverage is visible', () => {
    const svc = makeService();
    svc.feed.set(feed);
    expect(svc.channelCount('patch')).toBe(2);
  });

  it('still shows a saved patch note in the favourites view', () => {
    const svc = makeService();
    svc.feed.set(feed);
    svc.toggleFavorite('p-49-live');
    svc.toggleFavoritesOnly();
    const shown = [...svc.bucketed().today, ...svc.bucketed().week, ...svc.bucketed().older];
    expect(shown.map((n) => n.id)).toEqual(['p-49-live']);
  });
});
