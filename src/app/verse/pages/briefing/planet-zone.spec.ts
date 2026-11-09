import { Component, signal } from '@angular/core';
import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../../../core/analytics.service';
import { BetaService } from '../../../core/beta.service';
import { AuthService } from '../../../auth/auth.service';
import { NewsListComponent } from '../../../news/news-list.component';
import { PLANET_SOURCES } from './planet/planet-assets';
import { NewsService, VerseNewsItem } from '../../../news/news.service';
import type { PatchLineGroup } from '../../../news/patch-notes';
import { PatchStabilityService } from '../../../news/patch-stability.service';
import { PatchStabilityVotesService } from '../../../news/patch-stability-votes.service';
import type { StabilityVerdict } from '../../../news/patch-stability';
import { VerseApiService } from '../../data/verse-api.service';
import { ShellChromeService } from '../../../shell/fusion-bar/shell-chrome.service';
import { VerseDigest, VerseDigestItem } from '../../data/verse.models';
import { HERO_MS, VerseBriefingComponent } from '../verse-briefing.component';
import { WindowFocusService } from '../../../core/window-focus.service';
import { BriefingBeaconsComponent, IDLE_HINT_MS, IDLE_SHOW_MS } from './briefing-beacons.component';
import { ACC_SLOW_PX_PER_MS, ACC_STOP_MS, ACC_TRANSITION_MS, AccordionIntent } from './briefing-accordion';
import { INTRO_FLAG, VERSE_DOCUMENT_ENTRY } from './briefing.model';
import { BriefingGalleryFillService } from './briefing-gallery-fill.service';
import { VERSE_STAGED_BUILD } from './staged-build';
import {
  holoBody, holoTitle, hubChannel, hubChannels, hubGallery, kickerVersion, lineOf, patchImage, previousLine,
} from './briefing-hub';
import {
  TX_BUILD_MS, TX_CHARGE_MS, TX_GAP_MS, TX_HOLD_MS, TX_PULL_MS, TX_START_MS, TX_UNBUILD_MS, TX_UNCHARGE_MS, TX_UNWRITE_MS, TX_WRITE_MS,
} from './briefing-transmit.component';

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
  it('hands the LIVE row a chip with the previous line as comparison; worse is a trend, never an error', () => {
    const known = ['4.3', '4.2'];
    const v = (l: string): StabilityVerdict | null => ({ '4.3': verdict('4.3', 4, 50, 30), '4.2': verdict('4.2', 2, 79, 16) })[l] ?? null;
    const live = hubChannel('live', { live: '4.3.1' }, known, v);
    expect(live.chip).toEqual(expect.objectContaining({ line: '4.3', percent: 50, previous: 79, previousLabel: '4.2', finished: false }));
    const none = hubChannel('live', { live: '4.3.1' }, known, () => null);
    expect(none.chip).toBeNull();
  });

  it('builds fixed Hotfix / PTU / Evocati slots, each against its own predecessor, quiet when not running', () => {
    const known = ['4.4', '4.3', '4.2'];
    const v = (l: string): StabilityVerdict | null => ({ '4.3': verdict('4.3', 4, 50, 30), '4.2': verdict('4.2', 2, 79, 16) })[l] ?? null;
    const channels = { live: '4.3.1', ptu: '4.4.0', evocati: '4.5' };
    const live = hubChannel('live', channels, known, v);
    expect([live.version, live.line, live.chip?.previousLabel, live.chip?.percent]).toEqual(['4.3.1', '4.3', '4.2', 50]);
    const rows = hubChannels(channels, known, v);
    expect(rows.map((r) => r.kind)).toEqual(['hotfix', 'ptu', 'evocati']);
    expect(rows[0].version, 'no hotfix in the data → quiet slot').toBeNull();
    expect(rows[1].chip?.percent, 'no channelInfo → no number').toBeNull();
    expect(rows[2].chip, 'Evocati never carries a chip').toBeNull();
    expect(hubChannels(null, known, v).every((r) => r.version === null)).toBe(true);
    expect(lineOf('4.3.1')).toBe('4.3');
    expect(previousLine('4.3', known)).toBe('4.2');
    expect(previousLine('4.2', [])).toBe('4.1');
  });

  it('takes the LIVE patch image and falls back to the previous patch; gallery 1 + 6 slots from 14 candidates; kicker prefers the full version', () => {
    expect(patchImage([group('4.4', false, false, [note('ptu.jpg')]), group('4.3', true, true, [note(null)]), group('4.2', false, true, [note('42.jpg')])])).toBe('42.jpg');
    expect(patchImage([group('4.3', true, true, [note('43.jpg')])])).toBe('43.jpg');
    expect(patchImage([])).toBeNull();
    const items = Array.from({ length: 20 }, (_, i) => item(`g${i}`, null, 'gallery', { image: `${i}.jpg`, rank: i }));
    expect(hubGallery(items).length, 'spare candidates beyond the 1 + 6 slots').toBe(14);
    expect(kickerVersion({ live: '4.3.1' }, '4.3')).toBe('4.3.1');
    expect(kickerVersion({}, '4.3')).toBe('4.3');
    expect(holoBody('a '.repeat(100)).length).toBeLessThanOrEqual(112);
    expect(holoTitle('Cargo Hauling – Day 1').length, 'a short title stays whole').toBe(21);
    expect(holoTitle('word '.repeat(40)).length, 'the holo has one size: long titles are capped').toBeLessThanOrEqual(66);
  });
});

