import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { OverlayOriginService } from '../../shared/overlay-frame/overlay-origin.service';
import { StarscapeService } from '../../starscape/starscape.service';
import { StarscapeVotesService } from '../../starscape/starscape-votes.service';
import { VerseGalleryItemComponent } from './verse-gallery-item.component';

let fetchResult: unknown = null;

describe('VerseGalleryItemComponent upvote', () => {
  beforeEach(() => { fetchResult = null; });

  const wp = { imageId: 'img-1', title: 'T', sourceUrl: 'https://x/a.jpg', previewUrl: 'https://x/p.jpg', articleUrl: 'https://x/art' };

  function setup(imageId = 'img-1', wallpapers: unknown[] = [wp]) {
    const syncCounts = vi.fn().mockName('syncCounts').mockResolvedValue(undefined);
    const toggle = vi.fn().mockName('toggle').mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [VerseGalleryItemComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: StarscapeService, useValue: { wallpapers: signal(wallpapers), loadOne: () => Promise.resolve(null), fetchOne: () => Promise.resolve(fetchResult) } },
        { provide: OverlayOriginService, useValue: { overlaid: signal(false), close: () => undefined } },
        {
          provide: StarscapeVotesService,
          useValue: { counts: signal(new Map([['img-1', 4]])), mine: signal(new Set<string>()), busy: signal(new Set<string>()), canVote: signal(true), syncCounts, toggle },
        },
      ],
    });
    const fixture = TestBed.createComponent(VerseGalleryItemComponent);
    fixture.componentRef.setInput('imageId', imageId);
    fixture.detectChanges();
    return { fixture, syncCounts, toggle };
  }

  it('renders a vote button in the single view, syncs its tally and toggles on click', () => {
    const { fixture, syncCounts, toggle } = setup();
    const btn = fixture.nativeElement.querySelector('sc-lightbox sc-vote-button button.vote') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('4');
    expect(syncCounts).toHaveBeenCalledWith(['img-1']);
    btn.click();
    expect(toggle).toHaveBeenCalledWith('img-1');
  });

  it('renders a not-found state with an h1 and an anchor to the gallery for an unknown id (AUD-L17)', async () => {
    const { fixture } = setup('nope', []);
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('h1')?.textContent).toContain('overlay.gallery.notFoundTitle');
    expect(el.querySelector('a.nf-back')?.getAttribute('href')).toBe('/verse/gallery');
    expect(el.querySelector('.err')).toBeNull();
  });

  it('keeps an error state with retry when the read failed, and recovers on retry', async () => {
    fetchResult = 'error';
    const { fixture } = setup('nope', []);
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sc-not-found')).toBeNull();
    const retry = el.querySelector('.err button') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    fetchResult = null;
    retry.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.err')).toBeNull();
    expect(el.querySelector('sc-not-found h1')).not.toBeNull();
  });
});
