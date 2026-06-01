import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, input, linkedSignal } from '@angular/core';
import { NewsChannel } from './news.service';

// A landscape image (ratio ≥ this) is a usable banner / "clear title image".
// Portrait posters (e.g. the DefenseCon schedule, 3840×7389 → 0.52) fall below it
// and get cover-cropped into an unreadable sliver — those trigger the slideshow instead.
const MIN_LANDSCAPE_RATIO = 1.2;
// How long each slide stays before crossfading to the next.
const SLIDE_DWELL_MS = 5000;
// Hard cap so a 45-image comm-link doesn't spin through everything.
const MAX_IMAGES = 8;

// `sizes` hints for the responsive srcset. The browser uses these (before layout)
// to pick the smallest variant that still covers the rendered tile, so we keep them
// close to the real CSS widths (featured tiles are ~1.6fr of a 3-col grid, regular
// tiles are auto-fill minmax(280px)). Featured tops out at `cover` (1140w), regular
// stays on `post` (500w) on typical viewports.
const SIZES_FEATURED = '(max-width: 800px) 100vw, 60vw';
const SIZES_REGULAR = '(max-width: 800px) 100vw, 320px';

/**
 * Swap the variant segment of an RSI **media** CDN url to a tile-sized one.
 *
 * Only `https://media.robertsspaceindustries.com/<id>/<variant>.<ext>` urls are
 * rewritable: the last path segment before the extension is the variant, and the
 * variants `post` (≤500w) / `cover` (≤1140w) preserve aspect ratio. The original
 * extension MUST be kept (a PNG source 404s as `.jpg`).
 *
 * Any other url — notably the signed `https://robertsspaceindustries.com/i/<sha1>/…`
 * proxy (already tile-sized, returns 400 if rewritten) — is returned unchanged.
 */
export function rsiVariant(url: string, target: 'post' | 'cover'): string {
  const m = /^(https:\/\/media\.robertsspaceindustries\.com\/[^/]+\/)[^/.]+(\.[a-zA-Z0-9]+)$/.exec(url);
  return m ? `${m[1]}${target}${m[2]}` : url;
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.featured]': 'featured()' },
  template: `
    @if (mode() === 'empty') {
      <div class="empty"></div>
    } @else {
      @if (!loaded()) {
        <div class="skel" aria-hidden="true"></div>
      }
      @for (url of display(); track url; let i = $index) {
        <img class="layer" [class.show]="i === active()"
             [srcset]="srcsetFor(url)" [src]="defaultSrcFor(url)" [sizes]="sizes()"
             alt="" decoding="async"
             [attr.loading]="i === 0 ? 'eager' : 'lazy'"
             [attr.fetchpriority]="i === 0 ? 'high' : null"
             (load)="onLoad(url, $event)" (error)="onError(url)" />
      }
    }

    <span class="ch-pill" [class]="'ch-' + channel()">
      <span class="ch-icon" [innerHTML]="channelIcon()"></span>{{ channelLabel() }}
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
    }
    :host(.featured) { aspect-ratio: 21 / 9; }

    .empty { position: absolute; inset: 0; background: linear-gradient(135deg, var(--sc-bg-2), var(--sc-bg-0)); }

    /* Shimmer placeholder shown until the active image has loaded — never a black tile. */
    .skel {
      position: absolute; inset: 0; z-index: 1;
      background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%);
      background-size: 200% 100%;
      animation: thumb-skel 1.4s ease-in-out infinite;
    }
    @keyframes thumb-skel {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .layer {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: cover; object-position: center;
      opacity: 0;
      transition: opacity 0.8s ease, transform 0.4s ease;
    }
    .layer.show { opacity: 1; }
    :host-context(.card:hover) .layer { transform: scale(1.04); }

    .ch-pill {
      position: absolute; top: 8px; left: 8px; z-index: 2;
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px; border-radius: 999px;
      font-size: 0.66rem; font-weight: 700; letter-spacing: 0.08em;
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
      .layer { transition: opacity 0.2s ease; }
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

  // Measured natural aspect ratios, keyed by url. Resets when the image set changes.
  private readonly ratios = linkedSignal<readonly string[], Record<string, number>>({
    source: () => this.images(),
    computation: () => ({}),
  });
  // Images that failed to load. Resets when the image set changes.
  private readonly errored = linkedSignal<readonly string[], Set<string>>({
    source: () => this.images(),
    computation: () => new Set<string>(),
  });
  // Active slide index. Resets to 0 when the image set changes.
  readonly index = linkedSignal<readonly string[], number>({
    source: () => this.images(),
    computation: () => 0,
  });

  // Urls whose image has decoded at least once. Resets when the image set changes,
  // so a fresh card shows the shimmer again instead of a stale "loaded" state.
  private readonly decoded = linkedSignal<readonly string[], Set<string>>({
    source: () => this.images(),
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

  /** Responsive sources: tile-sized `post` (500w) and crisp `cover` (1140w). */
  srcsetFor(url: string): string {
    return `${rsiVariant(url, 'post')} 500w, ${rsiVariant(url, 'cover')} 1140w`;
  }

  /** Fallback `src` for browsers ignoring srcset — never the multi-MB original. */
  defaultSrcFor(url: string): string {
    return rsiVariant(url, this.featured() ? 'cover' : 'post');
  }

  onLoad(url: string, ev: Event): void {
    this.decoded.update((s) => {
      if (s.has(url)) return s;
      const next = new Set(s);
      next.add(url);
      return next;
    });
    const img = ev.target as HTMLImageElement;
    if (!img.naturalWidth || !img.naturalHeight) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    this.ratios.update((m) => (m[url] === ratio ? m : { ...m, [url]: ratio }));
  }

  onError(url: string): void {
    this.errored.update((s) => {
      if (s.has(url)) return s;
      const next = new Set(s);
      next.add(url);
      return next;
    });
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
