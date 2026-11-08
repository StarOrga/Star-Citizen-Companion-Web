import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { OverlayOriginService } from '../../shared/overlay-frame/overlay-origin.service';
import { StarscapeService } from '../../starscape/starscape.service';
import { StarscapeVotesService } from '../../starscape/starscape-votes.service';
import { VerseGalleryItemComponent } from './verse-gallery-item.component';

describe('VerseGalleryItemComponent upvote', () => {
  const wp = { imageId: 'img-1', title: 'T', sourceUrl: 'https://x/a.jpg', previewUrl: 'https://x/p.jpg', articleUrl: 'https://x/art' };

  function setup() {
    const syncCounts = vi.fn().mockName('syncCounts').mockResolvedValue(undefined);
    const toggle = vi.fn().mockName('toggle').mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [VerseGalleryItemComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: StarscapeService, useValue: { wallpapers: signal([wp]), loadOne: () => Promise.resolve(null) } },
        { provide: OverlayOriginService, useValue: { overlaid: signal(false), close: () => undefined } },
        {
          provide: StarscapeVotesService,
          useValue: { counts: signal(new Map([['img-1', 4]])), mine: signal(new Set<string>()), busy: signal(new Set<string>()), canVote: signal(true), syncCounts, toggle },
        },
      ],
    });
    const fixture = TestBed.createComponent(VerseGalleryItemComponent);
    fixture.componentRef.setInput('imageId', 'img-1');
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
});
