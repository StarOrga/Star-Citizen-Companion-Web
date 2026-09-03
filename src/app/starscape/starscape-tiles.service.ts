import { Injectable, signal } from '@angular/core';

/**
 * Per-preview render state for the Starscape wall — which previews this browser
 * session has already decoded, which failed, how often each was retried, and the
 * shape each one turned out to be.
 *
 * It lives in a root service rather than in `StarscapeComponent` on purpose. The
 * gallery's ROWS already outlive the component (`StarscapeService.wallpapers`),
 * so leaving the tab and coming back re-renders every page the user had loaded —
 * but with the decode state gone, so every one of those tiles rebuilt its
 * loading skeleton, and each skeleton is a `<canvas>` with an
 * `IntersectionObserver`, a `ResizeObserver` and an rAF loop (`scNeuroField`).
 * After a few "load more" clicks that is a hundred canvases allocated in one
 * blocking pass, followed by a hundred separate signal writes as the cached
 * images re-announce themselves — one change-detection run over the whole wall
 * each. That is the stutter reported in admin feedback 2bf4ab11.
 *
 * Keeping the state here means a revisited tile is simply already decoded: no
 * skeleton, no canvas, no blur-up replay. {@link ratioOf} covers the one thing
 * the skeleton was still needed for — reserving the tile's height until the
 * (cached) bytes are back on screen.
 *
 * Session-scoped by design: it is a companion to the browser's image cache, not
 * a persisted preference, so a reload starts clean.
 */
@Injectable({ providedIn: 'root' })
export class StarscapeTilesService {
  /** Previews that have decoded at least once this session. */
  readonly decoded = signal<ReadonlySet<string>>(new Set<string>());
  /** Previews whose source failed (or loaded zero pixels) and were not retried since. */
  readonly broken = signal<ReadonlySet<string>>(new Set<string>());

  /**
   * Retry counter per image id. Bumping it appends a `#r<n>` fragment to the
   * tile's urls, which makes the browser re-run its image-selection algorithm
   * for that element — the only way to re-attempt a source without touching the
   * url a signed CDN link may depend on (a fragment is never sent to a server).
   */
  private readonly retries = signal<Readonly<Record<string, number>>>({});

  /**
   * Decoded width/height ratio per image id. Recorded so a revisited tile can
   * reserve its exact box before the bytes are back — without it, dropping the
   * skeleton would collapse every tile to a border stripe for a frame and
   * reflow the wall as the cache answers.
   */
  private readonly ratios = signal<ReadonlyMap<string, number>>(new Map());

  /**
   * A preview decoded. `img` is optional because the `(load)` event on a cached
   * image can reach us before the element is measurable in some browsers; the
   * ratio is then simply not recorded and the tile keeps its skeleton estimate.
   */
  markDecoded(imageId: string, img?: HTMLImageElement | null): void {
    if (this.broken().has(imageId)) {
      const stillBroken = new Set(this.broken());
      stillBroken.delete(imageId);
      this.broken.set(stillBroken);
    }
    if (img?.naturalWidth && img.naturalHeight && !this.ratios().has(imageId)) {
      const next = new Map(this.ratios());
      next.set(imageId, img.naturalWidth / img.naturalHeight);
      this.ratios.set(next);
    }
    if (this.decoded().has(imageId)) return;
    const next = new Set(this.decoded());
    next.add(imageId);
    this.decoded.set(next);
  }

  /** A preview failed. A tile that already painted is never demoted. */
  markBroken(imageId: string): void {
    if (this.broken().has(imageId) || this.decoded().has(imageId)) return;
    const next = new Set(this.broken());
    next.add(imageId);
    this.broken.set(next);
  }

  /** Clear the failure marks for `imageIds`, or for every tile when omitted. */
  clearBroken(imageIds?: readonly string[]): void {
    if (!imageIds) {
      if (this.broken().size === 0) return;
      this.broken.set(new Set<string>());
      return;
    }
    const next = new Set(this.broken());
    for (const id of imageIds) next.delete(id);
    this.broken.set(next);
  }

  /** Re-attempt the given previews — see {@link retrySuffix}. */
  bumpRetry(imageIds: readonly string[]): void {
    if (imageIds.length === 0) return;
    const next = { ...this.retries() };
    for (const id of imageIds) next[id] = (next[id] ?? 0) + 1;
    this.retries.set(next);
  }

  /** The retry fragment for an image, or '' on the first attempt. */
  retrySuffix(imageId?: string): string {
    const n = imageId ? (this.retries()[imageId] ?? 0) : 0;
    return n > 0 ? `#r${n}` : '';
  }

  /** The decoded width/height ratio of a preview, or null if it never decoded. */
  ratioOf(imageId: string): number | null {
    return this.ratios().get(imageId) ?? null;
  }
}
