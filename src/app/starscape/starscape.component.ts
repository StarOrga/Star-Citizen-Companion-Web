import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { StarscapeService, Wallpaper } from './starscape.service';

/**
 * Starscape (#133) — high-res wallpaper gallery from crawled RSI news imagery.
 * Masonry grid of CDN previews; the lightbox and the download button use the
 * ORIGINAL full-res RSI url (we host no image bytes — hotlinks + attribution).
 */
@Component({
  selector: 'sc-starscape',
  standalone: true,
  imports: [TranslateModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'starscape.title' | translate }}</h1>
          <p class="hint">{{ 'starscape.subtitle' | translate }}</p>
        </div>
        <a
          class="app-cta"
          [href]="appDownloadUrl"
          target="_blank"
          rel="noopener noreferrer"
          download>
          <span class="app-cta-title">🖥️ {{ 'starscape.appTitle' | translate }}</span>
          <span class="app-cta-desc">{{ 'starscape.appDesc' | translate }}</span>
          <span class="app-cta-dl">↓ {{ 'starscape.appDownload' | translate }}</span>
          <span class="app-cta-note">{{ 'starscape.appNote' | translate }}</span>
        </a>
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

      <div class="wall">
        @for (w of svc.wallpapers(); track w.imageId) {
          <button type="button" class="tile" (click)="open(w)" [attr.aria-label]="w.title">
            <img
              [src]="w.previewUrl"
              [alt]="w.title ?? ''"
              loading="lazy"
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
    .app-cta-dl {
      margin-top: 4px; align-self: flex-start;
      padding: 3px 10px; border-radius: 999px; font-size: 0.74rem;
      color: var(--sc-accent); border: 1px solid var(--sc-accent);
    }
    .app-cta:hover .app-cta-dl { background: var(--sc-accent); color: var(--sc-bg-0); }
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
  `],
})
export class StarscapeComponent implements OnInit {
  readonly svc = inject(StarscapeService);

  /**
   * Direct download of the native desktop wallpaper app (published to the public
   * binaries mirror by the `wallpaper-app` CI workflow on a `wallpaper-app-v*`
   * tag). Bump the version segment when a newer release ships.
   */
  readonly appDownloadUrl =
    'https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/wallpaper-app-v0.1.0/starscape-wallpaper-0.1.0.exe';

  readonly active = signal<Wallpaper | null>(null);
  readonly broken = signal<ReadonlySet<string>>(new Set<string>());

  async ngOnInit(): Promise<void> {
    if (this.svc.wallpapers().length === 0) await this.svc.load(true);
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
