import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AppDownloadMenuComponent } from '../../desktop/app-download-menu.component';
import { DesktopConnectionService } from '../../desktop/desktop-connection.service';
import { StarscapeComponent } from '../../starscape/starscape.component';
import { VerseBetaService } from '../data/verse-beta.service';
import { VerseHeaderComponent } from '../shared/verse-header.component';

/** Fallback when the release lookup of the download menu fails. */
const STARSCAPE_FALLBACK_URL =
  'https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/wallpaper-app-latest/starscape-wallpaper.exe';

/**
 * `/verse/gallery` — the Starscape gallery. Without a connected Starscape app
 * an app hero leads; once the app has checked in, a mini pill plus a share
 * action replace it. The download stays reachable either way, and every image
 * carries a share button. β off: the bare legacy gallery.
 */
@Component({
  selector: 'sc-verse-gallery',
  standalone: true,
  imports: [RouterLink, TranslatePipe, VerseHeaderComponent, StarscapeComponent, AppDownloadMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (enabled()) {
      <sc-verse-header [title]="'verse.area.gallery' | translate" [subtitle]="'starscape.subtitle' | translate">
        <a vhActions class="sub-link" routerLink="/verse/gallery/constellations">{{ 'verse.gallery.mine' | translate }}</a>
      </sc-verse-header>

      @if (connected()) {
        <div class="mini">
          <span class="pill"><span class="dot" aria-hidden="true"></span>{{ 'verse.gallery.connected' | translate }}</span>
          <button type="button" class="sc-btn" (click)="shareGallery()">{{ 'verse.gallery.share' | translate }}</button>
          @if (hint(); as h) { <span class="hint" role="status">{{ h | translate }}</span> }
          <sc-app-download-menu [product]="'starscape'" [fallbackUrl]="fallbackUrl" />
        </div>
      } @else {
        <section class="hero" [attr.aria-labelledby]="'vg-hero-h'">
          <div class="hero-txt">
            <h2 id="vg-hero-h">{{ 'verse.gallery.heroTitle' | translate }}</h2>
            <p>{{ 'verse.gallery.heroBody' | translate }}</p>
          </div>
          <sc-app-download-menu [product]="'starscape'" [fallbackUrl]="fallbackUrl" />
        </section>
      }

      <sc-starscape [embedded]="true" />
    } @else {
      <sc-starscape />
    }
  `,
  styles: [`
    :host { display: block; }
    .sub-link {
      display: inline-flex; align-items: center; min-height: var(--sc-tap-min); padding: 0 12px;
      border-radius: 999px; border: 1px solid var(--sc-border); color: var(--sc-fg-1); text-decoration: none;
    }
    .sub-link:hover, .sub-link:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); text-decoration: none; }
    .mini { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 14px; }
    .pill {
      display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; border-radius: 999px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1); font-size: max(0.82rem, var(--sc-fs-floor));
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sc-success); }
    .hint { color: var(--sc-fg-2); font-size: max(0.82rem, var(--sc-fs-floor)); }
    .hero {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px;
      padding: 18px 20px; border-radius: 16px; margin-bottom: 16px; border: 1px solid var(--sc-border);
      background: radial-gradient(120% 160% at 100% 0%, color-mix(in srgb, var(--sc-accent) 16%, transparent), var(--sc-bg-1) 60%);
    }
    .hero h2 { margin: 0 0 4px; }
    .hero p { margin: 0; color: var(--sc-fg-2); max-width: var(--sc-measure); }
  `],
})
export class VerseGalleryComponent {
  private readonly connections = inject(DesktopConnectionService);
  readonly enabled = inject(VerseBetaService).isEnabled('gallery');
  protected readonly fallbackUrl = STARSCAPE_FALLBACK_URL;

  readonly connected = computed(() => {
    this.connections.connections();
    return this.connections.stateFor('starscape') === 'connected';
  });
  readonly hint = signal<string | null>(null);

  constructor() {
    void this.connections.refresh();
  }

  async shareGallery(): Promise<void> {
    const url = `${location.origin}/verse/gallery`;
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title: 'Starscape', url });
      } catch {
        /* dismissed */
      }
      return;
    }
    try {
      await nav!.clipboard.writeText(url);
      this.hint.set('starscape.share.copied');
    } catch {
      this.hint.set('starscape.share.failed');
    }
  }
}
