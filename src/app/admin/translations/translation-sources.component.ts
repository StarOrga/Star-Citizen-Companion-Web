import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { TranslationSource, TranslationsService } from './translations.service';
import { canImportSource, coverageText, jobErrorKey, summaryEntries } from './translations.logic';
import { TRANSLATIONS_TAB_STYLES } from './translations-shared.styles';

/**
 * Quellen tab: community packs with licence, status, coverage and last sync.
 * Import / sync / learn / outreach-draft all run as orchestrator ops; import
 * is only enabled once the licence is clear (licensed / permitted).
 */
@Component({
  selector: 'sc-translation-sources',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe, ScActionDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sc-card block">
      <div class="block-head">
        <h2>{{ 'admin.translations.sources.title' | translate }}</h2>
        <button scAction type="button" [busy]="busyKey() === 'sync'" [disabled]="busy()" (click)="sync()">
          {{ 'admin.translations.sources.syncAll' | translate }}
        </button>
      </div>
      <p class="hint">{{ 'admin.translations.sources.intro' | translate }}</p>

      @if (error()) {
        <div class="state error" role="alert">
          <p>{{ error()! | translate }}</p>
          <button scAction type="button" (click)="load()">{{ 'admin.translations.retry' | translate }}</button>
        </div>
      } @else if (loading()) {
        <p class="hint" role="status">{{ 'admin.translations.loading' | translate }}</p>
      } @else if (sources().length === 0) {
        <p class="hint">{{ 'admin.translations.sources.empty' | translate }}</p>
      } @else {
        <div class="sc-table-scroll">
          <table class="src">
            <thead>
              <tr>
                <th>{{ 'admin.translations.sources.cols.lang' | translate }}</th>
                <th>{{ 'admin.translations.sources.cols.name' | translate }}</th>
                <th>{{ 'admin.translations.sources.cols.license' | translate }}</th>
                <th>{{ 'admin.translations.sources.cols.status' | translate }}</th>
                <th class="num">{{ 'admin.translations.sources.cols.coverage' | translate }}</th>
                <th>{{ 'admin.translations.sources.cols.synced' | translate }}</th>
                <th>{{ 'admin.translations.sources.cols.folder' | translate }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (s of sources(); track s.id) {
                <tr>
                  <td>{{ s.lang }}</td>
                  <td>{{ s.name }}</td>
                  <td>
                    {{ s.license ?? '—' }}
                    <span class="hint">{{ 'admin.translations.sources.kinds.' + s.license_kind | translate }}</span>
                  </td>
                  <td>
                    <span class="pill" [class.ok]="canImport(s.status)" [class.warn]="s.status === 'awaiting_permission'" [class.bad]="s.status === 'refused'">
                      {{ 'admin.translations.sources.status.' + s.status | translate }}
                    </span>
                  </td>
                  <td class="num">{{ coverage(s) === null ? '—' : coverage(s) + ' %' }}</td>
                  <td>{{ s.last_synced_at ? (s.last_synced_at | scDate: 'datetime') : ('admin.translations.sources.never' | translate) }}</td>
                  <td class="mono">{{ s.game_folder ?? '—' }}</td>
                  <td class="actions">
                    <span class="tip-wrap" [scTooltip]="canImport(s.status) ? '' : ('admin.translations.sources.importLocked' | translate)"
                          scTooltipTier="label" [scTooltipDisabled]="canImport(s.status)">
                      <button scAction type="button" [busy]="busyKey() === 'import:' + s.id"
                              [disabled]="busy() || !canImport(s.status)" (click)="importSeed(s)">
                        {{ 'admin.translations.sources.import' | translate }}
                      </button>
                    </span>
                    <button scAction type="button" [busy]="busyKey() === 'learn:' + s.id" [disabled]="busy()" (click)="learn(s)">
                      {{ 'admin.translations.sources.learn' | translate }}
                    </button>
                    <button scAction type="button" [busy]="busyKey() === 'draft:' + s.id" [disabled]="busy()" (click)="draft(s)">
                      {{ 'admin.translations.sources.draft' | translate }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    @if (flash(); as f) {
      <p class="flash" [class.err]="f.err" role="status">{{ f.key | translate: f.params }}</p>
    }

    @if (summary(); as sm) {
      <section class="sc-card block" data-test="summary">
        <h3>{{ sm.title | translate }}</h3>
        <dl class="summary">
          @for (e of sm.entries; track e.k) {
            <dt>{{ e.k }}</dt><dd>{{ e.v }}</dd>
          }
        </dl>
      </section>
    }
  `,
  styles: [
    TRANSLATIONS_TAB_STYLES,
    `
      .src { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
      .src th, .src td { text-align: start; padding: var(--sc-space-2) var(--sc-space-3); border-bottom: 1px solid var(--sc-border); vertical-align: middle; }
      .src .num { text-align: end; font-variant-numeric: tabular-nums; }
      .src .actions { display: flex; gap: var(--sc-space-2); flex-wrap: wrap; }
    `,
  ],
})
export class TranslationSourcesComponent implements OnInit {
  private readonly svc = inject(TranslationsService);
  private readonly confirmSvc = inject(ScConfirmService);

  readonly sources = signal<TranslationSource[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busyKey = signal<string | null>(null);
  readonly flash = signal<{ key: string; params?: Record<string, unknown>; err: boolean } | null>(null);
  readonly summary = signal<{ title: string; entries: { k: string; v: string }[] } | null>(null);

  readonly canImport = canImportSource;
  readonly coverage = (s: TranslationSource) => coverageText(s.coverage);
  busy(): boolean {
    return this.busyKey() !== null;
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.sources.set(await this.svc.listSources());
    } catch (e) {
      this.error.set(toErrorKey('admin-translations', 'sources-load', e));
    } finally {
      this.loading.set(false);
    }
  }

  private async run<T>(busyKey: string, op: string, fn: () => Promise<T>, done: (r: T) => void): Promise<void> {
    this.busyKey.set(busyKey);
    this.flash.set(null);
    this.summary.set(null);
    try {
      done(await fn());
    } catch (e) {
      const code = (e as { code?: string })?.code;
      const key = code?.startsWith('translate.') ? jobErrorKey(code) : null;
      this.flash.set({ key: key ?? toErrorKey('admin-translations', op, e), err: true });
    } finally {
      this.busyKey.set(null);
    }
  }

  async importSeed(s: TranslationSource): Promise<void> {
    if (!canImportSource(s.status)) return;
    const ok = await this.confirmSvc.confirm({
      titleKey: 'admin.translations.sources.importTitle',
      messageKey: 'admin.translations.sources.importText',
      params: { name: s.name, lang: s.lang },
      confirmKey: 'admin.translations.sources.import',
    });
    if (!ok) return;
    await this.run(
      'import:' + s.id,
      'import-seed',
      () => this.svc.importSeed(s.id),
      (r) => {
        this.flash.set({ key: 'admin.translations.sources.imported', params: { name: s.name, count: r.imported }, err: false });
        this.summary.set({ title: 'admin.translations.sources.importResult', entries: summaryEntries(r as unknown as Record<string, unknown>) });
        void this.load();
      },
    );
  }

  async sync(): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'admin.translations.sources.syncTitle',
      messageKey: 'admin.translations.sources.syncText',
      confirmKey: 'admin.translations.sources.syncAll',
    });
    if (!ok) return;
    await this.run(
      'sync',
      'sync-sources',
      () => this.svc.syncSources(),
      (r) => {
        this.flash.set({ key: 'admin.translations.sources.synced', params: { checked: r.checked, changed: r.changed, errors: r.errors }, err: false });
        void this.load();
      },
    );
  }

  async learn(s: TranslationSource): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'admin.translations.sources.learnTitle',
      messageKey: 'admin.translations.sources.learnText',
      params: { lang: s.lang },
      confirmKey: 'admin.translations.sources.learn',
    });
    if (!ok) return;
    await this.run(
      'learn:' + s.id,
      'learn',
      () => this.svc.learn(s.lang),
      (r) => this.summary.set({ title: 'admin.translations.sources.learnResult', entries: summaryEntries(r) }),
    );
  }

  async draft(s: TranslationSource): Promise<void> {
    await this.run(
      'draft:' + s.id,
      'draft-outreach',
      () => this.svc.draftOutreach(s.id),
      () => this.flash.set({ key: 'admin.translations.sources.drafted', params: { name: s.name }, err: false }),
    );
  }
}
