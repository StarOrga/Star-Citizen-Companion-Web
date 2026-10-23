import { mapExplorer } from '../data/verse.models';
import type { VerseExplorerPatch, VerseExplorerState } from '../data/verse.models';
import { buildTaskViews, crossedUnlocks, nextTask, patchMapView, starEarnedEvent } from './starmap.model';

const comet = { state: 'none', tippedDate: null, locked: false, lockedReason: null, announcedDate: null } as const;

function patch(extra: Partial<VerseExplorerPatch> = {}): VerseExplorerPatch {
  return {
    patchLine: '4.4',
    liveAt: null,
    stars: [],
    starDates: {},
    starCount: 0,
    sun: false,
    offered: ['notes', 'comet', 'cx-guess', 'cx-newship', 'archive', 'loadout', 'cx-changed'],
    constellation: { className: null, name: null, kind: 'ship', points: [] },
    comet,
    guess: { state: 'open', guessedClass: null, answerClass: null, answerName: null },
    unlocks: { logEntry: false, community: false, wallpaper: false },
    ...extra,
  };
}

function state(patches: VerseExplorerPatch[], extra: Partial<VerseExplorerState> = {}): VerseExplorerState {
  return {
    patches,
    upcoming: null,
    totalStars: 0,
    suns: [],
    streak: { current: 0, best: 0, reserveAvailable: false, reservesUsed: 0 },
    kartograph: { unlocked: false, rank: 0 },
    rewards: { road: false, nebula: false, live: false, reserve: false, meteor: false, supernova: false, sunCollection: false },
    ...extra,
  };
}

describe('explorer view model', () => {
  it('suggests the quickest open task and skips locked ones', () => {
    const open = patchMapView(patch());
    expect(open.next?.key).toBe('notes');
    const afterNotes = patchMapView(patch({ stars: ['notes'], starCount: 1 }));
    expect(afterNotes.next?.key).toBe('comet');
    const cometLocked = patchMapView(patch({ stars: ['notes'], starCount: 1, comet: { ...comet, locked: true, lockedReason: 'announced' } }));
    expect(cometLocked.next?.key).toBe('cx-guess');
    const guessed = patchMapView(
      patch({
        stars: ['notes'],
        comet: { ...comet, locked: true, lockedReason: 'live' },
        guess: { state: 'wrong', guessedClass: 'A', answerClass: 'B', answerName: 'Bee' },
      }),
    );
    expect(guessed.next?.key).toBe('archive');
    expect(nextTask(guessed.tasks.map((t) => ({ ...t, done: true })))).toBeNull();
  });

  it('carries done dates and never links the hull before the guess', () => {
    const p = patch({ stars: ['notes'], starDates: { notes: '2026-10-01T10:00:00Z' } });
    const tasks = buildTaskViews(p);
    expect(tasks.find((t) => t.key === 'notes')).toEqual(jasmine.objectContaining({ done: true, doneAt: '2026-10-01T10:00:00Z' }));
    expect(tasks.find((t) => t.key === 'cx-newship')?.link).toBe('/codex');
    const revealed = buildTaskViews(
      patch({ guess: { state: 'wrong', guessedClass: 'A', answerClass: 'RSI_Zeus', answerName: 'Zeus' } }),
    );
    expect(revealed.find((t) => t.key === 'cx-newship')?.link).toBe('/codex/ship/RSI_Zeus');
  });

  it('reports the milestones a star crosses and the lit count', () => {
    const before = state([patch({ stars: ['notes', 'archive'], starCount: 2, unlocks: { logEntry: true, community: false, wallpaper: false } })]);
    const after = state(
      [patch({ stars: ['notes', 'archive', 'loadout'], starCount: 3, unlocks: { logEntry: true, community: true, wallpaper: false } })],
      { rewards: { ...before.rewards, road: true } },
    );
    expect(crossedUnlocks(before, after, '4.4')).toEqual(['community', 'road']);
    expect(starEarnedEvent('loadout', '4.4', before, after)).toEqual({
      key: 'loadout',
      patchLine: '4.4',
      lit: 3,
      total: 7,
      unlocked: ['community', 'road'],
    });
    expect(starEarnedEvent('loadout', '9.9', before, after)).toBeNull();
  });

  it('maps comet, guess, star dates and the upcoming patch from the payload', () => {
    const e = mapExplorer({
      patches: [
        {
          patch_line: '4.4',
          stars: ['comet'],
          star_dates: { comet: '2026-10-02T00:00:00Z', bogus: 'x' },
          star_count: 1,
          constellation: { class_name: null, name: null, kind: 'ship', points: [] },
          comet: { state: 'hit', tipped_date: '2026-11-03', locked: true, locked_reason: 'live', announced_date: null },
          guess: { state: 'correct', guessed_class: 'Z', answer_class: 'Z', answer_name: 'Zeus' },
        },
      ],
      upcoming: { patch_line: '4.5', comet: { state: 'tipped', tipped_date: '2026-12-01', locked: false } },
    });
    expect(e?.patches[0].starDates).toEqual({ comet: '2026-10-02T00:00:00Z' });
    expect(e?.patches[0].comet).toEqual({ state: 'hit', tippedDate: '2026-11-03', locked: true, lockedReason: 'live', announcedDate: null });
    expect(e?.patches[0].guess.answerName).toBe('Zeus');
    expect(e?.patches[0].constellation?.className).toBeNull();
    expect(e?.upcoming?.patchLine).toBe('4.5');
    expect(e?.upcoming?.comet.state).toBe('tipped');
    expect(mapExplorer({ patches: [] })?.upcoming).toBeNull();
  });
});
