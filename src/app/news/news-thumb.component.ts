import {
  ChangeDetectionStrategy, Component, Directive, ElementRef, OnDestroy,
  afterNextRender, computed, effect, inject, input, linkedSignal, output,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NewsChannel } from './news.service';
import { newsDefaultSrc, newsSrcset } from './news-image-variants';
import { environment } from '../../environments/environment';

// Re-check schedule (ms after the first render) for the decode watchdog below.
// Bounded on purpose: it exists to recover a MISSED event, not to poll forever —
// an image that is still in flight (or a lazy one below the fold) reports
// `complete === false` and is left to its own `load` event, whenever that comes.
// The last rung is deliberately far out: this whole mechanism exists for phones
// on mobile data, where a gallery page can take well over ten seconds to settle,
// and a watchdog that has already expired by then protects nobody.
const READY_RECHECKS_MS = [1200, 4000, 10000, 22000] as const;

/**
 * Emits the `<img>` element once it is decoded — including the cache-hit case the
 * native `load` event misses. When Angular reuses an already-cached image (e.g. on
 * a silent feed refresh, or when re-entering the news route), the resource can be
 * `complete` before any listener is attached, so `(load)` never fires. We re-check
 * `complete` after the first render to recover that signal; without it those tiles
 * would stay stuck under the shimmer forever.
 *
 * The first-render check alone is not enough: it only catches an image that was
 * ALREADY decoded at that instant. A resource that settles a moment later while
 * its own `load`/`error` event goes missing (bfcache restores, a re-attached
 * <picture> source, a decode that fails after the bytes arrived) leaves the tile
 * under its placeholder forever — a wall of grey-blue bars where the pictures
 * should be (admin feedback 4e54ad2c). So the check is repeated on a short,
 * bounded schedule and reads the element's OWN state rather than trusting the
 * event: `complete` with pixels → `ready`, `complete` without pixels → `failed`.
 */
@Directive({ selector: 'img[scImgReady]', standalone: true })
export class ImgReadyDirective implements OnDestroy {
  private readonly el = inject<ElementRef<HTMLImageElement>>(ElementRef);
  readonly ready = output<HTMLImageElement>();
  /**
   * The element finished loading with no pixels — a broken source whose `error`
   * event was never delivered to us. Consumers that render a fallback bind this
   * alongside `(error)`; both are idempotent for the same tile.
   */
  readonly failed = output<HTMLImageElement>();

  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private settled = false;

