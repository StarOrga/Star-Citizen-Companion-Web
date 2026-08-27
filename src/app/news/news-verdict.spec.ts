import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { TranslateModule, TranslateService, TranslationObject } from '@ngx-translate/core';
import { of } from 'rxjs';
import { NewsListComponent } from './news-list.component';
import { NewsService, VerseFeed, VerseNewsItem } from './news.service';
import { ConsentService } from '../core/consent.service';
import { UpcomingShipsService } from '../codex/upcoming-ships.service';

/**
 * The verdict card as it is actually rendered (feedback 2026-08-27).
 *
 * Two asks, one card:
 *  1. The days to the next patch must not be stated twice. They were: the
 *     estimate IS "last release + median", so in the days right after a patch
 *     the sentence read "in 48 Tagen" over a basis line of "Median 49 T".
 *  2. A main patch reaching LIVE — or a new line entering the PTU — must stand
 *     out clearly for its first three days and then fall back to the standard
 *     read, unchanged.
 *
 * These specs assert the DOM, not the signals: the state machine's arithmetic
 * is pinned in news-stage.spec.ts.
 */

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();

function note(id: string, title: string, publishedAt: string): VerseNewsItem {
  return {
    id, title, publishedAt,
    url: `https://robertsspaceindustries.com/${id}`,
    channel: 'patch',
    source: 'patch-notes',
  } as VerseNewsItem;
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

/** A patch history whose 4.10 line went LIVE `liveDaysAgo` days ago. */
function feedWithLiveAge(liveDaysAgo: number): VerseFeed {
  return {
    status: null,
    fetchedAt: new Date().toISOString(),
    news: [
      article(),
      note('n1', 'Star Citizen Alpha 4.8 LIVE Release Notes', daysAgo(160)),
      note('n2', 'Star Citizen Alpha 4.9 LIVE Release Notes', daysAgo(110)),
      note('n3', 'Star Citizen Alpha 4.10 PTU Patch Notes 12442953', daysAgo(liveDaysAgo + 20)),
      note('n4', 'Star Citizen Alpha 4.10 LIVE Release Notes', daysAgo(liveDaysAgo)),
    ],
  } as VerseFeed;
}

/** 4.11 entered the PTU `ptuDaysAgo` days ago; 4.10 has been live for a while. */
function feedWithPtuAge(ptuDaysAgo: number): VerseFeed {
  return {
    status: null,
    fetchedAt: new Date().toISOString(),
    news: [
      article(),
      note('n1', 'Star Citizen Alpha 4.9 LIVE Release Notes', daysAgo(110)),
      note('n2', 'Star Citizen Alpha 4.10 LIVE Release Notes', daysAgo(60)),
      note('n3', 'Star Citizen Alpha 4.11 PTU Patch Notes 12600000', daysAgo(ptuDaysAgo)),
    ],
  } as VerseFeed;
}

describe('Verse News — the build-status card', () => {
  let fixture: ComponentFixture<NewsListComponent>;
  /**
   * The REAL German bundle, not a stand-in. `public/**` is a test asset, so the
   * card renders the shipped strings — which is what makes "the number is not
   * stated twice" assertable at all, and what would fail if someone put
   * "Median {{median}} T" back into the basis line.
   */
  let de: TranslationObject;

  beforeAll(async () => {
    const res = await fetch('/i18n/de.json');
    expect(res.ok).withContext('public/i18n/de.json must be served to Karma').toBeTrue();
    de = await res.json();
  });

  async function render(feed: VerseFeed): Promise<void> {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NewsListComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        NewsService,
        { provide: HttpClient, useValue: { get: () => of(feed) } },
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
    fixture = TestBed.createComponent(NewsListComponent);
    fixture.detectChanges();
    // The component polls on a 5-min interval, so `whenStable()` never settles —
    // drain the microtask queue instead: `refresh()` resolves off a sync observable.
    for (let i = 0; i < 4; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
    localStorage.clear();
  });

  function el<T extends HTMLElement>(selector: string): T | null {
    return fixture.nativeElement.querySelector(selector) as T | null;
  }

  function verdictText(): string {
    return el('.verdict')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('states the days to the next patch exactly once', async () => {
    await render(feedWithLiveAge(40));   // outside the fresh window: standard read
    expect(el('.verdict')!.classList).not.toContain('fresh');
    const line = el('.verdict-line')!.textContent!;
    const basis = el('.verdict-basis')?.textContent ?? '';
    // The sentence owns the countdown…
    expect(line).toMatch(/in \d+ Tagen/);
    // …and the basis no longer restates it as the median it was derived from.
    expect(basis).not.toMatch(/\d/);
    expect(basis.toLowerCase()).not.toContain('median');
    expect(basis).toContain('Schätzung');
  });

  it('marks a main patch that just landed and drops the countdown while it does', async () => {
    await render(feedWithLiveAge(0));
    const card = el('.verdict')!;
    expect(card.classList).toContain('fresh');
    expect(card.getAttribute('data-fresh')).toBe('live');
    expect(el('.verdict .pulse')).not.toBeNull();
    expect(el('.verdict-label')!.textContent).toContain('Neuer Patch live');
    expect(el('.verdict-line')!.textContent).toContain('Alpha 4.10 ist jetzt live');
    expect(el('.verdict-basis')!.textContent).toContain('Seit heute');
    // No countdown at all while the release is the news — which is also what
    // makes a second statement of the same number impossible.
    expect(verdictText()).not.toMatch(/nächster Hauptpatch/);
    expect(el('.verdict-link')!.textContent).toContain('Patch-Notes lesen');
  });

  it('counts the days while it celebrates', async () => {
    await render(feedWithLiveAge(2));
    expect(el('.verdict')!.classList).toContain('fresh');
    expect(el('.verdict-basis')!.textContent).toContain('Seit 2 Tagen');
  });

  it('marks a new line entering the PTU in the test ring colour', async () => {
    await render(feedWithPtuAge(1));
    const card = el('.verdict')!;
    expect(card.classList).toContain('fresh');
    expect(card.getAttribute('data-fresh')).toBe('ptu');
    expect(el('.verdict-line')!.textContent).toContain('Alpha 4.11 ist im PTU');
    // The card stays a complete build status while it celebrates.
    expect(el('.verdict-basis')!.textContent).toContain('Alpha 4.10 bleibt live');
  });

  it('falls back to the standard read on day four, with nothing left over', async () => {
    await render(feedWithLiveAge(3));
    const card = el('.verdict')!;
    expect(card.classList).not.toContain('fresh');
    expect(card.getAttribute('data-fresh')).toBeNull();
    expect(el('.verdict .pulse')).toBeNull();
    expect(el('.verdict-label')!.textContent).toContain('Build-Stand');
    expect(el('.verdict-link')!.textContent).toContain('Patch-Historie');
  });
});
