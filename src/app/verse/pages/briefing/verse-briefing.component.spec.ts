import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../../../core/analytics.service';
import { BetaService } from '../../../core/beta.service';
import { AuthService } from '../../../auth/auth.service';
import { NewsService } from '../../../news/news.service';
import { VerseApiService } from '../../data/verse-api.service';
import { VerseDigest, VerseDigestItem, VerseExplorerPatch } from '../../data/verse.models';
import { FALLBACK_POINTS, buildTaskViews, nextTask, starSlots } from '../../starmap/starmap.model';
import { MOON_SLOT_S } from './briefing-moon.component';
import { NewsListComponent } from '../../../news/news-list.component';
import { VerseBriefingComponent, linkKey, verseItemLink } from '../verse-briefing.component';
import {
  INTRO_FLAG,
  briefingStatus,
  claimIntro,
  explorerLit,
  followingLine,
  liveStatusKey,
  newestFor,
  nextStatusKey,
  skyFigure,
  splitChars,
  uniqueStories,
} from './briefing.model';

/**
 * A middle click the page code sees, but the browser never acts on: without the
 * window-level preventDefault Chrome opens a REAL tab (testing/new-tab-guard.spec.ts).
 */
function middleClick(el: Element): void {
  const swallow = (e: Event): void => e.preventDefault();
  window.addEventListener('auxclick', swallow);
  try {
    el.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
  } finally {
    window.removeEventListener('auxclick', swallow);
  }
}

const item = (key: string, rank: number, url: string, kind: VerseDigestItem['kind'] = 'patch'): VerseDigestItem => ({
  key, kind, title: `Title ${key}`, url, summary: null, image: null, at: null, pinned: false, score: 1, rank,
});

describe('Verse briefing — model', () => {
  it('followingLine bumps the minor line', () => {
    expect(followingLine('4.10')).toBe('4.11');
    expect(followingLine('4.9.1')).toBe('4.10');
    expect(followingLine('x')).toBeNull();
  });

  it('status keys pick the singular and the direction', () => {
    expect(liveStatusKey(null)).toBe('verse.briefing.status.liveNow');
    expect(liveStatusKey(0)).toBe('verse.briefing.status.liveToday');
    expect(liveStatusKey(1)).toBe('verse.briefing.status.liveOne');
    expect(liveStatusKey(57)).toBe('verse.briefing.status.live');
    expect(nextStatusKey({ line: '4.11', unit: 'days', n: 5, overdue: true })).toBe('verse.briefing.status.overdue.days');
    expect(nextStatusKey({ line: '4.11', unit: 'days', n: 1, overdue: false })).toBe('verse.briefing.status.due.daysOne');
    expect(nextStatusKey({ line: '4.11', unit: 'weeks', n: 3, overdue: false })).toBe('verse.briefing.status.due.weeks');
    expect(nextStatusKey({ line: '4.11', unit: 'today', n: 0, overdue: false })).toBe('verse.briefing.status.dueToday');
  });

  it('briefingStatus falls back to the digest patch block without a feed', () => {
    const now = Date.parse('2026-10-08T12:00:00Z');
    const s = briefingStatus([], { line: '4.3', liveAt: '2026-09-28T12:00:00Z', channels: {}, status: 'live' }, now);
    expect(s).toEqual({ live: { line: '4.3', days: 10 }, next: null });
    expect(briefingStatus([], null, now)).toBeNull();
  });

  it('skyFigure knows only lit and open: no next star, dashed edges wherever an end is open', () => {
    const f = skyFigure(null, 3);
    expect(f.stars.filter((s) => s.state === 'lit').length).toBe(3);
    expect(f.stars.every((s) => s.state === 'lit' || s.state === 'off')).toBeTrue();
    for (const l of f.lines) {
      const a = f.stars.find((s) => s.x === l.x1 && s.y === l.y1)!;
      const b = f.stars.find((s) => s.x === l.x2 && s.y === l.y2)!;
      expect(l.state).toBe(a.state === 'lit' && b.state === 'lit' ? 'lit' : 'open');
    }
    expect(skyFigure(FALLBACK_POINTS, 7).lines.every((l) => l.state === 'lit')).toBeTrue();
    expect(skyFigure(FALLBACK_POINTS, 0).lines.every((l) => l.state === 'open')).toBeTrue();
    // An explicit placement wins over the count.
    const placed = skyFigure(FALLBACK_POINTS, 3, new Set([6]));
    expect(placed.stars.filter((s) => s.state === 'lit').map((s) => s.i)).toEqual([6]);
  });

  it('explorerLit lights the same outline points the star map lights', () => {
    const patch = {
      patchLine: '4.4', liveAt: null, stars: ['notes', 'archive'], starDates: { notes: '2026-10-01', archive: '2026-10-02' },
      starCount: 2, sun: false,
      offered: ['notes', 'comet', 'cx-guess', 'cx-newship', 'archive', 'loadout', 'cx-changed'],
      constellation: { className: null, name: null, kind: 'ship', points: [] },
      comet: { state: 'none', tippedDate: null, locked: false, lockedReason: null, announcedDate: null },
      guess: { state: 'open', guessedClass: null, answerClass: null, answerName: null },
      unlocks: { logEntry: false, community: false, wallpaper: false },
    } as unknown as VerseExplorerPatch;
    const tasks = buildTaskViews(patch);
    const done = starSlots(patch.constellation?.points, tasks, nextTask(tasks)).filter((s) => s.state === 'done').map((s) => s.index);
    expect([...(explorerLit(patch) ?? [])].sort()).toEqual(done.sort());
    expect(done.length).toBe(2);
    expect(explorerLit(null)).toBeNull();
  });

  it('uniqueStories drops repeats by key, kind + title and link, and fills from further items', () => {
    const vara = (key: string, url: string): VerseDigestItem => ({ ...item(key, 1, url, 'gallery'), title: 'Day of the Vara 2956' });
    const list = [
      vara('g1', '/verse/gallery?image=1'),
      vara('g2', '/verse/gallery?image=2'),
      item('g1', 2, '/verse/gallery?image=9', 'gallery'),
      item('n1', 3, '/verse/gallery?image=1', 'news'),
      item('p1', 4, '/verse/patches/4.3'),
      item('x', 5, 'ftp://nope'),
      item('n2', 6, 'https://example.com/n2', 'news'),
    ];
    const out = uniqueStories(list, (i) => verseItemLink(i.url), linkKey, 3);
    expect(out.map((s) => s.item.key)).toEqual(['g1', 'p1', 'n2']);
  });
});

