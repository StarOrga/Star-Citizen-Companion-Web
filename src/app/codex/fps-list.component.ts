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
  CodexListRow,
  CodexService,
  fpsArmorAttachType,
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
  RoleLoadoutItem,
} from '../hangar/hangar.types';
import { ARMOR_SLOT_SPECS, roleSlotForAttachType } from './codex-landing-kpi';

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

/** A card in the grid: an FPS row after variant folding AND livery grouping. */
type FpsGridRow = SkinGroupedRow<FoldedRow<FpsRow>>;

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
          <a class="equip-back" routerLink="/codex" [queryParams]="{ zone: 'board', set: set.id }">
            {{ 'fps.equip.backToSet' | translate }}
          </a>
        </div>
      }

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
                @for (m of manufacturerOptions(); track m.code) {
                  <option [value]="m.code">{{ m.label }}</option>
                }
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
          @if (hasMore()) {
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
                  @if (cardMfr(r); as mfr) { <span class="badge mfr" [attr.title]="mfr">{{ mfr }}</span> }
                  <span class="badge cat">{{ ('fps.category.' + category()) | translate }}</span>
                  @if (armorSlotOf(r); as slot) { <span class="badge slot">{{ slot }}</span> }
                  @if (r.subType) { <span class="badge subtle">{{ r.subType }}</span> }
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
                @if (r.size != null) {
                  <div class="size-bar" [attr.title]="'codex.card.size' | translate: { size: r.size }">
                    <span class="size-track"><span class="size-fill" [style.width.%]="sizePct(r.size)"></span></span>
                    <span class="size-tag">S{{ r.size }}</span>
                  </div>
                }
                @if (equipSlots(r); as slots) {
                  @if (slots.length > 0) {
                    <!-- Real actions, so real <button>s — the card around them
                         stays the navigation. Armour offers its one anatomical
                         home; a weapon offers the set's weapon positions. -->
                    <div class="equip-row">
                      <span class="equip-label">{{ 'fps.equip.into' | translate }}</span>
                      @for (slot of slots; track slot) {
                        <button type="button" class="equip-btn"
                                [class.on]="isEquipped(r, slot)"
                                [disabled]="equipBusy() !== null"
                                (click)="equip($event, r, slot)">
                          {{ slotLabel(slot) }}
                        </button>
                      }
                    </div>
                  }
                }
              </a>
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

    /* Equip mode — the archive working FOR one personal set. Amber is the
       "yours / equipped" colour the AN BORD zone established; nothing else on
       this page uses it, so the mode is visible without a banner shouting. */
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
    .equip-back:hover { text-decoration: underline; }

    .equip-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
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
      min-height: var(--sc-tap-min, 44px);
    }
    .equip-btn:hover:not(:disabled) { border-color: var(--sc-accent); color: var(--sc-accent); }
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
    /* Holds a spelled-out manufacturer now ("Klaus & Werner"), so the pill has
       to stay inside the card on a phone. */
    .badge.mfr { background: color-mix(in srgb, var(--sc-accent-hot) 14%, transparent); border-color: color-mix(in srgb, var(--sc-accent-hot) 35%, transparent);
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

  private readonly route = inject(ActivatedRoute);
  private readonly hangar = inject(HangarService);

  readonly category = signal<FpsCategory>('weapon');
  /** Target set id from `?equipInto=` — the equip intent, see applyDeepLink(). */
  readonly equipInto = signal<string | null>(null);
  /** The set that intent points at, once loaded. Null = ordinary browsing. */
  readonly targetSet = signal<HangarRoleLoadout | null>(null);
  /** `<className>|<slot>` while a write is in flight — disables the whole row. */
  readonly equipBusy = signal<string | null>(null);
  readonly searchInput = signal('');
  private readonly searchTerm = signal('');
  readonly manufacturer = signal('');
  readonly size = signal('');
  readonly grade = signal('');
  readonly subType = signal('');
  readonly includeVariants = signal(false);

  /** Rows exactly as the server returned them, before display-level folding. */
  private readonly rawRows = signal<FpsRow[]>([]);
  private readonly serverTotal = signal(0);

  /**
   * What the grid renders, after two display-level passes:
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
      ? this.rawRows().map((r) => ({
          ...r,
          foldedClassNames: [] as readonly string[],
          skinVariants: [] as readonly SkinVariantRef[],
        }))
      : groupSkinRows(foldVariantRows(this.rawRows(), (r) => this.cardName(r))),
  );
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

  // Entity counts (weapons/armor) shown next to the category tabs — best-effort,
  // populated once the first page of each category has loaded at least once.
  private readonly counts = signal<Partial<Record<FpsCategory, number>>>({});

  /**
   * Manufacturer facet — spelled-out labels over the promoted code as the
   * filter value. See `manufacturerFacetOptions`.
   */
  readonly manufacturerOptions = computed(() =>
    manufacturerFacetOptions(this.rows(), this.dataLang()),
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
    this.applyDeepLink();
    await Promise.all([this.svc.loadCurrentBuild(), this.loadTargetSet()]);
  }

  /**
   * Resolve `?equipInto=` into the actual set. Best-effort on purpose: a stale
   * id (deleted set, old bookmark) simply leaves `targetSet` null, and the page
   * is the ordinary archive again — never a broken editor.
   */
  private async loadTargetSet(): Promise<void> {
    const id = this.equipInto();
    if (!id) {
      this.targetSet.set(null);
      return;
    }
    try {
      this.targetSet.set(await this.hangar.getRoleLoadout(id));
    } catch {
      this.targetSet.set(null);
    }
  }

  /**
   * AN-BORD deep link: `?cat=armor&slot=Helmet` opens this page already narrowed
   * to one anatomical position, so clicking the helmet on the Codex landing
   * lands in a list that can only contain helmets.
   *
   * `equipInto` (the target set id) is read here too — it carries the EQUIP
   * INTENT. Keeping the intent in the URL is what makes requirement 4 of the
   * rethink structural rather than a mode flag: an equip control cannot be
   * rendered during ordinary browsing, because ordinary browsing has no
   * `equipInto` in its URL.
   */
  private applyDeepLink(): void {
    const q = this.route.snapshot.queryParamMap;
    const cat = q.get('cat');
    if (cat === 'armor' || cat === 'weapon') this.category.set(cat);
    const slot = q.get('slot');
    // Only accept a facet the current category can actually offer, so a stale
    // link never leaves the list filtered to a value with zero rows.
    if (slot && this.category() === 'armor' && fpsArmorAttachType(slot)) this.subType.set(slot);
    else if (slot && this.category() === 'weapon') this.subType.set(slot);
    this.equipInto.set(q.get('equipInto'));
  }

  /**
   * Which slots of the target set this row may go into.
   *
   * Armour has exactly one home, derived from its `attach_type` — the same
   * mapping the AN BORD paperdoll uses, so a helmet lands where the figure
   * shows a helmet. Weapons and tools have no such anchor, so the set's own
   * non-anatomical positions are offered (fps → primary/secondary/sidearm,
   * mining → multitool/mining-attachment/gadget, …) and the user picks.
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
    const slots = (ROLE_SLOT_SUGGESTIONS[set.role] ?? []).filter((s) => !anatomical.has(s));
    return slots.length > 0 ? slots : ['primary'];
  }

  /** i18n label for a slot token; `hangar.slots.*` covers every suggested one. */
  slotLabel(slot: string): string {
    const key = 'hangar.slots.' + slot;
    const label = this.t.instant(key);
    return label === key ? slot : label;
  }

  isEquipped(r: FpsRow, slot: string): boolean {
    return this.targetSet()?.items.some(
      (i) => i.slot === slot && i.className === r.classNameSlug,
    ) ?? false;
  }

  /**
   * Put this row into `slot` of the target set — a read-merge-write on the
   * items array, so slots this page knows nothing about survive untouched.
   * Clicking the same slot again clears it, which is the only way to empty a
   * position now that the editor is gone.
   */
  async equip(ev: Event, r: FpsRow, slot: string): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    const set = this.targetSet();
    if (!set || this.equipBusy()) return;
    const clearing = this.isEquipped(r, slot);
    const items: RoleLoadoutItem[] = set.items.filter((i) => i.slot !== slot);
    if (!clearing) items.push({ slot, className: r.classNameSlug, kind: r.detailKind });
    this.equipBusy.set(`${r.classNameSlug}|${slot}`);
    try {
      const updated = await this.hangar.updateRoleLoadout(set.id, { items });
      if (updated) this.targetSet.set(updated);
    } finally {
      this.equipBusy.set(null);
    }
  }

  categoryCount(c: FpsCategory): number | null {
    // The active tab quotes the same folded number the result header shows —
    // two different counts for one list read as a bug.
    if (c === this.category() && this.rawRows().length > 0) return this.total();
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
      this.rawRows.set(reset ? rows : [...this.rawRows(), ...rows]);
      this.serverTotal.set(res.count);
      this.counts.update((c) => ({ ...c, [activeCategory]: res.count }));
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
