import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ScSelectComponent, ScSelectOption } from '../../shared/sc-select.component';
import {
  GlossaryEntry,
  GlossaryHistoryEntry,
  TranslationLanguage,
  TranslationsService,
} from './translations.service';
import {
  GLOSSARY_CATEGORIES,
  GLOSSARY_ORIGINS,
  GLOSSARY_PAGE_SIZE,
  GlossaryCategory,
  GlossaryFilters,
  GlossaryOrigin,
  revertPatch,
} from './translations.logic';

/** Glossary editor tab of /admin/translations: search, filters, paging, edit, lock, history + undo. */
@Component({
  selector: 'sc-translation-glossary',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe, ScSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sc-card block">
      <div class="filters">
        <label class="field grow">
          <span>{{ 'admin.translations.glossary.search' | translate }}</span>
          <input class="sc-input" type="search" [value]="filters().search"
                 (input)="onSearch($any($event.target).value)" />
        </label>
        <div class="field">
          <span>{{ 'admin.translations.glossary.lang' | translate }}</span>
          <sc-select [options]="langOptions()" [value]="filters().lang" [ariaLabel]="'admin.translations.glossary.lang' | translate"
                     placeholderKey="admin.translations.glossary.all" (valueChange)="setFilter('lang', $event)" />
        </div>
        <div class="field">
          <span>{{ 'admin.translations.glossary.origin' | translate }}</span>
          <sc-select [options]="originOptions" [value]="filters().origin" [ariaLabel]="'admin.translations.glossary.origin' | translate"
                     placeholderKey="admin.translations.glossary.all" (valueChange)="setFilter('origin', $event)" />
        </div>
        <div class="field">
          <span>{{ 'admin.translations.glossary.category' | translate }}</span>
          <sc-select [options]="categoryOptions" [value]="filters().category" [ariaLabel]="'admin.translations.glossary.category' | translate"
                     placeholderKey="admin.translations.glossary.all" (valueChange)="setFilter('category', $event)" />
        </div>
      </div>
    </section>

    @if (flash(); as f) {
      <p class="flash" [class.err]="f.err" role="status">{{ f.key | translate }}</p>
    }

    <section class="sc-card block">
      <div class="block-head">
        <h2>{{ 'admin.translations.glossary.title' | translate }} <small>({{ total() }})</small></h2>
        <button type="button" class="sc-btn micro sc-btn-primary" (click)="adding.set(!adding())">
          {{ 'admin.translations.glossary.add' | translate }}
        </button>
      </div>

      @if (adding()) {
        <form class="add" (submit)="$event.preventDefault(); addEntry()">
          <div class="field">
            <span>{{ 'admin.translations.glossary.lang' | translate }}</span>
            <sc-select [options]="langOptions()" [value]="draft().lang" [allowEmpty]="false"
                       [ariaLabel]="'admin.translations.glossary.lang' | translate"
                       (valueChange)="patchDraft({ lang: $event ?? '' })" />
          </div>
          <label class="field grow">
            <span>{{ 'admin.translations.glossary.source' | translate }}</span>
            <input class="sc-input" [value]="draft().source_term" (input)="patchDraft({ source_term: $any($event.target).value })" />
          </label>
          <label class="field grow">
            <span>{{ 'admin.translations.glossary.target' | translate }}</span>
            <input class="sc-input" [value]="draft().target_term" (input)="patchDraft({ target_term: $any($event.target).value })" />
          </label>
          <div class="field">
            <span>{{ 'admin.translations.glossary.category' | translate }}</span>
            <sc-select [options]="categoryOptions" [value]="draft().category" [allowEmpty]="false"
                       [ariaLabel]="'admin.translations.glossary.category' | translate"
                       (valueChange)="patchDraft({ category: $event ?? 'term' })" />
          </div>
          <button type="submit" class="sc-btn sc-btn-primary" [disabled]="busy() || !canAdd()">
            {{ 'admin.translations.glossary.save' | translate }}
          </button>
        </form>
      }

      @if (error()) {
        <div class="state error" role="alert">
          <p>{{ error()! | translate }}</p>
          <button type="button" class="sc-btn" (click)="load()">{{ 'admin.translations.retry' | translate }}</button>
        </div>
      } @else if (loading()) {
        <p class="hint" role="status">{{ 'admin.translations.loading' | translate }}</p>
      } @else if (rows().length === 0) {
        <p class="hint">{{ 'admin.translations.glossary.empty' | translate }}</p>
      } @else {
        <div class="sc-table-scroll">
          <table class="gl">
            <thead>
              <tr>
                <th>{{ 'admin.translations.glossary.lang' | translate }}</th>
                <th>{{ 'admin.translations.glossary.source' | translate }}</th>
                <th>{{ 'admin.translations.glossary.target' | translate }}</th>
                <th>{{ 'admin.translations.glossary.category' | translate }}</th>
                <th>{{ 'admin.translations.glossary.origin' | translate }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr>
                  <td>{{ r.lang }}</td>
                  <td class="term">{{ r.source_term }}</td>
                  <td class="term">
                    @if (editId() === r.id) {
                      <input class="sc-input" [value]="editValue()" (input)="editValue.set($any($event.target).value)"
                             (keydown.enter)="saveEdit(r)" (keydown.escape)="editId.set(null)"
                             [attr.aria-label]="'admin.translations.glossary.target' | translate" />
                    } @else {
                      {{ r.target_term }}
                    }
                  </td>
                  <td>{{ 'admin.translations.glossary.categories.' + r.category | translate }}</td>
                  <td><span class="pill" [class.admin]="r.origin === 'admin'">{{ 'admin.translations.glossary.origins.' + r.origin | translate }}</span></td>
                  <td class="actions">
                    @if (editId() === r.id) {
                      <button type="button" class="sc-btn micro sc-btn-primary" [disabled]="busy()" (click)="saveEdit(r)">{{ 'admin.translations.glossary.save' | translate }}</button>
                      <button type="button" class="sc-btn micro" (click)="editId.set(null)">{{ 'admin.translations.glossary.cancelEdit' | translate }}</button>
                    } @else {
                      <button type="button" class="sc-btn micro" (click)="startEdit(r)">{{ 'admin.translations.glossary.edit' | translate }}</button>
                    }
                    <button type="button" class="sc-btn micro" role="switch" [attr.aria-checked]="r.locked" [disabled]="busy()"
                            [class.on]="r.locked" (click)="toggle(r, 'locked')">
                      {{ (r.locked ? 'admin.translations.glossary.unlock' : 'admin.translations.glossary.lock') | translate }}
                    </button>
                    <button type="button" class="sc-btn micro" role="switch" [attr.aria-checked]="r.needs_retranslate" [disabled]="busy()"
                            [class.on]="r.needs_retranslate" (click)="toggle(r, 'needs_retranslate')">
                      {{ 'admin.translations.glossary.retranslate' | translate }}
                    </button>
                    <button type="button" class="sc-btn micro" [attr.aria-expanded]="historyId() === r.id" (click)="toggleHistory(r)">
                      {{ 'admin.translations.glossary.history' | translate }}
                    </button>
                  </td>
                </tr>
                @if (historyId() === r.id) {
                  <tr class="hist-row">
                    <td colspan="6">
                      @if (historyError()) {
                        <p class="err-line">{{ historyError()! | translate }}</p>
                      } @else if (history() === null) {
                        <p class="hint">{{ 'admin.translations.loading' | translate }}</p>
                      } @else if (history()!.length === 0) {
                        <p class="hint">{{ 'admin.translations.glossary.historyEmpty' | translate }}</p>
                      } @else {
                        <ul class="hist" role="list">
                          @for (h of history()!; track h.id) {
                            <li>
                              <span class="when">{{ h.at | scDate: 'datetime' }}</span>
                              <span class="chg">{{ h.before?.['target_term'] ?? '—' }} → {{ h.after ? h.after['target_term'] : ('admin.translations.glossary.deleted' | translate) }}</span>
                              @if (canRevert(h)) {
                                <button type="button" class="sc-btn micro" [disabled]="busy()" (click)="revert(r, h)">
                                  {{ 'admin.translations.glossary.undo' | translate }}
                                </button>
                              }
                            </li>
                          }
                        </ul>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
        <div class="pager">
          <button type="button" class="sc-btn micro" [disabled]="filters().page === 0" (click)="goPage(-1)">{{ 'admin.translations.glossary.prev' | translate }}</button>
          <span>{{ 'admin.translations.glossary.pageOf' | translate: { page: filters().page + 1, pages: pages() } }}</span>
          <button type="button" class="sc-btn micro" [disabled]="filters().page + 1 >= pages()" (click)="goPage(1)">{{ 'admin.translations.glossary.next' | translate }}</button>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .block { display: grid; gap: var(--sc-space-4); margin-bottom: var(--sc-space-4); }
      .block-head { display: flex; justify-content: space-between; align-items: center; gap: var(--sc-space-3); }
      h2 { margin: 0; font-size: 1.05rem; }
      h2 small { color: var(--sc-fg-2); font-weight: 400; }
      .filters, .add { display: flex; flex-wrap: wrap; gap: var(--sc-space-4); align-items: flex-end; }
      .field { display: grid; gap: var(--sc-space-2); font-size: 0.85rem; color: var(--sc-fg-1); min-width: 150px; }
      .field.grow { flex: 1 1 200px; }
      .hint { margin: 0; color: var(--sc-fg-2); font-size: 0.88rem; }
      .state { display: grid; gap: var(--sc-space-3); justify-items: start; }
      .flash { margin: 0 0 var(--sc-space-3); color: var(--sc-accent); }
      .flash.err, .err-line { color: var(--sc-danger); }
      .gl { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
      .gl th, .gl td { text-align: start; padding: var(--sc-space-2) var(--sc-space-3); border-bottom: 1px solid var(--sc-border); vertical-align: middle; }
      .gl .term { min-width: 12ch; overflow-wrap: anywhere; }
      .gl .actions { display: flex; gap: var(--sc-space-2); flex-wrap: wrap; }
      .sc-btn.on { border-color: var(--sc-accent); color: var(--sc-accent); }
      .pill { padding: 2px 10px; border-radius: 999px; font-size: 0.78rem; border: 1px solid var(--sc-border); color: var(--sc-fg-1); }
      .pill.admin { border-color: var(--sc-accent); color: var(--sc-accent); }
      .hist { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sc-space-2); }
      .hist li { display: flex; gap: var(--sc-space-3); align-items: center; flex-wrap: wrap; }
      .hist .when { color: var(--sc-fg-2); font-size: 0.8rem; }
      .pager { display: flex; gap: var(--sc-space-3); align-items: center; justify-content: center; }
    `,
  ],
})
export class TranslationGlossaryComponent implements OnInit {
  private readonly svc = inject(TranslationsService);
  private readonly confirmSvc = inject(ScConfirmService);

  readonly languages = input<readonly TranslationLanguage[]>([]);

  readonly originOptions: ScSelectOption[] = GLOSSARY_ORIGINS.map((o) => ({
    value: o,
    labelKey: `admin.translations.glossary.origins.${o}`,
  }));
  readonly categoryOptions: ScSelectOption[] = GLOSSARY_CATEGORIES.map((c) => ({
    value: c,
    labelKey: `admin.translations.glossary.categories.${c}`,
  }));
  readonly langOptions = computed<ScSelectOption[]>(() =>
    this.languages().map((l) => ({ value: l.lang, labelKey: 'admin.translations.glossary.langLabel', labelParams: { lang: l.lang }, label: l.lang })),
  );

  readonly filters = signal<GlossaryFilters>({ search: '', lang: null, origin: null, category: null, page: 0 });
  readonly rows = signal<GlossaryEntry[]>([]);
  readonly total = signal(0);
  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / GLOSSARY_PAGE_SIZE)));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly flash = signal<{ key: string; err: boolean } | null>(null);

  readonly editId = signal<string | null>(null);
  readonly editValue = signal('');
  readonly historyId = signal<string | null>(null);
  readonly history = signal<GlossaryHistoryEntry[] | null>(null);
  readonly historyError = signal<string | null>(null);

  readonly adding = signal(false);
  readonly draft = signal({ lang: 'de', source_term: '', target_term: '', category: 'term' });
  readonly canAdd = computed(() => {
    const d = this.draft();
    return !!d.lang && d.source_term.trim().length > 0 && d.target_term.trim().length > 0;
  });

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const mine = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.svc.listGlossary(this.filters());
      if (mine !== this.seq) return;
      this.rows.set(res.rows);
      this.total.set(res.total);
    } catch (e) {
      if (mine !== this.seq) return;
      this.error.set(toErrorKey('admin-translations', 'glossary-load', e));
    } finally {
      if (mine === this.seq) this.loading.set(false);
    }
  }

  onSearch(value: string): void {
    this.filters.update((f) => ({ ...f, search: value, page: 0 }));
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(), 300);
  }

  setFilter(key: 'lang' | 'origin' | 'category', value: string | null): void {
    this.filters.update((f) => ({ ...f, [key]: value as GlossaryOrigin & GlossaryCategory | null, page: 0 }));
    void this.load();
  }

  goPage(delta: number): void {
    this.filters.update((f) => ({ ...f, page: Math.max(0, f.page + delta) }));
    void this.load();
  }

  startEdit(r: GlossaryEntry): void {
    this.editId.set(r.id);
    this.editValue.set(r.target_term);
  }

  patchDraft(p: Partial<{ lang: string; source_term: string; target_term: string; category: string }>): void {
    this.draft.update((d) => ({ ...d, ...p }));
  }

  canRevert(h: GlossaryHistoryEntry): boolean {
    return revertPatch(h.before) !== null;
  }

  private async run(op: string, fn: () => Promise<unknown>): Promise<boolean> {
    this.busy.set(true);
    this.flash.set(null);
    try {
      await fn();
      this.flash.set({ key: 'admin.translations.saved', err: false });
      return true;
    } catch (e) {
      this.flash.set({ key: toErrorKey('admin-translations', op, e), err: true });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async saveEdit(r: GlossaryEntry): Promise<void> {
    const v = this.editValue().trim();
    if (!v || v === r.target_term) {
      this.editId.set(null);
      return;
    }
    if (await this.run('glossary-save', () => this.svc.saveTarget(r.id, v))) {
      this.editId.set(null);
      await this.load();
    }
  }

  async toggle(r: GlossaryEntry, field: 'locked' | 'needs_retranslate'): Promise<void> {
    if (await this.run('glossary-toggle', () => this.svc.updateGlossary(r.id, { [field]: !r[field] }))) {
      this.rows.update((rs) => rs.map((x) => (x.id === r.id ? { ...x, [field]: !r[field] } : x)));
    }
  }

  async addEntry(): Promise<void> {
    const d = this.draft();
    const entry = { ...d, source_term: d.source_term.trim(), target_term: d.target_term.trim() };
    if (await this.run('glossary-add', () => this.svc.addGlossary(entry))) {
      this.draft.update((x) => ({ ...x, source_term: '', target_term: '' }));
      this.adding.set(false);
      await this.load();
    }
  }

  async toggleHistory(r: GlossaryEntry): Promise<void> {
    if (this.historyId() === r.id) {
      this.historyId.set(null);
      return;
    }
    this.historyId.set(r.id);
    this.history.set(null);
    this.historyError.set(null);
    try {
      const h = await this.svc.history(r.id);
      if (this.historyId() === r.id) this.history.set(h);
    } catch (e) {
      this.historyError.set(toErrorKey('admin-translations', 'glossary-history', e));
    }
  }

  async revert(r: GlossaryEntry, h: GlossaryHistoryEntry): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'admin.translations.glossary.undoTitle',
      messageKey: 'admin.translations.glossary.undoText',
      params: { term: String(h.before?.['target_term'] ?? '') },
    });
    if (!ok) return;
    if (await this.run('glossary-revert', () => this.svc.revert(h))) {
      await this.load();
      this.historyId.set(null);
      await this.toggleHistory(r);
    }
  }
}
