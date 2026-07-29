import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AnalyticsService } from '../core/analytics.service';
import { ExtensionBridgeService, ExtensionHangarPayload } from './extension-bridge.service';
import { HangarImportComponent } from './hangar-import.component';

/**
 * /hangar/import — the review + confirm screen for the browser-extension
 * handover (browser-extension/README.md).
 *
 * The extension opens this route in a new tab after the user clicked "Import"
 * on their own RSI hangar page; its content script then answers this page's
 * postMessage request with the parsed ship list. Nothing is written until the
 * user confirms below, and the write itself runs through HangarService with
 * the visitor's own Supabase session — no extra endpoint, no token, no
 * elevated key anywhere in this path.
 */
type Phase = 'waiting' | 'ready' | 'empty' | 'done';

@Component({
  selector: 'sc-hangar-import-page',
  standalone: true,
  imports: [RouterLink, TranslateModule, HangarImportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <h1>{{ 'extension.importPage.title' | translate }}</h1>
        <p class="hint">{{ 'extension.importPage.subtitle' | translate }}</p>
      </header>

      @switch (phase()) {
        @case ('waiting') {
          <div class="sc-card state">
            <span class="spinner" aria-hidden="true"></span>
            <span>{{ 'extension.importPage.waiting' | translate }}</span>
          </div>
        }

        @case ('empty') {
          <div class="sc-card state empty">
            <strong>{{ 'extension.importPage.empty.title' | translate }}</strong>
            <p>{{ 'extension.importPage.empty.text' | translate }}</p>
            <div class="row">
              <a class="sc-btn" routerLink="/tools/extension">
                {{ 'extension.importPage.empty.installLink' | translate }}
              </a>
              <a class="sc-btn" routerLink="/hangar">
                {{ 'extension.importPage.empty.hangarLink' | translate }}
              </a>
            </div>
          </div>
        }

        @case ('done') {
          <div class="sc-card state done">
            <strong>{{ 'extension.importPage.done.title' | translate: { count: importedCount() } }}</strong>
            <p>{{ 'extension.importPage.done.text' | translate }}</p>
            <a class="sc-btn sc-btn-primary" routerLink="/hangar">
              {{ 'extension.importPage.done.hangarLink' | translate }}
            </a>
          </div>
        }

        @case ('ready') {
          <div class="sc-card meta">
            <div class="meta-grid">
              <span>{{ 'extension.importPage.meta.source' | translate }}</span>
              <strong>{{ 'extension.importPage.meta.sourceValue' | translate }}</strong>
              <span>{{ 'extension.importPage.meta.ships' | translate }}</span>
              <strong>{{ payload()?.ships?.length ?? 0 }}</strong>
              <span>{{ 'extension.importPage.meta.captured' | translate }}</span>
              <strong>{{ capturedLabel() }}</strong>
            </div>
            <p class="privacy">{{ 'extension.privacy.gameContentOnly' | translate }}</p>
          </div>

          <div class="sc-card review">
            <h2>{{ 'extension.importPage.review' | translate }}</h2>
            <sc-hangar-import
              [preloadedRows]="rows()"
              [embedded]="true"
              (imported)="onImported($event)" />
            <button type="button" class="link-btn" (click)="cancel()">
              {{ 'extension.importPage.cancel' | translate }}
            </button>
          </div>
        }
      }
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 16px; padding: 20px 16px 48px; max-width: 860px; margin: 0 auto; }
      .head h1 { margin: 0 0 4px; font-size: 1.25rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
      .hint { color: var(--sc-fg-2); font-size: 0.85rem; margin: 0; line-height: 1.55; }
      .state { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
      .state.done strong { color: var(--sc-success); }
      .row { display: flex; gap: 10px; flex-wrap: wrap; }
      .meta-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; font-size: 0.85rem; align-items: baseline; }
      .meta-grid span { color: var(--sc-fg-2); }
      .privacy { margin: 10px 0 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-2); line-height: 1.55;
        border-top: 1px solid var(--sc-border); padding-top: 8px; }
      .review h2 { margin: 0 0 10px; font-size: 0.95rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
      .link-btn { background: transparent; border: 0; color: var(--sc-fg-2); cursor: pointer;
        font-size: max(0.78rem, var(--sc-fs-floor)); margin-top: 10px; text-decoration: underline; padding: 0; }
      .sc-btn-primary { background: var(--sc-accent); color: var(--sc-bg-0); border-color: var(--sc-accent); }
      .spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--sc-border);
        border-top-color: var(--sc-accent); display: inline-block; animation: spin 0.9s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
    `,
  ],
})
export class HangarImportPageComponent implements OnInit {
  private readonly bridge = inject(ExtensionBridgeService);
  private readonly analytics = inject(AnalyticsService);

  readonly phase = signal<Phase>('waiting');
  readonly payload = signal<ExtensionHangarPayload | null>(null);
  readonly importedCount = signal(0);

  /** Rows in Hangar-Transfer-Format shape, consumed by the shared import UI. */
  readonly rows = signal<readonly unknown[] | null>(null);

  async ngOnInit(): Promise<void> {
    await this.bridge.waitForExtension();
    const payload = await this.bridge.requestPayload();
    if (!payload || payload.ships.length === 0) {
      this.phase.set('empty');
      return;
    }
    this.payload.set(payload);
    this.rows.set(payload.ships);
    this.phase.set('ready');
    this.analytics.capture('hangar_extension_handover', { ships_offered: payload.ships.length });
  }

  capturedLabel(): string {
    const at = this.payload()?.capturedAt;
    return at ? new Date(at).toLocaleString() : '';
  }

  onImported(count: number): void {
    this.importedCount.set(count);
    const fingerprint = this.payload()?.fingerprint;
    // Telling the extension the fleet state is now known is what stops it from
    // offering the same unchanged hangar again tomorrow.
    if (fingerprint) this.bridge.confirmImported(fingerprint, count);
    this.phase.set('done');
  }

  cancel(): void {
    this.bridge.discard();
    this.phase.set('empty');
  }
}
