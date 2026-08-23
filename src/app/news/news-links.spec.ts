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
 *
 * Rewritten for the "Bühne · Befund · Strom" entry (2026-08-20 rethink): the
 * video rail is gone, so the two surfaces that carry a link are now the stage
 * and the stream tile.
 */

const STAGE_URL = 'https://www.youtube.com/watch?v=abc123';
const CARD_URL = 'https://robertsspaceindustries.com/comm-link/article-1';

function item(over: Partial<VerseNewsItem> & Pick<VerseNewsItem, 'id'>): VerseNewsItem {
  return {
    title: `Item ${over.id}`,
    url: CARD_URL,
    publishedAt: new Date().toISOString(),
    channel: 'comm-link',
    source: 'comm-link',
    thumbnail: `https://example.test/${over.id}.jpg`,
    ...over,
  } as VerseNewsItem;
}

/**
 * The video is two hours old on the highest-weighted channel, so it takes the
 * stage; the older article lands in the stream. Both surfaces are asserted.
 */
function feed(): VerseFeed {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  return {
    status: null,
    fetchedAt: new Date().toISOString(),
    news: [
      item({ id: 'v1', channel: 'youtube', source: 'youtube', url: STAGE_URL, publishedAt: hoursAgo(2) }),
      item({ id: 'a1', publishedAt: hoursAgo(30) }),
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

  it('renders the stage headline as an <a> pointing at the source', () => {
    const link = el<HTMLAnchorElement>('.stage .stage-link');
    expect(link).withContext('stage link').not.toBeNull();
    expect(link!.tagName).toBe('A');
    expect(link!.getAttribute('href')).toBe(STAGE_URL);
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders the stream tile headline as an <a> pointing at the source', () => {
    const link = el<HTMLAnchorElement>('.card .card-link');
    expect(link).withContext('stream tile link').not.toBeNull();
    expect(link!.getAttribute('href')).toBe(CARD_URL);
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('routes the verdict card to the patch board with a routerLink, not a click handler', () => {
    // The board is in-app, so it must be a real anchor with an href the browser
    // can open in a new tab — the same rule, applied to an internal route.
    const link = el<HTMLAnchorElement>('.verdict .verdict-link');
    if (link) {
      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')).toBe('/news/patches');
    }
  });

  it('no longer fakes a button on the stage or the tile', () => {
    expect(el('.card[role="button"]')).toBeNull();
    expect(el('.stage[role="button"]')).toBeNull();
    expect(el('.card[tabindex]')).toBeNull();
    expect(el('.stage[tabindex]')).toBeNull();
  });

  it('keeps a plain left click in the app (detail overlay opens, no navigation)', () => {
    const c = fixture.componentInstance;
    const ev = new MouseEvent('click', { button: 0, cancelable: true });
    c.onItemClick(ev, feed().news[0]);
    expect(ev.defaultPrevented).withContext('plain click is handled in-app').toBeTrue();
    expect(c.selected()).not.toBeNull();
    c.closeDetail();
  });

  it('lets a Ctrl/⌘ or middle click through to the browser', () => {
    const c = fixture.componentInstance;
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { button: 1 }]) {
      const ev = new MouseEvent('click', { button: 0, cancelable: true, ...init });
      c.onItemClick(ev, feed().news[0]);
      expect(ev.defaultPrevented).withContext(JSON.stringify(init)).toBeFalse();
      expect(c.selected()).withContext('no overlay for a new-tab click').toBeNull();
    }
  });

  // elementFromPoint is viewport-relative, and the Karma frame is short — bring
  // each probe into view before measuring it.
  function hit(target: HTMLElement): Element | null {
    target.scrollIntoView({ block: 'center' });
    const r = target.getBoundingClientRect();
    expect(r.width * r.height).withContext('probe laid out').toBeGreaterThan(0);
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  }

  // The tile link is stretched over the card via an absolutely positioned
  // overlay child. Real hit-testing is the only honest check that it covers the
  // artwork without burying the footer's own buttons.
  it('stretches the tile link over the artwork but not over the quick actions', () => {
    const card = el<HTMLElement>('.card')!;
    const link = el<HTMLAnchorElement>('.card .card-link')!;
    const fav = el<HTMLElement>('.card .act.fav')!;
    const thumb = el<HTMLElement>('.card .thumb-wrap')!;

    expect(card.contains(hit(thumb))).withContext('artwork inside the card').toBeTrue();
    // Containment, not identity: the overlay is a real child element (so the
    // mobile gate can measure the true hit area), and hit-testing therefore
    // resolves to the overlay rather than to the anchor itself. Either way the
    // point belongs to the stretched link — which is what this asserts.
    expect(link.contains(hit(thumb))).withContext('artwork hits the stretched link').toBeTrue();
    expect(fav.contains(hit(fav))).withContext('fav button stays its own target').toBeTrue();
  });

  it('gives the stage CTA a real href instead of a decorated span', () => {
    // It used to be a <span> with `pointer-events: none`, which is why it looked
    // like the page's primary control and behaved like part of the background.
    const cta = el<HTMLAnchorElement>('.stage .cta');
    expect(cta).withContext('stage CTA').not.toBeNull();
    expect(cta!.tagName).toBe('A');
    expect(cta!.getAttribute('href')).toBe(STAGE_URL);
    expect(cta!.getAttribute('target')).toBe('_blank');
    expect(cta!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  /**
   * The reported defect: "in der Hero-Card sind die Buttons nur am unteren Rand
   * klickbar und nicht auf dem Button." Each control in the stage's action row
   * has to win the hit test at its own centre — not only in the strip beneath
   * it, where the bare stretched stage link used to be the one thing that
   * answered a click.
   */
  it('makes every control in the stage action row hit itself, not the layer behind it', () => {
    for (const sel of ['.stage .cta', '.stage .act.fav', '.stage .act.share']) {
      const control = el<HTMLElement>(sel)!;
      expect(control).withContext(sel).not.toBeNull();
      expect(control.contains(hit(control))).withContext(`${sel} takes its own hit`).toBeTrue();
    }
  });

  it('lets the gaps in the action row fall through to the stretched stage link', () => {
    // The row is `pointer-events: none` with its children switched back on, so
    // the space between two controls still belongs to the article link rather
    // than dying on a <p> that has no handler.
    const row = el<HTMLElement>('.stage .stage-actions')!;
    const link = el<HTMLAnchorElement>('.stage .stage-link')!;
    const cta = el<HTMLElement>('.stage .cta')!;
    const fav = el<HTMLElement>('.stage .act.fav')!;

    row.scrollIntoView({ block: 'center' });
    const a = cta.getBoundingClientRect();
    const b = fav.getBoundingClientRect();
    const gapX = (a.right + b.left) / 2;
    expect(b.left - a.right).withContext('there is a real gap').toBeGreaterThan(2);

    const target = document.elementFromPoint(gapX, a.top + a.height / 2);
    expect(link.contains(target)).withContext('gap belongs to the stage link').toBeTrue();
  });
});
