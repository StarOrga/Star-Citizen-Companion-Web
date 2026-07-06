import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';

interface PlatformAsset {
  url: string;
  size_bytes: number;
  sha512?: string | null;
  sha256?: string | null;
}

interface ReleaseInfo {
  id: string;
  version: string;
  platforms: Record<string, PlatformAsset>;
  notes: string | null;
  created_at: string;
}

@Component({
  selector: 'sc-desktop-download',
  standalone: true,
  imports: [DatePipe, DecimalPipe, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'desktop.title' | translate }}</h1>
          <p class="hint">{{ 'desktop.subtitle' | translate }}</p>
        </div>
      </header>

      @if (errorMsg()) {
        <div class="err">{{ errorMsg() }}</div>
      }

      @if (release(); as r) {
        <div class="sc-card release">
          <div class="row">
            <span class="label">{{ 'desktop.currentVersion' | translate }}</span>
            <span class="value version">v{{ r.version }}</span>
          </div>
          <div class="row">
            <span class="label">{{ 'desktop.released' | translate }}</span>
            <span class="value">{{ r.created_at | date:'medium' }}</span>
          </div>
          @if (r.notes) {
            <div class="notes">
              <span class="label">{{ 'desktop.notes' | translate }}</span>
              <pre>{{ r.notes }}</pre>
            </div>
          }
          <div class="platforms">
            @for (entry of platformEntries(r); track entry.key) {
              <a class="sc-btn sc-btn-primary platform" [href]="entry.value.url" download>
                <span class="plat-label">{{ 'desktop.downloadFor' | translate:{ platform: entry.key } }}</span>
                <span class="plat-meta">
                  {{ entry.value.size_bytes / 1024 / 1024 | number:'1.0-1' }} MB
                  @if (hashFingerprint(entry.value); as h) {
                    · <span class="hash">{{ h }}…</span>
                  }
                </span>
              </a>
            }
          </div>
        </div>
      } @else if (busy()) {
        <div class="sc-card empty">
          <p>{{ 'desktop.loading' | translate }}</p>
        </div>
      } @else {
        <div class="sc-card empty">
          <h2>{{ 'desktop.noRelease' | translate }}</h2>
          <p>{{ 'desktop.noReleaseHint' | translate }}</p>
        </div>
      }
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; max-width: 760px; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .err {
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }
    .release { display: flex; flex-direction: column; gap: 12px; }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--sc-border);
    }
    .label {
      color: var(--sc-fg-2);
      font-family: var(--sc-font-display);
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .value { color: var(--sc-fg-0); text-align: right; overflow-wrap: anywhere; min-width: 0; }
    .value.version {
      font-family: var(--sc-font-display);
      font-size: 1.2rem;
      color: var(--sc-accent);
    }
    .notes { display: flex; flex-direction: column; gap: 6px; }
    .notes pre {
      margin: 0;
      padding: 12px 14px;
      background: var(--sc-bg-1);
      border: 1px solid var(--sc-border);
      border-radius: 6px;
      font-size: 0.85rem;
      white-space: pre-wrap;
      max-height: 220px;
      overflow-y: auto;
    }
    .platforms { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .platform {
      flex-direction: column;
      align-items: stretch;
      padding: 14px 18px;
      gap: 4px;
    }
    .plat-label {
      font-size: 0.92rem;
      letter-spacing: 0.06em;
    }
    .plat-meta {
      font-size: 0.72rem;
      letter-spacing: 0.04em;
      opacity: 0.85;
      text-transform: none;
    }
    .plat-meta .hash { font-family: monospace; }
    .empty { text-align: center; padding: 40px 24px; color: var(--sc-fg-2); }
    .empty h2 { margin: 0 0 8px; }
  `],
})
export class DesktopDownloadComponent implements OnInit {
  private readonly sb = inject(SupabaseClientProvider);

  readonly release = signal<ReleaseInfo | null>(null);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);

  async ngOnInit() {
    this.busy.set(true);
    const { data, error } = await this.sb.client
      .from('desktop_releases')
      .select('id, version, platforms, notes, created_at')
      .eq('is_current', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      this.errorMsg.set(error.message);
    } else {
      this.release.set(data as ReleaseInfo | null);
    }
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
