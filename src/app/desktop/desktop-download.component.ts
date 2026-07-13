import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { P4kHistoryComponent } from '../p4k/p4k-history.component';

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
  imports: [DatePipe, DecimalPipe, TranslateModule, P4kHistoryComponent],
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
          @if (r.notes) {
            <details class="rel-notes">
              <summary>{{ 'desktop.notes' | translate }}</summary>
              <pre>{{ r.notes }}</pre>
            </details>
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
      display: flex; align-items: center; gap: 12px;
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

    .rel-notes { border-top: 1px solid var(--sc-border); margin: 0; padding: 10px 20px; }
    .rel-notes summary {
      cursor: pointer; color: var(--sc-fg-2);
      font-family: var(--sc-font-display); font-size: 0.7rem;
      letter-spacing: 0.08em; text-transform: uppercase; list-style: none;
    }
    .rel-notes summary::-webkit-details-marker { display: none; }
    .rel-notes summary::before { content: '▸'; display: inline-block; margin-right: 8px; transition: transform 0.15s ease; }
    .rel-notes[open] summary::before { transform: rotate(90deg); }
    .rel-notes summary:hover { color: var(--sc-fg-0); }
    .rel-notes pre {
      margin: 10px 0 0; padding: 12px 14px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); border-radius: 6px;
      font-size: 0.85rem; white-space: pre-wrap; max-height: 220px; overflow-y: auto;
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
