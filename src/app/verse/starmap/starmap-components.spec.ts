import type { Mock } from 'vitest';
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { RoleService } from '../../auth/role.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { KartographBadgeComponent } from './kartograph-badge.component';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { AnalyticsService } from '../../core/analytics.service';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseExplorerPatch, VerseExplorerState, VerseLoadState } from '../data/verse.models';
import { VerseHeaderComponent } from '../shared/verse-header.component';
import { ExplorerGlyphComponent } from './explorer-glyph.component';
import { CELEBRATED_KEY, ExplorerPageComponent, wallpaperConstellations } from './explorer-page.component';
import { SeriesStripComponent } from './series-strip.component';
import { MyConstellationsComponent } from './my-constellations.component';
import { StarmapMoreComponent } from './starmap-more.component';
import { FALLBACK_POINTS, RANK_SEEN_KEY, rankNewsItems } from './starmap.model';
import { RankPageComponent } from './rank-page.component';

// Renders the h1 and projects the actions like the real head (the explorer's map bar lives in it).
@Component({ selector: 'sc-verse-header', template: '<h1>{{ title() }}</h1><ng-content />' })
class StubVerseHeaderComponent {
  readonly planet = input<unknown>();
  readonly trail = input<unknown>();
  readonly title = input<unknown>();
  readonly eyebrow = input<unknown>();
  readonly subtitle = input<unknown>();
}

const patch = (line: string, starCount: number, extra: Partial<VerseExplorerPatch> = {}): VerseExplorerPatch => ({
  patchLine: line,
  liveAt: null,
  stars: starCount >= 2 ? ['cx-keybinds', 'notes'] : [],
  starCount,
  sun: false,
  offered: ['notes', 'cx-keybinds', 'cx-fps', 'comet'],
  starDates: {},
  constellation: { className: 'RSI_Zeus', name: 'RSI Zeus Mk II', kind: 'ship', points: FALLBACK_POINTS },
  comet: { state: 'none', tippedDate: null, locked: false, lockedReason: null, announcedDate: null },
  guess: { state: 'correct', guessedClass: 'RSI_Zeus', answerClass: 'RSI_Zeus', answerName: 'RSI Zeus Mk II' },
  unlocks: { logEntry: starCount >= 1, community: starCount >= 3, wallpaper: starCount >= 7 },
  ...extra,
});

const STATE: VerseExplorerState = {
  patches: [patch('4.4', 2, { sun: true }), patch('4.3', 7), patch('4.2', 0)],
  upcoming: null,
  totalStars: 9,
  suns: ['4.4'],
  sunSplinters: 4,
  streak: { current: 2, best: 3, reserveAvailable: false, reservesUsed: 0 },
  kartograph: { unlocked: true, rank: 2, stars: 3 },
  rewards: { road: true, nebula: true, live: false, reserve: false, meteor: false, supernova: false, sunCollection: true },
};

