import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ChannelPickerComponent, ReleaseChannel } from './channel-picker.component';

interface PlatformAsset {
  url: string;
  size_bytes: number;
  sha512?: string | null;
  sha256?: string | null;
}

interface ReleaseInfo {
  version: string;
  platforms: Record<string, PlatformAsset>;
  notes: string | null;
  created_at: string;
}

/**
 * Minimal, viewer-accessible download surface (`/download`). Unlike `/uploader`
 * (collaborator+, which also embeds the bundle-upload history), this page shows
 * ONLY the desktop-tool download for the caller's allowed channel. Viewers get
 * stable with no picker; collaborators/admins get the role-gated picker. The
 * `desktop_release_for_channel` RPC clamps the channel server-side.
 */
@Component({
  selector: 'sc-download',
  standalone: true,
  imports: [DatePipe, DecimalPipe, TranslateModule, ChannelPickerComponent],
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

      <div class="sc-card panel">
        <div class="sec-head">
          <span class="t">{{ 'desktop.currentVersion' | translate }}</span>
          <sc-channel-picker [(channel)]="channel" />
        </div>

        @if (release(); as r) {
          <div class="release">
            <div class="rel-ver">
              <span class="v">v{{ r.version }}</span>
              <span class="d">{{ 'desktop.released' | translate }} · {{ r.created_at | date:'mediumDate' }}</span>
            </div>
            <div class="rel-dl">
              @for (entry of platformEntries(r); track entry.key) {
                <a class="sc-btn sc-btn-primary dl-btn" [href]="entry.value.url" download>
                  <span class="l">{{ 'desktop.downloadFor' | translate:{ platform: entry.key } }}</span>
                  <span class="m">
                    {{ entry.value.size_bytes / 1024 / 1024 | number:'1.0-1' }} MB
                    @if (hashFingerprint(entry.value); as h) {
                      · <span class="hash">{{ h }}…</span>
                    }
                  </span>
                </a>
              }
            </div>
          </div>
          @if (r.notes) {
            <div class="rel-notes">
              <span class="rn-label">{{ 'desktop.notes' | translate }}</span>
              <pre>{{ r.notes }}</pre>
            </div>
          }
        } @else if (busy()) {
          <div class="sec-body muted">{{ 'desktop.loading' | translate }}</div>
        } @else {
          <div class="sec-body muted">
            <strong>{{ 'desktop.noRelease' | translate }}</strong>
            <span>{{ 'desktop.noReleaseHint' | translate }}</span>
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    .dl { display: flex; flex-direction: column; gap: 20px; max-width: 720px; }
    .u-head h1 { margin: 0; }
    .u-head .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .err {
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }
    .panel { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
    .sec-head {
      display: flex; align-items: center; gap: 12px; justify-content: space-between;
      padding: 13px 20px;
      background: var(--sc-bg-2);
      border-bottom: 1px solid var(--sc-border);
    }
    .sec-head .t {
      font-family: var(--sc-font-display);
      font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--sc-fg-1);
    }
    .release { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding: 16px 20px; }
    .rel-ver { display: flex; flex-direction: column; gap: 2px; min-width: 96px; }
    .rel-ver .v { font-family: var(--sc-font-display); font-size: 1.5rem; color: var(--sc-accent); line-height: 1; }
    .rel-ver .d {
      color: var(--sc-fg-2); font-size: 0.7rem;
      letter-spacing: 0.06em; text-transform: uppercase;
    }
    .rel-dl { display: flex; gap: 8px; flex-wrap: wrap; flex: 1; }
    .dl-btn { flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 16px; }
    .dl-btn .l { font-size: 0.82rem; }
    .dl-btn .m {
      font-size: 0.68rem; opacity: 0.85; text-transform: none; letter-spacing: 0.02em;
    }
    .dl-btn .m .hash { font-family: monospace; }
    /* Always-inline, low-key release notes (feedback 2ebe600e): no collapse,
       no heavy box — a quiet label + muted body that sits under the release. */
    .rel-notes { border-top: 1px solid var(--sc-border); margin: 0; padding: 12px 20px; }
    .rel-notes .rn-label {
      display: block; color: var(--sc-fg-2);
      font-family: var(--sc-font-display); font-size: 0.7rem;
      letter-spacing: 0.08em; text-transform: uppercase;
    }
    .rel-notes pre {
      margin: 8px 0 0; padding: 0;
      background: none; border: 0; color: var(--sc-fg-2);
      font-family: inherit; font-size: 0.82rem; line-height: 1.5;
      white-space: pre-wrap; max-height: 220px; overflow-y: auto;
    }
    .sec-body { padding: 20px; color: var(--sc-fg-1); display: flex; flex-direction: column; gap: 4px; }
    .sec-body.muted { color: var(--sc-fg-2); }
    .sec-body strong { color: var(--sc-fg-1); }
    @media (max-width: 560px) {
      .sec-head { padding: 12px 16px; }
      .release { padding: 14px 16px; }
      .rel-notes { padding: 10px 16px; }
    }
  `],
})
export class DownloadComponent {
  private readonly sb = inject(SupabaseClientProvider);

  readonly release = signal<ReleaseInfo | null>(null);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly channel = signal<ReleaseChannel>('stable');

  constructor() {
    effect(() => {
      void this.load(this.channel());
    });
  }

  private async load(channel: ReleaseChannel): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { data, error } = await this.sb.client.rpc('desktop_release_for_channel', {
      p_channel: channel,
    });
    if (error) this.errorMsg.set(error.message);
    else this.release.set((data as unknown as ReleaseInfo[])?.[0] ?? null);
    this.busy.set(false);
  }

  platformEntries(r: ReleaseInfo): Array<{ key: string; value: PlatformAsset }> {
    return Object.entries(r.platforms ?? {}).map(([key, value]) => ({ key, value }));
  }

  hashFingerprint(p: PlatformAsset): string | null {
    const h = p.sha512 ?? p.sha256 ?? '';
    return h ? h.slice(0, 12) : null;
  }
}
