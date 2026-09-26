import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import {
  CodexListRow,
  CodexService,
  fpsArmorSlot,
  manufacturerFacetOptions,
  manufacturerLabel,
  pickLocalizedDistinct,
  toLang,
} from './codex.service';
import { cleanLocaleValue, humanizeClassName } from './codex-format';
import { FoldedRow, foldVariantRows } from './codex-variant-fold';
import { SkinGroupedRow, SkinVariantRef, groupSkinRows } from './codex-skin-group';
import { CodexCompareTrayComponent } from './codex-compare-tray.component';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { CodexBoardFigureComponent } from './codex-board-figure.component';
import { CodexStatusBannerComponent } from './codex-status-banner.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NeuroFieldDirective } from '../core/neuro-field.directive';
import { HangarService } from '../hangar/hangar.service';
import {
  HangarRoleLoadout,
  ROLE_SLOT_SUGGESTIONS,
  SLOT_WEAPON_FACET,
  slotAccepts,
} from '../hangar/hangar.types';
import { ARMOR_SLOT_SPECS, armorSlotsFromLoadout, roleSlotForAttachType } from './codex-landing-kpi';
import { mirrorQueryParams } from './codex-url-state';
import { FPS_ARMOR_SLOT_ID, FPS_WEAPON_TYPE_ID, fpsArmorWeightKey, fpsWeaponTypeKey } from './fps-labels';
import { ScSelectComponent, ScSelectOption } from '../shared/sc-select.component';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { isPlainLeftClick } from '../core/modified-click.util';
import { SET_SLOT_TRANSITION_NAME, SetArsenalTransition } from './set/set-arsenal-transition';

/** Cards per "load more" step — the catalog itself is loaded whole. */
const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 250;

// The two categories this section curates. `weapon` = codex_weapons rows with
// weapon_class = 'FPS'; `armor` = codex_items rows with a `Char_Armor_*`
// attach_type. Both link to the EXISTING detail route ('weapon'/'item').
type FpsCategory = 'weapon' | 'armor';

// One list row + the concrete detail-route kind it should link to. Armor rows
// route to /codex/item/:className (personal armour lives on codex_items).
interface FpsRow extends CodexListRow {
  detailKind: 'weapon' | 'item';
}

/** A card in the grid: an FPS row after variant folding AND livery grouping. */
type FpsGridRow = SkinGroupedRow<FoldedRow<FpsRow>>;

/** One option of the primary facet: the raw catalog token as value, a translated label. */
interface FacetOption {
  value: string;
  labelKey: string | null;
  raw: string;
}

/**
 * FPS / on-foot equipment Codex section (issue #251) — a dedicated, curated
 * view over on-foot gear (FPS weapons + armor), analogous to the Blueprint
 * sub-section. Every card links to the EXISTING detail view
 * (codex/:kind/:className), which renders the stat block, shops and crafting.
 *
 * Since the audit of 2026-09-25 the page loads the WHOLE category once
 * (`CodexService.listFpsCatalog`, slim rows) and filters, folds and pages on
 * the client: folding per server page split livery families at the page edge
 * and made every count an estimate. The filters live in the URL, so Back from
 * a detail page returns to the same list.
 */
