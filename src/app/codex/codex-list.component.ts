import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
  CODEX_KINDS,
  CodexKind,
  CodexListFilters,
  CodexListRow,
  CodexService,
  pickLocalized,
} from './codex.service';
import { cleanLocaleValue, humanizeClassName } from './codex-format';
import { CodexCompareTrayComponent } from './codex-compare-tray.component';

const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 250;

// Component kinds (from codex.types ComponentKind) used to build a facet when
// the active kind is `component`. Options shown are intersected with the data
// actually present (server seeds only a subset).
const COMPONENT_KINDS = [
  'PowerPlant', 'Shield', 'Cooler', 'QuantumDrive', 'Thruster',
  'FuelTank', 'FuelIntake', 'CargoGrid', 'Other',
] as const;

@Component({
  selector: 'sc-codex-list',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, CodexCompareTrayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="codex-page">
      <header class="head">
        <div class="title-block">
          <h1>{{ 'codex.title' | translate }}</h1>
          <p class="hint">{{ 'codex.subtitle' | translate }}</p>
        </div>
        @if (svc.build(); as b) {
          <div class="provenance" [attr.title]="'codex.provenance.tooltip' | translate">
            <span class="prov-label">{{ 'codex.provenance.label' | translate }}</span>
            <strong>{{ 'codex.provenance.build' | translate: { channel: b.channel, patch: b.patchVersion, build: b.buildNumber } }}</strong>
            @if (b.qualityScore != null) {
              <span class="prov-q">{{ 'codex.provenance.quality' | translate: { score: b.qualityScore } }}</span>
            }
          </div>
        }
      </header>

      <!-- Kind switcher -->
      <div class="kind-bar" role="tablist" [attr.aria-label]="'codex.categoriesAria' | translate">
        @for (k of kinds; track k) {
          <button class="kind" type="button" role="tab"
                  [class.active]="kind() === k"
                  [attr.aria-selected]="kind() === k"
                  (click)="setKind(k)">
            <span>{{ ('codex.kinds.' + k) | translate }}</span>
            @if (kindCount(k); as ct) {
              <span class="kind-ct">{{ ct }}</span>
            }
          </button>
        }
      </div>

      <!-- Search + facets -->
      <div class="controls sc-card">
        <div class="search-row">
          <input class="search" type="search" [ngModel]="searchInput()"
                 (ngModelChange)="onSearchInput($event)"
                 [attr.aria-label]="'codex.search.label' | translate"
                 [attr.placeholder]="'codex.search.placeholder' | translate" />
          @if (searchInput()) {
            <button class="search-clear" type="button" (click)="clearSearch()"
                    [attr.aria-label]="'codex.search.clear' | translate">×</button>
          }
        </div>

        <div class="facets">
          @if (manufacturerOptions().length > 0) {
            <label class="facet">
              <span>{{ 'codex.filters.manufacturer' | translate }}</span>
              <select class="sc-select" [ngModel]="manufacturer()" (ngModelChange)="setManufacturer($event)">
                <option value="">{{ 'codex.filters.all' | translate }}</option>
                @for (m of manufacturerOptions(); track m) { <option [value]="m">{{ m }}</option> }
              </select>
            </label>
          }
          @if (sizeOptions().length > 0) {
            <label class="facet">
              <span>{{ 'codex.filters.size' | translate }}</span>
              <select class="sc-select" [ngModel]="size()" (ngModelChange)="setSize($event)">
                <option value="">{{ 'codex.filters.anySize' | translate }}</option>
                @for (s of sizeOptions(); track s) { <option [value]="s">S{{ s }}</option> }
              </select>
            </label>
          }
          @if (gradeOptions().length > 0) {
            <label class="facet">
              <span>{{ 'codex.filters.grade' | translate }}</span>
              <select class="sc-select" [ngModel]="grade()" (ngModelChange)="setGrade($event)">
                <option value="">{{ 'codex.filters.anyGrade' | translate }}</option>
                @for (g of gradeOptions(); track g) { <option [value]="g">{{ g }}</option> }
              </select>
            </label>
          }
          @if (kind() === 'component' && componentKindOptions().length > 0) {
            <label class="facet">
              <span>{{ 'codex.filters.componentKind' | translate }}</span>
              <select class="sc-select" [ngModel]="componentKind()" (ngModelChange)="setComponentKind($event)">
                <option value="">{{ 'codex.filters.all' | translate }}</option>
                @for (c of componentKindOptions(); track c) { <option [value]="c">{{ c }}</option> }
              </select>
            </label>
          }
          @if (kind() === 'weapon' && weaponClassOptions().length > 0) {
            <label class="facet">
              <span>{{ 'codex.filters.weaponClass' | translate }}</span>
              <select class="sc-select" [ngModel]="weaponClass()" (ngModelChange)="setWeaponClass($event)">
                <option value="">{{ 'codex.filters.all' | translate }}</option>
                @for (w of weaponClassOptions(); track w) { <option [value]="w">{{ ('codex.weaponClass.' + w) | translate }}</option> }
              </select>
            </label>
          }
          @if (supportsVariants()) {
            <label class="facet check">
              <input type="checkbox" [ngModel]="includeVariants()" (ngModelChange)="setIncludeVariants($event)" />
              <span>{{ 'codex.filters.includeVariants' | translate }}</span>
            </label>
          }
          @if (hasActiveFilters()) {
            <button class="reset" type="button" (click)="resetFilters()">{{ 'codex.filters.reset' | translate }}</button>
          }
        </div>
      </div>

      <!-- Results -->
      @if (error(); as err) {
        <div class="sc-card err">
          <strong>{{ 'codex.error.title' | translate }}:</strong> {{ err }}
          <button type="button" class="retry" (click)="reload()">{{ 'codex.error.retry' | translate }}</button>
        </div>
      } @else {
        <div class="result-head">
          <span class="count">
            {{ (total() === 1 ? 'codex.results.countOne' : 'codex.results.count') | translate: { count: total() } }}
          </span>
          @if (rows().length < total()) {
            <span class="showing">{{ 'codex.results.showingOf' | translate: { shown: rows().length, total: total() } }}</span>
          }
        </div>

        @if (isPartialKind()) {
          <p class="partial-note">{{ 'codex.empty.partial' | translate }}</p>
        }

        @if (loading() && rows().length === 0) {
          <div class="grid">
            @for (s of skeletons; track s) { <div class="card skel"></div> }
          </div>
        } @else if (rows().length === 0) {
          <div class="sc-card empty">
            <strong>{{ 'codex.empty.title' | translate }}</strong>
            <p>{{ (hasActiveFilters() || searchInput() ? 'codex.empty.filtered' : ('codex.empty.kind' | translate: { kind: ('codex.kinds.' + kind()) | translate })) | translate }}</p>
          </div>
        } @else {
          <div class="grid">
            @for (r of rows(); track r.classNameSlug) {
              <a class="card" [routerLink]="['/codex', kind(), r.classNameSlug]">
                @if (thumb(r); as src) {
                  <div class="thumb"><img [src]="src" [alt]="r.nameLocalized || r.classNameSlug" loading="lazy" /></div>
                }
                <div class="card-top">
                  <h3 class="name">{{ cardName(r) }}</h3>
                  <button type="button" class="pin"
                          [class.pinned]="isPinned(r.classNameSlug)"
                          (click)="togglePin($event, r.classNameSlug)"
                          [attr.aria-label]="(isPinned(r.classNameSlug) ? 'codex.compare.pinned' : 'codex.compare.pin') | translate">
                    {{ isPinned(r.classNameSlug) ? '★' : '☆' }}
                  </button>
                </div>
                <code class="cls">{{ r.classNameSlug }}</code>
                <div class="badges">
                  @if (r.manufacturerCode) { <span class="badge mfr">{{ r.manufacturerCode }}</span> }
                  @if (r.componentKind) { <span class="badge">{{ ('codex.componentKind.' + r.componentKind) | translate }}</span> }
                  @if (r.weaponClass) { <span class="badge">{{ ('codex.weaponClass.' + r.weaponClass) | translate }}</span> }
                  @if (r.subType) { <span class="badge subtle">{{ r.subType }}</span> }
                  @if (r.size != null) { <span class="badge">{{ 'codex.card.size' | translate: { size: r.size } }}</span> }
                  @if (r.grade) { <span class="badge">{{ 'codex.card.grade' | translate: { grade: r.grade } }}</span> }
                  @if (r.crewSize != null) { <span class="badge">{{ 'codex.card.crew' | translate: { count: r.crewSize } }}</span> }
                  @if (r.speed != null) { <span class="badge subtle">{{ r.speed }} m/s</span> }
                  @if (r.isVariant) { <span class="badge variant">{{ 'codex.card.variant' | translate }}</span> }
                </div>
              </a>
            }
          </div>

          @if (rows().length < total()) {
            <div class="more-row">
              <button type="button" class="load-more" [disabled]="loading()" (click)="loadMore()">
                {{ (loading() ? 'codex.results.loading' : 'codex.results.loadMore') | translate }}
              </button>
            </div>
          }
        }
      }

      <sc-codex-compare-tray />
    </section>
  `,
  styles: [`
    :host { display: block; }
    .codex-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 80px; }

    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    .title-block h1 { margin: 0; }
    .title-block .hint { color: var(--sc-fg-2); margin: 4px 0 0; max-width: 60ch; }

    .provenance {
      display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
      padding: 8px 14px; border-radius: 8px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
    }
    .provenance .prov-label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--sc-fg-2); }
    .provenance strong { font-family: var(--sc-font-display); font-size: 0.82rem; letter-spacing: 0.04em; color: var(--sc-accent); }
    .provenance .prov-q { font-size: 0.68rem; color: var(--sc-fg-2); }

    .kind-bar { display: flex; flex-wrap: wrap; gap: 6px; }
    .kind {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 16px; border-radius: 999px;
      border: 1px solid var(--sc-border); background: transparent;
      color: var(--sc-fg-1); font-family: var(--sc-font-display);
      font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase;
      cursor: pointer; transition: all 0.16s;
    }
    .kind:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .kind.active { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .kind-ct { font-size: 0.68rem; padding: 0 6px; border-radius: 8px; background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2); }
    .kind.active .kind-ct { background: color-mix(in srgb, var(--sc-accent) 25%, transparent); color: var(--sc-bg-0); }

    .controls { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; }
    .search-row { position: relative; display: flex; }
    .search {
      flex: 1; padding: 10px 36px 10px 14px; border-radius: 8px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-0);
      font-family: inherit; font-size: 0.92rem;
    }
    .search:focus { outline: none; border-color: var(--sc-accent); box-shadow: 0 0 0 2px rgba(0,212,255,0.22); }
    .search-clear { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); border: none; background: transparent; color: var(--sc-fg-2); font-size: 1.3rem; cursor: pointer; }
    .search-clear:hover { color: var(--sc-danger); }

    .facets { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
    .facet { display: flex; flex-direction: column; gap: 4px; }
    .facet > span { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .facet.check { flex-direction: row; align-items: center; gap: 6px; align-self: center; }
    .facet.check span { font-size: 0.78rem; text-transform: none; letter-spacing: 0; color: var(--sc-fg-1); }
    .sc-select { background: var(--sc-bg-1); color: var(--sc-fg-0); border: 1px solid var(--sc-border); border-radius: 6px; padding: 7px 10px; font-family: inherit; font-size: 0.82rem; cursor: pointer; min-width: 140px; }
    .sc-select:focus { outline: none; border-color: var(--sc-accent); }
    .reset { align-self: center; padding: 7px 12px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-family: inherit; font-size: 0.76rem; cursor: pointer; }
    .reset:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    .result-head { display: flex; align-items: baseline; gap: 12px; }
    .count { font-family: var(--sc-font-display); font-size: 0.82rem; letter-spacing: 0.06em; color: var(--sc-accent); text-transform: uppercase; }
    .showing { font-size: 0.74rem; color: var(--sc-fg-2); }
    .partial-note { margin: 0; font-size: 0.74rem; color: var(--sc-warning); padding: 6px 10px; border-radius: 6px; background: color-mix(in srgb, var(--sc-warning) 10%, transparent); border: 1px solid color-mix(in srgb, var(--sc-warning) 28%, transparent); }

    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .card {
      display: flex; flex-direction: column; gap: 8px;
      padding: 14px; border-radius: 8px; min-height: 116px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1);
      color: inherit; text-decoration: none;
      transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s;
    }
    .card:hover { transform: translateY(-2px); border-color: var(--sc-accent); box-shadow: 0 6px 20px rgba(0,0,0,0.4), 0 0 14px color-mix(in srgb, var(--sc-accent) 28%, transparent); }
    .card .thumb { height: 96px; margin: -4px 0 2px; display: flex; align-items: center; justify-content: center;
      border-radius: 6px; background: radial-gradient(circle at 50% 45%, var(--sc-bg-2), var(--sc-bg-0)); }
    .card .thumb img { max-height: 88px; max-width: 100%; object-fit: contain; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5)); }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .card .name { margin: 0; font-size: 1rem; font-weight: 600; line-height: 1.25; }
    .card .cls { font-size: 0.72rem; color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); word-break: break-all; }
    .pin { border: none; background: transparent; color: var(--sc-fg-2); font-size: 1.1rem; line-height: 1; cursor: pointer; padding: 0; flex: 0 0 auto; }
    .pin:hover { color: var(--sc-accent); }
    .pin.pinned { color: var(--sc-accent); }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
    .badge { font-size: 0.66rem; padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .badge.mfr { background: color-mix(in srgb, var(--sc-accent-hot) 14%, transparent); border-color: color-mix(in srgb, var(--sc-accent-hot) 35%, transparent); }
    .badge.subtle { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }
    .badge.variant { background: color-mix(in srgb, var(--sc-warning) 16%, transparent); border-color: color-mix(in srgb, var(--sc-warning) 40%, transparent); color: var(--sc-fg-1); }

    .card.skel { min-height: 116px; background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    .more-row { display: flex; justify-content: center; }
    .load-more { padding: 10px 24px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-accent); color: var(--sc-accent); font-family: var(--sc-font-display); font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
    .load-more:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
    .load-more:disabled { opacity: 0.6; cursor: progress; }

    .empty { text-align: center; padding: 40px 20px; color: var(--sc-fg-1); }
    .empty p { color: var(--sc-fg-2); margin: 6px 0 0; }
    .err { color: var(--sc-danger); padding: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .err .retry { margin-left: auto; padding: 6px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font-family: inherit; }

    @media (max-width: 720px) {
      .head { flex-direction: column; }
      .provenance { align-items: flex-start; }
    }
  `],
})
export class CodexListComponent implements OnInit {
  readonly svc = inject(CodexService);
  private readonly router = inject(Router);

  readonly kinds = CODEX_KINDS;
  readonly skeletons = Array.from({ length: 8 }, (_, i) => i);

  /** Preview-image URL for a list row, or null when the entity has no art. */
  thumb(r: CodexListRow): string | null {
    const p = r.payload as { previewImage?: string | null } | undefined;
    return this.svc.previewUrl(p?.previewImage);
  }

  /**
   * Card title — English SC name (SC has no real translations; see detail view).
   * Falls back to the denormalized name, then the raw class name.
   */
  cardName(r: CodexListRow): string {
    const p = r.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const en = p?.name ? pickLocalized(p.name, 'en') : '';
    return en || cleanLocaleValue(r.nameLocalized) || humanizeClassName(r.classNameSlug);
  }

  readonly kind = signal<CodexKind>('ship');
  readonly searchInput = signal('');
  private readonly searchTerm = signal('');
  readonly manufacturer = signal('');
  readonly size = signal('');
  readonly grade = signal('');
  readonly componentKind = signal('');
  readonly weaponClass = signal('');
  readonly includeVariants = signal(false);

  readonly rows = signal<CodexListRow[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private offset = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private loadSeq = 0;

  // Facet options derived from the rows actually loaded for the active kind.
  readonly manufacturerOptions = computed(() =>
    uniqSorted(this.rows().map((r) => r.manufacturerCode)),
  );
  readonly sizeOptions = computed(() =>
    uniqSorted(this.rows().map((r) => (r.size != null ? String(r.size) : null))).sort(
      (a, b) => Number(a) - Number(b),
    ),
  );
  readonly gradeOptions = computed(() => uniqSorted(this.rows().map((r) => r.grade)));
  readonly componentKindOptions = computed(() => {
    const present = new Set(this.rows().map((r) => r.componentKind).filter(Boolean));
    return COMPONENT_KINDS.filter((k) => present.has(k));
  });
  readonly weaponClassOptions = computed(() => uniqSorted(this.rows().map((r) => r.weaponClass)));

  readonly supportsVariants = computed(
    () => this.kind() !== 'ammunition' && this.kind() !== 'manufacturer' && this.kind() !== 'blueprint',
  );

  readonly hasActiveFilters = computed(
    () =>
      !!this.manufacturer() ||
      !!this.size() ||
      !!this.grade() ||
      !!this.componentKind() ||
      !!this.weaponClass() ||
      this.includeVariants(),
  );

  constructor() {
    // Re-query whenever kind, search term or any facet changes.
    effect(() => {
      // track dependencies
      this.kind();
      this.searchTerm();
      this.manufacturer();
      this.size();
      this.grade();
      this.componentKind();
      this.weaponClass();
      this.includeVariants();
      this.runQuery(true);
    });
  }

  async ngOnInit(): Promise<void> {
    await this.svc.loadCurrentBuild();
  }

  // True when the current build only seeded a subset of this kind (seeded <
  // full extractor count) — surfaces an honest "representative subset" note.
  readonly isPartialKind = computed(() => {
    const counts = this.svc.build()?.entityCounts;
    if (!counts?.seeded) return false;
    const plural = this.kind() === 'ammunition' ? 'ammunition' : `${this.kind()}s`;
    const seeded = counts.seeded[plural];
    const full = counts[plural];
    return typeof seeded === 'number' && typeof full === 'number' && seeded < full;
  });

  kindCount(k: CodexKind): number | null {
    const counts = this.svc.build()?.entityCounts;
    if (!counts) return null;
    // entity_counts uses plural keys (ships/weapons/...) per the manifest.
    const plural = k === 'ammunition' ? 'ammunition' : `${k}s`;
    const seeded = counts.seeded?.[plural];
    const total = counts[plural];
    const v = seeded ?? total;
    return typeof v === 'number' ? v : null;
  }

  setKind(k: CodexKind): void {
    if (k === this.kind()) return;
    // Blueprint has its own dedicated list route — navigate away instead of
    // trying to run the generic listByKind query (different table/columns).
    if (k === 'blueprint') {
      void this.router.navigate(['/codex/blueprint']);
      return;
    }
    // reset facets that don't apply across kinds
    this.manufacturer.set('');
    this.size.set('');
    this.grade.set('');
    this.componentKind.set('');
    this.weaponClass.set('');
    this.kind.set(k);
  }

  onSearchInput(value: string): void {
    this.searchInput.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.searchTerm.set(value), SEARCH_DEBOUNCE_MS);
  }

  clearSearch(): void {
    this.searchInput.set('');
    this.searchTerm.set('');
  }

  setManufacturer(v: string): void { this.manufacturer.set(v); }
  setSize(v: string): void { this.size.set(v); }
  setGrade(v: string): void { this.grade.set(v); }
  setComponentKind(v: string): void { this.componentKind.set(v); }
  setWeaponClass(v: string): void { this.weaponClass.set(v); }
  setIncludeVariants(v: boolean): void { this.includeVariants.set(v); }

  resetFilters(): void {
    this.manufacturer.set('');
    this.size.set('');
    this.grade.set('');
    this.componentKind.set('');
    this.weaponClass.set('');
    this.includeVariants.set(false);
  }

  reload(): void {
    this.runQuery(true);
  }

  loadMore(): void {
    this.offset += PAGE_SIZE;
    this.runQuery(false);
  }

  isPinned(className: string): boolean {
    return this.svc.isPinned(this.kind(), className);
  }

  togglePin(ev: Event, className: string): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.svc.togglePin(this.kind(), className);
  }

  private buildFilters(): CodexListFilters {
    return {
      search: this.searchTerm() || undefined,
      manufacturer: this.manufacturer() || undefined,
      size: this.size() ? Number(this.size()) : undefined,
      grade: this.grade() || undefined,
      componentKind: this.componentKind() || undefined,
      weaponClass: this.weaponClass() || undefined,
      includeVariants: this.includeVariants(),
      limit: PAGE_SIZE,
      offset: this.offset,
    };
  }

  private async runQuery(reset: boolean): Promise<void> {
    if (reset) this.offset = 0;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    const activeKind = this.kind();
    try {
      const res = await this.svc.listByKind(activeKind, this.buildFilters());
      if (seq !== this.loadSeq) return;
      this.rows.set(reset ? res.rows : [...this.rows(), ...res.rows]);
      this.total.set(res.count);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.error.set((err as Error).message ?? 'Unknown error');
      if (reset) {
        this.rows.set([]);
        this.total.set(0);
      }
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }
}

function uniqSorted(values: (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) =>
    a.localeCompare(b),
  );
}
