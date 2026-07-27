import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { AppDownloadEntry, AppDownloadPanelComponent } from './app-download-panel.component';
import { ChannelPickerComponent, ReleaseChannel } from './channel-picker.component';
import { DesktopReleaseService, ReleaseInfo, hashFingerprint } from './desktop-release.service';

/**
 * Minimal, viewer-accessible download surface (`/download`). Unlike `/uploader`
 * (collaborator+, which also reaches the bundle history), this page shows ONLY
 * the desktop-tool download for the caller's allowed channel. Viewers get stable
 * with no picker; collaborators/admins get the role-gated picker. The
 * `desktop_release_for_channel` RPC clamps the channel server-side.
 *
 * Renders the shared `sc-app-download-panel` (admin feedback eb9c6ec3), so all
 * three download surfaces — this one, `/uploader` and Starscape — are the same
 * panel.
 */
@Component({
  selector: 'sc-download',
  standalone: true,
  imports: [DatePipe, TranslateModule, AppDownloadPanelComponent, ChannelPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="dl">
      <header class="u-head">
        <h1>{{ 'download.title' | translate }}</h1>
        <p class="hint">{{ 'download.subtitle' | translate }}</p>
      </header>

      @if (errorMsg()) {
        <div class="err">{{ errorMsg() }}</div>
      }

      <sc-app-download-panel
        icon="⬆"
        title="desktop.appTitle"
        desc="desktop.appDesc"
        [version]="release()?.version ?? null"
        [entries]="entries()"
        [busy]="busy()"
        [notes]="notes"
        [releaseNotes]="release()?.notes ?? null">
        <sc-channel-picker panelActions [(channel)]="channel" />
      </sc-app-download-panel>

      @if (release(); as r) {
        <span class="rel-when">
          {{ 'desktop.released' | translate }} · {{ r.created_at | date: 'mediumDate' }}
        </span>
      }
    </section>
  `,
  styles: [`
    .dl { display: flex; flex-direction: column; gap: 14px; max-width: 620px; }
    .u-head h1 { margin: 0; }
    .u-head .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .err {
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }
    .rel-when {
      color: var(--sc-fg-2); font-size: 0.7rem;
      letter-spacing: 0.06em; text-transform: uppercase;
    }
  `],
})
export class DownloadComponent {
  private readonly releases = inject(DesktopReleaseService);

  readonly release = signal<ReleaseInfo | null>(null);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly channel = signal<ReleaseChannel>('stable');

  readonly notes = ['desktop.access.note'] as const;

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
    effect(() => {
      void this.load(this.channel());
    });
  }

  private async load(channel: ReleaseChannel): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { release, error } = await this.releases.forChannel(channel);
    if (this.channel() !== channel) return;
    if (error) this.errorMsg.set(error);
    else this.release.set(release);
    this.busy.set(false);
  }
}
