import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { channelIconSvg } from '../../news/channel-icons';
import { NewsThumbComponent } from '../../news/news-thumb.component';
import { NewsService } from '../../news/news.service';
import { OverlayFrameComponent, OverlayNeighbour } from '../../shared/overlay-frame/overlay-frame.component';
import { OverlayOriginService } from '../../shared/overlay-frame/overlay-origin.service';
import { ShareButtonComponent } from '../../shared/share-button/share-button.component';

/**
 * `/verse/news/:id` - one news item. Opened from the stream it lays over the
 * list as an overlay; a direct load / refresh / shared link renders the same
 * content as a full page. Back closes. (implement.md §9)
 */
@Component({
  selector: 'sc-verse-news-item',
  standalone: true,
  imports: [TranslatePipe, OverlayFrameComponent, NewsThumbComponent, ShareButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (item(); as it) {
      <sc-overlay-frame [heading]="it.title" [prev]="prev()" [next]="next()" (closed)="close()">
        <article class="item">
          <sc-news-thumb
            [images]="images()"
            [channel]="it.channel"
            [channelLabel]="('news.channels.' + it.channel) | translate"
            [channelIcon]="icon()"
            [featured]="true" />
          <p class="meta">{{ ('news.channels.' + it.channel) | translate }} · <time [attr.datetime]="it.publishedAt">{{ when() }}</time></p>
          @if (it.summary) { <p class="sum">{{ it.summary }}</p> }
          <h3 id="read-more" class="sc-sr-only">{{ 'overlay.news.source' | translate }}</h3>
          <a class="sc-btn primary" [href]="it.url" target="_blank" rel="noopener noreferrer">
            {{ 'news.openExternal' | translate: { host: host() } }} ↗
          </a>
        </article>
      </sc-overlay-frame>
      <sc-share-button [shareTitle]="it.title" />
    } @else if (loaded()) {
      <p class="miss" role="status">{{ 'overlay.news.missing' | translate }}</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .item { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
    .item sc-news-thumb { align-self: stretch; }
    .meta { margin: 0; color: var(--sc-fg-2); font-size: max(0.85rem, var(--sc-fs-floor)); }
    .sum { margin: 0; max-width: var(--sc-measure); color: var(--sc-fg-1); }
    .miss { color: var(--sc-fg-2); }
  `],
})
export class VerseNewsItemComponent {
  private readonly svc = inject(NewsService);
  private readonly router = inject(Router);
  private readonly origin = inject(OverlayOriginService);
  private readonly i18n = inject(TranslateService);

  /** Route param `:id` (component input binding). */
  readonly id = input.required<string>();

  protected readonly loaded = computed(() => this.svc.feed() !== null);
  private readonly list = computed(() => this.svc.feed()?.news ?? []);
  protected readonly item = computed(() => this.list().find((n) => n.id === this.id()) ?? null);

  protected readonly images = computed(() => {
    const it = this.item();
    if (!it) return [];
    return it.images?.length ? it.images : it.thumbnail ? [it.thumbnail] : [];
  });
  protected readonly icon = computed(() => channelIconSvg(this.item()?.channel ?? 'patch'));
  protected readonly host = computed(() => {
    try {
      return new URL(this.item()?.url ?? '').hostname.replace(/^www\./, '');
    } catch {
      return this.item()?.url ?? '';
    }
  });
  protected readonly when = computed(() => {
    const it = this.item();
    if (!it) return '';
    return new Date(it.publishedAt).toLocaleDateString(this.i18n.getCurrentLang() || undefined, { dateStyle: 'medium' });
  });

  protected readonly prev = computed<OverlayNeighbour | null>(() => this.neighbour(-1));
  protected readonly next = computed<OverlayNeighbour | null>(() => this.neighbour(1));

  constructor() {
    void this.svc.refresh(true);
    inject(DestroyRef).onDestroy(() => this.origin.reset());
  }

  private neighbour(step: number): OverlayNeighbour | null {
    const list = this.list();
    const i = list.findIndex((n) => n.id === this.id());
    const n = i < 0 ? undefined : list[i + step];
    return n ? { commands: ['/verse/news', n.id] } : null;
  }

  protected close(): void {
    this.origin.reset();
    void this.router.navigate(['/verse/news']);
  }
}
