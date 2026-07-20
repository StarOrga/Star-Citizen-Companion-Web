import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { ReleaseChannel } from '../../desktop/channel-picker.component';

interface Pointer {
  channel: string;
  version: string;
}

/**
 * Admin-only desktop release-channel promotion. Shows the current build behind
 * each channel pointer and lets an admin roll a version forward
 * alpha → beta → stable via `promote_desktop_channel` (monotonicity + admin
 * enforced server-side; the RPC error surfaces inline on a violation).
 */
@Component({
  selector: 'sc-admin-desktop-releases',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="dr">
      <header class="head">
        <h1>{{ 'admin.desktopReleases.title' | translate }}</h1>
        <p class="hint">{{ 'admin.desktopReleases.subtitle' | translate }}</p>
      </header>

      @if (errorMsg()) { <div class="err">{{ errorMsg() }}</div> }
      @if (okMsg()) { <div class="ok">{{ okMsg() }}</div> }

      <div class="sc-card">
        <div class="sec-head"><span class="t">{{ 'admin.desktopReleases.pointers' | translate }}</span></div>
        <table class="ptr">
          <thead>
            <tr>
              <th>{{ 'admin.desktopReleases.channel' | translate }}</th>
              <th>{{ 'admin.desktopReleases.version' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (p of pointers(); track p.channel) {
              <tr>
                <td class="chan">{{ p.channel }}</td>
                <td>v{{ p.version }}</td>
              </tr>
            } @empty {
              <tr><td colspan="2" class="muted">{{ 'admin.desktopReleases.noPointers' | translate }}</td></tr>
            }
          </tbody>
        </table>
      </div>

      <div class="sc-card">
        <div class="sec-head"><span class="t">{{ 'admin.desktopReleases.promote' | translate }}</span></div>
        <div class="form">
          <label>
            <span>{{ 'admin.desktopReleases.selectVersion' | translate }}</span>
            <select [value]="selectedVersion()" (change)="onVersion($event)">
              @for (v of versions(); track v) { <option [value]="v">v{{ v }}</option> }
            </select>
          </label>
          <label>
            <span>{{ 'admin.desktopReleases.targetChannel' | translate }}</span>
            <select [value]="selectedChannel()" (change)="onChannel($event)">
              <option value="alpha">{{ 'desktop.channel.alpha' | translate }}</option>
              <option value="beta">{{ 'desktop.channel.beta' | translate }}</option>
              <option value="stable">{{ 'desktop.channel.stable' | translate }}</option>
            </select>
          </label>
          <button class="sc-btn sc-btn-primary" [disabled]="busy() || !selectedVersion()" (click)="promote()">
            {{ 'admin.desktopReleases.promoteAction' | translate }}
          </button>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .dr { display: flex; flex-direction: column; gap: 20px; max-width: 720px; }
    .head h1 { margin: 0; }
    .head .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .err, .ok { padding: 10px 14px; border-radius: 4px; }
    .err { background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger); }
    .ok { background: rgba(74, 222, 128, 0.1); border: 1px solid var(--sc-accent); color: var(--sc-accent); }
    .sec-head {
      padding: 13px 20px; background: var(--sc-bg-2); border-bottom: 1px solid var(--sc-border);
    }
    .sec-head .t {
      font-family: var(--sc-font-display); font-size: 0.82rem;
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-1);
    }
    table.ptr { width: 100%; border-collapse: collapse; }
    table.ptr th, table.ptr td { text-align: left; padding: 10px 20px; border-bottom: 1px solid var(--sc-border); }
    table.ptr th { color: var(--sc-fg-2); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; }
    table.ptr tr:last-child td { border-bottom: none; }
    td.chan { text-transform: capitalize; color: var(--sc-accent); }
    td.muted { color: var(--sc-fg-2); }
    .form { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; padding: 16px 20px; }
    .form label { display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem; color: var(--sc-fg-2); }
    .form select {
      background: var(--sc-bg-2); color: var(--sc-fg-0);
      border: 1px solid var(--sc-border); border-radius: 4px; padding: 6px 10px;
      font-family: inherit; font-size: 0.85rem; min-width: 140px;
    }
  `],
})
export class DesktopReleasesComponent {
  private readonly sb = inject(SupabaseClientProvider);

  readonly pointers = signal<Pointer[]>([]);
  readonly versions = signal<string[]>([]);
  readonly selectedVersion = signal('');
  readonly selectedChannel = signal<ReleaseChannel>('beta');
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly okMsg = signal<string | null>(null);

  constructor() {
    void this.reload();
  }

  onVersion(ev: Event): void {
    this.selectedVersion.set((ev.target as HTMLSelectElement).value);
  }

  onChannel(ev: Event): void {
    this.selectedChannel.set((ev.target as HTMLSelectElement).value as ReleaseChannel);
  }

  private async reload(): Promise<void> {
    const { data: ptr } = await this.sb.client
      .from('desktop_channels')
      .select('channel, release_id');
    const { data: rel } = await this.sb.client
      .from('desktop_releases')
      .select('id, version, created_at')
      .order('created_at', { ascending: false });
    const releases = rel ?? [];
    const versionById = new Map(releases.map((r) => [r.id, r.version]));
    const order: Record<string, number> = { alpha: 0, beta: 1, stable: 2 };
    this.pointers.set(
      (ptr ?? [])
        .map((p) => ({ channel: p.channel, version: versionById.get(p.release_id) ?? '?' }))
        .sort((a, b) => (order[a.channel] ?? 9) - (order[b.channel] ?? 9)),
    );
    const vs = releases.map((r) => r.version);
    this.versions.set(vs);
    if (!this.selectedVersion() && vs.length) this.selectedVersion.set(vs[0]);
  }

  async promote(): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    this.okMsg.set(null);
    const version = this.selectedVersion();
    const channel = this.selectedChannel();
    const { error } = await this.sb.client.rpc('promote_desktop_channel', {
      p_version: version,
      p_to_channel: channel,
    });
    if (error) this.errorMsg.set(error.message);
    else {
      this.okMsg.set(`v${version} → ${channel}`);
      await this.reload();
    }
    this.busy.set(false);
  }
}
