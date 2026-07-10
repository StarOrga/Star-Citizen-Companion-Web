import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  TemplateRef,
  ViewContainerRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
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
import { AuthService } from '../auth/auth.service';
import { HangarService } from '../hangar/hangar.service';

interface QuickResult {
  kind: CodexKind;
  row: CodexListRow;
}

/** Search scope: 'all' or one of the searchable entity kinds. */
type SearchCategory = 'all' | 'ship' | 'weapon' | 'component';
const SEARCH_CATEGORIES: readonly SearchCategory[] = ['all', 'ship', 'weapon', 'component'];

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

    <!-- Rendered through a CDK overlay (portaled to <body>) rather than inline:
         the app header (.topbar) uses backdrop-filter, which establishes a
         containing block for position:fixed descendants. Inline, the full-screen
         backdrop would be clipped to the header instead of covering the viewport. -->
    <ng-template #overlayTpl>
      <div class="overlay" (click)="close()">
        <div class="panel sc-card" role="dialog" [attr.aria-label]="'quickSearch.open' | translate" (click)="$event.stopPropagation()">
          <input
            class="qs-input"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="qs-results-list"
            [attr.aria-activedescendant]="activeDescendant()"
            [ngModel]="query()"
            (ngModelChange)="onQuery($event)"
            (keydown.enter)="onEnter($event)"
            (keydown.arrowdown)="moveActive($event, 1)"
            (keydown.arrowup)="moveActive($event, -1)"
            [attr.placeholder]="'quickSearch.placeholder' | translate" />

          <div class="qs-cats" role="tablist" [attr.aria-label]="'quickSearch.category.groupAria' | translate">
            @for (cat of categories; track cat) {
              <button type="button" class="qs-cat" role="tab"
                      [class.active]="category() === cat"
                      [attr.aria-selected]="category() === cat"
                      (click)="setCategory(cat)">
                <span>{{ ('quickSearch.category.' + cat) | translate }}</span>
                @if (query() && categoryCount(cat) > 0) { <span class="qs-cat-ct">{{ categoryCount(cat) }}</span> }
              </button>
            }
          </div>

          @if (loading()) {
            <p class="state">{{ 'quickSearch.searching' | translate }}</p>
          } @else if (query() && displayResults().length === 0) {
            <p class="state">{{ 'quickSearch.noResults' | translate }}</p>
          } @else if (!query()) {
            <p class="state hint">{{ 'quickSearch.hint' | translate }}</p>
          }

          <!-- Primary category empty but cross-category matches exist: keep the
               chosen scope's intent, then fall back to "other matches" (the
               "M5A laser cannon under Ships" case from the feedback). -->
          @if (noneInCategory()) {
            <p class="state cat-empty">{{ 'quickSearch.noneInCategory' | translate: { category: (('quickSearch.category.' + category()) | translate) } }}</p>
          }

          @if (displayResults().length > 0) {
            <ul class="qs-results" id="qs-results-list" role="listbox">
              @for (r of displayResults(); track r.kind + ':' + r.row.classNameSlug; let i = $index) {
                @if (i === firstOtherIndex()) {
                  <li class="qs-divider" role="presentation">{{ 'quickSearch.otherMatches' | translate }}</li>
                }
                <li class="qs-row"
                    role="option"
                    [id]="'qs-opt-' + i"
                    [class.active]="i === activeIndex()"
                    [attr.aria-selected]="i === activeIndex()"
                    (click)="openResult(r)"
                    (mouseenter)="activeIndex.set(i)">
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
                  @if (r.kind === 'ship' && auth.user()) {
                    <!-- Add-to-hangar needs a session (RLS self-only) — hidden for anon (#131). -->
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

          <p class="qs-nav-hint">{{ 'quickSearch.navHint' | translate }}</p>
        </div>
      </div>
    </ng-template>
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
      background: rgba(0, 0, 0, 0.68);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
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
    .qs-cats { display: flex; gap: 6px; flex-wrap: wrap; }
    .qs-cat {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px; border-radius: 999px;
      border: 1px solid var(--sc-border); background: transparent;
      color: var(--sc-fg-1); font-family: inherit; font-size: 0.74rem; cursor: pointer;
      transition: border-color .16s, background .16s, color .16s;
    }
    .qs-cat:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .qs-cat.active { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); border-color: var(--sc-accent); color: var(--sc-fg-0); font-weight: 600; }
    .qs-cat-ct { font-size: 0.64rem; padding: 0 6px; border-radius: 8px; background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2); }
    .qs-cat.active .qs-cat-ct { background: color-mix(in srgb, var(--sc-accent) 25%, transparent); color: var(--sc-bg-0); }
    .state.cat-empty { color: var(--sc-warning); font-style: italic; }
    .qs-divider { list-style: none; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); padding: 6px 4px 2px; border-top: 1px dashed color-mix(in srgb, var(--sc-border) 70%, transparent); margin-top: 2px; }
    .state { margin: 0; color: var(--sc-fg-2); font-size: 0.84rem; padding: 2px 4px; }
    .qs-results { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .qs-row {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 10px; border-radius: 6px; cursor: pointer;
      background: var(--sc-bg-0); border: 1px solid transparent;
    }
    .qs-row:hover,
    .qs-row.active { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 8%, var(--sc-bg-0)); }
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
    .qs-nav-hint {
      margin: 0; padding: 6px 4px 0; border-top: 1px solid var(--sc-border);
      color: var(--sc-fg-2); font-size: 0.7rem; text-align: center; letter-spacing: 0.03em;
    }

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
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly overlay = inject(Overlay);
  private readonly viewContainer = inject(ViewContainerRef);

  private readonly overlayTpl = viewChild.required<TemplateRef<unknown>>('overlayTpl');
  private overlayRef: OverlayRef | null = null;

  readonly visible = signal(false);
  readonly query = signal('');
  readonly loading = signal(false);
  /** Raw merged matches across all searchable kinds (unfiltered store). */
  readonly results = signal<QuickResult[]>([]);
  readonly activeIndex = signal(0);
  readonly category = signal<SearchCategory>('all');
  readonly categories = SEARCH_CATEGORIES;

  /**
   * Results ordered for the active category: 'all' keeps the merged order;
   * a specific category floats its own kind to the top, then appends the rest
   * as "other matches" so nothing a user typed goes missing (feedback 55820e0c).
   */
  readonly displayResults = computed<QuickResult[]>(() => {
    const all = this.results();
    const cat = this.category();
    if (cat === 'all') return all;
    const primary = all.filter((r) => r.kind === cat);
    const others = all.filter((r) => r.kind !== cat);
    return [...primary, ...others];
  });

  /** Count of matches for a category tab ('all' = total). */
  categoryCount(cat: SearchCategory): number {
    const all = this.results();
    return cat === 'all' ? all.length : all.filter((r) => r.kind === cat).length;
  }

  /** True when the chosen category has no match but other kinds do. */
  readonly noneInCategory = computed(
    () =>
      this.category() !== 'all' &&
      this.results().length > 0 &&
      this.categoryCount(this.category()) === 0,
  );

  /** Index of the first "other matches" row (divider anchor), or -1. */
  readonly firstOtherIndex = computed(() => {
    const cat = this.category();
    if (cat === 'all') return -1;
    const primaryCount = this.categoryCount(cat);
    // No divider when there are no primaries (info line covers it) or no others.
    return primaryCount > 0 && primaryCount < this.displayResults().length ? primaryCount : -1;
  });

  /** id of the currently active <li> for aria-activedescendant (empty when no results). */
  readonly activeDescendant = computed(() =>
    this.displayResults().length > 0 ? `qs-opt-${this.activeIndex()}` : null,
  );

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
    // Escape closes from anywhere while open — handled on the document (not on
    // the input) so it works regardless of focus, and pre-empts the native
    // type="search" "clear field" default.
    if (ev.key === 'Escape' && this.visible()) {
      ev.preventDefault();
      this.close();
      return;
    }
    if (ev.key === '/' && !this.visible() && !isEditableTarget(ev.target)) {
      ev.preventDefault();
      this.open();
    }
  }

  open(): void {
    if (this.visible()) return;
    this.visible.set(true);
    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().global(),
      scrollStrategy: this.overlay.scrollStrategies.noop(),
    });
    overlayRef.attach(new TemplatePortal(this.overlayTpl(), this.viewContainer));
    this.overlayRef = overlayRef;
    // hangar list backs the "already in hangar" chips — load once, lazily.
    if (this.hangar.ships().length === 0) void this.hangar.loadAll();
    setTimeout(
      () => overlayRef.overlayElement.querySelector<HTMLInputElement>('.qs-input')?.focus(),
      0,
    );
  }

  close(): void {
    this.visible.set(false);
    this.query.set('');
    this.results.set([]);
    this.activeIndex.set(0);
    this.category.set('all');
    this.overlayRef?.dispose();
    this.overlayRef = null;
  }

  /** Switch the active search scope; keeps the query, re-orders results. */
  setCategory(cat: SearchCategory): void {
    this.category.set(cat);
    this.activeIndex.set(0);
  }

  onQuery(value: string): void {
    this.query.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const term = value.trim();
    if (!term) {
      this.results.set([]);
      this.activeIndex.set(0);
      return;
    }
    this.searchTimer = setTimeout(() => void this.runSearch(term), SEARCH_DEBOUNCE_MS);
  }

  /** Move the active row by delta (keyboard nav), clamped to bounds, then scroll it into view. */
  moveActive(ev: Event, delta: number): void {
    const count = this.displayResults().length;
    if (count === 0) return;
    ev.preventDefault();
    const next = Math.min(count - 1, Math.max(0, this.activeIndex() + delta));
    this.activeIndex.set(next);
    setTimeout(() => {
      document
        .getElementById(`qs-opt-${next}`)
        ?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }

  onEnter(ev: Event): void {
    ev.preventDefault();
    this.openActive();
  }

  openActive(): void {
    const r = this.displayResults()[this.activeIndex()];
    if (r) this.openResult(r);
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
      this.activeIndex.set(0);
    } catch {
      if (seq === this.searchSeq) {
        this.results.set([]);
        this.activeIndex.set(0);
      }
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