describe('Verse briefing — model (more)', () => {
  it('skyFigure falls back to the symmetric order by count', () => {
    const f = skyFigure(null, 3);
    expect(f.stars.length).toBe(7);
    expect(f.stars.filter((s) => s.state === 'lit').length).toBe(3);
    expect(f.lines.length).toBe(7);
    expect(skyFigure(FALLBACK_POINTS, 7).stars.every((s) => s.state === 'lit')).toBeTrue();
  });

  it('claimIntro plays the full entrance once per session and survives blocked storage', () => {
    const store = new Map<string, string>();
    const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(claimIntro(fake)).toBe('full');
    expect(store.get(INTRO_FLAG)).toBe('1');
    expect(claimIntro(fake)).toBe('short');
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => undefined };
    expect(claimIntro(broken)).toBe('full');
    expect(claimIntro(null)).toBe('full');
  });

  it('newestFor picks the first unseen item of the door kind; splitChars keeps spaces', () => {
    const items = [item('a', 1, '/x', 'news'), item('b', 2, '/y', 'gallery'), item('c', 3, '/z', 'news')];
    expect(newestFor('news', items, new Set())?.key).toBe('a');
    expect(newestFor('news', items, new Set(['a']))?.key).toBe('c');
    expect(newestFor('patches', items, new Set())).toBeNull();
    expect(splitChars('a b').map((c) => c.c)).toEqual(['a', ' ', 'b']);
  });
});

@Component({ selector: 'sc-news-list', standalone: true, template: '' })
class NewsListStub {}

