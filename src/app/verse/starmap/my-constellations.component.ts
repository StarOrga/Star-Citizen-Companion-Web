import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { AnalyticsService } from '../../core/analytics.service';
import { logWarn } from '../../core/log';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { VerseHeaderComponent } from '../shared/verse-header.component';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseExplorerPatch } from '../data/verse.models';
import { downloadBlob, renderConstellationPng, renderConstellationWallpaper } from './constellation-render';
import { wallpaperConstellations } from './explorer-page.component';

const THUMB = { width: 480, height: 270 } as const;

/**
 * "Meine Sternbilder": every earned constellation wallpaper (7 stars), newest
 * first, auto-added — the full scrollable list (the Starscape app shows the last
 * 7). Each card downloads the 4K PNG or shares it.
 */
@Component({
  selector: 'sc-my-constellations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, ScTooltipDirective, VerseHeaderComponent],
  template: `
    <sc-verse-header
      [trail]="[{ labelKey: 'starmap.gallery.crumb', link: '/verse/gallery' }]"
      [title]="'starmap.gallery.title' | translate"
      [subtitle]="'starmap.gallery.subtitle' | translate" />

    @if (!signedIn()) {
      <p class="note">{{ 'starmap.signedOut' | translate }}
        <a routerLink="/login" [queryParams]="{ redirect: '/verse/gallery/constellations' }">{{ 'starmap.signIn' | translate }}</a></p>
    } @else if (api.explorerState() === 'error') {
      <p class="note" role="alert">{{ (api.explorerError() ?? 'errors.generic') | translate }}
        <button type="button" class="btn" (click)="reload()">{{ 'errors.retry' | translate }}</button></p>
    } @else if (!api.explorer()) {
      <p class="note" aria-busy="true">{{ 'starmap.loading' | translate }}</p>
    } @else if (earned().length === 0) {
      <p class="note">{{ 'starmap.gallery.empty' | translate }} <a routerLink="/verse/explorer">{{ 'starmap.gallery.toMap' | translate }}</a></p>
    } @else {
      <p class="muted">{{ 'starmap.gallery.appHint' | translate }}</p>
      <ul class="list">
        @for (p of earned(); track p.patchLine; let i = $index) {
          <li class="card">
            <canvas #thumb [attr.data-index]="i" [width]="thumb.width" [height]="thumb.height" role="img"
                    [attr.aria-label]="'starmap.gallery.thumbAria' | translate: { patch: p.patchLine }"></canvas>
            <div class="meta">
              <strong>{{ p.patchLine }}</strong>
              @if (i < 7) { <span class="muted small">{{ 'starmap.gallery.inApp' | translate }}</span> }
              <span class="spacer"></span>
              <button type="button" class="btn" [disabled]="busy() === p.patchLine" (click)="download(p)">
                {{ 'starmap.gallery.download' | translate }}
              </button>
              <button type="button" class="btn icon" [attr.aria-label]="'starmap.gallery.share' | translate"
                      [scTooltip]="'starmap.gallery.share' | translate" scTooltipTier="label" (click)="share(p)">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <circle cx="18" cy="5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="19" r="2.6" />
                  <path d="M8.3 10.8 15.7 6.3M8.3 13.2l7.4 4.5" />
                </svg>
              </button>
            </div>
          </li>
        }
      </ul>
      @if (status()) { <p class="muted" role="status">{{ status()! | translate }}</p> }
    }
  `,
  styles: [
    `
      :host { display: block; }
      .note { display: flex; gap: var(--sc-gap-2); align-items: center; flex-wrap: wrap; }
      .muted { color: var(--sc-fg-2); }
      .small { font-size: 0.75rem; }
      .list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sc-gap-3);
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
      .card { background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 12px; overflow: hidden; }
      canvas { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; background: var(--sc-bg-0); }
      .meta { display: flex; gap: var(--sc-gap-2); align-items: center; padding: var(--sc-pad-2); flex-wrap: wrap; }
      .meta strong { font: 600 1rem var(--sc-font-display); }
      .spacer { flex: 1; }
      .btn { display: inline-flex; align-items: center; justify-content: center; min-height: var(--sc-tap-min, 44px); padding: 0 var(--sc-pad-2);
        border-radius: 8px; border: 1px solid var(--sc-border); background: var(--sc-bg-2); color: var(--sc-fg-0); font: inherit; cursor: pointer; }
      .btn.icon { min-width: var(--sc-tap-min, 44px); padding: 0; }
      .btn:hover { border-color: var(--sc-accent); }
      .btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .btn svg { fill: currentColor; stroke: currentColor; stroke-width: 1.6; }
    `,
  ],
})
export class MyConstellationsComponent implements AfterViewInit {
  readonly api = inject(VerseApiService);
  private readonly auth = inject(AuthService);
  private readonly analytics = inject(AnalyticsService);

  readonly thumb = THUMB;
  readonly signedIn = this.auth.isAuthenticated;
  /** Patches whose wallpaper is earned (7 stars), newest first. */
  readonly earned = computed(() => (this.api.explorer()?.patches ?? []).filter((p) => p.unlocks.wallpaper));
  readonly busy = signal<string | null>(null);
  readonly status = signal<string | null>(null);
  private readonly thumbs = viewChildren<ElementRef<HTMLCanvasElement>>('thumb');
  private readonly viewReady = signal(false);

  constructor() {
    effect(() => {
      if (this.signedIn() && this.api.explorerState() === 'idle') void this.api.loadExplorer();
    });
    effect(() => {
      if (!this.viewReady()) return;
      const list = this.earned();
      for (const ref of this.thumbs()) {
        const i = Number(ref.nativeElement.dataset['index']);
        const p = list[i];
        const ctx = p ? ref.nativeElement.getContext('2d') : null;
        if (p && ctx) renderConstellationWallpaper(ctx, { ...THUMB, ...this.options(p) });
      }
    });
  }

  ngAfterViewInit(): void {
    this.viewReady.set(true);
  }

  reload(): void {
    void this.api.loadExplorer();
  }

  private options(p: VerseExplorerPatch) {
    const st = this.api.explorer()!;
    return {
      seed: p.patchLine,
      constellations: wallpaperConstellations(st, p),
      nebula: st.rewards.nebula,
      road: st.rewards.road,
    };
  }

  private png(p: VerseExplorerPatch): Promise<Blob> {
    return renderConstellationPng(this.options(p));
  }

  async download(p: VerseExplorerPatch): Promise<void> {
    this.busy.set(p.patchLine);
    this.status.set(null);
    try {
      downloadBlob(await this.png(p), `sc-constellation-${p.patchLine}-4k.png`);
    } catch (err) {
      logWarn('starmap', 'download failed', err);
      this.status.set('starmap.export.failed');
    } finally {
      this.busy.set(null);
    }
  }

  async share(p: VerseExplorerPatch): Promise<void> {
    this.status.set(null);
    const url = `${location.origin}/verse/explorer`;
    try {
      const file = new File([await this.png(p)], `sc-constellation-${p.patchLine}.png`, { type: 'image/png' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `SC Companion · ${p.patchLine}`, url });
        this.analytics.captureVerse('starscape_share', { image_id: `constellation-${p.patchLine}`, channel: 'native' });
      } else {
        await navigator.clipboard.writeText(url);
        this.analytics.captureVerse('starscape_share', { image_id: `constellation-${p.patchLine}`, channel: 'copy' });
        this.status.set('starmap.gallery.copied');
      }
    } catch {
      /* the user dismissed the share sheet, or the clipboard is unavailable */
    }
  }
}
