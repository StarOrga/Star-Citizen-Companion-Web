import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { NewsListComponent } from './news-list.component';
import { NewsService, VerseFeed, VerseNewsItem } from './news.service';
import { ConsentService } from '../core/consent.service';
import { UpcomingShipsService } from '../codex/upcoming-ships.service';

/**
 * AUD-190: without a share sheet (desktop browsers) the share button copied the
 * link silently — the click looked like it did nothing. It now says "Link
 * copied" (or "Couldn't copy link") on the clicked button for 2.6 s, like the
 * Starscape share. No translations are loaded, so the pipe prints the keys.
 */

function item(id: string, hoursAgo: number): VerseNewsItem {
  return {
    id,
    title: `Item ${id}`,
    url: `https://robertsspaceindustries.com/${id}`,
    publishedAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    channel: 'comm-link',
    source: 'comm-link',
    summary: 'A summary.',
    thumbnail: `https://example.test/${id}.jpg`,
  } as VerseNewsItem;
}

function feed(): VerseFeed {
  return {
    status: null,
    fetchedAt: new Date().toISOString(),
    news: [item('stage', 1), item('a1', 20), item('a2', 40), item('a3', 60)],
  } as VerseFeed;
}

describe('Verse News — share without a share sheet', () => {
  let fixture: ComponentFixture<NewsListComponent>;
  let hadShare: boolean;

  beforeEach(async () => {
    localStorage.clear();
    // Desktop Chrome: no Web Share API.
    hadShare = Object.prototype.hasOwnProperty.call(navigator, 'share');
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true });
    TestBed.configureTestingModule({
      imports: [NewsListComponent],
      providers: [
        provideTranslateService(),
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
    for (let i = 0; i < 4; i++) await Promise.resolve();
    fixture.detectChanges();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    fixture.componentInstance.closeDetail();
    fixture.destroy();
    if (!hadShare) delete (navigator as unknown as Record<string, unknown>)['share'];
    localStorage.clear();
  });

  function shareButtons(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.act.share'));
  }
  function label(btn: HTMLElement): string {
    return btn.querySelector('.lbl')!.textContent!.trim();
  }
  function liveRegion(): string {
    return (fixture.nativeElement.querySelector('.news-page > [role="status"]') as HTMLElement).textContent!.trim();
  }
  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  it('says "copied" on the clicked button only, then goes back to "Share"', async () => {
    const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    jasmine.clock().install();
    const buttons = shareButtons();
    expect(buttons.length).withContext('stage + tiles').toBeGreaterThan(2);
    const target = buttons[buttons.length - 1];

    target.click();
    await settle();

    expect(write).toHaveBeenCalledTimes(1);
    const after = shareButtons();
    expect(label(after[after.length - 1])).toBe('news.share.copied');
    for (const other of after.slice(0, -1)) {
      expect(label(other)).withContext('other buttons keep their label').toBe('news.share.label');
    }
    expect(liveRegion()).toBe('news.share.copied');

    jasmine.clock().tick(2600);
    fixture.detectChanges();
    expect(label(shareButtons()[shareButtons().length - 1])).toBe('news.share.label');
    expect(liveRegion()).toBe('');
  });

  it('says "failed" when the clipboard refuses', async () => {
    spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('denied'));
    const buttons = shareButtons();
    const target = buttons[buttons.length - 1];

    target.click();
    await settle();

    const after = shareButtons();
    expect(label(after[after.length - 1])).toBe('news.share.failed');
    expect(liveRegion()).toBe('news.share.failed');
  });
});
