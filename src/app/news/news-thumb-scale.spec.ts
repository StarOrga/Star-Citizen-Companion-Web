import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { NewsThumbComponent } from './news-thumb.component';

/**
 * The shape test must judge the PICTURE, not the variant that happened to load.
 *
 * `isArtwork` draws its "this is furniture, not art" line at an absolute pixel
 * height (a 3840×114 divider rule is a rule at any width). That constant was
 * calibrated against ORIGINAL sizes — but what the tile actually decodes is
 * whichever rung of the responsive ladder the browser picked, and on a regular
 * card at DPR 1 that is `w400`. Every measurement therefore arrived scaled down
 * by up to 4×, and the height test was effectively being applied to a thumbnail.
 *
 * Live case (2026-08-30, "einige Verse News zeigen keine Bilder"): the comm-link
 * "Improving the Live Experience" carries exactly one image, a 1140×228 banner
 * — a 5:1 strip, too wide to be a hero but unambiguously artwork. The tile
 * loaded its `w400` rung, measured 400×80, judged 80 < 140 to be a divider
 * rule, dropped its only candidate and rendered the empty gradient. The same
 * card on a DPR 2 phone loaded `w800`, measured 160 and showed the picture —
 * the verdict tracked the display, not the image.
 *
 * So a measurement is read back at the width where the picture exists in full —
 * which our cache url encodes — before any shape test sees it. Urls whose full
 * width is not knowable keep their raw measurement rather than a guessed one.
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

const CACHE = 'https://hcnqhvzlavdycidqyaai.supabase.co/storage/v1/object/public/news-images';
/** The card from the report: one 5:1 banner, stored with a w400/w800/w1140 ladder. */
const BANNER = `${CACHE}/736ffb6936d279b125baccbad564192382aab210/w1140.jpg`;
/** A divider rule off the Chairman letter, stored at the 1600 cap. */
const DIVIDER = `${CACHE}/0000000000000000000000000000000000000000/w1600.jpg`;
/** Legacy RSI media url — no ladder of ours, so no knowable full width. */
const LEGACY = 'https://media.robertsspaceindustries.com/1gkpdd2d48bxy/source.jpg';

describe('news thumb · measurements are variant-independent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let thumb: NewsThumbComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  function mount(images: string[]): void {
    fixture.componentInstance.images.set(images);
    fixture.detectChanges();
    thumb = fixture.debugElement.children[0].componentInstance as NewsThumbComponent;
  }

  it('shows a wide banner measured from its w400 rung instead of an empty tile', () => {
    mount([BANNER]);
    // What a regular card at DPR 1 decodes: the 400 rung of a 1140-wide picture.
    thumb.onReady(BANNER, measured(400, 80));
    fixture.detectChanges();

    expect(thumb.mode()).toBe('carousel');
    expect(thumb.display()).toEqual([BANNER]);
  });

  it('reaches the same verdict whichever rung the browser picked', () => {
    for (const [w, h] of [[400, 80], [800, 160], [1140, 228]] as const) {
      mount([BANNER]);
      thumb.onReady(BANNER, measured(w, h));
      fixture.detectChanges();
      expect(thumb.mode())
        .withContext(`decoded at ${w}×${h}`)
        .toBe('carousel');
    }
  });

  it('still drops a divider rule when only its small rung was decoded', () => {
    mount([DIVIDER]);
    // 3840×114 capped to 1600×48, then decoded at the 400 rung → 400×12.
    thumb.onReady(DIVIDER, measured(400, 12));
    fixture.detectChanges();

    expect(thumb.mode()).toBe('empty');
    expect(thumb.display()).toEqual([]);
  });

  it('leaves a url with no knowable full width measured as it decoded', () => {
    // The srcset advertises `cover` at 1140w for these, but that descriptor is
    // asserted, not measured. Correcting a 200×60 site logo up to 1140 wide
    // would turn furniture into artwork, so an unknown source stays raw — at the
    // price of leaving the legacy path's own downscale uncorrected.
    mount([LEGACY]);
    thumb.onReady(LEGACY, measured(200, 60));
    fixture.detectChanges();

    expect(thumb.mode()).toBe('empty');
  });

  it('keeps a hero a hero when it is decoded small', () => {
    const HERO = `${CACHE}/1111111111111111111111111111111111111111/w1600.jpg`;
    mount([HERO]);
    // 1600×900 decoded at the 400 rung → 400×225.
    thumb.onReady(HERO, measured(400, 225));
    fixture.detectChanges();

    expect(thumb.mode()).toBe('hero');
  });
});
