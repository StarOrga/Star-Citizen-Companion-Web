import {
  ChangeDetectionStrategy,
  Component,
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
import { NgTemplateOutlet } from '@angular/common';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NewsService, NewsChannel, VerseNewsItem, VerseStatus, StatusLevel, effectivePlayability, pickRecentVideos, VIDEO_RETENTION_DAYS } from './news.service';
import { NewsThumbComponent } from './news-thumb.component';
import { UpcomingShipsNoticeComponent } from './upcoming-ships-notice.component';

const CHANNELS: NewsChannel[] = ['comm-link', 'spectrum', 'youtube', 'patch'];
const RSI_STATUS_URL = 'https://status.robertsspaceindustries.com/';

// Hover-dwell threshold before a video counts as "watched" (#146). Long enough
// that a cursor merely passing over the rail doesn't burn through the videos,
// short enough that a deliberate look registers.
const VIDEO_DWELL_MS = 1500;

// Channel-branded placeholder shown when an item carries no usable image — notably
// Spectrum threads (the list API gives no main-post image) and the occasional
// image-less Comm-Link the og:image backfill couldn't recover. Beats a flat
// gradient and keeps the grid visually consistent. Paths resolve via <base href="/">.
const DEFAULT_IMAGE: Partial<Record<NewsChannel, string>> = {
  'comm-link': 'img/news-default-comm-link.svg',
  'patch': 'img/news-default-comm-link.svg',
  'spectrum': 'img/news-default-spectrum.svg',
};