describe('Verse hub — accordion hover intent', () => {
  /** Moves the pointer in 16 ms frames from (x, y0) to (x, y1) at `speed` px/ms; `row` maps y to the entry under it. */
  function sweep(acc: AccordionIntent, y0: number, y1: number, speed: number, t0: number, row = (y: number) => Math.floor(y / 50)): number {
    const dir = Math.sign(y1 - y0);
    let t = t0;
    for (let y = y0; dir > 0 ? y <= y1 : y >= y1; y += dir * speed * 16) {
      acc.move(row(y), 10, y, t);
      tick(16);
      t += 16;
    }
    return t;
  }

  it('opens nothing while the pointer sweeps fast across the rows (normal ~1 px/ms)', fakeAsync(() => {
    const acc = new AccordionIntent(0);
    sweep(acc, 199, 0, 1, 1000);
    expect(acc.open()).toBe(0);
    acc.leave();
    tick(ACC_STOP_MS * 4);
    expect(acc.open(), 'leaving after a sweep opens nothing late').toBe(0);
    acc.destroy();
  }));

  it('opens the entry under a slowly moving pointer at once, without a dwell wait', fakeAsync(() => {
    const acc = new AccordionIntent(0);
    // 0.25 px/ms (8 px per 32 ms, above the jitter limit) inside entry 3: opens on the second sample, no timer involved.
    expect(8 / 32).toBeLessThanOrEqual(ACC_SLOW_PX_PER_MS);
    acc.move(3, 10, 190, 1000);
    expect(acc.open(), 'the first sample has no speed yet').toBe(0);
    acc.move(3, 10, 182, 1032);
    expect(acc.open()).toBe(3);
    acc.destroy();
  }));

  it('opens the entry the pointer stops on, after a fast sweep, within the stop tick', fakeAsync(() => {
    const acc = new AccordionIntent(0);
    const t = sweep(acc, 199, 60, 1, 1000);
    expect(acc.open()).toBe(0);
    // Pointer stands still on entry 1: no further pointermove fires.
    tick(ACC_STOP_MS + 1);
    expect(acc.open()).toBe(1);
    // Jitter on the entry counts as standing still.
    tick(ACC_TRANSITION_MS);
    acc.move(2, 10, 120, t + 2000);
    acc.move(2, 12, 121, t + 2005);
    expect(acc.open()).toBe(2);
    acc.destroy();
  }));

  it('finishes a started transition, queues the next target, drops it when the pointer moved on, keeps the open entry on leave', fakeAsync(() => {
    const acc = new AccordionIntent(0);
    acc.move(2, 10, 80, 1000);
    tick(ACC_STOP_MS + 1);
    expect(acc.open()).toBe(2);
    expect(acc.transitioning).toBe(true);
    // A new target during the transition waits for the transition's end.
    acc.move(3, 10, 120, 1100);
    tick(ACC_STOP_MS + 1);
    expect(acc.open()).toBe(2);
    tick(ACC_TRANSITION_MS);
    expect(acc.open()).toBe(3);
    tick(ACC_TRANSITION_MS);
    // A target that was still waiting is dropped when the pointer moved on.
    acc.move(2, 10, 80, 9000);
    tick(ACC_STOP_MS + 1);
    expect(acc.open()).toBe(2);
    acc.move(1, 10, 40, 9100);
    tick(ACC_STOP_MS + 1);
    acc.move(2, 10, 80, 9200);
    tick(ACC_STOP_MS + 1);
    tick(ACC_TRANSITION_MS);
    expect(acc.open()).toBe(2);
    acc.move(1, 10, 40, 10000);
    acc.leave();
    tick(ACC_TRANSITION_MS * 2 + ACC_STOP_MS);
    expect(acc.open()).toBe(2);
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
    sessionStorage.setItem(INTRO_FLAG, '1');
    TestBed.configureTestingModule({
      providers: [
        { provide: VERSE_STAGED_BUILD, useValue: false },
        { provide: VERSE_DOCUMENT_ENTRY, useValue: () => ({ bare: true, revisit: false }) },
        provideRouter([]),
        provideTranslateService({}),
        // A real download settles outside fakeAsync's clock: generate the planet in fake time instead.
        { provide: PLANET_SOURCES, useValue: () => Promise.reject(new Error('specs generate the planet')) },
        { provide: AnalyticsService, useValue: { captureVerse: vi.fn(), flags: () => ({}) } },
        { provide: BriefingGalleryFillService, useValue: { items: signal<VerseDigestItem[]>([]), load: () => Promise.resolve() } },
        { provide: BetaService, useValue: { isEnabled: (a: string) => () => !!beta()[a] } },
        { provide: AuthService, useValue: { isAuthenticated: signal(false), user: signal(null) } },
        { provide: PatchStabilityVotesService, useValue: { line: () => null, correctionFor: () => null, ensure: () => undefined } },
        {
          provide: PatchStabilityService,
          useValue: {
            load: vi.fn().mockResolvedValue(undefined), allTime: () => [], thresholds: () => ({ stabilMin: 75, wackeligMin: 45, rolling: false }), previousOf: () => null,
            verdictFor: (l: string) => (l === '4.3' ? verdict('4.3', 3, 50, 30) : l === '4.2' ? verdict('4.2', 2, 79, 16) : null),
          },
        },
        {
          provide: VerseApiService,
          useValue: {
            digest: signal(digest), digestState: signal('ready'), digestError: signal(null),
            seen: signal(new Set<string>()), topItems: signal(items.slice(0, 3)),
            explorer: signal(null), explorerState: signal('idle'), loadExplorer: vi.fn(),
            loadDigest: vi.fn(), loadSeen: vi.fn(),
            markSeen: vi.fn().mockResolvedValue({ ok: true, data: undefined }), trackShown: () => () => undefined,
          },
        },
        {
          provide: NewsService,
          useValue: {
            feed: signal(null), loading: signal(false), error: signal(null), stage: signal(null), stream: signal(feedNews), streamCount: signal(5),
            patchLines: signal([group('4.4', false, false), group('4.3', true, true), group('4.2', false, true)]), refresh: vi.fn(),
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

  it('builds in steps: the stage first, then doors and beacons, the hub last, and the page keeps its height meanwhile', async () => {
    TestBed.overrideProvider(VERSE_STAGED_BUILD, { useValue: true });
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.bstage')).not.toBeNull();
    expect(el.querySelector('sc-briefing-transmit, sc-briefing-beacons, sc-briefing-hub')).toBeNull();
    expect(el.querySelector('.hub-hold')).not.toBeNull();
    for (let i = 0; i < 40 && !el.querySelector('sc-briefing-hub'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      fixture.detectChanges();
    }
    expect(el.querySelector('sc-briefing-transmit')).not.toBeNull();
    expect(el.querySelector('sc-briefing-beacons')).not.toBeNull();
    expect(el.querySelector('sc-briefing-hub')).not.toBeNull();
    expect(el.querySelector('.hub-hold')).toBeNull();
    fixture.destroy();
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
    // The HQ station: a real anchor to /hq; signed out its one line is the all-clear.
    expect(el.querySelector<HTMLAnchorElement>('a.hq-l')?.getAttribute('href')).toBe('/hq');
    expect(el.querySelector('a.hq-l')?.getAttribute('aria-label')).toBe('verse.hub.hq · verse.hub.hqCalm');
    expect(el.querySelectorAll('a.hq-l .lab-v').length).toBe(1);
    expect(el.querySelector<HTMLAnchorElement>('.hrow h1 a.tl')?.getAttribute('href')).toBe('/verse/news?item=n1');
    expect(el.querySelector('.kick')?.textContent).toContain('verse.hub.area.news');
    expect(el.querySelectorAll('.hrow button.step').length).toBe(2);
    expect(el.querySelector('button.find'), 'the search stands in the shell stage slot').toBeNull();
    expect(el.querySelector('.cta, .sbar, .pause'), 'no CTA, story bars or pause').toBeNull();
    const planets = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.pl')).map((a) => [a.dataset['door'], a.getAttribute('href')]);
    expect(planets).toEqual([['news', '/verse/news'], ['patches', '/verse/patches'], ['gallery', '/verse/gallery']]);
    expect(el.querySelector<HTMLAnchorElement>('a.holo')?.getAttribute('href')).toBe('/verse/news?item=f1');
    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('the page stands, 5 s later the first planet ignites; nothing is projected before', fakeAsync(() => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.componentInstance.stands.set(true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tx = (): HTMLElement => el.querySelector<HTMLElement>('sc-briefing-transmit')!;
    const phase = (): string | undefined => {
      fixture.detectChanges();
      return tx().dataset['phase'];
    };
    expect(phase()).toBe('rest');
    tick(TX_START_MS);
    expect(phase(), 'a short visit stands at once: its 5 s clock runs').toBe('charge');
    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('cycles newest first: charge, build, write, pull back, hold 5 s, projected away, 5 s pause, the next planet', fakeAsync(() => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.componentInstance.stands.set(true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const holo = (): HTMLElement => el.querySelector<HTMLElement>('a.holo')!;
    const phase = (): string | undefined => {
      fixture.detectChanges();
      return el.querySelector<HTMLElement>('sc-briefing-transmit')!.dataset['phase'];
    };
    const cueGone = (): boolean => {
      fixture.detectChanges();
      fixture.detectChanges();
      return el.querySelector('button.more-cue')!.classList.contains('gone');
    };
    expect(phase()).toBe('rest');
    tick(TX_START_MS);
    expect(phase()).toBe('charge');
    expect(cueGone(), 'no message on screen yet → the "more" cue stands').toBe(false);
    expect(el.querySelector('a.pl[data-door="news"]')?.classList, 'the newest content sends first').toContain('send');
    tick(TX_CHARGE_MS);
    expect(phase()).toBe('build');
    expect(cueGone(), 'the cue stands under a visible message too').toBe(false);
    tick(TX_BUILD_MS);
    expect(phase()).toBe('write');
    expect(holo().querySelector('.b')?.textContent, 'the whole text is there, the scan line reveals it').toBe('Short summary.');
    tick(TX_WRITE_MS);
    expect(phase()).toBe('pull');
    tick(TX_PULL_MS);
    expect(phase()).toBe('hold');
    expect(el.querySelector('a.pl[data-door="news"]')?.classList).not.toContain('send');
    tick(TX_HOLD_MS);
    expect(phase(), 'projected away with the projection reversed').toBe('unwrite');
    tick(TX_UNWRITE_MS);
    expect(phase()).toBe('unbuild');
    tick(TX_UNBUILD_MS);
    expect(phase()).toBe('uncharge');
    tick(TX_UNCHARGE_MS);
    expect(phase(), '5 s without projection and panel').toBe('rest');
    tick(TX_GAP_MS - 1);
    expect(phase()).toBe('rest');
    tick(1);
    expect(phase()).toBe('charge');
    fixture.detectChanges();
    expect(holo().querySelector('.k')?.textContent, 'the next planet').not.toContain('verse.gates.news.topic');
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
    expect(title(), 'held while hovered').toBe('/verse/patches/4.3');
    el.querySelector('.hrow')!.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    el.querySelectorAll<HTMLButtonElement>('.hrow button.step')[0].click();
    expect(title()).toBe('/verse/news?item=n1');
    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('holds the hero without the window focus, and gives it a full turn when focus returns', fakeAsync(() => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const focus = TestBed.inject(WindowFocusService);
    const title = (): string | null | undefined => {
      fixture.detectChanges();
      return el.querySelector('.hrow a.tl')?.getAttribute('href');
    };
    expect(title()).toBe('/verse/news?item=n1');
    focus.focused.set(false);
    fixture.detectChanges();
    tick(HERO_MS * 2);
    expect(title(), 'no focus').toBe('/verse/news?item=n1');
    focus.focused.set(true);
    fixture.detectChanges();
    tick(HERO_MS - 1);
    expect(title(), 'full turn').toBe('/verse/news?item=n1');
    tick(1);
    expect(title()).toBe('/verse/patches/4.3');
    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('hub columns: heads as anchors, a 4-entry accordion, LIVE feature with its stability chip and the fixed channel slots', fakeAsync(() => {
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
    const chip = feat.querySelector('sc-stability-chip .chip')!;
    expect(chip.getAttribute('data-word')).toBe('wackelig');
    expect(chip.querySelector('.ind')?.textContent, ' 50 % against 79 % of 4.2').toBe('▼');
    expect(feat.querySelector('a.chip'), 'the row is the link, no anchor inside an anchor').toBeNull();
    expect(el.querySelector('.kv, .verdict')).toBeNull();
    const slots = Array.from(el.querySelectorAll<HTMLElement>('.pcol .ch')).map((c) => [c.dataset['ch'], c.classList.contains('off')]);
    expect(slots).toEqual([['hotfix', true], ['ptu', false], ['evocati', true]]);
    expect(el.querySelector('.ch.off .quiet')?.textContent).toContain('verse.hub.channelOff');
    expect(el.querySelectorAll('.ch .ch-chip').length, 'the running PTU row carries a chip, Evocati none').toBe(1);
    expect(el.querySelector<HTMLAnchorElement>('.gal a.feat')?.getAttribute('href')).toBe('/verse/gallery?image=g1');
    expect(el.querySelectorAll('.mosaic > .blank').length, 'never an empty tile').toBe(0);
    expect(el.querySelectorAll('.mosaic > *').length, 'one picture only: no mosaic tiles to fill').toBe(0);
    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('spells the app name in letter spans for the entrance, exposes it once, then shows the story as plain text', fakeAsync(() => {
    sessionStorage.removeItem(INTRO_FLAG);
    // The shell announces the entrance at boot when the page opens on the hub.
    TestBed.inject(ShellChromeService).holdHeroIntro();
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const name = 'verse.hub.brand'; // no catalogue loaded here: the key is the text
    expect(el.querySelector('.bstage')?.classList.contains('intro')).toBe(true);
    const brand = el.querySelector<HTMLElement>('.hrow h1 .tl.brand');
    const letters = Array.from(brand?.querySelectorAll<HTMLElement>('i.ltr') ?? []);
    expect(letters.length).toBe(Array.from(name).length);
    expect(letters.every((l) => l.getAttribute('aria-hidden') === 'true')).toBe(true);
    // The letters carry no-break spaces so the name never collapses its gaps.
    expect(letters.map((l) => l.textContent).join('').replace(/\u00a0/g, ' ')).toBe(name);
    expect(letters[3].style.getPropertyValue('--i')).toBe('3');
    // The accessible name is the app name once: the visually hidden copy, letters hidden.
    expect(brand?.querySelector('.sc-sr-only')?.textContent).toBe(name);
    // After the entrance the hero carries the story, as plain text.
    tick(10000);
    fixture.detectChanges();
    expect(el.querySelector('.bstage')?.classList.contains('intro')).toBe(false);
    expect(el.querySelector('.hrow h1 i.ltr')).toBeNull();
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
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const fixture = TestBed.createComponent(BriefingBeaconsComponent);
    fixture.componentRef.setInput('version', '4.3.1');
    fixture.componentRef.setInput('stability', 50);
    fixture.detectChanges();
    const sun = (): HTMLElement => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('a.sun-l')!;
    tick(IDLE_HINT_MS - 1000);
    window.dispatchEvent(new Event('pointermove'));
    tick(IDLE_HINT_MS - 1000);
    fixture.detectChanges();
    expect(sun().classList, 'movement restarted the clock').not.toContain('idle');
    tick(1000);
    fixture.detectChanges();
    expect(sun().classList).toContain('idle');
    expect(sun().querySelector('.ring')).not.toBeNull();
    tick(IDLE_SHOW_MS);
    fixture.detectChanges();
    expect(sun().classList).not.toContain('idle');
    tick(IDLE_HINT_MS * 2);
    fixture.detectChanges();
    expect(sun().classList, 'once per visit').not.toContain('idle');
    expect(sun().getAttribute('aria-label')).toContain('verse.hub.sunValue');
    fixture.destroy();
  }));
});
