import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

/** One download button in the panel — a platform asset or a release ring. */
export interface AppDownloadEntry {
  /** Stable track key (ring name or platform key). */
  key: string;
  /** Literal button label (e.g. a platform id like `win-x64`). */
  label?: string;
  /** i18n key for the button label — takes precedence over `label` (rings). */
  labelKey?: string;
  url: string;
  /** Per-entry version, shown as a badge when the entries differ (rings). */
  version?: string | null;
  sizeBytes?: number | null;
  /** Short hash fingerprint, surfaced in the tooltip only. */
  hash?: string | null;
  /** Quieter styling for anything that is not the safe default. */
  secondary?: boolean;
}

/**
 * The one download panel both desktop apps use — Starscape (wallpaper tray app)
 * and the Data Uploader. Before this, each app had its own bespoke block: a
 * tinted CTA card in the Starscape header vs. a full-width release table on the
 * Data-Upload page, so the two never read as parts of the same product family
 * (admin feedback eb9c6ec3: "pass gern die beiden Apps an, dass die Panels
 * gleich aussehen! Die dürfen gern minimalistisch sein, und alles weitere
 * hinter Tooltips etc.").
 *
 * The visible surface is deliberately thin — icon, name, version, download
 * button(s). Size and hash live in each button's tooltip; release notes and the
 * platform/ring footnotes live behind the ⓘ toggle. Hosts project their own
 * controls (e.g. the channel picker) into `[panelActions]`.
 */
