import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { NewsService } from './news.service';

@Component({
  selector: 'sc-news-list',
  standalone: true,
  imports: [DatePipe, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="news-page">
      <header class="head">
        <div>
          <h1>{{ 'news.title' | translate }}</h1>
          <p class="hint">{{ 'news.subtitle' | translate }}</p>
        </div>
        <button class="sc-btn" (click)="reload()" [disabled]="svc.loading()">
          {{ svc.loading() ? ('news.loading' | translate) : ('news.refresh' | translate) }}
        </button>
      </header>

      @if (svc.error(); as err) {
        <div class="sc-card err">
          <strong>{{ 'news.errorTitle' | translate }}:</strong> {{ err }}
        </div>
      }

      @if (svc.feed(); as feed) {
        @if (feed.status) {
          <div class="status-bar sc-card">
            <span class="dot" [class]="feed.status.overall"></span>
            <span class="label">{{ 'news.platformStatus' | translate }}:</span>
            <strong>{{ feed.status.overall }}</strong>
            <span class="time">{{ feed.status.updatedAt | date:'short' }}</span>
          </div>
        }

        <div class="grid">
          @for (item of feed.news; track item.id) {
            <a class="sc-card item" [href]="item.url" target="_blank" rel="noopener noreferrer">
              @if (item.thumbnail) {
                <img class="thumb" [src]="item.thumbnail" [alt]="item.title" loading="lazy" />
              }
              <div class="meta">
                <span class="sc-pill" [class]="channelClass(item.channel)">{{ item.channel }}</span>
                @if (item.category) {
                  <span class="cat">{{ item.category }}</span>
                }
                <time>{{ item.publishedAt | date:'mediumDate' }}</time>
              </div>
              <h3>{{ item.title }}</h3>
              @if (item.summary) {
                <p>{{ item.summary }}</p>
              }
            </a>
          } @empty {
            <div class="sc-card empty">{{ 'news.empty' | translate }}</div>
          }
        </div>
      } @else if (!svc.loading()) {
        <div class="sc-card empty">{{ 'news.empty' | translate }}</div>
      }
    </section>
  `,
  styles: [`
    .news-page { display: flex; flex-direction: column; gap: 20px; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .status-bar {
      display: flex; align-items: center; gap: 12px; padding: 10px 18px;
      font-size: 0.9rem;
    }
    .status-bar .label { color: var(--sc-fg-2); }
    .status-bar .time { margin-left: auto; color: var(--sc-fg-2); font-size: 0.8rem; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--sc-fg-2); }
    .dot.operational { background: var(--sc-success); box-shadow: 0 0 8px var(--sc-success); }
    .dot.degraded, .dot.partial_outage { background: var(--sc-warning); }
    .dot.major_outage { background: var(--sc-danger); }
    .dot.maintenance { background: var(--sc-accent); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .item {
      display: flex; flex-direction: column; gap: 10px;
      color: inherit; text-decoration: none;
      transition: transform 0.18s ease, border-color 0.18s ease;
      &:hover {
        transform: translateY(-2px);
        border-color: var(--sc-accent);
      }
    }
    .item .thumb {
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      border-radius: 4px;
      background: var(--sc-bg-1);
    }
    .item h3 {
      font-size: 1.05rem;
      line-height: 1.3;
      margin: 0;
    }
    .item p {
      color: var(--sc-fg-1);
      font-size: 0.88rem;
      margin: 0;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .meta {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      font-size: 0.75rem;
      color: var(--sc-fg-2);
    }
    .meta time { margin-left: auto; }
    .cat { text-transform: uppercase; letter-spacing: 0.08em; }
    .empty { text-align: center; color: var(--sc-fg-2); padding: 40px; }
    .err { color: var(--sc-danger); }
  `],
})
export class NewsListComponent implements OnInit {
  readonly svc = inject(NewsService);

  ngOnInit() { this.reload(); }
  reload() { this.svc.refresh(); }

  channelClass(channel: string): string {
    switch (channel) {
      case 'status': return 'tech';
      case 'patch': return 'ptu';
      case 'spectrum': return 'live';
      default: return 'tech';
    }
  }
}
