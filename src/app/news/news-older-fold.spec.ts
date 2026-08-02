import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';

import { NewsListComponent } from './news-list.component';
import { PatchNotesSectionComponent } from './patch-notes-section.component';
import { NewsChannel, NewsService, VerseFeed, VerseNewsItem } from './news.service';
import { ConsentService } from '../core/consent.service';
import { UpcomingShipsService } from '../codex/upcoming-ships.service';

/**
 * Older entries fold with the filter (admin feedback 1bc19cdc).
 *
 * "Alle" is the browsing view — the "Älter" bucket is open. Any filter (a
 * channel chip or the saved-only chip) is a search, so older folds away; going
 * back to "Alle" unfolds it again. A manual toggle beats the automatic state,
 * but only until the filter changes.
 */

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function item(over: Partial<VerseNewsItem> & Pick<VerseNewsItem, 'id'>): VerseNewsItem {
  return {
    title: `Item ${over.id}`,
    url: 'https://robertsspaceindustries.com/comm-link/article',
    publishedAt: ago(0),
    channel: 'comm-link',
    source: 'comm-link',
    ...over,
  } as VerseNewsItem;
}

function feed(): VerseFeed {
  return {
    status: null,
    fetchedAt: new Date().toISOString(),
    news: [
      item({ id: 'c-today' }),
      item({ id: 'c-old', publishedAt: ago(30) }),
      item({ id: 's-old', channel: 'spectrum', source: 'spectrum', publishedAt: ago(40) }),
      item({
        id: 'p-49',
        channel: 'patch',
        source: 'patch-notes',
        title: 'Star Citizen Alpha 4.9 LIVE Patch Notes',
        publishedAt: ago(2),
      }),
      item({
        id: 'p-48',
        channel: 'patch',
        source: 'patch-notes',
        title: 'Star Citizen Alpha 4.8 LIVE Patch Notes',
        publishedAt: ago(60),
      }),
    ],
  } as VerseFeed;
}

describe('Verse News — older entries fold with the filter (1bc19cdc)', () => {
  let fixture: ComponentFixture<NewsListComponent>;
  let svc: NewsService;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [NewsListComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        NewsService,
        { provide: HttpClient, useValue: { get: () => of(feed()) } },
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
    fixture = TestBed.createComponent(NewsListComponent);
    svc = TestBed.inject(NewsService);
    fixture.detectChanges();
    // The component polls on a 5-min interval, so `whenStable()` never settles —
    // drain the microtask queue instead: `refresh()` resolves off a sync observable.
    for (let i = 0; i < 4; i++) await Promise.resolve();
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  /** The "Älter" bucket is the only one with a manual toggle. */
  function olderBucket(): HTMLElement | undefined {
    const buckets = Array.from(
      fixture.nativeElement.querySelectorAll('section.bucket'),
    ) as HTMLElement[];
    return buckets.find((b) => b.querySelector('.bucket-toggle'));
  }

  function olderCardCount(): number {
    return olderBucket()?.querySelectorAll('.card').length ?? 0;
  }

  function setFilter(...channels: NewsChannel[]): void {
    svc.clearFilter();
    for (const ch of channels) svc.toggleChannel(ch);
    fixture.detectChanges();
  }

  it('shows the older bucket expanded in the default "Alle" view', () => {
    expect(fixture.componentInstance.olderOpen()).toBeTrue();
    expect(olderCardCount()).toBeGreaterThan(0);
    expect(olderBucket()?.querySelector('.bucket-toggle')?.getAttribute('aria-expanded'))
      .toBe('true');
  });

  it('collapses the older bucket as soon as a channel filter is applied', () => {
    setFilter('comm-link');

    expect(fixture.componentInstance.olderOpen()).toBeFalse();
    expect(olderCardCount()).toBe(0);
    expect(olderBucket()?.querySelector('.bucket-toggle')?.getAttribute('aria-expanded'))
      .toBe('false');
  });

  it('collapses the older bucket in the saved-only view too', () => {
    svc.favoritesOnly.set(true);
    fixture.detectChanges();

    expect(fixture.componentInstance.olderOpen()).toBeFalse();
  });

  it('expands the older bucket again when the user goes back to "Alle"', () => {
    setFilter('comm-link');
    expect(fixture.componentInstance.olderOpen()).toBeFalse();

    fixture.componentInstance.clearFilter();
    fixture.detectChanges();

    expect(fixture.componentInstance.olderOpen()).toBeTrue();
    expect(olderCardCount()).toBeGreaterThan(0);
  });

  it('lets a manual toggle win for as long as the filter stays put', () => {
    setFilter('comm-link');
    expect(fixture.componentInstance.olderOpen()).toBeFalse();

    fixture.componentInstance.toggleOlder();
    fixture.detectChanges();
    expect(fixture.componentInstance.olderOpen()).toBeTrue();
    expect(olderCardCount()).toBeGreaterThan(0);

    // Same view, another render pass: the manual choice must not be reset.
    fixture.detectChanges();
    expect(fixture.componentInstance.olderOpen()).toBeTrue();
  });

  it('re-applies the collapsed default when switching between two filters', () => {
    setFilter('comm-link');
    fixture.componentInstance.toggleOlder();
    fixture.detectChanges();
    expect(fixture.componentInstance.olderOpen()).toBeTrue();

    setFilter('spectrum');

    expect(fixture.componentInstance.olderOpen()).toBeFalse();
    expect(olderCardCount()).toBe(0);
  });

  it('drops a manual "Alle" collapse when a filter is applied and restored', () => {
    fixture.componentInstance.toggleOlder();
    fixture.detectChanges();
    expect(fixture.componentInstance.olderOpen()).toBeFalse();

    setFilter('comm-link');
    expect(fixture.componentInstance.olderOpen()).toBeFalse();

    fixture.componentInstance.clearFilter();
    fixture.detectChanges();
    expect(fixture.componentInstance.olderOpen()).toBeTrue();
  });

  // The patch lines live in their own component since 44e90e30, so this reaches
  // through the rendered tree — which also asserts that the list still mounts the
  // section at all.
  it('folds a manually opened older patch line back on a filter change', () => {
    const section = fixture.debugElement.query(By.directive(PatchNotesSectionComponent))
      ?.componentInstance as PatchNotesSectionComponent;
    expect(section).withContext('news-list renders the patch-notes section').toBeTruthy();

    const lines = svc.patchLines();
    expect(lines.length).toBeGreaterThan(1);

    const older = lines[1];
    expect(section.isLineOpen(lines[0])).withContext('newest line stays open').toBeTrue();
    expect(section.isLineOpen(older)).withContext('older line starts folded').toBeFalse();

    section.toggleLine(older);
    fixture.detectChanges();
    expect(section.isLineOpen(older)).toBeTrue();

    setFilter('patch');
    fixture.detectChanges();

    expect(section.isLineOpen(older)).withContext('older line folds with the filter').toBeFalse();
    expect(section.isLineOpen(lines[0])).withContext('newest line is still the open one').toBeTrue();
  });
});
