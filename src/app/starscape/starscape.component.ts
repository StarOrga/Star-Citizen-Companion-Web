import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { StarscapeService, StarscapeRing, Wallpaper, ringsForRole } from './starscape.service';
import { ImgReadyDirective, rsiVariant } from '../news/news-thumb.component';
import { RoleService } from '../auth/role.service';

// Believable, varied masonry-tile heights (px) for the loading skeletons. The
// gallery rows carry no dimension metadata, so a fixed cycle of plausible
// heights gives the grid a real "images incoming" silhouette instead of the
// collapsed border stripes a zero-height <img> produces before it decodes.
const SKEL_HEIGHTS = [210, 280, 240, 320, 200, 300, 260, 190, 340, 230];
// Number of placeholder tiles painted while the very first page is in flight.
const SKELETON_SLOTS = 12;
// Above-the-fold tiles load eagerly (with high fetch priority for the first
// row) so first paint is driven by real bytes, not lazy-load proximity.
const EAGER_TILES = 8;

/**
 * Starscape (#133) — high-res wallpaper gallery from crawled RSI news imagery.
 * Masonry grid of CDN previews; the lightbox and the download button use the
 * ORIGINAL full-res RSI url (we host no image bytes — hotlinks + attribution).
 */
@Component({
  selector: 'sc-starscape',
  standalone: true,
  imports: [TranslateModule, DatePipe, ImgReadyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'starscape.title' | translate }}</h1>
          <p class="hint">{{ 'starscape.subtitle' | translate }}</p>
        </div>
        <!-- Desktop-only: a Windows tray app cannot be installed from a phone,
             so the whole panel is hidden on small screens (admin feedback
             52a5ef4c) — there, only the gallery matters. -->
        <div class="app-cta">
          <span class="app-cta-title">🖥️ {{ 'starscape.appTitle' | translate }}</span>
          <span class="app-cta-desc">{{ 'starscape.appDesc' | translate }}</span>

          @if (rings().length > 0) {
            <!-- One link per ring the visitor's role may take. The ring is
                 chosen HERE, before the download: the app reads it off the
                 downloaded filename and locks to it, with no in-app switch. -->
            <div class="app-cta-rings">
              @for (r of rings(); track r.ring) {
                <a
                  class="app-cta-dl"
                  [class.secondary]="r.ring !== 'stable'"
                  [href]="r.downloadUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  download>
                  ↓ {{ 'desktop.channel.' + r.ring | translate }}
                  <span class="app-cta-ver">v{{ r.version }}</span>
                </a>
              }
            </div>
            @if (rings().length > 1) {
              <span class="app-cta-note">{{ 'starscape.appRingLock' | translate }}</span>
            }
          } @else {
            <!-- No ring pointer registered yet → the never-stale alias link. -->
            <div class="app-cta-rings">
              <a
                class="app-cta-dl"
                [href]="downloadUrl()"
                target="_blank"
                rel="noopener noreferrer"
                download>
                ↓ {{ 'starscape.appDownload' | translate }}
                @if (appVersion(); as v) { <span class="app-cta-ver">v{{ v }}</span> }
              </a>
            </div>
          }

          <span class="app-cta-note">{{ 'starscape.appNote' | translate }}</span>
          <span class="app-cta-note">{{ 'starscape.appAutoUpdate' | translate }}</span>
        </div>
      </header>

      @if (svc.seriesOptions().length > 0) {
        <div class="filter-bar" role="tablist">
          <button
            type="button"
            class="chip"
            [class.active]="!svc.activeSeries()"
            (click)="svc.setSeries('')">
            {{ 'starscape.filterAll' | translate }}
          </button>
          @for (s of svc.seriesOptions(); track s) {
            <button
              type="button"
              class="chip"
              [class.active]="svc.activeSeries() === s"
              (click)="svc.setSeries(s)">
              {{ s }}
            </button>
          }
        </div>
      }

      @if (svc.error(); as err) {
        <div class="sc-card err">{{ err }}</div>
      }

      @if (svc.wallpapers().length === 0 && !svc.loading()) {
        <div class="sc-card empty">
          <p>{{ 'starscape.empty' | translate }}</p>
        </div>
      }

      <!-- First-page load: a believable masonry silhouette of sensor "contacts"
           so the grid reads as "images incoming", never as collapsed stripes. -->
      @if (svc.loading() && svc.wallpapers().length === 0) {
        <div class="wall" aria-hidden="true">
          @for (i of skeletonSlots; track i) {
            <span class="tile skel-tile sc-skel" [style.height.px]="skelH(i)"></span>
          }
        </div>
      }

      <div class="wall">
        @for (w of svc.wallpapers(); track w.imageId; let i = $index) {
          <button type="button" class="tile" [class.loaded]="loaded().has(w.imageId)"
                  (click)="open(w)" [attr.aria-label]="w.title">
            <!-- Skeleton holds the tile's height while its preview decodes, so
                 the column never collapses to a border stripe. Dropped once the
                 image is ready (or has failed) — then the image defines height. -->
            @if (!loaded().has(w.imageId) && !broken().has(w.imageId)) {
              <span class="tile-skel sc-skel" [style.height.px]="skelH(i)" aria-hidden="true"></span>
            }
            <!-- Responsive sources: a phone pulls the light post (500w) variant,
                 desktop the crisp cover (1140w) — so the mobile grid paints fast
                 and shows something immediately instead of loading a 1140w image
                 per tile (admin feedback 32cbf3ad). The src fallback is the light
                 variant too, so browsers ignoring srcset still get the fast one. -->
            <img
              class="tile-img"
              [class.ready]="loaded().has(w.imageId)"
              [srcset]="srcsetFor(w.previewUrl)"
              [src]="lowResFor(w.previewUrl)"
              sizes="(max-width: 640px) 48vw, (max-width: 900px) 31vw, 244px"
              [alt]="w.title ?? ''"
              decoding="async"
              [attr.loading]="i < eagerTiles ? 'eager' : 'lazy'"
              [attr.fetchpriority]="i < 4 ? 'high' : null"
              scImgReady
              (ready)="onLoad(w.imageId)"
              (load)="onLoad(w.imageId)"
              (error)="onBroken(w.imageId)"
              [class.hidden]="broken().has(w.imageId)" />
            @if (w.series) { <span class="tile-series">{{ w.series }}</span> }
          </button>
        }
      </div>

      @if (svc.hasMore()) {
        <button type="button" class="sc-btn more" [disabled]="svc.loading()" (click)="svc.load()">
          {{ (svc.loading() ? 'starscape.loading' : 'starscape.loadMore') | translate }}
        </button>
      }

      <p class="attribution">{{ 'starscape.attribution' | translate }}</p>
    </section>

    @if (active(); as w) {
      <div class="lightbox" role="dialog" aria-modal="true" (click)="close()">
        <figure (click)="$event.stopPropagation()">
          <img [src]="w.sourceUrl" [alt]="w.title ?? ''" />
          <figcaption>
            <div class="lb-meta">
              <strong>{{ w.title }}</strong>
              <span class="lb-sub">
                @if (w.series) { {{ w.series }} · }
                @if (w.publishedAt) { {{ w.publishedAt | date: 'mediumDate' }} }
              </span>
            </div>
            <div class="lb-actions">
              <a class="sc-btn" [href]="w.sourceUrl" target="_blank" rel="noopener noreferrer" download>
                {{ 'starscape.download' | translate }}
              </a>
              <a class="lb-link" [href]="w.articleUrl" target="_blank" rel="noopener noreferrer">
                {{ 'starscape.sourceArticle' | translate }}
              </a>
              <button type="button" class="lb-close" (click)="close()" [attr.aria-label]="'starscape.close' | translate">✕</button>
            </div>
          </figcaption>
        </figure>
      </div>
    }
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 18px; }
    .head { display: flex; gap: 18px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
    .head h1 { margin: 0; }
    .head .hint { color: var(--sc-fg-2); margin: 4px 0 0; max-width: 68ch; }

    /* Desktop wallpaper app download CTA. */
    .app-cta {
      display: flex; flex-direction: column; gap: 3px;
      padding: 12px 16px; min-width: 240px; max-width: 320px;
      border: 1px solid var(--sc-border); border-radius: 10px;
      background: color-mix(in srgb, var(--sc-accent) 7%, var(--sc-bg-1));
      text-decoration: none; color: var(--sc-fg-1);
      transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
    }
    .app-cta:hover {
      transform: translateY(-2px); border-color: var(--sc-accent);
      box-shadow: 0 6px 18px rgba(0,0,0,0.4), 0 0 14px color-mix(in srgb, var(--sc-accent) 22%, transparent);
    }
    .app-cta-title { font-family: var(--sc-font-display); font-size: 0.9rem; color: var(--sc-fg-0); }
    .app-cta-desc { font-size: 0.74rem; color: var(--sc-fg-2); line-height: 1.35; }
    .app-cta-rings { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .app-cta-dl {
      padding: 3px 10px; border-radius: 999px; font-size: 0.74rem;
      color: var(--sc-accent); border: 1px solid var(--sc-accent);
      text-decoration: none; white-space: nowrap;
    }
    .app-cta-dl:hover { background: var(--sc-accent); color: var(--sc-bg-0); }
    /* Pre-release rings stay visually quieter than stable — the safe default
       should read as the primary action even for an admin who sees all three. */
    .app-cta-dl.secondary { color: var(--sc-fg-2); border-color: var(--sc-border); }
    .app-cta-dl.secondary:hover { background: var(--sc-bg-2); color: var(--sc-fg-0); border-color: var(--sc-accent); }
    /* Registered build version, shown as a subtle badge inside the download pill. */
    .app-cta-ver { margin-left: 6px; opacity: 0.85; font-variant-numeric: tabular-nums; }
    .app-cta-note { font-size: 0.62rem; color: var(--sc-fg-2); opacity: 0.8; margin-top: 2px; }

    .filter-bar { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip {
      padding: 4px 12px; border-radius: 999px; font-size: 0.76rem;
      background: var(--sc-bg-1); color: var(--sc-fg-2);
      border: 1px solid var(--sc-border); cursor: pointer;
    }
    .chip:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .chip.active { color: var(--sc-accent); border-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }

    /* Masonry via CSS columns — tiles keep their natural aspect ratio. */
    .wall { columns: 4 260px; column-gap: 12px; }
    .tile {
      position: relative; display: block; width: 100%; margin: 0 0 12px;
      padding: 0; border: 1px solid var(--sc-border); border-radius: 8px;
      overflow: hidden; cursor: zoom-in; background: var(--sc-bg-1);
      break-inside: avoid;
      transition: transform 0.16s ease, box-shadow 0.16s ease;
    }
    .tile:hover { transform: translateY(-2px);
      box-shadow: 0 6px 18px rgba(0,0,0,0.45), 0 0 14px color-mix(in srgb, var(--sc-accent) 25%, transparent); }
    .tile img { display: block; width: 100%; height: auto; }
    .tile img.hidden { display: none; }

    /* Blur-up "power-on" reveal: the preview develops out of a blur the moment
       it decodes, instead of popping in. While undecoded the <img> carries no
       height — the sibling skeleton reserves the box. */
    .tile-img {
      opacity: 0; filter: blur(12px); transform: scale(1.03);
      transition: opacity 0.55s ease, filter 0.55s ease, transform 0.55s ease;
    }
    .tile-img.ready { opacity: 1; filter: blur(0); transform: none; }

    /* Skeleton layer (per-tile + the first-load grid) — holds height and runs
       the shared phosphor sweep from .sc-skel (styles.scss). */
    .tile-skel { display: block; width: 100%; border-radius: inherit; }
    .skel-tile {
      display: block; width: 100%; margin: 0 0 12px;
      border: 1px solid var(--sc-border); border-radius: 8px;
      break-inside: avoid; cursor: default; pointer-events: none;
    }
    .skel-tile:hover { transform: none; box-shadow: none; }

    /* Contact-lock: a one-shot accent flash as the image confirms — the shared
       "signal acquired" punctuation, echoing the news-card reveal. */
    .tile.loaded { animation: sc-tile-lock 0.6s ease-out; }
    @keyframes sc-tile-lock {
      0% { box-shadow: 0 0 0 0 transparent; }
      25% { box-shadow: 0 0 0 1px var(--sc-accent), 0 0 18px color-mix(in srgb, var(--sc-accent) 45%, transparent); }
      100% { box-shadow: 0 0 0 0 transparent; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tile-img { transition: opacity 0.2s ease; filter: none; transform: none; }
      .tile-img.ready { filter: none; }
      .tile.loaded { animation: none; }
    }

    .tile-series {
      position: absolute; left: 8px; bottom: 8px;
      padding: 2px 8px; border-radius: 999px; font-size: 0.62rem;
      background: rgba(0, 0, 0, 0.6); color: var(--sc-fg-1);
      backdrop-filter: blur(4px);
    }

    .more { align-self: center; }
    .empty { color: var(--sc-fg-2); text-align: center; }
    .err { border-color: var(--sc-danger); color: var(--sc-danger); }
    .attribution { color: var(--sc-fg-2); font-size: 0.72rem; margin: 0; opacity: 0.85; }

    .lightbox {
      position: fixed; inset: 0; z-index: 1200;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(6px);
      padding: 24px; cursor: zoom-out;
    }
    .lightbox figure {
      margin: 0; max-width: min(1400px, 96vw); max-height: 92vh;
      display: flex; flex-direction: column; gap: 0; cursor: default;
    }
    .lightbox img {
      max-width: 100%; max-height: calc(92vh - 64px); object-fit: contain;
      border-radius: 8px 8px 0 0; background: var(--sc-bg-0);
    }
    figcaption {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; flex-wrap: wrap;
      padding: 10px 14px; border-radius: 0 0 8px 8px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-top: 0;
    }
    .lb-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .lb-meta strong { font-size: 0.9rem; color: var(--sc-fg-0); }
    .lb-sub { color: var(--sc-fg-2); font-size: 0.74rem; }
    .lb-actions { display: flex; align-items: center; gap: 12px; }
    .lb-actions .sc-btn { text-decoration: none; color: var(--sc-accent); border-color: var(--sc-accent); }
    .lb-actions .sc-btn:hover { background: var(--sc-accent); color: var(--sc-bg-0); }
    .lb-link { color: var(--sc-fg-2); font-size: 0.78rem; }
    .lb-link:hover { color: var(--sc-fg-0); }
    .lb-close {
      background: transparent; border: 0; color: var(--sc-fg-2);
      font-size: 1rem; cursor: pointer; padding: 4px;
    }
    .lb-close:hover { color: var(--sc-fg-0); }

    @media (max-width: 640px) {
      .wall { columns: 2 150px; }
      .lightbox { padding: 8px; }
    }

    /* A Windows tray app cannot be installed from a phone or tablet, so the
       download panel is dropped entirely below the desktop breakpoint — there,
       only the images matter (admin feedback 52a5ef4c, widening the 640px rule
       from 32cbf3ad which still showed it in landscape and on small tablets).
       display:none also takes it out of the tab order and the a11y tree. */
    @media (max-width: 900px) {
      .app-cta { display: none; }
    }
  `],
})
export class StarscapeComponent implements OnInit {
  readonly svc = inject(StarscapeService);
  private readonly roles = inject(RoleService);

  /**
   * Rings this visitor may download, clamped by role (viewer → stable,
   * collaborator → +beta, admin → +alpha). Anonymous visitors read as viewer.
   */
  readonly allowedRings = computed<readonly StarscapeRing[]>(() => ringsForRole(this.roles.role()));

  /** Ring builds that actually resolved — see `StarscapeService.loadRingReleases`. */
  readonly rings = this.svc.ringReleases;

  /**
   * Fixed fallback download: the stable `wallpaper-app-latest` alias release (a
   * version-less asset the `wallpaper-app` CI republishes on every
   * `wallpaper-app-v*` tag). Used when no `desktop_releases` row is registered yet
   * (or the resolver fails), so the button always works.
   */
  readonly appDownloadUrl =
    'https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/wallpaper-app-latest/starscape-wallpaper.exe';

  /** Registered-build download URL when available, else the never-stale alias. */
  readonly downloadUrl = computed(() => this.svc.desktopRelease()?.downloadUrl ?? this.appDownloadUrl);
  /** Registered build version (e.g. "0.3.2"), or null before it loads / if unregistered. */
  readonly appVersion = computed(() => this.svc.desktopRelease()?.version ?? null);

  readonly active = signal<Wallpaper | null>(null);
  readonly broken = signal<ReadonlySet<string>>(new Set<string>());
  // Preview images that have decoded at least once — gates each tile's blur-up
  // reveal and drops its skeleton. Cache hits are recovered via ImgReadyDirective.
  readonly loaded = signal<ReadonlySet<string>>(new Set<string>());

  // Template constants for the loading skeletons.
  readonly skeletonSlots = Array.from({ length: SKELETON_SLOTS }, (_, i) => i);
  readonly eagerTiles = EAGER_TILES;

  constructor() {
    // Re-resolve the ring links whenever the role settles (it arrives after the
    // profile fetch, so a collaborator's beta link appears once it does).
    effect(() => {
      void this.svc.loadRingReleases(this.allowedRings());
    });
  }

  async ngOnInit(): Promise<void> {
    void this.svc.loadDesktopRelease();
    if (this.svc.wallpapers().length === 0) await this.svc.load(true);
  }

  /** Plausible varied placeholder height (px) for tile `i`, cycled from a fixed set. */
  skelH(i: number): number {
    return SKEL_HEIGHTS[i % SKEL_HEIGHTS.length];
  }

  /**
   * Responsive `srcset` for a tile: light `post` (≤500w) + crisp `cover` (≤1140w),
   * derived from the stored `cover` preview url. Returns '' for urls that can't be
   * re-varianted (e.g. the signed RSI proxy) so the browser just uses `src`.
   */
  srcsetFor(previewUrl: string): string {
    const post = rsiVariant(previewUrl, 'post');
    const cover = rsiVariant(previewUrl, 'cover');
    return post === cover ? '' : `${post} 500w, ${cover} 1140w`;
  }

  /** Light `post` variant used as the `src` fallback — the fast, mobile-first source. */
  lowResFor(previewUrl: string): string {
    return rsiVariant(previewUrl, 'post');
  }

  /** Marks a preview decoded → fades it in and removes its skeleton. */
  onLoad(id: string): void {
    if (this.loaded().has(id)) return;
    const next = new Set(this.loaded());
    next.add(id);
    this.loaded.set(next);
  }

  open(w: Wallpaper): void {
    this.active.set(w);
  }

  close(): void {
    this.active.set(null);
  }

  onBroken(id: string): void {
    const next = new Set(this.broken());
    next.add(id);
    this.broken.set(next);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }
}