describe('Verse briefing — component', () => {
  const beta = signal<Record<string, boolean>>({ verse: true, codex: true });
  const captureVerse = jasmine.createSpy('captureVerse');
  const markSeen = jasmine.createSpy('markSeen').and.resolveTo({ ok: true, data: undefined });
  const cancels: jasmine.Spy[] = [];
  const trackShown = jasmine.createSpy('trackShown').and.callFake(() => {
    const c = jasmine.createSpy('cancel');
    cancels.push(c);
    return c;
  });
  const items = [
    item('a', 1, '/verse/patches/4.3'),
    item('b', 2, '/verse/gallery?image=x', 'gallery'),
    item('c', 3, 'https://example.com/c', 'news'),
  ];
  const digest: VerseDigest = {
    generatedAt: '', items, suggested: 3, patch: { line: '4.10', liveAt: null, channels: {}, status: 'live' },
    counts: { news: { recent: 4, total: 40 }, patches: { recent: 2 }, gallery: { recent: 7, total: 900 } },
  };
  const loadSeen = jasmine.createSpy('loadSeen');

  beforeEach(() => {
    sessionStorage.removeItem(INTRO_FLAG);
    captureVerse.calls.reset();
    trackShown.calls.reset();
    loadSeen.calls.reset();
    cancels.length = 0;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: AnalyticsService, useValue: { captureVerse, flags: () => ({}) } },
        { provide: BetaService, useValue: { state: beta, isEnabled: (a: string) => () => beta()[a] } },
        { provide: AuthService, useValue: { isAuthenticated: signal(false), user: signal(null) } },
        {
          provide: VerseApiService,
          useValue: {
            digest: signal(digest), digestState: signal('ready'), digestError: signal(null),
            seen: signal(new Set<string>()), topItems: signal(items),
            explorer: signal(null), explorerState: signal('idle'), loadExplorer: jasmine.createSpy(),
            loadDigest: jasmine.createSpy(), loadSeen, markSeen, trackShown,
          },
        },
        {
          provide: NewsService,
          useValue: {
            feed: signal(null), loading: signal(true), stream: signal([]), streamCount: signal(0),
            patchLines: signal([]), refresh: jasmine.createSpy(),
          },
        },
      ],
    });
    TestBed.overrideComponent(VerseBriefingComponent, {
      remove: { imports: [NewsListComponent] },
      add: { imports: [NewsListStub] },
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.removeItem(INTRO_FLAG);
  });

  it('renders the hero CTA, moons and the constellation star-map link as anchors and the story pills as buttons', () => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(loadSeen).toHaveBeenCalled();
    expect(el.querySelector('h1')?.textContent).toContain('Title a');
    expect(el.querySelector('.cta')?.getAttribute('href')).toBe('/verse/patches/4.3');
    expect(el.querySelector('.where')?.textContent).toContain('verse.briefing.ctaWhere.patch');
    expect(el.querySelector('.kick')).toBeNull();
    const bars = Array.from(el.querySelectorAll<HTMLButtonElement>('.story button.sbar'));
    expect(bars.length).toBe(3);
    expect(bars.every((b) => b.type === 'button' && !b.hasAttribute('href'))).toBeTrue();
    expect(bars.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    const moons = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav.moons a.moon'));
    expect(moons.map((a) => a.getAttribute('href'))).toEqual(['/verse/news', '/verse/patches', '/verse/gallery']);
    const map = el.querySelector('a.map');
    expect(map?.getAttribute('href')).toBe('/verse/explorer');
    expect(map?.querySelector('sc-briefing-sky')).not.toBeNull();
    // Moon relay: News → Patches → Gallery, one shared loop.
    const slots = Array.from(el.querySelectorAll<HTMLElement>('sc-briefing-moon'));
    const intro = fixture.componentInstance.introSeconds;
    expect(slots.map((m) => m.style.getPropertyValue('--start'))).toEqual(
      [0, 1, 2].map((i) => `${(intro + i * MOON_SLOT_S).toFixed(2)}s`),
    );
    expect(new Set(slots.map((m) => m.style.getPropertyValue('--cycle')))).toEqual(new Set(['41.25s']));
    expect(el.querySelector('.status .si.live')).not.toBeNull();
    expect(el.querySelector('sc-news-list')).toBeNull();
    // The first visit of the session plays the full entrance.
    expect(el.querySelector('.stage')?.getAttribute('data-intro')).toBe('full');
  });

  it('tracks opens and gate jumps', () => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    middleClick(el.querySelector('a.cta')!);
    expect(markSeen).toHaveBeenCalledWith(['a']);
    expect(captureVerse).toHaveBeenCalledWith('verse_top_open', { key: 'a', kind: 'patch', rank: 1, pinned: false });
    middleClick(el.querySelectorAll('nav.moons a.moon')[2]);
    expect(captureVerse).toHaveBeenCalledWith('verse_door_open', { door: 'gallery' });
  });

  it('rotates the stories and restarts the "shown" clock per story', () => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    expect(trackShown).toHaveBeenCalledWith(['a']);
    fixture.componentInstance.advance();
    fixture.detectChanges();
    expect(cancels[0]).toHaveBeenCalled();
    expect(trackShown).toHaveBeenCalledWith(['b']);
    expect(fixture.componentInstance.current()?.item.key).toBe('b');
    expect(fixture.componentInstance.cta()?.item.key).toBe('b');
    fixture.componentInstance.advance();
    fixture.componentInstance.advance();
    expect(fixture.componentInstance.index()).toBe(0);
    fixture.destroy();
    expect(cancels[cancels.length - 1]).toHaveBeenCalled();
  });

  it('fills the hero from the rest of the digest when the top list repeats one story', () => {
    const api = TestBed.inject(VerseApiService) as unknown as {
      topItems: ReturnType<typeof signal<VerseDigestItem[]>>;
      digest: ReturnType<typeof signal<VerseDigest>>;
    };
    const vara = (key: string): VerseDigestItem => ({ ...item(key, 1, `/verse/gallery?image=${key}`, 'gallery'), title: 'Day of the Vara 2956' });
    const all = [vara('g1'), { ...vara('g2'), rank: 2 }, { ...vara('g3'), rank: 3 }, item('p', 4, '/verse/patches/4.10')];
    api.digest.set({ ...digest, items: all });
    api.topItems.set(all.slice(0, 3));
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.stories().map((s) => s.item.key)).toEqual(['g1', 'p']);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.story button.sbar').length).toBe(2);
  });

  it('a story pill only switches the hero — no navigation, no open event', () => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    markSeen.calls.reset();
    el.querySelectorAll<HTMLButtonElement>('.story button.sbar')[2].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.current()?.item.key).toBe('c');
    expect(el.querySelector('a.cta')?.getAttribute('href')).toBe('https://example.com/c');
    expect(markSeen).not.toHaveBeenCalled();
    expect(captureVerse).not.toHaveBeenCalledWith('verse_top_open', jasmine.anything());
    expect(el.querySelectorAll('.story button.sbar')[2].getAttribute('aria-pressed')).toBe('true');
  });

  it('the pause control holds all stage motion and stays with a single story', () => {
    const one = TestBed.inject(VerseApiService) as unknown as { topItems: ReturnType<typeof signal<VerseDigestItem[]>> };
    const api = one as unknown as { digest: ReturnType<typeof signal<VerseDigest>> };
    api.digest.set({ ...digest, items: [items[0], { ...items[0], key: 'dup' }] });
    one.topItems.set([items[0], { ...items[0], key: 'dup' }]);
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.stories().length).toBe(1);
    expect(el.querySelector('.story')).toBeNull();
    const pause = el.querySelector<HTMLButtonElement>('button.pause')!;
    expect(pause).not.toBeNull();
    pause.click();
    fixture.detectChanges();
    expect(el.querySelector('.stage')?.classList).toContain('paused');
    expect(pause.getAttribute('aria-label')).toBe('verse.briefing.resume');
    pause.click();
    fixture.detectChanges();
    expect(el.querySelector('.stage')?.classList).not.toContain('paused');
    one.topItems.set(items);
  });

  it('plays the short entrance on a later visit in the same session', () => {
    sessionStorage.setItem(INTRO_FLAG, '1');
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.stage')?.classList).toContain('short');
  });

  it('with β off renders the legacy news list and claims no intro', () => {
    beta.set({ ...beta(), verse: false });
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('sc-news-list')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.stage')).toBeNull();
    expect(sessionStorage.getItem(INTRO_FLAG)).toBeNull();
    expect(trackShown).not.toHaveBeenCalled();
    beta.set({ ...beta(), verse: true });
  });
});
