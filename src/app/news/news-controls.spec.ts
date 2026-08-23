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
 * The controls of the Verse News entry, after the 2026-08-23 polish pass:
 *
 * - "42 Beiträge" (a count pill) and "★ Favoriten (0)" (a starred text button)
 *   named the same kind of thing in two unrelated shapes, and the number rode in
 *   brackets. They are one segmented control now, both halves label + badge.
 * - "Merken", "Gemerkt" and "Favoriten" were three names for one state. There is
 *   one wording and one glyph now, on the stage, the tile and the detail view.
 * - The detail overlay lost its stylesheet in the 2026-08-20 rewrite and opened
 *   as a full-bleed image with its actions cut off below the fold. It is sized
 *   to the viewport again — everything visible, nothing to scroll to.
 */

function item(over: Partial<VerseNewsItem> & Pick<VerseNewsItem, 'id'>): VerseNewsItem {
  return {
    title: `Item ${over.id}`,
    url: `https://robertsspaceindustries.com/${over.id}`,
    publishedAt: new Date().toISOString(),
    channel: 'comm-link',
    source: 'comm-link',
    summary: 'A summary long enough to occupy a line or two of the detail view.',
    thumbnail: `https://example.test/${over.id}.jpg`,
    ...over,
  } as VerseNewsItem;
}

function feed(): VerseFeed {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  return {
    status: null,
    fetchedAt: new Date().toISOString(),
    news: [
      item({ id: 'stage', channel: 'youtube', source: 'youtube', publishedAt: hoursAgo(1) }),
      item({ id: 'a1', publishedAt: hoursAgo(20) }),
      item({ id: 'a2', publishedAt: hoursAgo(40) }),
      item({ id: 'a3', publishedAt: hoursAgo(60) }),
    ],
  } as VerseFeed;
}

