import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NewsThumbComponent } from './news-thumb.component';

/**
 * The thumbnail stacks three things internally: the shimmer (0), the image
 * layers (1) and the channel pill / carousel dots (2). None of that is the
 * host page's business.
 *
 * It became the host page's business on the Verse News stage: the thumb fills
 * the whole hero as an absolutely positioned backdrop, and the headline, the
 * overline and the deck sit on top of it at the default stacking level. Because
 * `:host` was positioned but had `z-index: auto`, it did NOT open a stacking
 * context — so `z-index: 1` and `z-index: 2` inside the component competed
 * directly with the page's own content and won. The stage rendered as artwork
 * with nothing but its action row visible: every line of type was painted over
 * by the picture it was supposed to sit on.
 *
 * `isolation: isolate` on the host is the fix. This spec pins the property that
 * matters — content placed NEXT to a thumb, at the default level, stays in
 * front of everything the thumb draws.
 */
@Component({
  standalone: true,
  imports: [NewsThumbComponent],
  template: `
    <div class="frame" style="position: relative; width: 320px; height: 180px;">
      <sc-news-thumb
        style="position: absolute; inset: 0;"
        [images]="['https://example.test/stage.jpg']"
        channelLabel="Comm-Link" />
      <!-- Stands in for the stage body: positioned, no z-index, after the thumb
           in document order — so document order alone must put it in front. -->
      <span class="body"
            style="position: relative; display: block; width: 320px; height: 180px;"></span>
    </div>
  `,
})
class ThumbStackHost {}

describe('sc-news-thumb — its z-index ladder stays inside the component', () => {
  it('never paints over page content that sits next to it', () => {
    TestBed.configureTestingModule({ imports: [ThumbStackHost] });
    const fixture = TestBed.createComponent(ThumbStackHost);
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    root.querySelector<HTMLElement>('.frame')!.scrollIntoView({ block: 'center' });

    const body = root.querySelector<HTMLElement>('.body')!;
    // The channel pill is the component's highest layer (z-index: 2) and always
    // renders, so it is the strictest probe available.
    const pill = root.querySelector<HTMLElement>('.ch-pill')!;
    expect(pill).withContext('channel pill rendered').not.toBeNull();

    const r = pill.getBoundingClientRect();
    expect(r.width * r.height).withContext('pill laid out').toBeGreaterThan(0);
    const onTop = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);

    expect(onTop).withContext('page content wins over the thumb internals').toBe(body);
    fixture.destroy();
  });

  it('declares the isolation that makes that true', () => {
    TestBed.configureTestingModule({ imports: [ThumbStackHost] });
    const fixture = TestBed.createComponent(ThumbStackHost);
    fixture.detectChanges();
    const thumb = fixture.nativeElement.querySelector('sc-news-thumb') as HTMLElement;
    expect(getComputedStyle(thumb).isolation).toBe('isolate');
    fixture.destroy();
  });
});
