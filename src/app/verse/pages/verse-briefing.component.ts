import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Params, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';
import { NewsListComponent } from '../../news/news-list.component';
import { NewsService } from '../../news/news.service';
import { VerseApiService } from '../data/verse-api.service';
import { VerseBetaService } from '../data/verse-beta.service';
import { VerseDigestItem, VerseDoor } from '../data/verse.models';
import { VerseHeaderComponent } from '../shared/verse-header.component';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** An item's link, split for `[routerLink]` (in-app) or `[href]` (external). */
export interface VerseItemLink {
  internal: boolean;
  path: string;
  query: Params | null;
}

export function verseItemLink(url: string | null): VerseItemLink | null {
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) {
    const u = new URL(url, 'https://x.invalid');
    const query: Params = {};
    u.searchParams.forEach((v, k) => (query[k] = v));
    return { internal: true, path: u.pathname, query: Object.keys(query).length ? query : null };
  }
  return /^https:\/\//.test(url) ? { internal: false, path: url, query: null } : null;
}

interface Gate {
  door: VerseDoor;
  link: string;
  count: number;
  total: number | null;
}

/**
 * `/verse` — the briefing. A guided hero (headline → "for you" line → one
 * call to action), the adaptive 3–7 top list and the three jump gates. β off:
 * the legacy landing (the Verse News list) renders instead.
 */
