import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { RoleService } from '../auth/role.service';
import { P4kHistoryComponent } from '../p4k/p4k-history.component';
import { AppDownloadEntry, AppDownloadPanelComponent } from './app-download-panel.component';
import { ChannelPickerComponent, ReleaseChannel } from './channel-picker.component';
import { DesktopReleaseService, ReleaseInfo, hashFingerprint } from './desktop-release.service';
import { ScDatePipe } from '../core/locale/sc-date.pipe';

/**
 * The Data Upload page (`/uploader`). Since admin feedback eb9c6ec3 it renders
 * the SHARED `sc-app-download-panel` — the same minimal panel the Starscape
 * download uses — so the two desktop apps present themselves identically, and
 * the bundle history it used to stack underneath now opens as a popup instead
 * of stretching the page. The uploader no longer holds a top-level nav entry
 * either: its everyday entrance is the collapsible `sc-uploader-access` line on
 * the Codex Bridge, and this page stays as the full-size surface behind it.
 */
@Component({
  selector: 'sc-desktop-download',
  standalone: true,
  imports: [
    ScDatePipe,
    TranslateModule,
    P4kHistoryComponent,
    AppDownloadPanelComponent,
    ChannelPickerComponent,
  ],
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

      <div class="meta">
        @if (release(); as r) {
          <span class="rel-when">
            {{ 'desktop.released' | translate }} · {{ r.created_at | scDate }}
          </span>
        }
        <button type="button" class="link" (click)="historyOpen.set(true)">
          {{ 'desktop.bundleHistory' | translate }}
        </button>
      </div>

      <!-- Admin-only inline promotion (feedback 446c245e): promote the
           currently-shown version forward to a ring, right where releases are
           downloaded — no separate admin page. The server-side RPC also enforces
           admin + monotonicity, so this is a convenience gate. -->
      @if (roles.isAdmin()) {
        @if (release(); as r) {
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
      }
    </section>

    @if (historyOpen()) {
      <div class="hx-back" (click)="historyOpen.set(false)">
        <div class="hx-dialog"
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
  `,
  styles: [`
    .uploader { display: flex; flex-direction: column; gap: 14px; max-width: 720px; }
    .u-head h1 { margin: 0; }
    .u-head .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .err {
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }

    .meta { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
    .rel-when {
      color: var(--sc-fg-2); font-size: max(0.7rem, var(--sc-fs-floor));
      letter-spacing: 0.06em; text-transform: uppercase;
    }
    .link {
      background: transparent; border: 0; padding: 0; cursor: pointer;
      font: inherit; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-accent);
      text-decoration: underline; text-underline-offset: 2px;
    }
    .link:hover { color: var(--sc-accent-hot); }

    /* Admin-only inline promote row — compact, low-fanfare (feedback 446c245e). */
    .promote {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 10px 0 0; border-top: 1px solid var(--sc-border);
    }
    .promote .pl {
      color: var(--sc-fg-2); font-size: max(0.7rem, var(--sc-fs-floor));
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

    /* Bundle history popup — identical shell to the Codex access panel's. */
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
export class DesktopDownloadComponent {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly releases = inject(DesktopReleaseService);
  readonly roles = inject(RoleService);

  readonly release = signal<ReleaseInfo | null>(null);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly channel = signal<ReleaseChannel>('stable');
  readonly historyOpen = signal(false);

  /** Platform caveat, kept behind the panel's ⓘ toggle. */
  readonly notes = ['desktop.access.note'] as const;

  // Admin-only inline release promotion (feedback 446c245e).
  readonly promoteTarget = signal<ReleaseChannel>('beta');
  readonly promoting = signal(false);
  readonly promoteMsg = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

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
    // Re-resolve the download whenever the picked channel changes. The RPC
    // clamps server-side to the caller's role, so a viewer always gets stable.
    effect(() => {
      void this.load(this.channel());
    });
  }

  private async load(channel: ReleaseChannel): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { release, error } = await this.releases.forChannel(channel);
    // Latest-wins guard: on first open the parent starts at 'stable' and the
    // channel-picker then re-defaults to the role's top ring (alpha for admin),
    // so two loads race. If a newer channel was picked while this request was in
    // flight, drop this now-stale response — otherwise a late 'stable' reply
    // clobbers the freshly-loaded 'alpha' release and blanks the shown version
    // (feedback e892e715: "channel alpha, aber die Version wird nicht angezeigt").
    if (this.channel() !== channel) return;
    if (error) this.errorMsg.set(error);
    else this.release.set(release);
    this.busy.set(false);
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

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.historyOpen()) this.historyOpen.set(false);
  }
}
