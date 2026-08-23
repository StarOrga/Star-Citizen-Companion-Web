import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  TemplateRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NewsService, VerseNewsItem } from './news.service';
import { relativeTime } from './relative-time';
import { NewsThumbComponent } from './news-thumb.component';
import { UpcomingShipsNoticeComponent } from './upcoming-ships-notice.component';
import { isPlainLeftClick } from '../core/modified-click.util';
import { SameRouteRefreshService } from '../core/same-route-refresh.service';

/** How many stream tiles the first serving holds, and how many each "more" adds. */
const STREAM_PAGE = 12;

/**
 * Angular's HTML sanitizer removes <svg> from an [innerHTML] binding outright —
 * which is why every channel glyph on this page has been rendering as nothing at
 * all since it was introduced (Chrome logs "sanitizing HTML stripped some
 * content" for each one). Every markup string in this file is a compile-time
 * constant with no interpolation, so the bypass carries no injection surface.
 *
 * Cached by source string so a binding keeps referential identity across change
 * detection and does not rewrite its innerHTML on every cycle.
 */
const SAFE_SVG = new Map<string, SafeHtml>();

/**
 * Verse News — "Bühne · Befund · Strom".
 *
 * Rebuilt 2026-08-20 from the rethink in
 * `.claude/rethink/2026-08-20-verse-news-entry/` (design Ⓐ, chosen by the owner
 * on the concept page). What the measurement of the old page found, and what
 * each part of this one answers:
 *
 * - The page was **7,327 px ≈ 7.7 screens** and opened on a filter bar above a
 *   297 px band holding a single video. It now opens on one image.
 * - Its only composed element, the hero tile, was defined as "first item of the
 *   Today bucket" — a bucket that did not exist on the measured day, so the
 *   hero never rendered. The stage is now picked by score over the whole pool
 *   (`pickStage`), which cannot come back empty.
 * - The patch apparatus (rotating KPI carousel, two filter axes, the full
 *   history) occupied **2,019 px entirely above the first news article**. It
 *   moved to `/news/patches`; what stays here is one sentence — which build is
 *   live and when the next one is due.
 *
 * Three objects, in this order: the stage, the verdict, the stream. The density
 * budget the owner set — at most three eye-catchers — is the reason there is no
 * fourth.
 */
