import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { OverrideAlert, TranslationsService } from './translations.service';
import { TRANSLATIONS_TAB_STYLES } from './translations-shared.styles';

/**
 * Hinweise tab: CIG changed the English original or its own translation of a key
 * that carries an admin correction. Diff view + keep / adopt CIG / edit.
 */
@Component({
  selector: 'sc-translation-alerts',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sc-card block">
      <div class="block-head">
        <h2>{{ 'admin.translations.alerts.title' | translate }} <small>({{ items().length }})</small></h2>
        <button scAction type="button" [disabled]="busy() || loading()" (click)="load()">{{ 'admin.translations.refresh' | translate }}</button>
      </div>
      <p class="hint">{{ 'admin.translations.alerts.intro' | translate }}</p>
    </section>

    @if (flash(); as f) {
      <p class="flash" [class.err]="f.err" role="status">{{ f.key | translate }}</p>
    }

    @if (error()) {
      <div class="sc-card state error" role="alert">
        <p>{{ error()! | translate }}</p>
        <button scAction type="button" (click)="load()">{{ 'admin.translations.retry' | translate }}</button>
      </div>
    } @else if (loading()) {
      <div class="sc-card state" role="status">{{ 'admin.translations.loading' | translate }}</div>
    } @else if (items().length === 0) {
      <div class="sc-card state" data-test="empty">
        <h2>{{ 'admin.translations.alerts.emptyTitle' | translate }}</h2>
        <p class="hint">{{ 'admin.translations.alerts.empty' | translate }}</p>
      </div>
    } @else {
      @for (a of items(); track a.id) {
        <section class="sc-card block" data-test="alert">
          <div class="row">
            <span class="pill">{{ a.lang }}</span>
            <span class="mono grow">{{ a.key }}</span>
            <span class="hint">{{ a.created_at | scDate: 'datetime' }}</span>
          </div>
          <div class="diff">
            <div class="cell">
              <h3>{{ 'admin.translations.alerts.enOld' | translate }}</h3>
              <p class="old">{{ a.en_old ?? '—' }}</p>
            </div>
            <div class="cell">
              <h3>{{ 'admin.translations.alerts.enNew' | translate }}</h3>
              <p class="new">{{ a.en_new ?? '—' }}</p>
            </div>
            <div class="cell">
              <h3>{{ 'admin.translations.alerts.cigOld' | translate }}</h3>
              <p class="old">{{ a.cig_old ?? '—' }}</p>
            </div>
            <div class="cell">
              <h3>{{ 'admin.translations.alerts.cigNew' | translate }}</h3>
              <p class="new">{{ a.cig_new ?? '—' }}</p>
            </div>
          </div>
          <div class="cell mine">
            <h3>{{ 'admin.translations.alerts.adminText' | translate }}</h3>
            <p>{{ a.admin_text }}</p>
          </div>

          @if (editing() === a.id) {
            <label class="field">
              <span>{{ 'admin.translations.alerts.editLabel' | translate }}</span>
              <textarea class="sc-input" [value]="editText()" (input)="editText.set($any($event.target).value)"></textarea>
            </label>
            <div class="row">
              <button scAction tier="primary" type="button" [disabled]="busy() || !editText().trim()" (click)="resolve(a, 'edited')">
                {{ 'admin.translations.alerts.saveEdit' | translate }}
              </button>
              <button scAction type="button" (click)="editing.set(null)">{{ 'admin.translations.outreach.cancel' | translate }}</button>
            </div>
          } @else {
            <div class="row">
              <button scAction type="button" [disabled]="busy()" (click)="resolve(a, 'kept')">{{ 'admin.translations.alerts.keep' | translate }}</button>
              <button scAction type="button" [disabled]="busy()" (click)="resolve(a, 'adopted')">{{ 'admin.translations.alerts.adopt' | translate }}</button>
              <button scAction type="button" [disabled]="busy()" (click)="startEdit(a)">{{ 'admin.translations.alerts.edit' | translate }}</button>
            </div>
          }
        </section>
      }
    }
  `,
  styles: [
    TRANSLATIONS_TAB_STYLES,
    `
      h2 small { color: var(--sc-fg-2); font-weight: 400; }
      .diff { display: grid; gap: var(--sc-space-3); grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      .cell { display: grid; gap: var(--sc-space-1); padding: var(--sc-space-3); border-radius: var(--sc-radius-md, 10px);
        border: 1px solid var(--sc-border); background: var(--sc-bg-0); }
      .cell p { margin: 0; overflow-wrap: anywhere; }
      .cell h3 { color: var(--sc-fg-2); font-weight: 500; }
      .cell .old { color: var(--sc-fg-2); text-decoration: line-through; text-decoration-color: var(--sc-warning); }
      .cell .new { color: var(--sc-fg-0); }
      .cell.mine { border-color: var(--sc-accent); }
    `,
  ],
})
export class TranslationAlertsComponent implements OnInit {
  private readonly svc = inject(TranslationsService);

  readonly items = signal<OverrideAlert[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly flash = signal<{ key: string; err: boolean } | null>(null);
  readonly editing = signal<string | null>(null);
  readonly editText = signal('');

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.svc.listAlerts());
    } catch (e) {
      this.error.set(toErrorKey('admin-translations', 'alerts-load', e));
    } finally {
      this.loading.set(false);
    }
  }

  startEdit(a: OverrideAlert): void {
    this.editing.set(a.id);
    this.editText.set(a.admin_text);
  }

  async resolve(a: OverrideAlert, resolution: 'kept' | 'adopted' | 'edited'): Promise<void> {
    this.busy.set(true);
    this.flash.set(null);
    try {
      await this.svc.resolveAlert(a.id, resolution, resolution === 'edited' ? this.editText() : undefined);
      this.items.update((l) => l.filter((x) => x.id !== a.id));
      this.editing.set(null);
      this.flash.set({ key: 'admin.translations.alerts.resolved', err: false });
    } catch (e) {
      this.flash.set({ key: toErrorKey('admin-translations', 'alert-resolve', e), err: true });
    } finally {
      this.busy.set(false);
    }
  }
}