@Component({
  selector: 'sc-app-download-panel',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ap">
      <div class="ap-head">
        <span class="ap-icon" aria-hidden="true">{{ icon() }}</span>
        <span class="ap-id">
          <span class="ap-title">{{ title() | translate }}</span>
          <span class="ap-desc">{{ desc() | translate }}</span>
        </span>
        @if (version(); as v) {
          <span class="ap-ver" [title]="'appPanel.version' | translate">v{{ v }}</span>
        }
        <span class="ap-actions"><ng-content select="[panelActions]" /></span>
        @if (hasDetails()) {
          <button
            type="button"
            class="ap-info"
            [class.open]="infoOpen()"
            (click)="infoOpen.set(!infoOpen())"
            [attr.aria-expanded]="infoOpen()"
            [attr.aria-label]="'appPanel.details' | translate"
            [title]="'appPanel.details' | translate">ⓘ</button>
        }
      </div>

      @if (entries().length > 0) {
        <div class="ap-dl">
          @for (e of entries(); track e.key) {
            <a
              class="ap-btn"
              [class.secondary]="e.secondary"
              [href]="e.url"
              [title]="tooltip(e)"
              target="_blank"
              rel="noopener noreferrer"
              download>
              <span class="ap-arrow" aria-hidden="true">↓</span>
              <span class="ap-label">{{ e.labelKey ? (e.labelKey | translate) : e.label }}</span>
              @if (e.version) { <span class="ap-btn-ver">v{{ e.version }}</span> }
            </a>
          }
        </div>
      } @else if (busy()) {
        <p class="ap-state">{{ 'desktop.loading' | translate }}</p>
      } @else {
        <p class="ap-state">{{ 'desktop.noRelease' | translate }}</p>
      }

      @if (infoOpen()) {
        <div class="ap-details">
          @for (n of notes(); track n) {
            <p class="ap-note">{{ n | translate }}</p>
          }
          @if (releaseNotes(); as rn) {
            <span class="ap-rn-label">{{ 'desktop.notes' | translate }}</span>
            <pre class="ap-rn">{{ rn }}</pre>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ap {
      display: flex; flex-direction: column; gap: 10px;
      padding: 12px 14px; border-radius: 10px;
      border: 1px solid var(--sc-border);
      background: color-mix(in srgb, var(--sc-accent) 6%, var(--sc-bg-1));
    }
    .ap-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ap-icon { font-size: 1rem; line-height: 1; }
    .ap-id { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 200px; }
    .ap-title {
      font-family: var(--sc-font-display); font-size: 0.86rem;
      color: var(--sc-fg-0); letter-spacing: 0.02em;
    }
    .ap-desc { font-size: 0.72rem; color: var(--sc-fg-2); line-height: 1.35; }
    .ap-ver {
      font-family: var(--sc-font-display); font-size: 0.78rem;
      color: var(--sc-accent); font-variant-numeric: tabular-nums;
    }
    .ap-actions:empty { display: none; }
    .ap-info {
      background: transparent; border: 0; cursor: pointer; padding: 2px 4px;
      color: var(--sc-fg-2); font-size: 0.9rem; line-height: 1;
      transition: color 0.16s ease;
    }
    .ap-info:hover, .ap-info.open, .ap-info:focus-visible { color: var(--sc-accent); outline: none; }

    .ap-dl { display: flex; flex-wrap: wrap; gap: 6px; }
    .ap-btn {
      display: inline-flex; align-items: baseline; gap: 6px;
      padding: 4px 12px; border-radius: 999px;
      font-size: 0.76rem; white-space: nowrap; text-decoration: none;
      color: var(--sc-accent); border: 1px solid var(--sc-accent);
      transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease;
    }
    .ap-btn:hover { background: var(--sc-accent); color: var(--sc-bg-0); }
    /* Pre-release rings / secondary platforms stay quieter than the safe default. */
    .ap-btn.secondary { color: var(--sc-fg-2); border-color: var(--sc-border); }
    .ap-btn.secondary:hover { background: var(--sc-bg-2); color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .ap-btn-ver { font-size: 0.68rem; opacity: 0.8; font-variant-numeric: tabular-nums; }

    .ap-state { margin: 0; font-size: 0.74rem; color: var(--sc-fg-2); }

    .ap-details {
      display: flex; flex-direction: column; gap: 6px;
      padding-top: 8px; border-top: 1px solid var(--sc-border);
    }
    .ap-note { margin: 0; font-size: 0.66rem; color: var(--sc-fg-2); line-height: 1.45; }
    .ap-rn-label {
      color: var(--sc-fg-2); font-family: var(--sc-font-display);
      font-size: 0.62rem; letter-spacing: 0.08em; text-transform: uppercase;
    }
    .ap-rn {
      margin: 0; padding: 0; background: none; border: 0;
      color: var(--sc-fg-2); font-family: inherit; font-size: 0.74rem; line-height: 1.5;
      white-space: pre-wrap; max-height: 200px; overflow-y: auto;
    }
  `],
})
export class AppDownloadPanelComponent {
  private readonly i18n = inject(TranslateService);

  /** Small glyph identifying the app (🖥️ Starscape, ⬆ Uploader). */
  readonly icon = input('🖥️');
  /** i18n key for the app name. */
  readonly title = input.required<string>();
  /** i18n key for the one-line description. */
  readonly desc = input.required<string>();
  /** Headline version, when a single one applies to the whole panel. */
  readonly version = input<string | null>(null);
  readonly entries = input<readonly AppDownloadEntry[]>([]);
  readonly busy = input(false);
  /** i18n keys shown behind the ⓘ toggle (platform notes, ring lock, updates). */
  readonly notes = input<readonly string[]>([]);
  /** Raw release notes of the shown build, also behind the ⓘ toggle. */
  readonly releaseNotes = input<string | null>(null);

  readonly infoOpen = signal(false);

  hasDetails(): boolean {
    return this.notes().length > 0 || !!this.releaseNotes();
  }

  /** Size + hash never take visible space — they live in the button tooltip. */
  tooltip(e: AppDownloadEntry): string {
    const label = e.labelKey ? this.i18n.instant(e.labelKey) : (e.label ?? e.key);
    const parts: string[] = [label];
    if (e.sizeBytes) parts.push(`${(e.sizeBytes / 1024 / 1024).toFixed(1)} MB`);
    if (e.hash) parts.push(`${e.hash}…`);
    return parts.join(' · ');
  }
}
