import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../../../core/analytics.service';
import { BetaService } from '../../../core/beta.service';
import { AuthService } from '../../../auth/auth.service';
import { NewsService } from '../../../news/news.service';
import { VerseApiService } from '../../data/verse-api.service';
import { VerseDigest, VerseDigestItem } from '../../data/verse.models';
import { FALLBACK_POINTS } from '../../starmap/starmap.model';
import { NewsListComponent } from '../../../news/news-list.component';
import { VerseBriefingComponent } from '../verse-briefing.component';
import {
  INTRO_FLAG,
  briefingStatus,
  claimIntro,
  followingLine,
  liveStatusKey,
  newestFor,
  nextStatusKey,
  skyFigure,
  splitChars,
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

  it('skyFigure lights the first stars, marks the next one and the edges between them', () => {
    const f = skyFigure(null, 3);
    expect(f.stars.length).toBe(7);
    expect(f.stars.filter((s) => s.state === 'lit').length).toBe(3);
    expect(f.stars.filter((s) => s.state === 'next').length).toBe(1);
    expect(f.lines.length).toBe(7);
    expect(f.lines.every((l) => ['lit', 'next', 'off'].includes(l.state))).toBeTrue();
    expect(skyFigure(FALLBACK_POINTS, 7).stars.every((s) => s.state === 'lit')).toBeTrue();
    expect(skyFigure(FALLBACK_POINTS, 0).stars.filter((s) => s.state === 'next').length).toBe(1);
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

  it('renders the hero, story bars, moons and star-map button as real anchors', () => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(loadSeen).toHaveBeenCalled();
    expect(el.querySelector('h1')?.textContent).toContain('Title a');
    expect(el.querySelector('.cta')?.getAttribute('href')).toBe('/verse/patches/4.3');
    const bars = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav.story a.sbar'));
    expect(bars.map((a) => a.getAttribute('href'))).toEqual(['/verse/patches/4.3', '/verse/gallery?image=x', 'https://example.com/c']);
    expect(bars[2].getAttribute('target')).toBe('_blank');
    expect(bars[0].getAttribute('aria-current')).toBe('true');
    const moons = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav.moons a.moon'));
    expect(moons.map((a) => a.getAttribute('href'))).toEqual(['/verse/news', '/verse/patches', '/verse/gallery']);
    expect(el.querySelector('a.mapbtn')?.getAttribute('href')).toBe('/verse/explorer');
    expect(el.querySelector('.status .si.live')).not.toBeNull();
    expect(el.querySelector('sc-news-list')).toBeNull();
    // The first visit of the session plays the full entrance.
    expect(el.querySelector('.stage')?.getAttribute('data-intro')).toBe('full');
  });

  it('tracks opens and gate jumps', () => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    middleClick(el.querySelectorAll('nav.story a.sbar')[1]);
    expect(markSeen).toHaveBeenCalledWith(['b']);
    expect(captureVerse).toHaveBeenCalledWith('verse_top_open', { key: 'b', kind: 'gallery', rank: 2, pinned: false });
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
