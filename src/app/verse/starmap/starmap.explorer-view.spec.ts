import { mapExplorer } from '../data/verse.models';
import type { VerseExplorerPatch, VerseExplorerState } from '../data/verse.models';
import {
  addDays,
  buildTaskViews,
  cometDays,
  cometWindowStart,
  constellationEdges,
  crossedUnlocks,
  defaultPatch,
  guidedStarIndex,
  nextTask,
  patchMapView,
  railCurve,
  seriesStops,
  starEarnedEvent,
  starSlots,
  sunState,
} from './starmap.model';

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

describe('dome view helpers', () => {
  it('binds done tasks first (oldest first), then next, then open', () => {
    const p = patch({
      stars: ['archive', 'notes'],
      starCount: 2,
      starDates: { notes: '2026-10-01T00:00:00Z', archive: '2026-10-02T00:00:00Z' },
    });
    const v = patchMapView(p);
    const slots = starSlots(p.constellation?.points, v.tasks, v.next);
    const byRank = [...slots].sort((a, b) => a.rank - b.rank);
    expect(byRank.map((s) => s.state)).toEqual(['done', 'done', 'next', 'open', 'open', 'open', 'open']);
    expect(byRank[0].task?.key).toBe('notes');
    expect(byRank[2].task?.key).toBe(v.next!.key);
    expect(constellationEdges(slots).length).toBe(7);
    // the suggested star sits next to the done chain along the outline
    const doneIdx = slots.filter((s) => s.state === 'done').map((s) => s.index);
    const nextIdx = slots.find((s) => s.state === 'next')!.index;
    expect(doneIdx.some((i) => (i + 1) % 7 === nextIdx || (nextIdx + 1) % 7 === i)).toBeTrue();
    // dashed (not lit) edges touch every open or suggested star, solid ones only join done stars
    for (const e of constellationEdges(slots)) expect(e.lit).toBe(e.from.state === 'done' && e.to.state === 'done');
  });

  it('keeps done stars where they lit when a new one is done, and guides the next one along the chain', () => {
    const base = patch({
      stars: ['notes', 'archive'],
      starCount: 2,
      starDates: { notes: '2026-10-01T00:00:00Z', archive: '2026-10-02T00:00:00Z' },
    });
    const more = patch({
      stars: ['notes', 'archive', 'loadout'],
      starCount: 3,
      starDates: { notes: '2026-10-01T00:00:00Z', archive: '2026-10-02T00:00:00Z', loadout: '2026-10-03T00:00:00Z' },
    });
    const a = patchMapView(base);
    const b = patchMapView(more);
    const sa = starSlots(base.constellation?.points, a.tasks, a.next);
    const sb = starSlots(more.constellation?.points, b.tasks, b.next);
    const litA = sa.filter((s) => s.state === 'done').map((s) => [s.task!.key, s.index]);
    const litB = sb.filter((s) => s.state === 'done');
    for (const [key, idx] of litA) expect(litB.find((s) => s.task!.key === key)?.index).toBe(idx as number);
    expect(guidedStarIndex(sb.map((s) => s.state === 'done'))).toBe(sb.find((s) => s.state === 'next')?.index ?? -1);
  });

  it('sun state: own sun wins, then the comet in the air', () => {
    expect(sunState(true, comet)).toBe('hit');
    expect(sunState(false, { ...comet, state: 'tipped' })).toBe('tipped');
    expect(sunState(false, { ...comet, state: 'miss' })).toBe('faded');
    expect(sunState(false, null)).toBe('faded');
  });

  it('comet days mark the tip and its ±2 window', () => {
    const days = cometDays('2026-11-01', 6, '2026-11-03');
    expect(days.map((d) => d.ymd)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(days.filter((d) => d.win).length).toBe(5);
    expect(days.find((d) => d.on)?.ymd).toBe('2026-11-03');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(cometWindowStart(null, '2026-10-23')).toBe('2026-10-24');
  });

  it('series stops: server unlocks, first locked is next', () => {
    const st = state([patch()]);
    const stops = seriesStops({ ...st.rewards, road: true, nebula: true });
    expect(stops.filter((s) => s.on).length).toBe(2);
    expect(stops.find((s) => s.next)?.key).toBe('live');
  });

  it('opens on the newest LIVE patch, not the tipped test patch', () => {
    const live = patch({ patchLine: '4.4', liveAt: '2026-10-01T00:00:00Z' });
    const ptu = patch({ patchLine: '4.5', liveAt: null });
    const up = { patchLine: '4.5', comet: { ...comet, state: 'tipped' as const, tippedDate: '2026-11-03' } };
    expect(defaultPatch(state([ptu, live], { upcoming: up }))?.patchLine).toBe('4.4');
    expect(railCurve(7, 1, true).height).toBe(38);
  });
});
