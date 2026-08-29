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
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CodexListRow, CodexService, fpsArmorAttachType, fpsArmorSlot, pickLocalizedDistinct, toLang } from './codex.service';
import { cleanLocaleValue, humanizeClassName } from './codex-format';
import { CodexCompareTrayComponent } from './codex-compare-tray.component';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { CodexStatusBannerComponent } from './codex-status-banner.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NeuroFieldDirective } from '../core/neuro-field.directive';

const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 250;

// The two categories this section curates. `weapon` = codex_weapons rows with
// weapon_class = 'FPS'; `armor` = codex_items rows with attach_type = 'Armor'.
// Both link to the EXISTING detail route ('weapon'/'item' are real CodexKinds).
type FpsCategory = 'weapon' | 'armor';

// One list row + the concrete detail-route kind it should link to. Armor rows
// route to /codex/item/:className (attach_type='Armor' lives on codex_items).
interface FpsRow extends CodexListRow {
  detailKind: 'weapon' | 'item';
}

/**
 * FPS / on-foot equipment Codex section (issue #251) — a dedicated, curated
 * view over on-foot gear (FPS weapons + armor), analogous to the Blueprint
 * sub-section. Reuses CodexService.listFpsWeapons/listFpsArmor (which reuse
 * the existing buyable-only / variant filtering, dropping the huge pile of
 * `@LOC_PLACEHOLDER` / NPC test rows already filtered elsewhere in the
 * codex). Every card links to the EXISTING detail view (codex/:kind/:className),
 * which already renders the weapon stat block + crafting usage.
 */
