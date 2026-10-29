import { rankBySearch } from './codex-search';
import { CodexBuildDiffService } from './codex-build-diff.service';
import { toErrorKey } from '../core/describe-error';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  DestroyRef,
  computed,
  effect,
  Injector,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import {
  CODEX_KINDS,
  CodexFacetValues,
  CodexKind,
  CodexListFilters,
  CodexListRow,
  CodexService,
  FPS_ARMOR_ATTACH_TYPES,
  fpsArmorSlot,
  manufacturerFacetOptions,
  manufacturerLabel,
  pickLocalizedDistinct,
  toLang,
} from './codex.service';
import { UpcomingShip, UpcomingShipsService, upcomingRoleLabel } from './upcoming-ships.service';
import { HoloSilhouette, SilhouetteKind } from './holo-silhouette';
import { OverlayOriginService } from '../shared/overlay-frame/overlay-origin.service';
import { ScDialogDirective } from '../shared/dialog/sc-dialog.directive';
import { reloadOnBuildRefresh } from './build-refresh.util';
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
import { HqOwnershipService } from '../hq/hq-ownership.service';
import { HqLink, personalShipLink } from '../hq/hq-routes';
import { NeuroFieldDirective } from '../core/neuro-field.directive';
import { mirrorQueryParams } from './codex-url-state';
import { ARMOR_CATEGORY, ARMOR_SLOT_IDS, AreaNode, AreaTarget, CodexCategory, UPCOMING_CATEGORY, armorAttachTypeOf, inferWeaponSuperGroup } from './codex-browse-params';
import { FPS_ARMOR_SLOT_ID, fpsArmorWeightKey, fpsWeaponTypeKey } from './fps-labels';
import { ScSelectComponent, ScSelectOption } from '../shared/sc-select.component';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { isPlainLeftClick } from '../core/modified-click.util';
import { CodexDidYouMeanComponent } from './codex-did-you-mean.component';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { CodexSearchTriggerComponent } from './search/codex-search-trigger.component';
import { CODEX_ROOT_CRUMB, PageCrumb } from '../shared/page-header/nav-origin.service';
import { BarFacet, BarFilterToken, ShellChromeService } from '../shell/fusion-bar/shell-chrome.service';
import { BetaService } from '../core/beta.service';

/**
 * A row of the list: a list row after variant folding, livery grouping (FPS
 * weapons) and edition grouping (ships).
 */
type CodexGridRow = EditionGroupedRow<SkinGroupedRow<FoldedRow<CodexListRow>>>;