@Component({
  selector: 'sc-fps-list',
  standalone: true,
  imports: [NeuroFieldDirective, FormsModule, RouterLink, TranslatePipe, CodexCompareTrayComponent, CodexCategoryIconComponent, CodexBoardFigureComponent, CodexStatusBannerComponent, ScSelectComponent, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fps-page">
      <header class="head">
        <div class="title-block">
          <a class="back" routerLink="/codex">← {{ 'codex.detail.back' | translate }}</a>
          <h1>{{ 'fps.title' | translate }}</h1>
          <p class="hint">{{ 'fps.subtitle' | translate }}</p>
        </div>
        <sc-codex-status-banner />
      </header>

      <!-- EQUIP MODE. Only reachable with ?equipInto=&lt;setId&gt; in the URL, which
           is what makes "no equip controls during ordinary browsing" structural
           rather than a mode flag. Since the standalone role-loadout editor was
           retired (admin feedback 34505d70, decision 2A) this is where a piece
           gets put into a personal set — the archive IS the editor. -->
      @if (targetSet(); as set) {
        <!-- Dressed like the set page's stage (dark field, thin border) —
             the reader arrives here FROM one slot tile of that page, so the
             archive should look like it grew out of it rather than a plain
             card. The board figure is decorative and mirrors the set page's
             AN BORD figure; only ONE may ever be in this page's DOM (shared
             gradient ids in codex-board-figure.component.ts). -->
        <div class="sc-card equip-band" #band
             [style.view-transition-name]="isBandTransitionTarget() ? SET_SLOT_TRANSITION_NAME : null">
          @if (armorFittingRoleSlot(); as roleSlot) {
            <sc-codex-board-figure class="band-figure" [filled]="targetFilledSlots()" [highlight]="roleSlot" [decorative]="true" />
          }
          <div class="band-body">
            <span class="band-eyebrow">
              @if (armorSlotLabel(); as label) {
                {{ 'fps.equip.band.eyebrowSlot' | translate: { slot: label } }}
              } @else {
                {{ 'fps.equip.band.eyebrow' | translate }}
              }
            </span>
            <h2 class="band-title">
              @if (armorSlotLabel(); as label) {
                {{ 'fps.equip.band.titleSlot' | translate: { slot: label, name: set.name } }}
              } @else {
                {{ 'fps.equip.targetSet' | translate: { name: set.name } }}
              }
            </h2>
            <p class="band-sub">
              <span class="equip-role">{{ ('hangar.roles.' + set.role) | translate }}</span>
              @if (bandOnlyFittingLabel(); as label) {
                <span class="equip-only">{{ 'fps.equip.onlyFitting' | translate: { slot: label } }}</span>
              }
            </p>
            @if (svc.viewingPastPatch()) {
              <span class="equip-past-note" role="status">
                {{ 'fps.equip.pastPatch' | translate }}
                <button type="button" class="equip-past-back" (click)="backToLivePatch()">
                  {{ 'fps.equip.pastPatchBack' | translate }}
                </button>
              </span>
            }
          </div>
          <a class="equip-back" [routerLink]="['/codex', 'set', set.id]">
            {{ 'fps.equip.backToSet' | translate }}
          </a>
        </div>
      } @else if (equipTargetMissing()) {
        <!-- A stale or foreign ?equipInto= used to drop the equip mode without
             a word — the reader clicked "put on" and landed in a plain list. -->
        <div class="sc-card equip-missing" role="status">
          <p>{{ 'fps.equip.setUnavailable' | translate }}</p>
          <p class="equip-next">
            <a routerLink="/hangar">{{ 'fps.equip.mySets' | translate }}</a>
            <a [attr.href]="browseHref()" (click)="dropEquipIntent($event)">{{ 'fps.equip.browseWithout' | translate }}</a>
          </p>
        </div>
      }

      <!-- Category switcher. Real links since the category lives in the URL
           (?cat=): middle click and "open in new tab" work, a plain left
           click switches in place. -->
      <nav class="kind-bar" [attr.aria-label]="'fps.categoriesAria' | translate">
        @for (c of categories; track c) {
          <a class="kind" [attr.href]="categoryHref(c)"
             [class.active]="category() === c"
             [attr.aria-current]="category() === c ? 'page' : null"
             (click)="onCategoryClick($event, c)">
            <span>{{ ('fps.category.' + c) | translate }}</span>
            @if (categoryCount(c); as ct) {
              <span class="kind-ct">{{ ct }}</span>
            }
          </a>
        }
      </nav>

      <!-- Search + facets -->
      <div class="controls sc-card">
        <div class="search-row">
          <input class="search" type="search" [ngModel]="searchInput()"
                 (ngModelChange)="onSearchInput($event)"
                 [attr.aria-label]="'codex.search.label' | translate"
                 [attr.placeholder]="'fps.searchPlaceholder' | translate" />
          @if (searchInput()) {
            <button class="search-clear" type="button" (click)="clearSearch()"
                    [attr.aria-label]="'codex.search.clear' | translate"
                    [scTooltip]="'codex.search.clear' | translate">×</button>
          }
        </div>

        <div class="facets">
          @if (subTypeOptions().length > 0) {
            <!-- A div, not a label: a label forwards clicks on the listbox's
                 options to the trigger and would snap the list shut again. -->
            <div class="facet">
              <span>{{ (category() === 'weapon' ? 'fps.filters.weaponType' : 'fps.filters.armorSlot') | translate }}</span>
              <sc-select [options]="subTypeSelect()" [value]="subType() || null" placeholderKey="codex.filters.all"
                         [ariaLabel]="(category() === 'weapon' ? 'fps.filters.weaponType' : 'fps.filters.armorSlot') | translate"
                         (valueChange)="setSubType($event ?? '')" />
            </div>
          }
          @if (manufacturerOptions().length > 0) {
            <div class="facet mfr">
              <span>{{ 'codex.filters.manufacturer' | translate }}</span>
              <sc-select [options]="manufacturerSelect()" [value]="manufacturer() || null" placeholderKey="codex.filters.all"
                         [ariaLabel]="'codex.filters.manufacturer' | translate"
                         (valueChange)="setManufacturer($event ?? '')" />
            </div>
          }
          @if (sizeOptions().length > 1) {
            <div class="facet">
              <span>{{ 'codex.filters.size' | translate }}</span>
              <sc-select [options]="sizeSelect()" [value]="size() || null" placeholderKey="codex.filters.anySize"
                         [ariaLabel]="'codex.filters.size' | translate"
                         (valueChange)="setSize($event ?? '')" />
            </div>
          }
          @if (gradeOptions().length > 1) {
            <div class="facet">
              <span>{{ 'codex.filters.grade' | translate }}</span>
              <sc-select [options]="gradeSelect()" [value]="grade() || null" placeholderKey="codex.filters.anyGrade"
                         [ariaLabel]="'codex.filters.grade' | translate"
                         (valueChange)="setGrade($event ?? '')" />
            </div>
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
            <span class="showing">{{ 'codex.results.showingOf' | translate: { shown: visibleRows().length, total: total() } }}</span>
          }
        </div>

        @if (category() === 'armor') {
          <p class="partial-note">{{ 'fps.armorStatsHint' | translate }}</p>
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
              <p>{{ ('fps.empty.' + category()) | translate }}</p>
            }
          </div>
        } @else {
          <div class="grid">
            @for (r of visibleRows(); track r.classNameSlug) {
              <!-- The card is the navigation; the pin and the equip buttons are
                   actions, so they sit NEXT TO the link inside the wrapper, never
                   inside it (no interactive content nested in an <a>). -->
              <div class="card-wrap">
                <a class="card" [routerLink]="['/codex', r.detailKind, r.classNameSlug]">
                  <div class="thumb" [class.icon-only]="!thumb(r)">
                    @if (thumb(r); as src) {
                      <img [src]="src" [alt]="cardName(r)" loading="lazy" (error)="onThumbError(r)" />
                    } @else {
                      <sc-codex-icon [kind]="r.detailKind" [sub]="iconSub(r)" [attachType]="r.attachType" />
                    }
                  </div>
                  <h3 class="name">{{ cardName(r) }}</h3>
                  <code class="cls">{{ r.classNameSlug }}</code>
                  <div class="badges">
                    @if (cardMfr(r); as mfr) { <span class="badge mfr" [scTooltip]="mfr" scTooltipTier="label">{{ mfr }}</span> }
                    <span class="badge cat">{{ ('fps.category.' + category()) | translate }}</span>
                    @if (armorSlotKey(r); as slotKey) { <span class="badge slot">{{ slotKey | translate }}</span> }
                    @if (typeKey(r); as typeKey) { <span class="badge subtle">{{ typeKey | translate }}</span> }
                    @if (r.grade) { <span class="badge grade" [attr.data-grade]="r.grade">{{ 'codex.card.grade' | translate: { grade: r.grade } }}</span> }
                    @if (r.isVariant) { <span class="badge variant">{{ 'codex.card.variant' | translate }}</span> }
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
                  </div>
                  @if (showSizeBar() && r.size != null) {
                    <div class="size-bar" [scTooltip]="'codex.card.size' | translate: { size: r.size }">
                      <span class="size-track"><span class="size-fill" [style.width.%]="sizePct(r.size)"></span></span>
                      <span class="size-tag">S{{ r.size }}</span>
                    </div>
                  }
                </a>
                <button type="button" class="pin"
                        [class.pinned]="isPinned(r)"
                        [attr.aria-pressed]="isPinned(r)"
                        (click)="togglePin(r)"
                        [attr.aria-label]="(isPinned(r) ? 'codex.compare.pinned' : 'codex.compare.pin') | translate"
                        [scTooltip]="(isPinned(r) ? 'codex.compare.pinned' : 'codex.compare.pin') | translate"
                        scTooltipTier="label">
                  {{ isPinned(r) ? '★' : '☆' }}
                </button>
                @if (equipSlots(r); as slots) {
                  @if (slots.length > 0) {
                    <!-- Armour offers its one anatomical home; a weapon or tool
                         the set's positions it honestly fills. -->
                    <div class="equip-row">
                      <span class="equip-label">{{ 'fps.equip.into' | translate }}</span>
                      @for (slot of slots; track slot) {
                        <span class="tip-wrap" [scTooltip]="svc.viewingPastPatch() ? ('fps.equip.pastPatch' | translate) : null" scTooltipTier="label">
                          <button type="button" class="equip-btn"
                                  [class.on]="isEquipped(r, slot)"
                                  [attr.aria-pressed]="isEquipped(r, slot)"
                                  [attr.aria-busy]="equipBusy() === r.classNameSlug + '|' + slot"
                                  [disabled]="equipBusy() !== null || svc.viewingPastPatch()"
                                  (click)="equip($event, r, slot)">
                            {{ equipBusy() === r.classNameSlug + '|' + slot ? ('fps.equip.saving' | translate) : slotLabel(slot) }}
                          </button>
                        </span>
                      }
                      <!-- At the card that was clicked, not in the bar at the top of a
                           list the reader has scrolled away from. -->
                      @if (equipFailedOn(r)) {
                        <p class="equip-err" role="alert">{{ 'fps.equip.failed' | translate }}</p>
                      } @else if (equipConflictOn(r)) {
                        <p class="equip-note" role="status">{{ 'fps.equip.changedElsewhere' | translate }}</p>
                      }
                    </div>
                  }
                }
              </div>
            }
          </div>

          @if (hasMore()) {
            <div class="more-row">
              <button type="button" class="load-more" (click)="loadMore()">
                {{ 'codex.results.loadMore' | translate }}
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
    .back { font-size: 0.82rem; color: var(--sc-fg-2); text-decoration: none; width: fit-content; }
    .back:hover, .back:focus-visible { color: var(--sc-accent); }
    .title-block { display: flex; flex-direction: column; gap: 4px; }
    .title-block h1 { margin: 4px 0 0; }
    /* The column gap alone sets title-to-subtitle distance (feedback 98f50dfc):
       a margin here stacked on top of it and made this head 4px taller than
       every other list view's. */
    .title-block .hint { color: var(--sc-fg-2); margin: 0; max-width: var(--sc-measure); }

    /* Equip mode — the archive working FOR one personal set. Dressed like the
       set page's stage (dark field, thin border, radius) since the reader
       arrives here from one of its slot tiles — the view transition grows
       that tile into this band, so it has to already look like it belongs to
       the same page. */
    .equip-band {
      --tint: var(--sc-warning);
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
      background: var(--field, #071520);
      border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
      padding: 14px 16px;
    }
    .band-figure { flex: 0 0 auto; width: 64px; }
    .band-body { display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-width: 200px; }
    .band-eyebrow {
      font-family: var(--sc-font-display); text-transform: uppercase;
      letter-spacing: 0.1em; font-size: max(0.66rem, var(--sc-fs-floor));
      color: var(--sc-warning);
    }
    .band-title { margin: 0; font-size: 1.15rem; line-height: 1.2; }
    .band-sub { display: flex; align-items: center; gap: 8px; margin: 0; flex-wrap: wrap; }
    .equip-role {
      font-family: var(--sc-font-display); text-transform: uppercase;
      letter-spacing: 0.08em; font-size: max(0.64rem, var(--sc-fs-floor));
      padding: 2px 8px; border-radius: 999px;
      background: color-mix(in srgb, var(--sc-accent) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent);
    }
    .equip-back { color: var(--sc-accent); text-decoration: none; font-size: 0.82rem; }
    .equip-back:hover, .equip-back:focus-visible { text-decoration: underline; }
    .equip-err { flex: 1 1 100%; margin: 0; color: var(--sc-danger); font-size: max(0.8rem, var(--sc-fs-floor)); }
    .equip-missing { margin: 0; padding: var(--sc-pad-2) var(--sc-gap-1); color: var(--sc-fg-1); font-size: max(0.84rem, var(--sc-fs-floor)); }
    .equip-missing p { margin: 0; }
    .equip-missing .equip-next { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 8px; }
    .equip-next a { color: var(--sc-accent); display: inline-flex; align-items: center; min-height: var(--sc-tap-min); }
    .equip-next a:hover, .equip-next a:focus-visible { text-decoration: underline; }
    .equip-only { color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); }
    .equip-note { flex: 1 1 100%; margin: 0; color: var(--sc-fg-1); font-size: max(0.8rem, var(--sc-fs-floor)); }
    /* Past-patch guard: the warning colour, never the danger red — nothing
       broke, equipping is simply parked until the reader is back on live. */
    .equip-past-note {
      display: inline-flex; align-items: center; gap: 8px;
      color: color-mix(in srgb, var(--sc-warning) 80%, var(--sc-fg-1));
      font-size: max(0.8rem, var(--sc-fs-floor));
    }
    .equip-past-back {
      padding: 4px 10px; border-radius: 999px; cursor: pointer;
      border: 1px solid color-mix(in srgb, var(--sc-warning) 40%, transparent);
      background: color-mix(in srgb, var(--sc-warning) 12%, transparent);
      color: var(--sc-warning); font-family: inherit;
      font-size: max(0.76rem, var(--sc-fs-floor));
      min-height: max(28px, var(--sc-tap-min));
    }
    .equip-past-back:hover, .equip-past-back:focus-visible { background: color-mix(in srgb, var(--sc-warning) 20%, transparent); }
    .equip-past-back:focus-visible { outline: 2px solid var(--sc-warning); outline-offset: 2px; }
    /* Carries the "why is this locked" tooltip of a disabled button (a disabled
       button gets no pointer events) without becoming a flex item itself. */
    .tip-wrap { display: contents; }

    .equip-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 0 14px 14px; }
    .equip-label {
      font-family: var(--sc-font-display); text-transform: uppercase;
      letter-spacing: 0.1em; font-size: max(0.6rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
    }
    .equip-btn {
      padding: 6px 10px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1);
      color: var(--sc-fg-1); font-family: var(--sc-font-display);
      font-size: max(0.62rem, var(--sc-fs-floor));
      letter-spacing: 0.06em; text-transform: uppercase;
      min-height: max(32px, var(--sc-tap-min));
    }
    .equip-btn:hover:not(:disabled) { border-color: var(--sc-accent); color: var(--sc-accent); }
    .equip-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .equip-btn:disabled { opacity: 0.5; cursor: default; }
    .equip-btn.on {
      border-color: var(--sc-accent); color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 16%, transparent);
    }

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
       and the actions ride on top / below as its siblings. */
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
      border-radius: 6px; background: radial-gradient(circle at 50% 45%, var(--sc-bg-2), var(--sc-bg-0)); }
    .card .thumb img { max-height: 88px; max-width: 100%; object-fit: contain; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5)); }
    .card .thumb sc-codex-icon { width: 100%; height: 100%; }
    .card .name { margin: 0; font-size: 1rem; font-weight: 600; line-height: 1.25; }
    .card .cls { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); word-break: break-all; }
    .pin {
      position: absolute; top: 12px; right: 12px;
      width: max(32px, var(--sc-tap-min)); height: max(32px, var(--sc-tap-min));
      border-radius: 8px; border: 1px solid transparent; padding: 0;
      background: color-mix(in srgb, var(--sc-bg-0) 66%, transparent);
      color: var(--sc-fg-2); font-size: 1.1rem; line-height: 1; cursor: pointer;
    }
    .pin:hover { color: var(--sc-accent); border-color: var(--sc-border); }
    .pin.pinned { color: var(--sc-accent); }
    .pin:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
    .badge { font-size: max(0.66rem, var(--sc-fs-floor)); padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    /* Holds a spelled-out manufacturer ("Klaus & Werner"), so the pill has to
       stay inside the card on a phone. Neutral, never the admin red. */
    .badge.mfr { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-1);
      max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge.cat { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-1); }
    .badge.subtle { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }
    .badge.slot { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); border-color: color-mix(in srgb, var(--sc-accent) 32%, transparent); color: var(--sc-fg-1); }
    .badge.variant { background: color-mix(in srgb, var(--sc-warning) 16%, transparent); border-color: color-mix(in srgb, var(--sc-warning) 40%, transparent); color: var(--sc-fg-1); }
    /* "+n file variants folded" — a quiet note, not a warning: nothing is wrong,
       the catalog simply carries several records for one object. */
    .badge.folded { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); cursor: help; }
    /* Liveries are a feature of the entry, not file noise like .folded — so the
       accent, and the detail view picks them up in the skin picker. */
    .badge.skins {
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

    .more-row { display: flex; justify-content: center; }
    .load-more { padding: 10px 24px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-accent); color: var(--sc-accent); font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
    .load-more:hover { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }

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
      .card-wrap, .kind { transition: none; }
      .card-wrap:hover { transform: none; }
    }
  `],
})
export class FpsListComponent {
  readonly svc = inject(CodexService);
  private readonly t = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly hangar = inject(HangarService);
  private readonly location = inject(Location);
  private readonly transition = inject(SetArsenalTransition);
  /** Exposed for the template — a bound constant reads better than a re-import there. */
  readonly SET_SLOT_TRANSITION_NAME = SET_SLOT_TRANSITION_NAME;
  private readonly bandRef = viewChild<ElementRef<HTMLElement>>('band');

  private readonly dataLang = signal(toLang(this.t.getCurrentLang()));

  readonly categories: readonly FpsCategory[] = ['weapon', 'armor'];
  readonly skeletons = Array.from({ length: 8 }, (_, i) => i);

  readonly category = signal<FpsCategory>('weapon');
  /** Target set id from `?equipInto=` — the equip intent, see applyDeepLink(). */
  readonly equipInto = signal<string | null>(null);
  /** `?equipSlot=` — the one slot the set page sent the reader to fill, if any. */
  readonly equipSlot = signal<string | null>(null);
  /** The set that intent points at, once loaded. Null = ordinary browsing. */
  readonly targetSet = signal<HangarRoleLoadout | null>(null);
  /** `<className>|<slot>` while a write is in flight — disables the whole row. */
  readonly equipBusy = signal<string | null>(null);
  /** `<className>|<slot>` of the last refused equip write (RLS, network, set deleted meanwhile). */
  readonly equipFailed = signal<string | null>(null);
  /** `?equipInto=` named a set this reader cannot load — say so instead of silently browsing. */
  readonly equipTargetMissing = signal(false);
  /** `<className>|<slot>` of a clear that met another tab's newer piece in the slot. */
  readonly equipConflict = signal<string | null>(null);
  /**
   * The weapon/tool slot the set page sent the reader to fill: while its set
   * is loaded, the weapon list shows only what fits it. A link from the
   * primary slot used to list knives and pistols too — without an equip button.
   */
  readonly fittingSlot = computed(() => (this.targetSet() && this.category() === 'weapon' ? this.equipSlot() : null));
  /**
   * The one anatomical position the equip band is dressed for — the same
   * role-slot key the AN BORD figure and `equip()` use (helmet/core/arms/
   * legs/undersuit/backpack). Set from the armour slot facet (`?slot=`), the
   * one the set page's slot tile links here with; empty when armour is
   * browsed without a slot filter, or in weapon mode.
   */
  readonly armorFittingRoleSlot = computed<string | null>(() => {
    if (!this.targetSet() || this.category() !== 'armor') return null;
    const raw = this.subType();
    return raw ? roleSlotForAttachType('Char_Armor_' + raw) : null;
  });
  /** The armour slots the target set already carries — the band figure's `[filled]`. */
  readonly targetFilledSlots = computed<ReadonlySet<string>>(() => {
    const set = this.targetSet();
    if (!set) return new Set<string>();
    return new Set(armorSlotsFromLoadout(set.items).filter((s) => s.className).map((s) => s.roleSlot));
  });
  /** The armour slot facet's translated label ("Beine"), or null outside a slot filter. */
  armorSlotLabel(): string | null {
    const id = FPS_ARMOR_SLOT_ID[this.subType()];
    return this.armorFittingRoleSlot() && id ? this.t.instant(`codex.landing.paperdoll.${id}`) : null;
  }
  /** The band's "only what fits" line: the weapon slot label, or the armour slot's. */
  bandOnlyFittingLabel(): string | null {
    const weaponSlot = this.fittingSlot();
    return weaponSlot ? this.slotLabel(weaponSlot) : this.armorSlotLabel();
  }
  /** Whether the band is the destination of a running set → arsenal hop. */
  isBandTransitionTarget(): boolean {
    return this.transition.isLandingOn(this.armorFittingRoleSlot(), 'toArsenal');
  }
  readonly searchInput = signal('');
  private readonly searchTerm = signal('');
  readonly manufacturer = signal('');
  readonly size = signal('');
  readonly grade = signal('');
  readonly subType = signal('');
  readonly includeVariants = signal(false);

  /** The whole category as loaded — every filter below runs on this. */
  private readonly catalog = signal<FpsRow[]>([]);
  /** How many cards are on screen; "load more" raises it, any filter change resets it. */
  private readonly shown = signal(PAGE_SIZE);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private loadSeq = 0;

  /** Folded card counts per category, remembered once a category has been loaded. */
  private readonly counts = signal<Partial<Record<FpsCategory, number>>>({});

  /** The catalog narrowed by search and facets — before any folding. */
  private readonly filtered = computed<FpsRow[]>(() => {
    const matches = searchMatcher(this.searchTerm());
    const mfr = this.manufacturer();
    const size = this.size();
    const grade = this.grade();
    const sub = this.subType();
    const armor = this.category() === 'armor';
    const fitting = this.fittingSlot();
    return this.catalog().filter(
      (r) =>
        (!fitting || slotAccepts(fitting, { className: r.classNameSlug, subType: r.subType })) &&
        (!matches ||
          matches(this.cardName(r)) ||
          matches(r.nameLocalized ?? '') ||
          matches(r.classNameSlug)) &&
        (!mfr || r.manufacturerCode === mfr) &&
        (!size || String(r.size) === size) &&
        (!grade || r.grade === grade) &&
        (!sub || (armor ? fpsArmorSlot(r.attachType) === sub : r.subType === sub)),
    );
  });

  /**
   * What the grid renders, after two display-level passes over the WHOLE
   * filtered category:
   *
   *  1. near-identical variant records collapsed into one card each (admin
   *     feedback 8cd0aed7 — the APX Fire Extinguisher shipped twice, once as
   *     `kegr_fire_extinguisher_01_Igniter`), then
   *  2. livery families collapsed into their base record (feedback d5e39f86 —
   *     `LH86 Pistol` swallows its thirteen `LH86 "…" Pistol` paint jobs, which
   *     the detail view offers in a skin picker).
   *
   * The order is load-bearing: pass 2 refuses to guess when several records
   * carry the base name, and the multi-tool's nine `_default_*` records all do
   * until pass 1 has folded them. Ticking "include variants" — the control that
   * already means "show me the raw records" — turns BOTH off.
   */
  readonly rows = computed<FpsGridRow[]>(() => this.fold(this.filtered(), this.includeVariants()));
  readonly visibleRows = computed(() => this.rows().slice(0, this.shown()));
  /** Exact: the whole category is folded, so this is the number of cards there are. */
  readonly total = computed(() => this.rows().length);
  readonly hasMore = computed(() => this.rows().length > this.shown());

  /**
   * Facet options come from the whole category, not from what the current
   * filters left over — picking "Klaus & Werner" must not make every other
   * manufacturer disappear from its own dropdown.
   */
  readonly manufacturerOptions = computed(() =>
    manufacturerFacetOptions(this.catalog(), this.dataLang()),
  );
  readonly sizeOptions = computed(() =>
    uniqSorted(this.catalog().map((r) => (r.size != null ? String(r.size) : null))).sort(
      (a, b) => Number(a) - Number(b),
    ),
  );
  readonly gradeOptions = computed(() => uniqSorted(this.catalog().map((r) => r.grade)));
  /**
   * An armour size or grade that every piece shares (all S1, all grade A) is
   * no information; the facet and the size bar only appear when they differ.
   */
  readonly showSizeBar = computed(() => this.sizeOptions().length > 1);
  // Primary facet: for weapons the weapon sub_type (Small/Medium/…); for armor
  // the equip SLOT derived from attach_type (Helmet/Torso/…), NOT sub_type
  // (which for armor is the weight class Light/Medium/Heavy). Values stay the
  // raw tokens (they are what the filter compares), labels are translated.
  readonly subTypeOptions = computed<FacetOption[]>(() => {
    const armor = this.category() === 'armor';
    const values = armor
      ? uniqSorted(this.catalog().map((r) => fpsArmorSlot(r.attachType)))
      : uniqSorted(this.catalog().map((r) => r.subType));
    // Head to toe / sidearm to gadget — the order the labels mean, not the
    // alphabet of the English tokens behind them.
    const order = Object.keys(armor ? FPS_ARMOR_SLOT_ID : FPS_WEAPON_TYPE_ID);
    const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length);
    values.sort((a, b) => rank(a) - rank(b));
    return values.map((v) => {
      const id = armor ? FPS_ARMOR_SLOT_ID[v] : FPS_WEAPON_TYPE_ID[v];
      // A weapon token outside the known six (one record says just "Weapon")
      // reads as the index's "Sonstige", not as a raw English word.
      const labelKey = armor
        ? id ? `codex.landing.paperdoll.${id}` : null
        : `codex.weaponGroup.fps.${id ?? 'other'}`;
      return { value: v, labelKey, raw: v };
    });
  });

  /**
   * The facets in the themed select's shape (shared/sc-select — a native
   * select opens as an unthemed OS menu, admin feedback fd58a5eb). Raw values
   * ride in `label`, translatable ones in `labelKey`.
   */
  readonly subTypeSelect = computed<ScSelectOption[]>(() =>
    this.subTypeOptions().map((o) => (o.labelKey ? { value: o.value, labelKey: o.labelKey } : { value: o.value, labelKey: '', label: o.raw })),
  );
  readonly manufacturerSelect = computed<ScSelectOption[]>(() =>
    this.manufacturerOptions().map((m) => ({ value: m.code, labelKey: '', label: m.label })),
  );
  readonly sizeSelect = computed<ScSelectOption[]>(() =>
    this.sizeOptions().map((s) => ({ value: s, labelKey: '', label: 'S' + s })),
  );
  readonly gradeSelect = computed<ScSelectOption[]>(() =>
    this.gradeOptions().map((g) => ({ value: g, labelKey: '', label: g })),
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

    // Read the URL before the effects below take their first look at it.
    this.applyDeepLink();

    // Load the category — only category and the variant switch need the server.
    effect(() => {
      const category = this.category();
      const includeVariants = this.includeVariants();
      untracked(() => void this.loadCatalog(category, includeVariants));
    });

    // Any narrowing starts again at the first page of cards.
    effect(() => {
      this.filtered();
      untracked(() => this.shown.set(PAGE_SIZE));
    });

    // Mirror the list state into the URL (replaceUrl), so Back from a detail
    // page, a reload or a shared link lands on the same list.
    effect(() => {
      const queryParams = {
        cat: this.category(),
        slot: this.subType() || null,
        q: this.searchTerm() || null,
        mfr: this.manufacturer() || null,
        size: this.size() || null,
        grade: this.grade() || null,
        v: this.includeVariants() ? '1' : null,
      };
      untracked(() => this.writeUrl(queryParams));
    });

    void this.svc.loadCurrentBuild();
    void this.loadTargetSet();
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
  }

  private writeUrl(queryParams: Record<string, string | null>): void {
    mirrorQueryParams(this.router, this.route, this.location, queryParams);
  }

  /**
   * A list URL as a plain href. Links here are plain hrefs, not routerLink:
   * RouterLink would ALSO navigate on the plain click that is kept in place
   * (page view, scroll to top, history entry).
   */
  private hrefFor(queryParams: Record<string, string | null>): string | null {
    try {
      const tree = this.router.createUrlTree([], { relativeTo: this.route, queryParams });
      return this.location.prepareExternalUrl(this.router.serializeUrl(tree));
    } catch {
      return null; // a view outside the router (tests): the in-place click still works
    }
  }

  /** Each category link: that category's list with the current search and equip intent. */
  private readonly categoryHrefs = computed(() => {
    const q = this.searchTerm() || null;
    const equipInto = this.equipInto();
    const equipSlot = this.equipSlot();
    return new Map(this.categories.map((c) => [c, this.hrefFor({ cat: c, q, equipInto, equipSlot })] as const));
  });

  categoryHref(c: FpsCategory): string | null {
    return this.categoryHrefs().get(c) ?? null;
  }

  /** The archive without the equip intent — the missing-set notice's way on. */
  readonly browseHref = computed(() => this.hrefFor({ cat: this.category(), q: this.searchTerm() || null }));

  /** A plain left click switches in place; a modified one is the browser's (new tab, window …). */
  onCategoryClick(ev: MouseEvent, c: FpsCategory): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.setCategory(c);
  }

  /** Equip mode's past-patch note: the same switch-back the patch dropdown uses. */
  backToLivePatch(): void {
    this.svc.selectBuild(null);
  }

  /** "Keep browsing without a set": drop the stale equip intent in place, URL included. */
  dropEquipIntent(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.equipInto.set(null);
    this.equipSlot.set(null);
    this.equipTargetMissing.set(false);
    this.writeUrl({ equipInto: null, equipSlot: null });
  }

  /** Both display passes of `rows` — or neither, when the raw records are asked for. */
  private fold(rows: FpsRow[], raw: boolean): FpsGridRow[] {
    return raw
      ? rows.map((r) => ({
          ...r,
          foldedClassNames: [] as readonly string[],
          skinVariants: [] as readonly SkinVariantRef[],
        }))
      : groupSkinRows(foldVariantRows(rows, (r) => this.cardName(r)));
  }

  /**
   * Drop a facet the loaded category does not carry. A typed or stale link
   * (`?slot=Foo`, `?size=abc`, a manufacturer an older build had) would filter
   * the list down to zero cards with no hint why; a weapon type outside the
   * known six (one record says just "Weapon") is still restored, because the
   * catalog offers it.
   */
  private dropUnknownFacets(): void {
    const carried = (value: string, options: readonly string[]) => !value || options.includes(value);
    if (!carried(this.subType(), this.subTypeOptions().map((o) => o.value))) this.subType.set('');
    if (!carried(this.manufacturer(), this.manufacturerOptions().map((o) => o.code))) this.manufacturer.set('');
    if (!carried(this.size(), this.sizeOptions())) this.size.set('');
    if (!carried(this.grade(), this.gradeOptions())) this.grade.set('');
  }

  /**
   * Resolve `?equipInto=` into the actual set. Best-effort on purpose: a stale
   * id (deleted set, old bookmark) leaves `targetSet` null and says so in the
   * `equipTargetMissing` notice — the page is the ordinary archive again, never
   * a broken editor.
   */
  private async loadTargetSet(): Promise<void> {
    const id = this.equipInto();
    if (!id) {
      this.targetSet.set(null);
      return;
    }
    let set: HangarRoleLoadout | null = null;
    try {
      set = await this.hangar.getRoleLoadout(id);
    } catch {
      set = null;
    }
    this.targetSet.set(set);
    this.equipTargetMissing.set(set === null);
  }

  /**
   * Deep links: `?cat=armor&slot=Helmet` opens this page already narrowed to one
   * anatomical position (the set page's slots link here that way); `q`, `mfr`,
   * `size`, `grade` and `v` restore the rest of a list the reader left.
   *
   * `equipInto` (the target set id) carries the EQUIP INTENT. Keeping it in the
   * URL is what makes "no equip controls during ordinary browsing" structural:
   * an equip control cannot render without it.
   */
  private applyDeepLink(): void {
    const q = this.route.snapshot.queryParamMap;
    const cat = q.get('cat');
    if (cat === 'armor' || cat === 'weapon') this.category.set(cat);
    // Taken as given here; once the category has loaded, dropUnknownFacets()
    // clears one it does not carry — a stale or typed link (?slot=Foo) used to
    // filter the list down to zero rows.
    const slot = q.get('slot');
    if (slot) this.subType.set(slot);
    const term = q.get('q');
    if (term) {
      this.searchInput.set(term);
      this.searchTerm.set(term);
    }
    this.manufacturer.set(q.get('mfr') ?? '');
    this.size.set(q.get('size') ?? '');
    this.grade.set(q.get('grade') ?? '');
    this.includeVariants.set(q.get('v') === '1');
    this.equipInto.set(q.get('equipInto'));
    // The set page links one gear slot at a time: narrow the list to the
    // weapon type that slot takes, unless the link already named a facet.
    const equipSlot = q.get('equipSlot');
    this.equipSlot.set(equipSlot);
    if (equipSlot && this.category() === 'weapon' && !slot && Object.hasOwn(SLOT_WEAPON_FACET, equipSlot)) {
      this.subType.set(SLOT_WEAPON_FACET[equipSlot]);
    }
  }

  /**
   * Which slots of the target set this row may go into.
   *
   * Armour has exactly one home, derived from its `attach_type` — the same
   * mapping the AN BORD paperdoll uses, so a helmet lands where the figure
   * shows a helmet. Weapons and tools go into the set's own non-anatomical
   * positions (fps → primary/secondary/sidearm, mining → multitool/…), but
   * only the ones they honestly fill (`slotAccepts`): a pistol is no mining
   * attachment. A link from the set page for ONE slot (`?equipSlot=`) offers
   * only that slot.
   *
   * Note the armour case is deliberately NOT filtered by role: the AN BORD zone
   * links all six anatomical positions for every set, so refusing `legs` on a
   * mining set here would produce a link that leads nowhere.
   */
  equipSlots(r: FpsRow): string[] {
    const set = this.targetSet();
    if (!set) return [];
    if (this.category() === 'armor') {
      const slot = roleSlotForAttachType(r.attachType);
      return slot ? [slot] : [];
    }
    const anatomical = new Set(ARMOR_SLOT_SPECS.map((s) => s.roleSlot));
    const only = this.equipSlot();
    return (ROLE_SLOT_SUGGESTIONS[set.role] ?? []).filter(
      (s) =>
        !anatomical.has(s) &&
        (!only || s === only) &&
        slotAccepts(s, { className: r.classNameSlug, subType: r.subType }),
    );
  }

  /** True when this card's last equip write was refused. */
  equipFailedOn(r: FpsRow): boolean {
    return this.equipFailed()?.startsWith(r.classNameSlug + '|') ?? false;
  }

  /** True when this card's last clear found a newer piece from another tab. */
  equipConflictOn(r: FpsRow): boolean {
    return this.equipConflict()?.startsWith(r.classNameSlug + '|') ?? false;
  }

  /** i18n label for a slot token; `hangar.slots.*` covers every suggested one. */
  slotLabel(slot: string): string {
    const key = 'hangar.slots.' + slot;
    const label = this.t.instant(key);
    return label === key ? slot : label;
  }

  /**
   * True when `slot` holds this card's piece — including a livery or file
   * variant folded into the card, so a set that carries `C54 "Scorched"` shows
   * (and can clear) it on the one C54 card the grid renders.
   */
  isEquipped(r: FpsRow, slot: string): boolean {
    const item = this.targetSet()?.items.find((i) => i.slot === slot);
    if (!item?.className) return false;
    const card = r as Partial<FpsGridRow> & FpsRow;
    return (
      item.className === r.classNameSlug ||
      (card.foldedClassNames ?? []).includes(item.className) ||
      (card.skinVariants ?? []).some((s) => s.classNameSlug === item.className)
    );
  }

  /**
   * Put this row into `slot` of the target set; clicking the same slot again
   * clears it. The merge runs against the server's copy of the set
   * (`setRoleLoadoutSlot`), so another tab's equip in between is kept rather
   * than overwritten, and slots this page knows nothing about survive.
   */
  async equip(ev: Event, r: FpsRow, slot: string): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    // A stale click (button disabled a moment too late, or a synthetic event
    // in a test) must not slip a write through while a past patch is shown.
    if (this.svc.viewingPastPatch()) return;
    const set = this.targetSet();
    if (!set || this.equipBusy()) return;
    const clearing = this.isEquipped(r, slot);
    // A clear names the piece this page showed in the slot, so a newer one that
    // another tab put there survives (the service hands back the fresh set).
    const shown = clearing ? (set.items.find((i) => i.slot === slot)?.className ?? undefined) : undefined;
    const key = `${r.classNameSlug}|${slot}`;
    this.equipBusy.set(key);
    this.equipFailed.set(null);
    this.equipConflict.set(null);
    try {
      // The service reports a refused write as null (and never throws for it);
      // a thrown error is the transport failing. Both used to look exactly
      // like a click that did nothing.
      const updated = await this.hangar
        .setRoleLoadoutSlot(set.id, slot, clearing ? null : { className: r.classNameSlug, kind: r.detailKind }, shown)
        .catch(() => null);
      if (updated) {
        this.targetSet.set(updated);
        // A clear that met another tab's newer piece leaves it there — say so.
        if (clearing && updated.items.some((i) => i.slot === slot && i.className)) {
          this.equipConflict.set(key);
        } else if (!clearing && this.category() === 'armor') {
          // Armour has exactly one home: once it's on, the reader is done here
          // and the hop back into the set page (reversing the slot tile's grow
          // animation) is the natural next step. A weapon slot stays on the
          // list — a role loadout usually needs several of those in one visit.
          this.returnToSet(slot, set.id);
        }
      } else {
        this.equipFailed.set(key);
      }
    } finally {
      this.equipBusy.set(null);
    }
  }

  /** The arsenal → set hop: the band shrinks back into the slot tile it grew from. */
  private returnToSet(slot: string, setId: string): void {
    void this.transition.hop(
      this.router.createUrlTree(['/codex', 'set', setId]),
      { slot, direction: 'toSet' },
      this.bandRef()?.nativeElement ?? null,
    );
  }

  categoryCount(c: FpsCategory): number | null {
    // The active tab quotes the same folded number the result header shows —
    // two different counts for one list read as a bug.
    if (c === this.category() && this.catalog().length > 0) return this.total();
    return this.counts()[c] ?? null;
  }

  /** Class names of the records folded into this card, for the badge tooltip. */
  foldedNames(r: FoldedRow<FpsRow>): string {
    return [r.classNameSlug, ...r.foldedClassNames].join(', ');
  }

  /** Livery names grouped into this card, for the badge tooltip. */
  skinNames(r: FpsGridRow): string {
    return r.skinVariants.map((s) => s.liveryName).join(', ');
  }

  /**
   * Manufacturer badge text — the full name from the extracted payload
   * ("Klaus & Werner"), falling back to the promoted code when the game data has
   * no resolvable name. See `manufacturerLabel`.
   */
  cardMfr(r: FpsRow): string | null {
    return manufacturerLabel(r, this.dataLang());
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

  /** i18n key of the armour slot badge (Helm/Torso/…); null for weapons. */
  armorSlotKey(r: FpsRow): string | null {
    if (this.category() !== 'armor') return null;
    const id = FPS_ARMOR_SLOT_ID[fpsArmorSlot(r.attachType) ?? ''];
    return id ? `codex.landing.paperdoll.${id}` : null;
  }

  /**
   * i18n key of the type badge: the weapon type for weapons, the weight class
   * for armour. Tokens that only repeat the slot or are the game's
   * "UNDEFINED" get no badge instead of a raw English word.
   */
  typeKey(r: FpsRow): string | null {
    return this.category() === 'armor' ? fpsArmorWeightKey(r.subType) : fpsWeaponTypeKey(r.subType);
  }

  setCategory(c: FpsCategory): void {
    if (c === this.category()) return;
    // The primary facet doesn't carry across categories (weapon types vs armour slots).
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

  /** The filtered empty state's way out: the search AND the facets, not the facets alone. */
  resetAll(): void {
    this.clearSearch();
    this.resetFilters();
  }

  reload(): void {
    void this.loadCatalog(this.category(), this.includeVariants());
  }

  loadMore(): void {
    this.shown.update((n) => n + PAGE_SIZE);
  }

  isPinned(r: FpsRow): boolean {
    return this.svc.isPinned(r.detailKind, r.classNameSlug);
  }

  togglePin(r: FpsRow): void {
    this.svc.togglePin(r.detailKind, r.classNameSlug);
  }

  sizePct(size: number): number {
    return Math.min(100, Math.max(8, Math.round((size / 12) * 100)));
  }

  private async loadCatalog(category: FpsCategory, includeVariants: boolean): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    this.catalog.set([]);
    try {
      const rows = await this.svc.listFpsCatalog(category, includeVariants);
      if (seq !== this.loadSeq) return;
      const detailKind: 'weapon' | 'item' = category === 'weapon' ? 'weapon' : 'item';
      const catalog = rows.map((r) => ({ ...r, detailKind }));
      this.catalog.set(catalog);
      this.dropUnknownFacets();
      // The tab keeps the category's own size, not what the current search and
      // facets leave of it — it still shows after the reader switches tabs.
      this.counts.update((c) => ({ ...c, [category]: this.fold(catalog, includeVariants).length }));
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.error.set((err as Error).message ?? 'Unknown error');
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }
}

/**
 * Case-insensitive "contains" test for the list search, with `*` as a
 * wildcard the way the index search's ILIKE reads it — the placeholder's own
 * example `klwe_*` found nothing while `*` was compared literally. Null for a
 * term that filters nothing (empty, or only wildcards).
 */
function searchMatcher(raw: string): ((text: string) => boolean) | null {
  const term = raw.trim().toLowerCase();
  if (!term.includes('*')) return term ? (text) => text.toLowerCase().includes(term) : null;
  const parts = term.split('*').filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (parts.length === 0) return null;
  const pattern = new RegExp(parts.join('.*'));
  return (text) => pattern.test(text.toLowerCase());
}

function uniqSorted(values: (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) =>
    a.localeCompare(b),
  );
}
