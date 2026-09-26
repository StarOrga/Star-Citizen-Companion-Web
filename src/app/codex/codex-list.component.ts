import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import {
  CODEX_KINDS,
  CodexFacetValues,
  CodexKind,
  CodexListFilters,
  CodexListRow,
  CodexService,
  manufacturerFacetOptions,
  manufacturerLabel,
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
import { ScSegmentedComponent, ScSegmentOption } from '../shared/segmented-control.component';
import { FoldedRow, foldVariantRows } from './codex-variant-fold';
import { SkinGroupedRow, SkinVariantRef, groupSkinRows } from './codex-skin-group';
import { EditionGroupedRow, EditionRef, groupEditionRows } from './codex-edition-group';
import {
  WEAPON_SUPER_GROUPS,
  WeaponFacetRow,
  WeaponSubGroup,
  WeaponSuperGroup,
  countWeaponGroups,
  weaponGroupKey,
  weaponGroupQuery,
  weaponSuperGroup,
} from './codex-weapon-taxonomy';
import { CodexStatusBannerComponent } from './codex-status-banner.component';
import { HangarService } from '../hangar/hangar.service';
import { NeuroFieldDirective } from '../core/neuro-field.directive';
import { mirrorQueryParams } from './codex-url-state';
import { fpsArmorWeightKey, fpsWeaponTypeKey } from './fps-labels';
import { ScSelectComponent, ScSelectOption } from '../shared/sc-select.component';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { isPlainLeftClick } from '../core/modified-click.util';

/**
 * A card in the grid: a list row after variant folding, livery grouping (FPS
 * weapons) and edition grouping (ships).
 */
type CodexGridRow = EditionGroupedRow<SkinGroupedRow<FoldedRow<CodexListRow>>>;

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

/** Blueprint browse taxonomy (prio 4, the board/hangar archive links): the flat
 * category select stays, this only folds it into "on-foot" vs "vehicle" first —
 * `''` is "Alle". */
export type BlueprintGroup = '' | 'fps' | 'vehicle';

const BLUEPRINT_GROUP_FALLBACK: Record<'fps' | 'vehicle', readonly string[]> = {
  fps: ['FPSArmours', 'FPSWeapons'],
  vehicle: [
    'VehicleComponentS0', 'VehicleComponentS1', 'VehicleComponentS2',
    'VehicleComponentS3', 'VehicleComponentS4',
    'VehicleWeaponsS1', 'VehicleWeaponsS2', 'VehicleWeaponsS3',
    'VehicleWeaponsS4', 'VehicleWeaponsS5', 'VehicleWeaponsS6',
  ],
};

/**
 * Pure mapping from a blueprint group to the `codex_blueprints.category`
 * buckets it covers. Intersected against the categories the ACTIVE build
 * actually seeded (`options`, from `blueprintCategories()`) so the filter never
 * asks for a bucket that cannot exist; before that facet read lands (or if it
 * comes back empty) the static S0–S4 / S1–S6 fallback keeps the group usable.
 */
export function blueprintCategoriesForGroup(
  group: BlueprintGroup,
  options: readonly string[],
): string[] {
  if (group === '') return [];
  const present = options.filter((c) =>
    group === 'fps'
      ? c === 'FPSArmours' || c === 'FPSWeapons'
      : c.startsWith('VehicleComponent') || c.startsWith('VehicleWeapons'),
  );
  return present.length > 0 ? present : [...BLUEPRINT_GROUP_FALLBACK[group]];
}

@Component({
  selector: 'sc-codex-list',
  standalone: true,
  imports: [NeuroFieldDirective, FormsModule, RouterLink, TranslatePipe, CodexCompareTrayComponent, CodexCategoryIconComponent, CodexStatusBannerComponent, UpcomingGridComponent, FallbackImageComponent, ScSegmentedComponent, ScSelectComponent, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="codex-page">
      <header class="head">
        <div class="title-block">
          <a class="back" routerLink="/codex">← {{ 'codex.detail.back' | translate }}</a>
          <h1>{{ 'codex.index.title' | translate }}</h1>
          <p class="hint">{{ 'codex.subtitle' | translate }}</p>
        </div>
        <sc-codex-status-banner />
      </header>

      <!-- Category switcher (datamined kinds + the RSI "upcoming" category).
           Real links since the category lives in the URL (?kind=): middle
           click and "open in new tab" work, a plain left click switches in
           place. A category that is not in the build yet is no link at all. -->
      <nav class="kind-bar" [attr.aria-label]="'codex.categoriesAria' | translate">
        @for (k of categories; track k) {
          @if (isComingSoon(k)) {
            <span class="kind soon" aria-disabled="true" [scTooltip]="'codex.soon' | translate" scTooltipTier="label">
              <span>{{ ('codex.kinds.' + k) | translate }}</span>
              <span class="kind-ct soon-tag">{{ 'codex.soonShort' | translate }}</span>
            </span>
          } @else {
            <a class="kind" [attr.href]="categoryHrefs().get(k)"
               [class.active]="category() === k"
               [attr.aria-current]="category() === k ? 'page' : null"
               (click)="onCategoryClick($event, k)">
              <span>{{ ('codex.kinds.' + k) | translate }}</span>
              @if (categoryCount(k); as ct) { <span class="kind-ct">{{ ct }}</span> }
            </a>
          }
        }
      </nav>

      <!-- Weapons hold BOTH the on-foot catalog and every ship hardpoint mount
           in one table (admin feedback 7897bcb0), so the flat A-Z grid was
           unbrowsable. Two levels of filter, both derived from columns the
           catalog already promotes — see codex-weapon-taxonomy. -->
      @if (showsWeaponGroups()) {
        <div class="group-rail">
          <div class="group-row" role="group" [attr.aria-label]="'codex.weaponGroup.superAria' | translate">
            <button class="group" type="button" [class.active]="weaponGroup() === ''"
                    [attr.aria-pressed]="weaponGroup() === ''"
                    (click)="setWeaponGroup('')">
              <span>{{ 'codex.weaponGroup.all' | translate }}</span>
            </button>
            @for (g of weaponSuperGroups; track g.id) {
              <button class="group" type="button" [class.active]="weaponGroup() === g.id"
                      [attr.aria-pressed]="weaponGroup() === g.id"
                      (click)="setWeaponGroup(g.id)">
                <span>{{ ('codex.weaponGroup.super.' + g.id) | translate }}</span>
                @if (weaponGroupCount(g.id); as ct) { <span class="group-ct">{{ ct }}</span> }
              </button>
            }
          </div>
          @if (activeWeaponSubGroups(); as subs) {
            <div class="group-row sub" role="group" [attr.aria-label]="'codex.weaponGroup.subAria' | translate">
              <button class="group sub" type="button" [class.active]="weaponSubGroup() === ''"
                      [attr.aria-pressed]="weaponSubGroup() === ''"
                      (click)="setWeaponSubGroup('')">
                <span>{{ 'codex.weaponGroup.allOf' | translate: { group: ('codex.weaponGroup.super.' + weaponGroup()) | translate } }}</span>
              </button>
              @for (s of subs; track s.id) {
                <button class="group sub" type="button" [class.active]="weaponSubGroup() === s.id"
                        [attr.aria-pressed]="weaponSubGroup() === s.id"
                        (click)="setWeaponSubGroup(s.id)">
                  <span>{{ ('codex.weaponGroup.' + weaponGroup() + '.' + s.id) | translate }}</span>
                  @if (weaponGroupCount(weaponGroup(), s.id); as ct) { <span class="group-ct">{{ ct }}</span> }
                </button>
              }
            </div>
          }
        </div>
      }

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
                    [attr.aria-label]="'codex.search.clear' | translate"
                    [scTooltip]="'codex.search.clear' | translate">×</button>
          }
        </div>

        <div class="facets">
          <!-- Facets use the themed select (a native one opens as an unthemed
               OS menu, admin feedback fd58a5eb) inside a div: a label would
               forward clicks on the listbox's options to the trigger. -->
          @if (manufacturerOptions().length > 0) {
            <div class="facet mfr">
              <span>{{ 'codex.filters.manufacturer' | translate }}</span>
              <sc-select [options]="manufacturerSelect()" [value]="manufacturer() || null" placeholderKey="codex.filters.all"
                         [ariaLabel]="'codex.filters.manufacturer' | translate"
                         (valueChange)="setManufacturer($event ?? '')" />
            </div>
          }
          <!-- One option is no choice — but a picked one stays reachable (the options come from the loaded rows). -->
          @if (sizeOptions().length > 1 || size()) {
            <div class="facet">
              <span>{{ 'codex.filters.size' | translate }}</span>
              <sc-select [options]="sizeSelect()" [value]="size() || null" placeholderKey="codex.filters.anySize"
                         [ariaLabel]="'codex.filters.size' | translate"
                         (valueChange)="setSize($event ?? '')" />
            </div>
          }
          @if (gradeOptions().length > 1 || grade()) {
            <div class="facet">
              <span>{{ 'codex.filters.grade' | translate }}</span>
              <sc-select [options]="gradeSelect()" [value]="grade() || null" placeholderKey="codex.filters.anyGrade"
                         [ariaLabel]="'codex.filters.grade' | translate"
                         (valueChange)="setGrade($event ?? '')" />
            </div>
          }
          @if (kind() === 'component' && componentKindOptions().length > 0) {
            <div class="facet">
              <span>{{ 'codex.filters.componentKind' | translate }}</span>
              <sc-select [options]="componentKindSelect()" [value]="componentKind() || null" placeholderKey="codex.filters.all"
                         [ariaLabel]="'codex.filters.componentKind' | translate"
                         (valueChange)="setComponentKind($event ?? '')" />
            </div>
          }
          @if (kind() === 'blueprint') {
            <!-- A div, not a label: clicking a label's caption presses its first control (the "Alle" segment). -->
            <div class="facet">
              <span>{{ 'codex.filters.blueprintGroup' | translate }}</span>
              <sc-segmented
                [options]="blueprintGroupOptions"
                [value]="blueprintGroup() || 'all'"
                [ariaLabel]="'codex.filters.blueprintGroup' | translate"
                (valueChange)="setBlueprintGroup($event)" />
            </div>
          }
          @if (kind() === 'blueprint' && blueprintCategoryOptions().length > 0) {
            <div class="facet">
              <span>{{ 'blueprint.filters.category' | translate }}</span>
              <sc-select [options]="blueprintCategorySelect()" [value]="blueprintCategory() || null" placeholderKey="codex.filters.all"
                         [ariaLabel]="'blueprint.filters.category' | translate"
                         (valueChange)="setBlueprintCategory($event ?? '')" />
            </div>
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

      <!-- The catalog only knows what the extractor found in the build, so a
           search for a CONCEPT hull ("Arrastra", admin feedback 7b91c5ae) came
           up empty even though the app holds the ship in the RSI announcement
           feed. Name the match and hand the reader a real link to it. -->
      @if (upcomingMatchNames(); as names) {
        <p class="upcoming-hint">
          <span class="soon-badge">{{ 'codex.upcoming.badge' | translate }}</span>
          <span>{{ 'codex.search.upcomingHint' | translate: { names } }}</span>
          <a class="upcoming-link" [routerLink]="['/codex', 'upcoming']"
             [queryParams]="{ q: searchInput() }">
            {{ 'codex.search.upcomingLink' | translate }}
          </a>
        </p>
      }

      <!-- Results -->
      @if (error(); as err) {
        <div class="sc-card err">
          <span><strong>{{ 'codex.error.title' | translate }}:</strong> {{ err }}</span>
          <button type="button" class="retry" (click)="reload()">{{ 'codex.error.retry' | translate }}</button>
        </div>
      } @else {
        <div class="result-head">
          <span class="count">
            @if (loading() && rows().length === 0) {
              <!-- Not "0 results" above the skeletons: nothing has been counted yet. -->
              {{ 'codex.results.loading' | translate }}
            } @else {
              {{ (total() === 1 ? 'codex.results.countOne' : 'codex.results.count') | translate: { count: total() } }}
            }
          </span>
          @if (hasMore()) {
            <span class="showing">{{ 'codex.results.showingOf' | translate: { shown: rows().length, total: total() } }}</span>
          }
        </div>

        <!-- The search runs inside the active category first (feedback #7), but
             a hit in another one is named here instead of silently missing. -->
        @if (crossHits().length > 0) {
          <!-- Links (the same list URL a reload would restore) — no count: the
               server counts raw records, the target list folds variants,
               liveries and editions, so a number here would not match it. -->
          <p class="cross-hits">
            <span class="cross-label">{{ 'codex.search.alsoIn' | translate }}</span>
            @for (h of crossHits(); track h.kind) {
              <a class="cross-hit" [attr.href]="categoryHrefs().get(h.kind)"
                 (click)="onCategoryClick($event, h.kind)">
                {{ ('codex.kinds.' + h.kind) | translate }}
              </a>
            }
          </p>
        }

        @if (isPartialKind()) {
          <p class="partial-note">{{ 'codex.empty.partial' | translate }}</p>
        }
        @if (blueprintRecipesMissing()) {
          <p class="partial-note">{{ 'blueprint.recipesMissing' | translate }}</p>
        }

        @if (loading() && rows().length === 0) {
          <div class="grid">
            @for (s of skeletons; track s; let i = $index) {
              <div class="card-wrap skel sc-skel-field" scNeuroField [neuroIndex]="i" [style.--sc-skel-i]="i"></div>
            }
          </div>
        } @else if (rows().length === 0) {
          <div class="sc-card empty">
            <strong>{{ 'codex.empty.title' | translate }}</strong>
            @if (hasActiveFilters() || searchInput()) {
              <p>{{ 'codex.empty.filtered' | translate }}</p>
              <!-- The way out: reset alone keeps the search, which is often what emptied the list. -->
              <button type="button" class="reset-all" (click)="resetAll()">{{ 'codex.empty.resetAll' | translate }}</button>
            } @else {
              <p>{{ 'codex.empty.kind' | translate: { kind: ('codex.kinds.' + kind()) | translate } }}</p>
            }
          </div>
        } @else {
          <div class="grid">
            @for (r of rows(); track r.classNameSlug) {
              <!-- The card is the navigation; pin and add-to-hangar are actions,
                   so they sit NEXT TO the link inside the wrapper (no interactive
                   content nested in an <a>) — the upcoming grid's pattern. -->
              <div class="card-wrap">
                <a class="card" [routerLink]="['/codex', kind(), r.classNameSlug]">
                  <div class="thumb" [class.icon-only]="thumbs(r).length === 0">
                    <sc-fallback-image [candidates]="thumbs(r)" [alt]="cardName(r)">
                      <sc-codex-icon [kind]="kind()" [sub]="iconSub(r)" [attachType]="r.attachType" />
                    </sc-fallback-image>
                  </div>
                  <h3 class="name">{{ cardName(r) }}</h3>
                  <code class="cls">{{ r.classNameSlug }}</code>
                  <div class="badges">
                    @if (cardMfr(r); as mfr) { <span class="badge mfr" [scTooltip]="mfr" scTooltipTier="label">{{ mfr }}</span> }
                    @if (r.componentKind) { <span class="badge cat">{{ ('codex.componentKind.' + r.componentKind) | translate }}</span> }
                    @if (r.weaponClass) { <span class="badge cat">{{ ('codex.weaponClass.' + r.weaponClass) | translate }}</span> }
                    @if (r.subType) { <span class="badge subtle">{{ subTypeKey(r) ? (subTypeKey(r)! | translate) : r.subType }}</span> }
                    @if (r.grade) { <span class="badge grade" [attr.data-grade]="r.grade">{{ 'codex.card.grade' | translate: { grade: r.grade } }}</span> }
                    @if (r.crewSize != null) { <span class="badge">{{ 'codex.card.crew' | translate: { count: r.crewSize } }}</span> }
                    @if (r.speed != null) { <span class="badge subtle">{{ r.speed }} m/s</span> }
                    @if (r.isVariant) { <span class="badge variant">{{ 'codex.card.variant' | translate }}</span> }
                    @if (r.blueprintCategory) { <span class="badge cat">{{ categoryLabel(r.blueprintCategory) }}</span> }
                    @if (r.blueprintTier != null) { <span class="badge">{{ 'blueprint.card.tier' | translate: { tier: r.blueprintTier } }}</span> }
                    @if (craftTimeLabel(r); as ct) { <span class="badge subtle">{{ ct }}</span> }
                    @if (r.foldedClassNames.length; as folded) {
                      <span class="badge folded"
                            [scTooltip]="'codex.card.foldedTitle' | translate: { names: foldedNames(r) }">
                        {{ (folded === 1 ? 'codex.card.foldedOne' : 'codex.card.foldedMany') | translate: { count: folded } }}
                      </span>
                    }
                    @if (r.skinVariants.length; as skins) {
                      <span class="badge skins"
                            [scTooltip]="'codex.card.skinsTitle' | translate: { names: skinNames(r) }">
                        {{ (skins === 1 ? 'codex.card.skinsOne' : 'codex.card.skinsMany') | translate: { count: skins } }}
                      </span>
                    }
                    @if (r.editions.length; as editions) {
                      <span class="badge editions"
                            [scTooltip]="'codex.card.editionsTitle' | translate: { names: editionNames(r) }">
                        {{ (editions === 1 ? 'codex.card.editionsOne' : 'codex.card.editionsMany') | translate: { count: editions } }}
                      </span>
                    }
                  </div>
                  @if (r.size != null) {
                    <div class="size-bar" [scTooltip]="'codex.card.size' | translate: { size: r.size }">
                      <span class="size-track"><span class="size-fill" [style.width.%]="sizePct(r.size)"></span></span>
                      <span class="size-tag">S{{ r.size }}</span>
                    </div>
                  }
                </a>
                <div class="card-actions">
                  @if (kind() === 'ship') {
                    @if (inHangarSet().has(r.classNameSlug)) {
                      <span class="hangar-chip" role="img"
                            [attr.aria-label]="'codex.card.inHangar' | translate"
                            [scTooltip]="'codex.card.inHangar' | translate" scTooltipTier="label">✓</span>
                    } @else {
                      <button type="button" class="act hangar-add"
                              [disabled]="addBusy() !== null"
                              [attr.aria-busy]="addBusy() === r.classNameSlug"
                              (click)="addShipToHangar(r.classNameSlug)"
                              [attr.aria-label]="'codex.card.addToHangar' | translate"
                              [scTooltip]="'codex.card.addToHangar' | translate" scTooltipTier="label">+</button>
                    }
                  }
                  <button type="button" class="act pin"
                          [class.pinned]="isPinned(r.classNameSlug)"
                          [attr.aria-pressed]="isPinned(r.classNameSlug)"
                          (click)="togglePin(r.classNameSlug)"
                          [attr.aria-label]="(isPinned(r.classNameSlug) ? 'codex.compare.pinned' : 'codex.compare.pin') | translate"
                          [scTooltip]="(isPinned(r.classNameSlug) ? 'codex.compare.pinned' : 'codex.compare.pin') | translate"
                          scTooltipTier="label">
                    {{ isPinned(r.classNameSlug) ? '★' : '☆' }}
                  </button>
                </div>
                @if (addFailed() === r.classNameSlug) {
                  <p class="card-err" role="alert">{{ 'codex.card.addToHangarFailed' | translate }}</p>
                }
              </div>
            }
          </div>

          @if (hasMore()) {
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
    /* Same back link and head rhythm as every other archive view. */
    .back { font-size: 0.82rem; color: var(--sc-fg-2); text-decoration: none; width: fit-content; }
    .back:hover, .back:focus-visible { color: var(--sc-accent); }
    .title-block { display: flex; flex-direction: column; gap: 4px; }
    .title-block h1 { margin: 4px 0 0; }
    .title-block .hint { color: var(--sc-fg-2); margin: 0; max-width: var(--sc-measure); }

    .upcoming-lede { margin: -4px 0 0; color: var(--sc-fg-2); font-size: 0.86rem; max-width: 72ch; }

    /* Amber = announced, not in the build. Never the hot red (elevated access). */
    .upcoming-hint {
      --soon: #f0b44a;
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      margin: 0; padding: 9px 12px; border-radius: 8px;
      border: 1px solid color-mix(in srgb, var(--soon) 34%, var(--sc-border));
      background: color-mix(in srgb, var(--soon) 9%, var(--sc-bg-1));
      color: var(--sc-fg-1); font-size: max(0.82rem, var(--sc-fs-floor));
    }
    .upcoming-hint .soon-badge {
      padding: 2px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em;
      font-size: max(0.62rem, var(--sc-fs-floor)); color: var(--soon);
      border: 1px solid color-mix(in srgb, var(--soon) 40%, transparent);
      background: color-mix(in srgb, var(--soon) 14%, transparent);
    }
    .upcoming-hint .upcoming-link { margin-left: auto; color: var(--soon); font-weight: 600; }
    .upcoming-hint .upcoming-link:hover { text-decoration: underline; }

    .kind-bar { display: flex; flex-wrap: wrap; gap: 6px; }
    .kind {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 16px; border-radius: 999px;
      border: 1px solid var(--sc-border); background: transparent;
      color: var(--sc-fg-1); font-family: var(--sc-font-display); text-decoration: none;
      font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase;
      cursor: pointer; transition: all 0.16s;
    }
    .kind:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .kind:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .kind.active { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .kind-ct { font-size: max(0.68rem, var(--sc-fs-floor)); padding: 0 6px; border-radius: 8px; background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2); }
    /* Light text on the tint — the dark bg-0 on two stacked accent tints read at ~2.3:1. */
    .kind.active .kind-ct { background: color-mix(in srgb, var(--sc-accent) 25%, transparent); color: var(--sc-fg-0); }
    .kind.soon { opacity: 0.5; cursor: not-allowed; }
    .kind.soon:hover { color: var(--sc-fg-1); border-color: var(--sc-border); }
    .kind-ct.soon-tag { background: color-mix(in srgb, var(--sc-warning, #f0c419) 22%, transparent); color: var(--sc-warning, #f0c419); text-transform: uppercase; letter-spacing: 0.04em; }

    /* Two-level weapon browse rail. Level 1 mirrors the kind-bar pill, level 2
       is the quieter chip so the hierarchy reads at a glance. */
    .group-rail { display: flex; flex-direction: column; gap: 8px; }
    .group-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .group-row.sub { padding-left: 14px; border-left: 2px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .group {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 7px 14px; border-radius: 999px;
      border: 1px solid var(--sc-border); background: transparent;
      color: var(--sc-fg-1); font-family: var(--sc-font-display);
      font-size: max(0.74rem, var(--sc-fs-floor)); letter-spacing: 0.05em; text-transform: uppercase;
      cursor: pointer; transition: all 0.16s;
    }
    .group:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .group.active { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .group.sub { padding: 5px 12px; text-transform: none; letter-spacing: 0.02em; font-family: inherit; }
    .group-ct { font-size: max(0.66rem, var(--sc-fs-floor)); padding: 0 6px; border-radius: 8px; background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2); }
    .group.active .group-ct { background: color-mix(in srgb, var(--sc-accent) 25%, transparent); color: var(--sc-fg-0); }

    .controls { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; }
    .search-row { position: relative; display: flex; }
    .search {
      flex: 1; padding: 10px 36px 10px 14px; border-radius: 8px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-0);
      font-family: inherit; font-size: 0.92rem;
    }
    .search:focus { outline: none; border-color: var(--sc-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--sc-accent) 22%, transparent); }
    .search-clear {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      display: inline-flex; align-items: center; justify-content: center;
      min-width: max(32px, var(--sc-tap-min)); min-height: max(32px, var(--sc-tap-min));
      border: none; border-radius: 6px; background: transparent; color: var(--sc-fg-2); font-size: 1.3rem; cursor: pointer;
    }
    /* Clearing a search is neither an error nor destructive — no danger red. */
    .search-clear:hover { color: var(--sc-accent); }
    .search-clear:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }

    .facets { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
    .facet { display: flex; flex-direction: column; gap: 4px; }
    .facet > span { font-size: max(0.66rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .facet.check { flex-direction: row; align-items: center; gap: 6px; align-self: center; }
    .facet.check span { font-size: max(0.78rem, var(--sc-fs-floor)); text-transform: none; letter-spacing: 0; color: var(--sc-fg-1); }
    /* The themed select (shared/sc-select) draws itself; the facet only sizes it. */
    .facet sc-select { min-width: 160px; }
    /* Maker names run long ("Clark Defense Systems") and the list is as wide as its trigger. */
    .facet.mfr sc-select { min-width: 220px; }
    .reset { align-self: center; padding: 7px 12px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-family: inherit; font-size: max(0.76rem, var(--sc-fs-floor)); cursor: pointer; }
    .reset:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    .result-head { display: flex; align-items: baseline; gap: 12px; }
    .count { font-family: var(--sc-font-display); font-size: 0.82rem; letter-spacing: 0.06em; color: var(--sc-accent); text-transform: uppercase; }
    .showing { font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .partial-note { margin: 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-warning); padding: 6px 10px; border-radius: 6px; background: color-mix(in srgb, var(--sc-warning) 10%, transparent); border: 1px solid color-mix(in srgb, var(--sc-warning) 28%, transparent); }

    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    /* The wrapper is the visible card (frame, lift on hover); the link fills it
       and the actions ride on top as its siblings. */
    .card-wrap {
      position: relative; display: flex; flex-direction: column; min-height: 116px;
      border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-1);
      transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s;
    }
    .card-wrap:hover { transform: translateY(-2px); border-color: var(--sc-accent); box-shadow: 0 6px 20px rgba(0,0,0,0.4), var(--sc-glow); }
    /* Keyboard focus on the card link lights the frame the way a hover does. */
    .card-wrap:has(> .card:focus-visible) { border-color: var(--sc-accent); box-shadow: 0 6px 20px rgba(0,0,0,0.4), var(--sc-glow); }
    .card {
      flex: 1; display: flex; flex-direction: column; gap: 8px;
      padding: 14px; border-radius: 8px; color: inherit; text-decoration: none;
    }
    .card:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .card .thumb { height: 96px; margin: -4px 0 2px; display: flex; align-items: center; justify-content: center;
      border-radius: 6px; background: radial-gradient(circle at 50% 45%, var(--sc-bg-2), var(--sc-bg-0));
      /* sc-fallback-image owns the <img>; sizing crosses the boundary as a var. */
      --sc-img-max-h: 88px; }
    .card .thumb sc-codex-icon { width: 100%; height: 100%; }
    .card-wrap:hover .thumb sc-codex-icon { transform: scale(1.05); transition: transform 0.16s; }
    .card .name { margin: 0; font-size: 1rem; font-weight: 600; line-height: 1.25; }
    .card .cls { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); word-break: break-all; }
    .card-actions { position: absolute; top: 12px; right: 12px; display: inline-flex; align-items: center; gap: 6px; }
    .act {
      width: max(32px, var(--sc-tap-min)); height: max(32px, var(--sc-tap-min));
      display: inline-flex; align-items: center; justify-content: center; padding: 0;
      border-radius: 8px; border: 1px solid transparent; cursor: pointer; line-height: 1;
      background: color-mix(in srgb, var(--sc-bg-0) 66%, transparent); color: var(--sc-fg-2);
    }
    .act:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .act:disabled { cursor: progress; opacity: 0.6; }
    .card-err { margin: 0 14px 12px; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-danger); }
    .pin { font-size: 1.1rem; }
    .pin:hover, .pin.pinned { color: var(--sc-accent); }
    .pin:hover { border-color: var(--sc-border); }
    .hangar-chip { font-size: 0.82rem; line-height: 1; color: var(--sc-success); padding: 0 6px; }
    .hangar-add { font-size: 1rem; border-color: var(--sc-border); }
    .hangar-add:hover { color: var(--sc-success); border-color: var(--sc-success); }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
    .badge { font-size: max(0.66rem, var(--sc-fs-floor)); padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    /* Holds a spelled-out manufacturer now ("Musashi Industrial & Starflight
       Concern"), so the pill has to stay inside the card on a phone. */
    .badge.mfr { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-1);
      max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Category-type badges read neutral, as on the FPS and blueprint lists. */
    .badge.cat { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-1); }
    .badge.subtle { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }
    .badge.variant { background: color-mix(in srgb, var(--sc-warning) 16%, transparent); border-color: color-mix(in srgb, var(--sc-warning) 40%, transparent); color: var(--sc-fg-1); }
    /* "+n file variants folded" — a quiet note, not a warning: nothing is wrong,
       the catalog simply carries several records for one object. */
    .badge.folded { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); cursor: help; }
    /* Liveries and ship editions are a feature of the entry, not file noise like
       .folded — so the accent, and the detail view picks them up in a picker. */
    .badge.skins, .badge.editions {
      background: color-mix(in srgb, var(--sc-accent) 14%, transparent);
      border-color: color-mix(in srgb, var(--sc-accent) 42%, transparent);
      color: var(--sc-fg-0); cursor: help;
    }
    .badge.grade[data-grade="A"] { background: color-mix(in srgb, var(--sc-success) 18%, transparent); border-color: color-mix(in srgb, var(--sc-success) 42%, transparent); color: color-mix(in srgb, var(--sc-success) 70%, #fff); }
    .badge.grade[data-grade="B"] { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); color: var(--sc-fg-0); }
    .badge.grade[data-grade="C"] { background: color-mix(in srgb, var(--sc-warning) 16%, transparent); border-color: color-mix(in srgb, var(--sc-warning) 40%, transparent); color: color-mix(in srgb, var(--sc-warning) 75%, #fff); }
    .badge.grade[data-grade="D"] { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }
    .size-bar { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .size-track { flex: 1; height: 5px; border-radius: 999px; background: var(--sc-bg-2); overflow: hidden; }
    .size-fill { display: block; height: 100%; border-radius: 999px; background: var(--sc-accent); }
    .size-tag { font-size: max(0.64rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); flex: 0 0 auto; }

    .card-wrap.skel { min-height: 116px; }

    .cross-hits { margin: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .cross-hit {
      display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--sc-border); background: transparent; color: var(--sc-fg-1); font-family: inherit;
      font-size: max(0.78rem, var(--sc-fs-floor)); min-height: max(28px, var(--sc-tap-min)); text-decoration: none;
    }
    .cross-hit:hover, .cross-hit:focus-visible { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .cross-hit:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

    .more-row { display: flex; justify-content: center; }
    .load-more { padding: 10px 24px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-accent); color: var(--sc-accent); font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
    .load-more:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
    .load-more:disabled { opacity: 0.6; cursor: progress; }

    .empty { text-align: center; padding: 40px 20px; color: var(--sc-fg-1); }
    .empty p { color: var(--sc-fg-2); margin: 6px 0 0; }
    .empty .reset-all { margin-top: 12px; padding: 7px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-1); font-family: inherit; font-size: max(0.8rem, var(--sc-fs-floor)); cursor: pointer; }
    .empty .reset-all:hover, .empty .reset-all:focus-visible { color: var(--sc-accent); border-color: var(--sc-accent); }
    /* No own padding: .sc-card's density scale (--sc-pad-1) tightens it on phones. */
    .err { color: var(--sc-danger); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .err .retry { margin-left: auto; padding: 6px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font-family: inherit; }
    .err .retry:hover { background: color-mix(in srgb, var(--sc-danger) 12%, transparent); }
    .err .retry:focus-visible { outline: 2px solid var(--sc-danger); outline-offset: 2px; }

    @media (max-width: 720px) {
      .head { flex-direction: column; }
    }
    /* Phones stack the facets one per row — full width, not ragged 160/220 px boxes. */
    @media (max-width: 640px) {
      .facet:not(.check) { flex: 1 1 100%; }
      .facet sc-select, .facet.mfr sc-select { min-width: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .card-wrap, .kind, .group { transition: none; }
      .card-wrap:hover { transform: none; }
      .card-wrap:hover .thumb sc-codex-icon { transform: none; }
    }
  `],
})
export class CodexListComponent implements OnInit {
  readonly svc = inject(CodexService);
  private readonly t = inject(TranslateService);
  private readonly hangar = inject(HangarService);
  private readonly rsi = inject(UpcomingShipsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  // Data language tracks the UI language as a SIGNAL so OnPush card titles
  // re-render on a language switch (they previously read t.currentLang
  // directly and stayed stale until the next unrelated CD cycle). (#50)
  private readonly dataLang = signal(toLang(this.t.getCurrentLang()));

  readonly kinds = CODEX_KINDS;
  /** Datamined kinds + the RSI-sourced "upcoming ships" category. */
  readonly categories: readonly CodexCategory[] = [...CODEX_KINDS, UPCOMING_CATEGORY];

  /**
   * Where each category link points: that category's list URL with the
   * current search (facets are per category and stay behind), so a middle
   * click or "open in new tab" lands on the list a plain click switches to.
   * A plain href, not routerLink: RouterLink would ALSO navigate on the plain
   * click the handler keeps in place (page view, scroll to top, history entry).
   */
  readonly categoryHrefs = computed(() => {
    const term = this.searchTerm();
    const upcomingTerm = this.rsi.query();
    const hrefs = new Map<CodexCategory, string | null>();
    for (const k of this.categories) {
      const q = (k === UPCOMING_CATEGORY ? upcomingTerm : term) || null;
      try {
        const tree = this.router.createUrlTree([], { relativeTo: this.route, queryParams: { kind: k, q } });
        hrefs.set(k, this.location.prepareExternalUrl(this.router.serializeUrl(tree)));
      } catch {
        hrefs.set(k, null); // a view outside the router (tests): the in-place click still works
      }
    }
    return hrefs;
  });
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
   * Ordered art candidates for a list row, best-looking first.
   *
   * For SHIPS the RSI store render leads: our datamined "preview" is the game's
   * flat white UI silhouette (Data/Textures/UI/Spaceships), which identifies a
   * hull but does not show it. RSI publishes an actual photo of nearly every
   * hull we hold, so the Codex uses that and keeps the silhouette as the
   * fallback for hulls RSI has no matrix entry for. Other kinds have no RSI
   * counterpart, so their datamined render is all there is.
   *
   * Any of these urls can be missing, so the list is handed to
   * `sc-fallback-image`, which walks it and shows the category glyph only once
   * every candidate has failed.
   */
  thumbs(r: CodexListRow): string[] {
    const out: string[] = [];
    // Match on the denormalized `name_localized` — the very column the edge
    // function keys `gameShipArt` by, so no second normalization dialect exists.
    if (this.kind() === 'ship') out.push(...this.rsi.artFor(r.nameLocalized ?? this.cardName(r)));
    const p = r.payload as { previewImage?: string | null } | undefined;
    const local = this.svc.previewUrl(p?.previewImage);
    if (local) out.push(local);
    return out;
  }

  /**
   * Sub-category that refines the fallback glyph. `sub_type` ranks ABOVE
   * `weapon_class`: the class is only 'FPS'/'Ship' and refines nothing, while
   * the sub-type is what tells a gadget from a gun — passing the class first
   * put a crosshair on the APX Fire Extinguisher (admin feedback 8cd0aed7).
   */
  iconSub(r: CodexListRow): string | null {
    return r.componentKind || r.subType || r.weaponClass || null;
  }

  /**
   * i18n key for the sub-type badge where the token has a translation — the
   * on-foot weapon types and armour weight classes the FPS page labels too.
   * Other tokens (ship turret shapes …) stay as the catalog spells them.
   */
  subTypeKey(r: CodexListRow): string | null {
    if (r.weaponClass === 'FPS') return fpsWeaponTypeKey(r.subType);
    if (this.kind() === 'item') return fpsArmorWeightKey(r.subType);
    return null;
  }

  /** Class names of the records folded into this card, for the badge tooltip. */
  foldedNames(r: FoldedRow<CodexListRow>): string {
    return [r.classNameSlug, ...r.foldedClassNames].join(', ');
  }

  /** Livery names grouped into this card, for the badge tooltip. */
  skinNames(r: CodexGridRow): string {
    return r.skinVariants.map((s) => s.liveryName).join(', ');
  }

  /** Edition names grouped into this ship card, for the badge tooltip. */
  editionNames(r: CodexGridRow): string {
    return r.editions.map((e) => e.editionName).join(', ');
  }

  /**
   * Manufacturer badge text — the full name from the extracted payload
   * ("Aegis Dynamics"), falling back to the promoted code when the game data
   * has no resolvable name. See `manufacturerLabel`.
   */
  cardMfr(r: CodexListRow): string | null {
    return manufacturerLabel(r, this.dataLang());
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
  /**
   * Weapon browse taxonomy (feedback 7897bcb0). `weaponGroup` is the super
   * category ('' = all weapons), `weaponSubGroup` the finer bucket inside it.
   * Together they replace the old flat "weapon class" dropdown — the super
   * category IS that class, just promoted out of a select and given a second
   * level. See codex-weapon-taxonomy for the column mapping.
   */
  readonly weaponGroup = signal('');
  readonly weaponSubGroup = signal('');
  /** Per-category record counts, from the build's weapon facet columns. */
  private readonly weaponFacets = signal<readonly WeaponFacetRow[]>([]);
  readonly includeVariants = signal(false);
  /** Blueprint-only facet — raw CIG bucket, '' = all. */
  readonly blueprintCategory = signal('');
  /** Buckets actually present in the build (loaded once, data-driven). */
  readonly blueprintCategoryOptions = signal<string[]>([]);
  /**
   * Blueprint-only sub-filter (prio 4): Alle · Zu Fuß · Fahrzeug, above the raw
   * category select. `?group=fps|vehicle` presets it from the AN BORD / IM
   * HANGAR archive links — see codex-landing.component.
   */
  readonly blueprintGroup = signal<BlueprintGroup>('');
  readonly blueprintGroupOptions: readonly ScSegmentOption[] = [
    { value: 'all', labelKey: 'blueprint.group.all' },
    { value: 'fps', labelKey: 'blueprint.group.fps' },
    { value: 'vehicle', labelKey: 'blueprint.group.vehicle' },
  ];
  /**
   * Categories the active group covers. Empty for "Alle" (no extra filter). A
   * single-category select value OUTSIDE the group wins over the group — see
   * `buildFilters`.
   */
  readonly blueprintGroupCategories = computed(() =>
    blueprintCategoriesForGroup(this.blueprintGroup(), this.blueprintCategoryOptions()),
  );

  /** Rows exactly as the server returned them, before display-level folding. */
  private readonly rawRows = signal<CodexListRow[]>([]);
  private readonly serverTotal = signal(0);

  /**
   * What the grid renders, after three display-level passes: near-identical
   * variant records collapsed into one card each (admin feedback 8cd0aed7 —
   * see codex-variant-fold), then livery families collapsed into their base
   * record (feedback d5e39f86 — see codex-skin-group), then, for ships,
   * edition families collapsed into theirs (feedback 77ecad2a — see
   * codex-edition-group). The order is load-bearing; both grouping passes need
   * the base name to be unambiguous, which the variant fold is what makes it.
   * Ticking "include variants" — the control that already means "show me the
   * raw records" — turns ALL of them off.
   */
  readonly rows = computed<CodexGridRow[]>(() => {
    if (this.includeVariants()) {
      return this.rawRows().map((r) => ({
        ...r,
        foldedClassNames: [] as readonly string[],
        skinVariants: [] as readonly SkinVariantRef[],
        editions: [] as readonly EditionRef[],
      }));
    }
    const grouped = groupSkinRows(foldVariantRows(this.rawRows(), (r) => this.cardName(r)));
    // Edition grouping reads a class-name lineage only the vehicle catalog
    // carries, so it stays off every other kind.
    return this.kind() === 'ship'
      ? groupEditionRows(grouped)
      : grouped.map((r) => ({ ...r, editions: [] as readonly EditionRef[] }));
  });
  /**
   * Result count with the folded-away duplicates subtracted. Only the loaded
   * pages can be folded, so this is a lower bound on the server count, never
   * below what is actually on screen.
   */
  readonly total = computed(() =>
    Math.max(this.rows().length, this.serverTotal() - (this.rawRows().length - this.rows().length)),
  );
  /** More pages left on the server — measured on the RAW rows, not the folded ones. */
  readonly hasMore = computed(() => this.rawRows().length < this.serverTotal());
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private offset = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private loadSeq = 0;

  // Facet options: the complete set from `codex_facet_values` (AUD-063) when it
  // loaded, else the row-derived options from whatever pages happen to be
  // loaded for the active kind (also the fallback while the RPC is in flight,
  // and forever on a build that predates the migration).
  private readonly serverFacets = signal<CodexFacetValues | null>(null);
  /**
   * Manufacturer facet — spelled-out labels over the promoted code as the
   * filter value. See `manufacturerFacetOptions`.
   */
  readonly manufacturerOptions = computed(() => {
    const server = this.serverFacets();
    if (!server) return manufacturerFacetOptions(this.rows(), this.dataLang());
    const lang = this.dataLang();
    return [...server.manufacturers]
      .map((m) => ({ code: m.code, label: manufacturerLabel({ manufacturerCode: m.code, payload: { manufacturer: { name: m.name } } }, lang) ?? m.code }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });
  readonly sizeOptions = computed(() => {
    const server = this.serverFacets();
    if (server) return server.sizes.map(String);
    return uniqSorted(this.rows().map((r) => (r.size != null ? String(r.size) : null))).sort(
      (a, b) => Number(a) - Number(b),
    );
  });
  readonly gradeOptions = computed(() => {
    const server = this.serverFacets();
    return server ? server.grades : uniqSorted(this.rows().map((r) => r.grade));
  });
  readonly componentKindOptions = computed(() => {
    const server = this.serverFacets();
    if (server) return COMPONENT_KINDS.filter((k) => server.componentKinds.includes(k));
    const present = new Set(this.rows().map((r) => r.componentKind).filter(Boolean));
    return COMPONENT_KINDS.filter((k) => present.has(k));
  });

  /**
   * The facets in the themed select's shape: raw values ride in `label`,
   * translatable ones in `labelKey`. Always includes the currently selected
   * value even when the (server or row-derived) facet list does not carry it
   * — e.g. a URL/route param naming a value outside the loaded pages, or the
   * server facet read still in flight — so `sc-select` never silently reverts
   * a real selection to "None".
   */
  private withSelected(options: ScSelectOption[], selected: string): ScSelectOption[] {
    if (!selected || options.some((o) => o.value === selected)) return options;
    return [...options, { value: selected, labelKey: '', label: selected }];
  }
  readonly manufacturerSelect = computed<ScSelectOption[]>(() =>
    this.withSelected(
      this.manufacturerOptions().map((m) => ({ value: m.code, labelKey: '', label: m.label })),
      this.manufacturer(),
    ),
  );
  readonly sizeSelect = computed<ScSelectOption[]>(() =>
    this.withSelected(
      this.sizeOptions().map((s) => ({ value: s, labelKey: '', label: 'S' + s })),
      this.size(),
    ),
  );
  readonly gradeSelect = computed<ScSelectOption[]>(() =>
    this.withSelected(
      this.gradeOptions().map((g) => ({ value: g, labelKey: '', label: g })),
      this.grade(),
    ),
  );
  readonly componentKindSelect = computed<ScSelectOption[]>(() => {
    const options = this.componentKindOptions().map((c) => ({
      value: c,
      labelKey: 'codex.componentKind.' + c,
    }));
    const selected = this.componentKind();
    if (!selected || options.some((o) => o.value === selected)) return options;
    return [...options, { value: selected, labelKey: 'codex.componentKind.' + selected }];
  });
  // categoryLabel() reads the data language, so this recomputes on a DE/EN switch.
  readonly blueprintCategorySelect = computed<ScSelectOption[]>(() =>
    this.blueprintCategoryOptions().map((c) => ({ value: c, labelKey: '', label: this.categoryLabel(c) })),
  );
  readonly weaponSuperGroups = WEAPON_SUPER_GROUPS;
  /** The rail only makes sense on the weapon category. */
  readonly showsWeaponGroups = computed(() => !this.isUpcoming() && this.kind() === 'weapon');
  /**
   * Counts per bucket, split by the variant toggle so the badge always matches
   * what the query will return. Empty until the facet read lands (and after a
   * failed one) — the template then simply renders a badge-less pill.
   */
  private readonly weaponGroupCounts = computed(() =>
    countWeaponGroups(
      this.includeVariants() ? this.weaponFacets() : this.weaponFacets().filter((r) => !r.isVariant),
    ),
  );
  /**
   * Sub-categories of the active super category, empty buckets dropped, or null
   * when no super category is picked — the template's `@if (…; as subs)` then
   * collapses the second level away entirely.
   */
  readonly activeWeaponSubGroups = computed<readonly WeaponSubGroup[] | null>(() => {
    const sup: WeaponSuperGroup | null = weaponSuperGroup(this.weaponGroup());
    if (!sup) return null;
    const counts = this.weaponGroupCounts();
    // Before the counts arrive there is nothing to prune against, so show the
    // full set rather than an empty rail.
    if (counts.size === 0) return sup.subGroups;
    const present = sup.subGroups.filter((g) => (counts.get(weaponGroupKey(sup.id, g.id)) ?? 0) > 0);
    return present.length > 0 ? present : null;
  });

  readonly supportsVariants = computed(
    () => this.kind() !== 'ammunition' && this.kind() !== 'manufacturer' && this.kind() !== 'blueprint',
  );

  readonly hasActiveFilters = computed(
    () =>
      !!this.manufacturer() ||
      !!this.size() ||
      !!this.grade() ||
      !!this.componentKind() ||
      !!this.weaponGroup() ||
      !!this.blueprintCategory() ||
      !!this.blueprintGroup() ||
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
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
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
      this.weaponGroup();
      this.weaponSubGroup();
      this.includeVariants();
      this.blueprintCategory();
      this.blueprintGroup();
      this.runQuery(true);
    });

    // Mirror the list state into the URL (replaceUrl): Back from a detail page,
    // a reload or a shared link lands on the same list, not on ships again.
    effect(() => {
      const queryParams: Record<string, string | null> = {
        kind: this.category(),
        // The upcoming grid owns its own search box (on the RSI feed service).
        q: (this.isUpcoming() ? this.rsi.query() : this.searchTerm()) || null,
        mfr: this.manufacturer() || null,
        size: this.size() || null,
        grade: this.grade() || null,
        ck: this.componentKind() || null,
        wg: this.weaponGroup() || null,
        wsg: this.weaponSubGroup() || null,
        bpc: this.blueprintCategory() || null,
        group: this.blueprintGroup() || null,
        v: this.includeVariants() ? '1' : null,
        // Superseded by wg — a landing link's weaponClass must not linger.
        weaponClass: null,
      };
      if (!this.routeApplied()) return;
      untracked(() => this.writeUrl(queryParams));
    });

    // Other categories' matches for the current search term (feedback #7).
    effect(() => {
      const term = this.searchTerm().trim();
      const active = this.category();
      untracked(() => void this.loadCrossHits(term, active));
    });

    // Complete facet values for the active kind's dropdowns (AUD-063) — reread
    // on a kind switch or a build/patch switch; the row-derived fallback keeps
    // the dropdowns usable while this is in flight.
    effect(() => {
      const kind = this.kind();
      const build = this.svc.build();
      untracked(() => void this.loadFacetValues(kind, build?.id));
    });
  }

  private facetValuesSeq = 0;

  /** Loads the complete facet values for one kind; null (server error / not yet deployed) clears to the row-derived fallback. */
  private async loadFacetValues(kind: CodexKind, buildId: string | undefined): Promise<void> {
    if (!buildId) {
      this.serverFacets.set(null);
      return;
    }
    const seq = ++this.facetValuesSeq;
    try {
      const values = await this.svc.facetValues(kind);
      if (seq === this.facetValuesSeq) this.serverFacets.set(values);
    } catch {
      if (seq === this.facetValuesSeq) this.serverFacets.set(null);
    }
  }

  /** Set once the route's state is applied — before that the URL is the source, not the target. */
  private readonly routeApplied = signal(false);

  /** Matches for the current search in the OTHER data categories, largest first. */
  readonly crossHits = signal<{ kind: CodexKind; count: number }[]>([]);
  private crossSeq = 0;

  private async loadCrossHits(term: string, active: CodexCategory): Promise<void> {
    const seq = ++this.crossSeq;
    // The previous term's counts must not stay clickable while this one loads.
    this.crossHits.set([]);
    // Three characters: below that the trigram index can't help and every
    // count would scan a whole table.
    if (term.length < 3) return;
    const others = CODEX_KINDS.filter((k) => k !== active && !this.isComingSoon(k));
    try {
      const counts = await this.svc.countSearchMatches(term, others);
      if (seq !== this.crossSeq) return;
      this.crossHits.set(
        [...counts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
      );
    } catch {
      // Advisory only: without the counts the page is exactly what it was.
      if (seq === this.crossSeq) this.crossHits.set([]);
    }
  }

  private writeUrl(queryParams: Record<string, string | null>): void {
    mirrorQueryParams(this.router, this.route, this.location, queryParams);
  }

  async ngOnInit(): Promise<void> {
    this.applyRouteCategory();
    this.applyRouteFacets();
    this.applyRouteQuery();
    this.applyRouteState();
    this.routeApplied.set(true);
    // RSI artwork for ship cards + the upcoming badge count. Advisory and
    // silent: a failure just leaves the datamined renders as they were.
    void this.rsi.ensureLoaded();
    await this.svc.loadCurrentBuild();
    // UC-02: hangar membership backs the in-hangar badge on ship cards.
    if (this.hangar.ships().length === 0) void this.hangar.loadAll();
    await this.loadBlueprintCategories();
    if (this.kind() === 'weapon') await this.loadWeaponFacets();
  }

  /**
   * Category counts for the weapon rail. Advisory: a failure (or a build with
   * no weapons) just leaves the pills without a badge — the rail itself keeps
   * filtering, because the filter runs on the server, not on these rows.
   */
  private async loadWeaponFacets(): Promise<void> {
    if (this.weaponFacets().length > 0) return;
    try {
      this.weaponFacets.set(await this.svc.weaponFacets());
    } catch {
      this.weaponFacets.set([]);
    }
  }

  /**
   * Preselect a category from the route: `data.category` (the legacy
   * `/codex/upcoming` deep link, kept alive for the Verse-News CTA and any
   * bookmark) or `?kind=` on `/codex/index`. Unknown values are ignored.
   */
  private applyRouteCategory(): void {
    const snap = this.route.snapshot;
    // An explicit ?kind= wins over the route's preset: /codex/upcoming?kind=ship
    // is a reader who switched to ships there, and Back must bring ships back.
    const wanted = (snap.queryParamMap.get('kind') ?? snap.data['category'] ?? '') as string;
    const match = this.categories.find((c) => c === wanted);
    if (match) this.setCategory(match);
  }

  /**
   * Presets from the AN BORD / IM HANGAR archive quick-access links (prio 3):
   * `?group=fps|vehicle` narrows the blueprint category to that group,
   * `?weaponClass=Ship|FPS` picks the matching weapon super category. Must
   * run AFTER `applyRouteCategory` — `setKind` resets both facets, and a
   * preset applied before that reset would just be wiped again.
   */
  private applyRouteFacets(): void {
    const snap = this.route.snapshot;
    if (this.kind() === 'blueprint') {
      const group = snap.queryParamMap.get('group');
      if (group === 'fps' || group === 'vehicle') this.blueprintGroup.set(group);
    }
    if (this.kind() === 'weapon') {
      const weaponClass = snap.queryParamMap.get('weaponClass');
      if (weaponClass === 'Ship') this.weaponGroup.set('ship');
      else if (weaponClass === 'FPS') this.weaponGroup.set('fps');
    }
  }

  /**
   * Seed the search box from `?q=`, so a link can point at ONE entry instead of
   * dropping the reader into an unfiltered list. Routed to whichever search box
   * is actually on screen: the upcoming grid owns its own filter (on the shared
   * feed service), every other category uses this component's box.
   *
   * Must run AFTER `applyRouteCategory` — it decides which box that is.
   */
  private applyRouteQuery(): void {
    const q = (this.route.snapshot.queryParamMap.get('q') ?? '').trim();
    if (!q) return;
    if (this.isUpcoming()) {
      this.rsi.query.set(q);
      return;
    }
    this.searchInput.set(q);
    this.searchTerm.set(q);
  }

  /**
   * The rest of a list the reader left (see the URL effect in the constructor):
   * facets, weapon rail and the variant switch. Runs after the category is set,
   * because switching the category resets the facets.
   */
  private applyRouteState(): void {
    const q = this.route.snapshot.queryParamMap;
    const take = (key: string, set: (v: string) => void) => {
      const v = q.get(key);
      if (v) set(v);
    };
    take('mfr', (v) => this.manufacturer.set(v));
    // A size is a number: `?size=abc` from a typed link used to reach the
    // query as `size=eq.NaN` and put an error card over the list.
    take('size', (v) => /^\d{1,2}$/.test(v) && this.size.set(v));
    take('grade', (v) => this.grade.set(v));
    if (this.kind() === 'component') take('ck', (v) => this.componentKind.set(v));
    if (this.kind() === 'weapon') {
      take('wg', (v) => WEAPON_SUPER_GROUPS.some((g) => g.id === v) && this.weaponGroup.set(v));
      take('wsg', (v) => this.weaponSubGroup.set(v));
    }
    if (this.kind() === 'blueprint') take('bpc', (v) => this.blueprintCategory.set(v));
    if (q.get('v') === '1') this.includeVariants.set(true);
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

  /**
   * Announced ships (RSI feed) matching the current SHIP search, capped at
   * three names. `null` — not an empty array — when there is nothing to say, so
   * the template's `@if (...; as names)` collapses the whole hint away.
   *
   * Ships only: the feed is a ship matrix, so offering it while the reader
   * browses weapons would be noise. Reads the loaded feed without triggering a
   * fetch — `ngOnInit` already asked for it, and a feed that never arrives (or
   * errored) simply yields no hint.
   */
  readonly upcomingMatchNames = computed<string | null>(() => {
    if (this.category() !== 'ship') return null;
    const term = this.searchTerm().trim();
    if (!term) return null;
    const hits = this.rsi.searchLoadedShips(term, 3);
    return hits.length > 0 ? hits.map((s) => s.name).join(', ') : null;
  });

  /** Badge count for a strip entry; the upcoming one comes from the RSI feed. */
  categoryCount(k: CodexCategory): number | null {
    if (k === UPCOMING_CATEGORY) return this.rsi.feed()?.ships.length ?? null;
    return this.kindCount(k);
  }

  /** A plain left click switches in place; a modified one is the browser's (new tab, window …). */
  onCategoryClick(ev: MouseEvent, k: CodexCategory): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.setCategory(k);
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
    this.weaponGroup.set('');
    this.weaponSubGroup.set('');
    this.blueprintCategory.set('');
    this.blueprintGroup.set('');
    this.kind.set(k);
    if (k === 'weapon') void this.loadWeaponFacets();
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
  /** Picking a super category always drops the sub-category under the old one. */
  setWeaponGroup(v: string): void {
    if (v === this.weaponGroup()) return;
    this.weaponGroup.set(v);
    this.weaponSubGroup.set('');
  }
  setWeaponSubGroup(v: string): void { this.weaponSubGroup.set(v); }

  /** Badge count for a rail entry, or null while the facet read is pending. */
  weaponGroupCount(superId: string, subId?: string): number | null {
    return this.weaponGroupCounts().get(weaponGroupKey(superId, subId)) ?? null;
  }
  setIncludeVariants(v: boolean): void { this.includeVariants.set(v); }
  setBlueprintCategory(v: string): void { this.blueprintCategory.set(v); }
  /** `sc-segmented` emits 'all' for the no-op choice; the signal stores '' for it. */
  setBlueprintGroup(v: string): void {
    this.blueprintGroup.set(v === 'fps' || v === 'vehicle' ? v : '');
  }

  resetFilters(): void {
    this.manufacturer.set('');
    this.size.set('');
    this.grade.set('');
    this.componentKind.set('');
    this.weaponGroup.set('');
    this.weaponSubGroup.set('');
    this.blueprintCategory.set('');
    this.blueprintGroup.set('');
    this.includeVariants.set(false);
  }

  /** The filtered empty state's way out: the search AND the facets, not the facets alone. */
  resetAll(): void {
    this.clearSearch();
    this.resetFilters();
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

  togglePin(className: string): void {
    this.svc.togglePin(this.kind(), className);
  }

  /** Ship whose hangar add is in flight — one at a time, so a double click can't insert twice. */
  readonly addBusy = signal<string | null>(null);
  /** Ship whose last hangar add failed; its card says so until the next try. */
  readonly addFailed = signal<string | null>(null);

  /** UC-02: add a ship to the hangar inline, without leaving the list. */
  async addShipToHangar(className: string): Promise<void> {
    if (this.addBusy()) return;
    this.addBusy.set(className);
    this.addFailed.set(null);
    try {
      // A refused insert comes back as null, its reason parked in the hangar's
      // shared error, which this page never shows — so say it at the card.
      if (!(await this.hangar.addShip(className, 'owned'))) this.addFailed.set(className);
    } catch {
      this.addFailed.set(className);
    } finally {
      this.addBusy.set(null);
    }
  }

  /** UC-10: size S1–S12 as a 0–100% bar width for at-a-glance scanning. */
  sizePct(size: number): number {
    return Math.min(100, Math.max(8, Math.round((size / 12) * 100)));
  }

  private buildFilters(): CodexListFilters {
    // The single-category select wins when it names a category outside the
    // active group (e.g. group=fps but the reader picked a Vehicle bucket by
    // hand) — the group filter would otherwise silently empty the grid.
    const category = this.blueprintCategory();
    const groupCategories = this.blueprintGroupCategories();
    const blueprintCategoryIn =
      this.kind() === 'blueprint' && this.blueprintGroup() &&
      (!category || groupCategories.includes(category))
        ? groupCategories
        : undefined;
    return {
      search: this.searchTerm() || undefined,
      manufacturer: this.manufacturer() || undefined,
      size: this.size() ? Number(this.size()) : undefined,
      grade: this.grade() || undefined,
      componentKind: this.componentKind() || undefined,
      ...(this.kind() === 'weapon' ? weaponGroupQuery(this.weaponGroup(), this.weaponSubGroup()) : {}),
      category: category || undefined,
      blueprintCategoryIn,
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
      this.rawRows.set(reset ? res.rows : [...this.rawRows(), ...res.rows]);
      this.serverTotal.set(res.count);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.error.set((err as Error).message ?? 'Unknown error');
      if (reset) {
        this.rawRows.set([]);
        this.serverTotal.set(0);
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
