import { Component, signal } from '@angular/core';
import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../../../core/analytics.service';
import { BetaService } from '../../../core/beta.service';
import { AuthService } from '../../../auth/auth.service';
import { NewsListComponent } from '../../../news/news-list.component';
import { NewsService, VerseNewsItem } from '../../../news/news.service';
import type { PatchLineGroup } from '../../../news/patch-notes';
import { PatchStabilityService } from '../../../news/patch-stability.service';
import type { StabilityVerdict } from '../../../news/patch-stability';
import { VerseApiService } from '../../data/verse-api.service';
import { VerseDigest, VerseDigestItem } from '../../data/verse.models';
import { HERO_MS, VerseBriefingComponent } from '../verse-briefing.component';
import { BriefingBeaconsComponent, IDLE_HINT_MS, IDLE_SHOW_MS } from './briefing-beacons.component';
import { ACC_REST_MS, ACC_TRANSITION_MS, AccordionIntent } from './briefing-accordion';
import { INTRO_FLAG } from './briefing.model';
import {
  deltaText, holoBody, hubChannel, hubChannels, hubGallery, hubStats, kickerVersion, lineOf, patchImage, previousLine, verdictWord,
} from './briefing-hub';
import { TX_CHARGE_MS, TX_CHARS_PER_S, TX_HOLD_MS, TX_OUT_MS, TX_REVEAL_MS } from './briefing-transmit.component';

@Component({ selector: 'sc-news-list', standalone: true, template: '' })
class NewsListStub {}

const item = (key: string, at: string | null, kind: VerseDigestItem['kind'] = 'news', extra: Partial<VerseDigestItem> = {}): VerseDigestItem => ({
  key, kind, title: `T ${key}`, url: `/verse/news?item=${key}`, summary: null, image: null, at, pinned: false, score: 1, rank: 1, ...extra,
});

const note = (thumbnail: string | null) => ({ item: { thumbnail } }) as unknown as PatchLineGroup['entries'][number];
const group = (line: string, isCurrentLive: boolean, hasLive: boolean, entries: PatchLineGroup['entries'] = []): PatchLineGroup => ({
  line, segments: line.split('.').map(Number), entries, latestAt: '2026-10-20', hasLive, isCurrentLive,
});

const verdict = (line: string, level: 1 | 2 | 3 | 4 | 5 | null, stability: number | null, kbOpen: number | null = null, insufficient = false): StabilityVerdict =>
  ({ line, level, stability, kbOpen, insufficient } as unknown as StabilityVerdict);

