import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqOwnershipService } from '../../hq/hq-ownership.service';
import { CodexService } from '../../codex/codex.service';
import { CodexBuildDiffService } from '../../codex/codex-build-diff.service';
import { humanizeClassName } from '../../codex/codex-format';
import { PolyHitKind, PolySearchHit, isUpcomingHit } from '../../codex/codex-poly-search';
import type { CodexKind } from '../../codex/codex.service';
import { CodexSearchEngine } from '../../codex/search/codex-search-engine';
import {
  CodexSearchHub,
  CodexSearchBarHandle,
  isEditableTarget,
  isTypeToSearchKey,
} from '../../codex/search/codex-search-hub.service';
import { SearchTarget, hitManufacturer, hitTitle, targetUrl } from '../../codex/search/codex-search-model';
import { resolveCta, resolveIcons } from '../../codex/search/search-cta';
import {
  SEARCH_ROWS_SHOWN,
  SearchChip,
  SearchChipOption,
  SearchCta,
  SearchResultGroup,
  SearchResultRow,
  SearchRowIcons,
} from '../../codex/search/search-result-model';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { FusionSearchChipComponent } from './fusion-search-chip.component';
import { FusionSearchHintComponent, SearchHint } from './fusion-search-hint.component';
import { SEARCH_ACTION_ICONS, SEARCH_KIND_ICONS, SearchIconKind } from './search-icons';
import { RECENT_ROWS_SHOWN, StoredRow, pushRecentRow, readRecentRows } from './search-recent-rows';
import { ItemPathComponent } from '../../shared/item-path/item-path.component';
import { RowActionResult, SearchRowActionsService } from './search-row-actions.service';
import { ShellChromeService } from './shell-chrome.service';
import { SearchContext, SearchPlace, matchPlaces, searchContextOf } from './search-context';

/** Recent searches the empty field offers (A6: the 7 newest). */
export const RECENT_TERMS_SHOWN = 7;
/** App pages matched by name: a quiet group at the end, never a CTA or icons. */
const PLACES_SHOWN = 3;

const NO_ICONS: SearchRowIcons = { wishlist: false, lager: false, nachschub: false };

/** An app page found by name — a row without CTA or icons (B10). */
interface PlaceRow {
  type: 'place';
  id: string;
  place: SearchPlace;
  target: SearchTarget;
  cta: null;
  icons: SearchRowIcons;
}

export type ViewRow = SearchResultRow | PlaceRow;

/** One stop of the arrow keys. */
export type FusionOption =
  | { type: 'row'; id: string; row: ViewRow; group: string }
  | { type: 'more'; id: string; group: string; total: number; target: SearchTarget; own: boolean }
  | { type: 'recent'; id: string; term: string; target: SearchTarget };

