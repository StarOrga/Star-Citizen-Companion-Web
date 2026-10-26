import { Component, signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../../../core/analytics.service';
import { BetaService } from '../../../core/beta.service';
import { AuthService } from '../../../auth/auth.service';
import { NewsListComponent } from '../../../news/news-list.component';
import { NewsService } from '../../../news/news.service';
import type { PatchLineGroup } from '../../../news/patch-notes';
import { PatchStabilityService } from '../../../news/patch-stability.service';
import type { StabilityVerdict } from '../../../news/patch-stability';
import { VerseApiService } from '../../data/verse-api.service';
import { VerseDigest, VerseDigestItem } from '../../data/verse.models';
import { VerseBriefingComponent } from '../verse-briefing.component';
import { INTRO_FLAG } from './briefing.model';
import { FOR_YOU_AWAY_MS, forYouQueue, forYouStorageKey, pickForYou, readForYou, writeForYou } from './briefing-for-you';
import { GATE_LABEL_MS, hubGallery, hubPatches, issuesKey, kickerVersion } from './briefing-hub';

@Component({ selector: 'sc-news-list', standalone: true, template: '' })
class NewsListStub {}

const item = (key: string, at: string | null, kind: VerseDigestItem['kind'] = 'news', extra: Partial<VerseDigestItem> = {}): VerseDigestItem => ({
  key, kind, title: `T ${key}`, url: `/verse/news?item=${key}`, summary: null, image: null, at, pinned: false, score: 1, rank: 1, ...extra,
});

const group = (line: string, isCurrentLive: boolean, hasLive: boolean): PatchLineGroup => ({
  line, segments: line.split('.').map(Number), entries: [], latestAt: '2026-10-20', hasLive, isCurrentLive,
});

const verdict = (line: string, level: 1 | 2 | 3 | 4 | 5 | null, stability: number | null, insufficient = false): StabilityVerdict =>
  ({ line, level, stability, insufficient } as unknown as StabilityVerdict);

describe('Verse hub — for-you line', () => {
  const q = [item('a', '2026-10-01'), item('b', '2026-10-02'), item('c', '2026-10-03')];

  it('queues unread items oldest first and leaves the hero stories for last', () => {
    const items = [item('c', '2026-10-03'), item('a', '2026-10-01'), item('b', '2026-10-02'), item('a', '2026-10-01')];
    expect(forYouQueue(items, new Set(['b'])).map((i) => i.key)).toEqual(['a', 'c']);
    expect(forYouQueue(items, new Set(), new Set(['a'])).map((i) => i.key)).toEqual(['b', 'c']);
    expect(forYouQueue(items, new Set(['b', 'c']), new Set(['a'])).map((i) => i.key)).toEqual(['a']);
  });

  it('keeps the line while the reader is here or was away < 30 min, moves on after', () => {
    const now = Date.parse('2026-10-26T12:00:00Z');
    expect(pickForYou(q, { key: null, at: null, awayAt: null }, now)).toBe(0);
    expect(pickForYou(q, { key: 'b', at: q[1].at, awayAt: null }, now)).toBe(1);
    expect(pickForYou(q, { key: 'b', at: q[1].at, awayAt: now - FOR_YOU_AWAY_MS + 1000 }, now)).toBe(1);
    expect(pickForYou(q, { key: 'b', at: q[1].at, awayAt: now - FOR_YOU_AWAY_MS }, now)).toBe(2);
    expect(pickForYou(q, { key: 'c', at: q[2].at, awayAt: now - FOR_YOU_AWAY_MS }, now)).withContext('wraps').toBe(0);
    expect(pickForYou([], { key: 'c', at: null, awayAt: null }, now)).toBeNull();
  });

  it('never skips an unread one: a read item hands over to the next after its place', () => {
    const now = Date.now();
    // 'b' was read: the line continues with 'c', not back at 'a' nor past 'c'.
    const rest = q.filter((i) => i.key !== 'b');
    expect(rest[pickForYou(rest, { key: 'b', at: q[1].at, awayAt: null }, now)!].key).toBe('c');
    // A full cycle of 30-min absences visits every unread item once.
    const visited: string[] = [];
    let st = { key: 'a' as string | null, at: q[0].at, awayAt: null as number | null };
    for (const _ of q) {
      void _;
      const i = pickForYou(q, { ...st, awayAt: now - FOR_YOU_AWAY_MS }, now)!;
      visited.push(q[i].key);
      st = { key: q[i].key, at: q[i].at, awayAt: null };
    }
    expect([...visited].sort()).toEqual(['a', 'b', 'c']);
  });

  it('persists per viewer and survives broken storage', () => {
    const key = forYouStorageKey('u1');
    expect(key).not.toBe(forYouStorageKey(null));
    writeForYou(key, { key: 'x', at: '2026-10-01', awayAt: 5 });
    expect(readForYou(key)).toEqual({ key: 'x', at: '2026-10-01', awayAt: 5 });
    localStorage.setItem(key, '{nope');
    expect(readForYou(key)).toEqual({ key: null, at: null, awayAt: null });
    localStorage.removeItem(key);
  });
});

describe('Verse hub — sections model', () => {
  it('speaks in words: qualitative issues, the number only alongside, PTU without a verdict', () => {
    const groups = [group('4.4', false, false), group('4.3', true, true), group('4.2', false, true), group('4.1', false, true)];
    const verdicts: Record<string, StabilityVerdict> = { '4.3': verdict('4.3', 2, 82), '4.2': verdict('4.2', null, null, true) };
    const out = hubPatches(groups, (l) => verdicts[l] ?? null);
    expect(out.map((p) => [p.line, p.state, p.issuesKey, p.stability])).toEqual([
      ['4.4', 'ptu', null, null],
      ['4.3', 'live', 'verse.hub.issues.2', 82],
      ['4.2', 'past', 'verse.hub.issues.early', null],
    ]);
    expect(issuesKey(null)).toBeNull();
    expect(hubPatches(groups.slice(0, 1), () => null).length).toBe(1);
  });

  it('gallery previews only images; the kicker prefers the full LIVE version', () => {
    const items = [item('g2', null, 'gallery', { image: 'b.jpg', rank: 2 }), item('n', null), item('g1', null, 'gallery', { image: 'a.jpg', rank: 1 }), item('g3', null, 'gallery')];
    expect(hubGallery(items).map((i) => i.key)).toEqual(['g1', 'g2']);
    expect(kickerVersion({ live: '4.3.1' }, '4.3')).toBe('4.3.1');
    expect(kickerVersion({}, '4.3')).toBe('4.3');
  });
});

describe('Verse hub — planet zone (beta shell)', () => {
  const beta = signal<Record<string, boolean>>({ verse: true, shell: true });
  const items = [
    item('n1', '2026-10-20', 'news'),
    item('p1', '2026-10-21', 'patch', { url: '/verse/patches/4.3' }),
    item('g1', '2026-10-22', 'gallery', { url: '/verse/gallery?image=g1', image: 'g1.jpg' }),
    item('n2', '2026-10-10', 'news'),
  ];
  const digest: VerseDigest = {
    generatedAt: '', items, suggested: 4, patch: { line: '4.3', liveAt: null, channels: { live: '4.3.1' }, status: 'live' },
    counts: { news: { recent: 4 }, patches: { recent: 2 }, gallery: { recent: 7 } },
  };

  beforeEach(() => {
    sessionStorage.removeItem(INTRO_FLAG);
    localStorage.removeItem(forYouStorageKey(null));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: AnalyticsService, useValue: { captureVerse: jasmine.createSpy(), flags: () => ({}) } },
        { provide: BetaService, useValue: { isEnabled: (a: string) => () => !!beta()[a] } },
        { provide: AuthService, useValue: { isAuthenticated: signal(false), user: signal(null) } },
        { provide: PatchStabilityService, useValue: { load: jasmine.createSpy().and.resolveTo(), verdictFor: (l: string) => (l === '4.3' ? verdict('4.3', 2, 82) : null) } },
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
            feed: signal(null), loading: signal(false), error: signal(null), stage: signal(null), stream: signal([]), streamCount: signal(0),
            patchLines: signal([group('4.4', false, false), group('4.3', true, true)]), refresh: jasmine.createSpy(),
          },
        },
      ],
    });
    TestBed.overrideComponent(VerseBriefingComponent, { remove: { imports: [NewsListComponent] }, add: { imports: [NewsListStub] } });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.removeItem(INTRO_FLAG);
    localStorage.removeItem(forYouStorageKey(null));
  });

  it('replaces the moon band with holo labels as real anchors, one shown at a time, relayed in turn', fakeAsync(() => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nav.moons')).toBeNull();
    const labels = Array.from(el.querySelectorAll<HTMLAnchorElement>('.pz a.holo'));
    expect(labels.map((a) => a.getAttribute('href'))).toEqual(['/verse/news', '/verse/patches', '/verse/gallery']);
    const on = (): string[] => Array.from(el.querySelectorAll<HTMLElement>('.pz a.holo.on')).map((a) => a.dataset['door']!);
    expect(on()).toEqual(['news']);
    tick(GATE_LABEL_MS);
    fixture.detectChanges();
    expect(on()).toEqual(['patches']);
    // Focus holds the relay on what the reader is on.
    labels[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    labels[2].dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(on()).toEqual(['gallery']);
    tick(GATE_LABEL_MS * 2);
    fixture.detectChanges();
    expect(on()).toEqual(['gallery']);
    fixture.destroy();
  }));

  it('shows the Verse kicker without countdown, the personal line, and the hub sections with the gallery last', () => {
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.status')?.textContent).toContain('verse.hub.kicker');
    expect(el.querySelector('.si.due')).toBeNull();
    // Hero shows n1/p1/g1; the personal line takes the unread one left over.
    const fy = el.querySelector<HTMLAnchorElement>('.pz a.fy');
    expect(fy?.getAttribute('href')).toBe('/verse/news?item=n2');
    expect(readForYou(forYouStorageKey(null)).key).toBe('n2');
    const heads = Array.from(el.querySelectorAll('.hub .hs h2')).map((h) => h.id);
    expect(heads).toEqual(['hub-news-h', 'hub-patches-h', 'hub-gallery-h']);
    const more = Array.from(el.querySelectorAll<HTMLAnchorElement>('.hub a.more')).map((a) => a.getAttribute('href'));
    expect(more).toEqual(['/verse/news', '/verse/patches', '/verse/gallery']);
    expect(el.querySelector('.pcard')?.getAttribute('href')).toBe('/verse/patches/4.4');
    expect(el.querySelectorAll('.pcard')[1]?.textContent).toContain('verse.hub.issues.2');
    expect(el.querySelector<HTMLAnchorElement>('.hub a.shot')?.getAttribute('href')).toBe('/verse/gallery?image=g1');
    expect(el.querySelector('button.find')).not.toBeNull();
    fixture.destroy();
  });

  it('keeps today\'s briefing untouched with the shell beta off', () => {
    beta.set({ verse: true, shell: false });
    const fixture = TestBed.createComponent(VerseBriefingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nav.moons')).not.toBeNull();
    expect(el.querySelector('.pz')).toBeNull();
    expect(el.querySelector('.hub')).toBeNull();
    expect(el.querySelector('.horizon')).not.toBeNull();
    beta.set({ verse: true, shell: true });
    fixture.destroy();
  });
});