describe('star map components', () => {
  const explorer = signal<VerseExplorerState | null>(STATE);
  const explorerState = signal<VerseLoadState>('ready');
  const authed = signal(true);
  let loadExplorer: Mock;
  let rankIdeas: Mock;
  let submitPrediction: Mock;
  let cometVersion: Mock;
  let submitVersionPrediction: Mock;
  let submitGuess: Mock;
  const isAdmin = signal(false);

  beforeEach(() => {
    localStorage.removeItem(CELEBRATED_KEY);
    localStorage.removeItem(RANK_SEEN_KEY);
    explorer.set(STATE);
    explorerState.set('ready');
    authed.set(true);
    loadExplorer = vi.fn().mockName('loadExplorer').mockResolvedValue(undefined);
    isAdmin.set(false);
    cometVersion = vi.fn().mockName('cometVersion').mockResolvedValue(null);
    submitVersionPrediction = vi.fn().mockName('submitVersionPrediction').mockResolvedValue({ ok: true, data: undefined });
    submitPrediction = vi.fn().mockName('submitPrediction').mockResolvedValue({ ok: true, data: undefined });
    submitGuess = vi.fn().mockName('submitGuess').mockResolvedValue({
      ok: true,
      data: { patchLine: '4.4', correct: false, answerClass: 'RSI_Zeus', answerName: 'RSI Zeus Mk II', starEarned: false },
    });
    rankIdeas = vi.fn().mockName('rankIdeas').mockResolvedValue({ ok: true, data: null });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: AuthService, useValue: { isAuthenticated: authed } },
        { provide: AnalyticsService, useValue: { captureVerse: vi.fn().mockName('captureVerse'), flags: () => ({}) } },
        {
          provide: VerseApiService,
          useValue: {
            explorer,
            explorerState,
            explorerError: signal(null),
            loadExplorer,
            rankIdeas,
            submitPrediction,
            cometVersion: (...a: unknown[]) => cometVersion(...a),
            submitVersionPrediction: (...a: unknown[]) => submitVersionPrediction(...a),
            submitGuess,
            guessOptions: vi.fn().mockName('guessOptions').mockResolvedValue({
              ok: true,
              data: {
                patchLine: '4.4',
                state: 'open',
                guessedClass: null,
                answerClass: null,
                answerName: null,
                options: [
                  { className: 'RSI_Zeus', name: 'RSI Zeus Mk II' },
                  { className: 'AEGS_Gladius', name: 'Aegis Gladius' },
                ],
              },
            }),
            communityStars: vi.fn().mockName('communityStars').mockResolvedValue({ ok: true, data: { patchLine: '4.4', explorers: 4, stars: { notes: 4, 'cx-keybinds': 1 } } }),
            constellation: vi.fn().mockName('constellation').mockResolvedValue({ ok: true, data: null }),
          },
        },
        { provide: RoleService, useValue: { isAdmin } },
        { provide: ScConfirmService, useValue: { prompt: vi.fn().mockName('prompt').mockResolvedValue('Pin it') } },
      ],
    });
    for (const cmp of [ExplorerPageComponent, RankPageComponent]) {
      TestBed.overrideComponent(cmp, {
        remove: { imports: [VerseHeaderComponent] },
        add: { imports: [StubVerseHeaderComponent] },
      });
    }
  });

  afterEach(() => TestBed.resetTestingModule());

  it('glyph is a real anchor to the explorer with the lit count', () => {
    const f = TestBed.createComponent(ExplorerGlyphComponent);
    f.detectChanges();
    const a = f.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/verse/explorer');
    expect(a.textContent).toContain('2');
    expect(f.nativeElement.querySelectorAll('.star.lit').length).toBe(2);
  });

  it('dome: every star is a button, lit / next / dormant from the tasks, no task list', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('sc-star-dome button.star').length).toBe(7);
    expect(el.querySelectorAll('button.star.done').length).toBe(2);
    expect(el.querySelectorAll('button.star.next').length).toBe(1);
    expect(el.querySelector('.tasks')).toBeNull();
    expect(el.querySelector('h1')?.textContent).toContain('verse.area.starmap');
  });

  it('head: the rank crest is a real anchor to the rank page; ladder, series, Logbuch, mine and wallpaper left the map', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const rank = el.querySelector('a.rank') as HTMLAnchorElement;
    expect(rank.getAttribute('href')).toBe('/verse/explorer/rank');
    expect(rank.querySelector('sc-kartograph-crest')).not.toBeNull();
    expect(rank.getAttribute('aria-label')).toContain('starmap.rank.link');
    expect(el.querySelector('.ladder')).toBeNull();
    expect(el.querySelector('sc-series-strip')).toBeNull();
    expect(el.querySelector('sc-starmap-more, [aria-controls=starmap-more]')).toBeNull();
    expect(el.querySelector('sc-my-constellations')).toBeNull();
    expect(el.textContent).not.toContain('starmap.export.wallpaper');
    expect(el.querySelector('.corner sc-select.patch-pick')).not.toBeNull();
  });

  it('head: the rank crest signals news until the rank page was opened', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const rank = f.nativeElement.querySelector('a.rank') as HTMLAnchorElement;
    expect(rank.classList).toContain('news');
    expect(rank.querySelector('.news-dot')).not.toBeNull();
    expect(rank.getAttribute('aria-label')).toContain('starmap.rank.news');
    f.destroy();

    localStorage.setItem(RANK_SEEN_KEY, JSON.stringify(rankNewsItems(STATE)));
    const g = TestBed.createComponent(ExplorerPageComponent);
    g.detectChanges();
    const seen = g.nativeElement.querySelector('a.rank') as HTMLAnchorElement;
    expect(seen.classList).not.toContain('news');
    expect(seen.querySelector('.news-dot')).toBeNull();
  });

  it('rank page: current tier big, 7-tier ladder, rewards, series, Logbuch and my star maps', async () => {
    const f = TestBed.createComponent(RankPageComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('starmap.rankPage.title');
    expect(el.querySelector('.standing .name')?.textContent).toContain('starmap.rankPage.tier.surveyor.name');
    const steps = el.querySelectorAll('.ladder .step');
    expect(steps.length).toBe(7);
    expect([...steps].map((s) => (s.classList.contains('earned') ? 'e' : s.classList.contains('current') ? 'c' : 'l')).join('')).toBe('eclllll');
    expect(el.querySelectorAll('.rewards li').length).toBe(7);
    expect(el.querySelectorAll('.rewards li.on').length).toBe(2);
    expect(el.querySelector('sc-series-strip')).not.toBeNull();
    expect(el.querySelector('sc-starmap-more')).not.toBeNull();
    expect(el.querySelector('sc-my-constellations')).not.toBeNull();
    expect(el.querySelectorAll('[scAction][tier=primary], button.sc-action--primary').length).toBeLessThanOrEqual(1);
    // Opening the page stores what it showed: the star map's marker clears.
    expect(JSON.parse(localStorage.getItem(RANK_SEEN_KEY) ?? '[]')).toEqual(rankNewsItems(STATE));
    // The mini view renders from the live data and opens the gallery lightbox.
    await vi.waitFor(() => {
      f.detectChanges();
      expect(el.querySelector('.mini a.tile img')).not.toBeNull();
    }, { timeout: 10000, interval: 100 });
    const tile = el.querySelector('.mini a.tile') as HTMLAnchorElement;
    expect(tile.getAttribute('href')).toMatch(/^blob:/);
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    f.detectChanges();
    expect(el.querySelector('sc-lightbox')).not.toBeNull();
    expect(el.querySelector('sc-lightbox a[download]')?.getAttribute('download')).toMatch(/^sc-starmap-4\.4/);
  });

  it('rank page: an unranked reader sees the ladder all locked and no 4K download', () => {
    explorer.set({ ...STATE, kartograph: { unlocked: false, rank: 0, stars: 0 } });
    const f = TestBed.createComponent(RankPageComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.standing .name')?.textContent).toContain('starmap.rankPage.unranked');
    expect(el.querySelectorAll('.ladder .step.locked').length).toBe(7);
    expect(el.textContent).toContain('starmap.rankPage.downloadLocked');
    expect(el.textContent).not.toContain('starmap.export.wallpaper');
  });

  it('rank page: signed out, error and loading states', () => {
    authed.set(false);
    let f = TestBed.createComponent(RankPageComponent);
    f.detectChanges();
    expect(f.nativeElement.querySelector('a[href^="/login"]')).not.toBeNull();
    f.destroy();
    authed.set(true);
    explorerState.set('error');
    f = TestBed.createComponent(RankPageComponent);
    f.detectChanges();
    expect(f.nativeElement.querySelector('[role=alert] button')).not.toBeNull();
    f.destroy();
    explorerState.set('loading');
    explorer.set(null);
    f = TestBed.createComponent(RankPageComponent);
    f.detectChanges();
    expect(f.nativeElement.querySelector('[aria-busy=true]')).not.toBeNull();
    expect(f.nativeElement.querySelector('.ladder')).toBeNull();
  });

  it('head: a placeholder symbol stands in for the rank until one is earned', () => {
    explorer.set({ ...STATE, kartograph: { unlocked: false, rank: 0, stars: 0 } });
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const rank = f.nativeElement.querySelector('a.rank') as HTMLAnchorElement;
    expect(rank.getAttribute('href')).toBe('/verse/explorer/rank');
    expect(rank.querySelector('sc-kartograph-crest')).toBeNull();
    expect(rank.querySelector('svg.rank-empty')).not.toBeNull();
    expect(rank.getAttribute('aria-label')).toContain('starmap.rank.none');
  });

  it('a star opens its card with the task link as a real anchor; done shows its date', () => {
    explorer.set({
      ...STATE,
      patches: [patch('4.4', 2, { sun: true, starDates: { notes: '2026-10-01T10:00:00Z', 'cx-keybinds': '2026-10-02T10:00:00Z' } }), ...STATE.patches.slice(1)],
    });
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    (el.querySelector('button.star.next') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.card[role=dialog]')?.textContent).toContain('starmap.card.here');
    expect(el.querySelector('button.star.next')?.getAttribute('aria-pressed')).toBe('true');
    const hrefs: (string | null)[] = [];
    for (const star of [...el.querySelectorAll('button.star.open')] as HTMLButtonElement[]) {
      star.click();
      f.detectChanges();
      hrefs.push(el.querySelector('.card a.go')?.getAttribute('href') ?? null);
    }
    expect(hrefs).toContain('/codex/fps');
    (el.querySelector('button.star.done') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.card[role=dialog]')?.textContent).toContain('starmap.card.doneOn');
    expect(el.querySelector('.card a.go')).toBeNull();
  });

  it('no sun on the star map (the Verse hub carries it)', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    expect(f.nativeElement.querySelector('.sun-sky, .sun')).toBeNull();
  });

  it('the comet rail tips the upcoming patch with one click, sent once the undo window closes', async () => {
    explorer.set({ ...STATE, upcoming: { patchLine: '4.5', comet: { ...STATE.patches[0].comet } } });
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const tok = f.nativeElement.querySelector('sc-comet-track .tok:not(.nav):not(:disabled)') as HTMLButtonElement;
    tok.click();
    f.detectChanges();
    expect(submitPrediction).not.toHaveBeenCalled();
    expect(tok.classList).toContain('on');
    expect(TestBed.inject(UndoToastService).current()?.messageKey).toBe('starmap.comet.undoToast');
    TestBed.inject(UndoToastService).flush();
    await f.whenStable();
    expect(submitPrediction).toHaveBeenCalledWith('4.5', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('a tipped comet is read-only and an error shows translated inline', async () => {
    submitPrediction.mockResolvedValue({ ok: false, errorKey: 'errors.cometLocked' });
    explorer.set({ ...STATE, upcoming: { patchLine: '4.5', comet: { ...STATE.patches[0].comet } } });
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    (f.nativeElement.querySelector('sc-comet-track .tok:not(.nav):not(:disabled)') as HTMLButtonElement).click();
    TestBed.inject(UndoToastService).flush();
    // Not whenStable(): under Vitest it never settles on this error path (the
    // mocked promise comes from outside the zone); wait for the alert itself.
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.querySelector('sc-comet-track [role=alert]')?.textContent).toContain('errors.cometLocked');
    });

    explorer.set({
      ...STATE,
      upcoming: { patchLine: '4.5', comet: { state: 'tipped', tippedDate: '2099-11-03', locked: false, lockedReason: null, announcedDate: null } },
    });
    f.detectChanges();
    const toks = [...f.nativeElement.querySelectorAll('sc-comet-track .tok')] as HTMLButtonElement[];
    expect(toks.every((t) => t.disabled)).toBe(true);
    expect(f.nativeElement.querySelector('sc-comet-track .tok.on .comet.fall')).not.toBeNull();
  });

  it("the x.y.z target is offered next to the line and tipped via its own call", async () => {
    cometVersion.mockResolvedValue({
      patchVersion: "4.4.2",
      patchLine: "4.4",
      liveVersion: "4.4.1",
      comet: { state: "none", tippedDate: null, locked: false, lockedReason: null, announcedDate: null },
      splinters: 0,
      source: "evocati",
    });
    explorer.set({ ...STATE, upcoming: { patchLine: "4.5", comet: { ...STATE.patches[0].comet } } });
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.querySelectorAll("sc-comet-track .mode").length).toBe(2);
    });
    // x.y.z first and pre-selected, the line is the second choice; source and splinter note stay quiet underneath
    const modes = [...f.nativeElement.querySelectorAll("sc-comet-track .mode")] as HTMLButtonElement[];
    expect(modes[0].textContent).toContain("4.4.2");
    expect(modes[0].getAttribute("aria-pressed")).toBe("true");
    expect(modes[1].getAttribute("aria-pressed")).toBe("false");
    expect(f.nativeElement.querySelector("sc-comet-track .src")?.textContent).toContain("starmap.comet.source.evocati");
    expect(f.nativeElement.querySelector("sc-comet-track .splinter-note")).not.toBeNull();
    f.detectChanges();
    (f.nativeElement.querySelector("sc-comet-track .tok:not(.nav):not(:disabled)") as HTMLButtonElement).click();
    TestBed.inject(UndoToastService).flush();
    await vi.waitFor(() => expect(submitVersionPrediction).toHaveBeenCalledWith("4.4.2", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)));
    expect(submitPrediction).not.toHaveBeenCalled();
  });

  it("the line tip stays reachable as the second choice and drops the x.y.z notes", async () => {
    cometVersion.mockResolvedValue({
      patchVersion: "4.4.2",
      patchLine: "4.4",
      liveVersion: "4.4.1",
      comet: { state: "none", tippedDate: null, locked: false, lockedReason: null, announcedDate: null },
      splinters: 1,
      source: null,
    });
    explorer.set({ ...STATE, upcoming: { patchLine: "4.5", comet: { ...STATE.patches[0].comet } } });
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.querySelectorAll("sc-comet-track .mode").length).toBe(2);
    });
    expect(f.nativeElement.querySelector("sc-comet-track .src")).toBeNull();
    (f.nativeElement.querySelectorAll("sc-comet-track .mode")[1] as HTMLButtonElement).click();
    f.detectChanges();
    expect(f.nativeElement.querySelectorAll("sc-comet-track .mode")[1].getAttribute("aria-pressed")).toBe("true");
    expect(f.nativeElement.querySelector("sc-comet-track .splinter-note")).toBeNull();
    (f.nativeElement.querySelector("sc-comet-track .tok:not(.nav):not(:disabled)") as HTMLButtonElement).click();
    TestBed.inject(UndoToastService).flush();
    await vi.waitFor(() => expect(submitPrediction).toHaveBeenCalled());
    expect(submitVersionPrediction).not.toHaveBeenCalled();
  });

  it("without a version target the comet shows no mode switch (migration not applied)", () => {
    explorer.set({ ...STATE, upcoming: { patchLine: "4.5", comet: { ...STATE.patches[0].comet } } });
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    expect(f.nativeElement.querySelector("sc-comet-track .mode")).toBeNull();
    expect(f.nativeElement.querySelector("sc-comet-track .tok")).not.toBeNull();
  });

  it('a tip whose day passed while the patch is not LIVE reads missed, under the renamed patch', () => {
    explorer.set({
      ...STATE,
      upcoming: { patchLine: '4.11', comet: { state: 'tipped', tippedDate: '2020-11-04', locked: false, lockedReason: null, announcedDate: null } },
    });
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const track = f.nativeElement.querySelector('sc-comet-track') as HTMLElement;
    expect(track.querySelector('.state.missed')?.textContent).toContain('starmap.comet.state.missed');
    expect(track.querySelector('.state.tip')).toBeNull();
    expect(track.querySelector('b')?.textContent).toContain('starmap.comet.head.missed');
  });

  it('the screenshot case: the 4.11 tip of Sa 31 Okt 2026 reads missed once that day is past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 8, 17, 12));
    try {
      explorer.set({
        ...STATE,
        upcoming: { patchLine: '4.11', comet: { state: 'tipped', tippedDate: '2026-10-31', locked: false, lockedReason: null, announcedDate: null } },
      });
      const f = TestBed.createComponent(ExplorerPageComponent);
      f.detectChanges();
      const track = f.nativeElement.querySelector('sc-comet-track') as HTMLElement;
      expect(track.querySelector('.state.missed')).not.toBeNull();
      expect(track.querySelector('.state')?.textContent).not.toContain('tipped');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the header shows the real map in small, no globe: same 7 stars and 7 edges as the big map', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const mini = f.nativeElement.querySelector('sc-verse-header sc-starmap-mini') as HTMLElement;
    expect(mini).not.toBeNull();
    expect(mini.querySelectorAll('.core').length).toBe(7);
    expect(mini.querySelectorAll('.ln').length).toBe(7);
  });

  it('the guess rail submits on click and hides when unavailable', async () => {
    const open = { state: 'open', guessedClass: null, answerClass: null, answerName: null } as const;
    explorer.set({ ...STATE, patches: [patch('4.4', 2, { guess: open }), ...STATE.patches.slice(1)] });
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const toks = f.nativeElement.querySelectorAll('sc-guess-track .tok.ship') as NodeListOf<HTMLButtonElement>;
    expect(toks.length).toBe(2);
    toks[1].click();
    TestBed.inject(UndoToastService).flush();
    await f.whenStable();
    expect(submitGuess).toHaveBeenCalledWith('4.4', 'AEGS_Gladius');

    explorer.set({ ...STATE, patches: [patch('4.4', 2, { guess: { ...open, state: 'unavailable' } }), ...STATE.patches.slice(1)] });
    f.detectChanges();
    expect(f.nativeElement.querySelector('sc-guess-track')).toBeNull();
  });

  it('undo after a guess reverts the pick and never sends it', async () => {
    const open = { state: 'open', guessedClass: null, answerClass: null, answerName: null } as const;
    explorer.set({ ...STATE, patches: [patch('4.4', 2, { guess: open }), ...STATE.patches.slice(1)] });
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const toks = () => [...f.nativeElement.querySelectorAll('sc-guess-track .tok.ship')] as HTMLButtonElement[];
    toks()[1].click();
    f.detectChanges();
    expect(toks().every((t) => t.disabled)).toBe(true);
    expect(toks()[1].classList).toContain('mine');
    // A state refresh of the same patch keeps the pick locked (no second guess).
    explorer.set({ ...STATE, patches: [patch('4.4', 2, { guess: { ...open } }), ...STATE.patches.slice(1)] });
    f.detectChanges();
    await Promise.resolve();
    f.detectChanges();
    expect(toks().every((t) => t.disabled)).toBe(true);
    const undo = TestBed.inject(UndoToastService);
    expect(undo.current()?.messageParams).toEqual({ name: 'Aegis Gladius' });
    undo.undo();
    f.detectChanges();
    expect(toks().some((t) => t.disabled)).toBe(false);
    expect(toks()[1].classList).not.toContain('mine');
    TestBed.inject(UndoToastService).flush();
    await f.whenStable();
    expect(submitGuess).not.toHaveBeenCalled();

    // A second pick after the undo is the one that counts.
    toks()[0].click();
    f.detectChanges();
    TestBed.inject(UndoToastService).flush();
    await f.whenStable();
    expect(submitGuess).toHaveBeenCalledTimes(1);
    expect(submitGuess).toHaveBeenCalledWith('4.4', 'RSI_Zeus');
  });

  it('series strip: one line, unlocked vs locked from the server, next marked', () => {
    const f = TestBed.createComponent(SeriesStripComponent);
    f.componentRef.setInput('state', STATE);
    f.detectChanges();
    const strip = f.nativeElement as HTMLElement;
    expect(strip.querySelectorAll('.rs').length).toBe(6);
    expect(strip.querySelectorAll('.rs.on').length).toBe(2);
    expect(strip.querySelectorAll('.rs.next').length).toBe(1);
    expect(strip.textContent).toContain('starmap.series.count');
  });

  it('explorer shows an error with retry, never the empty state', () => {
    explorer.set(null);
    explorerState.set('error');
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    (f.nativeElement.querySelector('[role=alert] button') as HTMLButtonElement).click();
    expect(loadExplorer).toHaveBeenCalled();
  });

  it('celebrates a constellation complete on entry once per patch line, never again', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.cele')).toBeNull();
    f.componentInstance.selectLine('4.3');
    f.detectChanges();
    expect(el.querySelector('.cele[role=status]')).not.toBeNull();
    expect(el.querySelector('sc-star-dome .fig.celebrate')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(CELEBRATED_KEY) ?? '[]')).toContain('4.3');
    f.destroy();
    const again = TestBed.createComponent(ExplorerPageComponent);
    again.detectChanges();
    again.componentInstance.selectLine('4.3');
    again.detectChanges();
    expect(again.nativeElement.querySelector('.cele')).toBeNull();
  });

  it('a constellation finished during the visit celebrates on the next visit, not at once', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    explorer.set({ ...STATE, patches: [patch('4.4', 7, { sun: true }), ...STATE.patches.slice(1)] });
    f.detectChanges();
    expect(f.nativeElement.querySelector('.cele')).toBeNull();
    f.destroy();
    const next = TestBed.createComponent(ExplorerPageComponent);
    next.detectChanges();
    expect(next.nativeElement.querySelector('.cele[role=status]')).not.toBeNull();
  });

  it('renders without a readable localStorage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    expect(f.nativeElement.querySelectorAll('sc-star-dome button.star').length).toBe(7);
    spy.mockRestore();
  });

  it('my constellations lists earned wallpapers only', () => {
    const f = TestBed.createComponent(MyConstellationsComponent);
    f.detectChanges();
    const cards = f.nativeElement.querySelectorAll('.card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('4.3');
  });

  it('wallpaper inputs put the selected patch first and skip empty patches', () => {
    const list = wallpaperConstellations(STATE, STATE.patches[1]);
    expect(list.map((c) => c.patchLine)).toEqual(['4.3', '4.4']);
  });

  function more(state: VerseExplorerState = STATE, part: 'series' | 'logbook' = 'logbook') {
    const f = TestBed.createComponent(StarmapMoreComponent);
    f.componentRef.setInput('part', part);
    f.componentRef.setInput('state', state);
    f.componentRef.setInput('patch', state.patches[0]);
    f.detectChanges();
    return f;
  }

  it('badge share opens from lit stars alone, with no finished map', async () => {
    const stars = { ...STATE, kartograph: { unlocked: false, rank: 0, stars: 3 } };
    const f = more(stars);
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.side .btn.ghost')).not.toBeNull();
    expect(f.nativeElement.querySelector('.suggest')).toBeNull();
    const none = more({ ...STATE, kartograph: { unlocked: false, rank: 0, stars: 2 } });
    none.detectChanges();
    expect(none.nativeElement.querySelector('.side .btn.ghost')).toBeNull();
  });

  it('the extras area hosts the reward ideas, hidden when the RPC is missing', async () => {
    const f = more();
    await f.whenStable();
    f.detectChanges();
    expect(rankIdeas).toHaveBeenCalled();
    expect(f.nativeElement.querySelector('sc-rank-ideas')).not.toBeNull();
    expect(f.nativeElement.querySelector('sc-rank-ideas .ideas')).toBeNull();
  });

  it('sun collection folds splinters: 4 splinters = one small sun + "1 of 3", never a star', async () => {
    const f = more();
    await f.whenStable();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.suns .small-sun').length).toBe(1);
    expect(el.querySelector('.suns .splinter')?.textContent).toContain('starmap.suns.splinter');
    expect(el.querySelectorAll('.suns li').length).toBe(3);
    expect(f.componentInstance.tier()).toBe(2);
  });

  it('splinters alone fill the collection but leave the rank where it was', async () => {
    const f = more({ ...STATE, suns: [], sunSplinters: 2, kartograph: { unlocked: false, rank: 0, stars: 0 } });
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.suns .small-sun')).toBeNull();
    expect(f.nativeElement.querySelector('.suns .splinter')).not.toBeNull();
    expect(f.componentInstance.tier()).toBe(0);
  });

  it('community figure lights the stars other explorers earned', async () => {
    const f = more();
    await f.whenStable();
    f.detectChanges();
    const fig = f.nativeElement.querySelector('.community-fig') as HTMLElement;
    expect(fig.querySelectorAll('.star.lit').length).toBe(2);
  });

  it('meteor shower shows only a hint off the LIVE day', () => {
    const f = more({ ...STATE, rewards: { ...STATE.rewards, live: true, meteor: true } }, 'series');
    expect(f.componentInstance.meteorToday()).toBe(false);
    expect(f.nativeElement.textContent).toContain('starmap.reward.meteor.notToday');
  });
});

describe('Kartograph badge page', () => {
  function create(query: Record<string, string>) {
    const params = convertToParamMap(query);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(params), snapshot: { queryParamMap: params } } },
        {
          provide: VerseApiService,
          useValue: { constellation: vi.fn().mockName('constellation').mockResolvedValue({ ok: true, data: null }) },
        },
      ],
    });
    const f = TestBed.createComponent(KartographBadgeComponent);
    f.detectChanges();
    return f;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the badge from the link alone', () => {
    const f = create({ rank: '2', patch: '4.4', stars: '7', sun: '1' });
    expect(f.nativeElement.querySelector('canvas')).not.toBeNull();
    expect(f.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/verse/explorer');
    expect(TestBed.inject(VerseApiService).constellation).toHaveBeenCalledWith('4.4');
  });

  it('refuses an unusable link', () => {
    const f = create({ rank: 'x', patch: '4.4' });
    expect(f.nativeElement.querySelector('canvas')).toBeNull();
  });
});
