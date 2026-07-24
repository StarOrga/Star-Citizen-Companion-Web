import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { RoleService } from '../auth/role.service';
import { P4kHistoryComponent } from '../p4k/p4k-history.component';
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
 * The unified "Data Upload" page. Formerly two visually-separate blocks (the
 * desktop-tool download card and the bundle history) stacked with a hard
 * divider; now merged into ONE cohesive panel (feedback d91725c1) whose two
 * sections — "Aktuelle Version" (this component) and "Bundle-Historie"
 * (embedded `sc-p4k-history`) — share a single card, section-header language and
 * spacing so the page reads as one surface instead of two competing islands.
 */
@Component({
  selector: 'sc-desktop-download',
  standalone: true,
  imports: [DatePipe, DecimalPipe, TranslateModule, P4kHistoryComponent, ChannelPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="uploader">
      <header class="u-head">
        <h1>{{ 'desktop.title' | translate }}</h1>
        <p class="hint">{{ 'desktop.subtitle' | translate }}</p>
      </header>

      @if (errorMsg()) {
        <div class="err">{{ errorMsg() }}</div>
      }

      <div class="sc-card panel">
        <!-- Section 1: the current desktop-tool release. -->
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
                <a class="sc-btn sc-btn-primary dl" [href]="entry.value.url" download>
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
          <!-- Admin-only inline promotion (feedback 446c245e): promote the
               currently-shown version forward to a ring, right where releases
               are downloaded — no separate admin page. Server-side RPC also
               enforces admin + monotonicity, so this is a convenience gate. -->
          @if (roles.isAdmin()) {
            <div class="promote">
              <span class="pl">{{ 'desktop.promote.label' | translate }}</span>
              <select class="psel"
                      [value]="promoteTarget()"
                      (change)="onPromoteTarget($event)"
                      [disabled]="promoting()"
                      [attr.aria-label]="'desktop.promote.label' | translate">
                <option value="alpha">{{ 'desktop.channel.alpha' | translate }}</option>
                <option value="beta">{{ 'desktop.channel.beta' | translate }}</option>
                <option value="stable">{{ 'desktop.channel.stable' | translate }}</option>
              </select>
              <button class="sc-btn micro" [disabled]="promoting()" (click)="promote(r.version)">
                {{ 'desktop.promote.action' | translate }}
              </button>
              @if (promoteMsg(); as m) {
                <span class="pmsg" [class.err]="m.kind === 'error'">{{ m.text }}</span>
              }
            </div>
          }
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

        <!-- Section 2: bundle history, embedded so it renders inside this same
             panel (its own <section> supplies the "Bundle-Historie" sec-head). -->
        <sc-p4k-history [embedded]="true" />
      </div>
    </section>
  `,
  styles: [`
    .uploader { display: flex; flex-direction: column; gap: 20px; max-width: 1000px; }
    .u-head h1 { margin: 0; }
    .u-head .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .err {
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }

    /* The single cohesive panel that hosts both sections. */
    .panel { display: flex; flex-direction: column; padding: 0; overflow: hidden; }

    /* Shared section header (also defined in p4k-history for the embedded half). */
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

    /* Compact, inline release row. */
    .release { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding: 16px 20px; }
    .rel-ver { display: flex; flex-direction: column; gap: 2px; min-width: 96px; }
    .rel-ver .v { font-family: var(--sc-font-display); font-size: 1.5rem; color: var(--sc-accent); line-height: 1; }
    .rel-ver .d {
      color: var(--sc-fg-2); font-size: 0.7rem;
      letter-spacing: 0.06em; text-transform: uppercase;
    }
    .rel-dl { display: flex; gap: 8px; flex-wrap: wrap; flex: 1; }
    .dl { flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 16px; }
    .dl .l { font-size: 0.82rem; }
    .dl .m {
      font-size: 0.68rem; opacity: 0.85; text-transform: none; letter-spacing: 0.02em;
    }
    .dl .m .hash { font-family: monospace; }

    /* Admin-only inline promote row — compact, low-fanfare (feedback 446c245e). */
    .promote {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 10px 20px; border-top: 1px solid var(--sc-border);
      background: var(--sc-bg-1);
    }
    .promote .pl {
      color: var(--sc-fg-2); font-size: 0.7rem;
      letter-spacing: 0.06em; text-transform: uppercase;
    }
    .promote .psel {
      background: var(--sc-bg-2); color: var(--sc-fg-0);
      border: 1px solid var(--sc-border); border-radius: 4px; padding: 5px 8px;
      font: inherit; font-size: 0.82rem;
    }
    .promote .psel:focus {
      outline: none; border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }
    .promote .pmsg { font-size: 0.8rem; color: var(--sc-accent); }
    .promote .pmsg.err { color: var(--sc-danger); }

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
export class DesktopDownloadComponent {
  private readonly sb = inject(SupabaseClientProvider);
  readonly roles = inject(RoleService);

  readonly release = signal<ReleaseInfo | null>(null);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly channel = signal<ReleaseChannel>('stable');

  // Admin-only inline release promotion (feedback 446c245e).
  readonly promoteTarget = signal<ReleaseChannel>('beta');
  readonly promoting = signal(false);
  readonly promoteMsg = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  constructor() {
    // Re-resolve the download whenever the picked channel changes. The RPC
    // clamps server-side to the caller's role, so a viewer always gets stable.
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

  onPromoteTarget(ev: Event): void {
    this.promoteTarget.set((ev.target as HTMLSelectElement).value as ReleaseChannel);
    this.promoteMsg.set(null);
  }

  /**
   * Roll the currently-shown version forward to the selected ring via
   * `promote_desktop_channel`. Admin + monotonicity are enforced server-side;
   * any violation surfaces inline. The reference to the affected channel view
   * is refreshed on success so the new pointer is reflected immediately.
   */
  async promote(version: string): Promise<void> {
    this.promoting.set(true);
    this.promoteMsg.set(null);
    const to = this.promoteTarget();
    const { error } = await this.sb.client.rpc('promote_desktop_channel', {
      p_version: version,
      p_to_channel: to,
    });
    if (error) {
      this.promoteMsg.set({ kind: 'error', text: error.message });
    } else {
      this.promoteMsg.set({ kind: 'success', text: `v${version} → ${to}` });
      await this.load(this.channel());
    }
    this.promoting.set(false);
  }
}