  constructor() {
    afterNextRender(() => {
      if (this.check()) return;
      for (const ms of READY_RECHECKS_MS) this.timers.push(setTimeout(() => this.check(), ms));
    });
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  /** True once a verdict was emitted (or was already emitted before). */
  private check(): boolean {
    if (this.settled) return true;
    const img = this.el.nativeElement;
    // `complete` is also true for an <img> with no source at all — that is not a
    // failure, it is a slot waiting for its url.
    const hasSource = !!(img.currentSrc || img.getAttribute('src') || img.getAttribute('srcset'));
    if (!hasSource || !img.complete) return false;
    this.settled = true;
    this.clearTimers();
    if (img.naturalWidth > 0) this.ready.emit(img);
    else this.failed.emit(img);
    return true;
  }

  private clearTimers(): void {
    for (const t of this.timers.splice(0)) clearTimeout(t);
  }
}

// A landscape image (ratio ≥ this) is a usable banner / "clear title image".
// Portrait posters (e.g. the DefenseCon schedule, 3840×7389 → 0.52) fall below it
// and get cover-cropped into an unreadable sliver — those trigger the slideshow instead.
const MIN_LANDSCAPE_RATIO = 1.2;
// How long each slide stays before crossfading to the next.
const SLIDE_DWELL_MS = 5000;
// Hard cap so a 45-image comm-link doesn't spin through everything.
const MAX_IMAGES = 8;
// Slot aspect ratios — must mirror the `aspect-ratio` rules on :host below.
const SLOT_RATIO_REGULAR = 16 / 9;
const SLOT_RATIO_FEATURED = 21 / 9;

// `sizes` hints for the responsive srcset. The browser uses these (before layout)
// to pick the smallest candidate that still covers the rendered tile, so we keep
// them close to the real CSS widths (featured tiles are ~1.6fr of a 3-col grid,
// regular tiles are auto-fill minmax(280px)).
//
// These only became load-bearing once the candidates were real: the cache used to
// advertise `post 500w / cover 1140w` over two copies of the SAME full-resolution
// file, so no `sizes` value could keep a 320 px tile from downloading ~880 KB.
// With the w400/w800/w<top> ladder a 320 px slot now genuinely resolves to w400 at
// DPR 1 and w800 at DPR 2.
const SIZES_FEATURED = '(max-width: 800px) 100vw, 60vw';
// On phones the regular cards are full-width, but they are secondary thumbnails —
// under-declaring the slot width biases the srcset toward the light variant there,
// so the grid paints fast on mobile networks instead of pulling the widest one per
// card (admin feedback 32cbf3ad: "images too slow on mobile, load a smaller
// resolution first"). The featured hero keeps its crisp top variant.
const SIZES_REGULAR = '(max-width: 800px) 62vw, 320px';

// Responsive-source selection lives in ./news-image-variants — re-exported here
// because `rsiVariant` was this module's public surface (starscape imports it).
export { rsiVariant } from './news-image-variants';

/* ------------------------------------------------------------------ *
 * Baked-in frame trimming
 *
 * Some upstream images are not full-bleed art but a subject sitting inside a
 * wide, flat margin — a launcher/UI screenshot centred on a starfield backdrop
 * (feedback db5eba1e), or a 4:3 YouTube thumbnail with black bars. `object-fit:
 * cover` faithfully keeps that margin, so the tile shows a small picture
 * floating in a dark frame and reads as "wrong proportions" even though nothing
 * is distorted.
 *
 * We therefore measure the decoded image and, when it looks framed, zoom past
 * the margin. The measurement is edge-activity based rather than colour based:
 * the offending backdrops are gradients with faint stars, so "border pixels all
 * share one colour" does not hold — but "the border carries no detail" does.
 * ------------------------------------------------------------------ */

/** Long edge of the downsampled probe. Big enough to keep UI edges, cheap to scan. */
const PROBE_MAX = 128;
/** A row/column counts as margin below this share of the reference activity. */
const ACTIVITY_THRESHOLD = 0.12;
/**
 * Which quantile of the activity profile is the reference "this is content" level.
 *
 * Not the maximum: a letterbox bar or a screenshot border is a single razor-sharp
 * line whose column dwarfs every other, and scaling the threshold off that peak
 * would declare ordinary detail to be margin and eat into the subject. A high
 * quantile tracks the body of the distribution instead, so the detector errs
 * toward trimming too little rather than cropping content.
 */
const ACTIVITY_QUANTILE = 0.9;
/** Opposite margins must match within this to be read as a deliberate frame. */
const SYMMETRY_TOLERANCE = 0.05;
/** Margins thinner than this are measurement noise, not a frame. */
const MIN_PAD = 0.03;
/** Never claim more than this per side — beyond it we are cropping content. */
const MAX_PAD = 0.3;
/** Below this the zoom is not worth the resolution it costs. */
const MIN_ZOOM = 1.03;
/** Upper bound so a mis-measure can never blow the thumbnail up into mush. */
const MAX_ZOOM = 2.2;

/** Per-side margin shares of an image, in the range 0…1. */
export interface FramePads { left: number; right: number; top: number; bottom: number; }
/** Symmetric margin shares actually trimmed, per axis. */
export interface FrameInset { x: number; y: number; }

/** Activity level at `ACTIVITY_QUANTILE` of a per-row/per-column profile. */
function activityReference(profile: Float32Array): number {
  const sorted = profile.slice().sort();
  const i = Math.round((sorted.length - 1) * ACTIVITY_QUANTILE);
  return sorted[i];
}

/**
 * Per-side share of the image that carries no detail.
 *
 * Returns `null` when the pixels cannot be read — a cross-origin image without
 * CORS taints the canvas, which is the expected outcome for hosts we do not
 * allowlist. Callers treat that as "no trim".
 */
export function detectFramePads(img: HTMLImageElement): FramePads | null {
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh || typeof document === 'undefined') return null;

