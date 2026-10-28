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
import { ExplorerPageComponent, wallpaperConstellations } from './explorer-page.component';
import { MyConstellationsComponent } from './my-constellations.component';
import { StarmapMoreComponent } from './starmap-more.component';
import { FALLBACK_POINTS } from './starmap.model';

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
  streak: { current: 2, best: 3, reserveAvailable: false, reservesUsed: 0 },
  kartograph: { unlocked: true, rank: 2 },
  rewards: { road: true, nebula: true, live: false, reserve: false, meteor: false, supernova: false, sunCollection: true },
};

describe('star map components', () => {
  const explorer = signal<VerseExplorerState | null>(STATE);
  const explorerState = signal<VerseLoadState>('ready');
  const authed = signal(true);
  let loadExplorer: jasmine.Spy;
  let suggest: jasmine.Spy;
  let suggestions: jasmine.Spy;
  let submitPrediction: jasmine.Spy;
  let submitGuess: jasmine.Spy;
  const isAdmin = signal(false);

  beforeEach(() => {
    explorer.set(STATE);
    explorerState.set('ready');
    authed.set(true);
    loadExplorer = jasmine.createSpy('loadExplorer').and.resolveTo();
    isAdmin.set(false);
    submitPrediction = jasmine.createSpy('submitPrediction').and.resolveTo({ ok: true, data: undefined });
    submitGuess = jasmine.createSpy('submitGuess').and.resolveTo({
      ok: true,
      data: { patchLine: '4.4', correct: false, answerClass: 'RSI_Zeus', answerName: 'RSI Zeus Mk II', starEarned: false },
    });
    suggest = jasmine.createSpy('suggest').and.resolveTo({ ok: true, data: undefined });
    suggestions = jasmine.createSpy('suggestions').and.resolveTo({
      ok: true,
      data: [{ id: 's1', itemUrl: '/verse/patches/4.4', note: 'read', status: 'open', createdAt: 'x' }],
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: AuthService, useValue: { isAuthenticated: authed } },
        { provide: AnalyticsService, useValue: { captureVerse: jasmine.createSpy('captureVerse'), flags: () => ({}) } },
        {
          provide: VerseApiService,
          useValue: {
            explorer,
            explorerState,
            explorerError: signal(null),
            loadExplorer,
            suggest,
            suggestions,
            submitPrediction,
            submitGuess,
            guessOptions: jasmine.createSpy('guessOptions').and.resolveTo({
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
            communityStars: jasmine
              .createSpy('communityStars')
              .and.resolveTo({ ok: true, data: { patchLine: '4.4', explorers: 4, stars: { notes: 4, 'cx-keybinds': 1 } } }),
            constellation: jasmine.createSpy('constellation').and.resolveTo({ ok: true, data: null }),
            promoteSuggestion: jasmine.createSpy('promoteSuggestion').and.resolveTo({ ok: true, data: 'suggestion:s1' }),
            dismissSuggestion: jasmine.createSpy('dismissSuggestion').and.resolveTo({ ok: true, data: undefined }),
          },
        },
        { provide: RoleService, useValue: { isAdmin } },
        { provide: ScConfirmService, useValue: { prompt: jasmine.createSpy('prompt').and.resolveTo('Pin it') } },
      ],
    });
    for (const cmp of [ExplorerPageComponent, MyConstellationsComponent]) {
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
    expect(el.querySelector('h1')?.textContent).toContain('starmap.map.title');
    expect(el.querySelector('.count')?.textContent).toContain('2');
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

  it('the sun shows its own state in the sky (hit = lit with comet)', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const sky = f.nativeElement.querySelector('.sun-sky') as HTMLElement;
    expect(sky.classList).toContain('hit');
    expect(sky.querySelector('.comet')).not.toBeNull();
    expect(sky.hasAttribute('title')).toBeFalse();
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
    expect(submitPrediction).toHaveBeenCalledWith('4.5', jasmine.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('a tipped comet is read-only and an error shows translated inline', async () => {
    submitPrediction.and.resolveTo({ ok: false, errorKey: 'errors.cometLocked' });
    explorer.set({ ...STATE, upcoming: { patchLine: '4.5', comet: { ...STATE.patches[0].comet } } });
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    (f.nativeElement.querySelector('sc-comet-track .tok:not(.nav):not(:disabled)') as HTMLButtonElement).click();
    TestBed.inject(UndoToastService).flush();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('sc-comet-track [role=alert]')?.textContent).toContain('errors.cometLocked');

    explorer.set({
      ...STATE,
      upcoming: { patchLine: '4.5', comet: { state: 'tipped', tippedDate: '2099-11-03', locked: false, lockedReason: null, announcedDate: null } },
    });
    f.detectChanges();
    const toks = [...f.nativeElement.querySelectorAll('sc-comet-track .tok')] as HTMLButtonElement[];
    expect(toks.every((t) => t.disabled)).toBeTrue();
    expect(f.nativeElement.querySelector('sc-comet-track .tok.on .comet.fall')).not.toBeNull();
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
    expect(toks().every((t) => t.disabled)).toBeTrue();
    expect(toks()[1].classList).toContain('mine');
    // A state refresh of the same patch keeps the pick locked (no second guess).
    explorer.set({ ...STATE, patches: [patch('4.4', 2, { guess: { ...open } }), ...STATE.patches.slice(1)] });
    f.detectChanges();
    await Promise.resolve();
    f.detectChanges();
    expect(toks().every((t) => t.disabled)).toBeTrue();
    const undo = TestBed.inject(UndoToastService);
    expect(undo.current()?.messageParams).toEqual({ name: 'Aegis Gladius' });
    undo.undo();
    f.detectChanges();
    expect(toks().some((t) => t.disabled)).toBeFalse();
    expect(toks()[1].classList).not.toContain('mine');
    TestBed.inject(UndoToastService).flush();
    await f.whenStable();
    expect(submitGuess).not.toHaveBeenCalled();

    // A second pick after the undo is the one that counts.
    toks()[0].click();
    f.detectChanges();
    TestBed.inject(UndoToastService).flush();
    await f.whenStable();
    expect(submitGuess).toHaveBeenCalledOnceWith('4.4', 'RSI_Zeus');
  });

  it('series strip: one line, unlocked vs locked from the server, next marked', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const strip = f.nativeElement.querySelector('sc-series-strip') as HTMLElement;
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

  it('the Logbuch sheet opens from the map bar', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const btn = f.nativeElement.querySelector('button[aria-controls=starmap-more]') as HTMLButtonElement;
    btn.click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('#starmap-more sc-starmap-more')).not.toBeNull();
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

  function more(state: VerseExplorerState = STATE) {
    const f = TestBed.createComponent(StarmapMoreComponent);
    f.componentRef.setInput('state', state);
    f.componentRef.setInput('patch', state.patches[0]);
    f.detectChanges();
    return f;
  }

  it('Kartograph: suggest a top item, own suggestions, badge share', async () => {
    const f = more();
    await f.whenStable();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.side .btn.ghost')).not.toBeNull();
    const input = el.querySelector('#sg-url') as HTMLInputElement;
    const submit = el.querySelector('.suggest button[type=submit]') as HTMLButtonElement;
    expect(submit.disabled).toBeTrue();
    input.value = '/verse/patches/4.4';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(submit.disabled).toBeFalse();
    submit.click();
    await f.whenStable();
    expect(suggest).toHaveBeenCalledWith('/verse/patches/4.4', null);
    expect(el.querySelectorAll('.sg-list li').length).toBe(1);
    expect(el.querySelector('.admin-queue')).toBeNull();
  });

  it('admins get the suggestion queue and can pin', async () => {
    isAdmin.set(true);
    const f = more();
    await f.whenStable();
    f.detectChanges();
    const queue = f.nativeElement.querySelector('.admin-queue') as HTMLElement;
    expect(queue.querySelectorAll('.sg-row').length).toBe(1);
    (queue.querySelector('.sg-actions .btn') as HTMLButtonElement).click();
    await f.whenStable();
    expect(TestBed.inject(VerseApiService).promoteSuggestion).toHaveBeenCalledWith('s1', 'Pin it');
  });

  it('community figure lights the stars other explorers earned', async () => {
    const f = more();
    await f.whenStable();
    f.detectChanges();
    const fig = f.nativeElement.querySelector('.community-fig') as HTMLElement;
    expect(fig.querySelectorAll('.star.lit').length).toBe(2);
  });

  it('meteor shower shows only a hint off the LIVE day', () => {
    const f = more({ ...STATE, rewards: { ...STATE.rewards, live: true, meteor: true } });
    expect(f.componentInstance.meteorToday()).toBeFalse();
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
          useValue: { constellation: jasmine.createSpy('constellation').and.resolveTo({ ok: true, data: null }) },
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
