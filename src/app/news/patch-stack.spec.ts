import type { VerseNewsItem } from './news.service';
import { groupPatchNotes } from './patch-notes';
import { buildPatchStack, previousLiveAt, releaseFor, stackCardFor, stackCards } from './patch-stack';
import type { RoadmapPayload, RoadmapRelease } from './roadmap';

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

function release(patchLine: string, cards = 3): RoadmapRelease {
  return {
    id: `r-${patchLine}`,
    name: patchLine,
    quarter: 'Q3 2026',
    status: 'tentative',
    patchLine,
    cards: Array.from({ length: cards }, (_, i) => ({
      id: `${patchLine}-c${i}`,
      slug: `c${i}`,
      name: `Card ${i}`,
      description: '',
      body: '',
      status: 'tentative' as const,
      category: 'Gameplay',
      thumbnail: null,
    })),
  };
}

function roadmap(current: RoadmapRelease | null, next: RoadmapRelease | null): RoadmapPayload {
  return { current, next, later: [], liveVersion: '', ptuVersion: '', boardUrl: '', updatedAt: '' };
}

const FEED: VerseNewsItem[] = [
  patch('l410', 'Star Citizen Alpha 4.10 LIVE Release Notes', '2026-08-27T18:00:00Z'),
  patch('h410', 'Star Citizen Alpha 4.10 LIVE - Hotfix Central (Updated 9.3.2026)', '2026-09-03T12:00:00Z'),
  patch('p410a', '[All Waves] Star Citizen Alpha 4.10 PTU Patch Notes 12479687', '2026-08-03T10:00:00Z'),
  patch('p410b', '[All Waves] Star Citizen Alpha 4.10 PTU Patch Notes 12504217', '2026-08-25T10:00:00Z'),
  patch('l49', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-09T18:00:00Z'),
  patch('p49', '[Wave 1] Star Citizen Alpha 4.9 PTU Patch Notes 12107679', '2026-06-18T10:00:00Z'),
  patch('l48', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2026-06-12T18:00:00Z'),
  patch('l47', 'Star Citizen Alpha 4.7 LIVE Release Notes', '2026-03-20T18:00:00Z'),
  patch('nov', 'Star Citizen Launcher Patch Notes', '2026-05-01T18:00:00Z'),
];

describe('buildPatchStack — one monotonic stack: next · live · last · older (rethink Ⓚ)', () => {
  it('puts the current live line in the middle, the line it replaced below it, the rest folded', () => {
    const stack = buildPatchStack(groupPatchNotes(FEED), null);
    expect(stack.live?.line).toBe('4.10');
    expect(stack.live?.status).toBe('live');
    expect(stack.last?.line).toBe('4.9');
    expect(stack.last?.status).toBe('superseded');
    expect(stack.older.map((c) => c.line)).toEqual(['4.8', '4.7', '']);
  });

  it('takes the roadmap "next" as the top card when no newer build has been posted', () => {
    const stack = buildPatchStack(groupPatchNotes(FEED), roadmap(release('4.10', 11), release('4.11', 16)));
    expect(stack.next?.line).toBe('4.11');
    expect(stack.next?.status).toBe('next');
    expect(stack.next?.group).toBeNull();
    expect(stack.next?.plannedCount).toBe(16);
    expect(stack.live?.plannedCount).toBe(11);
  });

  it('promotes a line in a test ring above live to the top card, ring by its notes', () => {
    const feed = [
      ...FEED,
      patch('e411', '[Evo NDA] Star Citizen Alpha 4.11 PTU Patch Notes 12600000', '2026-09-10T10:00:00Z'),
    ];
    const stack = buildPatchStack(groupPatchNotes(feed), roadmap(null, release('4.11')));
    expect(stack.next?.line).toBe('4.11');
    expect(stack.next?.status).toBe('evocati');
    expect(stack.next?.group).not.toBeNull();
    expect(stack.next?.release?.patchLine).toBe('4.11');

    const ptu = [...feed, patch('p411', '[Wave 1] Star Citizen Alpha 4.11 PTU Patch Notes 12610000', '2026-09-12T10:00:00Z')];
    expect(buildPatchStack(groupPatchNotes(ptu), null).next?.status).toBe('ptu');
  });

  it('records hotfix, wave and note counts and the live / superseded instants', () => {
    const stack = buildPatchStack(groupPatchNotes(FEED), null);
    expect(stack.live?.hotfixCount).toBe(1);
    expect(stack.live?.lastHotfixAt).toBe(Date.parse('2026-09-03T12:00:00Z'));
    expect(stack.live?.waveCount).toBe(2);
    expect(stack.live?.noteCount).toBe(4);
    expect(stack.live?.liveAt).toBe(Date.parse('2026-08-27T18:00:00Z'));
    expect(stack.live?.firstTestAt).toBe(Date.parse('2026-08-03T10:00:00Z'));
    // 4.9 was replaced the day 4.10 went live; 4.8 the day 4.9 did.
    expect(stack.last?.supersededAt).toBe(Date.parse('2026-08-27T18:00:00Z'));
    expect(stack.older[0].supersededAt).toBe(Date.parse('2026-07-09T18:00:00Z'));
  });

  it('never shows the roadmap "next" twice when it names the live line', () => {
    const stack = buildPatchStack(groupPatchNotes(FEED), roadmap(null, release('4.10')));
    expect(stack.next).toBeNull();
  });

  it('survives an empty feed', () => {
    const stack = buildPatchStack([], roadmap(null, release('4.11')));
    expect(stack.live).toBeNull();
    expect(stack.last).toBeNull();
    expect(stack.next?.line).toBe('4.11');
    expect(stackCards(stack).length).toBe(1);
  });
});

describe('stackCardFor / previousLiveAt / releaseFor', () => {
  it('resolves a dossier route against any card of the stack', () => {
    const groups = groupPatchNotes(FEED);
    expect(stackCardFor('4.8', groups, null)?.status).toBe('superseded');
    expect(stackCardFor('4.11', groups, roadmap(null, release('4.11')))?.status).toBe('next');
    expect(stackCardFor('3.0', groups, null)).toBeNull();
  });

  it('finds the previous live release below a card', () => {
    const groups = groupPatchNotes(FEED);
    const live = stackCardFor('4.10', groups, null)!;
    expect(previousLiveAt(live, groups)).toBe(Date.parse('2026-07-09T18:00:00Z'));
    const oldest = stackCardFor('4.7', groups, null)!;
    expect(previousLiveAt(oldest, groups)).toBeNull();
  });

  it('maps a line to the roadmap release that names it', () => {
    const rm = roadmap(release('4.10'), release('4.11'));
    expect(releaseFor('4.10', rm)?.patchLine).toBe('4.10');
    expect(releaseFor('4.11', rm)?.patchLine).toBe('4.11');
    expect(releaseFor('4.9', rm)).toBeNull();
    expect(releaseFor('4.9', null)).toBeNull();
  });
});
