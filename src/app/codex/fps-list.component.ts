import {
  ChangeDetectionStrategy,
  Component,
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
import { ARMOR_SLOT_SPECS, roleSlotForAttachType } from './codex-landing-kpi';
import { mirrorQueryParams } from './codex-url-state';

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
 * FPS weapon sub-types → the index's on-foot weapon groups (codex-weapon-taxonomy):
 * the facet reuses those labels ("Einhandwaffen"), a card its singular
 * (`fps.weaponType.*`). Only the tokens the catalog really carries.
 */
const WEAPON_TYPE_ID: Readonly<Record<string, string>> = {
  Small: 'sidearm',
  Medium: 'primary',
  Large: 'heavy',
  Knife: 'melee',
  Grenade: 'throwable',
  Gadget: 'gadget',
};

/** Armour slot tokens (`fpsArmorSlot`) → the AN BORD figure's position labels. */
const ARMOR_SLOT_ID: Readonly<Record<string, string>> = {
  Helmet: 'helmet',
  Torso: 'torso',
  Arms: 'arms',
  Legs: 'legs',
  Undersuit: 'undersuit',
  Backpack: 'backpack',
};

/**
 * Armour `sub_type` is the weight class for most pieces; for helmets and
 * undersuits it repeats the slot ("Helmet") or is the game's "UNDEFINED" —
 * those carry nothing the slot badge doesn't already say, so no badge.
 */
const ARMOR_WEIGHT_ID: Readonly<Record<string, string>> = {
  Light: 'light',
  Medium: 'medium',
  Heavy: 'heavy',
};

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
  imports: [NeuroFieldDirective, FormsModule, RouterLink, TranslatePipe, CodexCompareTrayComponent, CodexCategoryIconComponent, CodexStatusBannerComponent],
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
        <div class="sc-card equip-bar">
          <span class="equip-for">
            {{ 'fps.equip.targetSet' | translate: { name: set.name } }}
            <span class="equip-role">{{ ('hangar.roles.' + set.role) | translate }}</span>
          </span>
          <a class="equip-back" [routerLink]="['/codex', 'set', set.id]">
            {{ 'fps.equip.backToSet' | translate }}
          </a>
        </div>
      } @else if (equipTargetMissing()) {
        <!-- A stale or foreign ?equipInto= used to drop the equip mode without
             a word — the reader clicked "put on" and landed in a plain list. -->
        <p class="sc-card equip-missing" role="status">{{ 'fps.equip.setUnavailable' | translate }}</p>
      }

      <!-- Category switcher: a pressed-button group, not tabs — there is no
           tab panel behind it, the whole page below re-renders. -->
      <div class="kind-bar" role="group" [attr.aria-label]="'fps.categoriesAria' | translate">
        @for (c of categories; track c) {
          <button class="kind" type="button"
                  [class.active]="category() === c"
                  [attr.aria-pressed]="category() === c"
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
                 [attr.placeholder]="'fps.searchPlaceholder' | translate" />
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
                @for (s of subTypeOptions(); track s.value) {
                  <option [value]="s.value">{{ s.labelKey ? (s.labelKey | translate) : s.raw }}</option>
                }
              </select>
            </label>
          }
          @if (manufacturerOptions().length > 0) {
            <label class="facet">
              <span>{{ 'codex.filters.manufacturer' | translate }}</span>
              <select class="sc-select" [ngModel]="manufacturer()" (ngModelChange)="setManufacturer($event)">
                <option value="">{{ 'codex.filters.all' | translate }}</option>
                @for (m of manufacturerOptions(); track m.code) {
                  <option [value]="m.code">{{ m.label }}</option>
                }
              </select>
            </label>
          }
          @if (sizeOptions().length > 1) {
            <label class="facet">
              <span>{{ 'codex.filters.size' | translate }}</span>
              <select class="sc-select" [ngModel]="size()" (ngModelChange)="setSize($event)">
                <option value="">{{ 'codex.filters.anySize' | translate }}</option>
                @for (s of sizeOptions(); track s) { <option [value]="s">S{{ s }}</option> }
              </select>
            </label>
          }
          @if (gradeOptions().length > 1) {
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
            <p>{{ (hasActiveFilters() || searchInput() ? 'codex.empty.filtered' : ('fps.empty.' + category()) | translate) | translate }}</p>
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
                      <sc-codex-icon [kind]="r.detailKind" [sub]="iconSub(r)" />
                    }
                  </div>
                  <h3 class="name">{{ cardName(r) }}</h3>
                  <code class="cls">{{ r.classNameSlug }}</code>
                  <div class="badges">
                    @if (cardMfr(r); as mfr) { <span class="badge mfr" [attr.title]="mfr">{{ mfr }}</span> }
                    <span class="badge cat">{{ ('fps.category.' + category()) | translate }}</span>
                    @if (armorSlotKey(r); as slotKey) { <span class="badge slot">{{ slotKey | translate }}</span> }
                    @if (typeKey(r); as typeKey) { <span class="badge subtle">{{ typeKey | translate }}</span> }
                    @if (r.grade) { <span class="badge grade" [attr.data-grade]="r.grade">{{ 'codex.card.grade' | translate: { grade: r.grade } }}</span> }
                    @if (r.isVariant) { <span class="badge variant">{{ 'codex.card.variant' | translate }}</span> }
                    @if (r.foldedClassNames.length; as folded) {
                      <span class="badge folded"
                            [attr.title]="'codex.card.foldedTitle' | translate: { names: foldedNames(r) }">
                        {{ (folded === 1 ? 'codex.card.foldedOne' : 'codex.card.foldedMany') | translate: { count: folded } }}
                      </span>
                    }
                    @if (r.skinVariants.length; as skins) {
                      <span class="badge skins"
                            [attr.title]="'codex.card.skinsTitle' | translate: { names: skinNames(r) }">
                        {{ (skins === 1 ? 'codex.card.skinsOne' : 'codex.card.skinsMany') | translate: { count: skins } }}
                      </span>
                    }
                  </div>
                  @if (showSizeBar() && r.size != null) {
                    <div class="size-bar" [attr.title]="'codex.card.size' | translate: { size: r.size }">
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
                        [attr.title]="(isPinned(r) ? 'codex.compare.pinned' : 'codex.compare.pin') | translate">
                  {{ isPinned(r) ? '★' : '☆' }}
                </button>
                @if (equipSlots(r); as slots) {
                  @if (slots.length > 0) {
                    <!-- Armour offers its one anatomical home; a weapon or tool
                         the set's positions it honestly fills. -->
                    <div class="equip-row">
                      <span class="equip-label">{{ 'fps.equip.into' | translate }}</span>
                      @for (slot of slots; track slot) {
                        <button type="button" class="equip-btn"
                                [class.on]="isEquipped(r, slot)"
                                [attr.aria-pressed]="isEquipped(r, slot)"
                                [attr.aria-busy]="equipBusy() === r.classNameSlug + '|' + slot"
                                [disabled]="equipBusy() !== null"
                                (click)="equip($event, r, slot)">
                          {{ slotLabel(slot) }}
                        </button>
                      }
                      <!-- At the card that was clicked, not in the bar at the top of a
                           list the reader has scrolled away from. -->
                      @if (equipFailedOn(r)) {
                        <p class="equip-err" role="alert">{{ 'fps.equip.failed' | translate }}</p>
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

    /* Equip mode — the archive working FOR one personal set. The accent frame
       marks the mode; the bar itself names the set, so no banner has to shout. */
    .equip-bar {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; flex-wrap: wrap;
      border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
    }
    .equip-for { display: inline-flex; align-items: center; gap: 8px; font-size: 0.9rem; }
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
    .equip-missing { margin: 0; padding: 12px 16px; color: var(--sc-fg-1); font-size: max(0.84rem, var(--sc-fs-floor)); }

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
    .search:focus { outline: none; border-color: var(--sc-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--sc-accent) 22%, transparent); }
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
    /* The wrapper is the visible card (frame, lift on hover); the link fills it
       and the actions ride on top / below as its siblings. */
    .card-wrap {
      position: relative; display: flex; flex-direction: column; min-height: 116px;
      border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-1);
      transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s;
    }
    .card-wrap:hover { transform: translateY(-2px); border-color: var(--sc-accent); box-shadow: 0 6px 20px rgba(0,0,0,0.4), 0 0 14px color-mix(in srgb, var(--sc-accent) 28%, transparent); }
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
    .load-more { padding: 10px 24px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-accent); color: var(--sc-accent); font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; min-height: var(--sc-tap-min); }
    .load-more:hover { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }

    .empty { text-align: center; padding: 40px 20px; color: var(--sc-fg-1); }
    .empty p { color: var(--sc-fg-2); margin: 6px 0 0; }
    .err { color: var(--sc-danger); padding: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .err .retry { margin-left: auto; padding: 6px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font-family: inherit; }
    .err .retry:hover { background: color-mix(in srgb, var(--sc-danger) 12%, transparent); }
    .err .retry:focus-visible { outline: 2px solid var(--sc-danger); outline-offset: 2px; }

    @media (max-width: 720px) {
      .head { flex-direction: column; }
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
    const term = this.searchTerm().trim().toLowerCase();
    const mfr = this.manufacturer();
    const size = this.size();
    const grade = this.grade();
    const sub = this.subType();
    const armor = this.category() === 'armor';
    return this.catalog().filter(
      (r) =>
        (!term ||
          this.cardName(r).toLowerCase().includes(term) ||
          (r.nameLocalized ?? '').toLowerCase().includes(term) ||
          r.classNameSlug.toLowerCase().includes(term)) &&
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
  readonly rows = computed<FpsGridRow[]>(() =>
    this.includeVariants()
      ? this.filtered().map((r) => ({
          ...r,
          foldedClassNames: [] as readonly string[],
          skinVariants: [] as readonly SkinVariantRef[],
        }))
      : groupSkinRows(foldVariantRows(this.filtered(), (r) => this.cardName(r))),
  );
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
    const order = Object.keys(armor ? ARMOR_SLOT_ID : WEAPON_TYPE_ID);
    const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length);
    values.sort((a, b) => rank(a) - rank(b));
    return values.map((v) => {
      const id = armor ? ARMOR_SLOT_ID[v] : WEAPON_TYPE_ID[v];
      // A weapon token outside the known six (one record says just "Weapon")
      // reads as the index's "Sonstige", not as a raw English word.
      const labelKey = armor
        ? id ? `codex.landing.paperdoll.${id}` : null
        : `codex.weaponGroup.fps.${id ?? 'other'}`;
      return { value: v, labelKey, raw: v };
    });
  });

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
    // Only accept a facet the category can actually carry — a stale or typed
    // link (?slot=Foo) used to filter the list down to zero rows.
    const slot = q.get('slot');
    const knownSlot =
      !!slot && Object.hasOwn(this.category() === 'armor' ? ARMOR_SLOT_ID : WEAPON_TYPE_ID, slot);
    if (knownSlot) this.subType.set(slot!);
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
    if (equipSlot && this.category() === 'weapon' && !knownSlot && Object.hasOwn(SLOT_WEAPON_FACET, equipSlot)) {
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
    const set = this.targetSet();
    if (!set || this.equipBusy()) return;
    const clearing = this.isEquipped(r, slot);
    const key = `${r.classNameSlug}|${slot}`;
    this.equipBusy.set(key);
    this.equipFailed.set(null);
    try {
      // The service reports a refused write as null (and never throws for it);
      // a thrown error is the transport failing. Both used to look exactly
      // like a click that did nothing.
      const updated = await this.hangar
        .setRoleLoadoutSlot(set.id, slot, clearing ? null : { className: r.classNameSlug, kind: r.detailKind })
        .catch(() => null);
      if (updated) this.targetSet.set(updated);
      else this.equipFailed.set(key);
    } finally {
      this.equipBusy.set(null);
    }
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
    const id = ARMOR_SLOT_ID[fpsArmorSlot(r.attachType) ?? ''];
    return id ? `codex.landing.paperdoll.${id}` : null;
  }

  /**
   * i18n key of the type badge: the weapon type for weapons, the weight class
   * for armour. Tokens that only repeat the slot or are the game's
   * "UNDEFINED" get no badge instead of a raw English word.
   */
  typeKey(r: FpsRow): string | null {
    const sub = r.subType ?? '';
    if (this.category() === 'armor') {
      const id = ARMOR_WEIGHT_ID[sub];
      return id ? `fps.weight.${id}` : null;
    }
    const id = WEAPON_TYPE_ID[sub];
    return id ? `fps.weaponType.${id}` : null;
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
      this.catalog.set(rows.map((r) => ({ ...r, detailKind })));
      this.counts.update((c) => ({ ...c, [category]: this.total() }));
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.error.set((err as Error).message ?? 'Unknown error');
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