@Component({
  selector: 'sc-news-list',
  standalone: true,
  imports: [TranslateModule, RouterLink, NewsThumbComponent, UpcomingShipsNoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="news-page">
      <!-- ══ 1 · THE STAGE ══════════════════════════════════════════════════
           Full-bleed artwork, an overline, a headline and one action. No page
           title above it: the stage's own headline IS the page's opening line,
           and a title bar over a hero is the "toolbar above a list" the rethink
           set out to remove. -->
      @if (svc.loading() && !svc.feed()) {
        <div class="stage skel" aria-hidden="true">
          <span class="skel-art shimmer"></span>
          <span class="stage-body">
            <span class="skel-line shimmer sm"></span>
            <span class="skel-line shimmer lg"></span>
            <span class="skel-line shimmer"></span>
          </span>
        </div>
      } @else if (stage(); as item) {
        <article class="stage" [attr.data-channel]="item.channel">
          <sc-news-thumb
            class="stage-art"
            [images]="imagesOf(item)"
            [channel]="item.channel"
            [channelLabel]="('news.channels.' + item.channel) | translate"
            [channelIcon]="iconFor(item.channel)"
            [featured]="true" />
          <span class="stage-scrim" aria-hidden="true"></span>
          <div class="stage-body">
            <p class="overline">
              <span class="ch-icon" [innerHTML]="safeIcon(item.channel)"></span>
              <span>{{ ('news.channels.' + item.channel) | translate }}</span>
              <span class="dot-sep" aria-hidden="true">·</span>
              <time>{{ relTime(item.publishedAt) }}</time>
            </p>
            <!-- Stretched link (d2171662): the headline is a real anchor to the
                 source and its overlay span covers the whole stage, so middle
                 click and Ctrl/⌘+click reach the article natively. A plain left
                 click stays in the app and opens the detail overlay. -->
            <h1>
              <a class="stage-link" [href]="item.url" target="_blank" rel="noopener noreferrer"
                 (click)="onItemClick($event, item)"
                 (keydown.space)="onItemSpace($event, item)">{{ item.title }}<span
                   class="stage-link-touch-target" aria-hidden="true"></span></a>
            </h1>
            @if (item.summary) { <p class="stage-deck">{{ item.summary }}</p> }
            <!-- The CTA is a real anchor, not a decorated span. As a span with
                 pointer-events:none it looked like the primary control and
                 did nothing: the click fell through to the <p>, which has no
                 handler, so only the strip BELOW the row (bare stage link) ever
                 responded — reported as "the buttons only work at the bottom
                 edge". The row itself is now transparent to the pointer and
                 every control in it takes its own hits. -->
            <p class="stage-actions">
              <a class="cta" [href]="item.url" target="_blank" rel="noopener noreferrer"
                 (click)="onItemClick($event, item)">
                {{ (isVideo(item) ? 'news.stage.watch' : 'news.stage.read') | translate }} →
              </a>
              <button type="button" class="act fav" [class.on]="isFav(item)"
                      [attr.aria-pressed]="isFav(item)"
                      [attr.title]="favLabel(item) | translate"
                      (click)="toggleFavorite($event, item)">
                <span class="ic" [innerHTML]="favIcon(isFav(item))"></span>
                <span class="lbl">{{ favLabel(item) | translate }}</span>
              </button>
              <button type="button" class="act share"
                      [attr.title]="'news.share.label' | translate"
                      (click)="share($event, item)">
                <span class="ic" [innerHTML]="shareIcon()"></span>
                <span class="lbl">{{ 'news.share.label' | translate }}</span>
              </button>
            </p>
          </div>

          <!-- ══ 2 · THE VERDICT ═══════════════════════════════════════════
               Docked into the stage's lower edge, on its own surface. The whole
               of "where does the build stand" above the fold, in one sentence
               plus its basis — and it never appears again further down. -->
          @if (verdictReady()) {
            <aside class="verdict" [attr.aria-label]="'news.verdict.label' | translate">
              <p class="verdict-label">{{ 'news.verdict.label' | translate }}</p>
              <p class="verdict-line" [innerHTML]="verdictLine()"></p>
              @if (verdictBasis(); as basis) {
                <p class="verdict-basis">{{ basis }}</p>
              }
              <a class="verdict-link" routerLink="/news/patches">
                {{ 'news.verdict.toBoard' | translate }} →
              </a>
            </aside>
          }
        </article>
      } @else if (svc.error(); as err) {
        <div class="sc-card err">
          <strong>{{ 'news.errorTitle' | translate }}:</strong> {{ err }}
        </div>
      }

      <!-- Codex "Upcoming Ships" delta (feedback d3fbc023): self-hides when
           there is nothing new since the user last looked. -->
      <sc-upcoming-ships-notice />

      <!-- ══ 3 · THE STREAM ════════════════════════════════════════════════
           One flat, reverse-chronological grid. No Heute/Diese Woche/Älter
           bands: those are what bound the hero to a bucket that is empty on
           most days, and a relative timestamp on the tile carries the same
           information without a section that can render empty. -->
      <section class="stream" [attr.aria-label]="'news.stream.title' | translate">
        <header class="stream-head">
          <h2>{{ 'news.stream.title' | translate }}</h2>
          <!-- One segmented control instead of a count pill next to a starred
               text button: both halves name the same kind of thing (a slice of
               the stream and how many items it holds), so they get the same
               shape. Counts ride in their own badge — no parentheses. -->
          <div class="seg" role="group" [attr.aria-label]="'news.stream.filterAria' | translate">
            <button type="button" class="seg-btn" [class.on]="!svc.favoritesOnly()"
                    [attr.aria-pressed]="!svc.favoritesOnly()"
                    (click)="selectStream(false)">
              <span class="seg-lbl">{{ 'news.stream.all' | translate }}</span>
              <span class="seg-num">{{ svc.streamCount() }}</span>
            </button>
            <button type="button" class="seg-btn saved" [class.on]="svc.favoritesOnly()"
                    [attr.aria-pressed]="svc.favoritesOnly()"
                    (click)="selectStream(true)">
              <span class="ic" [innerHTML]="favIcon(true)"></span>
              <span class="seg-lbl">{{ 'news.favorite.saved' | translate }}</span>
              <span class="seg-num">{{ svc.favoriteCount() }}</span>
            </button>
          </div>
          @if (svc.loading() && svc.feed()) {
            <span class="freshness refreshing" role="status" aria-live="polite">
              <span class="pulse" aria-hidden="true"></span>
              {{ 'news.refreshing' | translate }}
            </span>
          } @else if (updatedRel(); as rel) {
            <span class="freshness" [class.stale]="updatedStale()">
              <span class="pulse" aria-hidden="true"></span>
              {{ 'news.lastUpdated' | translate:{ rel: rel } }}
            </span>
          }
        </header>

        @if (svc.loading() && !svc.feed()) {
          <div class="cards" aria-hidden="true">
            @for (n of [1, 2, 3, 4, 5, 6]; track n) {
              <div class="card skel">
                <span class="skel-thumb shimmer"></span>
                <span class="skel-body">
                  <span class="skel-line shimmer lg"></span>
                  <span class="skel-line shimmer sm"></span>
                </span>
              </div>
            }
          </div>
        } @else if (visibleStream().length === 0) {
          <p class="sc-card empty">
            {{ (svc.favoritesOnly() ? 'news.emptyFavorites' : 'news.empty') | translate }}
          </p>
        } @else {
          <div class="cards">
            @for (item of visibleStream(); track item.id) {
              <article class="card sc-reveal" [class.video]="isVideo(item)"
                       [attr.data-channel]="item.channel">
                <div class="thumb-wrap">
                  <sc-news-thumb
                    [images]="imagesOf(item)"
                    [channel]="item.channel"
                    [channelLabel]="('news.channels.' + item.channel) | translate"
                    [channelIcon]="iconFor(item.channel)"
                    [featured]="false" />
                  @if (isVideo(item)) {
                    <span class="play" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.6v12.8a.6.6 0 0 0 .92.5l9.6-6.4a.6.6 0 0 0 0-1L8.92 5.1a.6.6 0 0 0-.92.5z"/></svg>
                    </span>
                  }
                </div>
                <div class="body">
                  <h3>
                    <a class="card-link" [href]="item.url" target="_blank" rel="noopener noreferrer"
                       (click)="onItemClick($event, item)"
                       (keydown.space)="onItemSpace($event, item)">{{ item.title }}<span
                         class="card-link-touch-target" aria-hidden="true"></span></a>
                  </h3>
                  <div class="foot">
                    <span class="when">
                      @if (isVideo(item)) {
                        <span class="vid-tag">{{ 'news.videos.badge' | translate }}</span>
                      }
                      <time>{{ relTime(item.publishedAt) }}</time>
                    </span>
                    <!-- Same two controls, same glyphs, same labels as the stage
                         and the detail view — only the label is visually hidden
                         here, where the foot row has no room for it. -->
                    <span class="actions">
                      <button type="button" class="act fav icon-only" [class.on]="isFav(item)"
                              [attr.aria-pressed]="isFav(item)"
                              [attr.title]="favLabel(item) | translate"
                              (click)="toggleFavorite($event, item)">
                        <span class="ic" [innerHTML]="favIcon(isFav(item))"></span>
                        <span class="lbl">{{ favLabel(item) | translate }}</span>
                      </button>
                      <button type="button" class="act share icon-only"
                              [attr.title]="'news.share.label' | translate"
                              (click)="share($event, item)">
                        <span class="ic" [innerHTML]="shareIcon()"></span>
                        <span class="lbl">{{ 'news.share.label' | translate }}</span>
                      </button>
                      <a class="act ext" [href]="item.url" target="_blank" rel="noopener noreferrer"
                         (click)="$event.stopPropagation()"
                         [attr.aria-label]="'news.openExternal' | translate:{ host: hostOf(item.url) }"
                         [attr.title]="'news.openExternal' | translate:{ host: hostOf(item.url) }">{{ hostOf(item.url) }} ↗</a>
                    </span>
                  </div>
                </div>
              </article>
            }
          </div>

          @if (hasMore()) {
            <button type="button" class="more" (click)="showMore()">
              {{ 'news.stream.more' | translate:{ count: remaining() } }}
            </button>
          }
        }
      </section>
    </section>

    <!-- Enlarged in-app detail (CDK overlay, portaled to <body>). -->
    <ng-template #detailTpl>
      <div class="nd-overlay" (click)="closeDetail()">
        @if (selected(); as item) {
          <article class="nd-panel sc-card" role="dialog" aria-modal="true"
                   [attr.aria-label]="item.title" (click)="$event.stopPropagation()">
            <!-- Same back affordance as the patch board's "← Patch-Historie
                 verlassen": a text link, not a floating ✕ disc. It is a real
                 <button> because it closes an overlay rather than navigating,
                 but it carries the link's shape so the two read as one idiom. -->
            <header class="nd-head">
              <button type="button" class="nd-back" (click)="closeDetail()">
                ← {{ 'news.detail.back' | translate }}
              </button>
            </header>
            <div class="thumb-wrap nd-media">
              <sc-news-thumb
                [images]="imagesOf(item)"
                [channel]="item.channel"
                [channelLabel]="('news.channels.' + item.channel) | translate"
                [channelIcon]="iconFor(item.channel)"
                [featured]="true" />
              <!-- For a video the hero doubles as the play target: one tap from
                   the detail view straight into the clip. -->
              @if (isVideo(item)) {
                <a class="play play-link" [href]="item.url" target="_blank" rel="noopener noreferrer"
                   [attr.aria-label]="'news.videos.play' | translate"
                   [attr.title]="'news.videos.play' | translate">
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.6v12.8a.6.6 0 0 0 .92.5l9.6-6.4a.6.6 0 0 0 0-1L8.92 5.1a.6.6 0 0 0-.92.5z"/></svg>
                </a>
              }
            </div>
            <div class="nd-body">
              <div class="nd-chan">
                <span class="ch-icon" [innerHTML]="safeIcon(item.channel)"></span>
                <span>{{ ('news.channels.' + item.channel) | translate }}</span>
                <span class="dot-sep">·</span>
                <time>{{ relTime(item.publishedAt) }}</time>
              </div>
              <h2>{{ item.title }}</h2>
              @if (item.summary) { <p class="nd-summary">{{ item.summary }}</p> }
              <div class="nd-actions">
                <button type="button" class="sc-btn" [class.on]="isFav(item)"
                        [attr.aria-pressed]="isFav(item)" (click)="toggleFavorite($event, item)">
                  <span class="ic" [innerHTML]="favIcon(isFav(item))"></span>
                  {{ favLabel(item) | translate }}
                </button>
                <button type="button" class="sc-btn" (click)="share($event, item)">
                  <span class="ic" [innerHTML]="shareIcon()"></span>
                  {{ 'news.share.label' | translate }}
                </button>
                <a class="sc-btn primary" [href]="item.url" target="_blank" rel="noopener noreferrer">
                  {{ 'news.openExternal' | translate:{ host: hostOf(item.url) } }} ↗
                </a>
              </div>
            </div>
          </article>
        }
      </div>
    </ng-template>
  `,
  styles: [`
    :host {
      --news-tile: 300px;
      --news-gap: 16px;
      display: block;
    }
    /* --sc-page-lead puts a page that opens on a hard card edge on the same
       optical line as one that opens on an <h1> (see styles.scss). Verse News
       is the only top-level page without a heading, so without it the stage
       reads as sitting tighter under the nav bar than every other menu item. */
    .news-page {
      display: flex; flex-direction: column; gap: 18px;
      padding-top: var(--sc-page-lead);
    }

    /* ---------- 1 · Stage ----------
       Full-bleed art with a horizontal scrim: opaque at the left edge where the
       type sits, clear on the right where the artwork earns its keep. The art
       is cropped (object-fit: cover), never letterboxed — the height below is
       the frame, and the picture fills it whatever its own ratio is. */
    .stage {
      position: relative; overflow: hidden;
      border: 1px solid var(--sc-border); border-radius: 12px;
      background: var(--sc-bg-1);
      display: flex; align-items: flex-end;
      min-height: clamp(380px, 34vw, 480px);
    }
    .stage-art { position: absolute; inset: 0; display: flex; }
    .stage-art ::ng-deep img { width: 100%; height: 100%; object-fit: cover; }
    .stage-scrim {
      position: absolute; inset: 0; pointer-events: none;
      background:
        linear-gradient(90deg, var(--sc-bg-0) 2%, color-mix(in srgb, var(--sc-bg-0) 72%, transparent) 34%, transparent 64%),
        linear-gradient(0deg, var(--sc-bg-0) 1%, transparent 58%);
    }
    .stage-body { position: relative; padding: 26px 28px 24px; max-width: 56ch; }
    .overline {
      display: inline-flex; align-items: center; gap: 8px; margin: 0 0 10px;
      font-family: var(--sc-font-display); font-size: max(0.68rem, var(--sc-fs-floor));
      letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-accent);
    }
    .overline .ch-icon { display: inline-flex; width: 14px; height: 14px; }
    .overline .ch-icon svg { width: 100%; height: 100%; display: block; }
    .overline time, .overline .dot-sep { color: var(--sc-fg-2); letter-spacing: 0.04em; }
    .stage-body h1 {
      margin: 0 0 10px; font-size: clamp(1.5rem, 3.2vw, 2.1rem); line-height: 1.08;
      font-family: var(--sc-font-display); letter-spacing: 0.01em;
    }
    /* The headline anchor carries the whole stage's hit area — no visual change,
       but the browser knows the stage is a link (d2171662). A real element, not
       a pseudo-element, so the mobile gate can measure the true tap area. */
    .stage-link { color: inherit; text-decoration: none; }
    .stage-link-touch-target { position: absolute; inset: 0; z-index: 3; }
    .stage-link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 4px; border-radius: 4px; }
    .stage-deck {
      margin: 0 0 14px; color: var(--sc-fg-1); font-size: 0.9rem; line-height: 1.5;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }
    /* The row itself is transparent to the pointer, so its gaps fall through to
       the stretched stage link; every control in it takes its own hits. */
    .stage-actions {
      display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 0;
      position: relative; z-index: 4; pointer-events: none;
    }
    .stage-actions > * { pointer-events: auto; }
    .cta {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 9px 18px; border-radius: 6px; min-height: var(--sc-tap-min);
      background: var(--sc-accent); color: var(--sc-bg-0); text-decoration: none;
      font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.1em; text-transform: uppercase;
    }
    .cta:hover { background: color-mix(in srgb, var(--sc-accent) 84%, white); }
    .cta:focus-visible { outline: 2px solid var(--sc-fg-0); outline-offset: 3px; }

    /* ---------- 2 · Verdict ----------
       Its own surface over the artwork, docked bottom-right. It is the entire
       presence of "where does the build stand" on this page. */
    .verdict {
      position: absolute; right: 20px; bottom: 20px; z-index: 5;
      width: min(320px, calc(100% - 40px));
      padding: 12px 14px; border-radius: 8px;
      background: color-mix(in srgb, var(--sc-bg-1) 88%, transparent);
      border: 1px solid var(--sc-border);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
    }
    .verdict-label {
      margin: 0; font-family: var(--sc-font-display);
      font-size: max(0.62rem, var(--sc-fs-floor)); letter-spacing: 0.16em;
      text-transform: uppercase; color: var(--sc-fg-2);
    }
    .verdict-line { margin: 6px 0 4px; font-size: 0.94rem; line-height: 1.35; color: var(--sc-fg-0); }
    .verdict-line ::ng-deep b { font-family: var(--sc-font-display); color: var(--sc-accent); font-weight: 600; }
    .verdict-line ::ng-deep b.late { color: var(--sc-warning); }
    .verdict-basis {
      margin: 0; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
      font-variant-numeric: tabular-nums;
    }
    .verdict-link {
      display: inline-block; margin-top: 10px; padding-top: 9px;
      border-top: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent);
      width: 100%; min-height: var(--sc-tap-min);
      font-family: var(--sc-font-display); font-size: max(0.7rem, var(--sc-fs-floor));
      letter-spacing: 0.08em; color: var(--sc-accent); text-decoration: none;
    }
    .verdict-link:hover { color: color-mix(in srgb, var(--sc-accent) 80%, white); }
    .verdict-link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

    /* On a narrow viewport the verdict leaves the artwork and becomes a plain
       band under it — a 320px card over a 375px-wide hero would cover the
       headline it is supposed to accompany. */
    @media (max-width: 719.98px) {
      .stage { flex-direction: column; align-items: stretch; min-height: 0; }
      .stage-art { position: relative; aspect-ratio: 16 / 9; }
      .stage-scrim { display: none; }
      .stage-body { padding: 18px 18px 16px; max-width: none; }
      .stage-link-touch-target { inset: auto; position: static; }
      .verdict {
        position: static; width: auto; margin: 0 14px 14px; border-radius: 8px;
        -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: none;
      }
    }

    /* ---------- 3 · Stream ---------- */
    .stream {
      display: flex; flex-direction: column; gap: 12px;
      border: 1px solid var(--sc-border); border-radius: 10px;
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      padding: 14px 16px 18px;
    }
    .stream-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 14px; }
    .stream-head h2 {
      margin: 0; font-size: 0.82rem; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--sc-accent);
    }

    /* One segmented control for the two slices of the stream. Both halves carry
       a label and a count badge in the same shape — the count pill and the
       starred text link they replace shared a job but nothing else. */
    .seg {
      display: inline-flex; align-items: stretch; overflow: hidden;
      border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-1);
    }
    .seg-btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 6px 12px; min-height: var(--sc-tap-min);
      background: transparent; border: 0; border-right: 1px solid var(--sc-border);
      color: var(--sc-fg-2); font-family: inherit; cursor: pointer;
      font-size: max(0.72rem, var(--sc-fs-floor)); line-height: 1; letter-spacing: 0.04em;
    }
    .seg-btn:last-child { border-right: 0; }
    .seg-btn .ic { display: inline-flex; width: 13px; height: 13px; flex: 0 0 auto; }
    .seg-btn .ic svg { width: 100%; height: 100%; display: block; }
    .seg-num {
      font-variant-numeric: tabular-nums; padding: 2px 7px; border-radius: 999px;
      background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent);
      font-size: max(0.68rem, var(--sc-fs-floor));
    }
    .seg-btn:hover { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-fg-2) 9%, transparent); }
    .seg-btn.on { color: var(--sc-bg-0); background: var(--sc-accent); }
    .seg-btn.saved.on { background: var(--sc-warning); }
    .seg-btn.on .seg-num { background: color-mix(in srgb, var(--sc-bg-0) 24%, transparent); }
    .seg-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }

    .cards {
      display: grid; gap: var(--news-gap);
      grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--news-tile)), 1fr));
    }
    .card {
      position: relative;
      display: flex; flex-direction: column;
      border: 1px solid var(--sc-border); border-radius: 8px;
      background: var(--sc-bg-1); color: inherit; overflow: hidden; min-height: 200px;
      transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
    }
    .card-link { color: inherit; text-decoration: none; }
    .card-link-touch-target { position: absolute; inset: 0; z-index: 5; }
    .card-link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 3px; border-radius: 3px; }
    .card:hover {
      transform: translateY(-3px) scale(1.005);
      border-color: var(--sc-accent);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4),
                  0 0 18px color-mix(in srgb, var(--sc-accent) 35%, transparent);
    }
    /* Videos are stream tiles now, not a rail — but they keep the distinct
       treatment that made them readable as videos (feedback 0a5268e7). */
    .card.video { border-color: color-mix(in srgb, var(--sc-danger) 45%, var(--sc-border)); }
    .card.video:hover { border-color: var(--sc-danger); }
    .thumb-wrap { position: relative; display: flex; }
    .thumb-wrap > sc-news-thumb { flex: 1 1 auto; min-width: 0; }
    .play {
      position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
      width: 44px; height: 44px; border-radius: 50%; z-index: 2;
      display: grid; place-items: center; pointer-events: none;
      background: color-mix(in srgb, var(--sc-bg-0) 58%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-danger) 70%, transparent);
      color: var(--sc-fg-0);
    }
    .play svg { width: 20px; height: 20px; }
    .play-link { pointer-events: auto; z-index: 6; }

    .card .body { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; flex: 1; }
    .card .body h3 {
      font-size: 0.98rem; line-height: 1.3; margin: 0;
      font-family: var(--sc-font-body); letter-spacing: 0; font-weight: 600;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .card .body .foot {
      display: flex; justify-content: space-between; align-items: center; gap: 8px;
      margin-top: auto; padding-top: 6px;
      font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
      border-top: 1px dashed color-mix(in srgb, var(--sc-border) 70%, transparent);
    }
    /* Three controls share this row on a 300px tile. The timestamp keeps its
       line and the source host gives way first — it is the one label the
       channel pill above already implies. */
    .card .body .foot .when { white-space: nowrap; flex: 0 0 auto; }
    .vid-tag {
      margin-right: 6px; padding: 1px 6px; border-radius: 4px;
      font-family: var(--sc-font-display); font-size: max(0.6rem, var(--sc-fs-floor));
      letter-spacing: 0.08em; color: var(--sc-danger);
      border: 1px solid color-mix(in srgb, var(--sc-danger) 55%, transparent);
    }
    .actions {
      display: inline-flex; align-items: center; gap: 2px;
      flex: 0 1 auto; min-width: 0; position: relative; z-index: 6;
    }
    /* One control shape for "Merken" and "Teilen" wherever they appear — stage,
       stream tile and detail view use the same glyph and the same label; only
       the tile hides the label, where the foot row has no room for it. */
    .act {
      background: transparent; border: 1px solid transparent; border-radius: 6px;
      cursor: pointer; color: var(--sc-fg-2); font-family: inherit;
      font-size: max(0.72rem, var(--sc-fs-floor)); line-height: 1; letter-spacing: 0.04em;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 7px 10px;
      min-width: var(--sc-tap-min); min-height: var(--sc-tap-min);
    }
    .act .ic { display: inline-flex; width: 15px; height: 15px; flex: 0 0 auto; }
    .act .ic svg { width: 100%; height: 100%; display: block; }
    .act:hover { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .act.on { color: var(--sc-warning); }
    .act.on:hover { color: var(--sc-warning); border-color: color-mix(in srgb, var(--sc-warning) 55%, transparent); }
    .act.icon-only { padding: 6px; flex: 0 0 auto; }
    .act.icon-only .lbl {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }
    .act.ext {
      font-size: max(0.68rem, var(--sc-fs-floor)); text-decoration: none;
      color: var(--sc-accent); padding: 7px 6px;
      min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      display: inline-block; line-height: 1.6;
    }
    .act:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
    /* On artwork the two controls need a surface of their own to stay readable. */
    .stage-actions .act {
      color: var(--sc-fg-1);
      background: color-mix(in srgb, var(--sc-bg-0) 58%, transparent);
      border-color: color-mix(in srgb, var(--sc-border) 85%, transparent);
      -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
    }
    .stage-actions .act.on { color: var(--sc-warning); }

    .more {
      align-self: center; margin-top: 4px;
      padding: 9px 20px; border-radius: 999px; min-height: var(--sc-tap-min);
      background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-1);
      font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.08em; cursor: pointer;
    }
    .more:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .more:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

    /* ---------- Freshness ---------- */
    .freshness {
      display: inline-flex; align-items: center; gap: 7px; margin-left: auto;
      font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
      font-variant-numeric: tabular-nums;
    }
    .freshness .pulse {
      width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto;
      background: color-mix(in srgb, var(--sc-success) 70%, transparent);
    }
    .freshness.stale { color: var(--sc-warning); }
    .freshness.stale .pulse { background: var(--sc-warning); }
    .freshness.refreshing { color: var(--sc-accent); }
    .freshness.refreshing .pulse {
      background: var(--sc-accent);
      animation: fresh-pulse 1.1s ease-out infinite;
    }
    @keyframes fresh-pulse {
      0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--sc-accent) 55%, transparent); }
      70% { box-shadow: 0 0 0 6px transparent; }
      100% { box-shadow: 0 0 0 0 transparent; }
    }
    @media (prefers-reduced-motion: reduce) {
      .freshness .pulse { animation: none; }
    }

    /* ---------- Skeletons ---------- */
    .stage.skel { display: block; min-height: clamp(380px, 34vw, 480px); }
    .stage.skel .skel-art { position: absolute; inset: 0; display: block; }
    .stage.skel .stage-body { position: relative; padding-top: 180px; }
    .card.skel { cursor: default; }
    .card.skel:hover { transform: none; box-shadow: none; border-color: var(--sc-border); }
    .skel-thumb { width: 100%; aspect-ratio: 16 / 9; display: block; }
    .skel-body { display: flex; flex-direction: column; gap: 9px; padding: 14px; flex: 1; }
    .skel-line { display: block; height: 11px; border-radius: 5px; width: 100%; }
    .skel-line.lg { height: 20px; width: 78%; }
    .skel-line.sm { width: 42%; }
    .shimmer {
      background: linear-gradient(110deg, var(--sc-skel-base) 30%, var(--sc-skel-hi) 50%, var(--sc-skel-base) 70%);
      background-size: 200% 100%;
      animation: skel 1.4s ease-in-out infinite;
    }
    .card.skel:nth-child(2) .shimmer { animation-delay: 0.12s; }
    .card.skel:nth-child(3) .shimmer { animation-delay: 0.24s; }
    .card.skel:nth-child(4) .shimmer { animation-delay: 0.36s; }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) {
      .shimmer { animation: none; background-position: 0 0; }
    }

    .empty { text-align: center; color: var(--sc-fg-2); padding: 36px; margin: 0; }
    .err { color: var(--sc-danger); padding: 16px; }

    /* ---------- Detail overlay ----------
       Sized to the viewport, not to the picture: the panel can never be taller
       than the screen, and inside it the ART is the elastic part — it gives up
       height to the text, never the other way round. So the headline, the
       summary and all three actions are on screen at every window size without
       a scrollbar. (These rules were lost in the 2026-08-20 rewrite, which left
       the overlay entirely unstyled — a full-bleed image with its actions cut
       off below the fold.) */
    .nd-overlay {
      position: fixed; inset: 0; z-index: 120;
      background: rgba(0, 0, 0, 0.72);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      display: flex; justify-content: center; align-items: center;
      padding: clamp(12px, 3vh, 30px) clamp(12px, 3vw, 28px);
    }
    .nd-panel {
      position: relative; width: 100%; max-width: 900px;
      /* A definite height, not just a cap: with max-height alone the panel is
         content-sized, so the art never grows past its basis and the view reads
         as a small card floating in a big dark screen. */
      height: min(100%, 720px);
      display: flex; flex-direction: column; overflow: hidden; padding: 0;
      animation: nd-in 0.18s ease;
    }
    @keyframes nd-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .nd-panel { animation: none; } }

    /* Same idiom as the patch board's back link, so "leave this view" looks the
       same wherever it appears. A button, because it closes rather than navigates. */
    .nd-head {
      flex: 0 0 auto; padding: 8px 16px;
      border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent);
    }
    .nd-back {
      display: inline-flex; align-items: center; min-height: var(--sc-tap-min);
      background: transparent; border: 0; padding: 0; cursor: pointer;
      color: var(--sc-fg-2); font-family: inherit;
      font-size: max(0.76rem, var(--sc-fs-floor));
    }
    .nd-back:hover { color: var(--sc-accent); }
    .nd-back:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 3px; border-radius: 4px; }

    /* The art takes everything the text leaves over — it is the only elastic
       row, so the body can never be squeezed into a scrollbar. */
    .nd-media { flex: 1 1 auto; min-height: 96px; width: 100%; }
    /* Beats the featured 21/9 aspect ratio on specificity — here the frame is set by
       what the text leaves over, and the picture crops into it. */
    .nd-media sc-news-thumb { aspect-ratio: auto; height: 100%; }
    .play-link { pointer-events: auto; text-decoration: none; width: 64px; height: 64px; }
    .play-link svg { width: 26px; height: 26px; }
    .play-link:hover, .play-link:focus-visible {
      transform: translate(-50%, -50%) scale(1.1);
      background: var(--sc-danger); outline: none;
    }
    .play-link:focus-visible { outline: 2px solid var(--sc-fg-0); outline-offset: 3px; }

    .nd-body {
      flex: 0 0 auto; overflow-y: auto;
      display: flex; flex-direction: column; gap: 10px; padding: 14px 20px 18px;
    }
    .nd-chan {
      display: flex; align-items: center; gap: 8px; color: var(--sc-fg-2);
      font-size: max(0.74rem, var(--sc-fs-floor));
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .nd-chan .ch-icon { display: inline-flex; width: 15px; height: 15px; }
    .nd-chan .ch-icon svg { width: 100%; height: 100%; display: block; }
    .nd-chan .dot-sep { opacity: 0.6; }
    .nd-body h2 {
      margin: 0; font-family: var(--sc-font-display);
      font-size: clamp(1.1rem, 2.2vw, 1.4rem); line-height: 1.25;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }
    /* Clamped so a long Comm-Link teaser cannot push the actions off screen —
       the full text is one click away behind the source link. */
    .nd-summary {
      margin: 0; color: var(--sc-fg-1); font-size: 0.92rem; line-height: 1.55;
      white-space: pre-line;
      display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
    }
    .nd-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 2px; }
    .nd-actions .sc-btn {
      padding: 8px 14px; border-radius: 6px; background: var(--sc-bg-1);
      border: 1px solid var(--sc-accent); color: var(--sc-accent);
      font-family: var(--sc-font-display); font-size: max(0.74rem, var(--sc-fs-floor));
      letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer;
      text-decoration: none; display: inline-flex; align-items: center; gap: 7px;
      min-height: var(--sc-tap-min);
    }
    .nd-actions .sc-btn .ic { display: inline-flex; width: 15px; height: 15px; flex: 0 0 auto; }
    .nd-actions .sc-btn .ic svg { width: 100%; height: 100%; display: block; }
    .nd-actions .sc-btn:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .nd-actions .sc-btn.on {
      border-color: var(--sc-warning); color: var(--sc-warning);
      background: color-mix(in srgb, var(--sc-warning) 12%, transparent);
    }
    .nd-actions .sc-btn.primary { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); }

    /* Under ~520px tall (a phone in landscape) the art is worth less than the
       text it would crowd out. */
    @media (max-height: 520px) {
      .nd-media { display: none; }
      .nd-summary { -webkit-line-clamp: 2; }
    }
  `],
})
export class NewsListComponent implements OnInit, OnDestroy {
  readonly svc = inject(NewsService);
  private readonly t = inject(TranslateService);
  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly sameRoute = inject(SameRouteRefreshService);
  private readonly sanitizer = inject(DomSanitizer);

  private readonly detailTpl = viewChild.required<TemplateRef<unknown>>('detailTpl');
  private overlayRef: OverlayRef | null = null;

  readonly selected = signal<VerseNewsItem | null>(null);
  /** How many stream tiles are on screen; grows in `STREAM_PAGE` steps. */
  private readonly shown = signal(STREAM_PAGE);

  /** Ticks once a minute so the relative timestamps stay honest. */
  private readonly clock = signal(Date.now());
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  readonly stage = this.svc.stage;
  readonly stream = this.svc.stream;
  readonly streamTotal = computed(() => this.stream().length);
  readonly visibleStream = computed(() => this.stream().slice(0, this.shown()));
  readonly hasMore = computed(() => this.streamTotal() > this.shown());
  readonly remaining = computed(() => Math.max(0, this.streamTotal() - this.shown()));

  private readonly verdict = this.svc.verdict;
  readonly verdictReady = computed(() => !!this.verdict().liveLine);

  /**
   * The verdict sentence. Built through `translate.instant` with the numbers
   * already resolved, so German and English can order "live" and "overdue"
   * however each language wants — the component never concatenates fragments.
   */
  readonly verdictLine = computed(() => {
    const v = this.verdict();
    this.clock();
    const live = `<b>${this.t.instant('news.patch.line', { version: v.liveLine })}</b>`;
    const days = v.daysUntilLive;
    if (days === null) return this.t.instant('news.verdict.liveOnly', { line: live });
    if (days < 0) {
      return this.t.instant('news.verdict.overdue', {
        line: live,
        days: `<b class="late">${Math.abs(days)}</b>`,
      });
    }
    if (days === 0) return this.t.instant('news.verdict.today', { line: live });
    return this.t.instant('news.verdict.due', { line: live, days: `<b>${days}</b>` });
  });

  /**
   * "Median 22 T · 4.10 im Test" — the caveat behind the estimate.
   *
   * The sample count still gates the line (no samples, no basis) but is no
   * longer printed as `n = 3`: on a landing card that reads as notation, not as
   * a caveat. Where the numbers are the subject rather than a footnote — the
   * patch board's KPI panel — it is spelled out as "Basis: 3 Messwerte".
   */
  readonly verdictBasis = computed(() => {
    const v = this.verdict();
    if (v.medianDays === null || v.samples === null) return '';
    const key = v.testLine ? 'news.verdict.basisWithTest' : 'news.verdict.basis';
    return this.t.instant(key, {
      median: v.medianDays,
      test: this.t.instant('news.patch.line', { version: v.testLine }),
    });
  });

  readonly updatedRel = computed(() => {
    const f = this.svc.feed();
    if (!f?.fetchedAt) return '';
    return relativeTime(f.fetchedAt, this.clock(), (k, v) => this.t.instant(k, v));
  });

  /** Older than three poll intervals — the feed is not keeping itself current. */
  readonly updatedStale = computed(() => {
    const f = this.svc.feed();
    if (!f?.fetchedAt) return false;
    return this.clock() - Date.parse(f.fetchedAt) > 15 * 60 * 1000;
  });

  constructor() {
    // A nav re-click on the active tab reloads the feed without a skeleton
    // flash; the freshness line carries the echo instead (feedback 7532e639).
    this.sameRoute.onRefresh('/news')
      .pipe(takeUntilDestroyed())
      .subscribe(() => void this.svc.refresh(true));

    // Deep link: /news?item=<id> opens that item's detail overlay once the feed
    // has arrived.
    effect(() => {
      const feed = this.svc.feed();
      if (!feed) return;
      const wanted = untracked(() => this.route.snapshot.queryParamMap.get('item'));
      if (!wanted || untracked(() => this.selected())) return;
      const hit = feed.news.find((n) => n.id === wanted);
      if (hit) this.openDetail(hit);
    });

    // A fresh serving whenever the filter flips, so "Gemerkt" never opens
    // pre-scrolled into a list the user has not seen.
    effect(() => {
      this.svc.favoritesOnly();
      untracked(() => this.shown.set(STREAM_PAGE));
    });
  }

  ngOnInit(): void {
    void this.svc.refresh();
    this.svc.startPolling();
    this.clockTimer = setInterval(() => this.clock.set(Date.now()), 60_000);
  }

  ngOnDestroy(): void {
    this.svc.stopPolling();
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.closeDetail();
  }

  showMore(): void {
    this.shown.update((n) => n + STREAM_PAGE);
  }

  /** One half of the stream toggle. Re-pressing the active half is a no-op. */
  selectStream(savedOnly: boolean): void {
    this.svc.setFavoritesOnly(savedOnly);
  }

  isFav(item: VerseNewsItem): boolean {
    return this.svc.isFavorite(item.id);
  }

  /**
   * The one wording for the saved state, used as the button label on the stage
   * and in the detail view and as the tooltip on a stream tile. "Merken" and
   * "Favoriten" used to name the same thing in three places.
   */
  favLabel(item: VerseNewsItem): string {
    return this.isFav(item) ? 'news.favorite.saved' : 'news.favorite.save';
  }

  toggleFavorite(ev: Event, item: VerseNewsItem): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.svc.toggleFavorite(item.id);
  }

  async share(ev: Event, item: VerseNewsItem): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    const url = item.url;
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* user dismissed the sheet, or the clipboard is unavailable */
    }
  }

  isVideo(item: VerseNewsItem): boolean {
    return item.channel === 'youtube';
  }

  imagesOf(item: VerseNewsItem): string[] {
    if (item.images?.length) return item.images;
    return item.thumbnail ? [item.thumbnail] : [];
  }

  relTime(iso: string): string {
    return relativeTime(iso, this.clock(), (k, v) => this.t.instant(k, v));
  }

  hostOf(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  /**
   * Plain left click stays in the app and opens the overlay; every modified
   * click (middle, Ctrl/⌘, Shift) falls through to the browser so the anchor
   * behaves like an anchor (CLAUDE.md navigation rule, d2171662).
   */
  onItemClick(ev: MouseEvent, item: VerseNewsItem): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.openDetail(item);
  }

  onItemSpace(ev: Event, item: VerseNewsItem): void {
    ev.preventDefault();
    this.openDetail(item);
  }

  openDetail(item: VerseNewsItem): void {
    this.selected.set(item);
    if (this.overlayRef) return;
    this.overlayRef = this.overlay.create({
      hasBackdrop: false,
      scrollStrategy: this.overlay.scrollStrategies.block(),
      positionStrategy: this.overlay.position().global(),
    });
    this.overlayRef.attach(new TemplatePortal(this.detailTpl(), this.vcr));
  }

  closeDetail(): void {
    this.selected.set(null);
    this.overlayRef?.dispose();
    this.overlayRef = null;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.selected()) this.closeDetail();
  }

  private safeSvg(svg: string): SafeHtml {
    let safe = SAFE_SVG.get(svg);
    if (!safe) {
      safe = this.sanitizer.bypassSecurityTrustHtml(svg);
      SAFE_SVG.set(svg, safe);
    }
    return safe;
  }

  /**
   * The saved glyph — filled when saved, outlined when not. One star, drawn the
   * same way on the stage, on a tile and in the detail view; the page used to
   * mix the text characters ★/☆ with a "★ Merken" label baked into the
   * translation, so the two never lined up optically.
   */
  favIcon(on: boolean): SafeHtml {
    return this.safeSvg(on
      ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3.6 2.6 5.28 5.83.85-4.22 4.11.996 5.8L12 16.9l-5.21 2.74.996-5.8-4.22-4.11 5.83-.85z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.6 2.6 5.28 5.83.85-4.22 4.11.996 5.8L12 16.9l-5.21 2.74.996-5.8-4.22-4.11 5.83-.85z"/></svg>');
  }

  /** The share glyph. Replaces the lone ⤴ character the stage used to carry. */
  shareIcon(): SafeHtml {
    return this.safeSvg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8 15.7 6.6M8.3 13.2l7.4 4.2"/></svg>');
  }

  /** The channel glyph, ready for an [innerHTML] binding on this page. */
  safeIcon(channel: VerseNewsItem['channel']): SafeHtml {
    return this.safeSvg(this.iconFor(channel));
  }

  /** Inline channel glyphs — no icon font, no sprite request. */
  iconFor(channel: VerseNewsItem['channel']): string {
    switch (channel) {
      case 'youtube':
        return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z"/></svg>';
      case 'spectrum':
        return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 0 0-9 9v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H5a7 7 0 0 1 14 0h-2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5a9 9 0 0 0-9-9z"/></svg>';
      default:
        return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4h11a2 2 0 0 1 2 2v11a3 3 0 0 0 3 3H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2zm2 4v2h7V8H7zm0 4v2h7v-2H7zm0 4v2h5v-2H7z"/></svg>';
    }
  }
}