@Component({
  selector: 'sc-fps-list',
  standalone: true,
  imports: [NeuroFieldDirective, FormsModule, RouterLink, TranslateModule, CodexCompareTrayComponent, CodexCategoryIconComponent, CodexStatusBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fps-page">
      <header class="head">
        <div class="title-block">
          <a class="back" routerLink="/codex">← {{ 'codex.bridge.backToBridge' | translate }}</a>
          <h1>{{ 'fps.title' | translate }}</h1>
          <p class="hint">{{ 'fps.subtitle' | translate }}</p>
        </div>
        <sc-codex-status-banner />
      </header>

      <!-- Category switcher -->
      <div class="kind-bar" role="tablist" [attr.aria-label]="'fps.categoriesAria' | translate">
        @for (c of categories; track c) {
          <button class="kind" type="button" role="tab"
                  [class.active]="category() === c"
                  [attr.aria-selected]="category() === c"
                  (click)="setCategory(c)">
            <span>{{ ('fps.category.' + c) | translate }}</span>
            @if (categoryCount(c); as ct) {
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
          @if (subTypeOptions().length > 0) {
            <label class="facet">
              <span>{{ (category() === 'weapon' ? 'fps.filters.weaponType' : 'fps.filters.armorSlot') | translate }}</span>
              <select class="sc-select" [ngModel]="subType()" (ngModelChange)="setSubType($event)">
                <option value="">{{ 'codex.filters.all' | translate }}</option>
                @for (s of subTypeOptions(); track s) { <option [value]="s">{{ s }}</option> }
              </select>
            </label>
          }
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
          <label class="facet check">
            <input type="checkbox" [ngModel]="includeVariants()" (ngModelChange)="setIncludeVariants($event)" />
            <span>{{ 'codex.filters.includeVariants' | translate }}</span>
          </label>
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

        @if (category() === 'armor') {
          <p class="partial-note">{{ 'fps.armorStatsHint' | translate }}</p>
        }

        @if (loading() && rows().length === 0) {
          <div class="grid">
            @for (s of skeletons; track s; let i = $index) {
              <div class="card skel sc-skel-field" scNeuroField [neuroIndex]="i" [style.--sc-skel-i]="i"></div>
            }
          </div>
        } @else if (rows().length === 0) {
          <div class="sc-card empty">
            <strong>{{ 'codex.empty.title' | translate }}</strong>
            <p>{{ (hasActiveFilters() || searchInput() ? 'codex.empty.filtered' : ('fps.empty.' + category()) | translate) | translate }}</p>
          </div>
        } @else {
          <div class="grid">
            @for (r of rows(); track r.classNameSlug) {
              <a class="card" [routerLink]="['/codex', r.detailKind, r.classNameSlug]">
                <div class="thumb" [class.icon-only]="!thumb(r)">
                  @if (thumb(r); as src) {
                    <img [src]="src" [alt]="cardName(r)" loading="lazy" (error)="onThumbError(r)" />
                  } @else {
                    <sc-codex-icon [kind]="r.detailKind" [sub]="iconSub(r)" />
                  }
                </div>
                <div class="card-top">
                  <h3 class="name">{{ cardName(r) }}</h3>
                  <button type="button" class="pin"
                          [class.pinned]="isPinned(r)"
                          (click)="togglePin($event, r)"
                          [attr.aria-label]="(isPinned(r) ? 'codex.compare.pinned' : 'codex.compare.pin') | translate">
                    {{ isPinned(r) ? '★' : '☆' }}
                  </button>
                </div>
                <code class="cls">{{ r.classNameSlug }}</code>
                <div class="badges">
                  @if (r.manufacturerCode) { <span class="badge mfr">{{ r.manufacturerCode }}</span> }
                  <span class="badge cat">{{ ('fps.category.' + category()) | translate }}</span>
                  @if (armorSlotOf(r); as slot) { <span class="badge slot">{{ slot }}</span> }
                  @if (r.subType) { <span class="badge subtle">{{ r.subType }}</span> }
                  @if (r.grade) { <span class="badge grade" [attr.data-grade]="r.grade">{{ 'codex.card.grade' | translate: { grade: r.grade } }}</span> }
                  @if (r.isVariant) { <span class="badge variant">{{ 'codex.card.variant' | translate }}</span> }
                </div>
                @if (r.size != null) {
                  <div class="size-bar" [attr.title]="'codex.card.size' | translate: { size: r.size }">
                    <span class="size-track"><span class="size-fill" [style.width.%]="sizePct(r.size)"></span></span>
                    <span class="size-tag">S{{ r.size }}</span>
                  </div>
                }
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
    .fps-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 80px; }

    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    .back { font-size: 0.82rem; color: var(--sc-fg-2); text-decoration: none; }
    .back:hover { color: var(--sc-accent); }
    .title-block { display: flex; flex-direction: column; gap: 4px; }
    .title-block h1 { margin: 4px 0 0; }
    /* The column gap alone sets title-to-subtitle distance (feedback 98f50dfc):
       a margin here stacked on top of it and made this head 4px taller than
       every other list view's. */
    .title-block .hint { color: var(--sc-fg-2); margin: 0; max-width: 60ch; }

    .kind-bar { display: flex; flex-wrap: wrap; gap: 6px; }
    .kind {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 16px; border-radius: 999px;
      border: 1px solid var(--sc-border); background: transparent;
      color: var(--sc-fg-1); font-family: var(--sc-font-display);
      font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase;
      cursor: pointer; transition: all 0.16s;
    }
    .kind:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .kind.active { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .kind-ct { font-size: max(0.68rem, var(--sc-fs-floor)); padding: 0 6px; border-radius: 8px; background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2); }
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
    .facet > span { font-size: max(0.66rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .facet.check { flex-direction: row; align-items: center; gap: 6px; align-self: center; }
    .facet.check span { font-size: max(0.78rem, var(--sc-fs-floor)); text-transform: none; letter-spacing: 0; color: var(--sc-fg-1); }
    .sc-select { background: var(--sc-bg-1); color: var(--sc-fg-0); border: 1px solid var(--sc-border); border-radius: 6px; padding: 7px 10px; font-family: inherit; font-size: 0.82rem; cursor: pointer; min-width: 160px; }
    .sc-select:focus { outline: none; border-color: var(--sc-accent); }
    .reset { align-self: center; padding: 7px 12px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-family: inherit; font-size: max(0.76rem, var(--sc-fs-floor)); cursor: pointer; }
    .reset:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    .result-head { display: flex; align-items: baseline; gap: 12px; }
    .count { font-family: var(--sc-font-display); font-size: 0.82rem; letter-spacing: 0.06em; color: var(--sc-accent); text-transform: uppercase; }
    .showing { font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .partial-note { margin: 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-warning); padding: 6px 10px; border-radius: 6px; background: color-mix(in srgb, var(--sc-warning) 10%, transparent); border: 1px solid color-mix(in srgb, var(--sc-warning) 28%, transparent); }

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
    .card .thumb sc-codex-icon { width: 100%; height: 100%; }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .card .name { margin: 0; font-size: 1rem; font-weight: 600; line-height: 1.25; }
    .card .cls { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); word-break: break-all; }
    .pin { border: none; background: transparent; color: var(--sc-fg-2); font-size: 1.1rem; line-height: 1; cursor: pointer; padding: 0; flex: 0 0 auto; }
    .pin:hover { color: var(--sc-accent); }
    .pin.pinned { color: var(--sc-accent); }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
    .badge { font-size: max(0.66rem, var(--sc-fs-floor)); padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .badge.mfr { background: color-mix(in srgb, var(--sc-accent-hot) 14%, transparent); border-color: color-mix(in srgb, var(--sc-accent-hot) 35%, transparent); }
    .badge.cat { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-1); }
    .badge.subtle { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }
    .badge.slot { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); border-color: color-mix(in srgb, var(--sc-accent) 32%, transparent); color: var(--sc-fg-1); }
    .badge.variant { background: color-mix(in srgb, var(--sc-warning) 16%, transparent); border-color: color-mix(in srgb, var(--sc-warning) 40%, transparent); color: var(--sc-fg-1); }
    .badge.grade[data-grade="A"] { background: color-mix(in srgb, #5fd698 18%, transparent); border-color: color-mix(in srgb, #5fd698 42%, transparent); color: #8fe5b5; }
    .badge.grade[data-grade="B"] { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); color: var(--sc-fg-0); }
    .badge.grade[data-grade="C"] { background: color-mix(in srgb, #f0c419 16%, transparent); border-color: color-mix(in srgb, #f0c419 40%, transparent); color: #f0d060; }
    .badge.grade[data-grade="D"] { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }
    .size-bar { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .size-track { flex: 1; height: 5px; border-radius: 999px; background: var(--sc-bg-2); overflow: hidden; }
    .size-fill { display: block; height: 100%; border-radius: 999px; background: var(--sc-accent); }
    .size-tag { font-size: max(0.64rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); flex: 0 0 auto; }

    .card.skel { min-height: 116px; }

    .more-row { display: flex; justify-content: center; }
    .load-more { padding: 10px 24px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-accent); color: var(--sc-accent); font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
    .load-more:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
    .load-more:disabled { opacity: 0.6; cursor: progress; }

    .empty { text-align: center; padding: 40px 20px; color: var(--sc-fg-1); }
    .empty p { color: var(--sc-fg-2); margin: 6px 0 0; }
    .err { color: var(--sc-danger); padding: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .err .retry { margin-left: auto; padding: 6px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font-family: inherit; }

    @media (max-width: 720px) {
      .head { flex-direction: column; }
    }
  `],
})
export class FpsListComponent implements OnInit {
  readonly svc = inject(CodexService);
  private readonly t = inject(TranslateService);

  private readonly dataLang = signal(toLang(this.t.currentLang));

  readonly categories: readonly FpsCategory[] = ['weapon', 'armor'];
  readonly skeletons = Array.from({ length: 8 }, (_, i) => i);

  readonly category = signal<FpsCategory>('weapon');
  readonly searchInput = signal('');
  private readonly searchTerm = signal('');
  readonly manufacturer = signal('');
  readonly size = signal('');
  readonly grade = signal('');
  readonly subType = signal('');
  readonly includeVariants = signal(false);

  readonly rows = signal<FpsRow[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private offset = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private loadSeq = 0;

  // Entity counts (weapons/armor) shown next to the category tabs — best-effort,
  // populated once the first page of each category has loaded at least once.
  private readonly counts = signal<Partial<Record<FpsCategory, number>>>({});

  readonly manufacturerOptions = computed(() =>
    uniqSorted(this.rows().map((r) => r.manufacturerCode)),
  );
  readonly sizeOptions = computed(() =>
    uniqSorted(this.rows().map((r) => (r.size != null ? String(r.size) : null))).sort(
      (a, b) => Number(a) - Number(b),
    ),
  );
  readonly gradeOptions = computed(() => uniqSorted(this.rows().map((r) => r.grade)));
  // Primary facet: for weapons it is the weapon sub_type (Rifle/Pistol/…); for
  // armor it is the equip SLOT derived from attach_type (Helmet/Torso/Arms/…),
  // NOT sub_type (which for armor is the weight class Light/Medium/Heavy).
  readonly subTypeOptions = computed(() =>
    this.category() === 'armor'
      ? uniqSorted(this.rows().map((r) => fpsArmorSlot(r.attachType)))
      : uniqSorted(this.rows().map((r) => r.subType)),
  );

  readonly hasActiveFilters = computed(
    () =>
      !!this.manufacturer() ||
      !!this.size() ||
      !!this.grade() ||
      !!this.subType() ||
      this.includeVariants(),
  );

  constructor() {
    this.t.onLangChange
      .pipe(takeUntilDestroyed())
      .subscribe((e) => this.dataLang.set(toLang(e.lang)));

    effect(() => {
      this.category();
      this.searchTerm();
      this.manufacturer();
      this.size();
      this.grade();
      this.subType();
      this.includeVariants();
      this.runQuery(true);
    });
  }

  async ngOnInit(): Promise<void> {
    await this.svc.loadCurrentBuild();
  }

  categoryCount(c: FpsCategory): number | null {
    return this.counts()[c] ?? null;
  }

  cardName(r: FpsRow): string {
    const p = r.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const localized = p?.name ? pickLocalizedDistinct(p.name, this.dataLang()) : '';
    return localized || cleanLocaleValue(r.nameLocalized) || humanizeClassName(r.classNameSlug);
  }

  private readonly brokenThumbs = signal<ReadonlySet<string>>(new Set<string>());

  thumb(r: FpsRow): string | null {
    if (this.brokenThumbs().has(r.classNameSlug)) return null;
    const p = r.payload as { previewImage?: string | null } | undefined;
    return this.svc.previewUrl(p?.previewImage);
  }

  onThumbError(r: FpsRow): void {
    const next = new Set(this.brokenThumbs());
    next.add(r.classNameSlug);
    this.brokenThumbs.set(next);
  }

  iconSub(r: FpsRow): string | null {
    return r.subType || null;
  }

  /** Equip slot (Helmet/Torso/…) for an armor row; null for weapons. */
  armorSlotOf(r: FpsRow): string | null {
    return this.category() === 'armor' ? fpsArmorSlot(r.attachType) : null;
  }

  setCategory(c: FpsCategory): void {
    if (c === this.category()) return;
    // sub-type facet doesn't carry across categories (weapon vs armor slots differ)
    this.subType.set('');
    this.manufacturer.set('');
    this.size.set('');
    this.grade.set('');
    this.category.set(c);
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
  setSubType(v: string): void { this.subType.set(v); }
  setIncludeVariants(v: boolean): void { this.includeVariants.set(v); }

  resetFilters(): void {
    this.manufacturer.set('');
    this.size.set('');
    this.grade.set('');
    this.subType.set('');
    this.includeVariants.set(false);
  }

  reload(): void {
    this.runQuery(true);
  }

  loadMore(): void {
    this.offset += PAGE_SIZE;
    this.runQuery(false);
  }

  isPinned(r: FpsRow): boolean {
    return this.svc.isPinned(r.detailKind, r.classNameSlug);
  }

  togglePin(ev: Event, r: FpsRow): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.svc.togglePin(r.detailKind, r.classNameSlug);
  }

  sizePct(size: number): number {
    return Math.min(100, Math.max(8, Math.round((size / 12) * 100)));
  }

  private async runQuery(reset: boolean): Promise<void> {
    if (reset) this.offset = 0;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    const activeCategory = this.category();
    const isArmor = activeCategory === 'armor';
    // For armor the primary facet holds an equip SLOT → filter on attach_type;
    // for weapons it holds the weapon sub_type → filter on sub_type.
    const facetValue = this.subType() || undefined;
    const filters = {
      search: this.searchTerm() || undefined,
      manufacturer: this.manufacturer() || undefined,
      size: this.size() ? Number(this.size()) : undefined,
      grade: this.grade() || undefined,
      subType: isArmor ? undefined : facetValue,
      attachType: isArmor && facetValue ? (fpsArmorAttachType(facetValue) ?? undefined) : undefined,
      includeVariants: this.includeVariants(),
      limit: PAGE_SIZE,
      offset: this.offset,
    };
    try {
      const res =
        activeCategory === 'weapon'
          ? await this.svc.listFpsWeapons(filters)
          : await this.svc.listFpsArmor(filters);
      if (seq !== this.loadSeq) return;
      const detailKind: 'weapon' | 'item' = activeCategory === 'weapon' ? 'weapon' : 'item';
      const rows: FpsRow[] = res.rows.map((r) => ({ ...r, detailKind }));
      this.rows.set(reset ? rows : [...this.rows(), ...rows]);
      this.total.set(res.count);
      this.counts.update((c) => ({ ...c, [activeCategory]: res.count }));
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