@Component({
  selector: 'sc-news-list',
  standalone: true,
  imports: [TranslateModule, NewsThumbComponent, NgTemplateOutlet, UpcomingShipsNoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="news-page">
      <header class="head">
        <div class="title-block">
          <h1>{{ 'news.title' | translate }}</h1>
          <p class="hint">{{ 'news.subtitle' | translate }}</p>
          @if (updatedRel(); as rel) {
            <p class="freshness" [class.stale]="updatedStale()">
              <span class="pulse" aria-hidden="true"></span>
              {{ 'news.lastUpdated' | translate:{ rel: rel } }}
            </p>
          }
        </div>

        @if (svc.feed()?.status; as st) {
          @let eff = effectiveStatus(st);
          <button class="status-chip" type="button" [class]="'status-' + eff"
                  [attr.aria-expanded]="statusOpen()" (click)="toggleStatus()">
            <span class="dot" [class]="'status-' + eff"></span>
            <span class="meta">
              <span class="t">{{ 'news.status.title' | translate }}</span>
              <strong>{{ ('news.status.' + eff) | translate }}</strong>
            </span>
            <span class="chev" aria-hidden="true">{{ statusOpen() ? '▴' : '▾' }}</span>
          </button>
        }
      </header>

      @if (statusOpen() && svc.feed()?.status; as st) {
        <div class="status-panel sc-card">
          <h3>{{ 'news.status.services' | translate }}</h3>
          @if (st.components.length > 0) {
            <ul class="svc-list">
              @for (c of st.components; track c.name) {
                <li><span class="dot" [class]="'status-' + c.status"></span><span class="svc-name">{{ c.name }}</span><span class="svc-status">{{ ('news.status.' + c.status) | translate }}</span></li>
              }
            </ul>
          } @else {
            <p class="muted">{{ 'news.status.noComponents' | translate }}</p>
          }
          <a class="ext-link" [href]="rsiStatusUrl" target="_blank" rel="noopener noreferrer">{{ 'news.status.checkExternal' | translate }}</a>
        </div>
      }

      <!-- Codex "Upcoming Ships" delta (feedback d3fbc023): self-hides when
           there is nothing new since the user last looked. -->
      <sc-upcoming-ships-notice />

      @if (svc.pendingCount() > 0) {
        <button class="new-pill" type="button" (click)="acknowledgeNew()">
          {{ (svc.pendingCount() === 1 ? 'news.newPost' : 'news.newPosts') | translate:{ count: svc.pendingCount() } }}
        </button>
      }

      <div class="stream">
        <div class="filter-bar" role="group" [attr.aria-label]="'news.filter.groupAria' | translate">
          <button class="chip all" type="button"
                  [class.active]="!hasFilter() && !svc.favoritesOnly()"
                  [attr.aria-pressed]="!hasFilter() && !svc.favoritesOnly()"
                  (click)="clearFilter()">{{ 'news.channels.all' | translate }}</button>
          @for (ch of channels; track ch) {
            <button class="chip" type="button"
                    [class.active]="isActive(ch)"
                    [attr.aria-pressed]="isActive(ch)"
                    [attr.data-channel]="ch"
                    (click)="toggleChannel(ch)">
              <span class="ch-icon" [innerHTML]="iconFor(ch)"></span>
              <span>{{ ('news.channels.' + ch) | translate }}</span>
              <span class="ct">{{ svc.channelCount(ch) }}</span>
            </button>
          }
          <button class="chip fav-chip" type="button"
                  [class.active]="svc.favoritesOnly()"
                  [attr.aria-pressed]="svc.favoritesOnly()"
                  (click)="toggleFavoritesOnly()">
            <span class="ch-icon star" aria-hidden="true">★</span>
            <span>{{ 'news.channels.favorites' | translate }}</span>
            <span class="ct">{{ svc.favoriteCount() }}</span>
          </button>
        </div>

        <!-- Recent videos rail (#146): ~5 newest unwatched clips. Hover-dwell or
             open marks a video watched so it drops out on the next load; the row
             stays stable during the current view (snapshot) so nothing reshuffles
             under the cursor. -->
        @if (showVideoRail()) {
          <section class="video-rail" [attr.aria-label]="'news.videos.title' | translate">
            <div class="bucket-head">
              <h2>{{ 'news.videos.title' | translate }}</h2>
              <span class="bucket-ct">{{ recentVideos().length }}</span>
              <!-- Videos age out after the retention window (e7082310); say so,
                   otherwise the shrinking video list reads as a bug. -->
              <span class="rail-note">{{ 'news.videos.retention' | translate:{ days: videoRetentionDays } }}</span>
            </div>
            <div class="rail-track">
              @for (vid of recentVideos(); track vid.id) {
                <article class="vid-card sc-reveal" [class.watched]="svc.isWatched(vid.id)"
                         [attr.data-channel]="vid.channel" tabindex="0" role="button"
                         [attr.aria-label]="vid.title"
                         (click)="openVideo(vid)"
                         (keydown.enter)="openVideo(vid)"
                         (keydown.space)="onVideoSpace($event, vid)"
                         (mouseenter)="onVideoEnter(vid)"
                         (mouseleave)="onVideoLeave()">
                  <div class="vid-thumb-wrap">
                    <sc-news-thumb
                      [images]="imagesOf(vid)"
                      [channel]="vid.channel"
                      [channelLabel]="('news.channels.' + vid.channel) | translate"
                      [channelIcon]="iconFor(vid.channel)"
                      [featured]="false" />
                    @if (svc.isWatched(vid.id)) {
                      <span class="watched-badge">
                        <span class="tick" aria-hidden="true">✓</span>
                        {{ 'news.videos.watched' | translate }}
                      </span>
                    }
                  </div>
                  <div class="vid-body">
                    <h3>{{ vid.title }}</h3>
                    <time>{{ relTime(vid.publishedAt) }}</time>
                  </div>
                </article>
              }
            </div>
          </section>
        }

        @if (svc.loading() && !svc.feed()) {
          <div class="bucket" aria-hidden="true">
            <div class="bucket-head"><span class="skel-line shimmer head"></span></div>
            <div class="cards today-cards">
              <div class="card skel featured sc-hud-frame">
                <span class="skel-thumb shimmer"></span>
                <span class="skel-body">
                  <span class="skel-line shimmer lg"></span>
                  <span class="skel-line shimmer"></span>
                  <span class="skel-line shimmer sm"></span>
                </span>
              </div>
              @for (n of [1, 2]; track n) {
                <div class="card skel sc-hud-frame">
                  <span class="skel-thumb shimmer"></span>
                  <span class="skel-body">
                    <span class="skel-line shimmer lg"></span>
                    <span class="skel-line shimmer sm"></span>
                  </span>
                </div>
              }
            </div>
          </div>
          <div class="bucket" aria-hidden="true">
            <div class="bucket-head"><span class="skel-line shimmer head"></span></div>
            <div class="cards regular-cards">
              @for (n of [1, 2, 3, 4]; track n) {
                <div class="card skel sc-hud-frame">
                  <span class="skel-thumb shimmer"></span>
                  <span class="skel-body">
                    <span class="skel-line shimmer lg"></span>
                    <span class="skel-line shimmer sm"></span>
                  </span>
                </div>
              }
            </div>
          </div>
        } @else if (svc.error(); as err) {
          <div class="sc-card err">
            <strong>{{ 'news.errorTitle' | translate }}:</strong> {{ err }}
          </div>
        } @else {
          @if (svc.bucketed().today.length > 0) {
            <section class="bucket">
              <div class="bucket-head">
                <h2>{{ 'news.buckets.today' | translate }}</h2>
                <span class="bucket-ct">{{ svc.bucketed().today.length }}</span>
              </div>
              <div class="cards today-cards">
                @for (item of svc.bucketed().today; track item.id; let i = $index) {
                  <ng-container *ngTemplateOutlet="card; context: { $implicit: item, featured: i === 0, showSummary: i === 0 || !item.thumbnail }" />
                }
              </div>
            </section>
          }

          @if (svc.bucketed().week.length > 0) {
            <section class="bucket">
              <div class="bucket-head">
                <h2>{{ 'news.buckets.week' | translate }}</h2>
                <span class="bucket-ct">{{ svc.bucketed().week.length }}</span>
              </div>
              <div class="cards regular-cards">
                @for (item of svc.bucketed().week; track item.id) {
                  <ng-container *ngTemplateOutlet="card; context: { $implicit: item, featured: false, showSummary: false }" />
                }
              </div>
            </section>
          }

          @if (svc.bucketed().older.length > 0) {
            <section class="bucket">
              <div class="bucket-head">
                <h2>{{ 'news.buckets.older' | translate }}</h2>
                <span class="bucket-ct">{{ svc.bucketed().older.length }}</span>
                <button type="button" class="bucket-toggle" (click)="toggleOlder()">
                  {{ (olderOpen() ? 'news.buckets.hideMore' : 'news.buckets.showMore') | translate:{ count: svc.bucketed().older.length } }}
                </button>
              </div>
              @if (olderOpen()) {
                <div class="cards regular-cards">
                  @for (item of svc.bucketed().older; track item.id) {
                    <ng-container *ngTemplateOutlet="card; context: { $implicit: item, featured: false, showSummary: false }" />
                  }
                </div>
              }
            </section>
          }

          @if (svc.bucketed().today.length === 0 && svc.bucketed().week.length === 0 && svc.bucketed().older.length === 0) {
            <div class="sc-card empty">{{ (svc.favoritesOnly() ? 'news.emptyFavorites' : (hasFilter() ? 'news.emptyFiltered' : 'news.empty')) | translate }}</div>
          }
        }
      </div>
    </section>

    <!-- One card template for all buckets: click opens the in-app detail
         overlay; the footer keeps quick actions (save / share / external). -->
    <ng-template #card let-item let-featured="featured" let-showSummary="showSummary">
      <article class="card sc-reveal" [class.featured]="featured" [class.has-thumb]="!!item.thumbnail"
               [attr.data-channel]="item.channel" tabindex="0" role="button"
               [attr.aria-label]="item.title"
               (click)="openDetail(item)"
               (keydown.enter)="openDetail(item)"
               (keydown.space)="onCardSpace($event, item)">
        <sc-news-thumb
          [images]="imagesOf(item)"
          [channel]="item.channel"
          [channelLabel]="('news.channels.' + item.channel) | translate"
          [channelIcon]="iconFor(item.channel)"
          [featured]="featured" />
        <div class="body">
          <h3>{{ item.title }}</h3>
          @if (item.summary && showSummary) {
            <p>{{ item.summary }}</p>
          }
          <div class="foot">
            <time>{{ relTime(item.publishedAt) }}</time>
            <span class="actions">
              <button type="button" class="act fav" [class.on]="isFav(item)"
                      [attr.aria-pressed]="isFav(item)"
                      [attr.aria-label]="'news.favorite.toggle' | translate"
                      [attr.title]="'news.favorite.toggle' | translate"
                      (click)="toggleFavorite($event, item)">{{ isFav(item) ? '★' : '☆' }}</button>
              <button type="button" class="act share"
                      [attr.aria-label]="'news.share.label' | translate"
                      [attr.title]="'news.share.label' | translate"
                      (click)="share($event, item)">⤴</button>
              <a class="act ext" [href]="item.url" target="_blank" rel="noopener noreferrer"
                 (click)="$event.stopPropagation()"
                 [attr.aria-label]="'news.openExternal' | translate:{ host: hostOf(item.url) }"
                 [attr.title]="'news.openExternal' | translate:{ host: hostOf(item.url) }">{{ hostOf(item.url) }} ↗</a>
            </span>
          </div>
        </div>
      </article>
    </ng-template>

    <!-- Enlarged in-app detail (CDK overlay, portaled to <body>). -->
    <ng-template #detailTpl>
      <div class="nd-overlay" (click)="closeDetail()">
        @if (selected(); as item) {
          <article class="nd-panel sc-card" role="dialog" aria-modal="true"
                   [attr.aria-label]="item.title" (click)="$event.stopPropagation()">
            <button type="button" class="nd-close" (click)="closeDetail()"
                    [attr.aria-label]="'news.detail.close' | translate">✕</button>
            <sc-news-thumb
              [images]="imagesOf(item)"
              [channel]="item.channel"
              [channelLabel]="('news.channels.' + item.channel) | translate"
              [channelIcon]="iconFor(item.channel)"
              [featured]="true" />
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

    @if (shareHint(); as hint) {
      <div class="share-toast" role="status">{{ hint | translate }}</div>
    }
  `,
  styles: [`
    :host { display: block; }
    .news-page { display: flex; flex-direction: column; gap: 16px; }

    /* ---------- Header ---------- */
    .head {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 16px; flex-wrap: wrap;
    }
    .title-block h1 { margin: 0; }
    .title-block .hint { color: var(--sc-fg-2); margin: 4px 0 0; }

    .status-chip {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 8px 14px; border-radius: 999px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      color: var(--sc-fg-0); cursor: pointer;
      font-family: inherit; font-size: 0.82rem;
      transition: border-color .18s, background .18s, box-shadow .18s;
    }
    .status-chip:hover { border-color: var(--sc-accent); }
    .status-chip .meta { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.15; }
    .status-chip .meta .t { font-size: 0.66rem; color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.08em; }
    .status-chip .meta strong { font-size: 0.88rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
    .status-chip .chev { color: var(--sc-fg-2); font-size: 0.75rem; }
    .status-chip.status-operational { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-success) 40%, transparent); }
    .status-chip.status-degraded, .status-chip.status-partial_outage,
    .status-chip.status-maintenance { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-warning) 40%, transparent); }
    .status-chip.status-major_outage { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-danger) 40%, transparent); }

    .dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--sc-fg-2); flex: 0 0 auto;
    }
    .dot.status-operational { background: var(--sc-success); box-shadow: 0 0 8px var(--sc-success); }
    .dot.status-degraded, .dot.status-partial_outage { background: var(--sc-warning); }
    .dot.status-major_outage { background: var(--sc-danger); box-shadow: 0 0 8px var(--sc-danger); }
    .dot.status-maintenance { background: var(--sc-accent); }
    .dot.status-unknown { background: var(--sc-fg-2); }

    .status-panel {
      padding: 14px 18px;
      animation: slide-down .2s ease;
    }
    @keyframes slide-down {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: none; }
    }
    .status-panel h3 { font-size: 0.85rem; margin: 0 0 8px; color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.08em; }
    .svc-list { list-style: none; padding: 0; margin: 0 0 10px; display: grid; gap: 6px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    .svc-list li { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; padding: 4px 6px; border-radius: 4px; background: var(--sc-bg-1); }
    .svc-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .svc-status { font-size: 0.72rem; color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.06em; }
    .ext-link { font-size: 0.82rem; }
    .muted { color: var(--sc-fg-2); font-size: 0.85rem; margin: 0; }

    /* ---------- New posts pill ---------- */
    .new-pill {
      align-self: center;
      padding: 8px 18px; border-radius: 999px;
      background: var(--sc-accent); color: var(--sc-bg-0);
      border: none; cursor: pointer;
      font-family: var(--sc-font-display); font-size: 0.78rem; letter-spacing: 0.08em;
      box-shadow: 0 0 20px color-mix(in srgb, var(--sc-accent) 40%, transparent);
      animation: pill-pulse 2.2s ease-in-out infinite;
    }
    @keyframes pill-pulse {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-2px); }
    }
    .new-pill:hover { background: color-mix(in srgb, var(--sc-accent) 80%, white); }

    /* ---------- Stream container (Filter + Buckets visuell verbunden) ---------- */
    .stream {
      display: flex; flex-direction: column;
      border: 1px solid var(--sc-border); border-radius: 10px;
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      overflow: hidden;
    }
    .filter-bar {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 12px 14px;
      position: sticky; top: 0; z-index: 2;
      background: linear-gradient(180deg, var(--sc-bg-2) 80%, transparent);
      backdrop-filter: blur(6px);
      border-bottom: 1px solid var(--sc-border);
    }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px;
      border: 1px solid var(--sc-border); background: transparent;
      color: var(--sc-fg-1); font-family: inherit; font-size: 0.78rem;
      cursor: pointer; transition: all 0.16s;
    }
    .chip:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .chip.active {
      background: color-mix(in srgb, var(--sc-accent) 18%, transparent);
      border-color: var(--sc-accent); color: var(--sc-fg-0); font-weight: 600;
    }
    .chip .ct {
      font-size: 0.68rem; padding: 0 6px; border-radius: 8px;
      background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent);
      color: var(--sc-fg-2);
    }
    .chip.active .ct { background: color-mix(in srgb, var(--sc-accent) 25%, transparent); color: var(--sc-bg-0); }
    .chip .ch-icon { display: inline-flex; width: 14px; height: 14px; }
    .chip .ch-icon svg { width: 100%; height: 100%; display: block; }

    /* ---------- Buckets ---------- */
    .bucket { padding: 14px 16px; }
    .bucket + .bucket { border-top: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
    .bucket-head {
      display: flex; align-items: baseline; gap: 12px;
      margin-bottom: 12px;
    }
    .bucket-head h2 {
      margin: 0; font-size: 0.82rem; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--sc-accent);
    }
    .bucket-ct {
      font-size: 0.7rem; color: var(--sc-fg-2);
      padding: 1px 8px; border-radius: 999px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
    }
    .bucket-toggle {
      margin-left: auto; padding: 4px 10px;
      background: transparent; border: 1px solid var(--sc-border);
      color: var(--sc-fg-2); border-radius: 6px;
      font-family: inherit; font-size: 0.74rem; cursor: pointer;
    }
    .bucket-toggle:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    /* ---------- Cards ---------- */
    .cards { display: grid; gap: 14px; }
    .today-cards { grid-template-columns: 1.6fr 1fr 1fr; grid-auto-rows: minmax(180px, auto); }
    .today-cards .card.featured { grid-column: 1; grid-row: span 2; }
    .regular-cards { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    @media (max-width: 800px) {
      .today-cards { grid-template-columns: 1fr; }
      .today-cards .card.featured { grid-column: 1; grid-row: auto; }
    }

    .card {
      display: flex; flex-direction: column; gap: 0;
      border: 1px solid var(--sc-border); border-radius: 8px;
      background: var(--sc-bg-1); color: inherit; text-decoration: none;
      overflow: hidden; min-height: 180px;
      transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
    }
    .card:hover {
      transform: translateY(-3px) scale(1.005);
      border-color: var(--sc-accent);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4),
                  0 0 18px color-mix(in srgb, var(--sc-accent) 35%, transparent);
    }
    /* Thumbnail (image / slideshow / placeholder) lives in <sc-news-thumb>. */

    .card .body { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; flex: 1; }
    .card .body h3 {
      font-size: 0.98rem; line-height: 1.3; margin: 0;
      font-family: var(--sc-font-body); letter-spacing: 0; font-weight: 600;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .card .body p {
      color: var(--sc-fg-1); font-size: 0.84rem; margin: 0;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }
    .card .body .foot {
      display: flex; justify-content: space-between; align-items: center;
      margin-top: auto; padding-top: 6px;
      font-size: 0.7rem; color: var(--sc-fg-2);
      border-top: 1px dashed color-mix(in srgb, var(--sc-border) 70%, transparent);
    }
    .card .body .foot .src { color: var(--sc-accent); text-transform: lowercase; }
    .card .body .foot time { color: var(--sc-fg-2); }

    .card.featured { min-height: 380px; }
    .card.featured .body h3 { font-size: 1.25rem; font-family: var(--sc-font-display); letter-spacing: 0.02em; -webkit-line-clamp: 3; }
    .card.featured .body p { -webkit-line-clamp: 4; }

    /* ---------- Skeleton ---------- */
    /* Mirrors the real card (thumb on top, text lines below) so the loading state
       reads as "content is coming", not as empty boxes. */
    .card.skel { display: flex; flex-direction: column; gap: 0; cursor: default; min-height: 180px; }
    .card.skel:hover { transform: none; box-shadow: none; border-color: var(--sc-border); }
    .card.skel.featured { min-height: 380px; }
    .skel-thumb { width: 100%; aspect-ratio: 16 / 9; display: block; }
    .card.skel.featured .skel-thumb { aspect-ratio: 21 / 9; }
    .skel-body { display: flex; flex-direction: column; gap: 9px; padding: 14px; flex: 1; }
    .skel-line { display: block; height: 11px; border-radius: 5px; width: 100%; }
    .skel-line.lg { height: 15px; width: 78%; }
    .skel-line.sm { width: 42%; margin-top: auto; }
    .skel-line.head { height: 12px; width: 120px; }
    /* Shared shimmer sweep — one keyframe, staggered so the tiles don't pulse in
       lockstep. Accent-tinted highlight (was bg-1↔bg-2, invisible in the dark
       theme — the root of "no loading animation") so the sweep actually reads. */
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

    /* ---------- Freshness indicator (live "updated X min ago") ---------- */
    .freshness {
      display: inline-flex; align-items: center; gap: 7px;
      margin: 6px 0 0; font-size: 0.72rem; color: var(--sc-fg-2);
      font-variant-numeric: tabular-nums;
    }
    .freshness .pulse {
      width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto;
      background: var(--sc-success);
      animation: fresh-pulse 2.4s ease-out infinite;
    }
    .freshness.stale { color: var(--sc-warning); }
    .freshness.stale .pulse { background: var(--sc-warning); animation: none; }
    @keyframes fresh-pulse {
      0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--sc-success) 55%, transparent); }
      70% { box-shadow: 0 0 0 6px transparent; }
      100% { box-shadow: 0 0 0 0 transparent; }
    }
    @media (prefers-reduced-motion: reduce) {
      .freshness .pulse { animation: none; }
    }

    .empty { text-align: center; color: var(--sc-fg-2); padding: 40px; margin: 16px; }
    .err { color: var(--sc-danger); margin: 16px; padding: 16px; }

    /* ---------- Favorites chip ---------- */
    .fav-chip .ch-icon.star { color: var(--sc-warning); font-size: 0.9rem; line-height: 1; }
    .fav-chip.active { background: color-mix(in srgb, var(--sc-warning) 20%, transparent); border-color: var(--sc-warning); }
    .fav-chip.active .ct { background: color-mix(in srgb, var(--sc-warning) 28%, transparent); color: var(--sc-bg-0); }

    /* ---------- Recent videos rail (#146) ---------- */
    .video-rail { display: flex; flex-direction: column; gap: 10px; }
    .rail-note { font-size: 0.7rem; color: var(--sc-fg-2); margin-left: auto; }
    .rail-track {
      display: grid; grid-auto-flow: column; grid-auto-columns: minmax(210px, 78vw);
      gap: 12px; overflow-x: auto; padding: 2px 2px 8px;
      scroll-snap-type: x proximity; scrollbar-width: thin;
    }
    /* On wider viewports the ~5-wide row fits without horizontal scrolling. */
    @media (min-width: 720px) {
      .rail-track { grid-auto-columns: minmax(0, 1fr); }
    }
    .vid-card {
      display: flex; flex-direction: column; scroll-snap-align: start;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      border-radius: 10px; overflow: hidden; cursor: pointer; text-align: left;
      transition: border-color .15s ease, transform .15s ease, opacity .2s ease;
    }
    .vid-card:hover, .vid-card:focus-visible {
      border-color: var(--sc-accent); transform: translateY(-2px); outline: none;
    }
    .vid-card:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .vid-thumb-wrap { position: relative; }
    .watched-badge {
      position: absolute; top: 8px; right: 8px;
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px; border-radius: 999px; font-size: 0.68rem; font-weight: 600;
      color: var(--sc-fg-1); background: color-mix(in srgb, var(--sc-bg-0) 78%, transparent);
      border: 1px solid var(--sc-border);
      -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
    }
    .watched-badge .tick { color: var(--sc-accent); }
    .vid-card.watched { opacity: 0.55; }
    .vid-card.watched:hover, .vid-card.watched:focus-visible { opacity: 0.85; }
    .vid-body { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; }
    .vid-body h3 {
      margin: 0; font-size: 0.9rem; line-height: 1.3;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .vid-body time { color: var(--sc-fg-2); font-size: 0.75rem; }
    @media (prefers-reduced-motion: reduce) {
      .vid-card, .vid-card:hover, .vid-card:focus-visible { transform: none; }
    }

    /* ---------- Card as button + quick actions ---------- */
    .card { cursor: pointer; text-align: left; }
    .card:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .card .body .foot .actions { display: inline-flex; align-items: center; gap: 6px; }
    .act {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 26px; height: 24px; padding: 0 6px; border-radius: 6px;
      background: transparent; border: 1px solid transparent; color: var(--sc-fg-2);
      font-family: inherit; font-size: 0.82rem; line-height: 1; cursor: pointer; text-decoration: none;
    }
    .act:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .act.fav.on { color: var(--sc-warning); }
    .act.fav.on:hover { border-color: var(--sc-warning); color: var(--sc-warning); }
    .act.ext { font-size: 0.7rem; color: var(--sc-accent); text-transform: lowercase; }

    /* ---------- Detail overlay ---------- */
    .nd-overlay {
      position: fixed; inset: 0; z-index: 120;
      background: rgba(0, 0, 0, 0.72);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      display: flex; justify-content: center; align-items: flex-start;
      padding: 8vh 16px 16px; overflow-y: auto;
    }
    .nd-panel {
      position: relative; width: 100%; max-width: 720px;
      display: flex; flex-direction: column; gap: 0; overflow: hidden; padding: 0;
      animation: nd-in .18s ease;
    }
    @keyframes nd-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .nd-panel { animation: none; } }
    .nd-close {
      position: absolute; top: 10px; right: 10px; z-index: 2;
      width: 34px; height: 34px; border-radius: 50%;
      background: rgba(0, 0, 0, 0.55); border: 1px solid var(--sc-border);
      color: var(--sc-fg-0); cursor: pointer; font-size: 1rem; line-height: 1;
    }
    .nd-close:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .nd-body { display: flex; flex-direction: column; gap: 12px; padding: 18px 20px 20px; }
    .nd-chan { display: flex; align-items: center; gap: 8px; font-size: 0.74rem; color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.06em; }
    .nd-chan .ch-icon { display: inline-flex; width: 15px; height: 15px; }
    .nd-chan .ch-icon svg { width: 100%; height: 100%; }
    .nd-chan .dot-sep { opacity: 0.6; }
    .nd-body h2 { margin: 0; font-family: var(--sc-font-display); font-size: 1.35rem; line-height: 1.25; }
    .nd-summary { margin: 0; color: var(--sc-fg-1); font-size: 0.92rem; line-height: 1.55; white-space: pre-line; }
    .nd-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
    .nd-actions .sc-btn {
      padding: 8px 14px; border-radius: 6px; background: var(--sc-bg-1);
      border: 1px solid var(--sc-accent); color: var(--sc-accent);
      font-family: var(--sc-font-display); font-size: 0.74rem; letter-spacing: 0.05em;
      text-transform: uppercase; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center;
    }
    .nd-actions .sc-btn:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .nd-actions .sc-btn.on { border-color: var(--sc-warning); color: var(--sc-warning); background: color-mix(in srgb, var(--sc-warning) 12%, transparent); }
    .nd-actions .sc-btn.primary { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); }

    /* ---------- Share toast ---------- */
    .share-toast {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      z-index: 130; padding: 10px 18px; border-radius: 999px;
      background: var(--sc-bg-2); border: 1px solid var(--sc-accent); color: var(--sc-fg-0);
      font-size: 0.82rem; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
      animation: nd-in .16s ease;
    }
  `],
})
export class NewsListComponent implements OnInit, OnDestroy {
  readonly svc = inject(NewsService);
  private readonly t = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly overlay = inject(Overlay);
  private readonly viewContainer = inject(ViewContainerRef);

  readonly channels = CHANNELS;
  readonly rsiStatusUrl = RSI_STATUS_URL;
  // Retention window shown next to the video rail head (e7082310).
  readonly videoRetentionDays = VIDEO_RETENTION_DAYS;
  readonly statusOpen = signal(false);
  readonly olderOpen = signal(false);
  readonly hasFilter = computed(() => this.svc.activeChannels().size > 0);

  // ── Recent videos rail (#146) ────────────────────────────────────────────
  // Watched set captured at load. `markWatched` updates the service's live set
  // (persisted), but the rail renders against this snapshot so a freshly-dwelled
  // clip stays in place and only drops on the next feed load. Re-synced whenever
  // the feed reference changes (5-min poll / reload) — that is "subsequent loads".
  private readonly watchedSnapshot = signal<Set<string>>(new Set());
  private readonly syncWatchedSnapshot = effect(() => {
    this.svc.feed(); // dependency: re-sync on every feed (re)load
    this.watchedSnapshot.set(new Set(untracked(() => this.svc.watchedIds())));
  });
  readonly recentVideos = computed(() =>
    pickRecentVideos(this.svc.allVideos(), this.watchedSnapshot()),
  );
  // Shown in the default "Alle" view (or when YouTube is explicitly selected),
  // never in favorites-only, and only when there are videos to show.
  readonly showVideoRail = computed(() => {
    if (this.svc.favoritesOnly()) return false;
    if (this.recentVideos().length === 0) return false;
    const active = this.svc.activeChannels();
    return active.size === 0 || active.has('youtube');
  });
  private dwellTimer: ReturnType<typeof setTimeout> | null = null;

  // Enlarged in-app detail view (CDK overlay), plus a transient share toast.
  private readonly detailTpl = viewChild.required<TemplateRef<unknown>>('detailTpl');
  private detailRef: OverlayRef | null = null;
  readonly selected = signal<VerseNewsItem | null>(null);
  readonly shareHint = signal<string | null>(null);
  private shareHintTimer: ReturnType<typeof setTimeout> | null = null;

  // Ticking clock so every relative time ("updated X min ago", card timestamps)
  // stays live between the 5-min feed refreshes instead of freezing at load time.
  private readonly now = signal(Date.now());
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  // Live "updated X ago" label for the header, recomputed as the clock ticks.
  readonly updatedRel = computed(() => {
    const fetched = this.svc.feed()?.fetchedAt;
    return fetched ? this.relFrom(fetched, this.now()) : null;
  });
  // Feed is considered stale once it outlives ~1.4 poll cycles (poll = 5 min).
  readonly updatedStale = computed(() => {
    const fetched = this.svc.feed()?.fetchedAt;
    if (!fetched) return false;
    return this.now() - Date.parse(fetched) > 7 * 60 * 1000;
  });

  async ngOnInit() {
    // Deep-link support: /news?article=<id> opens that item's detail directly
    // (the target of a shared link) once the feed has loaded.
    const articleId = this.route.snapshot.queryParamMap.get('article');
    await this.svc.refresh();
    this.svc.startPolling();
    this.clockTimer = setInterval(() => this.now.set(Date.now()), 30_000);
    if (articleId) {
      const item = this.svc.itemById(articleId);
      if (item) this.openDetail(item);
    }
  }

  ngOnDestroy() {
    this.svc.stopPolling();
    if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = null; }
    if (this.shareHintTimer) { clearTimeout(this.shareHintTimer); this.shareHintTimer = null; }
    this.clearDwell();
    this.detailRef?.dispose();
    this.detailRef = null;
  }

  toggleStatus() { this.statusOpen.update((v) => !v); }
  toggleOlder() { this.olderOpen.update((v) => !v); }

  /**
   * Playability-aware headline for the status chip: escalates the RSI overall
   * to at least the Persistent Universe component's level so a scheduled PU
   * maintenance no longer reads as "Playable" (feedback 740d31cb). See
   * `effectivePlayability`.
   */
  effectiveStatus(st: VerseStatus): StatusLevel {
    return effectivePlayability(st);
  }

  // Channel + favorites filtering are mutually exclusive views: picking a
  // channel (or "Alle") leaves the saved-only view; the ★ chip enters it.
  toggleChannel(ch: NewsChannel) {
    if (this.svc.favoritesOnly()) this.svc.favoritesOnly.set(false);
    this.svc.toggleChannel(ch);
  }
  clearFilter() {
    this.svc.favoritesOnly.set(false);
    this.svc.clearFilter();
  }
  toggleFavoritesOnly() { this.svc.toggleFavoritesOnly(); }
  isActive(ch: NewsChannel): boolean { return this.svc.activeChannels().has(ch); }

  // ── Detail overlay ──────────────────────────────────────────────────────────
  openDetail(item: VerseNewsItem): void {
    this.selected.set(item);
    if (this.detailRef) return;
    const ref = this.overlay.create({
      positionStrategy: this.overlay.position().global(),
      scrollStrategy: this.overlay.scrollStrategies.block(),
    });
    ref.attach(new TemplatePortal(this.detailTpl(), this.viewContainer));
    this.detailRef = ref;
  }

  closeDetail(): void {
    this.selected.set(null);
    this.detailRef?.dispose();
    this.detailRef = null;
  }

  onCardSpace(ev: Event, item: VerseNewsItem): void {
    ev.preventDefault();
    this.openDetail(item);
  }

  // ── Video rail hover-dwell (#146) ────────────────────────────────────────
  // A mouse resting on a clip past the dwell threshold marks it watched — no
  // click needed. Leaving early cancels it, so a cursor passing over the row
  // doesn't consume videos.
  onVideoEnter(item: VerseNewsItem): void {
    if (this.svc.isWatched(item.id)) return;
    this.clearDwell();
    this.dwellTimer = setTimeout(() => {
      this.svc.markWatched(item.id);
      this.dwellTimer = null;
    }, VIDEO_DWELL_MS);
  }

  onVideoLeave(): void {
    this.clearDwell();
  }

  onVideoSpace(ev: Event, item: VerseNewsItem): void {
    ev.preventDefault();
    this.openVideo(item);
  }

  /** Opening a video (click / keyboard) also counts as watched, then shows detail. */
  openVideo(item: VerseNewsItem): void {
    this.svc.markWatched(item.id);
    this.openDetail(item);
  }

  private clearDwell(): void {
    if (this.dwellTimer) { clearTimeout(this.dwellTimer); this.dwellTimer = null; }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.detailRef) this.closeDetail();
  }

  // ── Favorites + share ───────────────────────────────────────────────────────
  isFav(item: VerseNewsItem): boolean {
    return this.svc.isFavorite(item.id);
  }

  toggleFavorite(ev: Event, item: VerseNewsItem): void {
    ev.stopPropagation();
    this.svc.toggleFavorite(item.id);
  }

  async share(ev: Event, item: VerseNewsItem): Promise<void> {
    ev.stopPropagation();
    const url = this.shareUrl(item);
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title: item.title, url });
      } catch {
        /* user dismissed the share sheet — not an error */
      }
      return;
    }
    try {
      await nav?.clipboard?.writeText(url);
      this.flashShareHint('news.share.copied');
    } catch {
      this.flashShareHint('news.share.failed');
    }
  }

  /** Deep link that reopens this article's detail view on our own site. */
  private shareUrl(item: VerseNewsItem): string {
    const origin = typeof location !== 'undefined' ? location.origin : '';
    return `${origin}/news?article=${encodeURIComponent(item.id)}`;
  }

  private flashShareHint(key: string): void {
    this.shareHint.set(key);
    if (this.shareHintTimer) clearTimeout(this.shareHintTimer);
    this.shareHintTimer = setTimeout(() => this.shareHint.set(null), 2600);
  }

  acknowledgeNew() {
    this.svc.acknowledgeNewPosts();
    this.svc.refresh(true);
  }

  /**
   * Candidate images for a card — prefers the full list, falls back to the single
   * thumbnail, then to a channel-branded default so no card renders blank.
   */
  imagesOf(item: VerseNewsItem): string[] {
    if (item.images?.length) return item.images;
    if (item.thumbnail) return [item.thumbnail];
    const fallback = DEFAULT_IMAGE[item.channel];
    return fallback ? [fallback] : [];
  }

  hostOf(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  relTime(iso: string): string {
    return this.relFrom(iso, this.now());
  }

  private relFrom(iso: string, nowMs: number): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const diffMs = nowMs - t;
    if (diffMs < 60000) return this.t.instant('news.relative.now');
    const min = Math.floor(diffMs / 60000);
    if (min < 60) return this.t.instant('news.relative.minutes', { n: min });
    const h = Math.floor(min / 60);
    if (h < 24) return this.t.instant('news.relative.hours', { n: h });
    const d = Math.floor(h / 24);
    if (d === 1) return this.t.instant('news.relative.yesterday');
    if (d < 7) return this.t.instant('news.relative.days', { n: d });
    const w = Math.floor(d / 7);
    return this.t.instant('news.relative.weeks', { n: w });
  }

  iconFor(channel: NewsChannel): string {
    switch (channel) {
      case 'comm-link':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/></svg>';
      case 'spectrum':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
      case 'youtube':
        return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7.5a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.9.4A3 3 0 0 0 1 7.5 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.5a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.9-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23.5 12 31 31 0 0 0 23 7.5zM10 15V9l5 3-5 3z"/></svg>';
      case 'patch':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a2 2 0 1 0 2.8 2.8l6-6a4 4 0 0 0 5.4-5.4l-2.5 2.5-1.4-1.4 2.5-2.5z"/></svg>';
      case 'status':
      default:
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';
    }
  }
}
