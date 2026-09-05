import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { TranslateModule, TranslateService, TranslationObject } from '@ngx-translate/core';
import { of } from 'rxjs';
import { NewsListComponent } from './news-list.component';
import { PatchMonitorComponent } from './patch-monitor.component';
import { NewsService, VerseFeed, VerseNewsItem } from './news.service';
import { ConsentService } from '../core/consent.service';
import { UpcomingShipsService } from '../codex/upcoming-ships.service';
import { groupPatchNotes } from './patch-notes';
import { buildPatchStack } from './patch-stack';
import { buildPatchCycle } from './patch-cycle';
import { buildVerdict } from './news-stage';
import {
  computeNextPatch,
  computePatchForecast,
  daysUntilNextPatch,
  nextPatchDistance,
} from './patch-stats';

/**
 * "warum 20 tage vs 6 wochen. ich denke eins davon ist nicht aktuell"
 * (admin feedback ae9f8cba, 2026-09-06).
 *
 * Two surfaces answer "wann kommt der naechste Patch?" — the Build-Stand card
 * on /news and the monitor panel on /news/patches — and on the same afternoon
 * they printed two different dates. Neither was stale. They were computing two
 * different things:
 *
 *   · the card ran the version-level forecast row, so a POINT release sitting
 *     in the PTU (4.10.1) was carried to release by the median lead time and
 *     printed under the heading "naechster Hauptpatch";
 *   · the panel ran the line-level cycle: the live LINE's release plus the
 *     median LINE cadence.
 *
 * They also phrased the distance differently — days on one side, weeks on the
 * other — so even an identical date would have read as two claims.
 *
 * These specs pin the fix at the level the drift happened: not "the helper
 * returns 42", but "the two rendered surfaces say the same thing". The feed
 * below reproduces the reported situation, so the pre-fix code fails the very
 * first assertion.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

function patch(id: string, title: string, publishedAt: string): VerseNewsItem {
  return {
    id,
    title,
    url: 'https://robertsspaceindustries.com/spectrum/' + id,
    publishedAt,
    channel: 'patch',
    source: 'patch-notes',
  };
}

function article(): VerseNewsItem {
  return {
    id: 'a1',
    title: 'An article',
    url: 'https://robertsspaceindustries.com/comm-link/a1',
    publishedAt: daysAgo(0),
    channel: 'comm-link',
    source: 'comm-link',
    thumbnail: 'https://example.test/a1.jpg',
    images: ['https://example.test/a1.jpg'],
  } as VerseNewsItem;
}

/**
 * The reported situation: 4.10 has been live for eleven days, and 4.10.1 — a
 * POINT release, not a main patch — went into the PTU five days ago.
 *
 * Line cadence: 4.8 → 4.9 = 57 d, 4.9 → 4.10 = 48 d, median 52.5 → the next
 * main patch lands ~42 days out ("in ~6 Wochen").
 * Median lead time: 12 / 21 / 23 d, median 21 → the pre-fix card dated 4.10.1's
 * release instead and printed "in 16 Tagen" under "naechster Hauptpatch".
 */
const POINT_RELEASE_IN_PTU: VerseNewsItem[] = [
  article(),
  patch('p48', '[Wave 1] Star Citizen Alpha 4.8 PTU Patch Notes 11800000', daysAgo(128)),
  patch('l48', 'Star Citizen Alpha 4.8 LIVE Release Notes', daysAgo(116)),
  patch('p49', '[Wave 1] Star Citizen Alpha 4.9 PTU Patch Notes 12107679', daysAgo(80)),
  patch('l49', 'Star Citizen Alpha 4.9 LIVE Release Notes', daysAgo(59)),
  patch('p410', '[All Waves] Star Citizen Alpha 4.10 PTU Patch Notes 12479687', daysAgo(34)),
  patch('l410', 'Star Citizen Alpha 4.10 LIVE Release Notes', daysAgo(11)),
  patch('p4101', '[Wave 1] Star Citizen Alpha 4.10.1 PTU Patch Notes 12600000', daysAgo(5)),
];