/** A group tile as the panel draws it. */
export interface ViewGroup {
  id: string;
  labelKey: string;
  labelParams: Record<string, string | number> | null;
  count: number | null;
  /** Translated "steht oben, weil …", or null. */
  reason: string | null;
  own: boolean;
  outside: boolean;
  /** Rows shown now (3, or all while the group is expanded). */
  options: FusionOption[];
  /** Rows beyond the first three: "▾ N weitere hier zeigen". 0 when expanded or none. */
  expandable: number;
  expanded: boolean;
  /** "Alle N im Index/HQ öffnen →". */
  more: Extract<FusionOption, { type: 'more' }> | null;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Ships a fitted-on meta line names before it counts the rest. */
const FITTED_SHOWN = 2;

/**
 * The Fusion bar's search (concept 2026-11-02 "Suche: Kontext & Aktionen").
 *
 * Runs the ONE Codex search (`CodexSearchEngine`) and renders its composed
 * `result()`: chips in the field (route, page section, typed values — one
 * colour, ▾/× on hover, a menu that grows out of the chip), group tiles with
 * "Aus deinem Bestand" first (green outline), three rows per group, an
 * in-panel accordion (→ / ←), a real "Alle N" anchor, a dashed group for fast
 * exact hits outside the chips, and per row: icon or silhouette, name (ship
 * type first), meta, Neu glyph, passt-auf badge, ONE quiet CTA and the three
 * standard icons (Wunschliste · Nachschub · Bestand / In den Hangar).
 * Every row is a real anchor; the field keeps focus (aria-activedescendant).
 */
@Component({
  selector: 'sc-fusion-search',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScTooltipDirective, FusionSearchChipComponent, FusionSearchHintComponent, ItemPathComponent],
  providers: [CodexSearchEngine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.open]': 'open()',
    '[class.bottom]': "placement() === 'bottom'",
    '[class.compact]': 'compact()',
    '[class.supply-intent]': 'chrome.supplySearch()',
    '(window:resize)': 'fitPanel()',
  },
  template: `
    <!-- Phone (bottom placement): the closed search is a magnifier button; tapping opens the field. -->
    <button #mag type="button" class="mag" (click)="openFromButton()"
            [attr.aria-label]="'fusionBar.search.open' | translate"
            [attr.aria-expanded]="open()"
            [scTooltip]="'fusionBar.search.open' | translate" scTooltipTier="label">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" />
      </svg>
    </button>
    <div class="field" [class.focused]="open()" [class.menu-open]="chipMenu()" (pointerdown)="onFieldPointer($event)">
      <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" />
      </svg>
      <!-- Chips: only automatic (route, page section, typed values), always visible (C2/C3). -->
      @for (c of chips(); track c.id) {
        <sc-fusion-search-chip class="fchip" [chip]="c" [label]="chipLabel(c)" [optionLabel]="optionLabelFn"
                               (remove)="removeChip(c)" (pick)="pickChipValue(c, $event)" (menuChange)="chipMenu.set($event)" />
      }
      <ng-content select="[fsLeading]" />
      <span class="inwrap">
      <input #field
             class="input"
             [class.demoing]="demoOn()"
             type="search"
             role="combobox"
             autocomplete="off"
             spellcheck="false"
             enterkeyhint="search"
             aria-autocomplete="list"
             aria-keyshortcuts="Control+K /"
             [attr.aria-expanded]="open()"
             [attr.aria-controls]="open() ? listboxId : null"
             [attr.aria-activedescendant]="activeDescendant()"
             [attr.aria-label]="'fusionBar.search.label' | translate"
             [attr.placeholder]="('fusionBar.placeholder.' + context().key) | translate"
             [value]="engine.input()"
             (input)="onInput($any($event.target).value)"
             (focus)="focused.set(true)"
             (blur)="focused.set(false)"
             (click)="openPanel()"
             (keydown)="onKeydown($event)" />
        @if (!engine.input() && !demoOn()) {
          <!-- The visible placeholder: Chromium clips a focused input's native placeholder
               mid-letter (text-overflow only applies unfocused), and the field is autofocused.
               The input's placeholder attribute stays its accessible description. -->
          <span class="ph" aria-hidden="true">{{ ('fusionBar.placeholder.' + context().key) | translate }}</span>
        }
        @if (demoOn()) {
          <!-- Staged and idle: the placeholder fades, example searches type themselves
               (concept r8 sty1–3). Decoration only — the input's label stays its name. -->
          <span class="demo" aria-hidden="true">
            <span class="demo-ph">{{ ('fusionBar.placeholder.' + context().key) | translate }}</span>
            @for (k of demoKeys; track k) {
              @let text = k | translate;
              <span class="demo-t" [style.--n]="text.length">{{ text }}</span>
            }
          </span>
        }
      </span>
      @if (!open() && !engine.input()) {
        <span class="hint" aria-hidden="true"><kbd>{{ 'codex.search.bar.keys.ctrl' | translate }} K</kbd><kbd>/</kbd></span>
      }
      <ng-content select="[fsTrailing]" />
      <!-- The ✕ only clears the text (A9). Under the thumb an empty open sheet keeps a close ✕. -->
      <span class="xslot">
        @if (engine.input()) {
          <button type="button" class="close clear" (click)="clearInput()"
                  [attr.aria-label]="'fusionBar.search.clear' | translate"
                  [scTooltip]="'fusionBar.search.clear' | translate" scTooltipTier="label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        } @else if (open() && placement() === 'bottom') {
          <button type="button" class="close" (click)="close(true)"
                  [attr.aria-label]="'codex.search.bar.close' | translate"
                  [scTooltip]="'codex.search.bar.close' | translate" scTooltipTier="label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        }
      </span>
      @if (stripShown()) {
        <!-- op-hybrid: on a page with its own list search the list filters live and the
             panel stays shut; this slim line offers the whole Codex (click / ↓ expands). -->
        <button type="button" class="strip" (click)="openPanel()" aria-live="polite">
          @if (busy()) {
            {{ 'fusionBar.search.stripBusy' | translate }}
          } @else {
            {{ 'fusionBar.search.strip' | translate: { n: stripTotal() } }}
          }
          <span class="strip-k" aria-hidden="true">↓</span>
        </button>
      }
    </div>

    @if (open()) {
      <div class="panel" [class.has-term]="hasText()">
        @if (chrome.supplySearch()) {
          <p class="supply-hint" role="status">
            <svg viewBox="0 0 24 24" aria-hidden="true">@for (d of actionIcons.nachschub; track $index) { <path [attr.d]="d" /> }</svg>
            <span>{{ 'search.supplyHint' | translate }}</span>
          </p>
        }
        @if (hasText() && engine.error(); as err) {
          <div class="state err" role="alert">
            <span>{{ 'codex.search.bar.failed' | translate }} — {{ err | translate }}</span>
            <button type="button" class="retry" (click)="engine.retry()">{{ 'codex.error.retry' | translate }}</button>
          </div>
        }
        @if (readingsShown(); as rd) {
          <!-- What the search understood: aliases that fired, words that became chips (C6, r2 t-s3 .mk-t-abbr). -->
          <p class="abbr" role="status">
            @for (a of rd.aliases; track a.word) {
              @if (!$first) { <span class="sepdot" aria-hidden="true">·</span> }
              <span>{{ 'search.abbr.alias' | translate: { word: a.word } }} <b>{{ aliasLabel(a.to) }}</b></span>
            }
            @for (c of rd.chips; track c.word) {
              @if (!$first || rd.aliases.length) { <span class="sepdot" aria-hidden="true">·</span> }
              <span>{{ 'search.abbr.chip' | translate: { word: c.word } }} <b>{{ chipLabel(c.chip) }}</b></span>
            }
          </p>
        }
        @if (hasText() && didYouMean().length) {
          <p class="dym" role="status">
            <span>{{ 'search.dym.lead' | translate }}</span>
            @for (d of didYouMean(); track d) {
              <button type="button" class="dym-b" (click)="searchSuggestion(d)">{{ d }}</button>
            }
          </p>
        }
        @if (outsideOnly(); as oc) {
          <!-- Nothing inside the chip: say so, and offer the search without it (r2 t-s5). -->
          <p class="dym" role="status">
            <span>{{ 'search.outside.none' | translate: { chip: chipLabel(oc), term: engine.term().trim() } }}</span>
            <button type="button" class="sum-b" (click)="removeChip(oc)">{{ 'search.outside.drop' | translate: { chip: chipLabel(oc) } }}</button>
          </p>
        }
        @if (summary(); as sum) {
          <!-- Accordion: the other groups collapse to one line on top (r1 sa-s3). -->
          <p class="summary">
            @for (s of sum; track s.id) {
              @if (s.expanded) {
                <b>{{ 'search.group.expanded' | translate: { name: (s.labelKey | translate: s.labelParams) } }}</b>
              } @else {
                <button type="button" class="sum-b" (click)="expand(s.id)">{{ s.labelKey | translate: s.labelParams }} <span class="n">{{ s.count }}</span></button>
              }
            }
            <span class="sum-k">{{ 'search.group.collapseKey' | translate }}</span>
          </p>
        }

        <div class="listbox" role="listbox" [id]="listboxId"
             [attr.aria-label]="(hasText() ? 'codex.search.bar.resultsAria' : 'codex.search.bar.suggestionsAria') | translate"
             [attr.aria-busy]="busy()" [class.stale]="busy()">
          @for (g of viewGroups(); track g.id; let gi = $index) {
            <div class="group" role="group" [class.own]="g.own" [class.outside]="g.outside" [class.expanded]="g.expanded"
                 [style.--i]="gi" [attr.aria-labelledby]="listboxId + '-h-' + g.id">
              <div class="group-head" role="presentation">
                <span [id]="listboxId + '-h-' + g.id">{{ g.labelKey | translate: g.labelParams }}</span>
                @if (g.count !== null) { <span class="count">{{ g.count }}</span> }
                @if (g.expanded) {
                  <button type="button" class="why collapse" (click)="collapse()">{{ 'search.group.collapse' | translate }}</button>
                } @else if (g.reason) {
                  <span class="why">{{ g.reason }}</span>
                }
              </div>
              <div class="rows" [class.terms]="g.id === 'recent'">
                @for (o of g.options; track o.id) {
                  @switch (o.type) {
                    @case ('row') {
                      @let r = o.row;
                      @let nm = rowName(r);
                      <div class="row" role="presentation" [class.active]="isActive(o)" [class.soon]="isSoon(r)">
                        <a class="hit" role="option" tabindex="-1" [id]="optId(o)" [attr.aria-selected]="isActive(o)"
                           [routerLink]="r.target.link" [queryParams]="r.target.queryParams" [fragment]="r.target.fragment ?? undefined"
                           (click)="onRowClick($event, o)" (mouseenter)="hover(o)">
                          <span class="ico" aria-hidden="true">
                            @if (silhouetteOf(r); as sil) {
                              <svg class="sil" [attr.viewBox]="sil.viewBox" preserveAspectRatio="xMidYMid meet"><path [attr.d]="sil.path" vector-effect="non-scaling-stroke" /></svg>
                            } @else {
                              <svg viewBox="0 0 24 24">@for (d of kindIcon(r); track $index) { <path [attr.d]="d" /> }</svg>
                            }
                          </span>
                          <span class="body">
                            <span class="name">
                              <span class="nm">{{ nm.title }}@if (nm.own) { <span class="ownname"> · „{{ nm.own }}“</span> }</span>
                              @if (newIn(r); as v) {
                                <span class="new" tabindex="0" role="img" [attr.aria-label]="'search.newInPatch' | translate: { version: v }"
                                      [scTooltip]="'search.newInPatch' | translate: { version: v }" scTooltipTier="label">
                                  <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="actionIcons.fresh[0]" /></svg>
                                </span>
                              }
                            </span>
                            <span class="meta">
                              @for (m of metaOf(r); track $index) {
                                @if (m.key || m.text) {
                                  <span [class.mine]="m.mine">{{ m.key ? (m.key | translate: m.params) : m.text }}</span>
                                }
                              }
                              @if (fitOf(r); as fit) {
                                <span class="fit" [class.ok]="fit.verdict === 'fits'" [class.no]="fit.verdict === 'noFit'" [class.unk]="fit.verdict === 'unknown'">
                                  @switch (fit.verdict) {
                                    @case ('fits') { ✓ {{ 'search.fit.fits' | translate: { name: compatName() } }} }
                                    @case ('noFit') { ⚠ {{ 'search.fit.noFit' | translate }}@if (fit.reasonKey) { · {{ fit.reasonKey | translate: fit.reasonParams }} } }
                                    @default { ? {{ (fit.reasonKey ?? 'search.fit.unknown') | translate }} }
                                  }
                                </span>
                              }
                            </span>
                          </span>
                        </a>
                        @if (r.cta || hasIcons(r)) {
                          <span class="rt">
                            @if (r.cta; as c) {
                              @if (c.type === 'link' && c.target) {
                                <a class="cta" [routerLink]="c.target.link" [queryParams]="c.target.queryParams" [fragment]="c.target.fragment ?? undefined"
                                   (click)="onCtaLinkClick($event, o)">{{ c.labelKey | translate }}</a>
                              } @else {
                                <button type="button" class="cta" [disabled]="busyRow() === r.id" (click)="runCta($event, c, r)">{{ c.labelKey | translate }}</button>
                              }
                            }
                            @if (r.type === 'hit' && hasIcons(r)) {
                              @if (r.cta) { <span class="sep" aria-hidden="true"></span> }
                              <sc-item-path [kind]="r.hit.kind" [className]="r.hit.classNameSlug" [name]="nm.title"
                                            [level]="chrome.supplySearch() ? 'secondary' : 'tertiary'"
                                            [nextStep]="chrome.supplySearch() ? 'nachschub' : null"
                                            (leave)="close()" />
                            }
                          </span>
                        }
                      </div>
                    }
                    @case ('recent') {
                      <a class="term" role="option" tabindex="-1" [id]="optId(o)" [class.active]="isActive(o)" [attr.aria-selected]="isActive(o)"
                         [attr.href]="href(o.target)"
                         (click)="onTermClick($event, o.term)" (mouseenter)="hover(o)">{{ o.term }}</a>
                    }
                    @default {}
                  }
                }
              </div>
              @if (g.expandable > 0 || g.more) {
                <div class="more-line">
                  @if (g.expandable > 0) {
                    <button type="button" class="expand" (click)="expand(g.id)">{{ 'search.group.expand' | translate: { n: g.expandable } }}</button>
                  } @else { <span></span> }
                  @if (g.more; as m) {
                    <a class="more" role="option" tabindex="-1" [id]="optId(m)" [class.active]="isActive(m)" [attr.aria-selected]="isActive(m)"
                       [routerLink]="m.target.link" [queryParams]="m.target.queryParams" [fragment]="m.target.fragment ?? undefined"
                       (click)="onMoreClick($event)" (mouseenter)="hover(m)">
                      {{ (m.own ? 'search.group.allInHq' : 'search.group.allInIndex') | translate: { n: m.total } }} <span aria-hidden="true">→</span>
                    </a>
                  }
                </div>
              }
            </div>
          }
        </div>

        @if (hasText() && !engine.error() && !busy() && viewGroups().length === 0) {
          <p class="state" role="status">{{ 'codex.search.bar.empty' | translate: { term: engine.term().trim() } }}</p>
        } @else if (busy() && viewGroups().length === 0) {
          <p class="state" role="status">{{ 'codex.search.bar.searching' | translate }}</p>
        }
        @if (!hasText()) {
          <sc-fusion-search-hint class="teaser" [hints]="hints()" (pick)="tryHint($event)" />
        }
        @if (status(); as s) {
          <p class="state" [class.err]="s.error" [attr.role]="s.error ? 'alert' : 'status'">{{ s.key | translate: s.params }}</p>
        }

        <p class="keys" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> {{ 'codex.search.bar.keys.navigate' | translate }}</span>
          @if (hasText()) { <span><kbd>→</kbd> {{ 'search.keys.expand' | translate }}</span> }
          <span><kbd>↵</kbd> {{ 'codex.search.bar.keys.open' | translate }}</span>
          <span><kbd>{{ 'codex.search.bar.keys.ctrl' | translate }}</kbd>+<kbd>↵</kbd> {{ 'codex.search.bar.keys.newTab' | translate }}</span>
          @if (chips().length) { <span><kbd>⌫</kbd> {{ 'search.keys.dropChip' | translate }}</span> }
          <span><kbd>Esc</kbd> {{ 'codex.search.bar.keys.close' | translate }}</span>
        </p>
      </div>
    }
  `,
  styles: [`
    :host { position: relative; display: flex; min-width: 0; flex: 1 1 auto; }
    .field {
      /* The field's own width decides when the key hint gives way (container query below). */
      container-type: inline-size;
      position: relative; isolation: isolate; flex: 1 1 auto; min-width: 0;
      display: flex; align-items: center; gap: var(--sc-space-2);
      height: 44px; padding: 0 var(--sc-space-2) 0 var(--sc-space-4);
      border-radius: 16px; color: var(--sc-fg-2); cursor: text;
      transition: box-shadow var(--sc-bar-hide-ms) ease, background-color var(--sc-bar-hide-ms) ease;
    }
    /* The gradient rim of the mock's welded search, from app tokens. */
    .field::before {
      content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit;
      border: 1px solid transparent;
      background:
        linear-gradient(color-mix(in srgb, var(--sc-bg-0) 88%, transparent), color-mix(in srgb, var(--sc-bg-0) 88%, transparent)) padding-box,
        linear-gradient(90deg, color-mix(in srgb, var(--sc-accent) 70%, transparent), color-mix(in oklab, var(--sc-accent) 40%, var(--sc-bg-3)), color-mix(in srgb, var(--sc-accent) 70%, transparent)) border-box;
    }
    /* A chip menu grows out of the field over the panel. */
    .field.menu-open { z-index: 45; }
    .field.focused { box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 22%, transparent), 0 12px 40px rgba(0, 0, 0, 0.45); }
    .glyph { width: 18px; height: 18px; flex: none; color: var(--sc-accent); }
    .input {
      flex: 1 1 auto; min-width: 4ch; height: 100%; padding: 0; border: 0; outline: none; background: transparent;
      color: var(--sc-fg-0); font-family: inherit; font-size: max(0.92rem, var(--sc-fs-input, 1rem));
      text-overflow: ellipsis;
    }
    .input::placeholder { color: transparent; opacity: 1; }
    .ph {
      position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); pointer-events: none;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: var(--sc-fg-2); font-size: max(0.92rem, var(--sc-fs-input, 1rem));
    }
    .inwrap { position: relative; display: flex; align-items: center; flex: 1 1 auto; align-self: stretch; min-width: 0; }
    .inwrap > .input { width: 0; }
    .input.demoing::placeholder { color: transparent; }
    .demo {
      position: absolute; inset: 0; display: flex; align-items: center; overflow: hidden; pointer-events: none;
      font-size: max(0.92rem, var(--sc-fs-input, 1rem)); color: var(--sc-fg-0);
    }
    .demo-ph, .demo-t { position: absolute; left: 0; white-space: nowrap; }
    .demo-ph { color: var(--sc-fg-2); animation: fs-demo-ph 8s ease-out 3; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .demo-t { clip-path: inset(0 100% 0 0); animation: 8s steps(var(--n, 10)) 3; }
    .demo-t:nth-child(2) { animation-name: fs-demo-1; }
    .demo-t:nth-child(3) { animation-name: fs-demo-2; }
    .demo-t:nth-child(4) { animation-name: fs-demo-3; }
    @keyframes fs-demo-ph { 0%, 18% { opacity: 1; } 22%, 94% { opacity: 0; } 98%, 100% { opacity: 1; } }
    @keyframes fs-demo-1 { 0%, 22% { clip-path: inset(0 100% 0 0); } 30%, 42% { clip-path: inset(0 0 0 0); } 43%, 100% { clip-path: inset(0 100% 0 0); } }
    @keyframes fs-demo-2 { 0%, 44% { clip-path: inset(0 100% 0 0); } 54%, 66% { clip-path: inset(0 0 0 0); } 67%, 100% { clip-path: inset(0 100% 0 0); } }
    @keyframes fs-demo-3 { 0%, 68% { clip-path: inset(0 100% 0 0); } 80%, 95% { clip-path: inset(0 0 0 0); } 96%, 100% { clip-path: inset(0 100% 0 0); } }
    .input::-webkit-search-cancel-button { display: none; }
    .close:focus-visible, .cta:focus-visible, .retry:focus-visible, .expand:focus-visible,
    .collapse:focus-visible, .sum-b:focus-visible, .dym-b:focus-visible {
      outline: 2px solid var(--sc-accent); outline-offset: 1px;
    }
    .hint { display: inline-flex; gap: var(--sc-space-1); flex: none; }
    kbd {
      display: inline-flex; align-items: center; justify-content: center; min-width: 1.6em; height: 1.6em;
      padding: 0 6px; border-radius: 6px; border: 0;
      background: color-mix(in srgb, var(--sc-fg-0) 7%, transparent); color: var(--sc-fg-1);
      font-family: inherit; font-variant-numeric: tabular-nums; font-size: max(0.7rem, var(--sc-fs-floor)); line-height: 1; white-space: nowrap;
    }
    .strip {
      position: absolute; top: calc(100% + 14px); left: var(--sc-space-3); z-index: 3;
      display: inline-flex; align-items: center; gap: var(--sc-space-2);
      min-height: 30px; padding: 0 var(--sc-space-3); border: 0; border-radius: 999px;
      background: var(--sc-bg-1); color: var(--sc-fg-1); cursor: pointer; white-space: nowrap;
      font: inherit; font-size: max(0.78rem, var(--sc-fs-floor));
      box-shadow: 0 10px 28px color-mix(in srgb, var(--sc-depth) 50%, transparent);
      animation: fs-chip-in 0.2s ease both;
    }
    .strip:hover { color: var(--sc-fg-0); }
    .strip:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .strip-k { color: var(--sc-accent); }
    :host(.bottom) .strip { display: none; }
    .xslot { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; }
    .close {
      flex: none; display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border: 0; border-radius: 10px; background: transparent; color: var(--sc-fg-2); cursor: pointer;
    }
    .close svg { width: 18px; height: 18px; }
    .close:hover { color: var(--sc-fg-0); background: var(--sc-bg-2); }

    /* ---- the panel: a floating card of group tiles (A1) ---- */
    .panel {
      position: absolute; top: calc(100% + var(--sc-space-2)); right: 0; z-index: 40;
      width: max(100%, min(860px, calc(100vw - 2 * var(--sc-wide-gutter, 16px)))); /* overlay-size: exception — hangs off the subheader search field */
      max-height: min(78dvh, 760px, var(--fs-panel-room, 760px)); overflow-y: auto; overscroll-behavior: contain;
      display: flex; flex-direction: column; gap: 10px;
      padding: var(--sc-space-3);
      border-radius: 24px;
      background: var(--sc-bg-1);
      border: 0;
      box-shadow: inset 0 2px 0 color-mix(in srgb, var(--sc-fg-0) 4%, transparent),
                  var(--sc-float-shadow);
      transform-origin: top center;
      animation: fs-panel-in 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .listbox { display: flex; flex-direction: column; gap: 10px; transition: opacity 0.15s ease; }
    .listbox.stale { opacity: 0.65; }
    .group {
      display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 16px; background: var(--sc-bg-0);
      animation: fs-row-in 0.28s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay: calc(var(--i, 0) * 45ms);
    }
    /* Aus deinem Bestand: green outline (r1 sa-s2-a1, r3 mk-u-own). */
    .group.own { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-success) 30%, transparent); }
    .group.own .group-head { color: color-mix(in oklab, var(--sc-success) 75%, var(--sc-fg-0)); }
    /* Fast genau, aber außerhalb: dashed (r2 t-s3/t-s5). */
    .group.outside { outline: 1px dashed color-mix(in srgb, var(--sc-accent) 45%, transparent); outline-offset: -1px; }
    .group-head {
      display: flex; align-items: center; gap: var(--sc-space-2); padding: 0 var(--sc-space-1) 4px;
      font-family: var(--sc-font-display); font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--sc-fg-2);
    }
    .count {
      padding: 0 7px; border-radius: 999px; background: var(--sc-bg-2); color: var(--sc-fg-1);
      font-family: var(--sc-font-body); font-variant-numeric: tabular-nums; letter-spacing: 0; font-size: max(0.7rem, var(--sc-fs-floor));
    }
    .why {
      margin-left: auto; font-family: var(--sc-font-body); letter-spacing: 0; text-transform: none;
      font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    button.why { border: 0; background: transparent; color: var(--sc-accent); cursor: pointer; padding: 2px 6px; border-radius: 6px; font-family: var(--sc-font-body); }
    button.why:hover { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
    .rows { display: flex; flex-direction: column; gap: 2px; }
    .rows.terms { flex-direction: row; flex-wrap: wrap; gap: var(--sc-space-2); padding: 2px 2px 4px; }

    /* ---- a row: icon · name/meta · CTA | three icons (r3 mk-u-row) ---- */
    .row { position: relative; display: flex; align-items: center; gap: var(--sc-space-2); min-height: 44px; border-radius: 10px; }
    .row::before {
      content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
      background: color-mix(in srgb, var(--sc-accent) 14%, transparent);
      opacity: 0; transition: opacity 0.16s ease;
    }
    .row:hover::before, .row.active::before { opacity: 1; }
    .hit {
      position: static; flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: var(--sc-space-3);
      min-height: 44px; padding: 3px 8px; color: inherit; text-decoration: none; border-radius: inherit;
    }
    /* The whole row is the anchor: its hit area stretches under the CTA and icons, which sit above. */
    .hit::after { content: ''; position: absolute; inset: 0; border-radius: inherit; }
    .hit:focus-visible { outline: none; }
    .hit:focus-visible::after { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    /* Leading icon: line art inline, no box, no background (r3 owner call). */
    .ico { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 28px; color: color-mix(in oklab, var(--sc-accent) 70%, var(--sc-fg-1)); }
    .ico svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
    /* Uploader outlines are top views, nose up: turned to read nose right, like the r3 mock. */
    .ico svg.sil { width: 22px; height: 40px; stroke-width: 1.4; transform: rotate(90deg); }
    .body { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
    .name { display: flex; align-items: center; gap: 6px; min-width: 0; font-weight: 600; color: var(--sc-fg-0); }
    .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ownname { font-weight: 500; color: var(--sc-fg-1); }
    .new {
      position: relative; flex: none; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%;
      background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-accent);
    }
    .new svg { width: 11px; height: 11px; fill: currentColor; stroke: none; }
    .new:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
    .abbr { margin: 0; padding: 4px 12px 0; font-size: max(0.75rem, var(--sc-fs-floor)); color: var(--sc-fg-2); display: flex; flex-wrap: wrap; gap: 0 6px; }
    .abbr b { color: var(--sc-fg-1); font-weight: 600; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0 6px; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .meta > span + span::before { content: '·'; margin-right: 6px; color: var(--sc-fg-2); }
    .meta .mine { color: color-mix(in oklab, var(--sc-success) 70%, var(--sc-fg-0)); }
    .fit { padding: 0 8px; border-radius: 999px; white-space: nowrap; }
    .meta > .fit::before { content: none; }
    .fit.ok { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-accent); }
    .fit.no { background: color-mix(in srgb, var(--sc-warning) 14%, transparent); color: var(--sc-warning); }
    .fit.unk { background: color-mix(in srgb, var(--sc-fg-0) 5%, transparent); color: var(--sc-fg-2); }
    .row.soon .ico { opacity: 0.75; }
    .rt { position: relative; z-index: 1; flex: none; display: inline-flex; align-items: center; gap: 4px; padding-right: 4px; }
    /* ONE quiet CTA: outlined, the same for every row, filled only on the focused row (B6). */
    .cta {
      display: inline-flex; align-items: center; height: 26px; padding: 0 10px; margin: 0; border: 0; border-radius: 7px;
      background: transparent; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-accent) 32%, transparent);
      color: color-mix(in oklab, var(--sc-accent) 80%, var(--sc-fg-0)); font: inherit; font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 600;
      letter-spacing: 0.01em; text-decoration: none; white-space: nowrap; cursor: pointer;
    }
    .cta:hover, .row.active .cta {
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-accent) 55%, transparent); color: var(--sc-fg-0);
    }
    .cta:disabled { opacity: 0.6; cursor: default; }
    .sep { width: 1px; height: 20px; margin: 0 4px; background: var(--sc-border); }
    /* "In den Nachschub" as the task at hand: the hint names the icon, the rows mark it. */
    .supply-hint { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--sc-accent) 50%, var(--sc-border)); border-radius: 8px; background: color-mix(in srgb, var(--sc-accent) 10%, transparent); color: var(--sc-fg-0); font-size: max(0.85rem, var(--sc-fs-floor)); }
    .supply-hint svg { flex: none; width: 18px; height: 18px; fill: none; stroke: var(--sc-accent); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
    .more-line { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 4px 8px 0; font-size: max(0.78rem, var(--sc-fs-floor)); }
    .expand { border: 0; background: transparent; color: var(--sc-accent); font: inherit; cursor: pointer; padding: 4px 6px; border-radius: 6px; }
    .expand:hover { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
    .more { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 6px; border-radius: 6px; color: var(--sc-fg-2); text-decoration: none; }
    .more:hover, .more.active { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
    /* Recent searches: soft tags, the r1 mock's square marker. */
    .term {
      display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 12px; border-radius: 10px;
      background: var(--sc-bg-2); color: var(--sc-fg-1); text-decoration: none; font-size: max(0.8rem, var(--sc-fs-floor));
    }
    .term::before { content: ''; flex: none; width: 8px; height: 8px; border-radius: 2px; background: var(--sc-accent); }
    .term:hover, .term.active { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 26%, var(--sc-bg-2)); }
    .summary, .dym {
      display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: 0; padding: 2px 6px;
      font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    .summary b { color: var(--sc-fg-1); font-weight: 600; }
    .sum-b, .dym-b { border: 0; background: transparent; color: var(--sc-fg-1); font: inherit; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
    .sum-b:hover, .dym-b:hover { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
    .sum-b .n { color: var(--sc-fg-2); }
    .dym-b { color: var(--sc-accent); font-weight: 600; }
    .sum-k { margin-left: auto; opacity: 0.8; }
    .state { margin: 0; padding: var(--sc-space-1) var(--sc-space-2); color: var(--sc-fg-2); font-size: max(0.84rem, var(--sc-fs-floor)); }
    .state.err { color: var(--sc-danger); display: flex; flex-wrap: wrap; gap: var(--sc-space-2); align-items: center; }
    .retry { padding: 4px 12px; border-radius: 8px; border: 1px solid var(--sc-danger); background: transparent; color: var(--sc-danger); cursor: pointer; font: inherit; }
    .keys {
      position: sticky; bottom: calc(-1 * var(--sc-space-3)); margin: 0 calc(-1 * var(--sc-space-3)) calc(-1 * var(--sc-space-3));
      display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sc-space-1) var(--sc-space-4);
      padding: var(--sc-space-2); border-top: 0;
      background: var(--sc-bg-1); color: var(--sc-fg-2); font-size: max(0.74rem, var(--sc-fs-floor));
    }
    .keys span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: -1px; padding: 0; }

    :host(.compact) .field { height: 40px; }

    /* Phones: the bar sits at the bottom, under the thumb; the panel is a sheet above it. */
    :host(.bottom) {
      /* Room the sheet gives up: the fixed route line at the top (banner + safe area + its own row), the bar under it. */
      --_sheet-top: calc(var(--sc-imp-banner-h, 0px) + env(safe-area-inset-top, 0px) + 56px + var(--sc-space-2));
      --_sheet-bottom: calc(var(--sc-float-bottom) + var(--sc-bar-h) + var(--sc-space-2));
    }
    :host(.bottom) .panel {
      /* Anchored to the bar, grows upward, never past the route line or the viewport (vh = fallback for dvh). */
      position: fixed; top: auto; right: var(--sc-page-gutter, 12px); left: var(--sc-page-gutter, 12px);
      bottom: var(--_sheet-bottom);
      width: auto; transform-origin: bottom center;
      max-height: calc(100vh - var(--_sheet-top) - var(--_sheet-bottom));
      max-height: calc(100dvh - var(--_sheet-top) - var(--_sheet-bottom));
      animation-name: fs-sheet-in;
    }
    /* The feedback launcher's disc sits in this row: the typed text stops before it. */
    :host(.bottom.open) .field { padding-inline-end: max(var(--sc-space-2), calc(var(--sc-fab-clear-inline) - var(--sc-page-gutter, 12px))); }
    :host(.bottom) .keys, :host(.bottom) .hint { display: none; }
    .mag { display: none; }
    :host(.bottom:not(.open)) .field { display: none; }
    :host(.bottom:not(.open)) .mag {
      display: inline-flex; align-items: center; justify-content: center; margin-left: auto;
      width: 48px; height: 48px; padding: 0; border: 0; border-radius: var(--sc-radius-sm, 4px);
      background: transparent; color: var(--sc-fg-1); cursor: pointer;
    }
    .mag svg { width: 22px; height: 22px; color: var(--sc-accent); }
    .mag:hover { color: var(--sc-fg-0); background: var(--sc-bg-2); }
    .mag:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    :host(.bottom:not(.open)) .fchip { display: none; }
    @media (pointer: coarse) {
      .hint, .keys { display: none; }
      .cta { height: 44px; }
      .more, .expand, .term, .sum-b, .dym-b, button.why { min-height: 44px; }
      .xslot, .close { width: 44px; height: 44px; }
    }
    @container (max-width: 440px) {
      .hint { display: none; }
    }
    @media (max-width: 1023px) {
      .hint { display: none; }
      :host(:not(.open)) .fchip { display: none; }
    }
    @media (max-width: 640px) {
      /* The name needs the width: CTA and icons move under it. */
      .row { flex-wrap: wrap; }
      .hit { flex-basis: 100%; }
      .rt { margin: -4px 0 4px auto; }
      .sum-k { display: none; }
    }

    @keyframes fs-panel-in { from { opacity: 0; transform: translateY(-6px) scale(0.985); } }
    @keyframes fs-sheet-in { from { opacity: 0; transform: translateY(10px); } }
    @keyframes fs-row-in { from { opacity: 0; transform: translateY(4px); } }
    @keyframes fs-chip-in { from { opacity: 0; transform: scale(0.92); } }
    @media (prefers-reduced-motion: reduce) {
      .panel, .group { animation-name: fs-fade; animation-delay: 0s; }
      .row::before { transition: opacity 0.12s linear; }
      @keyframes fs-fade { from { opacity: 0; } }
    }
  `],
})
export class FusionSearchComponent {
  readonly engine = inject(CodexSearchEngine);
  readonly codex = inject(CodexService);
  readonly auth = inject(AuthService);
  readonly actions = inject(SearchRowActionsService);
  private readonly hangar = inject(HangarService);
  private readonly ownership = inject(HqOwnershipService);
  private readonly wishlist = inject(SearchWishlistService);
  private readonly hub = inject(CodexSearchHub);
  protected readonly chrome = inject(ShellChromeService);
  private readonly router = inject(Router);
  private readonly t = inject(TranslateService);
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly actionIcons = SEARCH_ACTION_ICONS;

