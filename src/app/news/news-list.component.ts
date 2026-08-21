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
              <span class="ch-icon" [innerHTML]="iconFor(item.channel)"></span>
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
            <p class="stage-actions">
              <span class="cta">
                {{ (isVideo(item) ? 'news.stage.watch' : 'news.stage.read') | translate }} →
              </span>
              <button type="button" class="act fav" [class.on]="isFav(item)"
                      [attr.aria-pressed]="isFav(item)"
                      [attr.aria-label]="'news.favorite.toggle' | translate"
                      [attr.title]="'news.favorite.toggle' | translate"
                      (click)="toggleFavorite($event, item)">{{ isFav(item) ? '★' : '☆' }}</button>
              <button type="button" class="act share"
                      [attr.aria-label]="'news.share.label' | translate"
                      [attr.title]="'news.share.label' | translate"
                      (click)="share($event, item)">⤴</button>
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
          <span class="count">{{ 'news.stream.count' | translate:{ count: streamTotal() } }}</span>
          <button type="button" class="saved-link" [class.on]="svc.favoritesOnly()"
                  [attr.aria-pressed]="svc.favoritesOnly()"
                  (click)="toggleFavoritesOnly()">
            ★ {{ 'news.channels.favorites' | translate }} ({{ svc.favoriteCount() }})
          </button>
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
                    <span class="actions">
                      <button type="button" class="act fav" [class.on]="isFav(item)"
                              [attr.aria-pressed]="isFav(item)"
                              [attr.aria-label]="'news.favorite.toggle' | translate"
                              [attr.title]="'news.favorite.toggle' | translate"
                              (click)="toggleFavorite($event, item)">{{ isFav(item) ? '★' : '☆' }}</button>
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
            <button type="button" class="nd-close" (click)="closeDetail()"
                    [attr.aria-label]="'news.detail.close' | translate">✕</button>
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
                <span class="ch-icon" [innerHTML]="iconFor(item.channel)"></span>
                <span>{{ ('news.channels.' + item.channel) | translate }}</span>
                <span class="dot-sep">·</span>
                <time>{{ relTime(item.publishedAt) }}</time>
              </div>
              <h2>{{ item.title }}</h2>
              @if (item.summary) { <p class="nd-summary">{{ item.summary }}</p> }
              <div class="nd-actions">
                <button type="button" class="sc-btn" [class.on]="isFav(item)"
                        [attr.aria-pressed]="isFav(item)" (click)="toggleFavorite($event, item)">
                  {{ (isFav(item) ? 'news.favorite.saved' : 'news.favorite.save') | translate }}
                </button>
                <button type="button" class="sc-btn" (click)="share($event, item)">
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
    .news-page { display: flex; flex-direction: column; gap: 18px; }

    /* ---------- 1 · Stage ----------
       Full-bleed art with a horizontal scrim: opaque at the left edge where the
       type sits, clear on the right where the artwork earns its keep. The 21/9
       ratio only pays off at desktop width; a narrow viewport falls back to
       16/9 so the hero does not shrink to a letterbox sliver. */
    .stage {
      position: relative; overflow: hidden;
      border: 1px solid var(--sc-border); border-radius: 12px;
      background: var(--sc-bg-1);
      display: flex; align-items: flex-end; min-height: 340px;
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
    .stage-actions { display: flex; align-items: center; gap: 14px; margin: 0; position: relative; z-index: 4; }
    .cta {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 16px; border-radius: 6px; min-height: var(--sc-tap-min);
      background: var(--sc-accent); color: var(--sc-bg-0);
      font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.1em; text-transform: uppercase; pointer-events: none;
    }

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
    .stream-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px 14px; }
    .stream-head h2 {
      margin: 0; font-size: 0.82rem; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--sc-accent);
    }
    .stream-head .count {
      font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
      padding: 1px 8px; border-radius: 999px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
    }
    .saved-link {
      background: transparent; border: 1px solid transparent; cursor: pointer;
      color: var(--sc-fg-2); font-family: inherit; padding: 4px 8px; border-radius: 6px;
      font-size: max(0.72rem, var(--sc-fs-floor)); min-height: var(--sc-tap-min);
    }
    .saved-link:hover { color: var(--sc-warning); }
    .saved-link.on { color: var(--sc-warning); border-color: color-mix(in srgb, var(--sc-warning) 55%, transparent); }
    .saved-link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

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
      display: flex; justify-content: space-between; align-items: center;
      margin-top: auto; padding-top: 6px;
      font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
      border-top: 1px dashed color-mix(in srgb, var(--sc-border) 70%, transparent);
    }
    .vid-tag {
      margin-right: 6px; padding: 1px 6px; border-radius: 4px;
      font-family: var(--sc-font-display); font-size: max(0.6rem, var(--sc-fs-floor));
      letter-spacing: 0.08em; color: var(--sc-danger);
      border: 1px solid color-mix(in srgb, var(--sc-danger) 55%, transparent);
    }
    .actions { display: inline-flex; align-items: center; gap: 8px; position: relative; z-index: 6; }
    .act {
      background: transparent; border: 0; cursor: pointer; color: var(--sc-fg-2);
      font-family: inherit; font-size: 0.9rem; line-height: 1;
      min-width: var(--sc-tap-min); min-height: var(--sc-tap-min);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .act:hover { color: var(--sc-accent); }
    .act.on { color: var(--sc-warning); }
    .act.ext { font-size: max(0.68rem, var(--sc-fs-floor)); text-decoration: none; color: var(--sc-accent); }
    .act:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
    .stage-actions .act { font-size: 1.05rem; }

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
    .stage.skel { display: block; min-height: 340px; }
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
   * "Median 22 T · n = 3 · 4.10 im Test" — the caveat behind the estimate. The
   * sample count is never dropped: a forecast built on three intervals is worth
   * saying out loud, and one confidently wrong patch date costs the reader's
   * trust in every other number on the page.
   */
  readonly verdictBasis = computed(() => {
    const v = this.verdict();
    if (v.medianDays === null || v.samples === null) return '';
    const key = v.testLine ? 'news.verdict.basisWithTest' : 'news.verdict.basis';
    return this.t.instant(key, {
      median: v.medianDays,
      n: v.samples,
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

  toggleFavoritesOnly(): void {
    this.svc.toggleFavoritesOnly();
  }

  isFav(item: VerseNewsItem): boolean {
    return this.svc.isFavorite(item.id);
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