describe('Verse hub — verdict + patch grid model', () => {
  it('keeps the verdict thresholds in one function: stabil >= 75, wackelig 45–74, viele Probleme < 45', () => {
    expect(verdictWord(100)).toBe('stable');
    expect(verdictWord(75)).toBe('stable');
    expect(verdictWord(74.9)).toBe('shaky');
    expect(verdictWord(45)).toBe('shaky');
    expect(verdictWord(44)).toBe('troubled');
    expect(verdictWord(null)).toBeNull();
  });

  it('compares Stabilität + Bekannte Probleme with the predecessor; worse is a trend, never an error', () => {
    const s = hubStats(verdict('4.3', 4, 50, 30), verdict('4.2', 2, 79, 16), '4.2');
    expect(s.stability).toEqual({ value: 50, delta: -29, trend: 'worse' });
    expect(s.issues).toEqual({ value: 30, delta: 14, trend: 'worse', level: 4 });
    expect(deltaText(s.stability, true)).toBe('▼ 29');
    expect(deltaText(s.issues, false)).toBe('+14');
    const up = hubStats(verdict('4.3', 2, 58, 13), verdict('4.2', 4, 50, 16), '4.2');
    expect(up.stability.trend).toBe('better');
    expect(deltaText(up.issues, false)).toBe('−3');
    const none = hubStats(null, verdict('4.2', 2, 79), '4.2');
    expect(none.stability.value).toBeNull();
    expect(deltaText(none.stability, true)).toBe('–');
    expect(hubStats(verdict('4.3', null, null, null, true), null, null).issues.level).toBeNull();
  });

  it('builds fixed Hotfix / PTU / Evocati slots, each against its own predecessor, quiet when not running', () => {
    const known = ['4.4', '4.3', '4.2'];
    const v = (l: string): StabilityVerdict | null => ({ '4.3': verdict('4.3', 4, 50, 30), '4.2': verdict('4.2', 2, 79, 16) })[l] ?? null;
    const channels = { live: '4.3.1', ptu: '4.4.0', evocati: '4.5' };
    const live = hubChannel('live', channels, known, v);
    expect([live.version, live.line, live.stats.vs, live.stats.stability.value]).toEqual(['4.3.1', '4.3', '4.2', 50]);
    const rows = hubChannels(channels, known, v);
    expect(rows.map((r) => r.kind)).toEqual(['hotfix', 'ptu', 'evocati']);
    expect(rows[0].version).withContext('no hotfix in the data → quiet slot').toBeNull();
    expect(rows[1].stats.vs).toBe('4.3 PTU');
    expect(rows[2].stats.vs).toBe('4.4 Evocati');
    expect(rows[1].stats.stability.value).withContext('only LIVE lines are measured').toBeNull();
    expect(hubChannel('hotfix', { live: '4.3.1', hotfix: '4.3.2' }, known, v).stats.vs).toBe('4.3.1');
    expect(hubChannels(null, known, v).every((r) => r.version === null)).toBeTrue();
    expect(lineOf('4.3.1')).toBe('4.3');
    expect(previousLine('4.3', known)).toBe('4.2');
    expect(previousLine('4.2', [])).toBe('4.1');
  });

  it('takes the LIVE patch image and falls back to the previous patch; gallery 1 + 6 slots from 14 candidates; kicker prefers the full version', () => {
    expect(patchImage([group('4.4', false, false, [note('ptu.jpg')]), group('4.3', true, true, [note(null)]), group('4.2', false, true, [note('42.jpg')])])).toBe('42.jpg');
    expect(patchImage([group('4.3', true, true, [note('43.jpg')])])).toBe('43.jpg');
    expect(patchImage([])).toBeNull();
    const items = Array.from({ length: 20 }, (_, i) => item(`g${i}`, null, 'gallery', { image: `${i}.jpg`, rank: i }));
    expect(hubGallery(items).length).withContext('spare candidates beyond the 1 + 6 slots').toBe(14);
    expect(kickerVersion({ live: '4.3.1' }, '4.3')).toBe('4.3.1');
    expect(kickerVersion({}, '4.3')).toBe('4.3');
    expect(holoBody('a '.repeat(100)).length).toBeLessThanOrEqual(112);
  });
});

describe('Verse hub — accordion hover intent', () => {
  it('opens at once for a pointer that stands still or jitters, ignores sweeps, finishes a started transition, keeps the open entry on leave', fakeAsync(() => {
    const acc = new AccordionIntent(0);
    // A quick vertical sweep (40 px every 10 ms): nothing opens.
    for (let i = 1; i <= 3; i++) {
      acc.move(i, 10, i * 40, i * 10);
      tick(10);
    }
    expect(acc.open()).toBe(0);
    // A resting pointer: the first sample arms the rest timer, the next jittery one opens at once.
    acc.move(2, 10, 80, 1000);
    acc.move(2, 12, 81, 1016);
    expect(acc.open()).withContext('jitter within the tolerance: no delay').toBe(2);
    expect(acc.transitioning).toBeTrue();
    // A new target during the transition waits for its end …
    acc.move(3, 10, 120, 1100);
    acc.move(3, 10, 121, 1116);
    expect(acc.open()).toBe(2);
    tick(ACC_TRANSITION_MS);
    expect(acc.open()).toBe(3);
    tick(ACC_TRANSITION_MS);
    // A pointer that stops after a fast move opens its entry after the short rest — and then waits for the transition.
    acc.move(2, 10, 80, 3000);
    acc.move(2, 10, 81, 3016);
    expect(acc.open()).toBe(2);
    acc.move(3, 10, 200, 3020);
    tick(ACC_REST_MS + 10);
    expect(acc.open()).toBe(2);
    tick(ACC_TRANSITION_MS);
    expect(acc.open()).toBe(3);
    // … and a target that was still waiting is dropped when the pointer moved on and left.
    acc.move(1, 10, 40, 4000);
    tick(ACC_REST_MS + 10);
    acc.move(2, 10, 300, 4100);
    acc.leave();
    tick(ACC_TRANSITION_MS * 2 + ACC_REST_MS);
    expect(acc.open()).toBe(3);
    // Leaving the list keeps the open entry.
    expect(acc.open()).toBe(3);
    acc.destroy();
  }));
});

