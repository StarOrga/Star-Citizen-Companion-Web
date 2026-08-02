import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';
import { P4kHistoryComponent } from '../p4k/p4k-history.component';
import { AppDownloadEntry, AppDownloadPanelComponent } from './app-download-panel.component';
import { ChannelPickerComponent, ReleaseChannel } from './channel-picker.component';
import { DesktopReleaseService, ReleaseInfo, hashFingerprint } from './desktop-release.service';

/**
 * The Data Uploader's home on the Codex Bridge (admin feedback eb9c6ec3). The
 * uploader used to occupy a permanent top-level nav entry that only
 * collaborators and admins could ever open — a whole menu slot for a tool a
 * handful of people use. It now lives here instead: a single collapsed line on
 * the Codex landing (the Codex *is* what the uploader feeds), which expands into
 * the shared download panel plus a popup for the bundle history.
 *
 * Self-gating like `sc-extension-promo` — renders nothing at all below
 * collaborator, so the public Bridge is unchanged for everyone else. The full
 * `/uploader` page stays reachable (deep links, the in-panel link) and now shows
 * the same panel, so both surfaces look identical.
 */
@Component({
  selector: 'sc-uploader-access',
  standalone: true,
  imports: [
    RouterLink,
    TranslateModule,
    AppDownloadPanelComponent,
    ChannelPickerComponent,
    P4kHistoryComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (roles.isCollaborator()) {
      <div class="ua">
        <button
          type="button"
          class="ua-row"
          (click)="open.set(!open())"
          [attr.aria-expanded]="open()">
          <span class="ua-chev" [class.open]="open()" aria-hidden="true">▸</span>
          <span class="ua-title">{{ 'desktop.access.title' | translate }}</span>
          <span class="ua-hint">{{ 'desktop.access.hint' | translate }}</span>
          @if (version(); as v) { <span class="ua-ver">v{{ v }}</span> }
        </button>

        @if (open()) {
          <div class="ua-body">
            @if (errorMsg(); as e) { <p class="ua-err">{{ e }}</p> }

            <sc-app-download-panel
              icon="⬆"
              title="desktop.appTitle"
              desc="desktop.appDesc"
              [version]="version()"
              [entries]="entries()"
              [busy]="busy()"
              [notes]="notes"
              [releaseNotes]="release()?.notes ?? null">
              <sc-channel-picker panelActions [(channel)]="channel" />
            </sc-app-download-panel>

            <div class="ua-links">
              <button type="button" class="ua-link" (click)="historyOpen.set(true)">
                {{ 'desktop.bundleHistory' | translate }}
              </button>
              <a class="ua-link" routerLink="/uploader">{{ 'desktop.access.fullPage' | translate }}</a>
            </div>
          </div>
        }
      </div>

      @if (historyOpen()) {
        <div class="hx-back" (click)="historyOpen.set(false)">
          <div
            class="hx-dialog"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="'desktop.bundleHistory' | translate"
            (click)="$event.stopPropagation()">
            <div class="hx-head">
              <span class="hx-t">{{ 'desktop.bundleHistory' | translate }}</span>
              <button type="button" class="hx-close" (click)="historyOpen.set(false)"
                      [attr.aria-label]="'desktop.close' | translate">✕</button>
            </div>
            <div class="hx-scroll">
              <sc-p4k-history [embedded]="true" />
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .ua { display: flex; flex-direction: column; }
    .ua-row {
      display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
      width: 100%; text-align: left; cursor: pointer;
      padding: 6px 10px; border-radius: 8px;
      background: transparent; border: 1px dashed color-mix(in srgb, var(--sc-accent-hot) 40%, transparent);
      color: var(--sc-fg-1); font: inherit;
      transition: background 0.16s ease, border-color 0.16s ease;
    }
    .ua-row:hover, .ua-row:focus-visible {
      outline: none;
      border-color: var(--sc-accent-hot);
      background: color-mix(in srgb, var(--sc-accent-hot) 8%, transparent);
    }
    .ua-chev { color: var(--sc-accent-hot); transition: transform 0.16s ease; display: inline-block; }
    .ua-chev.open { transform: rotate(90deg); }
    .ua-title {
      font-family: var(--sc-font-display); font-size: max(0.74rem, var(--sc-fs-floor));
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-accent-hot);
    }
    .ua-hint { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); flex: 1 1 auto; }
    .ua-ver { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }

    .ua-body { display: flex; flex-direction: column; gap: 8px; padding: 8px 0 0; max-width: 560px; }
    .ua-err { margin: 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-danger); }
    .ua-links { display: flex; gap: 14px; flex-wrap: wrap; }
    .ua-link {
      background: transparent; border: 0; padding: 0; cursor: pointer;
      font: inherit; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-accent);
      text-decoration: underline; text-underline-offset: 2px;
    }
    .ua-link:hover { color: var(--sc-accent-hot); }

    /* Bundle history as a popup — it is a deep, occasional lookup, not something
       that should stretch the Codex landing (admin feedback eb9c6ec3). */
    .hx-back {
      position: fixed; inset: 0; z-index: 1200;
      display: flex; align-items: center; justify-content: center; padding: 24px;
      background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px);
    }
    .hx-dialog {
      display: flex; flex-direction: column;
      width: min(1100px, 96vw); max-height: 88vh;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      border-radius: 10px; overflow: hidden;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    }
    .hx-head {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 12px 16px; background: var(--sc-bg-2);
      border-bottom: 1px solid var(--sc-border);
    }
    .hx-t {
      font-family: var(--sc-font-display); font-size: 0.82rem;
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-1);
    }
    .hx-close {
      background: transparent; border: 0; color: var(--sc-fg-2);
      font-size: 1rem; cursor: pointer; padding: 4px;
    }
    .hx-close:hover { color: var(--sc-fg-0); }
    .hx-scroll { overflow-y: auto; padding: 0 4px 4px; }

    @media (max-width: 640px) {
      .hx-back { padding: 8px; }
    }
  `],
})
export class UploaderAccessComponent {
  readonly roles = inject(RoleService);
  private readonly releases = inject(DesktopReleaseService);

  readonly open = signal(false);
  readonly historyOpen = signal(false);
  readonly release = signal<ReleaseInfo | null>(null);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly channel = signal<ReleaseChannel>('stable');

  /** Everything non-essential sits behind the panel's ⓘ toggle. */
  readonly notes = ['desktop.access.note'] as const;

  readonly version = computed(() => this.release()?.version ?? null);

  readonly entries = computed<AppDownloadEntry[]>(() =>
    Object.entries(this.release()?.platforms ?? {}).map(([key, value]) => ({
      key,
      label: key,
      url: value.url,
      sizeBytes: value.size_bytes,
      hash: hashFingerprint(value),
    })),
  );

  constructor() {
    // Only fetch once the panel is actually opened — a collapsed line must not
    // cost the public Codex landing an extra RPC on every visit.
    effect(() => {
      if (this.open()) void this.load(this.channel());
    });
  }

  private async load(channel: ReleaseChannel): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { release, error } = await this.releases.forChannel(channel);
    // Latest-wins: the channel picker re-defaults to the role's top ring right
    // after mount, so two loads race on first open (see desktop-download).
    if (this.channel() !== channel) return;
    if (error) this.errorMsg.set(error);
    else this.release.set(release);
    this.busy.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.historyOpen()) this.historyOpen.set(false);
  }
}
