import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { AnalyticsService } from '../../core/analytics.service';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseExplorerPatch, VerseExplorerState, VerseLoadState } from '../data/verse.models';
import { VerseHeaderComponent } from '../shared/verse-header.component';
import { ExplorerGlyphComponent } from './explorer-glyph.component';
import { ExplorerPageComponent, wallpaperConstellations } from './explorer-page.component';
import { MyConstellationsComponent } from './my-constellations.component';
import { FALLBACK_POINTS } from './starmap.model';

@Component({ selector: 'sc-verse-header', template: '' })
class StubVerseHeaderComponent {
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
  constellation: { className: 'RSI_Zeus', kind: 'ship', points: FALLBACK_POINTS },
  unlocks: { logEntry: starCount >= 1, community: starCount >= 3, wallpaper: starCount >= 7 },
  ...extra,
});

const STATE: VerseExplorerState = {
  patches: [patch('4.4', 2, { sun: true }), patch('4.3', 7), patch('4.2', 0)],
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

  beforeEach(() => {
    explorer.set(STATE);
    explorerState.set('ready');
    authed.set(true);
    loadExplorer = jasmine.createSpy('loadExplorer').and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: AuthService, useValue: { isAuthenticated: authed } },
        { provide: AnalyticsService, useValue: jasmine.createSpyObj('AnalyticsService', ['captureVerse']) },
        {
          provide: VerseApiService,
          useValue: { explorer, explorerState, explorerError: signal(null), loadExplorer },
        },
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

  it('explorer lists only the offered tasks, each linking to where it is done', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const rows = f.nativeElement.querySelectorAll('.tasks li');
    expect(rows.length).toBe(4);
    const hrefs = [...f.nativeElement.querySelectorAll('.tasks a.go')].map((a) => (a as HTMLAnchorElement).getAttribute('href'));
    expect(hrefs).toEqual(['/verse/patches/4.4', '/codex/keybinds', '/codex/fps', '/verse/patches/4.4']);
    expect(f.nativeElement.querySelectorAll('.tasks li.done').length).toBe(2);
  });

  it('explorer lights stars symmetrically and shows the current sun large', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const stage = f.nativeElement.querySelector('.stage') as HTMLElement;
    const lit = [...stage.querySelectorAll('.star.lit')] as SVGGElement[];
    expect(lit.length).toBe(2);
    expect(stage.querySelector('.sun.big')).not.toBeNull();
    expect(stage.querySelector('.mark')?.textContent?.trim()).toBe('4.4');
  });

  it('explorer renders streak rewards unlocked vs locked from the server state', () => {
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    const on = f.nativeElement.querySelectorAll('.rewards li.on');
    expect(on.length).toBe(2);
    expect(f.nativeElement.querySelectorAll('.rewards li').length).toBe(6);
  });

  it('explorer shows an error with retry, never the empty state', () => {
    explorer.set(null);
    explorerState.set('error');
    const f = TestBed.createComponent(ExplorerPageComponent);
    f.detectChanges();
    (f.nativeElement.querySelector('[role=alert] button') as HTMLButtonElement).click();
    expect(loadExplorer).toHaveBeenCalled();
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
});