  const scale = Math.min(1, PROBE_MAX / Math.max(nw, nh));
  const w = Math.max(8, Math.round(nw * scale));
  const h = Math.max(8, Math.round(nh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let px: Uint8ClampedArray;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    px = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null; // tainted canvas — no pixel access, so no trim
  }

  // Luminance, then a cheap gradient magnitude per pixel.
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; p < lum.length; i += 4, p++) {
    lum[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }
  const cols = new Float32Array(w), rows = new Float32Array(h);
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const g = Math.abs(lum[y * w + x] - lum[y * w + x - 1])
              + Math.abs(lum[y * w + x] - lum[(y - 1) * w + x]);
      cols[x] += g / h;
      rows[y] += g / w;
    }
  }

  const colCut = activityReference(cols) * ACTIVITY_THRESHOLD;
  const rowCut = activityReference(rows) * ACTIVITY_THRESHOLD;
  let left = 0; while (left < w && cols[left] < colCut) left++;
  if (left === w) return null; // flat everywhere — nothing to measure
  let right = w - 1; while (right > left && cols[right] < colCut) right--;
  let top = 0; while (top < h && rows[top] < rowCut) top++;
  let bottom = h - 1; while (bottom > top && rows[bottom] < rowCut) bottom--;

  return { left: left / w, right: (w - 1 - right) / w, top: top / h, bottom: (h - 1 - bottom) / h };
}

/**
 * Reduce per-side margins to the symmetric inset we dare to crop.
 *
 * A deliberate frame pads both sides of an axis equally; a photo that merely
 * opens on empty sky pads one side only. Requiring symmetry is what keeps us
 * from eating the sky out of a landscape render. The narrower of the two sides
 * wins, so we never cut into the subject.
 */
export function frameInset(pads: FramePads): FrameInset {
  const axis = (a: number, b: number): number => {
    if (Math.abs(a - b) > SYMMETRY_TOLERANCE) return 0;
    const pad = Math.min(a, b);
    return pad < MIN_PAD ? 0 : Math.min(pad, MAX_PAD);
  };
  return { x: axis(pads.left, pads.right), y: axis(pads.top, pads.bottom) };
}

/**
 * Scale factor that makes the framed subject fill a `slotRatio` tile.
 *
 * `object-fit: cover` already picks the largest `slotRatio` window of the whole
 * image; we want the largest one that only covers the subject. Both windows
 * share the slot ratio, so their width quotient is the zoom — and the image's
 * pixel width cancels out, leaving pure ratios.
 *
 * Portrait and near-square sources are excluded on purpose. Measured against the
 * live feed, a 743×1050 Spectrum poster reads a real 11% side margin — but width
 * is the binding axis in a landscape slot, so trimming it costs ~28% of the
 * height that `cover` had left. Those images are already the compromise case
 * (that is what the slideshow exists for); spending more of them buys nothing.
 */
export function frameZoom(inset: FrameInset, imageRatio: number, slotRatio: number): number {
  const fw = 1 - 2 * inset.x, fh = 1 - 2 * inset.y;
  if (!(imageRatio >= MIN_LANDSCAPE_RATIO) || !(slotRatio > 0) || fw <= 0 || fh <= 0) return 1;
  // Width of the cover window over the full image, in units of the image width.
  const full = imageRatio >= slotRatio ? slotRatio / imageRatio : 1;
  // Same, but only covering the subject rectangle.
  const subjectRatio = imageRatio * fw / fh;
  const subject = subjectRatio >= slotRatio ? fh * slotRatio / imageRatio : fw;
  const zoom = full / subject;
  if (!Number.isFinite(zoom) || zoom < MIN_ZOOM) return 1;
  return Math.min(zoom, MAX_ZOOM);
}

