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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  CODEX_KINDS,
  CodexKind,
  CodexListFilters,
  CodexListRow,
  CodexService,
  pickLocalizedDistinct,
  toLang,
} from './codex.service';
import { UpcomingGridComponent } from './upcoming-grid.component';
import { FallbackImageComponent } from './fallback-image.component';
import { UpcomingShipsService } from './upcoming-ships.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  cleanLocaleValue,
  formatCraftTime,
  humanizeBlueprintCategory,
  humanizeBlueprintName,
  humanizeClassName,
} from './codex-format';
import { CodexCompareTrayComponent } from './codex-compare-tray.component';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { CodexStatusBannerComponent } from './codex-status-banner.component';
import { HangarService } from '../hangar/hangar.service';

const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 250;

// Component kinds (from codex.types ComponentKind) used to build a facet when
// the active kind is `component`. Options shown are intersected with the data
// actually present (server seeds only a subset).
const COMPONENT_KINDS = [
  'PowerPlant', 'Shield', 'Cooler', 'QuantumDrive', 'Thruster',
  'FuelTank', 'FuelIntake', 'CargoGrid', 'Other',
] as const;

/**
 * The category strip is a superset of the datamined kinds: `upcoming` is a
 * category of the SAME catalog (ships RSI has announced but our extraction has
 * no record of yet), so it belongs in this bar rather than behind its own
 * sub-tab. It is not a `CodexKind` — no table backs it; the feed comes from the
 * `rsi-upcoming-ships` edge function.
 */
export const UPCOMING_CATEGORY = 'upcoming' as const;
export type CodexCategory = CodexKind | typeof UPCOMING_CATEGORY;