@Component({
  selector: 'sc-verse-briefing',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet, TranslatePipe, VerseHeaderComponent, NewsListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (enabled()) {
      <sc-verse-header [root]="true" [eyebrow]="'verse.crumb' | translate"
                       [rememberAs]="'verse.crumb' | translate" />

      @if (api.digestState() === 'error' && !api.digest()) {
        <div class="sc-card err" role="alert">
          <span>{{ (api.digestError() ?? 'errors.generic') | translate }}</span>
          <button type="button" class="sc-btn" (click)="reload()">{{ 'errors.retry' | translate }}</button>
        </div>
      } @else {
        <section class="hero" [attr.aria-labelledby]="'verse-hero-h'">
          <h1 id="verse-hero-h">{{ cta()?.item?.title ?? ('verse.briefing.headlineQuiet' | translate) }}</h1>
          <p class="for-you">
            <span class="fy-label">{{ 'verse.briefing.forYou' | translate }}</span>
            {{ (unseen() ? 'verse.briefing.unseen' : 'verse.briefing.allSeen') | translate:{ n: unseen() } }}
            @if (api.digest()?.patch; as p) { · {{ 'verse.briefing.patchLine' | translate:{ line: p.line } }} }
          </p>
          @if (cta(); as c) {
            @if (c.link.internal) {
              <a class="sc-btn sc-btn-primary cta" [routerLink]="c.link.path" [queryParams]="c.link.query"
                 (click)="openItem(c.item)" (auxclick)="openItem(c.item)">{{ 'verse.briefing.cta' | translate }}</a>
            } @else {
              <a class="sc-btn sc-btn-primary cta" [href]="c.link.path" target="_blank" rel="noopener noreferrer"
                 (click)="openItem(c.item)" (auxclick)="openItem(c.item)">{{ 'verse.briefing.cta' | translate }}</a>
            }
          }
        </section>

        <section class="top" [attr.aria-label]="'verse.briefing.topAria' | translate">
          @if (api.digestState() === 'loading' && !api.digest()) {
            <ol class="list sk" aria-hidden="true">
              @for (n of [0, 1, 2]; track n) { <li class="item sc-skel-field"></li> }
            </ol>
          } @else if (top().length === 0) {
            <p class="empty">{{ 'verse.briefing.empty' | translate }}</p>
          } @else {
            <ol class="list">
              @for (it of top(); track it.key; let i = $index) {
                <li>
                  @if (link(it); as l) {
                    @if (l.internal) {
                      <a class="item" [class.seen]="api.seen().has(it.key)" [routerLink]="l.path" [queryParams]="l.query"
                         (click)="openItem(it)" (auxclick)="openItem(it)">
                        <ng-container *ngTemplateOutlet="body; context: { $implicit: it, i: i }" />
                      </a>
                    } @else {
                      <a class="item" [class.seen]="api.seen().has(it.key)" [href]="l.path" target="_blank" rel="noopener noreferrer"
                         (click)="openItem(it)" (auxclick)="openItem(it)">
                        <ng-container *ngTemplateOutlet="body; context: { $implicit: it, i: i }" />
                      </a>
                    }
                  }
                </li>
              }
            </ol>
          }
        </section>

        <nav class="gates" [attr.aria-label]="'verse.gates.aria' | translate">
          @for (g of gates(); track g.door) {
            <a class="gate" [attr.data-door]="g.door" [routerLink]="g.link" (click)="openDoor(g.door)" (auxclick)="openDoor(g.door)">
              <span class="ring" aria-hidden="true"></span>
              <b>{{ ('verse.gates.' + g.door + '.title') | translate }}</b>
              <span class="stat">{{ ('verse.gates.' + g.door + '.stat') | translate:{ n: g.count } }}
                @if (g.total !== null) { <small>{{ 'verse.gates.total' | translate:{ n: g.total } }}</small> }
              </span>
              <em>{{ ('verse.gates.' + g.door + '.teaser') | translate }}</em>
            </a>
          }
        </nav>
      }

      <ng-template #body let-it let-i="i">
        <span class="rank" aria-hidden="true">{{ i + 1 }}</span>
        <span class="txt">
          <span class="kind">{{ ('verse.kind.' + it.kind) | translate }}@if (it.pinned) { · {{ 'verse.briefing.pinned' | translate }} }</span>
          <b>{{ it.title }}</b>
          @if (it.summary) { <span class="sum">{{ it.summary }}</span> }
        </span>
        @if (it.image) { <img class="thumb" [src]="it.image" alt="" loading="lazy" decoding="async" /> }
      </ng-template>
    } @else {
      <sc-news-list />
    }
  `,
  styles: [`
    :host { display: block; }
    .err { display: flex; gap: 12px; align-items: center; justify-content: space-between; }
    .hero {
      display: grid; gap: 10px; padding: 22px 22px 24px; border-radius: 16px; margin-bottom: 18px;
      background: radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--sc-accent) 16%, transparent), var(--sc-bg-1) 60%);
      border: 1px solid var(--sc-border);
    }
    .hero h1 { margin: 0; max-width: var(--sc-measure); }
    .for-you { margin: 0; color: var(--sc-fg-1); max-width: var(--sc-measure); }
    .fy-label {
      font-family: var(--sc-font-display); color: var(--sc-accent); text-transform: uppercase;
      letter-spacing: 0.12em; font-size: max(0.72rem, var(--sc-fs-floor)); margin-right: 8px;
    }
    .cta { justify-self: start; margin-top: 4px; }
    .list { list-style: none; margin: 0 0 22px; padding: 0; display: grid; gap: 8px; }
    .list.sk .item { height: 64px; border-radius: 12px; }
    .item {
      display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 12px; align-items: center;
      padding: 12px 14px; border-radius: 12px; color: inherit; text-decoration: none;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      transition: border-color 0.16s, background 0.16s;
    }
    .item:hover, .item:focus-visible { border-color: var(--sc-accent); text-decoration: none; }
    .item:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .item.seen { opacity: 0.72; }
    .rank { font-family: var(--sc-font-display); color: var(--sc-fg-2); text-align: center; }
    .txt { display: grid; gap: 2px; min-width: 0; }
    .kind { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.08em; }
    .txt b { overflow: hidden; text-overflow: ellipsis; }
    .sum {
      color: var(--sc-fg-2); font-size: max(0.84rem, var(--sc-fs-floor));
      display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
    }
    .thumb { width: 72px; height: 44px; object-fit: cover; border-radius: 8px; }
    .empty { color: var(--sc-fg-2); }
    .gates { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .gate {
      position: relative; display: grid; gap: 4px; padding: 16px 16px 16px 76px; min-height: 96px;
      border-radius: 14px; color: inherit; text-decoration: none; overflow: hidden;
      background: linear-gradient(100deg, color-mix(in srgb, var(--sc-accent) 10%, transparent), var(--sc-bg-1) 55%);
      border: 1px solid var(--sc-border); transition: border-color 0.16s, transform 0.16s;
    }
    .gate:hover, .gate:focus-visible { border-color: var(--sc-accent); text-decoration: none; transform: translateY(-1px); }
    .gate:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .ring {
      position: absolute; left: 16px; top: 50%; width: 44px; height: 44px; margin-top: -22px; border-radius: 50%;
      border: 2px solid color-mix(in srgb, var(--sc-accent) 60%, transparent);
      box-shadow: inset 0 0 12px color-mix(in srgb, var(--sc-accent) 30%, transparent);
    }
    .gate b::after { content: '  ⟶'; color: var(--sc-accent); }
    .stat { color: var(--sc-accent); font-family: var(--sc-font-display); font-size: max(0.84rem, var(--sc-fs-floor)); }
    .stat small { color: var(--sc-fg-2); font-family: var(--sc-font-body); margin-left: 6px; }
    .gate em { font-style: normal; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
    @media (max-width: 760px) {
      .gates { grid-template-columns: minmax(0, 1fr); }
      .thumb { display: none; }
      .item { grid-template-columns: 22px minmax(0, 1fr); }
      .hero { padding: 16px; }
    }
    @media (prefers-reduced-motion: reduce) { .gate, .item { transition: none; } .gate:hover { transform: none; } }
  `],
})
export class VerseBriefingComponent {
  protected readonly api = inject(VerseApiService);
  private readonly news = inject(NewsService);
  private readonly analytics = inject(AnalyticsService);
  readonly enabled = inject(VerseBetaService).isEnabled('briefing');

  readonly top = this.api.topItems;

  /** First unseen entry — the one the call to action opens. */
  readonly cta = computed(() => {
    const items = this.top();
    const item = items.find((i) => !this.api.seen().has(i.key)) ?? items[0];
    const link = item ? verseItemLink(item.url) : null;
    return item && link ? { item, link } : null;
  });

  readonly unseen = computed(() => this.top().filter((i) => !this.api.seen().has(i.key)).length);

  /** News count from the digest; the live feed fills in while news_cache is empty. */
  readonly gates = computed<Gate[]>(() => {
    const counts = this.api.digest()?.counts;
    const now = Date.now();
    const feedRecent = this.news
      .stream()
      .filter((i) => now - Date.parse(i.publishedAt) <= WEEK_MS).length;
    const newsRecent = counts?.news.recent || feedRecent;
    const newsTotal = counts?.news.total ?? (this.news.streamCount() || null);
    return [
      { door: 'news', link: '/verse/news', count: newsRecent, total: newsTotal },
      {
        door: 'patches',
        link: '/verse/patches',
        count: counts?.patches.recent ?? 0,
        total: counts?.patches.total ?? (this.news.patchLines().filter((g) => g.line).length || null),
      },
      { door: 'gallery', link: '/verse/gallery', count: counts?.gallery.recent ?? 0, total: counts?.gallery.total ?? null },
    ];
  });

  constructor() {
    if (this.api.digestState() === 'idle') void this.api.loadDigest();
    void this.api.loadSeen();
    if (!this.news.feed() && !this.news.loading()) void this.news.refresh(true);
  }

  protected link(item: VerseDigestItem): VerseItemLink | null {
    return verseItemLink(item.url);
  }

  reload(): void {
    void this.api.loadDigest();
  }

  openItem(item: VerseDigestItem): void {
    void this.api.markSeen([item.key]);
    this.analytics.captureVerse('verse_top_open', {
      key: item.key,
      kind: item.kind,
      rank: item.rank,
      pinned: item.pinned,
    });
  }

  openDoor(door: VerseDoor): void {
    this.analytics.captureVerse('verse_door_open', { door });
  }
}