/**
 * Hosts we may request with `crossorigin="anonymous"`.
 *
 * Reading pixels needs a CORS-clean image, and asking for CORS from a host that
 * does not answer with `Access-Control-Allow-Origin` costs a full extra round
 * trip (failed load → retry without the attribute). So this list is exact hosts,
 * NOT a domain suffix — each one was verified to answer `ACAO: *`:
 *  - our own `news-images` bucket, which serves the majority of thumbnails once
 *    `fetch-verse-news` has mirrored them (it caps at a handful of downloads per
 *    run, so raw upstream urls still reach the client while the cache warms),
 *  - `media.robertsspaceindustries.com` — the comm-link / patch media CDN,
 *  - `theverse.robertsspaceindustries.com` — Spectrum's upload host, which is
 *    where the launcher release-note screenshots from feedback db5eba1e live.
 *
 * The apex `robertsspaceindustries.com` (the signed `/i/<sha1>/…` proxy) sends
 * NO ACAO header, which is exactly why a suffix match would be wrong here.
 * Anything unlisted loads as before, keeps a tainted canvas, and gets no trim.
 */
const PIXEL_READABLE_HOSTS = new Set([
  'media.robertsspaceindustries.com',
  'theverse.robertsspaceindustries.com',
]);

export function isPixelReadable(url: string): boolean {
  try {
    const host = new URL(url, typeof location !== 'undefined' ? location.href : undefined).hostname;
    return host === new URL(environment.supabase.url).hostname
      || PIXEL_READABLE_HOSTS.has(host);
  } catch {
    return false;
  }
}

/**
 * Thumbnail for a news card.
 *
 * - 0 images → gradient placeholder.
 * - First image is a clear landscape title → show it statically (the common case).
 * - First image is NOT a usable title (portrait/square) but more images exist →
 *   auto-advancing crossfade slideshow through the landscape images, looping.
 * - Broken images (404 / decode error) drop out of rotation automatically.
 *
 * Aspect ratios are measured client-side from the decoded image — the upstream
 * comm-link API gives no dimensions, and ratio is the only reliable signal for
 * "is this a banner or a poster" across both RSI media hosts.
 */
