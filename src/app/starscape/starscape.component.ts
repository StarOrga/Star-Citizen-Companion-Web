import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { StarscapeService, StarscapeRing, Wallpaper, ringsForRole } from './starscape.service';
import { ImgReadyDirective, rsiVariant } from '../news/news-thumb.component';
import { RoleService } from '../auth/role.service';
import { AppDownloadMenuComponent } from '../desktop/app-download-menu.component';
import { StarscapeAppPromoComponent } from './starscape-app-promo.component';
import { isPlainLeftClick } from '../core/modified-click.util';
import { ScDatePipe } from '../core/locale/sc-date.pipe';

// Believable, varied masonry-tile shapes for the loading skeletons. The gallery
// rows carry no dimension metadata, so a fixed cycle of plausible shapes gives
// the grid a real "images incoming" silhouette instead of the collapsed border
// stripes a zero-height <img> produces before it decodes.
//
// These are ASPECT RATIOS, not pixel heights: a placeholder has to be the size
// the image will actually be, and that depends on the column width. Fixed
// heights were tuned for a ~260 px desktop column, so in the 173 px column a
// phone used to get they painted 200-340 px blocks that then snapped down to
// ~75 px of real image — a full-page reflow on every decode. A ratio tracks the
// column at every breakpoint, so the tile never resizes when the image lands.
// The cycle leans wide because the source art is: of the 24 wallpapers on page
// one, 16 are wider than 2.2:1 and only 2 are portrait.
const SKEL_RATIOS = ['2.35', '1.78', '2.4', '2.35', '1.85', '3', '2.35', '2', '2.5', '1.6'];
// Number of placeholder tiles painted while the very first page is in flight.
const SKELETON_SLOTS = 12;
// Query parameter carrying a single wallpaper — what the share button hands out,
// and what reopens that wallpaper's lightbox when the link is followed.
const DEEP_LINK_PARAM = 'image';
// How long the clipboard-fallback confirmation stays up.
const SHARE_HINT_MS = 2600;
// Above-the-fold tiles load eagerly (with high fetch priority for the first
// row) so first paint is driven by real bytes, not lazy-load proximity.
const EAGER_TILES = 8;
// How long the first screen of tiles may sit in its placeholder state before the
// page says so. The eager tiles start fetching immediately, so if NOT ONE of them
// has decoded by then, something is wrong with the images rather than with the
// scroll position — and a wall of grey-blue placeholder bars with no explanation
// is exactly what the gallery was reported as (admin feedback 4e54ad2c).
//
// Generous on purpose: the eight eager previews are ~100 KB each, so a genuinely
// slow mobile link needs well over ten seconds before the FIRST one lands. A
// notice that fires while the page is merely slow would be crying wolf at the
// exact users it is meant to help.
const IMAGE_STALL_MS = 20_000;

/**
 * Starscape (#133) — high-res wallpaper gallery from crawled RSI news imagery.
 * Masonry grid of CDN previews; the lightbox and the download button use the
 * ORIGINAL full-res RSI url (we host no image bytes — hotlinks + attribution).
 */
