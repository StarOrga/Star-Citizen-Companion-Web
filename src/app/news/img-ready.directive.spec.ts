import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ImgReadyDirective } from './news-thumb.component';

/**
 * A 1x1 transparent GIF — a real, decodable source that never touches the
 * network.
 */
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Past the watchdog's first re-check rung (1200 ms). Real time, not `fakeAsync`:
 * a faked clock freezes the browser's own decode work as well, so the element
 * never reaches the `complete` state the watchdog exists to observe — the test
 * would then be measuring the fake clock rather than the directive.
 */
const PAST_FIRST_RECHECK_MS = 1500;

/** Force the element into a settled state without waiting on a real decode. */
function fakeDecodeState(img: HTMLImageElement, complete: boolean, naturalWidth: number): void {
  Object.defineProperty(img, 'complete', { value: complete, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: naturalWidth, configurable: true });
}

@Component({
  standalone: true,
  imports: [ImgReadyDirective],
  template: `<img [src]="src()" scImgReady (ready)="ready = ready + 1" (failed)="failed = failed + 1" />`,
})
class HostComponent {
  readonly src = signal(PIXEL);
  ready = 0;
  failed = 0;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('ImgReadyDirective (decode watchdog)', () => {
  let f: ComponentFixture<HostComponent>;

  function setup(src: string): HTMLImageElement {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    f = TestBed.createComponent(HostComponent);
    f.componentInstance.src.set(src);
    f.detectChanges();
    return f.nativeElement.querySelector('img') as HTMLImageElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  /**
   * The whole point of the watchdog: a tile must never stay under its
   * placeholder because an event went missing. It reads the element's own state
   * on a bounded schedule instead of trusting `load`/`error` to arrive (admin
   * feedback 4e54ad2c — "ich sehe nur graue blaue balken").
   */
  it('reports a decoded image even when no load event was delivered', async () => {
    // Deliberately started WITHOUT a src, so the browser never fetches anything
    // and therefore never fires `load` — the element is then dressed up as a
    // resource that finished decoding behind our back. That is the exact shape
    // of the bug: pixels are there, the event never came, and without the
    // watchdog the tile would sit under its shimmer forever.
    const img = setup('');
    Object.defineProperty(img, 'currentSrc', {
      value: 'https://media.robertsspaceindustries.com/abc123/post.jpg',
      configurable: true,
    });
    fakeDecodeState(img, true, 1);
    await wait(PAST_FIRST_RECHECK_MS);
    expect(f.componentInstance.ready).toBe(1);
    expect(f.componentInstance.failed).toBe(0);
    f.destroy();
  });

  it('reports a source that completed without pixels as failed', async () => {
    // Same staging as above (no real fetch, so no real event), but the element
    // reports zero pixels — a broken source whose `error` never reached us.
    const img = setup('');
    Object.defineProperty(img, 'currentSrc', {
      value: 'https://media.robertsspaceindustries.com/abc123/post.jpg',
      configurable: true,
    });
    fakeDecodeState(img, true, 0);
    await wait(PAST_FIRST_RECHECK_MS);
    expect(f.componentInstance.failed).toBe(1);
    expect(f.componentInstance.ready).toBe(0);
    f.destroy();
  });

  it('emits a verdict at most once for a source that really does load', async () => {
    setup(PIXEL);
    await wait(PAST_FIRST_RECHECK_MS);
    // The native event and the watchdog both have a say here; between them the
    // tile must be revealed exactly once, never twice.
    expect(f.componentInstance.ready).toBe(1);
    expect(f.componentInstance.failed).toBe(0);
    f.destroy();
  });

  it('stays silent for an <img> that carries no source at all', async () => {
    const img = setup('');
    // `complete` is true for a source-less image — treating that as a broken
    // picture would paint an error over an empty slot.
    fakeDecodeState(img, true, 0);
    img.removeAttribute('src');
    await wait(PAST_FIRST_RECHECK_MS);
    expect(f.componentInstance.ready).toBe(0);
    expect(f.componentInstance.failed).toBe(0);
    f.destroy();
  });

  it('keeps waiting while the picture is still on the wire', async () => {
    const img = setup(PIXEL);
    // Not complete = still in flight (or lazy, below the fold). The watchdog
    // exists to recover a MISSED event, not to declare a slow one dead.
    fakeDecodeState(img, false, 0);
    f.componentInstance.ready = 0;
    await wait(PAST_FIRST_RECHECK_MS);
    expect(f.componentInstance.ready).toBe(0);
    expect(f.componentInstance.failed).toBe(0);
    f.destroy();
  });
});