@Component({
  selector: 'sc-news-thumb',
  standalone: true,
  imports: [ImgReadyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.featured]': 'featured()' },
  template: `
    @if (mode() === 'empty') {
      <div class="empty"></div>
    } @else {
      <!-- Shimmer sits BEHIND the image layers and fades out once the active layer
           has decoded — so even if the decode signal is ever missed, a painted
           image is never hidden behind the placeholder. -->
      <div class="skel" aria-hidden="true" [class.hide]="loaded()"></div>
      @for (url of display(); track url; let i = $index) {
        <img class="layer" [class.show]="i === active() && isDecoded(url)"
             [srcset]="srcsetFor(url)" [src]="defaultSrcFor(url)" [sizes]="sizes()"
             [style.--sc-thumb-zoom]="zoomFor(url)"
             alt="" decoding="async"
             [attr.crossorigin]="crossOriginFor(url)"
             [attr.loading]="i === 0 ? 'eager' : 'lazy'"
             [attr.fetchpriority]="i === 0 ? 'high' : null"
             scImgReady (ready)="onReady(url, $event)"
             (load)="onReady(url, $any($event.target))" (error)="onError(url)" />
      }
    }

    <span class="ch-pill" [class]="'ch-' + channel()">
      <span class="ch-icon" [innerHTML]="safeChannelIcon()"></span>{{ channelLabel() }}
    </span>

    @if (mode() === 'carousel' && display().length > 1) {
      <div class="dots" aria-hidden="true">
        @for (url of display(); track url; let i = $index) {
          <span class="dot" [class.on]="i === active()"></span>
        }
      </div>
    }
  `,
  styles: [`
    :host {
      display: block; position: relative;
      width: 100%; aspect-ratio: 16 / 9;
      background-color: var(--sc-bg-0);
      overflow: hidden;
      /* Keeps the internal ladder (skeleton 0 · image 1 · pill/dots 2) inside
         this component. Without it the image layer z-index:1 competes in
         the HOST page's stacking context and paints over anything the page put
         beside the thumb at z-index:auto — which is exactly what buried the
         Verse News stage headline behind its own artwork. */
      isolation: isolate;
    }
    :host(.featured) { aspect-ratio: 21 / 9; }

    .empty { position: absolute; inset: 0; background: linear-gradient(135deg, var(--sc-bg-2), var(--sc-bg-0)); }

    /* Shimmer placeholder behind the image layers — never a black tile. Fades out
       once the active image has decoded (kept mounted so the fade can play). */
    .skel {
      position: absolute; inset: 0; z-index: 0;
      background: linear-gradient(110deg, var(--sc-skel-base) 30%, var(--sc-skel-hi) 50%, var(--sc-skel-base) 70%);
      background-size: 200% 100%;
      animation: thumb-skel 1.4s ease-in-out infinite;
      opacity: 1; transition: opacity 0.45s ease; pointer-events: none;
    }
    .skel.hide { opacity: 0; animation: none; }
    @keyframes thumb-skel {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .layer {
      position: absolute; inset: 0; z-index: 1;
      width: 100%; height: 100%;
      object-fit: cover; object-position: center;
      opacity: 0; filter: blur(8px);
      /* --sc-thumb-zoom is 1 unless the image was measured as a framed subject
         (see detectFramePads) — then it scales past the baked-in margin. The
         crop stays centred and uniform, so the picture is never distorted. */
      transform: scale(var(--sc-thumb-zoom, 1));
      transition: opacity 0.6s ease, filter 0.6s ease, transform 0.4s ease;
    }
    /* Blur-up reveal: the layer fades in and sharpens the moment it decodes. */
    .layer.show { opacity: 1; filter: blur(0); }
    :host-context(.card:hover) .layer.show,
    :host-context(.vid-card:hover) .layer.show { transform: scale(calc(var(--sc-thumb-zoom, 1) * 1.04)); }

    .ch-pill {
      position: absolute; top: 8px; left: 8px; z-index: 2;
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px; border-radius: 999px;
      font-size: max(0.66rem, var(--sc-fs-floor)); font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase;
      background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent);
      backdrop-filter: blur(6px);
      border: 1px solid var(--sc-border);
    }
    .ch-pill .ch-icon { width: 12px; height: 12px; display: inline-flex; }
    .ch-pill .ch-icon svg { width: 100%; height: 100%; }
    .ch-pill.ch-comm-link { color: var(--sc-accent); border-color: var(--sc-accent); }
    .ch-pill.ch-spectrum { color: var(--sc-accent-hot); border-color: var(--sc-accent-hot); }
    .ch-pill.ch-youtube { color: var(--sc-danger); border-color: var(--sc-danger); }
    .ch-pill.ch-patch { color: var(--sc-warning); border-color: var(--sc-warning); }

    .dots {
      position: absolute; bottom: 8px; right: 8px; z-index: 2;
      display: flex; gap: 4px;
    }
    .dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: color-mix(in srgb, var(--sc-fg-2) 55%, transparent);
      transition: background 0.3s ease, transform 0.3s ease;
    }
    .dot.on { background: var(--sc-accent); transform: scale(1.25); }

    @media (prefers-reduced-motion: reduce) {
      .layer { transition: opacity 0.2s ease; filter: none; }
      .layer.show { filter: none; }
      .skel { animation: none; background-position: 0 0; }
    }
  `],
})
export class NewsThumbComponent implements OnDestroy {
  readonly images = input<string[]>([]);
  readonly channel = input<NewsChannel>('comm-link');
  readonly channelLabel = input('');
  readonly channelIcon = input('');
  readonly featured = input(false);

