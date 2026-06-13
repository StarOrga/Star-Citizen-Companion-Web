import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
  CodexKind,
  CodexListRow,
  CodexService,
  pickLocalized,
} from '../codex/codex.service';
import { cleanLocaleValue, humanizeClassName } from '../codex/codex-format';
import { HangarService } from '../hangar/hangar.service';

interface QuickResult {
  kind: CodexKind;
  row: CodexListRow;
}

const SEARCH_DEBOUNCE_MS = 220;
const PER_KIND_LIMIT = 6;

/**
 * Global quick search (Ctrl+K / "/"): fuzzy lookup across ships, weapons and
 * components with inline stat chips. Ships can be added straight to the
 * hangar; every result deep-links to its codex detail page.
 */
@Component({
  selector: 'sc-quick-search',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="trigger" (click)="open()" [attr.aria-label]="'quickSearch.open' | translate">
      <span class="trigger-icon">⌕</span>
      <span class="trigger-label">{{ 'quickSearch.open' | translate }}</span>
      <kbd>Ctrl K</kbd>
    </button>

    @if (visible()) {
      <div class="overlay" (click)="close()">
        <div class="panel sc-card" role="dialog" [attr.aria-label]="'quickSearch.open' | translate" (click)="$event.stopPropagation()">
          <input
            #searchBox
            class="qs-input"
            type="search"
            [ngModel]="query()"
            (ngModelChange)="onQuery($event)"
            (keyup.escape)="close()"
            (keyup.enter)="openFirst()"
            [attr.placeholder]="'quickSearch.placeholder' | translate" />

          @if (loading()) {
            <p class="state">{{ 'quickSearch.searching' | translate }}</p>
          } @else if (query() && results().length === 0) {
            <p class="state">{{ 'quickSearch.noResults' | translate }}</p>
          } @else if (!query()) {
            <p class="state hint">{{ 'quickSearch.hint' | translate }}</p>
          }

          @if (results().length > 0) {
            <ul class="qs-results">
              @for (r of results(); track r.kind + ':' + r.row.classNameSlug) {
                <li class="qs-row" (click)="openResult(r)">
                  <span class="qs-kind">{{ ('codex.kindSingular.' + r.kind) | translate }}</span>
                  <span class="qs-name">{{ name(r.row) }}</span>
                  <span class="qs-chips">
                    @if (r.row.manufacturerCode) { <span class="badge mfr">{{ r.row.manufacturerCode }}</span> }
                    @if (r.row.componentKind) { <span class="badge">{{ r.row.componentKind }}</span> }
                    @if (r.row.weaponClass) { <span class="badge">{{ ('codex.weaponClass.' + r.row.weaponClass) | translate }}</span> }
                    @if (r.row.size != null) { <span class="badge">S{{ r.row.size }}</span> }
                    @if (r.row.grade) { <span class="badge">{{ r.row.grade }}</span> }
                    @if (r.row.crewSize != null) { <span class="badge">{{ 'codex.card.crew' | translate: { count: r.row.crewSize } }}</span> }
                  </span>
                  @if (r.kind === 'ship') {
                    @if (inHangar(r.row.classNameSlug)) {
                      <span class="in-hangar">{{ 'hangar.add.already' | translate }}</span>
                    } @else {
                      <button type="button" class="add-btn" (click)="addToHangar($event, r.row)">
                        {{ 'quickSearch.addToHangar' | translate }}
                      </button>
                    }
                  }
                </li>
              }
            </ul>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .trigger {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 12px; border-radius: 6px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      color: var(--sc-fg-2); cursor: pointer; font-family: inherit; font-size: 0.78rem;
    }
    .trigger:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .trigger-icon { font-size: 0.95rem; }
    .trigger kbd {
      font-size: 0.62rem; padding: 1px 5px; border-radius: 4px;
      background: var(--sc-bg-2); border: 1px solid var(--sc-border); color: var(--sc-fg-2);
      font-family: var(--sc-font-mono, monospace);
    }

    .overlay {
      position: fixed; inset: 0; z-index: 100;
      background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(3px);
      display: flex; justify-content: center; align-items: flex-start;
      padding: 12vh 16px 16px;
    }
    .panel {
      width: 100%; max-width: 640px; max-height: 70vh; overflow: hidden;
      display: flex; flex-direction: column; gap: 10px; padding: 14px;
    }
    .qs-input {
      padding: 12px 16px; border-radius: 8px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-accent); color: var(--sc-fg-0);
      font-family: inherit; font-size: 1rem;
    }
    .qs-input:focus { outline: none; box-shadow: 0 0 0 2px rgba(0,212,255,0.25); }
    .state { margin: 0; color: var(--sc-fg-2); font-size: 0.84rem; padding: 2px 4px; }
    .qs-results { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .qs-row {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 10px; border-radius: 6px; cursor: pointer;
      background: var(--sc-bg-0); border: 1px solid transparent;
    }
    .qs-row:hover { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 8%, var(--sc-bg-0)); }
    .qs-kind {
      flex: 0 0 auto; width: 92px; font-size: 0.62rem; text-transform: uppercase;
      letter-spacing: 0.07em; color: var(--sc-fg-2);
    }
    .qs-name { flex: 1; font-size: 0.9rem; min-width: 120px; }
    .qs-chips { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
    .badge { font-size: 0.62rem; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .badge.mfr { background: color-mix(in srgb, var(--sc-accent-hot) 14%, transparent); border-color: color-mix(in srgb, var(--sc-accent-hot) 35%, transparent); }
    .add-btn {
      flex: 0 0 auto; padding: 4px 10px; border-radius: 6px;
      background: transparent; border: 1px solid var(--sc-accent); color: var(--sc-accent);
      font-family: var(--sc-font-display); font-size: 0.62rem; letter-spacing: 0.05em;
      text-transform: uppercase; cursor: pointer;
    }
    .add-btn:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .in-hangar { font-size: 0.66rem; color: var(--sc-fg-2); font-style: italic; }

    @media (max-width: 720px) {
      .trigger-label { display: none; }
      .trigger kbd { display: none; }
      .qs-kind { width: auto; }
    }
  `],
})
export class QuickSearchComponent {
  private readonly codex = inject(CodexService);
  private readonly hangar = inject(HangarService);
  private readonly router = inject(Router);

  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');

  readonly visible = signal(false);
  readonly query = signal('');
  readonly loading = signal(false);
  readonly results = signal<QuickResult[]>([]);

  private readonly hangarClassNames = computed(
    () => new Set(this.hangar.ships().map((s) => s.shipClassName)),
  );

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      this.visible() ? this.close() : this.open();
      return;
    }
    if (ev.key === '/' && !this.visible() && !isEditableTarget(ev.target)) {
      ev.preventDefault();
      this.open();
    }
  }

  open(): void {
    this.visible.set(true);
    // hangar list backs the "already in hangar" chips — load once, lazily.
    if (this.hangar.ships().length === 0) void this.hangar.loadAll();
    setTimeout(() => this.searchBox()?.nativeElement.focus(), 0);
  }

  close(): void {
    this.visible.set(false);
    this.query.set('');
    this.results.set([]);
  }

  onQuery(value: string): void {
    this.query.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const term = value.trim();
    if (!term) {
      this.results.set([]);
      return;
    }
    this.searchTimer = setTimeout(() => void this.runSearch(term), SEARCH_DEBOUNCE_MS);
  }

  name(r: CodexListRow): string {
    const p = r.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const en = p?.name ? pickLocalized(p.name, 'en') : '';
    return en || cleanLocaleValue(r.nameLocalized) || humanizeClassName(r.classNameSlug);
  }

  inHangar(classNameSlug: string): boolean {
    return this.hangarClassNames().has(classNameSlug);
  }

  openResult(r: QuickResult): void {
    this.close();
    void this.router.navigate(['/codex', r.kind, r.row.classNameSlug]);
  }

  openFirst(): void {
    const first = this.results()[0];
    if (first) this.openResult(first);
  }

  async addToHangar(ev: Event, row: CodexListRow): Promise<void> {
    ev.stopPropagation();
    await this.hangar.addShip(row.classNameSlug, 'owned');
  }

  private async runSearch(term: string): Promise<void> {
    const seq = ++this.searchSeq;
    this.loading.set(true);
    try {
      const kinds: CodexKind[] = ['ship', 'weapon', 'component'];
      const lists = await Promise.all(
        kinds.map((k) => this.codex.listByKind(k, { search: term, limit: PER_KIND_LIMIT })),
      );
      if (seq !== this.searchSeq) return;
      const merged: QuickResult[] = [];
      kinds.forEach((kind, i) => {
        for (const row of lists[i].rows) merged.push({ kind, row });
      });
      this.results.set(merged);
    } catch {
      if (seq === this.searchSeq) this.results.set([]);
    } finally {
      if (seq === this.searchSeq) this.loading.set(false);
    }
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}