/** The same feed plus a real next LINE in the test ring — 4.11, four days in. */
const MAIN_LINE_IN_PTU: VerseNewsItem[] = [
  ...POINT_RELEASE_IN_PTU,
  patch('p411', '[Wave 1] Star Citizen Alpha 4.11 PTU Patch Notes 12700000', daysAgo(4)),
];

function feed(news: VerseNewsItem[]): VerseFeed {
  return { status: null, fetchedAt: new Date().toISOString(), news } as VerseFeed;
}

function notesOf(news: VerseNewsItem[]) {
  return groupPatchNotes(news.filter((n) => n.channel === 'patch'));
}

describe('Next main patch — one estimate, two surfaces (feedback ae9f8cba)', () => {
  let de: TranslationObject;

  beforeAll(async () => {
    const res = await fetch('/i18n/de.json');
    expect(res.ok).withContext('public/i18n must be served to Karma').toBeTrue();
    de = await res.json();
  });

  let listFixture: ComponentFixture<NewsListComponent> | null = null;
  let monitorFixture: ComponentFixture<PatchMonitorComponent> | null = null;

  afterEach(() => {
    listFixture?.destroy();
    monitorFixture?.destroy();
    listFixture = null;
    monitorFixture = null;
    localStorage.clear();
  });

  /** The Build-Stand card on /news, rendered from the real German bundle. */
  async function verdictCard(news: VerseNewsItem[]): Promise<{ line: string; basis: string }> {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NewsListComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        NewsService,
        { provide: HttpClient, useValue: { get: () => of(feed(news)) } },
        { provide: ConsentService, useValue: { preferencesAllowed: () => false } },
        {
          provide: UpcomingShipsService,
          useValue: {
            diff: () => ({ added: [], favoriteUpdates: [] }),
            notificationCount: () => 0,
            feed: () => ({ ships: [] }),
            refresh: async () => undefined,
            isFavorite: () => false,
            acknowledge: () => undefined,
          },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', de);
    translate.use('de');
    listFixture = TestBed.createComponent(NewsListComponent);
    listFixture.detectChanges();
    // The component polls on an interval, so whenStable() never settles.
    for (let i = 0; i < 4; i++) await Promise.resolve();
    listFixture.detectChanges();
    const root = listFixture.nativeElement as HTMLElement;
    return {
      line: root.querySelector('.verdict-line')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      basis: root.querySelector('.verdict-basis')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    };
  }

  /** The "Wann kommt der naechste Patch?" panel on /news/patches. */
  function monitorPanel(news: VerseNewsItem[]): { date: string; when: string } {
    const groups = notesOf(news);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [PatchMonitorComponent, TranslateModule.forRoot()] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', de);
    translate.use('de');
    monitorFixture = TestBed.createComponent(PatchMonitorComponent);
    monitorFixture.componentRef.setInput('stack', buildPatchStack(groups, null));
    monitorFixture.componentRef.setInput('groups', groups);
    monitorFixture.componentRef.setInput('now', NOW);
    monitorFixture.detectChanges();
    const answer = (monitorFixture.nativeElement as HTMLElement).querySelector('.answer');
    return {
      date: answer?.querySelector('b')?.textContent?.trim() ?? '',
      when: answer?.querySelector('span')?.textContent?.trim() ?? '',
    };
  }

  /** What the shared estimate says, phrased the one way the app phrases it. */
  function expectedWhen(news: VerseNewsItem[]): string {
    const est = computeNextPatch(notesOf(news))!;
    const d = nextPatchDistance(daysUntilNextPatch(est, NOW));
    expect(d.unit).withContext('the fixtures sit in the weeks bucket').toBe('weeks');
    return 'in ~' + d.n + ' Wochen';
  }

  it('states the SAME distance on both surfaces while a point release is in the PTU', async () => {
    const when = expectedWhen(POINT_RELEASE_IN_PTU);
    const panel = monitorPanel(POINT_RELEASE_IN_PTU);
    const card = await verdictCard(POINT_RELEASE_IN_PTU);

    expect(panel.when).withContext('monitor panel').toBe(when);
    expect(card.line).withContext('build-stand card').toContain(when);
    // The regression itself: 4.10.1's PTU thread must not date the MAIN patch.
    expect(card.line).not.toMatch(/in \d+ Tagen/);
  });

  it('states the SAME distance on both surfaces once 4.11 is in the test ring', async () => {
    const when = expectedWhen(MAIN_LINE_IN_PTU);
    const panel = monitorPanel(MAIN_LINE_IN_PTU);
    const card = await verdictCard(MAIN_LINE_IN_PTU);

    expect(panel.when).withContext('monitor panel').toBe(when);
    expect(card.line).withContext('build-stand card').toContain(when);
  });

  it('names the measurement it used instead of always saying "Kadenz"', async () => {
    // Nothing but a point release in testing → the number IS the line cadence.
    expect((await verdictCard(POINT_RELEASE_IN_PTU)).basis)
      .toBe('Schätzung aus der bisherigen Patch-Kadenz');
    // 4.11 in the ring → the number is that build plus the usual test run, and
    // the caption may not keep claiming it came from the cadence.
    const withNextLine = (await verdictCard(MAIN_LINE_IN_PTU)).basis;
    expect(withNextLine).toContain('Alpha 4.11 im Test');
    expect(withNextLine).not.toContain('Kadenz');
  });

  it('anchors the monitor rail on the very instant the estimate names', () => {
    for (const news of [POINT_RELEASE_IN_PTU, MAIN_LINE_IN_PTU]) {
      const groups = notesOf(news);
      const est = computeNextPatch(groups)!;
      const stack = buildPatchStack(groups, null);
      const anchored = [stack.next, stack.live].find((c) => c?.line === est.anchorLine)!;
      const cycle = buildPatchCycle(anchored, groups, NOW)!;
      // The rail's goal marker is the headline date — not a second estimate.
      expect(cycle.points.find((p) => p.key === 'usual')!.at)
        .withContext('anchored on ' + est.anchorLine)
        .toBe(est.at);
      expect(cycle.daysToNext).toBe(daysUntilNextPatch(est, NOW));
    }
  });

  it('feeds the verdict card and the forecast table from the same estimate', () => {
    for (const news of [POINT_RELEASE_IN_PTU, MAIN_LINE_IN_PTU]) {
      const groups = notesOf(news);
      const est = computeNextPatch(groups)!;
      const verdict = buildVerdict(groups, NOW);
      expect(verdict.nextLiveAt).toBe(est.atIso);
      expect(verdict.daysUntilLive).toBe(daysUntilNextPatch(est, NOW));
      expect(verdict.medianDays).toBe(est.medianDays);
      expect(verdict.nextBasis).toBe(est.basis);
      expect(computePatchForecast(groups).find((r) => r.key === 'live')!.at).toBe(est.atIso);
    }
  });

  it('reads a point release in the PTU as a point release, not as the next line', () => {
    const est = computeNextPatch(notesOf(POINT_RELEASE_IN_PTU))!;
    expect(est.basis).toBe('cadence');
    expect(est.anchorLine).toBe('4.10');
    expect(est.medianDays).toBe(52.5);
  });

  it('prefers a main line already in the ring — that build demonstrably exists', () => {
    const est = computeNextPatch(notesOf(MAIN_LINE_IN_PTU))!;
    expect(est.basis).toBe('leadTime');
    expect(est.anchorLine).toBe('4.11');
    expect(est.medianDays).toBe(21);
  });

  it('degrades to no estimate rather than inventing one', () => {
    expect(computeNextPatch([])).toBeNull();
  });
});

describe('nextPatchDistance — one grammar for every surface', () => {
  it('counts days inside a fortnight and weeks beyond it', () => {
    expect(nextPatchDistance(0)).toEqual({ unit: 'today', n: 0, overdue: false });
    expect(nextPatchDistance(13)).toEqual({ unit: 'days', n: 13, overdue: false });
    expect(nextPatchDistance(14)).toEqual({ unit: 'weeks', n: 2, overdue: false });
    expect(nextPatchDistance(41)).toEqual({ unit: 'weeks', n: 6, overdue: false });
  });

  it('carries overdue as a direction, never as a negative count', () => {
    expect(nextPatchDistance(-3)).toEqual({ unit: 'days', n: 3, overdue: true });
    expect(nextPatchDistance(-30)).toEqual({ unit: 'weeks', n: 4, overdue: true });
  });
});