  private readonly sanitizer = inject(DomSanitizer);
  /**
   * Angular's HTML sanitizer strips <svg> out of an [innerHTML] binding, so the
   * pill has been showing its label with an empty box where the glyph belongs.
   * The markup comes from a fixed switch in the parent component, never from the
   * feed, so bypassing carries no injection surface. Computed, so the binding
   * only changes when the input does.
   */
  readonly safeChannelIcon = computed<SafeHtml>(
    () => this.sanitizer.bypassSecurityTrustHtml(this.channelIcon()),
  );

  // Stable identity of the image set, keyed by url CONTENT (not array identity).
  // A silent feed refresh hands us a brand-new array with the SAME urls; keying the
  // per-image state below off the array reference would wipe `decoded`/`ratios` on
  // every poll while the reused <img> elements never re-fire `load` — leaving tiles
  // stuck under the shimmer. Joining the urls makes the reset fire only on a real
  // content change.
  private readonly imagesKey = computed(() => this.images().join('\n'));

  // Measured natural aspect ratios, keyed by url. Resets when the image set changes.
  private readonly ratios = linkedSignal<string, Record<string, number>>({
    source: this.imagesKey,
    computation: () => ({}),
  });
  // Images that failed to load. Resets when the image set changes.
  private readonly errored = linkedSignal<string, Set<string>>({
    source: this.imagesKey,
    computation: () => new Set<string>(),
  });
  // Active slide index. Resets to 0 when the image set changes.
  readonly index = linkedSignal<string, number>({
    source: this.imagesKey,
    computation: () => 0,
  });

  // Urls whose image has decoded at least once. Resets when the image set changes,
  // so a fresh card shows the shimmer again instead of a stale "loaded" state.
  private readonly decoded = linkedSignal<string, Set<string>>({
    source: this.imagesKey,
    computation: () => new Set<string>(),
  });

  // Measured symmetric frame insets, keyed by url. Only the inset is stored, not
  // the zoom, so the same measurement serves both slot ratios (a card tile and
  // the detail overlay render the same url at different aspect ratios).
  private readonly insets = linkedSignal<string, Record<string, FrameInset>>({
    source: this.imagesKey,
    computation: () => ({}),
  });

  // Urls whose CORS request failed. Requesting pixel access is a nice-to-have, so
  // a host that unexpectedly withholds `Access-Control-Allow-Origin` must not cost
  // us the image: we drop the crossorigin attribute and let the browser refetch.
  private readonly noCors = linkedSignal<string, Set<string>>({
    source: this.imagesKey,
    computation: () => new Set<string>(),
  });

  // `sizes` attribute steering the responsive srcset toward the right variant.
  readonly sizes = computed(() => (this.featured() ? SIZES_FEATURED : SIZES_REGULAR));

  // Shimmer is hidden once the currently active layer has decoded. While probing
  // (first ratio unknown) we keep showing it so no black/unstyled tile flashes.
  readonly loaded = computed(() => {
    const shown = this.display();
    if (!shown.length) return false;
    const url = shown[this.active()];
    return url ? this.decoded().has(url) : false;
  });

  /** Candidate images: input order, deduped, errored ones removed, capped. */
  private readonly pool = computed(() => {
    const seen = new Set<string>();
    const bad = this.errored();
    const out: string[] = [];
    for (const url of this.images()) {
      if (!url || seen.has(url) || bad.has(url)) continue;
      seen.add(url);
      out.push(url);
      if (out.length >= MAX_IMAGES) break;
    }
    return out;
  });

  readonly mode = computed<'empty' | 'probing' | 'hero' | 'carousel'>(() => {
    const p = this.pool();
    if (!p.length) return 'empty';
    const firstRatio = this.ratios()[p[0]];
    if (firstRatio === undefined) return 'probing';           // measuring first image
    if (firstRatio >= MIN_LANDSCAPE_RATIO || p.length < 2) return 'hero';
    return 'carousel';                                        // no clear title + more images
  });