@Component({
  selector: 'sc-starscape',
  standalone: true,
  imports: [
    TranslateModule,
    ScDatePipe,
    ImgReadyDirective,
    AppDownloadMenuComponent,
    StarscapeAppPromoComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'starscape.title' | translate }}</h1>
          <p class="hint">{{ 'starscape.subtitle' | translate }}</p>
        </div>
        <!-- Desktop-only: a Windows tray app cannot be installed from a phone,
             so the control is hidden on small screens (admin feedback 52a5ef4c)
             - there, only the gallery matters. Since 924bf1d8 this is the SAME
             component the Data Uploader uses on the Codex landing: a compact
             trigger that expands into an overlay with one download per ring.
             The ring is still chosen HERE, before the download: the app reads it
             off the filename and locks to it, no in-app switch. -->
        <div class="app-cta">
          <sc-app-download-menu [product]="'starscape'" [fallbackUrl]="appDownloadUrl" />
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

      <!-- A failed page load is a dead end without a way back in: the request is
           only ever fired on mount, so a phone that lost the connection for one
           second used to be stuck with whatever it got (admin feedback 4e54ad2c,
           round 3). The raw message stays as a small technical line — the
           headline and the action are localized. -->
      @if (svc.error(); as err) {
        <div class="sc-card err" role="alert">
          <p class="err-msg">
            {{ (svc.timedOut() ? 'starscape.errors.timeout' : 'starscape.errors.load') | translate }}
          </p>
          <!-- Only a message that came from the SERVER earns the technical line;
               our own deadline marker is not a diagnosis and the headline above
               already says it in the user's language. -->
          @if (!svc.timedOut()) {
            <p class="err-detail">{{ err }}</p>
          }
          <button type="button" class="sc-btn" [disabled]="svc.loading()" (click)="reload()">
            {{ 'starscape.retry' | translate }}
          </button>
        </div>
      }

      @if (svc.wallpapers().length === 0 && !svc.loading() && !svc.error()) {
        <div class="sc-card empty">
          <p>{{ 'starscape.empty' | translate }}</p>
        </div>
      }

      <!-- First-page load: a believable masonry silhouette of sensor "contacts"
           so the grid reads as "images incoming", never as collapsed stripes.
           The caption is what tells a visitor that the bars ARE the loading
           state — unlabelled, a screen of them just reads as broken content. -->
      @if (svc.loading() && svc.wallpapers().length === 0) {
        <p class="wall-status" role="status" aria-live="polite">{{ 'starscape.loadingImages' | translate }}</p>
        <div class="wall" aria-hidden="true">
          @for (i of skeletonSlots; track i) {
            <span class="tile skel-tile sc-skel" [style.aspectRatio]="skelRatio(i)"></span>
          }
        </div>
      }

      <!-- Rows arrived, pictures did not. Bounded by IMAGE_STALL_MS so the
           placeholders can never be the final state of the page. -->
      @if (imagesStalled()) {
        <div class="sc-card stalled" role="status">
          <p>{{ 'starscape.imagesStalled' | translate }}</p>
          <button type="button" class="sc-btn" (click)="retryImages()">
            {{ 'starscape.retryImages' | translate }}
          </button>
        </div>
      }

      <div class="wall">
        @for (w of svc.wallpapers(); track w.imageId; let i = $index) {
          <!-- A tile is a link to the full-res source (d2171662): middle click,
               Ctrl/⌘+click and "open image in new tab" go straight to the CDN
               original; a plain left click keeps the in-page lightbox. -->
          <a class="tile" [class.loaded]="loaded().has(w.imageId)"
             [href]="w.sourceUrl" target="_blank" rel="noopener noreferrer"
             [attr.aria-label]="w.title"
             (click)="onTileClick($event, w)"
             (keydown.space)="onTileSpace($event, w)">
            <!-- Skeleton holds the tile's height while its preview decodes, so
                 the column never collapses to a border stripe. Dropped once the
                 image is ready (or has failed) — then the image defines height. -->
            @if (!loaded().has(w.imageId) && !broken().has(w.imageId)) {
              <span class="tile-skel sc-skel" [style.aspectRatio]="skelRatio(i)" aria-hidden="true"></span>
            }
            <!-- Broken preview: keep the tile's shape and SAY so, with a retry.
                 Before this, a failed image dropped its skeleton and hid the
                 <img>, collapsing the tile to a 2px border stripe with no hint
                 that anything went wrong (admin feedback 4e54ad2c round 3). -->
            @if (broken().has(w.imageId)) {
              <span class="tile-failed" [style.aspectRatio]="skelRatio(i)">
                <span class="tf-msg">{{ 'starscape.imageFailed' | translate }}</span>
                <button type="button" class="tf-retry" (click)="retryTile($event, w.imageId)">
                  {{ 'starscape.retry' | translate }}
                </button>
              </span>
            }
            <!-- Responsive sources. Only two candidates exist upstream: the light
                 post (500w) and the crisp cover (1140w). Which one is right is
                 decided by the tile's real CSS width per breakpoint, measured
                 against the built app rather than assumed:

                   ≤480px  phone, 1 column   → 358-448px tile → post = 1.1-1.4x
                   ≤640px  1 column          → up to 608px    → cover
                   ≤900px  2 columns         → ~350px @DPR2   → cover
                   >900px  3-4 columns       → ~300px @DPR1   → post

                 A phone is pinned to post by the <source> below because "sizes"
                 alone cannot hold it there: sizes is in CSS pixels but candidate
                 selection multiplies it by the device pixel ratio, so a DPR-3
                 phone overshoots the 500w candidate and pulls cover for EVERY
                 tile (admin feedback 4e54ad2c — 7.8 MB per gallery page on
                 mobile against 1.9 MB on desktop, the exact inverse of the
                 intent). At the 358px tile a phone now gets, post is still 1.4x
                 CSS density, which is the usual cap for a browse thumbnail; the
                 crisp copy is one tap away in the lightbox.

                 The pin stops at 480px rather than the 900px it used to cover:
                 above that the tile is 350-608px wide on DPR-2 hardware, where
                 500w works out to 0.8-0.9x CSS density — visibly soft. Those
                 slots need cover, and the honest "sizes" below now asks for it.
                 (The 48vw/31vw/244px it replaces under-declared every slot; they
                 were written for the two-column phone grid this feedback
                 removed, and 244px was never the ~300px desktop tile.) -->
            <picture>
              <source media="(max-width: 480px)" [srcset]="lowResFor(w.previewUrl, w.imageId)" />
              <img
                class="tile-img"
                [class.ready]="loaded().has(w.imageId)"
                [srcset]="srcsetFor(w.previewUrl, w.imageId)"
                [src]="lowResFor(w.previewUrl, w.imageId)"
                sizes="(max-width: 640px) 95vw, (max-width: 900px) 46vw, 300px"
                [alt]="w.title ?? ''"
                decoding="async"
                [attr.loading]="i < eagerTiles ? 'eager' : 'lazy'"
                [attr.fetchpriority]="i < 4 ? 'high' : null"
                scImgReady
                (ready)="onLoad(w.imageId)"
                (load)="onLoad(w.imageId)"
                (failed)="onBroken(w.imageId)"
                (error)="onBroken(w.imageId)"
                [class.hidden]="broken().has(w.imageId)" />
            </picture>
            @if (w.series) { <span class="tile-series">{{ w.series }}</span> }
          </a>
        }
      </div>

      @if (svc.hasMore()) {
        <button type="button" class="sc-btn more" [disabled]="svc.loading()" (click)="svc.load()">
          {{ (svc.loading() ? 'starscape.loading' : 'starscape.loadMore') | translate }}
        </button>
      }

      <p class="attribution">{{ 'starscape.attribution' | translate }}</p>
    </section>

    <!-- The download pitch: three seconds in, once per browser session, and only
         on a desktop-sized viewport (admin feedback eb9c6ec3). -->
    <sc-starscape-app-promo
      [wallpapers]="promoWallpapers()"
      [downloadUrl]="promoDownloadUrl()"
      [version]="promoVersion()" />

    @if (active(); as w) {
      <div class="lightbox" role="dialog" aria-modal="true" (click)="close()">
        <figure (click)="$event.stopPropagation()">
          <!-- Phones get the 1140w cover rather than the untouched original: a
               375 px screen at DPR 3 can resolve 1125 px, so the cover is
               visually identical there but a fraction of the bytes — opening a
               tile on mobile data used to mean waiting on a multi-MB source
               file (admin feedback 4e54ad2c). "Full resolution" stays one tap
               away: the download button and the tile link both keep the
               original. -->
          <picture>
            <source media="(max-width: 900px)" [srcset]="previewFor(w)" />
            <img [src]="w.sourceUrl" [alt]="w.title ?? ''" />
          </picture>
          <figcaption>
            <div class="lb-meta">
              <strong>{{ w.title }}</strong>
              <span class="lb-sub">
                @if (w.series) { {{ w.series }} · }
                @if (w.publishedAt) { {{ w.publishedAt | scDate }} }
              </span>
            </div>
            <div class="lb-actions">
              <!-- A real ACTION, so a <button>: it opens the Android/iOS share
                   sheet via the Web Share API and only falls back to the
                   clipboard where that API is missing (desktop browsers). -->
              <button type="button" class="sc-btn lb-share" (click)="share(w)">
                {{ 'starscape.share.label' | translate }}
              </button>
              <a class="sc-btn" [href]="w.sourceUrl" target="_blank" rel="noopener noreferrer" download>
                {{ 'starscape.download' | translate }}
              </a>
              <a class="lb-link" [href]="w.articleUrl" target="_blank" rel="noopener noreferrer">
                {{ 'starscape.sourceArticle' | translate }}
              </a>
              <button type="button" class="lb-close" (click)="close()" [attr.aria-label]="'starscape.close' | translate">✕</button>
            </div>
            @if (shareHint(); as hint) {
              <p class="lb-hint" role="status" aria-live="polite">{{ hint | translate }}</p>
            }
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

    /* Slot for the shared app-download menu — the menu owns its own styling and
       overlay positioning (sc-app-download-menu); this only aligns the column. */
    .app-cta { display: flex; justify-content: flex-end; flex: 0 0 auto; }

    .filter-bar { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip {
      padding: 4px 12px; border-radius: 999px; font-size: max(0.76rem, var(--sc-fs-floor));
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
      break-inside: avoid; color: inherit; text-decoration: none;
      transition: transform 0.16s ease, box-shadow 0.16s ease;
    }
    .tile:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .tile:hover { transform: translateY(-2px);
      box-shadow: 0 6px 18px rgba(0,0,0,0.45), 0 0 14px color-mix(in srgb, var(--sc-accent) 25%, transparent); }
    /* <picture> is inline by default — it has to become the tile's block box so
       the image keeps filling the column. */
    .tile picture { display: block; }
    .tile img { display: block; width: 100%; max-width: 100%; height: auto; }
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
      padding: 2px 8px; border-radius: 999px; font-size: max(0.62rem, var(--sc-fs-floor));
      background: rgba(0, 0, 0, 0.6); color: var(--sc-fg-1);
      backdrop-filter: blur(4px);
    }

    /* Broken preview: the tile keeps the shape it reserved and states the case,
       instead of collapsing into an unexplained border stripe. */
    .tile-failed {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 8px; width: 100%; padding: 12px; text-align: center;
      background: var(--sc-bg-1);
      border-radius: inherit; box-sizing: border-box;
    }
    .tf-msg { color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); }
    .tf-retry {
      position: relative; z-index: 1;
      padding: 6px 14px; border-radius: 6px; cursor: pointer;
      background: transparent; border: 1px solid var(--sc-accent); color: var(--sc-accent);
      font-family: inherit; font-size: max(0.72rem, var(--sc-fs-floor));
    }
    .tf-retry:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }

    .more { align-self: center; }
    .empty { color: var(--sc-fg-2); text-align: center; }
    .err { border-color: var(--sc-danger); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
    .err .err-msg { margin: 0; color: var(--sc-danger); }
    .err .err-detail { margin: 0; color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); overflow-wrap: anywhere; }
    /* Placeholder caption + the "no picture arrived" notice — same quiet voice. */
    .wall-status { margin: 0; color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor)); }
    .stalled { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; color: var(--sc-fg-2); }
    .stalled p { margin: 0; }
    .attribution { color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); margin: 0; opacity: 0.85; }

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
    /* display: contents keeps the <img> as the figure's flex item, so the
       sizing rules below apply exactly as they did before the <picture>. */
    .lightbox picture { display: contents; }
    .lightbox img {
      max-width: 100%; max-height: calc(92vh - 64px); object-fit: contain;
      border-radius: 8px 8px 0 0; background: var(--sc-bg-0);
    }
    /* Dynamic viewport units where supported: on a phone "vh" is the URL-bar-less
       LARGE viewport, so a 92vh figure is taller than what is actually on screen
       and the caption (with the share button) sits below the fold. */
    @supports (height: 100dvh) {
      .lightbox figure { max-height: 92dvh; }
      .lightbox img { max-height: calc(92dvh - 64px); }
    }
    figcaption {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; flex-wrap: wrap;
      padding: 10px 14px; border-radius: 0 0 8px 8px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-top: 0;
    }
    .lb-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .lb-meta strong { font-size: 0.9rem; color: var(--sc-fg-0); }
    .lb-sub { color: var(--sc-fg-2); font-size: max(0.74rem, var(--sc-fs-floor)); }
    .lb-actions { display: flex; align-items: center; gap: 12px; }
    .lb-actions .sc-btn { text-decoration: none; color: var(--sc-accent); border-color: var(--sc-accent); }
    .lb-actions .sc-btn:hover { background: var(--sc-accent); color: var(--sc-bg-0); }
    .lb-link { color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); }
    .lb-link:hover { color: var(--sc-fg-0); }
    .lb-close {
      background: transparent; border: 0; color: var(--sc-fg-2);
      font-size: 1rem; cursor: pointer; padding: 4px;
    }
    .lb-close:hover { color: var(--sc-fg-0); }
    .lb-hint {
      flex: 1 0 100%; margin: 0; text-align: right;
      color: var(--sc-accent); font-size: max(0.72rem, var(--sc-fs-floor));
    }

    @media (max-width: 640px) {
      /* ONE column on phones, not two (admin feedback 4e54ad2c: "immer noch nur
         striche in starscape mobile").

         Starscape's art is desktop wallpaper: of the 24 images on page one, 16
         are wider than 2.2:1 and the median is 2.34:1. Two columns on a 390 px
         screen leave a 173 px column, so the median wallpaper rendered 173x75 px
         — twenty-four horizontal bands stacked into a wall of stripes. The
         images were loading the whole time (all 24 return HTTP 200), which is
         why fixing their byte weight in #331 changed nothing: the geometry, not
         the network, was crushing them.

         A single column is 358 px on the same screen, so the median wallpaper
         lands at 358x153 px and reads as a picture. It is also the layout the
         request asked for by name — a full-width feed is what "mobile friendly
         zum durchscrollen" means. */
      .wall { columns: 1; }
      /* …but one column also turns the twelve-slot first-load wall into two
         full screens of nothing but shimmering placeholder bars, which is
         precisely the thing being complained about ("ich sehe nur graue blaue
         balken", admin feedback 4e54ad2c round 3). Four slots fill the first
         phone screen; anything past that is a promise the grid does not need to
         make. The desktop grid, where twelve slots are three short rows, is
         untouched. */
      .skel-tile:nth-child(n + 5) { display: none; }
      /* Full-bleed overlay → respect the notch / home indicator. */
      .lightbox {
        padding:
          max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right))
          max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
      }
      /* Caption stacks so the actions get a full-width row of their own instead
         of being squeezed against the title on a 375px screen. */
      figcaption { flex-direction: column; align-items: stretch; gap: 10px; }
      .lb-actions { flex-wrap: wrap; gap: 8px; }
      .lb-actions .sc-btn { flex: 1 1 auto; text-align: center; }
      .lb-hint { text-align: left; }
    }

    /* Touch targets. 48px rather than the 44px minimum because the app-wide
       reveal/press animations scale interactive elements by 0.994, which measures
       a 44px control as 43px. */
    @media (pointer: coarse) {
      .chip { min-height: 48px; display: inline-flex; align-items: center; }
      .more { min-height: 48px; }
      .tf-retry { min-height: 48px; }
      .err .sc-btn, .stalled .sc-btn { min-height: 48px; }
      /* No blur-up on touch hardware. A 12px blur over a full-width phone tile
         is a GPU-composited layer per tile, and while it is up the picture IS a
         grey-blue smear — on a mid-range phone decoding a whole column at once
         that is most of what you see (admin feedback 4e54ad2c round 3: "ich sehe
         nur graue blaue balken"). The fade alone still reads as a reveal and
         cannot leave a half-composited layer behind. */
      .tile-img { filter: none; transform: none; transition: opacity 0.3s ease; }
      .tile-img.ready { filter: none; transform: none; }
      .lb-actions .sc-btn { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; }
      .lb-link { min-height: 48px; display: inline-flex; align-items: center; }
      .lb-close { min-width: 48px; min-height: 48px; }
      /* No hover on touch — the lift and the zoom-in cursor are mouse idioms. */
      .tile { cursor: pointer; }
      .tile:hover { transform: none; box-shadow: none; }
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
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

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

  /** Stills for the promo's mock desktop — real gallery images, once loaded. */
  readonly promoWallpapers = computed(() =>
    this.svc.wallpapers().slice(0, 3).map((w) => this.lowResFor(w.previewUrl)),
  );
  /** The promo always pitches the safest build the visitor may take. */
  readonly promoDownloadUrl = computed(
    () => this.rings().find((r) => r.ring === 'stable')?.downloadUrl ?? this.downloadUrl(),
  );
  readonly promoVersion = computed(
    () => this.rings().find((r) => r.ring === 'stable')?.version ?? this.appVersion(),
  );

  readonly active = signal<Wallpaper | null>(null);
  /** Translation key of the clipboard-fallback confirmation, or null. */
  readonly shareHint = signal<string | null>(null);
  readonly broken = signal<ReadonlySet<string>>(new Set<string>());
  // Preview images that have decoded at least once — gates each tile's blur-up
  // reveal and drops its skeleton. Cache hits are recovered via ImgReadyDirective.
  readonly loaded = signal<ReadonlySet<string>>(new Set<string>());
  /**
   * Retry counter per image id. Bumping it appends a `#r<n>` fragment to the
   * tile's urls, which makes the browser re-run its image-selection algorithm
   * for that element — the only way to re-attempt a source without touching the
   * url a signed CDN link may depend on (a fragment is never sent to a server).
   */
  private readonly retries = signal<Readonly<Record<string, number>>>({});
  /** IMAGE_STALL_MS has passed since the rows arrived. */
  private readonly stallElapsed = signal(false);

  /**
   * Rows are on screen but not a single preview has resolved — the state the
   * gallery gets reported in ("ich sehe nur graue blaue balken"). Distinct from
   * a broken tile, which says so on its own.
   */
  readonly imagesStalled = computed(
    () =>
      this.stallElapsed() &&
      this.svc.wallpapers().length > 0 &&
      this.loaded().size === 0 &&
      this.broken().size === 0,
  );

  // Template constants for the loading skeletons.
  readonly skeletonSlots = Array.from({ length: SKELETON_SLOTS }, (_, i) => i);
  readonly eagerTiles = EAGER_TILES;

  private shareHintTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Re-resolve the ring links whenever the role settles (it arrives after the
    // profile fetch, so a collaborator's beta link appears once it does).
    effect(() => {
      void this.svc.loadRingReleases(this.allowedRings());
    });
    // Arm the stall watch as soon as there are rows to draw.
    effect(() => {
      if (this.svc.wallpapers().length > 0) this.armStallWatch();
    });
    this.destroyRef.onDestroy(() => {
      if (this.shareHintTimer) clearTimeout(this.shareHintTimer);
      if (this.stallTimer) clearTimeout(this.stallTimer);
    });
  }

  async ngOnInit(): Promise<void> {
    void this.svc.loadDesktopRelease();
    if (this.svc.wallpapers().length === 0) await this.svc.load(true);
    await this.openDeepLink();
  }

  /** Start (or restart) the "no picture has arrived yet" deadline. */
  private armStallWatch(): void {
    if (this.stallTimer) return;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      this.stallElapsed.set(true);
    }, IMAGE_STALL_MS);
  }

  /** Re-run the page request after a failed or timed-out load. */
  reload(): void {
    void this.svc.load(true);
  }

  /** Re-attempt one broken tile's preview. */
  retryTile(ev: Event, imageId: string): void {
    // The tile is an anchor to the CDN original — a retry must not follow it.
    ev.preventDefault();
    ev.stopPropagation();
    const next = new Set(this.broken());
    next.delete(imageId);
    this.broken.set(next);
    this.bumpRetry([imageId]);
  }

  /** Re-attempt every preview that has not resolved yet (the stall notice's action). */
  retryImages(): void {
    const pending = this.svc
      .wallpapers()
      .map((w) => w.imageId)
      .filter((id) => !this.loaded().has(id));
    this.broken.set(new Set<string>());
    this.stallElapsed.set(false);
    this.bumpRetry(pending);
    this.armStallWatch();
  }

  private bumpRetry(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const next = { ...this.retries() };
    for (const id of ids) next[id] = (next[id] ?? 0) + 1;
    this.retries.set(next);
  }

  /**
   * The retry fragment for an image, or '' on the first attempt. A fragment is
   * purely client-side, so it re-triggers the load without altering the request
   * a CDN (or a signed proxy url) actually receives.
   */
  private retrySuffix(imageId?: string): string {
    const n = imageId ? (this.retries()[imageId] ?? 0) : 0;
    return n > 0 ? `#r${n}` : '';
  }

  /**
   * `?image=<id>` — a shared wallpaper link. The image is usually not on the
   * first page, so it is fetched by id rather than searched for in the grid.
   */
  private async openDeepLink(): Promise<void> {
    const id = this.route.snapshot.queryParamMap.get(DEEP_LINK_PARAM);
    if (!id) return;
    const known = this.svc.wallpapers().find((w) => w.imageId === id);
    const wallpaper = known ?? (await this.svc.loadOne(id));
    if (wallpaper) this.active.set(wallpaper);
  }

  /**
   * Plausible varied placeholder aspect ratio for tile `i`, cycled from a fixed
   * set. A ratio rather than a height so the placeholder is the size the image
   * will actually be in whatever column width the current breakpoint gives.
   */
  skelRatio(i: number): string {
    return SKEL_RATIOS[i % SKEL_RATIOS.length];
  }

  /**
   * Responsive `srcset` for a tile: light `post` (≤500w) + crisp `cover` (≤1140w),
   * derived from the stored `cover` preview url. Returns '' for urls that can't be
   * re-varianted (e.g. the signed RSI proxy) so the browser just uses `src`.
   */
  srcsetFor(previewUrl: string, imageId?: string): string {
    const suffix = this.retrySuffix(imageId);
    const post = rsiVariant(previewUrl, 'post');
    const cover = rsiVariant(previewUrl, 'cover');
    return post === cover ? '' : `${post}${suffix} 500w, ${cover}${suffix} 1140w`;
  }

  /** Light `post` variant used as the `src` fallback — the fast, mobile-first source. */
  lowResFor(previewUrl: string, imageId?: string): string {
    return `${rsiVariant(previewUrl, 'post')}${this.retrySuffix(imageId)}`;
  }

  /** `cover` variant (≤1140w) — the lightbox's phone-sized stand-in for the original. */
  previewFor(w: Wallpaper): string {
    return rsiVariant(w.previewUrl, 'cover');
  }

  /** Deep link that reopens this wallpaper's lightbox on our own site. */
  shareUrl(w: Wallpaper): string {
    const origin = typeof location !== 'undefined' ? location.origin : '';
    return `${origin}/starscape?${DEEP_LINK_PARAM}=${encodeURIComponent(w.imageId)}`;
  }

  /**
   * Hand the wallpaper to the platform's own share sheet (Android/iOS) via the
   * Web Share API. Desktop browsers without it fall back to the clipboard, which
   * is confirmed inline — a silent copy reads as a dead button.
   */
  async share(w: Wallpaper): Promise<void> {
    const url = this.shareUrl(w);
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title: w.title ?? 'Starscape', url });
      } catch {
        /* the user dismissed the sheet — not an error */
      }
      return;
    }
    const clipboard = nav?.clipboard;
    if (!clipboard?.writeText) {
      this.flashShareHint('starscape.share.failed');
      return;
    }
    try {
      await clipboard.writeText(url);
      this.flashShareHint('starscape.share.copied');
    } catch {
      this.flashShareHint('starscape.share.failed');
    }
  }

  private flashShareHint(key: string): void {
    this.shareHint.set(key);
    if (this.shareHintTimer) clearTimeout(this.shareHintTimer);
    this.shareHintTimer = setTimeout(() => this.shareHint.set(null), SHARE_HINT_MS);
  }

  /** Marks a preview decoded → fades it in and removes its skeleton. */
  onLoad(id: string): void {
    if (this.broken().has(id)) {
      const stillBroken = new Set(this.broken());
      stillBroken.delete(id);
      this.broken.set(stillBroken);
    }
    if (this.loaded().has(id)) return;
    const next = new Set(this.loaded());
    next.add(id);
    this.loaded.set(next);
  }

  open(w: Wallpaper): void {
    this.active.set(w);
  }

  /**
   * Tile links to the original CDN image (d2171662). Only the plain left click is
   * ours (lightbox); middle click, Ctrl/⌘/Shift+click and the context menu keep
   * the browser's native "open in a new tab" behaviour.
   */
  onTileClick(ev: MouseEvent, w: Wallpaper): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.open(w);
  }

  /** Anchors don't activate on Space the way the old <button> tile did. */
  onTileSpace(ev: Event, w: Wallpaper): void {
    ev.preventDefault();
    this.open(w);
  }

  close(): void {
    this.active.set(null);
    this.shareHint.set(null);
  }

  onBroken(id: string): void {
    // Both `(error)` and the directive's `(failed)` watchdog land here — whichever
    // notices first wins, the other is a no-op. A tile that already painted is
    // never demoted to "broken".
    if (this.broken().has(id) || this.loaded().has(id)) return;
    const next = new Set(this.broken());
    next.add(id);
    this.broken.set(next);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }
}