const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 250;
/** Idle time after which a typed search counts as committed (history entry, L33). */
export const SEARCH_COMMIT_MS = 1000;

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
export { UPCOMING_CATEGORY } from './codex-browse-params';
export type { CodexCategory } from './codex-browse-params';
export { ARMOR_CATEGORY, ARMOR_SLOT_IDS, armorAttachTypeOf, fpsToBrowseParams, inferWeaponSuperGroup } from './codex-browse-params';
export type { AreaNode, AreaTarget } from './codex-browse-params';


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
  selector: 'sc-codex-browse',
  standalone: true,
  imports: [NgTemplateOutlet, NeuroFieldDirective, RouterLink, TranslatePipe, CodexCompareTrayComponent, CodexCategoryIconComponent, CodexStatusBannerComponent, ScSegmentedComponent, ScSelectComponent, ScTooltipDirective, CodexDidYouMeanComponent, PageHeaderComponent, CodexSearchTriggerComponent, ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="browse">
      <sc-page-header
        [crumbs]="crumbs()"
        [eyebrow]="'codex.browse.eyebrow' | translate"
        [title]="areaLabelKey() | translate"
        [subtitle]="subtitle()">
        @if (!shellOn()) { <sc-codex-search-trigger phAside /> }
        @if (!shellOn()) { <sc-codex-status-banner phAside /> }
      </sc-page-header>

      <div class="layout">
        <aside class="side" [attr.aria-label]="'codex.browse.filtersAria' | translate">
          <ng-container [ngTemplateOutlet]="facetsTpl" />
        </aside>

        <div class="results">
          @if (!isUpcoming() && upcomingMatchNames(); as names) {
            <p class="upcoming-hint">
              <span class="soon-badge">{{ 'codex.upcoming.badge' | translate }}</span>
              <span>{{ 'codex.search.upcomingHint' | translate: { names } }}</span>
              <a class="upcoming-link" [routerLink]="['/codex', 'upcoming']" [queryParams]="{ q: searchInput().trim() }">
                {{ 'codex.search.upcomingLink' | translate }}
              </a>
            </p>
          }

          @if (listError(); as err) {
            <div class="sc-card err" role="alert">
              <span><strong>{{ 'codex.error.title' | translate }}:</strong> {{ err | translate }}</span>
              <button type="button" class="retry" (click)="reload()">{{ 'codex.error.retry' | translate }}</button>
            </div>
          } @else {
            <div class="list sc-card">
              <div class="list-head">
                <span class="count" role="status">
                  @if (listLoading() && listLength() === 0) {
                    {{ 'codex.results.loading' | translate }}
                  } @else {
                    {{ (listTotal() === 1 ? 'codex.results.countOne' : 'codex.results.count') | translate: { count: listTotal() } }}
                  }
                </span>
                @if (!isUpcoming()) {
                  <div class="sort">
                    <sc-select [options]="sortSelect()" [value]="sortNew() ? 'new' : 'name'"
                               [ariaLabel]="'codex.browse.sort.label' | translate"
                               (valueChange)="setSort($event)" />
                  </div>
                }
              </div>

              @if (isPartialKind() && !isUpcoming()) {
                <p class="partial-note">{{ 'codex.empty.partial' | translate }}</p>
              }
              @if (blueprintRecipesMissing()) {
                <p class="partial-note">{{ 'blueprint.recipesMissing' | translate }}</p>
              }

              @if (listLoading() && listLength() === 0) {
                <ul class="rows" role="list">
                  @for (s of skeletons; track s; let i = $index) {
                    <li class="row skel sc-skel-field" scNeuroField [neuroIndex]="i" [style.--sc-skel-i]="i"></li>
                  }
                </ul>
              } @else if (listLength() === 0) {
                <div class="empty">
                  <strong>{{ 'codex.empty.title' | translate }}</strong>
                  @if (hasActiveFilters() || searchInput().trim()) {
                    <p>{{ 'codex.empty.filtered' | translate }}</p>
                    @if (searchInput().trim()) {
                      <sc-codex-did-you-mean [names]="suggestions()" (pick)="searchFor($event)" />
                    }
                    <button type="button" class="reset-all" (click)="resetAll()">{{ 'codex.empty.resetAll' | translate }}</button>
                  } @else {
                    <p>{{ 'codex.empty.kind' | translate: { kind: (areaLabelKey() | translate) } }}</p>
                  }
                </div>
              } @else if (isUpcoming()) {
                <ul class="rows" role="list">
                  @for (s of upcomingRows(); track s.id) {
                    <li class="row">
                      <a class="row-link" [routerLink]="['/codex/upcoming', s.id]" (click)="openUpcoming($event)">
                        <span class="sil icon" aria-hidden="true"><sc-codex-icon kind="ship" /></span>
                        <span class="main">
                          <span class="name">{{ s.name }}</span>
                          @if (upcomingMeta(s); as m) { <span class="meta">{{ m }}</span> }
                        </span>
                        <span class="spec"><span class="soon">{{ 'codex.upcoming.badge' | translate }}</span></span>
                      </a>
                      <span class="acts">
                        <button type="button" class="act pin" [class.pinned]="rsi.isFavorite(s.id)"
                                [attr.aria-pressed]="rsi.isFavorite(s.id)"
                                [attr.aria-label]="(rsi.isFavorite(s.id) ? 'codex.upcoming.favorite.remove' : 'codex.upcoming.favorite.add') | translate"
                                [scTooltip]="(rsi.isFavorite(s.id) ? 'codex.upcoming.favorite.remove' : 'codex.upcoming.favorite.add') | translate"
                                scTooltipTier="label"
                                (click)="rsi.toggleFavorite(s.id)">{{ rsi.isFavorite(s.id) ? '★' : '☆' }}</button>
                      </span>
                    </li>
                  }
                </ul>
              } @else {
                <ul class="rows" role="list">
                  @for (r of rows(); track r.classNameSlug) {
                    <li class="row">
                      <a class="row-link" [routerLink]="['/codex', kind(), r.classNameSlug]">
                        @if (silhouetteOf(r); as s) {
                          <span class="sil" aria-hidden="true">
                            <svg [attr.viewBox]="s.viewBox" preserveAspectRatio="xMidYMid meet" focusable="false"><path [attr.d]="s.path" /></svg>
                          </span>
                        } @else {
                          <span class="sil icon" aria-hidden="true"><sc-codex-icon [kind]="kind()" [sub]="iconSub(r)" [attachType]="r.attachType" /></span>
                        }
                        <span class="main">
                          <span class="name">{{ cardName(r) }}</span>
                          <span class="meta">
                            @if (rowMeta(r); as m) { <span>{{ m }}</span> }
                            @if (r.weaponClass) { <span class="wc">{{ ('codex.weaponClass.' + r.weaponClass) | translate }}</span> }
                          </span>
                        </span>
                        <span class="spec">
                          @if (r.size !== null && r.size !== undefined) { <span class="size">S{{ r.size }}</span> }
                          @if (r.grade) { <span class="grade">{{ 'codex.card.grade' | translate: { grade: r.grade } }}</span> }
                        </span>
                      </a>
                      <span class="acts">
                        @if (kind() === 'ship') {
                          @if (shipVariantLink(r.classNameSlug); as l) {
                            <a class="act hangar-chip" [routerLink]="l.commands" [queryParams]="l.queryParams"
                               [attr.aria-label]="'codex.personal.openVariant' | translate"
                               [scTooltip]="'codex.personal.openVariant' | translate" scTooltipTier="label">✓</a>
                          } @else if (inHangarSet().has(r.classNameSlug.toLowerCase())) {
                            <span class="act hangar-chip" role="img" tabindex="0"
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
                                scTooltipTier="label">{{ isPinned(r.classNameSlug) ? '★' : '☆' }}</button>
                      </span>
                      @if (addFailed() === r.classNameSlug) {
                        <p class="row-err" role="alert">{{ 'codex.card.addToHangarFailed' | translate }}</p>
                      }
                    </li>
                  }
                </ul>
                @if (hasMore()) {
                  <div class="more-row">
                    <span class="showing">{{ 'codex.results.showingOf' | translate: { shown: rows().length, total: total() } }}</span>
                    <button type="button" class="load-more" [disabled]="loading()" (click)="loadMore()">
                      {{ (loading() ? 'codex.results.loading' : 'codex.results.loadMore') | translate }}
                    </button>
                  </div>
                }
              }
            </div>

            <!-- Hits of the same term in the other areas, under the list (concept 2026-10-29, a-s2). -->
            @if (!isUpcoming() && crossHits().length > 0) {
              <ul class="also" role="list" [attr.aria-label]="'codex.search.alsoIn' | translate">
                @for (h of crossHits(); track h.kind) {
                  <li>
                    <a class="also-link" [attr.href]="categoryHrefs().get(h.kind)" (click)="onCategoryClick($event, h.kind)">
                      {{ (h.count === 1 ? 'codex.browse.alsoInOne' : 'codex.browse.alsoInMany') | translate: { kind: ('codex.kinds.' + h.kind) | translate, count: h.count } }}
                    </a>
                  </li>
                }
              </ul>
            }
          }
        </div>
      </div>

      <!-- Phones: the facets live in a bottom sheet behind one button. -->
      <button type="button" class="filter-fab" (click)="filtersOpen.set(true)" [attr.aria-expanded]="filtersOpen()">
        {{ 'codex.browse.filterButton' | translate: { count: activeFilterCount() } }}
      </button>
      @if (filtersOpen()) {
        <div class="sheet-backdrop" aria-hidden="true" (click)="filtersOpen.set(false)"></div>
        <div class="sheet" scDialog role="dialog" aria-modal="true"
             [attr.aria-label]="'codex.browse.filtersAria' | translate"
             (scDialogEscape)="filtersOpen.set(false)">
          <div class="sheet-head">
            <strong>{{ 'codex.browse.filtersTitle' | translate }}</strong>
            <button type="button" class="sheet-close" (click)="filtersOpen.set(false)"
                    [attr.aria-label]="'codex.browse.closeFilters' | translate"
                    [scTooltip]="'codex.browse.closeFilters' | translate" scTooltipTier="label">✕</button>
          </div>
          <ng-container [ngTemplateOutlet]="facetsTpl" />
          <button type="button" class="sheet-done" (click)="filtersOpen.set(false)">
            {{ 'codex.browse.showResults' | translate: { count: listTotal() } }}
          </button>
        </div>
      }

      <sc-codex-compare-tray />
    </section>

    <ng-template #facetsTpl>
      <nav class="tree" [attr.aria-label]="'codex.browse.areaLabel' | translate">
        <p class="side-h">{{ 'codex.browse.areaLabel' | translate }}</p>
        <ng-container [ngTemplateOutlet]="nodesTpl" [ngTemplateOutletContext]="{ $implicit: areaTree(), depth: 0 }" />
      </nav>
      @if (!isUpcoming()) {
        @if (manufacturerOptions().length > 0) {
          <div class="facet">
            <span class="side-h">{{ 'codex.filters.manufacturer' | translate }}</span>
            <sc-select [options]="manufacturerSelect()" [value]="manufacturer() || null" placeholderKey="codex.filters.all"
                       [ariaLabel]="'codex.filters.manufacturer' | translate"
                       (valueChange)="setManufacturer($event ?? '')" />
          </div>
        }
        @if (sizeOptions().length > 1 || size()) {
          <div class="facet">
            <span class="side-h">{{ 'codex.filters.size' | translate }}</span>
            <sc-segmented [options]="sizeSegments()" [value]="size() || 'all'"
                          [ariaLabel]="'codex.filters.size' | translate"
                          (valueChange)="setSize($event === 'all' ? '' : $event)" />
          </div>
        }
        @if (gradeOptions().length > 1 || grade()) {
          <div class="facet">
            <span class="side-h">{{ 'codex.filters.grade' | translate }}</span>
            <sc-select [options]="gradeSelect()" [value]="grade() || null" placeholderKey="codex.filters.anyGrade"
                       [ariaLabel]="'codex.filters.grade' | translate"
                       (valueChange)="setGrade($event ?? '')" />
          </div>
        }
        @if (kind() === 'component' && componentKindOptions().length > 0) {
          <div class="facet">
            <span class="side-h">{{ 'codex.filters.componentKind' | translate }}</span>
            <sc-select [options]="componentKindSelect()" [value]="componentKind() || null" placeholderKey="codex.filters.all"
                       [ariaLabel]="'codex.filters.componentKind' | translate"
                       (valueChange)="setComponentKind($event ?? '')" />
          </div>
        }
        @if (kind() === 'blueprint') {
          <div class="facet">
            <span class="side-h">{{ 'codex.filters.blueprintGroup' | translate }}</span>
            <sc-segmented [options]="blueprintGroupOptions" [value]="blueprintGroup() || 'all'"
                          [ariaLabel]="'codex.filters.blueprintGroup' | translate"
                          (valueChange)="setBlueprintGroup($event)" />
          </div>
          @if (blueprintCategoryOptions().length > 0) {
            <div class="facet">
              <span class="side-h">{{ 'blueprint.filters.category' | translate }}</span>
              <sc-select [options]="blueprintCategorySelect()" [value]="blueprintCategory() || null" placeholderKey="codex.filters.all"
                         [ariaLabel]="'blueprint.filters.category' | translate"
                         (valueChange)="setBlueprintCategory($event ?? '')" />
            </div>
          }
        }
        @if (supportsVariants()) {
          <label class="facet check">
            <input type="checkbox" [checked]="includeVariants()" (change)="onVariantsToggle($event)" />
            <span>{{ 'codex.filters.includeVariants' | translate }}</span>
          </label>
        }
        @if (hasActiveFilters()) {
          <button class="reset" type="button" (click)="resetFilters()">{{ 'codex.filters.reset' | translate }}</button>
        }
      }
    </ng-template>

    <ng-template #nodesTpl let-nodes let-depth="depth">
      <ul class="nodes" role="list" [class.nested]="depth > 0">
        @for (n of nodes; track n.id) {
          <li>
            <a class="node" [class.on]="n.active" [class.current]="n.current"
               [attr.aria-current]="n.current ? 'page' : null"
               [attr.href]="n.href" (click)="onAreaClick($event, n)">
              <span class="node-label">{{ n.labelKey | translate }}</span>
              @if (n.count !== null) { <span class="node-ct">{{ n.count }}</span> }
            </a>
            @if (n.open && n.children.length > 0) {
              <ng-container [ngTemplateOutlet]="nodesTpl" [ngTemplateOutletContext]="{ $implicit: n.children, depth: depth + 1 }" />
            }
          </li>
        }
      </ul>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .browse { display: flex; flex-direction: column; gap: var(--sc-space-4, 16px); padding-bottom: 80px; }
    .layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: var(--sc-space-4, 16px); align-items: start; }
    .side {
      position: sticky; top: calc(var(--sc-sticky-top, 0px) + var(--sc-space-3, 12px));
      display: flex; flex-direction: column; gap: var(--sc-space-3, 12px);
      max-height: calc(100dvh - var(--sc-sticky-top, 0px) - 24px); overflow-y: auto;
    }
    .side-h { margin: 0 0 6px; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--sc-fg-2); }
    .nodes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
    .nodes.nested { padding-left: 12px; margin: 2px 0 4px 6px; border-left: 1px solid var(--sc-border); }
    .node {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      min-height: max(32px, var(--sc-tap-min, 0px)); padding: 4px 10px; border-radius: 6px;
      color: var(--sc-fg-1); text-decoration: none; font-size: 13px;
    }
    .node:hover { background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
    .node:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    .node.on { color: var(--sc-fg-0); }
    .node.current { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-accent); }
    .node-ct { font-size: 11px; color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }
    .facet { display: flex; flex-direction: column; gap: 2px; }
    .facet.check { flex-direction: row; align-items: center; gap: 8px; font-size: 13px; color: var(--sc-fg-1); cursor: pointer; }
    .facet.check input { accent-color: var(--sc-accent); }
    .reset { align-self: flex-start; background: none; border: 0; padding: 4px 0; color: var(--sc-accent); cursor: pointer; font: inherit; font-size: 13px; text-decoration: underline; }
    .reset:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

    .results { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); min-width: 0; }
    .list { padding: 0; overflow: hidden; }
    .list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--sc-border); }
    .count { font-size: 13px; color: var(--sc-fg-1); font-variant-numeric: tabular-nums; }
    .sort { min-width: 180px; }
    .partial-note { margin: 0; padding: 8px 14px; font-size: 12px; color: var(--sc-fg-2); border-bottom: 1px solid var(--sc-border); }
    .rows { list-style: none; margin: 0; padding: 0; }
    .row { position: relative; display: flex; align-items: center; border-bottom: 1px solid var(--sc-border); }
    .row:last-child { border-bottom: 0; }
    .row.skel { height: 56px; }
    .row-link {
      flex: 1 1 auto; min-width: 0; display: grid; grid-template-columns: 56px minmax(0, 1fr) auto;
      align-items: center; gap: 14px; min-height: 56px; padding: 6px 14px; color: inherit; text-decoration: none;
    }
    .row:hover, .row:focus-within { background: color-mix(in srgb, var(--sc-accent) 6%, transparent); }
    .row-link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .sil { width: 56px; height: 34px; display: inline-flex; align-items: center; justify-content: center; color: var(--sc-accent); }
    .sil svg { width: 100%; height: 100%; overflow: visible; }
    .sil path {
      fill: color-mix(in srgb, var(--sc-accent) 10%, transparent); stroke: currentColor;
      stroke-width: 1.2; vector-effect: non-scaling-stroke; stroke-linejoin: round;
      filter: drop-shadow(0 0 2px color-mix(in srgb, var(--sc-accent) 55%, transparent));
    }
    .sil.icon { color: var(--sc-fg-2); }
    .sil.icon sc-codex-icon { width: 22px; height: 22px; }
    .main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .name { font-size: 14px; color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 12px; color: var(--sc-fg-2); min-width: 0; }
    .wc { flex: none; padding: 0 6px; border: 1px solid var(--sc-border); border-radius: 4px; font-size: 11px; color: var(--sc-fg-1); }
    .spec { display: flex; align-items: baseline; gap: 12px; font-size: 12px; color: var(--sc-fg-1); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .size { color: var(--sc-fg-0); font-weight: 600; }
    .soon { color: var(--sc-accent); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
    .acts { flex: none; display: flex; align-items: center; gap: 4px; padding-right: 10px; opacity: 0; transition: opacity 120ms ease; }
    .row:hover .acts, .row:focus-within .acts { opacity: 1; }
    .act {
      display: inline-flex; align-items: center; justify-content: center;
      width: max(32px, var(--sc-tap-min, 0px)); height: max(32px, var(--sc-tap-min, 0px));
      border-radius: 6px; border: 1px solid var(--sc-border); background: var(--sc-bg-1);
      color: var(--sc-fg-1); cursor: pointer; font: inherit; text-decoration: none;
    }
    .act:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .act:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    .act.pinned, .hangar-chip { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .act:disabled { opacity: .5; cursor: default; }
    .row-err { position: absolute; right: 14px; bottom: 2px; margin: 0; font-size: 11px; color: var(--sc-danger); }
    .more-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-top: 1px solid var(--sc-border); }
    .showing { font-size: 12px; color: var(--sc-fg-2); }
    .load-more, .reset-all, .sheet-done {
      min-height: max(36px, var(--sc-tap-min, 0px)); padding: 6px 16px; border-radius: 6px; cursor: pointer; font: inherit;
      border: 1px solid var(--sc-accent); background: transparent; color: var(--sc-accent);
    }
    .load-more:hover, .reset-all:hover, .sheet-done:hover { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
    .load-more:disabled { opacity: .6; cursor: default; }
    .load-more:focus-visible, .reset-all:focus-visible, .sheet-done:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .empty { padding: 24px 14px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; color: var(--sc-fg-1); }
    .empty p { margin: 0; }
    .also { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .also-link {
      display: flex; align-items: center; min-height: max(40px, var(--sc-tap-min, 0px)); padding: 6px 14px;
      border: 1px dashed var(--sc-border); border-radius: 8px; color: var(--sc-accent); text-decoration: none; font-size: 13px;
    }
    .also-link:hover { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 6%, transparent); }
    .also-link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .upcoming-hint { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; color: var(--sc-fg-1); }
    .soon-badge { padding: 1px 6px; border-radius: 4px; border: 1px solid var(--sc-accent); color: var(--sc-accent); font-size: 11px; }
    .upcoming-link { color: var(--sc-accent); }
    .err { color: var(--sc-danger); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .err .retry { margin-left: auto; padding: 6px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font: inherit; }
    .err .retry:focus-visible { outline: 2px solid var(--sc-danger); outline-offset: 2px; }

    .filter-fab, .sheet, .sheet-backdrop { display: none; }
    @media (pointer: coarse) {
      .acts { opacity: 1; }
    }
    @media (max-width: 767px) {
      .layout { grid-template-columns: minmax(0, 1fr); }
      .side { display: none; }
      .acts { opacity: 1; }
      .sil { width: 44px; }
      .row-link { grid-template-columns: 44px minmax(0, 1fr) auto; gap: 10px; padding: 6px 10px; }
      .filter-fab {
        display: inline-flex; align-items: center; justify-content: center;
        position: fixed; z-index: 30; left: var(--sc-space-3, 12px); right: var(--sc-fab-clear-inline);
        bottom: var(--sc-float-bottom); min-height: 48px; border-radius: 24px;
        border: 1px solid var(--sc-accent); background: var(--sc-bg-1); color: var(--sc-accent); font: inherit; cursor: pointer;
      }
      .filter-fab:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .browse { padding-bottom: calc(var(--sc-fab-clear-block) + 24px); }
      .sheet-backdrop { display: block; position: fixed; inset: 0; z-index: 40; background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); }
      .sheet {
        display: flex; flex-direction: column; gap: 14px; position: fixed; z-index: 41; left: 0; right: 0; bottom: 0;
        max-height: 85vh; max-height: 85dvh; overflow-y: auto; padding: 16px 16px calc(16px + var(--sc-safe-bottom, 0px));
        background: var(--sc-bg-1); border-top: 1px solid var(--sc-border); border-radius: 14px 14px 0 0;
      }
      .sheet-head { display: flex; align-items: center; justify-content: space-between; }
      .sheet-close {
        width: 44px; height: 44px; border-radius: 8px; border: 1px solid var(--sc-border); background: transparent;
        color: var(--sc-fg-1); cursor: pointer; font: inherit;
      }
      .sheet-close:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .node { min-height: 44px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .acts { transition: none; }
    }
  `],
})

export class CodexBrowseComponent implements OnInit {
  /** Beta "shell": kinds + filters move into the Fusion bar. */
  protected readonly shellOn = inject(BetaService).isEnabled('shell');
  readonly svc = inject(CodexService);
  private readonly t = inject(TranslateService);
  private readonly hangar = inject(HangarService);
  readonly rsi = inject(UpcomingShipsService);
  private readonly overlayOrigin = inject(OverlayOriginService);
  private readonly chrome = inject(ShellChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  /**
   * `?sort=new` (the Codex landing's "+ N weitere" tile): ships new in this
   * patch first, newest first; the rest keeps the server's alphabetical order.
   */
  readonly sortNew = signal(false);
  private readonly newShipOrder = signal<ReadonlyMap<string, number>>(new Map());
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  // Data language tracks the UI language as a SIGNAL so OnPush card titles
  // re-render on a language switch (they previously read t.currentLang
  // directly and stayed stale until the next unrelated CD cycle). (#50)
  private readonly dataLang = signal(toLang(this.t.getCurrentLang()));

  readonly kinds = CODEX_KINDS;
  /** Datamined kinds + the RSI-sourced "upcoming ships" category. */
  readonly categories: readonly CodexCategory[] = [...CODEX_KINDS, ARMOR_CATEGORY, UPCOMING_CATEGORY];
  /** Phones: the facet sheet is open. */
  readonly filtersOpen = signal(false);
  /** `?slot=` — one armour slot id ('helmet'), '' = all armour. */
  readonly armorSlot = signal('');
  /** Records per armour attach type (advisory, for the tree counts). */
  private readonly armorCounts = signal<ReadonlyMap<string, number>>(new Map());
  /** Silhouettes of the rows on screen, by class name (codex_silhouettes). */
  private readonly silhouetteMap = signal<ReadonlyMap<string, HoloSilhouette>>(new Map());
  private readonly silhouetteAsked = new Set<string>();

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
        const tree = this.router.createUrlTree(k === UPCOMING_CATEGORY ? ['/codex/upcoming'] : ['/codex/index'], {
          queryParams: k === UPCOMING_CATEGORY ? { q } : { kind: k, q },
        });
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
  private readonly ownership = inject(HqOwnershipService);
  /** Lower-cased class names of every hangar ship (HQ ownership index). */
  readonly inHangarSet = computed(() => this.ownership.shipClassNames());

  /** Signpost into the reader's own copy: their active (else first) variant of this hull. */
  shipVariantLink(classNameSlug: string): HqLink | null {
    const c = this.ownership.lookup(classNameSlug)?.configs[0];
    return c ? personalShipLink(classNameSlug, c.id) : null;
  }

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
    if (k === ARMOR_CATEGORY) return this.kindCount('item') === 0;
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

  /**
   * The row's type in words, or null. Only a TRANSLATED value is shown: a raw
   * token ("UNDEFINED", "Ball") never reaches the list (concept 2026-10-29, u4).
   */
  typeLabel(r: CodexListRow): string | null {
    this.dataLang();
    const tr = (key: string): string | null => {
      const v = this.t.instant(key);
      return typeof v === 'string' && v && v !== key ? v : null;
    };
    if (r.componentKind) return tr('codex.componentKind.' + r.componentKind);
    if (r.blueprintCategory) return this.categoryLabel(r.blueprintCategory);
    if (this.category() === ARMOR_CATEGORY) {
      const slot = FPS_ARMOR_SLOT_ID[fpsArmorSlot(r.attachType) ?? ''];
      if (slot) return tr('codex.landing.paperdoll.' + slot);
    }
    const key = this.subTypeKey(r);
    return key ? tr(key) : null;
  }

  /** "Manufacturer · type" under the row's name; null when neither is known. */
  rowMeta(r: CodexListRow): string | null {
    const parts = [this.cardMfr(r), this.typeLabel(r)].filter((p): p is string => !!p);
    return parts.length ? parts.join(' · ') : null;
  }

  /** The silhouette of a row, or null (the category icon stands in). */
  silhouetteOf(r: CodexListRow): HoloSilhouette | null {
    return this.silhouetteMap().get(r.classNameSlug) ?? null;
  }

  /** Which silhouette table slice a row of the current area reads. */
  private silhouetteKind(): SilhouetteKind | null {
    if (this.category() === ARMOR_CATEGORY) return 'armor';
    const k = this.kind();
    return k === 'ship' || k === 'weapon' || k === 'component' || k === 'item' ? k : null;
  }

  /** Batch-load silhouettes for rows not asked for yet. Advisory: a failure keeps the icons. */
  private async loadSilhouettes(rows: readonly CodexListRow[]): Promise<void> {
    const kind = this.silhouetteKind();
    if (!kind) return;
    const wanted = rows.map((r) => r.classNameSlug).filter((c) => !this.silhouetteAsked.has(kind + ':' + c));
    if (!wanted.length) return;
    wanted.forEach((c) => this.silhouetteAsked.add(kind + ':' + c));
    try {
      const found = await this.svc.silhouettes(kind, wanted);
      if (!found.size) return;
      const next = new Map(this.silhouetteMap());
      for (const [c, s] of found) next.set(c, s);
      this.silhouetteMap.set(next);
    } catch {
      /* the category icon stays */
    }
  }

  /** "Manufacturer · role" of an announced ship. */
  upcomingMeta(s: UpcomingShip): string | null {
    this.dataLang();
    const role = s.type || s.focus ? upcomingRoleLabel(s.type || s.focus, (k) => this.t.instant(k)) : '';
    const parts = [s.manufacturer, role].filter((p): p is string => !!p);
    return parts.length ? parts.join(' · ') : null;
  }

  /** Beta shell: a plain click on an announced ship opens it as an overlay over this list. */
  openUpcoming(ev: MouseEvent): void {
    if (this.shellOn() && isPlainLeftClick(ev)) this.overlayOrigin.fromList();
  }

  /** Announced ships matching the term, concept first. */
  readonly upcomingRows = computed(() => [...this.rsi.concept(), ...this.rsi.flightReadyMissing()]);

  /** What the list renders right now — the catalog rows or the announced ships. */
  readonly listLength = computed(() => (this.isUpcoming() ? this.upcomingRows().length : this.rows().length));
  readonly listTotal = computed(() => (this.isUpcoming() ? this.upcomingRows().length : this.total()));
  readonly listLoading = computed(() => (this.isUpcoming() ? this.rsi.loading() : this.loading()));
  readonly listError = computed(() => (this.isUpcoming() ? this.rsi.error() : this.error()));

  /** i18n key of the area on screen — the page's h1. */
  readonly areaLabelKey = computed(() => {
    const c = this.category();
    if (c === ARMOR_CATEGORY) {
      return this.armorSlot() ? 'codex.landing.paperdoll.' + this.armorSlot() : 'codex.browse.area.armor';
    }
    if (c === 'weapon' && this.weaponGroup()) {
      return this.weaponSubGroup()
        ? 'codex.weaponGroup.' + this.weaponGroup() + '.' + this.weaponSubGroup()
        : 'codex.weaponGroup.super.' + this.weaponGroup();
    }
    return 'codex.kinds.' + c;
  });

  /** Codex › area › sub area — every crumb a real link. */
  readonly crumbs = computed<readonly PageCrumb[]>(() => {
    const out: PageCrumb[] = [CODEX_ROOT_CRUMB];
    const c = this.category();
    if (c === 'weapon' && this.weaponGroup()) {
      out.push({ labelKey: 'codex.kinds.weapon', link: ['/codex/index'], queryParams: { kind: 'weapon' } });
      if (this.weaponSubGroup()) {
        out.push({
          labelKey: 'codex.weaponGroup.super.' + this.weaponGroup(),
          link: ['/codex/index'],
          queryParams: { kind: 'weapon', wg: this.weaponGroup() },
        });
      }
    } else if (c === ARMOR_CATEGORY && this.armorSlot()) {
      out.push({ labelKey: 'codex.browse.area.armor', link: ['/codex/index'], queryParams: { kind: ARMOR_CATEGORY } });
    }
    return out;
  });

  /** "16 of 1346 weapons · 4.3.2" — filtered count, the area's size, the patch. */
  readonly subtitle = computed<string | null>(() => {
    this.dataLang();
    const patch = this.svc.build()?.patchVersion ?? '';
    if (this.listLoading() && this.listLength() === 0) return patch || null;
    const total = this.isUpcoming() ? (this.rsi.feed()?.ships.length ?? null) : this.categoryCount(this.category());
    const params = { shown: this.listTotal(), total: total ?? this.listTotal(), patch };
    const key = total != null && total !== this.listTotal() ? 'codex.browse.subtitleOf' : 'codex.browse.subtitleAll';
    return this.t.instant(patch ? key : key + 'NoPatch', params) as string;
  });

  /** Number of active facets — the phone button's "(n)". */
  readonly activeFilterCount = computed(
    () =>
      [this.manufacturer(), this.size(), this.grade(), this.componentKind(), this.blueprintCategory(), this.blueprintGroup()].filter(Boolean)
        .length + (this.includeVariants() ? 1 : 0),
  );

  readonly sortSelect = computed<ScSelectOption[]>(() => [
    { value: 'name', labelKey: 'codex.browse.sort.name' },
    ...(this.kind() === 'ship' ? [{ value: 'new', labelKey: 'codex.browse.sort.new' }] : []),
  ]);

  readonly sizeSegments = computed<ScSegmentOption[]>(() => [
    { value: 'all', labelKey: 'codex.browse.sizeAll' },
    ...this.sizeOptions().map((s) => ({ value: s, label: 'S' + s })),
  ]);

  setSort(v: string | null): void {
    const on = v === 'new' && this.kind() === 'ship';
    this.sortNew.set(on);
    if (on && !this.newShipOrder().size) this.loadNewShipOrder();
    mirrorQueryParams(this.router, this.route, this.location, { sort: on ? 'new' : null });
  }

  onVariantsToggle(ev: Event): void {
    this.setIncludeVariants((ev.target as HTMLInputElement).checked);
  }

  /** The "Bereich" tree: every area with its count, the current path open. */
  readonly areaTree = computed<AreaNode[]>(() => {
    const cat = this.category();
    const wg = this.weaponGroup();
    const wsg = this.weaponSubGroup();
    const slot = this.armorSlot();
    const node = (id: string, labelKey: string, count: number | null, target: AreaTarget, active: boolean, current: boolean, children: AreaNode[] = []): AreaNode => ({
      id, labelKey, count, target, active, current, open: active, children, href: this.areaHref(target),
    });
    const out: AreaNode[] = [];
    for (const k of this.categories) {
      if (this.isComingSoon(k)) continue;
      const on = cat === k;
      if (k === 'weapon') {
        const supers = WEAPON_SUPER_GROUPS.map((g) => {
          const gOn = on && wg === g.id;
          const subs = g.subGroups
            .filter((s) => (this.weaponGroupCount(g.id, s.id) ?? 1) > 0)
            .map((s) => node(g.id + '-' + s.id, 'codex.weaponGroup.' + g.id + '.' + s.id, this.weaponGroupCount(g.id, s.id), { category: 'weapon', wg: g.id, wsg: s.id }, gOn && wsg === s.id, gOn && wsg === s.id));
          return node('weapon-' + g.id, 'codex.weaponGroup.super.' + g.id, this.weaponGroupCount(g.id), { category: 'weapon', wg: g.id }, gOn, gOn && !wsg, subs);
        });
        out.push(node('weapon', 'codex.kinds.weapon', this.kindCount('weapon'), { category: 'weapon' }, on, on && !wg, supers));
      } else if (k === ARMOR_CATEGORY) {
        const counts = this.armorCounts();
        const slots = ARMOR_SLOT_IDS.map((id) => {
          const at = armorAttachTypeOf(id);
          return node('armor-' + id, 'codex.landing.paperdoll.' + id, at ? (counts.get(at) ?? null) : null, { category: ARMOR_CATEGORY, slot: id }, on && slot === id, on && slot === id);
        }).filter((n) => n.count !== 0);
        const total = counts.size ? [...counts.values()].reduce((a, b) => a + b, 0) : null;
        out.push(node('armor', 'codex.browse.area.armor', total, { category: ARMOR_CATEGORY }, on, on && !slot, slots));
      } else {
        out.push(node(k, 'codex.kinds.' + k, this.categoryCount(k), { category: k }, on, on));
      }
    }
    return out;
  });

  private areaHref(t: AreaTarget): string | null {
    const q = (t.category === UPCOMING_CATEGORY ? this.rsi.query() : this.searchTerm()) || null;
    const params: Record<string, string | null> =
      t.category === UPCOMING_CATEGORY ? { q } : { kind: t.category, wg: t.wg ?? null, wsg: t.wsg ?? null, slot: t.slot ?? null, q };
    try {
      const tree = this.router.createUrlTree(t.category === UPCOMING_CATEGORY ? ['/codex/upcoming'] : ['/codex/index'], { queryParams: params });
      return this.location.prepareExternalUrl(this.router.serializeUrl(tree));
    } catch {
      return null;
    }
  }

  onAreaClick(ev: MouseEvent, n: AreaNode): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.applyArea(n.target);
    this.filtersOpen.set(false);
  }

  /** Switch the list to one area of the tree, in place. */
  applyArea(t: AreaTarget): void {
    this.setCategory(t.category);
    if (t.category === 'weapon') {
      this.weaponGroup.set(t.wg ?? '');
      this.weaponSubGroup.set(t.wsg ?? '');
    }
    if (t.category === ARMOR_CATEGORY) this.armorSlot.set(t.slot ?? '');
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
      const raw = this.rawRows().map((r) => ({
        ...r,
        foldedClassNames: [] as readonly string[],
        skinVariants: [] as readonly SkinVariantRef[],
        editions: [] as readonly EditionRef[],
      }));
      return this.rankFirstPage(raw);
    }
    const grouped = groupSkinRows(foldVariantRows(this.rawRows(), (r) => this.cardName(r)));
    // Edition grouping reads a class-name lineage only the vehicle catalog
    // carries, so it stays off every other kind.
    const rows: CodexGridRow[] =
      this.kind() === 'ship'
        ? groupEditionRows(grouped)
        : grouped.map((r) => ({ ...r, editions: [] as readonly EditionRef[] }));
    // The server answers alphabetically; a search puts the exact and prefix
    // matches first ("gladius" → Gladius before Gladius Valiant before a
    // Pirate edition), the server order breaking ties.
    return this.newFirst(this.rankFirstPage(rows));
  });

  /** Stable: new-this-patch ships move to the front in diff order, nothing else moves. */
  private newFirst<T extends CodexGridRow>(rows: T[]): T[] {
    const order = this.newShipOrder();
    if (!this.sortNew() || !order.size) return rows;
    const rank = (r: T) => order.get(r.classNameSlug) ?? Number.MAX_SAFE_INTEGER;
    return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((e) => e.r);
  }

  /**
   * Relevance order for the FIRST page only; later pages append in server
   * order. Re-ranking everything on "load more" made a page-2 match jump above
   * cards the reader had already scrolled past (redteam R6).
   */
  private rankFirstPage<T extends CodexGridRow>(rows: T[]): T[] {
    const term = this.searchTerm();
    if (!term) return rows;
    const firstPage = new Set(this.rawRows().slice(0, PAGE_SIZE).map((r) => r.classNameSlug));
    const head = rows.filter((r) => firstPage.has(r.classNameSlug));
    const tail = rows.filter((r) => !firstPage.has(r.classNameSlug));
    return [...rankBySearch(term, head, (r) => [this.cardName(r), r.nameLocalized], (r) => [r.classNameSlug]), ...tail];
  }
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
  /** i18n key, never raw text. */
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

  /** The active facets as the shell bar's removable tokens (beta shell, "Satinkante" bar). */
  readonly barTokens = computed<readonly BarFilterToken[]>(() => {
    const out: BarFilterToken[] = [];
    const add = (id: string, labelKey: string, value: string | null, remove: () => void) =>
      out.push({ id, labelKey, value, remove });
    const mfr = this.manufacturer();
    if (mfr) {
      const label = this.manufacturerOptions().find((m) => m.code === mfr)?.label ?? mfr;
      add('manufacturer', 'codex.filters.manufacturer', label, () => this.setManufacturer(''));
    }
    if (this.size()) add('size', 'codex.filters.size', 'S' + this.size(), () => this.setSize(''));
    if (this.grade()) add('grade', 'codex.filters.grade', this.grade(), () => this.setGrade(''));
    if (this.componentKind()) add('componentKind', 'codex.filters.componentKind', this.componentKind(), () => this.setComponentKind(''));
    if (this.weaponGroup()) {
      add('weaponGroup', 'fusionBar.filter.weaponGroup', this.weaponSubGroup() || this.weaponGroup(), () => {
        this.weaponGroup.set('');
        this.weaponSubGroup.set('');
      });
    }
    if (this.blueprintGroup()) add('blueprintGroup', 'codex.filters.blueprintGroup', this.blueprintGroup(), () => this.setBlueprintGroup(''));
    if (this.blueprintCategory()) add('blueprintCategory', 'blueprint.filters.category', this.blueprintCategory(), () => this.setBlueprintCategory(''));
    if (this.includeVariants()) add('variants', 'fusionBar.filter.variants', null, () => this.setIncludeVariants(false));
    return out;
  });

  /** The bar panel's checkbox columns (beta shell, concept r8 d2-s4): the same facets as the toolbar. */
  readonly barFacets = computed<readonly BarFacet[]>(() => {
    const out: BarFacet[] = [];
    const mfrs = this.manufacturerOptions();
    if (mfrs.length) {
      out.push({
        id: 'manufacturer', labelKey: 'codex.filters.manufacturer',
        options: mfrs.map((m) => ({ value: m.code, label: m.label })),
        selected: this.manufacturer() || null, set: (v) => this.setManufacturer(v ?? ''),
      });
    }
    if (this.sizeOptions().length > 1 || this.size()) {
      out.push({
        id: 'size', labelKey: 'codex.filters.size',
        options: this.sizeOptions().map((s) => ({ value: s, label: 'S' + s })),
        selected: this.size() || null, set: (v) => this.setSize(v ?? ''),
      });
    }
    if (this.gradeOptions().length > 1 || this.grade()) {
      out.push({
        id: 'grade', labelKey: 'codex.filters.grade',
        options: this.gradeOptions().map((g) => ({ value: g, label: g })),
        selected: this.grade() || null, set: (v) => this.setGrade(v ?? ''),
      });
    }
    if (this.kind() === 'component' && this.componentKindOptions().length) {
      out.push({
        id: 'componentKind', labelKey: 'codex.filters.componentKind',
        options: this.componentKindOptions().map((c) => ({ value: c, labelKey: 'codex.componentKind.' + c })),
        selected: this.componentKind() || null, set: (v) => this.setComponentKind(v ?? ''),
      });
    }
    if (this.kind() === 'blueprint') {
      out.push({
        id: 'blueprintGroup', labelKey: 'codex.filters.blueprintGroup',
        options: this.blueprintGroupOptions.filter((o) => o.value !== 'all').map((o) => ({ value: o.value, labelKey: o.labelKey })),
        selected: this.blueprintGroup() || null, set: (v) => this.setBlueprintGroup(v ?? ''),
      });
      if (this.blueprintCategoryOptions().length) {
        out.push({
          id: 'blueprintCategory', labelKey: 'blueprint.filters.category',
          options: this.blueprintCategoryOptions().map((c) => ({ value: c, label: this.categoryLabel(c) })),
          selected: this.blueprintCategory() || null, set: (v) => this.setBlueprintCategory(v ?? ''),
        });
      }
    }
    if (this.supportsVariants()) {
      out.push({
        id: 'variants', labelKey: 'fusionBar.filter.options',
        options: [{ value: 'on', labelKey: 'codex.filters.includeVariants' }],
        selected: this.includeVariants() ? 'on' : null, set: (v) => this.setIncludeVariants(v === 'on'),
      });
    }
    return out;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
    // Beta shell: kind switch, filter tokens, hit count and the panel footer live in the bar.
    inject(DestroyRef).onDestroy(
      inject(ShellChromeService).registerFilters(this, () => ({
        count: this.isUpcoming() || this.loading() ? null : this.total(),
        kindTotal: this.isUpcoming() ? null : this.kindCount(this.kind()),
        tokens: this.barTokens(),
        facets: this.isUpcoming() ? [] : this.barFacets(),
        reset: () => this.resetFilters(),
      })),
    );
    // The Fusion bar's typed term filters this list live (concept 2026-10-29, a-s2).
    inject(DestroyRef).onDestroy(
      this.chrome.registerPageSearch(this, (term) => {
        if (this.isUpcoming()) this.rsi.query.set(term.trim());
        else this.onSearchInput(term);
      }),
    );
    // Silhouettes for the rows on screen (u2), batched per page.
    effect(() => {
      const rows = this.rows();
      this.category();
      untracked(() => void this.loadSilhouettes(rows));
    });
    // A new LIVE build replaced the one on screen (tab came back): reload.
    reloadOnBuildRefresh(this.svc, () => this.runQuery(true));
    // Keep the data language in sync with UI language switches. (#50)
    this.t.onLangChange
      .pipe(takeUntilDestroyed())
      .subscribe((e) => this.dataLang.set(toLang(e.lang)));
    // Re-query whenever kind, search term or any facet changes.
    effect(() => {
      // track dependencies
      this.kind();
      this.category();
      this.armorSlot();
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
        slot: this.category() === ARMOR_CATEGORY ? this.armorSlot() || null : null,
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
    const others = CODEX_KINDS.filter((k) => k !== active && !(active === ARMOR_CATEGORY && k === 'item') && !this.isComingSoon(k));
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
    // The first q change after a committed search opens a new history entry,
    // so Back returns to the committed query; keystrokes replace it (L33).
    const push = this.pushNextQuery && (queryParams['q'] ?? null) !== this.committedQuery;
    if (push) this.pushNextQuery = false;
    mirrorQueryParams(this.router, this.route, this.location, queryParams, push);
  }

  /** The last search the user committed (Enter or ~1 s idle), null for none. */
  private committedQuery: string | null = null;
  private pushNextQuery = false;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Commit the typed search (Enter, or the idle timer): the term applies now,
   * and the NEXT different query gets its own history entry (audit L33).
   */
  commitSearch(): void {
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = null;
    const term = this.searchInput().trim();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTerm.set(term);
    const q = term || null;
    if (q === this.committedQuery) return;
    this.committedQuery = q;
    this.pushNextQuery = q !== null;
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
    void this.ownership.ensureLoaded();
    void this.loadArmorCounts();
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
      take('wsg', (v) => {
        // Legacy links carry the sub group alone (?wsg=utility): infer its super group.
        if (!this.weaponGroup()) {
          const sup = inferWeaponSuperGroup(v);
          if (!sup) return;
          this.weaponGroup.set(sup);
        }
        if (weaponSuperGroup(this.weaponGroup())?.subGroups.some((s) => s.id === v)) this.weaponSubGroup.set(v);
      });
    }
    if (this.category() === ARMOR_CATEGORY) take('slot', (v) => ARMOR_SLOT_IDS.includes(v) && this.armorSlot.set(v));
    if (this.kind() === 'blueprint') take('bpc', (v) => this.blueprintCategory.set(v));
    if (q.get('v') === '1') this.includeVariants.set(true);
    this.sortNew.set(this.kind() === 'ship' && q.get('sort') === 'new');
    if (this.sortNew()) this.loadNewShipOrder();
  }

  /** Armour records per slot for the tree. Advisory — a failure leaves the counts off. */
  private async loadArmorCounts(): Promise<void> {
    try {
      this.armorCounts.set(await this.svc.countItemsByAttachType(FPS_ARMOR_ATTACH_TYPES));
    } catch {
      this.armorCounts.set(new Map());
    }
  }

  private loadNewShipOrder(): void {
    void this.injector
      .get(CodexBuildDiffService)
      .addedShipsMemo()
      .then((added) => this.newShipOrder.set(new Map(added.map((r, i) => [r.classNameSlug, i]))))
      .catch(() => this.newShipOrder.set(new Map()));
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
    if (k === ARMOR_CATEGORY) {
      const counts = this.armorCounts();
      return counts.size ? [...counts.values()].reduce((a, b) => a + b, 0) : null;
    }
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
    const wasArmor = this.category() === ARMOR_CATEGORY;
    this.category.set(k);
    this.armorSlot.set('');
    if (k === UPCOMING_CATEGORY) return;
    const kind: CodexKind = k === ARMOR_CATEGORY ? 'item' : k;
    // Armour ↔ items share the table: the facets still belong to the other list.
    if (kind === this.kind() && (wasArmor || k === ARMOR_CATEGORY)) this.resetFilters();
    this.setKind(kind);
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
    // Trimmed once here (L28): the URL's q, the ranking and the cross-category
    // counts all read the term, and a stray space must not become "%20" or a miss.
    this.searchTimer = setTimeout(() => this.searchTerm.set(value.trim()), SEARCH_DEBOUNCE_MS);
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => this.commitSearch(), SEARCH_COMMIT_MS);
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
    this.armorSlot.set('');
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
      ...(this.category() === ARMOR_CATEGORY
        ? this.armorSlot() && armorAttachTypeOf(this.armorSlot())
          ? { attachType: armorAttachTypeOf(this.armorSlot())! }
          : { attachTypeIn: [...FPS_ARMOR_ATTACH_TYPES] }
        : {}),
      ...(this.kind() === 'weapon' ? weaponGroupQuery(this.weaponGroup(), this.weaponSubGroup()) : {}),
      category: category || undefined,
      blueprintCategoryIn,
      includeVariants: this.includeVariants(),
      limit: PAGE_SIZE,
      offset: this.offset,
    };
  }

  /** "Did you mean" names for a search that found nothing in the active kind (L06). */
  readonly suggestions = signal<string[]>([]);

  /** Run a suggested name as the search, in place (the anchor carries the same `?q=`). */
  searchFor(name: string): void {
    this.searchInput.set(name);
    this.commitSearch();
  }

  /** Fire-and-forget: the empty state is already on screen while this loads. */
  private async loadSuggestions(seq: number, kind: CodexKind, term: string): Promise<void> {
    const names = await this.svc.suggestNames(kind, term);
    if (seq !== this.loadSeq) return; // an older term's answer
    this.suggestions.set(names);
  }

  private async runQuery(reset: boolean): Promise<void> {
    if (reset) this.offset = 0;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    if (reset) this.suggestions.set([]);
    const activeKind = this.kind();
    try {
      const filters = this.buildFilters();
      const res = await this.svc.listByKind(activeKind, filters);
      if (seq !== this.loadSeq) return;
      this.rawRows.set(reset ? res.rows : [...this.rawRows(), ...res.rows]);
      this.serverTotal.set(res.count);
      if (reset && res.rows.length === 0 && filters.search) {
        void this.loadSuggestions(seq, activeKind, filters.search);
      }
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.error.set(toErrorKey('codex', 'list', err));
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