describe('Verse News — harmonised controls', () => {
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
    for (let i = 0; i < 4; i++) await Promise.resolve();
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.componentInstance.closeDetail();
    fixture.destroy();
    localStorage.clear();
  });

  function el<T extends HTMLElement>(selector: string): T | null {
    return fixture.nativeElement.querySelector(selector) as T | null;
  }
  function all(selector: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(selector));
  }

  // ── The stream toggle ────────────────────────────────────────────────────

  it('renders both halves of the stream as one segmented control', () => {
    const seg = el('.stream-head .seg');
    expect(seg).withContext('segmented control').not.toBeNull();
    expect(all('.stream-head .seg .seg-btn').length).toBe(2);
    expect(el('.stream-head .count')).withContext('old count pill is gone').toBeNull();
    expect(el('.stream-head .saved-link')).withContext('old saved link is gone').toBeNull();
  });

  it('states its numbers without brackets', () => {
    const nums = all('.stream-head .seg .seg-num').map((n) => n.textContent!.trim());
    expect(nums.length).toBe(2);
    for (const n of nums) expect(n).withContext(n).toMatch(/^\d+$/);
  });

  it('marks exactly one half as pressed and switches on the other', () => {
    const [allBtn, savedBtn] = all('.stream-head .seg .seg-btn');
    expect(allBtn.getAttribute('aria-pressed')).toBe('true');
    expect(savedBtn.getAttribute('aria-pressed')).toBe('false');

    savedBtn.click();
    fixture.detectChanges();
    expect(svc.favoritesOnly()).toBeTrue();
    expect(all('.stream-head .seg .seg-btn')[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('does not flip back when the already-active half is pressed again', () => {
    // A segmented control states which half is active; a toggle would contradict
    // its own aria-pressed on the second press.
    const savedBtn = all('.stream-head .seg .seg-btn')[1];
    savedBtn.click();
    fixture.detectChanges();
    savedBtn.click();
    fixture.detectChanges();
    expect(svc.favoritesOnly()).withContext('still on the saved half').toBeTrue();
  });

  it('keeps both counts on the unfiltered stream, so the numbers never move under the filter', () => {
    const before = all('.stream-head .seg .seg-num').map((n) => n.textContent!.trim());
    all('.stream-head .seg .seg-btn')[1].click();
    fixture.detectChanges();
    const after = all('.stream-head .seg .seg-num').map((n) => n.textContent!.trim());
    expect(after).toEqual(before);
  });

  it('counts the saved half against the stream, not against the whole feed', () => {
    // The staged article is not part of the stream, so saving it must not make
    // the saved half promise an item the list cannot show.
    const staged = svc.stage()!;
    svc.toggleFavorite(staged.id);
    fixture.detectChanges();
    expect(svc.favoriteCount()).toBe(0);
    expect(svc.streamCount()).toBe(feed().news.length - 1);
  });

  // ── One wording, one glyph ───────────────────────────────────────────────

  it('uses the same label for the saved state on the stage, the tile and the detail view', () => {
    const c = fixture.componentInstance;
    const unsaved = feed().news[1];
    expect(c.favLabel(unsaved)).toBe('news.favorite.save');
    svc.toggleFavorite(unsaved.id);
    expect(c.favLabel(unsaved)).toBe('news.favorite.saved');
  });

  it('draws the same star everywhere, as markup rather than a text character', () => {
    const glyphs = all('.act.fav .ic').map((n) => n.innerHTML);
    expect(glyphs.length).withContext('stage + tiles').toBeGreaterThan(1);
    for (const g of glyphs) expect(g).toContain('<svg');
    // The bare ★/☆ characters the page used to print are gone from the controls.
    for (const btn of all('.act.fav')) expect(btn.textContent).not.toContain('☆');
  });

  it('gives every surface the same share control', () => {
    const share = all('.act.share');
    expect(share.length).withContext('stage + every tile').toBeGreaterThan(1);
    for (const btn of share) expect(btn.querySelector('.ic svg')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('⤴');
  });

  // ── The detail overlay ───────────────────────────────────────────────────

  describe('detail overlay', () => {
    let panel: HTMLElement;

    beforeEach(() => {
      fixture.componentInstance.openDetail(feed().news[1]);
      fixture.detectChanges();
      panel = document.querySelector('.nd-panel') as HTMLElement;
      expect(panel).withContext('overlay panel').not.toBeNull();
    });

    it('closes through a back link in the same idiom as the patch board, not a ✕ disc', () => {
      const back = panel.querySelector<HTMLElement>('.nd-head .nd-back');
      expect(back).withContext('back control').not.toBeNull();
      expect(back!.textContent).toContain('←');
      expect(panel.querySelector('.nd-close')).withContext('old ✕ button').toBeNull();

      back!.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.selected()).toBeNull();
      expect(document.querySelector('.nd-panel')).toBeNull();
    });

    it('fits inside the viewport', () => {
      const r = panel.getBoundingClientRect();
      expect(r.height).withContext('panel laid out').toBeGreaterThan(0);
      expect(r.top).withContext('top edge on screen').toBeGreaterThanOrEqual(-1);
      expect(r.bottom).withContext('bottom edge on screen')
        .toBeLessThanOrEqual(window.innerHeight + 1);
      expect(r.right).toBeLessThanOrEqual(window.innerWidth + 1);
    });

    it('shows the actions without a scroll — that was the whole complaint', () => {
      const actions = panel.querySelector<HTMLElement>('.nd-actions')!;
      const r = actions.getBoundingClientRect();
      expect(r.height).withContext('actions laid out').toBeGreaterThan(0);
      expect(r.bottom).toBeLessThanOrEqual(window.innerHeight + 1);

      const body = panel.querySelector<HTMLElement>('.nd-body')!;
      expect(body.scrollHeight - body.clientHeight)
        .withContext('no hidden overflow in the text column').toBeLessThanOrEqual(1);
    });

    it('carries the same two controls as the rest of the page', () => {
      const labels = Array.from(panel.querySelectorAll('.nd-actions .sc-btn'));
      expect(labels.length).toBe(3);
      for (const btn of labels.slice(0, 2)) {
        expect(btn.querySelector('.ic svg')).withContext(btn.textContent!).not.toBeNull();
      }
    });
  });
});
