import { NgTemplateOutlet } from '@angular/common';
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterLink, provideRouter } from '@angular/router';
import { TranslatePipe, provideTranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../core/analytics.service';
import { NewsService } from '../news/news.service';
import { VerseApiService } from './data/verse-api.service';
import { VerseBetaService } from './data/verse-beta.service';
import { VerseDigest, VerseDigestItem } from './data/verse.models';
import { VerseBriefingComponent, verseItemLink } from './pages/verse-briefing.component';
import { verseKpiTiles } from './pages/verse-patch-kpis';
import { dossierLineOf } from './pages/verse-patches.component';
import { verseStatusView } from './shared/verse-status.component';
import { VerseLayoutComponent, verseAreaOf } from './verse-layout.component';
import { VERSE_ROUTES } from './verse.routes';

function snap(data: Record<string, unknown>, child: ActivatedRouteSnapshot | null = null): ActivatedRouteSnapshot {
  return { data, firstChild: child } as unknown as ActivatedRouteSnapshot;
}

describe('Verse hub — pure helpers', () => {
  it('verseAreaOf takes the deepest verseArea and ignores junk', () => {
    expect(verseAreaOf(snap({}, snap({ verseArea: 'patches' }, snap({}))))).toBe('patches');
    expect(verseAreaOf(snap({ verseArea: 'nope' }))).toBeNull();
    expect(verseAreaOf(null)).toBeNull();
  });

  it('verseItemLink splits in-app paths and keeps only https externals', () => {
    expect(verseItemLink('/verse/gallery?image=a1')).toEqual({ internal: true, path: '/verse/gallery', query: { image: 'a1' } });
    expect(verseItemLink('/verse/patches/4.3')).toEqual({ internal: true, path: '/verse/patches/4.3', query: null });
    expect(verseItemLink('https://robertsspaceindustries.com/x')?.internal).toBeFalse();
    expect(verseItemLink('//evil.example.com')).toBeNull();
    expect(verseItemLink('javascript:alert(1)')).toBeNull();
    expect(verseItemLink(null)).toBeNull();
  });

  it('dossierLineOf recognises an opened dossier only', () => {
    expect(dossierLineOf('/verse/patches/4.3?q=x')).toBe('4.3');
    expect(dossierLineOf('/verse/patches')).toBeNull();
    expect(dossierLineOf('/verse/news')).toBeNull();
  });

  it('verseStatusView falls back to the digest patch block without a feed', () => {
    const now = Date.parse('2026-10-08T12:00:00Z');
    const v = verseStatusView([], { line: '4.3', liveAt: '2026-09-28T12:00:00Z', channels: { ptu: '4.4.0' }, status: 'ptu' }, now);
    expect(v).toEqual(jasmine.objectContaining({ line: '4.3', state: 'ptu', ptuLine: '4.4.0', sinceDays: 10, nextDays: null }));
    expect(verseStatusView([], null, now)).toBeNull();
  });

  it('verseKpiTiles shows nothing it cannot prove', () => {
    expect(verseKpiTiles([], [])).toEqual([]);
  });

  it('every in-app digest url shape has a Verse route', () => {
    const paths = VERSE_ROUTES.map((r) => r.path);
    expect(paths).toEqual(jasmine.arrayContaining(['', 'news', 'patches', 'gallery', 'gallery/constellations', 'explorer']));
    expect(VERSE_ROUTES.find((r) => r.path === 'patches')?.children?.[0].path).toBe(':line');
  });
});

@Component({ standalone: true, template: '' })
class BlankComponent {}

@Component({ selector: 'sc-verse-header', standalone: true, template: '' })
class HeaderStub {
  readonly root = input(false);
  readonly eyebrow = input<string | null>(null);
  readonly rememberAs = input<string | null>(null);
}

@Component({ selector: 'sc-news-list', standalone: true, template: '' })
class NewsListStub {}

describe('Verse hub — components', () => {
  const beta = signal<Record<string, boolean>>({ briefing: true, news: false, patches: false, gallery: false, starmap: false });
  const captureVerse = jasmine.createSpy('captureVerse');
  const markSeen = jasmine.createSpy('markSeen').and.resolveTo({ ok: true, data: undefined });
  const toggle = jasmine.createSpy('toggle');
  const item = (key: string, rank: number, url: string): VerseDigestItem => ({
    key, kind: 'patch', title: `Title ${key}`, url, summary: null, image: null, at: null, pinned: false, score: 1, rank,
  });
  const items = [item('a', 1, '/verse/patches/4.3'), item('b', 2, '/verse/gallery?image=x'), item('c', 3, 'https://example.com/c')];
  const digest: VerseDigest = {
    generatedAt: '', items, suggested: 3, patch: null,
    counts: { news: { recent: 4, total: 40 }, patches: { recent: 2 }, gallery: { recent: 7, total: 900 } },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: BlankComponent }]),
        provideTranslateService({}),
        { provide: AnalyticsService, useValue: { captureVerse, flags: () => ({}) } },
        {
          provide: VerseBetaService,
          useValue: {
            state: beta, locked: signal({}), toggle,
            isEnabled: (a: string) => () => beta()[a],
          },
        },
        {
          provide: VerseApiService,
          useValue: {
            digest: signal(digest), digestState: signal('ready'), digestError: signal(null),
            seen: signal(new Set<string>()), topItems: signal(items),
            loadDigest: jasmine.createSpy(), loadSeen: jasmine.createSpy(), markSeen,
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
      set: { imports: [RouterLink, NgTemplateOutlet, TranslatePipe, HeaderStub, NewsListStub] },
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('briefing renders the top list and gates as real anchors and tracks opens', () => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = Array.from(el.querySelectorAll<HTMLAnchorElement>('.list a.item'));
    expect(rows.map((a) => a.getAttribute('href'))).toEqual(['/verse/patches/4.3', '/verse/gallery?image=x', 'https://example.com/c']);
    expect(rows[2].getAttribute('target')).toBe('_blank');
    const gates = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav.gates a.gate'));
    expect(gates.map((a) => a.getAttribute('href'))).toEqual(['/verse/news', '/verse/patches', '/verse/gallery']);
    expect(el.querySelector('.cta')?.getAttribute('href')).toBe('/verse/patches/4.3');
    rows[1].dispatchEvent(new MouseEvent('auxclick', { button: 1 }));
    expect(markSeen).toHaveBeenCalledWith(['b']);
    expect(captureVerse).toHaveBeenCalledWith('verse_top_open', { key: 'b', kind: 'patch', rank: 2, pinned: false });
    gates[2].dispatchEvent(new MouseEvent('auxclick', { button: 1 }));
    expect(captureVerse).toHaveBeenCalledWith('verse_door_open', { door: 'gallery' });
    expect(el.querySelector('sc-news-list')).toBeNull();
  });

  it('briefing with β off renders the legacy news list', () => {
    beta.set({ ...beta(), briefing: false });
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('sc-news-list')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.hero')).toBeNull();
    beta.set({ ...beta(), briefing: true });
  });

  it('layout β pill toggles the current area', () => {
    const fixture = TestBed.createComponent(VerseLayoutComponent);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.more') as HTMLButtonElement;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.beta-list [role="switch"]').length).toBe(5);
    (fixture.nativeElement.querySelector('.beta-list [role="switch"]') as HTMLButtonElement).click();
    expect(toggle).toHaveBeenCalledWith('briefing');
  });
});