  /** Images actually rendered: single hero, or the landscape subset for the slideshow. */
  readonly display = computed(() => {
    const p = this.pool();
    const m = this.mode();
    if (m === 'empty') return [];
    if (m !== 'carousel') return p.slice(0, 1);
    const r = this.ratios();
    // Unmeasured (?? 99) stay in until proven portrait, so slides appear immediately.
    const good = p.filter((u) => (r[u] ?? 99) >= MIN_LANDSCAPE_RATIO);
    return good.length ? good : p;
  });

  readonly active = computed(() => {
    const n = this.display().length;
    return n ? this.index() % n : 0;
  });

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Run/stop the slideshow timer in reaction to mode + slide count.
    effect(() => {
      const running = this.mode() === 'carousel';
      const n = this.display().length;
      this.stop();
      if (running && n > 1 && !prefersReducedMotion()) {
        this.timer = setInterval(() => this.index.update((i) => (i + 1) % n), SLIDE_DWELL_MS);
      }
    });
  }

  /**
   * Responsive sources. For our own cached art this is the real w400/w800/w<top>
   * ladder with truthful width descriptors; anything still on an upstream RSI url
   * keeps the historic post/cover pair. Empty for a single opaque object.
   */
  srcsetFor(url: string): string {
    // '' is deliberate for the opaque case: a srcset that parses to zero
    // candidates makes the browser fall back to `src`, which is exactly right.
    return newsSrcset(url);
  }

  /** Fallback `src` for browsers ignoring srcset — never the multi-MB original. */
  defaultSrcFor(url: string): string {
    return newsDefaultSrc(url, this.featured());
  }

  /** Whether this url has decoded at least once — gates its blur-up reveal. */
  isDecoded(url: string): boolean {
    return this.decoded().has(url);
  }

  /** `crossorigin` attribute value, or null to load the image the plain way. */
  crossOriginFor(url: string): 'anonymous' | null {
    return isPixelReadable(url) && !this.noCors().has(url) ? 'anonymous' : null;
  }

  /**
   * CSS zoom that pushes a baked-in frame out of the tile. `1` for the common
   * full-bleed image, so untouched thumbnails render byte-for-byte as before.
   */
  zoomFor(url: string): string {
    const inset = this.insets()[url];
    const ratio = this.ratios()[url];
    if (!inset || !ratio) return '1';
    return String(frameZoom(inset, ratio, this.featured() ? SLOT_RATIO_FEATURED : SLOT_RATIO_REGULAR));
  }

  /** Fired by both the native `load` event and the cache-hit recovery directive. */
  onReady(url: string, img: HTMLImageElement): void {
    this.decoded.update((s) => {
      if (s.has(url)) return s;
      const next = new Set(s);
      next.add(url);
      return next;
    });
    if (!img.naturalWidth || !img.naturalHeight) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    this.ratios.update((m) => (m[url] === ratio ? m : { ...m, [url]: ratio }));
    this.measureFrame(url, img);
  }

  onError(url: string): void {
    // First failure on a CORS-requested image: retry it without the attribute
    // before giving up, so a missing ACAO header costs the trim, not the tile.
    if (this.crossOriginFor(url) === 'anonymous') {
      this.noCors.update((s) => {
        const next = new Set(s);
        next.add(url);
        return next;
      });
      return;
    }
    this.errored.update((s) => {
      if (s.has(url)) return s;
      const next = new Set(s);
      next.add(url);
      return next;
    });
  }

  /** Measure the frame once per url; a `null` reading is recorded as "no frame". */
  private measureFrame(url: string, img: HTMLImageElement): void {
    if (url in this.insets()) return;
    const pads = detectFramePads(img);
    const inset = pads ? frameInset(pads) : { x: 0, y: 0 };
    this.insets.update((m) => (url in m ? m : { ...m, [url]: inset }));
  }

  ngOnDestroy(): void { this.stop(); }

  private stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
