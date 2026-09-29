import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { ImgReadyDirective } from './news-thumb.component';

/**
 * A 1x1 transparent GIF — a real, decodable source that never touches the
 * network.
 */
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The watchdog's first re-check rung (`READY_RECHECKS_MS[0]` in news-thumb.component.ts). */
const FIRST_RECHECK_MS = 1200;

/**
 * Past the first re-check rung, in REAL time — only for the one spec that needs
 * the browser's own decode: a faked clock freezes that work as well, so the
 * element would never reach the `complete` state the watchdog observes. Every
 * other spec stages the element's state by hand and runs on a fake clock
 * (REQ-28: no real waiting where `fakeAsync`/`tick` does the job).
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
  changeDetection: ChangeDetectionStrategy.Eager,
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
  it('reports a decoded image even when no load event was delivered', fakeAsync(() => {
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
    tick(FIRST_RECHECK_MS - 1);
    expect(f.componentInstance.ready).toBe(0);
    tick(1);
    expect(f.componentInstance.ready).toBe(1);
    expect(f.componentInstance.failed).toBe(0);
    f.destroy();
    flush();
  }));

  it('reports a source that completed without pixels as failed', fakeAsync(() => {
    // Same staging as above (no real fetch, so no real event), but the element
    // reports zero pixels — a broken source whose `error` never reached us.
    const img = setup('');
    Object.defineProperty(img, 'currentSrc', {
      value: 'https://media.robertsspaceindustries.com/abc123/post.jpg',
      configurable: true,
    });
    fakeDecodeState(img, true, 0);
    tick(FIRST_RECHECK_MS);
    expect(f.componentInstance.failed).toBe(1);
    expect(f.componentInstance.ready).toBe(0);
    f.destroy();
    flush();
  }));

  it('emits a verdict at most once for a source that really does load', async () => {
    setup(PIXEL);
    await wait(PAST_FIRST_RECHECK_MS);
    // The native event and the watchdog both have a say here; between them the
    // tile must be revealed exactly once, never twice.
    expect(f.componentInstance.ready).toBe(1);
    expect(f.componentInstance.failed).toBe(0);
    f.destroy();
  });

  it('stays silent for an <img> that carries no source at all', fakeAsync(() => {
    const img = setup('');
    // `complete` is true for a source-less image — treating that as a broken
    // picture would paint an error over an empty slot.
    fakeDecodeState(img, true, 0);
    img.removeAttribute('src');
    // Every rung of the watchdog, not only the first.
    flush();
    expect(f.componentInstance.ready).toBe(0);
    expect(f.componentInstance.failed).toBe(0);
    f.destroy();
  }));

  it('keeps waiting while the picture is still on the wire', fakeAsync(() => {
    const img = setup(PIXEL);
    // Not complete = still in flight (or lazy, below the fold). The watchdog
    // exists to recover a MISSED event, not to declare a slow one dead.
    fakeDecodeState(img, false, 0);
    f.componentInstance.ready = 0;
    tick(FIRST_RECHECK_MS);
    tick(4000 - FIRST_RECHECK_MS);
    expect(f.componentInstance.ready).toBe(0);
    expect(f.componentInstance.failed).toBe(0);
    f.destroy();
    flush();
  }));
});