  /** `top` (desktop/tablet capsule) or `bottom` (phone thumb bar). */
  readonly placement = input<'top' | 'bottom'>('top');
  /** Staged search: while idle and unfocused, example searches type themselves. */
  readonly demo = input(false);
  readonly demoKeys = ['fusionBar.demo.ship', 'fusionBar.demo.patch', 'fusionBar.demo.item'] as const;
  private readonly reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** The caret sits in the field (autofocus, a click, Ctrl+K) — not the same as the panel being open. */
  readonly focused = signal(false);
  readonly demoOn = computed(
    () => this.demo() && !this.reducedMotion && !this.open() && !this.focused() && !this.engine.input() && this.chips().length === 0,
  );
  /** Tool pages: the slimmer field. */
  readonly compact = input(false);
  /** Open/closed — the bar widens the field and keeps itself shown while open. */
  readonly openChange = output<boolean>();

  readonly listboxId = 'fs-results';
  private readonly fieldRef = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly magRef = viewChild<ElementRef<HTMLButtonElement>>('mag');

  readonly open = signal(false);
  private readonly url = signal(this.router.url);
  readonly activeIndex = signal(-1);
  /** The accordion: the group shown in full, or null. */
  readonly expanded = signal<string | null>(null);
  /** A chip menu is open: the panel stays, outside presses belong to the menu. */
  readonly chipMenu = signal(false);
  readonly busyRow = signal<string | null>(null);
  readonly status = signal<RowActionResult | null>(null);
  readonly recentRows = signal<StoredRow[]>(readRecentRows(storage()));
  private readonly silhouettes = signal<ReadonlyMap<string, { viewBox: string; path: string }>>(new Map());
  private readonly freshByKind = signal<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  private readonly silRequested = new Set<string>();
  private readonly freshRequested = new Set<string>();

