import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { NewsThumbComponent, isArtwork, isHeroImage } from './news-thumb.component';

/**
 * Hero selection (the "first Verse News card had no image" report, 2026-08-27).
 *
 * The wiki API hands us an article's media in DOCUMENT order, so `images[0]` is
 * the hero only by coincidence. "Letter From The Chairman" led with a 3671×956
 * lower third — Chris Roberts in the left fifth, flat navy across the rest —
 * followed by two 3840×114 divider rules; the real banner sat at index 3. All
 * three passed the old "ratio >= 1.2 ⇒ this is the title image" test, and the
 * tile cover-cropped the empty middle of the first one.
 *
 * These sizes are the real ones off the live feed, not invented shapes.
 */
const LOWER_THIRD = { w: 3671, h: 956 };   // ratio 3.84 — a wide strip
const DIVIDER = { w: 3840, h: 114 };       // ratio 33.7 — a rule
const HERO_BANNER = { w: 3840, h: 1646 };  // ratio 2.33 — the article's banner
const OG_COVER = { w: 1140, h: 489 };      // ratio 2.33 — RSI's own og:image
const POSTER = { w: 743, h: 1050 };        // ratio 0.71 — a portrait poster

describe('news thumb · what counts as a title image', () => {
  it('accepts the shapes a real hero comes in', () => {
    expect(isHeroImage(HERO_BANNER)).toBeTrue();
    expect(isHeroImage(OG_COVER)).toBeTrue();
    expect(isHeroImage({ w: 1920, h: 1080 })).toBeTrue();
  });

  it('rejects a wide strip — the lower third that reported as "no image"', () => {
    expect(isHeroImage(LOWER_THIRD)).toBeFalse();
  });

  it('rejects a portrait poster, which is what the slideshow is for', () => {
    expect(isHeroImage(POSTER)).toBeFalse();
    expect(isArtwork(POSTER)).toBeTrue();
  });

  it('drops divider rules from the tile entirely, hero or slide', () => {
    expect(isHeroImage(DIVIDER)).toBeFalse();
    expect(isArtwork(DIVIDER)).toBeFalse();
  });
});

/**
 * Host that feeds the component a fixed image list and reports what it settled
 * on. The `<img>` elements never load in the test DOM, so measurements are fed
 * through the component's own `onReady` with a stub element — the same entry
 * point the browser's `load` event and the decode watchdog both use.
 */
@Component({
  standalone: true,
  imports: [NewsThumbComponent],
  template: `<sc-news-thumb [images]="images()" />`,
})
class HostComponent {
  readonly images = signal<string[]>([]);
}

function measured(w: number, h: number): HTMLImageElement {
  return { naturalWidth: w, naturalHeight: h } as HTMLImageElement;
}

describe('news thumb · hero scan', () => {
  let fixture: ComponentFixture<HostComponent>;
  let thumb: NewsThumbComponent;

  /** The Chairman letter's media list, in the order the feed delivers it. */
  const CHAIRMAN = ['lower-third', 'divider-top', 'divider-bottom', 'banner', 'extra'];
  const SIZE: Record<string, { w: number; h: number }> = {
    'lower-third': LOWER_THIRD,
    'divider-top': DIVIDER,
    'divider-bottom': DIVIDER,
    banner: HERO_BANNER,
    extra: HERO_BANNER,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.images.set(CHAIRMAN);
    fixture.detectChanges();
    thumb = fixture.debugElement.children[0].componentInstance as NewsThumbComponent;
  });

  /** Measure whatever the component currently has mounted, once. */
  function settle(): void {
    for (let i = 0; i < CHAIRMAN.length + 1; i++) {
      const url = thumb.display()[0];
      if (!url || thumb.mode() !== 'probing') break;
      const s = SIZE[url];
      thumb.onReady(url, measured(s.w, s.h));
      fixture.detectChanges();
    }
  }

  it('mounts exactly one candidate at a time while scanning', () => {
    expect(thumb.mode()).toBe('probing');
    expect(thumb.display()).toEqual(['lower-third']);
  });

  it('keeps a candidate under measurement hidden instead of flashing it', () => {
    thumb.onReady('lower-third', measured(LOWER_THIRD.w, LOWER_THIRD.h));
    fixture.detectChanges();
    // The strip is rejected, so the next candidate is mounted and nothing the
    // scan has touched may be revealed.
    expect(thumb.revealable()).toBeFalse();
  });

  it('walks past the strip and the rules and settles on the real banner', () => {
    settle();
    expect(thumb.mode()).toBe('hero');
    expect(thumb.display()).toEqual(['banner']);
    expect(thumb.revealable()).toBeTrue();
  });

  it('stops at the first candidate when the feed already leads with the hero', () => {
    fixture.componentInstance.images.set(['og-cover', ...CHAIRMAN]);
    fixture.detectChanges();
    thumb.onReady('og-cover', measured(OG_COVER.w, OG_COVER.h));
    fixture.detectChanges();
    expect(thumb.mode()).toBe('hero');
    expect(thumb.display()).toEqual(['og-cover']);
  });

  it('falls back to the slideshow when nothing qualifies, minus the furniture', () => {
    fixture.componentInstance.images.set(['divider-top', 'poster-a', 'poster-b']);
    fixture.detectChanges();
    thumb.onReady('divider-top', measured(DIVIDER.w, DIVIDER.h));
    fixture.detectChanges();
    thumb.onReady('poster-a', measured(POSTER.w, POSTER.h));
    fixture.detectChanges();
    thumb.onReady('poster-b', measured(POSTER.w, POSTER.h));
    fixture.detectChanges();
    expect(thumb.mode()).toBe('carousel');
    expect(thumb.display()).toEqual(['poster-a', 'poster-b']);
  });

  it('renders an empty tile rather than a divider rule when that is all there is', () => {
    fixture.componentInstance.images.set(['divider-top', 'divider-bottom']);
    fixture.detectChanges();
    thumb.onReady('divider-top', measured(DIVIDER.w, DIVIDER.h));
    thumb.onReady('divider-bottom', measured(DIVIDER.w, DIVIDER.h));
    fixture.detectChanges();
    expect(thumb.mode()).toBe('empty');
    expect(thumb.display()).toEqual([]);
  });

  it('moves on when a candidate is broken, instead of stalling the scan', () => {
    thumb.onError('lower-third');
    fixture.detectChanges();
    expect(thumb.display()).toEqual(['divider-top']);
  });
});
