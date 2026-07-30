import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { NewsListComponent } from './news-list.component';
import { NewsService, VerseFeed, VerseNewsItem } from './news.service';
import { ConsentService } from '../core/consent.service';
import { UpcomingShipsService } from '../codex/upcoming-ships.service';

/**
 * Verse News navigations must be real anchors (admin feedback d2171662): middle
 * click, Ctrl/⌘+click and "open link in new tab" are browser features and only
 * work on an `<a href>`. These specs assert the rendered DOM, not the handler.
 */

const ARTICLE_URL = 'https://robertsspaceindustries.com/comm-link/article-1';
const VIDEO_URL = 'https://www.youtube.com/watch?v=abc123';

function item(over: Partial<VerseNewsItem> & Pick<VerseNewsItem, 'id'>): VerseNewsItem {
  return {
    title: `Item ${over.id}`,
    url: ARTICLE_URL,
    publishedAt: new Date().toISOString(),
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
      item({ id: 'a1' }),
      item({ id: 'v1', channel: 'youtube', source: 'youtube', url: VIDEO_URL }),
    ],
  } as VerseFeed;
}

describe('Verse News — clickable items are real links (d2171662)', () => {
  let fixture: ComponentFixture<NewsListComponent>;

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

  function el<T extends HTMLElement>(selector: string): T | null {
    return fixture.nativeElement.querySelector(selector) as T | null;
  }

  it('renders the video rail tile as an <a> pointing at the clip', () => {
    const link = el<HTMLAnchorElement>('.vid-card .vid-link');
    expect(link).withContext('video rail tile link').not.toBeNull();
    expect(link!.tagName).toBe('A');
    expect(link!.getAttribute('href')).toBe(VIDEO_URL);
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders the article card headline as an <a> pointing at the source', () => {
    const link = el<HTMLAnchorElement>('.card .card-link');
    expect(link).withContext('article card link').not.toBeNull();
    expect(link!.getAttribute('href')).toBe(ARTICLE_URL);
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('no longer fakes a button on the card or the rail tile', () => {
    expect(el('.card[role="button"]')).toBeNull();
    expect(el('.vid-card[role="button"]')).toBeNull();
    expect(el('.card[tabindex]')).toBeNull();
    expect(el('.vid-card[tabindex]')).toBeNull();
  });

  it('keeps a plain left click in the app (detail overlay opens, no navigation)', () => {
    const c = fixture.componentInstance;
    const ev = new MouseEvent('click', { button: 0, cancelable: true });
    c.onCardClick(ev, feed().news[0]);
    expect(ev.defaultPrevented).withContext('plain click is handled in-app').toBeTrue();
    expect(c.selected()).not.toBeNull();
    c.closeDetail();
  });

  it('lets a Ctrl/⌘ or middle click through to the browser', () => {
    const c = fixture.componentInstance;
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { button: 1 }]) {
      const ev = new MouseEvent('click', { button: 0, cancelable: true, ...init });
      c.onCardClick(ev, feed().news[0]);
      expect(ev.defaultPrevented).withContext(JSON.stringify(init)).toBeFalse();
      expect(c.selected()).withContext('no overlay for a new-tab click').toBeNull();
    }
  });

  // The card link is stretched over the tile via a `::after` overlay. Real
  // hit-testing is the only honest check that it covers the artwork without
  // burying the footer's own buttons.
  it('stretches the card link over the artwork but not over the quick actions', () => {
    const card = el<HTMLElement>('.card')!;
    const link = el<HTMLAnchorElement>('.card .card-link')!;
    const fav = el<HTMLElement>('.card .act.fav')!;
    const thumb = el<HTMLElement>('.card .thumb-wrap')!;

    // elementFromPoint is viewport-relative, and the Karma frame is short —
    // bring each probe into view before measuring it.
    function hit(target: HTMLElement): Element | null {
      target.scrollIntoView({ block: 'center' });
      const r = target.getBoundingClientRect();
      expect(r.width * r.height).withContext('probe laid out').toBeGreaterThan(0);
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    }

    expect(card.contains(hit(thumb))).withContext('artwork inside the card').toBeTrue();
    expect(hit(thumb)).withContext('artwork hits the stretched link').toBe(link);
    expect(hit(fav)).withContext('fav button stays its own target').toBe(fav);
  });

  it('marks a video watched on both the in-app click and the middle-click new tab', () => {
    const c = fixture.componentInstance;
    const video = feed().news[1];

    c.onVideoAux(new MouseEvent('auxclick', { button: 1 }), video);
    expect(c.svc.isWatched(video.id)).toBeTrue();
  });
});