  readonly context = computed<SearchContext>(() => this.engine.context());
  readonly hasText = computed(() => !!this.engine.input().trim());
  readonly result = computed(() => this.engine.result());
  readonly chips = computed<SearchChip[]>(() => this.result().chips);
  /** The "gelesen als" line: only for a settled search that read something (C6). */
  readonly readingsShown = computed(() => {
    if (!this.hasText() || this.busy()) return null;
    const rd = this.engine.readings();
    return rd.aliases.length || rd.chips.length ? rd : null;
  });
  readonly didYouMean = computed(() => (this.busy() ? [] : this.result().didYouMean));
  /** The ship / item name the "passt auf" chip names (the page title when on that page). */
  readonly compatName = computed(() => {
    const c = this.chips().find((x) => x.filter.compatWith);
    return c ? this.chipLabel(c) : '';
  });

  readonly busy = computed(() => this.engine.loading() || this.engine.input().trim() !== this.engine.term().trim());

  /** The 70 hints of the empty field (i18n array, current language). */
  readonly hints = signal<SearchHint[]>([]);

  private readonly places = computed(() =>
    this.hasText() ? matchPlaces(this.engine.input(), this.context(), (p) => this.t.instant(p.labelKey)).slice(0, PLACES_SHOWN) : [],
  );

