import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NewsService, NewsChannel } from './news.service';

const CHANNELS: NewsChannel[] = ['comm-link', 'spectrum', 'youtube', 'patch'];
const RSI_STATUS_URL = 'https://status.robertsspaceindustries.com/';

@Component({
  selector: 'sc-news-list',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="news-page">
      <header class="head">
        <div class="title-block">
          <h1>{{ 'news.title' | translate }}</h1>
          <p class="hint">{{ 'news.subtitle' | translate }}</p>
        </div>

        @if (svc.feed()?.status; as st) {
          <button class="status-chip" type="button" [class]="'status-' + st.overall"
                  [attr.aria-expanded]="statusOpen()" (click)="toggleStatus()">
            <span class="dot" [class]="'status-' + st.overall"></span>
            <span class="meta">
              <span class="t">{{ 'news.status.title' | translate }}</span>
              <strong>{{ ('news.status.' + st.overall) | translate }}</strong>
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

      @if (svc.pendingCount() > 0) {
        <button class="new-pill" type="button" (click)="acknowledgeNew()">
          {{ (svc.pendingCount() === 1 ? 'news.newPost' : 'news.newPosts') | translate:{ count: svc.pendingCount() } }}
        </button>
      }

      <div class="stream">
        <div class="filter-bar" role="group" aria-label="Channel filter">
          <button class="chip all" type="button"
                  [class.active]="!hasFilter()"
                  [attr.aria-pressed]="!hasFilter()"
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
        </div>

        @if (svc.loading() && !svc.feed()) {
          <div class="bucket">
            <div class="bucket-head"><h2>&nbsp;</h2></div>
            <div class="cards today-cards">
              <div class="card skel featured"></div>
              <div class="card skel"></div>
              <div class="card skel"></div>
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
                  <a class="card" [class.featured]="i === 0"
                     [class.has-thumb]="!!item.thumbnail"
                     [attr.data-channel]="item.channel"
                     [href]="item.url" target="_blank" rel="noopener noreferrer"
                     [attr.title]="('news.openExternal' | translate:{ host: hostOf(item.url) })">
                    @if (item.thumbnail) {
                      <div class="thumb" [style.background-image]="thumbBg(item.thumbnail)">
                        <span class="ch-pill" [class]="'ch-' + item.channel">
                          <span class="ch-icon" [innerHTML]="iconFor(item.channel)"></span>
                          {{ ('news.channels.' + item.channel) | translate }}
                        </span>
                      </div>
                    } @else {
                      <div class="thumb thumb-empty">
                        <span class="ch-pill" [class]="'ch-' + item.channel">
                          <span class="ch-icon" [innerHTML]="iconFor(item.channel)"></span>
                          {{ ('news.channels.' + item.channel) | translate }}
                        </span>
                      </div>
                    }
                    <div class="body">
                      <h3>{{ item.title }}</h3>
                      @if (item.summary && (i === 0 || !item.thumbnail)) {
                        <p>{{ item.summary }}</p>
                      }
                      <div class="foot">
                        <time>{{ relTime(item.publishedAt) }}</time>
                        <span class="src">{{ 'news.via' | translate:{ source: hostOf(item.url) } }} ↗</span>
                      </div>
                    </div>
                  </a>
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
                  <a class="card" [class.has-thumb]="!!item.thumbnail"
                     [attr.data-channel]="item.channel"
                     [href]="item.url" target="_blank" rel="noopener noreferrer">
                    @if (item.thumbnail) {
                      <div class="thumb" [style.background-image]="thumbBg(item.thumbnail)">
                        <span class="ch-pill" [class]="'ch-' + item.channel">
                          <span class="ch-icon" [innerHTML]="iconFor(item.channel)"></span>
                          {{ ('news.channels.' + item.channel) | translate }}
                        </span>
                      </div>
                    } @else {
                      <div class="thumb thumb-empty">
                        <span class="ch-pill" [class]="'ch-' + item.channel">
                          <span class="ch-icon" [innerHTML]="iconFor(item.channel)"></span>
                          {{ ('news.channels.' + item.channel) | translate }}
                        </span>
                      </div>
                    }
                    <div class="body">
                      <h3>{{ item.title }}</h3>
                      <div class="foot">
                        <time>{{ relTime(item.publishedAt) }}</time>
                        <span class="src">{{ hostOf(item.url) }} ↗</span>
                      </div>
                    </div>
                  </a>
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
                    <a class="card" [class.has-thumb]="!!item.thumbnail"
                       [attr.data-channel]="item.channel"
                       [href]="item.url" target="_blank" rel="noopener noreferrer">
                      @if (item.thumbnail) {
                        <div class="thumb" [style.background-image]="thumbBg(item.thumbnail)">
                          <span class="ch-pill" [class]="'ch-' + item.channel">
                            <span class="ch-icon" [innerHTML]="iconFor(item.channel)"></span>
                            {{ ('news.channels.' + item.channel) | translate }}
                          </span>
                        </div>
                      } @else {
                        <div class="thumb thumb-empty">
                          <span class="ch-pill" [class]="'ch-' + item.channel">
                            <span class="ch-icon" [innerHTML]="iconFor(item.channel)"></span>
                            {{ ('news.channels.' + item.channel) | translate }}
                          </span>
                        </div>
                      }
                      <div class="body">
                        <h3>{{ item.title }}</h3>
                        <div class="foot">
                          <time>{{ relTime(item.publishedAt) }}</time>
                          <span class="src">{{ hostOf(item.url) }} ↗</span>
                        </div>
                      </div>
                    </a>
                  }
                </div>
              }
            </section>
          }

          @if (svc.bucketed().today.length === 0 && svc.bucketed().week.length === 0 && svc.bucketed().older.length === 0) {
            <div class="sc-card empty">{{ (hasFilter() ? 'news.emptyFiltered' : 'news.empty') | translate }}</div>
          }
        }
      </div>

      @if (svc.feed()?.fetchedAt; as fetched) {
        <p class="footer-hint">{{ 'news.lastUpdated' | translate:{ rel: relTime(fetched) } }}</p>
      }
    </section>
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
    .card:hover .thumb { transform: scale(1.04); }
    .card .thumb {
      position: relative;
      width: 100%; aspect-ratio: 16 / 9;
      background-color: var(--sc-bg-0);
      background-size: cover; background-position: center;
      transition: transform 0.4s ease;
    }
    .card .thumb-empty {
      background: linear-gradient(135deg, var(--sc-bg-2), var(--sc-bg-0));
    }
    .card .ch-pill {
      position: absolute; top: 8px; left: 8px;
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px; border-radius: 999px;
      font-size: 0.66rem; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase;
      background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent);
      backdrop-filter: blur(6px);
      border: 1px solid var(--sc-border);
    }
    .card .ch-pill .ch-icon { width: 12px; height: 12px; display: inline-flex; }
    .card .ch-pill .ch-icon svg { width: 100%; height: 100%; }
    .card[data-channel="comm-link"] .ch-pill { color: var(--sc-accent); border-color: var(--sc-accent); }
    .card[data-channel="spectrum"] .ch-pill { color: var(--sc-accent-hot); border-color: var(--sc-accent-hot); }
    .card[data-channel="youtube"] .ch-pill { color: var(--sc-danger); border-color: var(--sc-danger); }
    .card[data-channel="patch"] .ch-pill { color: var(--sc-warning); border-color: var(--sc-warning); }

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
    .card.featured .thumb { aspect-ratio: 21 / 9; }
    .card.featured .body h3 { font-size: 1.25rem; font-family: var(--sc-font-display); letter-spacing: 0.02em; -webkit-line-clamp: 3; }
    .card.featured .body p { -webkit-line-clamp: 4; }

    /* ---------- Skeleton ---------- */
    .card.skel { background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; min-height: 180px; }
    .card.skel.featured { min-height: 380px; }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    .empty { text-align: center; color: var(--sc-fg-2); padding: 40px; margin: 16px; }
    .err { color: var(--sc-danger); margin: 16px; padding: 16px; }
    .footer-hint { text-align: center; font-size: 0.72rem; color: var(--sc-fg-2); margin: 0; }
  `],
})
export class NewsListComponent implements OnInit, OnDestroy {
  readonly svc = inject(NewsService);
  private readonly t = inject(TranslateService);

  readonly channels = CHANNELS;
  readonly rsiStatusUrl = RSI_STATUS_URL;
  readonly statusOpen = signal(false);
  readonly olderOpen = signal(false);
  readonly hasFilter = computed(() => this.svc.activeChannels().size > 0);

  ngOnInit() {
    this.svc.refresh();
    this.svc.startPolling();
  }

  ngOnDestroy() {
    this.svc.stopPolling();
  }

  toggleStatus() { this.statusOpen.update((v) => !v); }
  toggleOlder() { this.olderOpen.update((v) => !v); }

  toggleChannel(ch: NewsChannel) { this.svc.toggleChannel(ch); }
  clearFilter() { this.svc.clearFilter(); }
  isActive(ch: NewsChannel): boolean { return this.svc.activeChannels().has(ch); }

  acknowledgeNew() {
    this.svc.acknowledgeNewPosts();
    this.svc.refresh(true);
  }

  thumbBg(url: string): string { return `url("${url.replace(/"/g, '%22')}")`; }

  hostOf(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  relTime(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const diffMs = Date.now() - t;
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