@Component({
  selector: 'sc-codex-list',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, CodexCompareTrayComponent, CodexCategoryIconComponent, CodexStatusBannerComponent, UpcomingGridComponent, FallbackImageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="codex-page">
      <header class="head">
        <div class="title-block">
          <a class="to-bridge" routerLink="/codex">← {{ 'codex.bridge.backToBridge' | translate }}</a>
          <h1>{{ 'codex.index.title' | translate }}</h1>
          <p class="hint">{{ 'codex.subtitle' | translate }}</p>
        </div>
        <sc-codex-status-banner />
      </header>

      <!-- Category switcher (datamined kinds + the RSI "upcoming" category) -->
      <div class="kind-bar" role="tablist" [attr.aria-label]="'codex.categoriesAria' | translate">
        @for (k of categories; track k) {
          <button class="kind" type="button" role="tab"
                  [class.active]="category() === k"
                  [class.soon]="isComingSoon(k)"
                  [disabled]="isComingSoon(k)"
                  [attr.aria-selected]="category() === k"
                  [attr.title]="isComingSoon(k) ? ('codex.soon' | translate) : null"
                  (click)="setCategory(k)">
            <span>{{ ('codex.kinds.' + k) | translate }}</span>
            @if (isComingSoon(k)) {
              <span class="kind-ct soon-tag">{{ 'codex.soonShort' | translate }}</span>
            } @else if (categoryCount(k); as ct) {
              <span class="kind-ct">{{ ct }}</span>
            }
          </button>
        }
      </div>

      @if (isUpcoming()) {
        <p class="hint upcoming-lede">{{ 'codex.upcoming.subtitle' | translate }}</p>
        <sc-upcoming-grid />
      } @else {

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
          @if (kind() === 'blueprint' && blueprintCategoryOptions().length > 0) {
            <label class="facet">
              <span>{{ 'blueprint.filters.category' | translate }}</span>
              <select class="sc-select" [ngModel]="blueprintCategory()" (ngModelChange)="setBlueprintCategory($event)">
                <option value="">{{ 'codex.filters.all' | translate }}</option>
                @for (c of blueprintCategoryOptions(); track c) { <option [value]="c">{{ categoryLabel(c) }}</option> }
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
        @if (blueprintRecipesMissing()) {
          <p class="partial-note">{{ 'blueprint.recipesMissing' | translate }}</p>
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
                <div class="thumb" [class.icon-only]="thumbs(r).length === 0">
                  <sc-fallback-image [candidates]="thumbs(r)" [alt]="cardName(r)">
                    <sc-codex-icon [kind]="kind()" [sub]="iconSub(r)" />
                  </sc-fallback-image>
                </div>
                <div class="card-top">
                  <h3 class="name">{{ cardName(r) }}</h3>
                  <div class="card-actions">
                    @if (kind() === 'ship') {
                      @if (inHangarSet().has(r.classNameSlug)) {
                        <span class="hangar-chip" [attr.title]="'codex.card.inHangar' | translate">✓</span>
                      } @else {
                        <button type="button" class="hangar-add"
                                (click)="addShipToHangar($event, r.classNameSlug)"
                                [attr.aria-label]="'quickSearch.addToHangar' | translate"
                                [attr.title]="'quickSearch.addToHangar' | translate">+</button>
                      }
                    }
                    <button type="button" class="pin"
                            [class.pinned]="isPinned(r.classNameSlug)"
                            (click)="togglePin($event, r.classNameSlug)"
                            [attr.aria-label]="(isPinned(r.classNameSlug) ? 'codex.compare.pinned' : 'codex.compare.pin') | translate">
                      {{ isPinned(r.classNameSlug) ? '★' : '☆' }}
                    </button>
                  </div>
                </div>
                <code class="cls">{{ r.classNameSlug }}</code>
                <div class="badges">
                  @if (r.manufacturerCode) { <span class="badge mfr">{{ r.manufacturerCode }}</span> }
                  @if (r.componentKind) { <span class="badge">{{ ('codex.componentKind.' + r.componentKind) | translate }}</span> }
                  @if (r.weaponClass) { <span class="badge">{{ ('codex.weaponClass.' + r.weaponClass) | translate }}</span> }
                  @if (r.subType) { <span class="badge subtle">{{ r.subType }}</span> }
                  @if (r.grade) { <span class="badge grade" [attr.data-grade]="r.grade">{{ 'codex.card.grade' | translate: { grade: r.grade } }}</span> }
                  @if (r.crewSize != null) { <span class="badge">{{ 'codex.card.crew' | translate: { count: r.crewSize } }}</span> }
                  @if (r.speed != null) { <span class="badge subtle">{{ r.speed }} m/s</span> }
                  @if (r.isVariant) { <span class="badge variant">{{ 'codex.card.variant' | translate }}</span> }
                  @if (r.blueprintCategory) { <span class="badge">{{ categoryLabel(r.blueprintCategory) }}</span> }
                  @if (r.blueprintTier != null) { <span class="badge">{{ 'blueprint.card.tier' | translate: { tier: r.blueprintTier } }}</span> }
                  @if (craftTimeLabel(r); as ct) { <span class="badge subtle">{{ ct }}</span> }
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
      }

      <sc-codex-compare-tray />
    </section>
  `,
  styles: [`
    :host { display: block; }
    .codex-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 80px; }

    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    .to-bridge { display: inline-block; margin-bottom: 8px; font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.04em; color: var(--sc-accent); text-decoration: none; }
    .to-bridge:hover { text-decoration: underline; }
    .title-block h1 { margin: 0; }
    .title-block .hint { color: var(--sc-fg-2); margin: 4px 0 0; max-width: 60ch; }

    .upcoming-lede { margin: -4px 0 0; color: var(--sc-fg-2); font-size: 0.86rem; max-width: 72ch; }

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
    .kind.soon { opacity: 0.5; cursor: not-allowed; }
    .kind.soon:hover { color: var(--sc-fg-1); border-color: var(--sc-border); }
    .kind-ct.soon-tag { background: color-mix(in srgb, var(--sc-warning, #f0c419) 22%, transparent); color: var(--sc-warning, #f0c419); text-transform: uppercase; letter-spacing: 0.04em; }

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
    .sc-select { background: var(--sc-bg-1); color: var(--sc-fg-0); border: 1px solid var(--sc-border); border-radius: 6px; padding: 7px 10px; font-family: inherit; font-size: 0.82rem; cursor: pointer; min-width: 140px; }
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
      border-radius: 6px; background: radial-gradient(circle at 50% 45%, var(--sc-bg-2), var(--sc-bg-0));
      /* sc-fallback-image owns the <img>; sizing crosses the boundary as a var. */
      --sc-img-max-h: 88px; }
    .card .thumb sc-codex-icon { width: 100%; height: 100%; }
    .card:hover .thumb sc-codex-icon { transform: scale(1.05); transition: transform 0.16s; }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .card .name { margin: 0; font-size: 1rem; font-weight: 600; line-height: 1.25; }
    .card .cls { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); word-break: break-all; }
    .card-actions { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }
    .pin { border: none; background: transparent; color: var(--sc-fg-2); font-size: 1.1rem; line-height: 1; cursor: pointer; padding: 0; flex: 0 0 auto; }
    .pin:hover { color: var(--sc-accent); }
    .pin.pinned { color: var(--sc-accent); }
    .hangar-chip { font-size: 0.82rem; line-height: 1; color: var(--sc-success, #5fd698); }
    .hangar-add { border: 1px solid var(--sc-border); background: transparent; color: var(--sc-fg-2); font-size: 1rem; line-height: 1; width: 22px; height: 22px; border-radius: 6px; cursor: pointer; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
    .hangar-add:hover { color: var(--sc-success, #5fd698); border-color: var(--sc-success, #5fd698); }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
    .badge { font-size: max(0.66rem, var(--sc-fs-floor)); padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .badge.mfr { background: color-mix(in srgb, var(--sc-accent-hot) 14%, transparent); border-color: color-mix(in srgb, var(--sc-accent-hot) 35%, transparent); }
    .badge.subtle { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }
    .badge.variant { background: color-mix(in srgb, var(--sc-warning) 16%, transparent); border-color: color-mix(in srgb, var(--sc-warning) 40%, transparent); color: var(--sc-fg-1); }
    .badge.grade[data-grade="A"] { background: color-mix(in srgb, #5fd698 18%, transparent); border-color: color-mix(in srgb, #5fd698 42%, transparent); color: #8fe5b5; }
    .badge.grade[data-grade="B"] { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); color: var(--sc-fg-0); }
    .badge.grade[data-grade="C"] { background: color-mix(in srgb, #f0c419 16%, transparent); border-color: color-mix(in srgb, #f0c419 40%, transparent); color: #f0d060; }
    .badge.grade[data-grade="D"] { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }
    .size-bar { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .size-track { flex: 1; height: 5px; border-radius: 999px; background: var(--sc-bg-2); overflow: hidden; }
    .size-fill { display: block; height: 100%; border-radius: 999px; background: var(--sc-accent); }
    .size-tag { font-size: max(0.64rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); flex: 0 0 auto; }

    .card.skel { min-height: 116px; background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

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
export class CodexListComponent implements OnInit {
  readonly svc = inject(CodexService);
  private readonly t = inject(TranslateService);
  private readonly hangar = inject(HangarService);
  private readonly rsi = inject(UpcomingShipsService);
  private readonly route = inject(ActivatedRoute);

  // Data language tracks the UI language as a SIGNAL so OnPush card titles
  // re-render on a language switch (they previously read t.currentLang
  // directly and stayed stale until the next unrelated CD cycle). (#50)
  private readonly dataLang = signal(toLang(this.t.currentLang));

  readonly kinds = CODEX_KINDS;
  /** Datamined kinds + the RSI-sourced "upcoming ships" category. */
  readonly categories: readonly CodexCategory[] = [...CODEX_KINDS, UPCOMING_CATEGORY];
  readonly skeletons = Array.from({ length: 8 }, (_, i) => i);

  // UC-02: class names already in the hangar — a pure read-overlay over the
  // hangar.ships() signal (no DB change), so ship cards can mark ownership.
  readonly inHangarSet = computed(() => new Set(this.hangar.ships().map((s) => s.shipClassName)));

  /**
   * Kinds whose catalog isn't ingested yet — shown but disabled. (UC-13)
   *
   * Derived from the build manifest, never hardcoded: `blueprint` was pinned to
   * "coming soon" long after the uploader started shipping blueprints, which
   * left 1595 ingested rows unreachable (the tab was disabled and `setKind`
   * refused it, and nothing else in the UI links to /codex/blueprint).
   * Unknown count → enabled; only an explicit 0 disables a kind.
   */
  isComingSoon(k: CodexCategory): boolean {
    // The upcoming category is fed by RSI, not by a build manifest — it is
    // never "coming soon" and never disabled.
    if (k === UPCOMING_CATEGORY) return false;
    return this.kindCount(k) === 0;
  }

  /** Human label for a raw CIG blueprint bucket, translated when we have a key. */
  categoryLabel(c: string): string {
    // Read the language signal so OnPush re-renders labels on a DE/EN switch.
    this.dataLang();
    const key = `blueprint.category.${c}`;
    const translated = this.t.instant(key);
    return translated && translated !== key ? translated : humanizeBlueprintCategory(c);
  }

  /**
   * Ordered art candidates for a list row: the datamined preview render first,
   * then — for ships — the RSI ship-matrix artwork for the same hull.
   *
   * Only ~6% of catalog entities ship a datamined render (UC-01), and a render
   * that 404s used to drop the card straight to the category glyph. RSI already
   * publishes a store render for nearly every hull we hold, so the Codex now
   * borrows it instead of showing an empty silhouette. `sc-fallback-image`
   * walks the list and renders the glyph only when every candidate failed.
   */
  thumbs(r: CodexListRow): string[] {
    const out: string[] = [];
    const p = r.payload as { previewImage?: string | null } | undefined;
    const local = this.svc.previewUrl(p?.previewImage);
    if (local) out.push(local);
    // Match on the denormalized `name_localized` — the very column the edge
    // function keys `gameShipArt` by, so no second normalization dialect exists.
    if (this.kind() === 'ship') out.push(...this.rsi.artFor(r.nameLocalized ?? this.cardName(r)));
    return out;
  }

  /** Sub-category that refines the fallback icon (componentKind/weaponClass/subType). */
  iconSub(r: CodexListRow): string | null {
    return r.componentKind || r.weaponClass || r.subType || null;
  }

  /**
   * Card title in the app language with EN fallback (UC-08), then the
   * denormalized name, then the raw class name.
   */
  cardName(r: CodexListRow): string {
    const p = r.payload as { name?: { de: string; en: string; key: string } } | undefined;
    // Distinct-pick: DE only when genuinely translated, EN otherwise. (#50)
    const localized = p?.name ? pickLocalizedDistinct(p.name, this.dataLang()) : '';
    const fallback =
      this.kind() === 'blueprint'
        ? humanizeBlueprintName(r.classNameSlug)
        : humanizeClassName(r.classNameSlug);
    return localized || cleanLocaleValue(r.nameLocalized) || fallback;
  }

  /**
   * Active category strip entry. `kind` stays the last DATA kind so the query
   * effect, the compare tray and the facet state survive a detour through the
   * upcoming category unchanged.
   */
  readonly category = signal<CodexCategory>('ship');
  readonly isUpcoming = computed(() => this.category() === UPCOMING_CATEGORY);
  readonly kind = signal<CodexKind>('ship');
  readonly searchInput = signal('');
  private readonly searchTerm = signal('');
  readonly manufacturer = signal('');
  readonly size = signal('');
  readonly grade = signal('');
  readonly componentKind = signal('');
  readonly weaponClass = signal('');
  readonly includeVariants = signal(false);
  /** Blueprint-only facet — raw CIG bucket, '' = all. */
  readonly blueprintCategory = signal('');
  /** Buckets actually present in the build (loaded once, data-driven). */
  readonly blueprintCategoryOptions = signal<string[]>([]);

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
      !!this.blueprintCategory() ||
      this.includeVariants(),
  );

  /**
   * True when the build carries blueprints but zero recipe rows — the list is
   * still useful (names, tiers, craft times) but every detail page will be
   * ingredient-less, so say so instead of looking broken.
   */
  readonly blueprintRecipesMissing = computed(() => {
    if (this.kind() !== 'blueprint') return false;
    const counts = this.svc.build()?.entityCounts as Record<string, unknown> | undefined;
    if (!counts) return false;
    const blueprints = counts['blueprints'];
    const ingredients = counts['blueprint_ingredients'];
    return typeof blueprints === 'number' && blueprints > 0 && ingredients === 0;
  });

  /** Craft-time badge for a blueprint card, or null when unknown. */
  craftTimeLabel(r: CodexListRow): string | null {
    return formatCraftTime(r.craftTimeSec);
  }

  constructor() {
    // Keep the data language in sync with UI language switches. (#50)
    this.t.onLangChange
      .pipe(takeUntilDestroyed())
      .subscribe((e) => this.dataLang.set(toLang(e.lang)));
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
      this.blueprintCategory();
      this.runQuery(true);
    });
  }

  async ngOnInit(): Promise<void> {
    this.applyRouteCategory();
    // RSI artwork for ship cards + the upcoming badge count. Advisory and
    // silent: a failure just leaves the datamined renders as they were.
    void this.rsi.ensureLoaded();
    await this.svc.loadCurrentBuild();
    // UC-02: hangar membership backs the in-hangar badge on ship cards.
    if (this.hangar.ships().length === 0) void this.hangar.loadAll();
    await this.loadBlueprintCategories();
  }

  /**
   * Preselect a category from the route: `data.category` (the legacy
   * `/codex/upcoming` deep link, kept alive for the Verse-News CTA and any
   * bookmark) or `?kind=` on `/codex/index`. Unknown values are ignored.
   */
  private applyRouteCategory(): void {
    const snap = this.route.snapshot;
    const wanted = (snap.data['category'] ?? snap.queryParamMap.get('kind') ?? '') as string;
    const match = this.categories.find((c) => c === wanted);
    if (match) this.setCategory(match);
  }

  /** Facet source for the blueprint kind. Advisory — a failure just hides it. */
  private async loadBlueprintCategories(): Promise<void> {
    try {
      this.blueprintCategoryOptions.set(await this.svc.blueprintCategories());
    } catch {
      this.blueprintCategoryOptions.set([]);
    }
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

  /** Badge count for a strip entry; the upcoming one comes from the RSI feed. */
  categoryCount(k: CodexCategory): number | null {
    if (k === UPCOMING_CATEGORY) return this.rsi.feed()?.ships.length ?? null;
    return this.kindCount(k);
  }

  setCategory(k: CodexCategory): void {
    if (k === this.category()) return;
    // A kind the build reports as empty is shown disabled — ignore stray
    // activation (keyboard, deep link). (UC-13)
    if (this.isComingSoon(k)) return;
    this.category.set(k);
    if (k === UPCOMING_CATEGORY) return;
    this.setKind(k);
  }

  setKind(k: CodexKind): void {
    if (k === this.kind()) return;
    // A kind the build reports as empty is shown disabled — ignore stray
    // activation (keyboard, deep link). (UC-13)
    if (this.isComingSoon(k)) return;
    // reset facets that don't apply across kinds
    this.manufacturer.set('');
    this.size.set('');
    this.grade.set('');
    this.componentKind.set('');
    this.weaponClass.set('');
    this.blueprintCategory.set('');
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
  setBlueprintCategory(v: string): void { this.blueprintCategory.set(v); }

  resetFilters(): void {
    this.manufacturer.set('');
    this.size.set('');
    this.grade.set('');
    this.componentKind.set('');
    this.weaponClass.set('');
    this.blueprintCategory.set('');
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

  /** UC-02: add a ship to the hangar inline, without leaving the list. */
  addShipToHangar(ev: Event, className: string): void {
    ev.preventDefault();
    ev.stopPropagation();
    void this.hangar.addShip(className, 'owned');
  }

  /** UC-10: size S1–S12 as a 0–100% bar width for at-a-glance scanning. */
  sizePct(size: number): number {
    return Math.min(100, Math.max(8, Math.round((size / 12) * 100)));
  }

  private buildFilters(): CodexListFilters {
    return {
      search: this.searchTerm() || undefined,
      manufacturer: this.manufacturer() || undefined,
      size: this.size() ? Number(this.size()) : undefined,
      grade: this.grade() || undefined,
      componentKind: this.componentKind() || undefined,
      weaponClass: this.weaponClass() || undefined,
      category: this.blueprintCategory() || undefined,
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