  /** The groups as drawn: own first, the outside group after the catalog, patches / gallery / pages last. */
  readonly allGroups = computed<ViewGroup[]>(() => {
    if (!this.hasText()) return this.emptyGroups();
    const res = this.result();
    const expanded = this.expanded();
    const groups = [...res.groups];
    const ownAt = groups.findIndex((g) => g.id === 'own');
    if (ownAt > 0) groups.unshift(...groups.splice(ownAt, 1));
    const out: ViewGroup[] = groups.map((g) => this.viewGroup(g, expanded === g.id));
    if (res.outside) {
      const tailAt = out.findIndex((g) => g.id === 'patch' || g.id === 'gallery');
      out.splice(tailAt === -1 ? out.length : tailAt, 0, this.viewGroup(res.outside, false));
    }
    const places = this.places();
    if (places.length) {
      out.push({
        id: 'places', labelKey: 'fusionBar.search.places', labelParams: null, count: null, reason: null, own: false, outside: false,
        options: places.map((p) => ({
          type: 'row' as const, id: `places-${p.id}`, group: 'places',
          row: { type: 'place', id: `place-${p.id}`, place: p, target: { link: p.link, queryParams: p.queryParams }, cta: null, icons: NO_ICONS },
        })),
        expandable: 0, expanded: false, more: null,
      });
    }
    return out;
  });

  /** The accordion shows the expanded group alone; the others become the summary line. */
  readonly viewGroups = computed<ViewGroup[]>(() => {
    const all = this.allGroups();
    const ex = this.expanded();
    if (!ex) return all;
    const one = all.find((g) => g.id === ex);
    return one ? [one] : all;
  });
  readonly summary = computed<ViewGroup[] | null>(() => {
    const ex = this.expanded();
    if (!ex || !this.hasText()) return null;
    const all = this.allGroups();
    return all.some((g) => g.id === ex) ? all : null;
  });

  /** Only the dashed outside group answered: the chip that kept everything out. */
  readonly outsideOnly = computed<SearchChip | null>(() => {
    const res = this.result();
    if (!this.hasText() || this.busy() || res.groups.length > 0 || !res.outside) return null;
    const key = res.outside.reason?.params?.['chip'];
    return this.chips().find((c) => c.labelKey === key) ?? this.chips().at(-1) ?? null;
  });

  /** The page registered its own list search (Codex lists, news, patches): typing filters that list. */
  readonly pageSearchOn = computed(() => !!this.chrome.pageSearch());
  readonly stripShown = computed(
    () => this.pageSearchOn() && !this.open() && !!this.engine.input().trim() && !this.engine.error(),
  );
  readonly stripTotal = computed(() => this.engine.groups().reduce((n, g) => n + g.total, 0));

  readonly options = computed<FusionOption[]>(() =>
    this.viewGroups().flatMap((g) => (g.more ? [...g.options, g.more] : g.options)),
  );
  readonly activeOption = computed<FusionOption | null>(() => this.options()[this.activeIndex()] ?? null);
  readonly activeDescendant = computed(() => {
    const o = this.activeOption();
    return o ? this.optId(o) : null;
  });

  readonly optionLabelFn = (o: SearchChipOption): string => this.t.instant(o.labelKey, this.labelParams(o.labelParams ?? null));