describe('Verse hub — Funkfeuer 2 stage (beta shell)', () => {
  const beta = signal<Record<string, boolean>>({ verse: true, shell: true });
  const items = [
    item('n1', '2026-10-20', 'news'),
    item('p1', '2026-10-21', 'patch', { url: '/verse/patches/4.3', summary: 'Hotfix notes' }),
    item('g1', '2026-10-22', 'gallery', { url: '/verse/gallery?image=g1', image: 'g1.jpg' }),
    item('n2', '2026-10-10', 'news'),
  ];
  const digest: VerseDigest = {
    generatedAt: '', items, suggested: 4, patch: { line: '4.3', liveAt: null, channels: { live: '4.3.1', ptu: '4.4.0' }, status: 'live' },
    counts: { news: { recent: 4 }, patches: { recent: 2 }, gallery: { recent: 7 } },
  };
  const feedNews = [1, 2, 3, 4, 5].map((i) => ({ id: `f${i}`, title: `News ${i}`, summary: 'Short summary.', thumbnail: null, publishedAt: '2026-10-20T10:00:00Z' }) as unknown as VerseNewsItem);

  beforeEach(() => {
    sessionStorage.removeItem(INTRO_FLAG);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: AnalyticsService, useValue: { captureVerse: jasmine.createSpy(), flags: () => ({}) } },
        { provide: BetaService, useValue: { isEnabled: (a: string) => () => !!beta()[a] } },
        { provide: AuthService, useValue: { isAuthenticated: signal(false), user: signal(null) } },
        {
          provide: PatchStabilityService,
          useValue: {
            load: jasmine.createSpy().and.resolveTo(), allTime: () => [],
            verdictFor: (l: string) => (l === '4.3' ? verdict('4.3', 3, 50, 30) : l === '4.2' ? verdict('4.2', 2, 79, 16) : null),
          },
        },
        {
          provide: VerseApiService,
          useValue: {
            digest: signal(digest), digestState: signal('ready'), digestError: signal(null),
            seen: signal(new Set<string>()), topItems: signal(items.slice(0, 3)),
            explorer: signal(null), explorerState: signal('idle'), loadExplorer: jasmine.createSpy(),
            loadDigest: jasmine.createSpy(), loadSeen: jasmine.createSpy(),
            markSeen: jasmine.createSpy().and.resolveTo({ ok: true, data: undefined }), trackShown: () => () => undefined,
          },
        },
        {
          provide: NewsService,
          useValue: {
            feed: signal(null), loading: signal(false), error: signal(null), stage: signal(null), stream: signal(feedNews), streamCount: signal(5),
            patchLines: signal([group('4.4', false, false), group('4.3', true, true), group('4.2', false, true)]), refresh: jasmine.createSpy(),
          },
        },
      ],
    });
    TestBed.overrideComponent(VerseBriefingComponent, { remove: { imports: [NewsListComponent] }, add: { imports: [NewsListStub] } });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.removeItem(INTRO_FLAG);
  });

  it('renders beacons, the hero title, the planets and the holo as real anchors — no moons, no for-you line, no overview links', fakeAsync(() => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nav.moons')).toBeNull();
    expect(el.querySelector('.fy, .pz, a.more')).toBeNull();
    expect(el.querySelector('.brief-world')).not.toBeNull();
    expect(el.querySelector<HTMLAnchorElement>('a.sun-l')?.getAttribute('href')).toBe('/verse/patches/4.3');
    expect(el.querySelector('a.sun-l')?.getAttribute('aria-label')).toContain('verse.hub.sun');
    expect(el.querySelector<HTMLAnchorElement>('.hrow h1 a.tl')?.getAttribute('href')).toBe('/verse/news?item=n1');
    expect(el.querySelector('.kick')?.textContent).toContain('verse.hub.area.news');
    expect(el.querySelectorAll('.hrow button.step').length).toBe(2);
    expect(el.querySelector('button.find')).withContext('the search stands in the shell stage slot').toBeNull();
    expect(el.querySelector('.cta, .sbar, .pause')).withContext('no CTA, story bars or pause').toBeNull();
    const planets = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.pl')).map((a) => [a.dataset['door'], a.getAttribute('href')]);
    expect(planets).toEqual([['news', '/verse/news'], ['patches', '/verse/patches'], ['gallery', '/verse/gallery']]);
    expect(el.querySelector<HTMLAnchorElement>('a.holo')?.getAttribute('href')).toBe('/verse/news?item=f1');
    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('transmits News → Patches → Galerie: charge, top-down reveal, typing at 45 chars/s, 8 s hold', fakeAsync(() => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const holo = (): HTMLElement => el.querySelector<HTMLElement>('a.holo')!;
    const phase = (): string | undefined => {
      fixture.detectChanges();
      return holo().dataset['phase'];
    };
    expect(phase()).toBe('charge');
    expect(el.querySelector('a.pl[data-door="news"]')?.classList).toContain('send');
    tick(TX_CHARGE_MS);
    expect(phase()).toBe('reveal');
    tick(TX_REVEAL_MS);
    expect(phase()).toBe('type');
    const body = 'Short summary.';
    tick(Math.ceil((body.length * 1000) / TX_CHARS_PER_S) + 50);
    expect(phase()).toBe('hold');
    expect(holo().querySelector('.typed')?.textContent).toBe(body);
    tick(TX_HOLD_MS + TX_OUT_MS);
    fixture.detectChanges();
    expect(holo().querySelector('.k')?.textContent).toContain('verse.gates.patches.topic');
    expect(holo().getAttribute('href')).toBe('/verse/patches/4.3');
    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('switches the hero every 7 s, holds while the title is hovered, chevrons step', fakeAsync(() => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const title = (): string | null | undefined => {
      fixture.detectChanges();
      return el.querySelector('.hrow a.tl')?.getAttribute('href');
    };
    expect(title()).toBe('/verse/news?item=n1');
    tick(HERO_MS);
    expect(title()).toBe('/verse/patches/4.3');
    el.querySelector('.hrow')!.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    tick(HERO_MS * 2);
    expect(title()).withContext('held while hovered').toBe('/verse/patches/4.3');
    el.querySelector('.hrow')!.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    el.querySelectorAll<HTMLButtonElement>('.hrow button.step')[0].click();
    expect(title()).toBe('/verse/news?item=n1');
    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('hub columns: heads as anchors, a 4-entry accordion, LIVE feature with verdict chip and the fixed channel slots', fakeAsync(() => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const heads = Array.from(el.querySelectorAll<HTMLAnchorElement>('.hub a.colh')).map((a) => a.getAttribute('href'));
    expect(heads).toEqual(['/verse/news', '/verse/patches', '/verse/gallery']);
    expect(el.querySelectorAll('.acc .acc-i').length).toBe(4);
    expect(el.querySelector('.acc .acc-i.open a')?.getAttribute('href')).toBe('/verse/news?item=f1');
    const feat = el.querySelector<HTMLAnchorElement>('.pcol a.feat')!;
    expect(feat.getAttribute('href')).toBe('/verse/patches/4.3');
    expect(feat.querySelector('.verdict')?.getAttribute('data-verdict')).toBe('shaky');
    expect(feat.querySelector('.kv')?.textContent).toContain('▼ 29');
    expect(feat.querySelector('.kv-d[data-trend="worse"]')).not.toBeNull();
    const slots = Array.from(el.querySelectorAll<HTMLElement>('.pcol .ch')).map((c) => [c.dataset['ch'], c.classList.contains('off')]);
    expect(slots).toEqual([['hotfix', true], ['ptu', false], ['evocati', true]]);
    expect(el.querySelector('.ch.off .quiet')?.textContent).toContain('verse.hub.channelOff');
    expect(el.querySelectorAll('.ch .kv').length).withContext('same grid in every running channel').toBe(1);
    expect(el.querySelector<HTMLAnchorElement>('.gal a.feat')?.getAttribute('href')).toBe('/verse/gallery?image=g1');
    expect(el.querySelectorAll('.mosaic > .blank').length).withContext('never an empty tile').toBe(0);
    expect(el.querySelectorAll('.mosaic > *').length).withContext('one picture only: no mosaic tiles to fill').toBe(0);
    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('splits the hero title into letter spans for the entrance and still exposes the full title once', fakeAsync(() => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const link = el.querySelector<HTMLAnchorElement>('.hrow h1 a.tl');
    const full = fixture.componentInstance.current()?.item.title ?? '';
    expect(full).not.toBe('');
    expect(el.querySelector('.bstage')?.classList.contains('intro')).toBeTrue();
    const letters = Array.from(link?.querySelectorAll<HTMLElement>('i.ltr') ?? []);
    expect(letters.length).toBe(Array.from(full).length);
    expect(letters.every((l) => l.getAttribute('aria-hidden') === 'true')).toBeTrue();
    // The letters carry no-break spaces so a title never collapses its gaps.
    expect(letters.map((l) => l.textContent).join('').replace(/\u00a0/g, ' ')).toBe(full);
    expect(letters[3].style.getPropertyValue('--i')).toBe('3');
    // The accessible name is the title once: the visually hidden copy, letters hidden.
    expect(link?.querySelector('.sc-sr-only')?.textContent).toBe(full);
    // After the sequence the title is plain text again.
    tick(10000);
    fixture.detectChanges();
    expect(el.querySelector('.bstage')?.classList.contains('intro')).toBeFalse();
    expect(el.querySelector('.hrow h1 a.tl i.ltr')).toBeNull();
    // The carousel may have moved on during the wait: compare against the title now shown.
    expect(el.querySelector('.hrow h1 a.tl')?.textContent?.trim()).toBe(fixture.componentInstance.current()?.item.title);
    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('keeps today\'s briefing untouched with the shell beta off', () => {
    beta.set({ verse: true, shell: false });
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nav.moons')).not.toBeNull();
    expect(el.querySelector('.bstage, .hub, .brief-world')).toBeNull();
    expect(el.querySelector('.horizon')).not.toBeNull();
    beta.set({ verse: true, shell: true });
    fixture.destroy();
  });
});

describe('Verse hub — beacons idle hint', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([]), provideTranslateService({})] }));
  afterEach(() => TestBed.resetTestingModule());

  it('fires once after 8 s without scroll or pointer movement, calms down after 5 s, and not again', fakeAsync(() => {
    spyOn(document, 'hasFocus').and.returnValue(true);
    const fixture = TestBed.createComponent(BriefingBeaconsComponent);
    fixture.componentRef.setInput('version', '4.3.1');
    fixture.componentRef.setInput('stability', 50);
    fixture.detectChanges();
    const sun = (): HTMLElement => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('a.sun-l')!;
    tick(IDLE_HINT_MS - 1000);
    window.dispatchEvent(new Event('pointermove'));
    tick(IDLE_HINT_MS - 1000);
    fixture.detectChanges();
    expect(sun().classList).withContext('movement restarted the clock').not.toContain('idle');
    tick(1000);
    fixture.detectChanges();
    expect(sun().classList).toContain('idle');
    expect(sun().querySelector('.ring')).not.toBeNull();
    tick(IDLE_SHOW_MS);
    fixture.detectChanges();
    expect(sun().classList).not.toContain('idle');
    tick(IDLE_HINT_MS * 2);
    fixture.detectChanges();
    expect(sun().classList).withContext('once per visit').not.toContain('idle');
    expect(sun().getAttribute('aria-label')).toContain('verse.hub.sunValue');
    fixture.destroy();
  }));
});
