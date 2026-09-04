import { Injectable, signal } from '@angular/core';

/**
 * Attribute marking a subtree that must NOT appear in a page screenshot.
 *
 * The whole point of the capture is "the page I am looking at, as a reference
 * for my report" — the feedback launcher and its panel are the one thing that
 * is on screen *because* the user is writing the report, so they are cut out.
 * Both FABs carry it on their host, and the CDK overlay container (lightboxes,
 * menus opened from the panel) is filtered by class below.
 */
export const CAPTURE_HIDE_ATTR = 'data-sc-capture-hide';

/** Longest edge of the raw capture before the composer re-encodes it. */
const MAX_EDGE = 2200;
/** Hard stop so a stuck font/image fetch can never wedge the composer. */
const CAPTURE_TIMEOUT_MS = 20000;

/** Shape of the lazily imported `modern-screenshot` entry point we use. */
type DomToCanvas = (node: Node, options: Record<string, unknown>) => Promise<HTMLCanvasElement>;

/**
 * "Screenshot of this page" for the feedback composers (admin feedback
 * 312a4acc).
 *
 * WHY DOM-TO-CANVAS AND NOT `getDisplayMedia`: the screen-capture API forces an
 * OS-level picker ("which window do you want to share?") on every single shot,
 * needs a user gesture chain that survives an await, and — decisively — is not
 * implemented by mobile browsers at all. This app is used on phones, so a route
 * that silently has no mobile story is not a route. Rendering the DOM into a
 * canvas works identically everywhere, needs no permission prompt, and lets us
 * *omit* the feedback UI instead of asking the user to close it first.
 *
 * The cost is fidelity: a DOM rasteriser is not a compositor. Cross-origin
 * images that refuse CORS come out blank, `<canvas>`/WebGL content (the 3D ship
 * view) renders as its backing bitmap at best, and CSS the library does not
 * understand degrades. That is an acceptable trade for a reference image.
 *
 * BUNDLE COST: `modern-screenshot` (~45 KB min, no runtime dependencies) is
 * pulled in through a dynamic `import()`, so it lands in its own lazy chunk and
 * costs the initial bundle nothing. Nobody who never presses the button ever
 * downloads it.
 *
 * VIEWPORT, NOT FULL PAGE: the capture is what the user can actually see. The
 * clone is laid out at full document size and translated by the scroll offset,
 * and `position: fixed` chrome — which a static clone would otherwise pin to
 * the top of the *document* — is shifted back by the same offset in
 * `onCloneEachNode`, so the app header/nav land where they are on screen.
 */
@Injectable({ providedIn: 'root' })
export class PageScreenshotService {
  /** True while a capture is running — the button shows it and stays disabled. */
  private readonly _busy = signal(false);
  readonly busy = this._busy.asReadonly();

  /**
   * Rasterise the current viewport into a PNG file.
   *
   * The result is handed to the composer's ordinary attachment path, so from
   * here on a screenshot is indistinguishable from a dropped or pasted image:
   * same compression, same thumbnail, same remove badge, same upload.
   *
   * Throws on failure so the caller can show the shared image error instead of
   * silently attaching nothing.
   */
  async capture(): Promise<File> {
    if (this._busy()) throw new Error('capture already running');
    this._busy.set(true);
    try {
      const canvas = await this.race(this.render(), CAPTURE_TIMEOUT_MS);
      const blob = await this.toBlob(canvas);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      return new File([blob], `screenshot-${stamp}.png`, { type: 'image/png' });
    } finally {
      this._busy.set(false);
    }
  }

  private async render(): Promise<HTMLCanvasElement> {
    const { domToCanvas } = (await import('modern-screenshot')) as unknown as {
      domToCanvas: DomToCanvas;
    };

    const win = window;
    const doc = document;
    const scrollX = win.scrollX;
    const scrollY = win.scrollY;
    const width = Math.max(1, Math.round(win.innerWidth));
    const height = Math.max(1, Math.round(win.innerHeight));
    // Cap the raster so a 3x-DPR phone does not produce a 20 MP canvas that the
    // composer then throws away anyway when it re-encodes to 1600px.
    const scale = Math.min(win.devicePixelRatio || 1, MAX_EDGE / Math.max(width, height), 2);

    return domToCanvas(doc.body, {
      width,
      height,
      scale: Math.max(1, scale),
      backgroundColor: this.pageBackground(),
      style: {
        // Slide the document under the fixed-size capture window instead of
        // rendering the whole page and cropping it afterwards.
        transform: `translate(${-scrollX}px, ${-scrollY}px)`,
        transformOrigin: 'top left',
        // `width`/`height` above are forced onto the clone as the capture
        // window; without this a `overflow: hidden` body would clip everything
        // below the fold out of its own screenshot.
        overflow: 'visible',
      },
      filter: (node: Node) => !isHidden(node),
      onCloneEachNode: (cloned: Node) => shiftFixed(cloned, scrollX, scrollY),
      timeout: CAPTURE_TIMEOUT_MS,
      // A font that will not load must not hold the shot hostage; the text
      // still renders, just in the fallback face.
      progress: null,
    });
  }

  /** Page background, so transparent areas do not come out black. */
  private pageBackground(): string {
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    if (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent') return bodyBg;
    const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
    if (htmlBg && htmlBg !== 'rgba(0, 0, 0, 0)' && htmlBg !== 'transparent') return htmlBg;
    return '#0b0f14';
  }

  private toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('screenshot encoding failed'));
      }, 'image/png');
    });
  }

  private race<T>(work: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('screenshot timed out')), ms);
      work.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
}

/**
 * Subtrees the screenshot leaves out: the feedback launcher/panel itself and
 * anything portalled into the CDK overlay container from it.
 */
export function isHidden(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return node.hasAttribute(CAPTURE_HIDE_ATTR) || node.classList.contains('cdk-overlay-container');
}

/**
 * Put a cloned `position: fixed` element back where it sits on screen.
 *
 * The clone carries its computed styles inline, and the capture root is
 * translated by the scroll offset — so a fixed element, whose containing block
 * in the clone is that translated root, would render `scrollY` pixels too high.
 * Adding the offset back cancels the translation exactly. `bottom`/`right` are
 * released because `top`/`left` plus the copied `width`/`height` already fully
 * constrain the box, and an over-constrained box drops one edge silently.
 */
export function shiftFixed(cloned: Node, scrollX: number, scrollY: number): void {
  if (!(cloned instanceof HTMLElement)) return;
  const style = cloned.style;
  if (style.position !== 'fixed') return;
  const top = Number.parseFloat(style.top);
  const left = Number.parseFloat(style.left);
  if (Number.isFinite(top)) {
    style.top = `${top + scrollY}px`;
    style.bottom = 'auto';
  }
  if (Number.isFinite(left)) {
    style.left = `${left + scrollX}px`;
    style.right = 'auto';
  }
}