  private readonly hubHandle: CodexSearchBarHandle = {
    activate: (seed?: string) => this.focus(seed),
    active: this.open.asReadonly(),
  };
  private unregisterHub: (() => void) | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e instanceof NavigationEnd) {
        this.url.set(e.urlAfterRedirects);
        this.expanded.set(null);
        // A search that led somewhere is done; a still-open one (new tab) keeps its term.
        if (!this.open()) this.engine.clear();
      }
    });
    // Where the reader stands: route + HQ page + the section anchor in the URL (C1/C2).
    effect(() => {
      const ctx = searchContextOf(this.url(), this.chrome.hqPage());
      untracked(() => this.engine.setContext(ctx));
    });
    // "Leg etwas in den Nachschub" (HQ Start, Planen): this field takes it, wherever it stands.
    effect(() => {
      if (this.chrome.supplySearchRequest() > 0) untracked(() => this.focus());
    });
    // On a Codex page the bar IS the page's Codex search.
    effect(() => {
      const onCodex = this.url().startsWith('/codex');
      untracked(() => {
        if (onCodex && !this.unregisterHub) this.unregisterHub = this.hub.register(this.hubHandle);
        else if (!onCodex && this.unregisterHub) {
          this.unregisterHub();
          this.unregisterHub = null;
        }
      });
    });
    effect(() => {
      if (this.open()) untracked(() => this.fitPanel());
    });
    // Keep the active row inside the list when the results change under it.
    effect(() => {
      const n = this.options().length;
      untracked(() => {
        if (this.activeIndex() >= n) this.activeIndex.set(n ? n - 1 : -1);
      });
    });
    // The expanded group vanished (new term): back to the tiles.
    effect(() => {
      const ex = this.expanded();
      const ids = this.allGroups().map((g) => g.id);
      if (ex && !ids.includes(ex)) untracked(() => this.expanded.set(null));
    });
    // Silhouettes and "Neu in Patch" for what is on screen: one batch per new set.
    // A closed panel decorates nothing: the recently opened rows would otherwise
    // fire the build diff (about 20 paged reads for items) on every page boot.
    effect(() => {
      if (!this.open()) return;
      const rows = this.viewGroups().flatMap((g) => g.options).filter((o) => o.type === 'row').map((o) => (o as { row: ViewRow }).row);
      untracked(() => this.loadDecorations(rows));
    });
    // The hint list follows the language.
    this.t.onLangChange.pipe(takeUntilDestroyed()).subscribe(() => this.loadHints());
    this.loadHints();
    inject(DestroyRef).onDestroy(() => {
      this.unregisterHub?.();
      if (this.statusTimer) clearTimeout(this.statusTimer);
    });
  }

  private loadHints(): void {
    try {
      this.t.get('search.hints').subscribe((v: unknown) => this.hints.set(Array.isArray(v) ? (v as SearchHint[]).filter((h) => h && typeof h.t === 'string') : []));
    } catch {
      this.hints.set([]);
    }
  }

  /** Caps the dropdown panel at the room left below the field. */
  fitPanel(): void {
    const el = this.host.nativeElement as HTMLElement;
    const room = window.innerHeight - el.getBoundingClientRect().bottom - 24;
    el.style.setProperty('--fs-panel-room', `${Math.max(240, Math.round(room))}px`);
  }

  // ---- view model ----

  private viewGroup(g: SearchResultGroup, expanded: boolean): ViewGroup {
    const rows = expanded ? g.rows : g.rows.slice(0, SEARCH_ROWS_SHOWN);
    const own = g.id === 'own';
    const label = this.groupLabel(g);
    return {
      id: g.id,
      labelKey: label.key,
      labelParams: label.params,
      count: g.count ?? g.total,
      reason: g.outside ? null : this.reasonText(g),
      own,
      outside: g.outside,
      options: rows.map((row) => ({ type: 'row' as const, id: `${g.id}-${row.id}`, group: g.id, row })),
      expandable: expanded ? 0 : g.expandable,
      expanded,
      more: g.moreTarget ? { type: 'more', id: `${g.id}-more`, group: g.id, total: g.total, target: g.moreTarget, own } : null,
    };
  }

  private groupLabel(g: SearchResultGroup): { key: string; params: Record<string, string | number> | null } {
    if (g.outside) {
      const chip = g.reason?.params?.['chip'];
      const params = { ...(g.reason?.params ?? {}) };
      delete params['chip'];
      return { key: 'search.why.outside', params: { chip: typeof chip === 'string' ? this.t.instant(chip, this.labelParams(params)) : '' } };
    }
    if (g.id === 'own') return { key: 'search.group.own', params: null };
    if (g.id === 'patch') return { key: 'search.group.patch', params: null };
    if (g.id === 'gallery') return { key: 'search.group.gallery', params: null };
    if (g.id === 'mission') return { key: 'search.group.mission', params: null };
    return { key: `codex.kinds.${g.kind ?? g.id}`, params: null };
  }

  private reasonText(g: SearchResultGroup): string | null {
    const r = g.reason;
    if (!r) return null;
    return this.t.instant(r.key, this.labelParams(r.params));
  }

  /** Params whose values are i18n keys (a context label) or a kind id get translated first. */
  labelParams(params: Record<string, string | number> | null): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(params ?? {})) {
      if (k === 'kind' && typeof v === 'string') out[k] = this.t.instant(`codex.kinds.${v}`);
      else if ((k === 'ctx' || k === 'chip') && typeof v === 'string') {
        // A context / chip label key: its own params (kind, name) come along.
        const rest: Record<string, string | number> = { name: this.compatName(), ...(params ?? {}) };
        delete rest[k];
        out[k] = this.t.instant(v, this.labelParams(rest));
      }
      else out[k] = v;
    }
    return out;
  }

  private emptyGroups(): ViewGroup[] {
    const out: ViewGroup[] = [];
    const recent = this.engine.recent().slice(0, RECENT_TERMS_SHOWN);
    if (recent.length) {
      out.push({
        id: 'recent', labelKey: 'codex.search.bar.recent', labelParams: null, count: null, reason: null, own: false, outside: false,
        options: recent.map((term, i) => ({ type: 'recent' as const, id: `recent-${i}`, term, target: { link: ['/codex'], queryParams: { q: term } } })),
        expandable: 0, expanded: false, more: null,
      });
    }
    const opened = this.recentRows().slice(0, RECENT_ROWS_SHOWN);
    if (opened.length) {
      const ctx = this.context();
      const signedIn = !!this.auth.user();
      out.push({
        id: 'opened', labelKey: 'search.group.opened', labelParams: null, count: null, reason: null, own: false, outside: false,
        options: opened.map((s) => ({ type: 'row' as const, id: `opened-${s.id}`, group: 'opened', row: this.revive(s, ctx, signedIn) })),
        expandable: 0, expanded: false, more: null,
      });
    }
    return out;
  }

  /** A stored row with the CTA and icons of the page the reader stands on now. */
  private revive(s: StoredRow, ctx: SearchContext, signedIn: boolean): SearchResultRow {
    if (s.type === 'hit') {
      const cta = resolveCta(ctx, { type: 'hit', kind: s.hit.kind, classNameSlug: s.hit.classNameSlug, manufacturerCode: s.hit.manufacturerCode, ownership: null, target: s.target }, signedIn);
      return { ...s, cta, icons: resolveIcons({ type: 'hit', kind: s.hit.kind }) };
    }
    const ref = s.ownKind === 'item' ? null : (s.target.link[s.target.link.length - 1] ?? null);
    return { ...s, cta: resolveCta(ctx, { type: 'own', ownKind: s.ownKind, ownRefId: ref, kind: null }, signedIn), icons: NO_ICONS };
  }

  // ---- rows ----

  rowName(r: ViewRow): { title: string; own: string | null } {
    switch (r.type) {
      case 'hit': return { title: hitTitle(r.hit, this.engine.lang()), own: null };
      case 'own': return { title: r.title, own: r.ownName };
      case 'patch': return { title: this.t.instant('search.row.patch', { line: r.title }), own: null };
      case 'gallery': return { title: r.title, own: null };
      case 'mission': return { title: r.title, own: null };
      case 'place': return { title: this.t.instant(r.place.labelKey), own: null };
    }
  }

  /** The second line: maker · kind · size/class · concrete ownership (B3). */
  metaOf(r: ViewRow): { key?: string; params?: Record<string, string | number>; text?: string; mine?: boolean }[] {
    const out: { key?: string; params?: Record<string, string | number>; text?: string; mine?: boolean }[] = [];
    switch (r.type) {
      case 'hit': {
        const h = r.hit;
        const m = hitManufacturer(h, this.engine.lang());
        if (m) out.push({ text: m });
        out.push({ key: `codex.kinds.${h.kind}` });
        if (h.size !== null && h.size !== undefined) out.push({ key: 'codex.card.size', params: { size: h.size } });
        if (h.grade) out.push({ key: 'codex.search.bar.grade', params: { grade: h.grade } });
        const o = r.owned;
        if (o?.shipId) out.push({ key: 'search.own.ship', mine: true });
        if (o?.inLager) {
          out.push(o.lagerQty > 0 ? { key: 'search.own.qty', params: { n: o.lagerQty }, mine: true } : { key: 'search.own.lager', mine: true });
        }
        // "2 auf „Nachtfalke“" — pieces per ship with the reader's own ship name; two ships, the rest counted.
        const fitted = o?.fittedOn ?? [];
        for (const f of fitted.slice(0, FITTED_SHOWN)) out.push({ key: 'search.own.fittedOn', params: { n: f.count, name: f.name }, mine: true });
        if (fitted.length > FITTED_SHOWN) {
          const more = fitted.length - FITTED_SHOWN;
          out.push({ key: more === 1 ? 'search.own.fittedMoreOne' : 'search.own.fittedMore', params: { n: more }, mine: true });
        } else if (!fitted.length && !o?.shipId && o?.equippedOnShipId) out.push({ key: 'search.own.fitted', mine: true });
        if (o?.inSetIds.length) out.push({ key: o.inSetIds.length === 1 ? 'search.own.setsOne' : 'search.own.sets', params: { n: o.inSetIds.length }, mine: true });
        return out;
      }
      case 'own':
        switch (r.ownKind) {
          case 'ship': return [{ key: 'search.own.ship', mine: true }];
          case 'config': return [{ key: 'search.own.config', params: { ship: r.subtitle ?? r.title }, mine: true }];
          case 'set': return [{ key: 'search.own.set', mine: true }];
          case 'item':
            return [
              { key: 'search.own.qty', params: { n: r.qty ?? 1 }, mine: true },
              ...(r.subtitle ? [{ text: r.subtitle }] : []),
            ];
        }
        return out;
      case 'patch': return [{ key: 'search.row.patchMeta', params: { version: r.version } }];
      case 'gallery': return [{ key: 'search.row.galleryMeta' }, ...(r.series ? [{ text: r.series }] : [])];
      case 'mission':
        return [
          ...(r.typeName ? [{ text: r.typeName }] : [{ key: 'search.row.missionMeta' }]),
          ...(r.giver ? [{ text: r.giver }] : []),
          ...(r.location ? [{ text: r.location }] : []),
          ...(r.variants > 1 ? [{ key: 'search.row.missionVariants', params: { n: r.variants } }] : []),
        ];
      case 'place': return [{ key: 'fusionBar.search.page' }];
    }
  }

  /** An alias target as the line shows it: "repeater" → "Repeater". */
  aliasLabel(to: string): string {
    return to.replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
  }

  fitOf(r: ViewRow) {
    return r.type === 'hit' ? r.fit : null;
  }

  isSoon(r: ViewRow): boolean {
    return r.type === 'hit' && isUpcomingHit(r.hit);
  }

  hasIcons(r: ViewRow): boolean {
    return r.icons.wishlist || r.icons.lager || r.icons.nachschub;
  }

  kindIcon(r: ViewRow): readonly string[] {
    return SEARCH_KIND_ICONS[iconKindOf(r)];
  }

  silhouetteOf(r: ViewRow): { viewBox: string; path: string } | null {
    const slug = shipSlugOf(r);
    return slug ? (this.silhouettes().get(slug.toLowerCase()) ?? null) : null;
  }

  /** The patch version a hit is new in, or null. */
  newIn(r: ViewRow): string | null {
    if (r.type !== 'hit') return null;
    const set = this.freshByKind().get(r.hit.kind);
    if (!set?.has(r.hit.classNameSlug.toLowerCase())) return null;
    return this.codex.build()?.patchVersion ?? null;
  }

  private loadDecorations(rows: readonly ViewRow[]): void {
    const ships = [...new Set(rows.map(shipSlugOf).filter((s): s is string => !!s))].filter((s) => !this.silRequested.has(s.toLowerCase()));
    if (ships.length) {
      ships.forEach((s) => this.silRequested.add(s.toLowerCase()));
      void (async () => {
        try {
          const map = await this.codex.silhouettes('ship', ships);
          if (!map.size) return;
          const next = new Map(this.silhouettes());
          for (const [cls, sil] of map) next.set(cls.toLowerCase(), { viewBox: sil.viewBox, path: sil.path });
          this.silhouettes.set(next);
        } catch {
          /* the kind icon stays */
        }
      })();
    }
    const kinds = [...new Set(rows.filter((r) => r.type === 'hit').map((r) => (r as Extract<ViewRow, { type: 'hit' }>).hit.kind))]
      .filter((k) => k !== 'upcoming' && !this.freshRequested.has(k));
    for (const kind of kinds) {
      this.freshRequested.add(kind);
      void (async () => {
        try {
          const names = await this.injector.get(CodexBuildDiffService).addedClassNamesMemo(kind as CodexKind);
          if (!names.length) return;
          this.freshByKind.set(new Map(this.freshByKind()).set(kind, new Set(names.map((n) => n.toLowerCase()))));
        } catch {
          /* no Neu glyph */
        }
      })();
    }
  }

  // ---- chips ----

  chipLabel(c: SearchChip): string {
    if (c.filter.compatWith) {
      const page = c.source === 'route' ? this.chrome.crumbs()?.title : null;
      return page || humanizeClassName(c.filter.compatWith.className);
    }
    return this.t.instant(c.labelKey, this.labelParams(c.labelParams));
  }

  removeChip(c: SearchChip): void {
    this.engine.removeChip(c.id);
    this.fieldRef()?.nativeElement.focus();
  }

  pickChipValue(c: SearchChip, value: string): void {
    this.engine.setChipValue(c.id, value);
    this.fieldRef()?.nativeElement.focus();
  }

  // ---- open / close / focus ----

  focus(seed?: string): void {
    if (seed != null) this.onInput(this.engine.input() + seed);
    else this.openPanel();
    queueMicrotask(() => this.fieldRef()?.nativeElement.focus());
    if (this.placement() === 'bottom') setTimeout(() => this.fieldRef()?.nativeElement.focus());
  }

  openPanel(): void {
    if (this.open()) return;
    this.open.set(true);
    this.openChange.emit(true);
    this.engine.ensureSuggestions();
    this.engine.ensureSources();
    if (this.auth.user()) {
      void this.ownership.ensureLoaded();
      this.wishlist.ensureLoaded();
    }
  }

  close(returnFocus = false): void {
    if (!this.open()) return;
    this.open.set(false);
    this.chrome.supplySearch.set(false);
    this.activeIndex.set(-1);
    this.expanded.set(null);
    this.chipMenu.set(false);
    this.openChange.emit(false);
    const field = this.fieldRef()?.nativeElement;
    if (returnFocus && this.placement() === 'bottom') {
      setTimeout(() => this.magRef()?.nativeElement.focus({ preventScroll: true }));
    } else if (returnFocus) field?.focus({ preventScroll: true });
    else field?.blur();
  }

  openFromButton(): void {
    this.openPanel();
    setTimeout(() => this.fieldRef()?.nativeElement.focus());
  }

  onFieldPointer(ev: PointerEvent): void {
    const target = ev.target as HTMLElement;
    if (target.closest('button, a, input, sc-fusion-search-chip')) return;
    ev.preventDefault();
    this.focus();
  }

  onInput(value: string): void {
    this.engine.setInput(value);
    const page = this.chrome.pageSearch();
    page?.(value);
    this.activeIndex.set(-1);
    this.expanded.set(null);
    this.status.set(null);
    if (!page && value.trim() && !this.open()) this.openPanel();
  }

  autofocus(): boolean {
    const field = this.fieldRef()?.nativeElement;
    if (!field || this.placement() === 'bottom' || field.getClientRects().length === 0) return false;
    field.focus({ preventScroll: true });
    return document.activeElement === field;
  }

  /** The ✕ in the field: empties it and puts the caret back in, ready to type. */
  clearInput(): void {
    this.onInput('');
    this.focus();
  }

  /** A hint's example goes into the field and is searched. */
  tryHint(q: string): void {
    this.onInput(q);
    this.engine.searchFor(q);
    this.fieldRef()?.nativeElement.focus();
  }

  searchSuggestion(term: string): void {
    this.onInput(term);
    this.engine.searchFor(term);
    this.fieldRef()?.nativeElement.focus();
  }

  // ---- accordion ----

  expand(id: string): void {
    this.expanded.set(id);
    this.activeIndex.set(-1);
    queueMicrotask(() => this.fieldRef()?.nativeElement.focus());
  }

  collapse(): void {
    const was = this.expanded();
    this.expanded.set(null);
    if (was) {
      const i = this.options().findIndex((o) => o.type !== 'recent' && o.group === was);
      this.activeIndex.set(i);
    }
    queueMicrotask(() => this.fieldRef()?.nativeElement.focus());
  }

  // ---- keyboard ----

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(ev: KeyboardEvent): void {
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      if (this.open()) {
        this.close();
        return;
      }
      if (this.chrome.focusPageSearch()) return;
      if (this.chrome.stageSearch() === 'stage' && this.hub.activate()) return;
      this.focus();
      return;
    }
    if (this.open()) {
      // Esc from anywhere inside the panel (a CTA, an icon) closes it at once; the text stays (A9).
      if (ev.key === 'Escape' && !ev.defaultPrevented && !this.chipMenu() && (this.host.nativeElement as HTMLElement).contains(ev.target as Node) && ev.target !== this.fieldRef()?.nativeElement) {
        ev.preventDefault();
        this.close(true);
      }
      return;
    }
    if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !isEditableTarget(ev.target)) {
      ev.preventDefault();
      if (this.chrome.stageSearch() === 'stage' && this.hub.activate()) return;
      this.focus();
      return;
    }
    if (this.hub.hasBar() && isTypeToSearchKey(ev)) {
      ev.preventDefault();
      this.hub.activate(ev.key);
    }
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointer(ev: PointerEvent): void {
    if (!this.open()) return;
    const host = this.host.nativeElement as HTMLElement;
    const t = ev.target as Node | null;
    if (t && (host.contains(t) || (t instanceof Element && t.closest('.cdk-overlay-container')))) return;
    this.close();
  }

  onKeydown(ev: KeyboardEvent): void {
    const n = this.options().length;
    switch (ev.key) {
      case 'ArrowDown':
        if (!this.open()) this.openPanel();
        if (!n) return;
        ev.preventDefault();
        this.activeIndex.set(this.activeIndex() >= n - 1 ? 0 : this.activeIndex() + 1);
        this.scrollActive();
        return;
      case 'ArrowUp':
        if (!n) return;
        ev.preventDefault();
        this.activeIndex.set(this.activeIndex() <= 0 ? n - 1 : this.activeIndex() - 1);
        this.scrollActive();
        return;
      case 'ArrowRight': {
        // → expands the active row's group in the panel (A4); in the text it moves the caret.
        const o = this.activeOption();
        if (!o || o.type === 'recent' || this.expanded()) return;
        const g = this.allGroups().find((x) => x.id === o.group);
        if (!g || g.expandable === 0) return;
        ev.preventDefault();
        const keep = o.id;
        this.expanded.set(g.id);
        this.activeIndex.set(this.options().findIndex((x) => x.id === keep));
        this.scrollActive();
        return;
      }
      case 'ArrowLeft': {
        const el = ev.target as HTMLInputElement;
        if (!this.expanded() || (this.activeIndex() < 0 && el.selectionStart !== 0)) return;
        ev.preventDefault();
        this.collapse();
        return;
      }
      case 'Backspace': {
        // ⌫ at the start of the field removes the last chip (C5).
        const el = ev.target as HTMLInputElement;
        if (this.chips().length && el.selectionStart === 0 && el.selectionEnd === 0) {
          ev.preventDefault();
          this.engine.removeLastChip();
        }
        return;
      }
      case 'Escape':
        // A chip menu is open: leave the event to bubble, the chip closes its menu first.
        if (this.chipMenu()) return;
        // Esc closes at once; the typed text stays for the next open (A9).
        ev.preventDefault();
        ev.stopPropagation();
        if (this.expanded()) {
          this.collapse();
          return;
        }
        this.close(true);
        return;
      case 'Enter': {
        ev.preventDefault();
        if (!this.activeOption() && this.chrome.stageSearch() === 'none' && this.engine.input().trim()) {
          this.openResultsPage(this.engine.input().trim(), ev.ctrlKey || ev.metaKey);
          return;
        }
        if (this.engine.commit()) return;
        const opt = this.activeOption() ?? (this.hasText() ? (this.options()[0] ?? null) : null);
        if (!opt) return;
        this.openOption(opt, ev.ctrlKey || ev.metaKey);
        return;
      }
      default:
        return;
    }
  }

  private openResultsPage(term: string, newTab: boolean): void {
    this.engine.remember(term);
    const onBrowse = /^\/codex\/(index|upcoming)(\?|$)/.test(this.url());
    const page = this.chrome.pageSearch();
    if (onBrowse && page && !newTab) {
      page(term);
      this.close();
      return;
    }
    const ctxKind = this.context().labelParams?.['kind'];
    const best = this.engine.groups().find((g) => g.kind !== 'upcoming')?.kind;
    const kind = ctxKind || best;
    const queryParams: Record<string, string> = kind ? { kind, q: term } : { q: term };
    const target = { link: ['/codex/index'], queryParams };
    if (newTab) {
      window.open(this.href(target), '_blank', 'noopener');
      return;
    }
    void this.router.navigate(target.link, { queryParams: target.queryParams });
    this.close();
  }

  private openOption(opt: FusionOption, newTab: boolean): void {
    if (opt.type === 'recent' && !newTab) {
      this.engine.searchFor(opt.term);
      return;
    }
    this.noteOpening(opt);
    const target = opt.type === 'row' ? opt.row.target : opt.target;
    if (newTab) {
      window.open(this.href(target), '_blank', 'noopener');
      return;
    }
    void this.router.navigate(target.link, { queryParams: target.queryParams ?? undefined, ...(target.fragment ? { fragment: target.fragment } : {}) });
    this.close();
  }

  private noteOpening(opt: FusionOption): void {
    if (opt.type === 'row') {
      const r = opt.row;
      if (r.type === 'place') {
        this.engine.remember();
        return;
      }
      this.engine.noteOpened(r);
      if (r.type === 'hit' || r.type === 'own') this.recentRows.set(pushRecentRow(storage(), this.recentRows(), r));
    } else if (opt.type === 'more') this.engine.remember();
  }

  private scrollActive(): void {
    const id = this.activeDescendant();
    if (id) queueMicrotask(() => document.getElementById(id)?.scrollIntoView({ block: 'nearest' }));
  }

  optId(o: FusionOption): string {
    return `${this.listboxId}-${o.id}`;
  }

  isActive(o: FusionOption): boolean {
    return this.activeOption()?.id === o.id;
  }

  hover(o: FusionOption): void {
    const i = this.options().findIndex((x) => x.id === o.id);
    if (i !== -1) this.activeIndex.set(i);
  }

  /** Plain left click navigates through the anchor and closes; modified clicks stay the browser's. */
  onRowClick(ev: MouseEvent, o: FusionOption): void {
    this.noteOpening(o);
    if (isPlainLeftClick(ev)) this.close();
  }

  /**
   * A recent term fills the field; it never navigates (note #5). The anchor
   * carries a plain href, NOT a routerLink: RouterLink's own click listener
   * navigates regardless of `preventDefault`, which dropped the reader on the
   * Codex index. Modified clicks stay the browser's (new tab).
   */
  onTermClick(ev: MouseEvent, term: string): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.engine.searchFor(term);
    this.fieldRef()?.nativeElement.focus();
  }

  onMoreClick(ev: MouseEvent): void {
    this.engine.remember();
    if (isPlainLeftClick(ev)) this.close();
  }

  onCtaLinkClick(ev: MouseEvent, o: FusionOption): void {
    ev.stopPropagation();
    this.noteOpening(o);
    if (isPlainLeftClick(ev)) this.close();
  }

  async runCta(ev: MouseEvent, cta: SearchCta, r: ViewRow): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    if (r.type === 'place') return;
    this.busyRow.set(r.id);
    try {
      const res = await this.actions.cta(cta, r, this.rowName(r).title, this.chips(), this.auth.user() ? this.hangar.flagshipClassName() : null);
      if (cta.id === 'inSet') this.close();
      this.showStatus(res);
    } finally {
      this.busyRow.set(null);
    }
  }

  private showStatus(res: RowActionResult | null): void {
    this.status.set(res);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    if (res) this.statusTimer = setTimeout(() => this.status.set(null), 3200);
  }

  href(target: SearchTarget): string {
    return this.engine.href(target);
  }

  /** For specs and the bar: the target URL of an option. */
  urlOf(o: FusionOption): string {
    return targetUrl(o.type === 'row' ? o.row.target : o.target);
  }
}

/** The ship class whose silhouette a row can show (catalog ships and the reader's ships). */
function shipSlugOf(r: ViewRow): string | null {
  if (r.type === 'hit') return r.hit.kind === 'ship' ? r.hit.classNameSlug : null;
  if (r.type === 'own' && (r.ownKind === 'ship' || r.ownKind === 'config')) return r.classNameSlug;
  return null;
}

function iconKindOf(r: ViewRow): SearchIconKind {
  switch (r.type) {
    case 'hit': return hitIconKind(r.hit);
    case 'own': return r.ownKind === 'item' ? 'stock' : r.ownKind === 'set' ? 'set' : r.ownKind === 'config' ? 'config' : 'ship';
    case 'patch': return 'patch';
    case 'gallery': return 'gallery';
    case 'mission': return 'mission';
    case 'place': return 'page';
  }
}

function hitIconKind(h: PolySearchHit): SearchIconKind {
  const k: PolyHitKind = h.kind;
  return k in SEARCH_KIND_ICONS ? (k as SearchIconKind) : 'item';
}
