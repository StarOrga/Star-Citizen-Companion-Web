import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { NewsService, VerseNewsItem } from './news.service';
import { ConsentService } from '../core/consent.service';
import type { PatchFacet, PatchNoteEntry } from './patch-notes';
import { matchesTokens } from './patch-search';
import {
  compareVersionsDesc,
  facetCounts,
  filterPatchLines,
  filterPatchLinesByQuery,
  groupPatchNotes,
  groupWaves,
  isHotfixTitle,
  latestPerFacet,
  parsePatchStage,
  parsePatchVersion,
  patchFacetOf,
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

describe('patch facets — one channel per note, so counts add up and nothing shows twice (44e90e30)', () => {
  it('files a hotfix under hotfix, even though its title also says LIVE', () => {
    expect(patchFacetOf('live', true)).toBe('hotfix');
    expect(patchFacetOf('ptu', true)).toBe('hotfix');
  });

  it('otherwise files a note under its ring', () => {
    expect(patchFacetOf('live', false)).toBe('live');
    expect(patchFacetOf('ptu', false)).toBe('ptu');
    expect(patchFacetOf('evocati', false)).toBe('evocati');
  });

  it('parks a note that names no ring at all under "other"', () => {
    expect(patchFacetOf(null, false)).toBe('other');
  });
});

describe('filterPatchLines / latestPerFacet — the patch section filters and its at-a-glance header', () => {
  const news: VerseNewsItem[] = [
    patch('p-410-ptu', '[Wave 1] Star Citizen Alpha 4.10 PTU Patch Notes 12358556', '2026-07-30T00:00:00.000Z'),
    patch('p-49-hotfix', 'Star Citizen Alpha 4.9 LIVE - Hotfix Central (Updated 7.30.2026)', '2026-07-16T00:00:00.000Z'),
    patch('p-49-live', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-15T00:00:00.000Z'),
    patch('p-49-evo', '[Evo NDA] Star Citizen Alpha 4.9 PTU Patch Notes 12107679', '2026-06-20T00:00:00.000Z'),
    patch('p-48-live', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2026-05-13T00:00:00.000Z'),
    patch('p-48-hotfix', 'Star Citizen Alpha 4.8.2 LIVE - Hotfix 12030094', '2026-06-17T00:00:00.000Z'),
  ];
  const groups = groupPatchNotes(news);
  const noFilter = { lines: new Set<string>(), facets: new Set<PatchFacet>() };

  it('returns everything untouched when nothing is selected', () => {
    expect(filterPatchLines(groups, noFilter)).toBe(groups);
  });

  it('narrows to one patch line', () => {
    const only49 = filterPatchLines(groups, { lines: new Set(['4.9']), facets: new Set<PatchFacet>() });
    expect(only49.map((g) => g.line)).toEqual(['4.9']);
    expect(only49[0].entries.length).toBe(3);
  });

  it('narrows to one channel across every line', () => {
    const hotfixes = filterPatchLines(groups, { lines: new Set<string>(), facets: new Set<PatchFacet>(['hotfix']) });
    expect(hotfixes.flatMap((g) => g.entries).map((e) => e.item.id)).toEqual(['p-49-hotfix', 'p-48-hotfix']);
  });

  it('combines both axes and drops lines that keep nothing', () => {
    const ptuIn49 = filterPatchLines(groups, { lines: new Set(['4.9', '4.8']), facets: new Set<PatchFacet>(['evocati']) });
    expect(ptuIn49.map((g) => g.line)).toEqual(['4.9']);
  });

  it('re-dates a narrowed line but never un-badges the build you can play', () => {
    const liveOnly = filterPatchLines(groups, { lines: new Set<string>(), facets: new Set<PatchFacet>(['live']) });
    const line49 = liveOnly.find((g) => g.line === '4.9')!;
    // Newest remaining entry is the release, not the (filtered-out) hotfix.
    expect(line49.latestAt).toBe('2026-07-15T00:00:00.000Z');
    expect(line49.isCurrentLive).toBe(true);
  });

  it('counts every note exactly once across the facets', () => {
    const counts = facetCounts(groups);
    expect(counts.get('live')).toBe(2);
    expect(counts.get('hotfix')).toBe(2);
    expect(counts.get('ptu')).toBe(1);
    expect(counts.get('evocati')).toBe(1);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(news.length);
  });

  it('surfaces the newest note per channel, at most one each', () => {
    const highlights = latestPerFacet(groups);
    expect(highlights.map((h) => h.facet)).toEqual(['live', 'hotfix', 'ptu', 'evocati']);
    expect(highlights.map((h) => h.entry.item.id))
      .toEqual(['p-49-live', 'p-49-hotfix', 'p-410-ptu', 'p-49-evo']);
  });

  it('keeps the header in a fixed order rather than reshuffling on every post', () => {
    // The PTU wave is the newest note overall; it still sits behind LIVE.
    expect(latestPerFacet(groups)[0].facet).toBe('live');
  });

  it('follows the filter, so the header never contradicts the list below it', () => {
    const only48 = filterPatchLines(groups, { lines: new Set(['4.8']), facets: new Set<PatchFacet>() });
    expect(latestPerFacet(only48).map((h) => h.entry.item.id)).toEqual(['p-48-live', 'p-48-hotfix']);
  });

  it('names the line each highlight belongs to', () => {
    expect(latestPerFacet(groups).find((h) => h.facet === 'ptu')!.line).toBe('4.10');
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

  it('keeps patch notes out of the stream — the patch board owns them', () => {
    const svc = makeService();
    svc.feed.set(feed);
    // `c1` carries no artwork, so it cannot take the stage and lands in the
    // stream instead. What matters either way: neither surface ever shows a
    // release note.
    const surfaced = [svc.stage(), ...svc.stream()].filter((n) => !!n);
    expect(surfaced.map((n) => n!.id)).toEqual(['c1']);
    expect(surfaced.some((n) => n!.channel === 'patch')).toBeFalse();
  });

  it('counts them for the board, so the coverage stays visible', () => {
    const svc = makeService();
    svc.feed.set(feed);
    expect(svc.patchCount()).toBe(2);
  });

  it('does not let a saved patch note leak into the favourites view', () => {
    const svc = makeService();
    svc.feed.set(feed);
    svc.toggleFavorite('p-49-live');
    svc.setFavoritesOnly(true);
    // Saving a release note is allowed; the stream is editorial-only, so it
    // surfaces on the board rather than here. The point is that "Gemerkt" can
    // never resurrect the 70 % of the feed the rethink moved off this page.
    expect(svc.stream().map((n) => n.id)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('groupWaves — one announcement, many build waves (2026-08-20 rethink)', () => {
  function entry(id: string, version: string, facet: PatchFacet): PatchNoteEntry {
    return {
      item: {
        id,
        title: `[All Waves] Star Citizen Alpha ${version} PTU Patch Notes ${id}`,
        url: `https://robertsspaceindustries.com/${id}`,
        publishedAt: '2026-07-31T09:00:00.000Z',
        channel: 'patch',
        source: 'patch-notes',
      },
      version,
      segments: version.split('.').map(Number),
      stage: facet === 'ptu' ? 'ptu' : 'live',
      hotfix: facet === 'hotfix',
      facet,
    };
  }

  it('folds a run of same-version, same-facet notes into one group', () => {
    const waves = groupWaves([
      entry('a', '4.10', 'ptu'),
      entry('b', '4.10', 'ptu'),
      entry('c', '4.10', 'ptu'),
    ]);
    expect(waves.length).toBe(1);
    expect(waves[0].folded).toBeTrue();
    expect(waves[0].entries.length).toBe(3);
  });

  it('leaves a short run unfolded — two rows are cheaper than a disclosure', () => {
    const waves = groupWaves([entry('a', '4.10', 'ptu'), entry('b', '4.10', 'ptu')]);
    expect(waves.length).toBe(1);
    expect(waves[0].folded).toBeFalse();
  });

  it('never folds across a facet or a version boundary', () => {
    const waves = groupWaves([
      entry('a', '4.10', 'ptu'),
      entry('b', '4.10', 'live'),
      entry('c', '4.9', 'ptu'),
    ]);
    expect(waves.map((w) => w.entries.length)).toEqual([1, 1, 1]);
  });

  it('only folds CONSECUTIVE runs, so an interleaved note keeps its own row', () => {
    const waves = groupWaves([
      entry('a', '4.10', 'ptu'),
      entry('b', '4.10', 'ptu'),
      entry('x', '4.10', 'hotfix'),
      entry('c', '4.10', 'ptu'),
    ]);
    expect(waves.map((w) => w.facet)).toEqual(['ptu', 'hotfix', 'ptu']);
    expect(waves[2].entries.map((e) => e.item.id)).toEqual(['c']);
  });

  it('keeps every entry — folding hides rows, it never drops data', () => {
    const entries = ['a', 'b', 'c', 'd'].map((id) => entry(id, '4.10', 'ptu'));
    const total = groupWaves(entries).reduce((n, w) => n + w.entries.length, 0);
    expect(total).toBe(entries.length);
  });
});

describe('filterPatchLinesByQuery — the third axis (961ab0a5)', () => {
  const news: VerseNewsItem[] = [
    patch('p-410-ptu', '[Wave 1] Star Citizen Alpha 4.10 PTU Patch Notes 12358556', '2026-07-30T00:00:00.000Z'),
    patch('p-49-live', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-15T00:00:00.000Z'),
    patch('p-48-live', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2026-05-13T00:00:00.000Z'),
  ];
  const groups = groupPatchNotes(news);

  /** Stand-in for the real one: title, plus "bullet points" for one note only. */
  const haystack = (e: PatchNoteEntry): string =>
    e.item.id === 'p-49-live' ? `${e.item.title}\nOrison instancing improvements` : e.item.title;

  it('returns everything untouched when the query is empty', () => {
    expect(filterPatchLinesByQuery(groups, [], haystack, matchesTokens)).toBe(groups);
  });

  it('finds a note by its title', () => {
    const out = filterPatchLinesByQuery(groups, ['ptu'], haystack, matchesTokens);
    expect(out.flatMap((g) => g.entries).map((e) => e.item.id)).toEqual(['p-410-ptu']);
  });

  it('finds a note by a bullet point the title never mentions', () => {
    const out = filterPatchLinesByQuery(groups, ['orison'], haystack, matchesTokens);
    expect(out.flatMap((g) => g.entries).map((e) => e.item.id)).toEqual(['p-49-live']);
  });

  it('keeps a whole line when the LINE NAME matches — typing "4.9" asks for 4.9', () => {
    const out = filterPatchLinesByQuery(groups, ['4.9'], haystack, matchesTokens);
    expect(out.map((g) => g.line)).toEqual(['4.9']);
    expect(out[0].entries.length).toBe(1);
  });

  it('drops lines that keep no note', () => {
    expect(filterPatchLinesByQuery(groups, ['pyro'], haystack, matchesTokens)).toEqual([]);
  });

  it('carries the LIVE facts over unchanged — search does not rewrite what you can play', () => {
    const before = groups.find((g) => g.isCurrentLive)!;
    const after = filterPatchLinesByQuery(groups, ['release'], haystack, matchesTokens)
      .find((g) => g.line === before.line)!;
    expect(after.isCurrentLive).toBe(true);
    expect(after.hasLive).toBe(before.hasLive);
  });
});
