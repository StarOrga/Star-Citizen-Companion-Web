import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
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
import { CodexCategoryIconComponent } from '../../codex/codex-category-icon.component';
import { PolySearchHit, isUpcomingHit, polyHitIconKind } from '../../codex/codex-poly-search';
import { CodexSearchEngine } from '../../codex/search/codex-search-engine';
import {
  CodexSearchHub,
  CodexSearchBarHandle,
  isEditableTarget,
  isTypeToSearchKey,
} from '../../codex/search/codex-search-hub.service';
import {
  SEARCH_CATEGORY_SHORTCUTS,
  SearchTarget,
  hitManufacturer,
  hitTarget,
  hitTitle,
  indexTarget,
  pinKindOf,
  targetUrl,
} from '../../codex/search/codex-search-model';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { logWarn } from '../../core/log';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ShellChromeService } from './shell-chrome.service';
import {
  SEARCH_PLACES,
  SearchContext,
  SearchPlace,
  WeightedGroup,
  matchPlaces,
  neutralContext,
  offersCompanion,
  searchContextOf,
  weightGroups,
} from './search-context';

/** One row of the bar's result listbox — what the arrow keys walk over. */
export type FusionOption =
  | { type: 'hit'; id: string; hit: PolySearchHit; target: SearchTarget }
  | { type: 'more'; id: string; kind: string; total: number; target: SearchTarget }
  | { type: 'place'; id: string; place: SearchPlace; target: SearchTarget }
  | { type: 'recent'; id: string; term: string; target: SearchTarget }
  | { type: 'category'; id: string; labelKey: string; target: SearchTarget };

/** A rendered section of the panel. */
interface FusionSection {
  id: string;
  labelKey: string;
  count: number | null;
  countIsFloor: boolean;
  options: FusionOption[];
}

/** Route of the "Companion fragen" stub (target not decided yet — spec §5). */
export const COMPANION_ROUTE = '/companion';

/**
 * The Fusion bar's search (beta `shell`) — the subheader IS the search.
 *
 * Runs the ONE Codex search (`CodexSearchEngine`, no second index) and
 * re-weights it by the reader's context (`search-context.ts`): the context is
 * a chip inside the field, ✕ or Backspace at the start of the field drops it.
 * Ctrl+K and "/" focus it from anywhere; on a Codex page it registers with
 * `CodexSearchHub`, so the page header's search trigger and type-to-search
 * land here too.
 *
 * Results: places (app pages the index does not hold) + Codex groups, top x
 * per group with "all N", up to three quick-action icons and one button per
 * row by type, "Companion fragen" from four words on. Every row is a real
 * anchor; the field keeps focus and points at the active row
 * (aria-activedescendant).
 */
@Component({
  selector: 'sc-fusion-search',
  standalone: true,
  imports: [RouterLink, TranslatePipe, CodexCategoryIconComponent, ScTooltipDirective],
  providers: [CodexSearchEngine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.open]': 'open()',
    '[class.bottom]': "placement() === 'bottom'",
    '[class.compact]': 'compact()',
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
    <div class="field" [class.focused]="open()" (pointerdown)="onFieldPointer($event)">
      <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" />
      </svg>
      @if (context().key !== 'all' && !hideContext()) {
        <span class="ctx-chip">
          <span class="ctx-label">{{ contextLabelKey() | translate: { kind: (kindKey() | translate), name: chipName() ?? ('fusionBar.ctx.shipFallback' | translate) } }}</span>
          <button type="button" class="ctx-x" (click)="dropContext()"
                  [attr.aria-label]="'fusionBar.search.dropContext' | translate"
                  [scTooltip]="'fusionBar.search.dropContext' | translate" scTooltipTier="label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <line x1="7" y1="7" x2="17" y2="17" /><line x1="17" y1="7" x2="7" y2="17" />
            </svg>
          </button>
        </span>
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
             (focus)="openPanel()"
             (keydown)="onKeydown($event)" />
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
      <!-- One slot, always reserved: the clear ✕ from the first character (click clears AND
           refocuses), else the close ✕ while open. The field never gives it up to text. -->
      <span class="xslot">
        @if (engine.input()) {
          <button type="button" class="close clear" (click)="clearInput()"
                  [attr.aria-label]="'fusionBar.search.clear' | translate"
                  [scTooltip]="'fusionBar.search.clear' | translate" scTooltipTier="label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        } @else if (open()) {
          <button type="button" class="close" (click)="close(true)"
                  [attr.aria-label]="'codex.search.bar.close' | translate"
                  [scTooltip]="'codex.search.bar.close' | translate" scTooltipTier="label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        }
      </span>
    </div>

    @if (open()) {
      <div class="panel" [class.has-term]="!!engine.input().trim()">
        @if (companion(); as q) {
          <a class="ask" [routerLink]="companionRoute" [queryParams]="{ q }" (click)="onCompanion($event)">
            <span class="ask-mark" aria-hidden="true">✦</span>
            <span class="ask-body">
              <b>{{ 'fusionBar.search.ask' | translate }}</b>
              <span class="ask-q">„{{ q }}“</span>
            </span>
            <kbd class="ask-kbd" aria-hidden="true">{{ 'fusionBar.search.askKey' | translate }}</kbd>
          </a>
        }

        @if (engine.input().trim() && engine.error(); as err) {
          <div class="state err" role="alert">
            <span>{{ 'codex.search.bar.failed' | translate }} — {{ err | translate }}</span>
            <button type="button" class="retry" (click)="engine.retry()">{{ 'codex.error.retry' | translate }}</button>
          </div>
        }

        <div class="listbox" role="listbox" [id]="listboxId"
             [attr.aria-label]="(engine.input().trim() ? 'codex.search.bar.resultsAria' : 'codex.search.bar.suggestionsAria') | translate"
             [attr.aria-busy]="busy()" [class.stale]="busy()">
          @for (s of sections(); track s.id; let si = $index) {
            <div class="group" role="group" [style.--i]="si" [attr.aria-labelledby]="listboxId + '-h-' + s.id">
              <div class="group-head" role="presentation">
                <span [id]="listboxId + '-h-' + s.id">{{ s.labelKey | translate }}</span>
                @if (s.count !== null) { <span class="count">{{ s.count }}{{ s.countIsFloor ? '+' : '' }}</span> }
              </div>
              <div class="rows" [class.chips]="s.id === 'recent' || s.id === 'areas'">
                @for (o of s.options; track o.id) {
                  @switch (o.type) {
                    @case ('hit') {
                      <div class="row" role="presentation" [class.active]="isActive(o)" [class.upcoming]="upcoming(o.hit)">
                        <a class="hit" role="option" tabindex="-1" [id]="optId(o)" [attr.aria-selected]="isActive(o)"
                           [routerLink]="o.target.link" [queryParams]="o.target.queryParams"
                           (click)="onRowClick($event, o)" (mouseenter)="hover(o)">
                          <span class="icon" aria-hidden="true"><sc-codex-icon [kind]="iconKind(o.hit)" /></span>
                          <span class="body">
                            <span class="name">{{ title(o.hit) }}</span>
                            <span class="meta">
                              @if (mfr(o.hit); as m) { <span>{{ m }}</span> }
                              @if (o.hit.size !== null && o.hit.size !== undefined) { <span class="badge">{{ 'codex.card.size' | translate: { size: o.hit.size } }}</span> }
                              @if (o.hit.grade) { <span class="badge">{{ 'codex.search.bar.grade' | translate: { grade: o.hit.grade } }}</span> }
                              @if (upcoming(o.hit)) { <span class="badge soon">{{ 'codex.search.bar.upcomingBadge' | translate }}</span> }
                              @if (o.hit.kind === 'ship' && owns(o.hit.classNameSlug)) { <span class="badge own">{{ 'fusionBar.search.owned' | translate }}</span> }
                            </span>
                          </span>
                        </a>
                        <span class="qa">
                          @if (pinKind(o.hit); as pk) {
                            <button type="button" class="qi" [class.on]="codex.isPinned(pk, o.hit.classNameSlug)"
                                    [attr.aria-pressed]="codex.isPinned(pk, o.hit.classNameSlug)"
                                    [attr.aria-label]="'codex.search.bar.pinAria' | translate: { name: title(o.hit) }"
                                    [scTooltip]="(codex.isPinned(pk, o.hit.classNameSlug) ? 'codex.compare.pinned' : 'codex.compare.pin') | translate"
                                    scTooltipTier="label"
                                    (click)="codex.togglePin(pk, o.hit.classNameSlug)">
                              <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"
                                   [attr.fill]="codex.isPinned(pk, o.hit.classNameSlug) ? 'currentColor' : 'none'">
                                <path d="M12 3 L14.7 9.2 L21.5 9.9 L16.4 14.3 L17.9 21 L12 17.4 L6.1 21 L7.6 14.3 L2.5 9.9 L9.3 9.2 Z" />
                              </svg>
                            </button>
                          }
                          <a class="qi" [href]="href(o.target)" target="_blank" rel="noopener noreferrer"
                             [attr.aria-label]="'fusionBar.search.newTab' | translate: { name: title(o.hit) }"
                             [scTooltip]="'fusionBar.search.newTabShort' | translate" scTooltipTier="label">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                            </svg>
                          </a>
                          <button type="button" class="qi" (click)="copyLink(o)"
                                  [attr.aria-label]="'fusionBar.search.copyLink' | translate: { name: title(o.hit) }"
                                  [scTooltip]="(copied() === o.id ? 'fusionBar.search.copied' : 'fusionBar.search.copyLinkShort') | translate"
                                  scTooltipTier="label">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                            </svg>
                          </button>
                          @switch (buttonAction(o.hit)) {
                            @case ('add') {
                              <button type="button" class="act primary" (click)="addToHangar(o.hit.classNameSlug)"
                                      [disabled]="adding().has(o.hit.classNameSlug)"
                                      [attr.aria-label]="'codex.search.bar.addToHangarAria' | translate: { name: title(o.hit) }">
                                {{ 'fusionBar.search.action.add' | translate }}
                              </button>
                            }
                            @case ('hangar') {
                              <a class="act" [routerLink]="['/hq', 'hangar']" (click)="onActionClick($event)">{{ 'fusionBar.search.action.hangar' | translate }}</a>
                            }
                            @case ('index') {
                              <a class="act" [routerLink]="indexOf(o.hit).link" [queryParams]="indexOf(o.hit).queryParams"
                                 (click)="onActionClick($event)">{{ 'fusionBar.search.action.index' | translate }}</a>
                            }
                            @default {
                              <a class="act" [routerLink]="o.target.link" [queryParams]="o.target.queryParams"
                                 (click)="onRowClick($event, o)">{{ 'fusionBar.search.action.open' | translate }}</a>
                            }
                          }
                        </span>
                      </div>
                    }
                    @case ('place') {
                      <div class="row" role="presentation" [class.active]="isActive(o)">
                        <a class="hit" role="option" tabindex="-1" [id]="optId(o)" [attr.aria-selected]="isActive(o)"
                           [routerLink]="o.target.link" [queryParams]="o.target.queryParams"
                           (click)="onRowClick($event, o)" (mouseenter)="hover(o)">
                          <span class="icon place" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M12 2.5 21 12l-9 9.5L3 12Z" /><path d="M12 8v8M8 12h8" />
                            </svg>
                          </span>
                          <span class="body"><span class="name">{{ o.place.labelKey | translate }}</span>
                            <span class="meta">{{ 'fusionBar.search.page' | translate }}</span></span>
                        </a>
                        <span class="qa">
                          <a class="qi" [href]="href(o.target)" target="_blank" rel="noopener noreferrer"
                             [attr.aria-label]="'fusionBar.search.newTab' | translate: { name: (o.place.labelKey | translate) }"
                             [scTooltip]="'fusionBar.search.newTabShort' | translate" scTooltipTier="label">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                            </svg>
                          </a>
                        </span>
                      </div>
                    }
                    @case ('more') {
                      <a class="more" role="option" tabindex="-1" [id]="optId(o)" [class.active]="isActive(o)" [attr.aria-selected]="isActive(o)"
                         [routerLink]="o.target.link" [queryParams]="o.target.queryParams"
                         (click)="onRowClick($event, o)" (mouseenter)="hover(o)">
                        {{ (o.kind === 'upcoming' ? 'codex.search.bar.allUpcoming' : 'codex.search.bar.allInIndex') | translate: { n: o.total } }}
                        <span aria-hidden="true">→</span>
                      </a>
                    }
                    @default {
                      <a class="chip" role="option" tabindex="-1" [id]="optId(o)" [class.active]="isActive(o)" [attr.aria-selected]="isActive(o)"
                         [routerLink]="o.target.link" [queryParams]="o.target.queryParams"
                         (click)="onRowClick($event, o)" (mouseenter)="hover(o)">
                        @if (o.type === 'recent') { {{ o.term }} } @else if (o.type === 'category') { {{ o.labelKey | translate }} }
                      </a>
                    }
                  }
                }
              </div>
            </div>
          }
        </div>

        @if (engine.input().trim() && !engine.error() && !busy() && codexGroups().length === 0) {
          <p class="state" role="status">{{ 'codex.search.bar.empty' | translate: { term: engine.term().trim() } }}</p>
        } @else if (busy() && codexGroups().length === 0) {
          <p class="state" role="status">{{ 'codex.search.bar.searching' | translate }}</p>
        }
        @if (addFailed()) {
          <p class="state err" role="alert">{{ 'codex.card.addToHangarFailed' | translate }}</p>
        }
        <p class="sr-only" role="status" aria-live="polite">{{ copied() ? ('fusionBar.search.copied' | translate) : '' }}</p>

        <p class="keys" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> {{ 'codex.search.bar.keys.navigate' | translate }}</span>
          <span><kbd>↵</kbd> {{ 'codex.search.bar.keys.open' | translate }}</span>
          <span><kbd>{{ 'codex.search.bar.keys.ctrl' | translate }}</kbd>+<kbd>↵</kbd> {{ 'codex.search.bar.keys.newTab' | translate }}</span>
          @if (context().key !== 'all') { <span><kbd>⌫</kbd> {{ 'fusionBar.search.keys.dropContext' | translate }}</span> }
          <span><kbd>Esc</kbd> {{ 'codex.search.bar.keys.close' | translate }}</span>
        </p>
      </div>
    }
  `,
  styles: [`
    :host { position: relative; display: flex; min-width: 0; flex: 1 1 auto; }
    .field {
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
    .field.focused { box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 22%, transparent), 0 12px 40px rgba(0, 0, 0, 0.45); }
    .glyph { width: 18px; height: 18px; flex: none; color: var(--sc-accent); }
    .input {
      flex: 1 1 auto; min-width: 4ch; height: 100%; padding: 0; border: 0; outline: none; background: transparent;
      color: var(--sc-fg-0); font-family: inherit; font-size: max(0.92rem, var(--sc-fs-input, 1rem));
    }
    .input::placeholder { color: var(--sc-fg-2); opacity: 1; }
    .inwrap { position: relative; display: flex; align-items: center; flex: 1 1 auto; align-self: stretch; min-width: 0; }
    /* Basis 0: the input fills the field, never its intrinsic ~20ch past the field's edge. */
    .inwrap > .input { width: 0; }
    /* The typed demo (concept r8, 8 s loop): placeholder out at 18–22 %, back at 94–98 %;
       "Gladius" types 22–30 %, holds to 42 %; "Patch 4.10.2" 44–54 % / 66 %;
       "Laser-Repeater" 68–80 % / 95 % — steps(characters), like the mock's sty1–3. */
    .input.demoing::placeholder { color: transparent; }
    .demo {
      position: absolute; inset: 0; display: flex; align-items: center; overflow: hidden; pointer-events: none;
      font-size: max(0.92rem, var(--sc-fs-input, 1rem)); color: var(--sc-fg-0);
    }
    .demo-ph, .demo-t { position: absolute; left: 0; white-space: nowrap; }
    .demo-ph { color: var(--sc-fg-2); animation: fs-demo-ph 8s ease-out infinite; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .demo-t { clip-path: inset(0 100% 0 0); animation: 8s steps(var(--n, 10)) infinite; }
    .demo-t:nth-child(2) { animation-name: fs-demo-1; }
    .demo-t:nth-child(3) { animation-name: fs-demo-2; }
    .demo-t:nth-child(4) { animation-name: fs-demo-3; }
    @keyframes fs-demo-ph { 0%, 18% { opacity: 1; } 22%, 94% { opacity: 0; } 98%, 100% { opacity: 1; } }
    @keyframes fs-demo-1 { 0%, 22% { clip-path: inset(0 100% 0 0); } 30%, 42% { clip-path: inset(0 0 0 0); } 43%, 100% { clip-path: inset(0 100% 0 0); } }
    @keyframes fs-demo-2 { 0%, 44% { clip-path: inset(0 100% 0 0); } 54%, 66% { clip-path: inset(0 0 0 0); } 67%, 100% { clip-path: inset(0 100% 0 0); } }
    @keyframes fs-demo-3 { 0%, 68% { clip-path: inset(0 100% 0 0); } 80%, 95% { clip-path: inset(0 0 0 0); } 96%, 100% { clip-path: inset(0 100% 0 0); } }
    .input::-webkit-search-cancel-button { display: none; }
    .ctx-chip {
      flex: none; display: inline-flex; align-items: center; gap: 2px;
      height: 28px; padding: 0 2px 0 var(--sc-space-3); border-radius: 999px;
      background: color-mix(in srgb, var(--sc-accent) 16%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-accent) 40%, transparent);
      color: var(--sc-fg-0); font-size: max(0.78rem, var(--sc-fs-floor)); white-space: nowrap;
      animation: fs-chip-in 0.22s ease both;
    }
    .ctx-label { overflow: hidden; text-overflow: ellipsis; max-width: 18ch; }
    .ctx-x {
      display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
      border: 0; border-radius: 50%; background: transparent; color: var(--sc-fg-2); cursor: pointer; padding: 0;
    }
    .ctx-x svg { width: 14px; height: 14px; }
    .ctx-x:hover { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 20%, transparent); }
    .ctx-x:focus-visible, .close:focus-visible, .qi:focus-visible, .act:focus-visible, .retry:focus-visible {
      outline: 2px solid var(--sc-accent); outline-offset: 1px;
    }
    .hint { display: inline-flex; gap: var(--sc-space-1); flex: none; }
    kbd {
      display: inline-flex; align-items: center; justify-content: center; min-width: 1.6em; height: 1.6em;
      padding: 0 6px; border-radius: 6px; border: 1px solid var(--sc-border); border-bottom-width: 2px;
      background: var(--sc-bg-2); color: var(--sc-fg-1);
      font-family: var(--sc-font-mono, monospace); font-size: max(0.7rem, var(--sc-fs-floor)); line-height: 1; white-space: nowrap;
    }
    .xslot { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; }
    .close {
      flex: none; display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border: 0; border-radius: 10px; background: transparent; color: var(--sc-fg-2); cursor: pointer;
    }
    .close svg { width: 18px; height: 18px; }
    .close:hover { color: var(--sc-fg-0); background: var(--sc-bg-2); }

    /* ---- the panel: grows out of the field ---- */
    .panel {
      position: absolute; top: calc(100% + var(--sc-space-2)); right: 0; z-index: 40;
      width: max(100%, min(720px, calc(100vw - 2 * var(--sc-wide-gutter, 16px))));
      /* --fs-panel-room: the space from the field down to the viewport edge
         (fitPanel), so a field placed low on a stage page never pushes the
         panel past the fold and scrolls the page. */
      max-height: min(72dvh, 680px, var(--fs-panel-room, 680px)); overflow-y: auto; overscroll-behavior: contain;
      display: flex; flex-direction: column; gap: var(--sc-space-3);
      padding: var(--sc-space-3);
      border-radius: 20px;
      background: color-mix(in srgb, var(--sc-bg-1) 94%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 35%, var(--sc-border));
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55), var(--sc-glow);
      -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3);
      transform-origin: top right;
      animation: fs-panel-in 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    /* A light line across the panel's top edge: the "welded" seam of the mock. */
    .panel::before {
      content: ''; position: sticky; top: calc(-1 * var(--sc-space-3)); display: block; height: 2px; margin: calc(-1 * var(--sc-space-3)) var(--sc-space-5) 0;
      border-radius: 2px; background: linear-gradient(90deg, var(--sc-accent), color-mix(in oklab, var(--sc-accent) 35%, var(--sc-fg-0)), var(--sc-accent));
      flex: none;
    }
    .ask {
      display: flex; align-items: center; gap: var(--sc-space-3); min-height: 48px; padding: var(--sc-space-2) var(--sc-space-3);
      border-radius: 14px; text-decoration: none; color: var(--sc-fg-1);
      background: linear-gradient(90deg, color-mix(in srgb, var(--sc-accent) 16%, transparent), transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent);
      animation: fs-row-in 0.24s ease both;
    }
    .ask:hover, .ask:focus-visible { outline: none; border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .ask-mark { color: var(--sc-accent); font-size: 1.1rem; }
    .ask-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .ask-body b { font-family: var(--sc-font-display); letter-spacing: 0.06em; text-transform: uppercase; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-accent); }
    .ask-q { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: max(0.82rem, var(--sc-fs-floor)); }

    .listbox { display: flex; flex-direction: column; gap: var(--sc-space-3); transition: opacity 0.15s ease; }
    .listbox.stale { opacity: 0.65; }
    .group { display: flex; flex-direction: column; gap: 2px; animation: fs-row-in 0.28s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay: calc(var(--i, 0) * 45ms); }
    .group + .group { padding-top: var(--sc-space-2); border-top: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
    .group-head {
      display: flex; align-items: center; gap: var(--sc-space-2); padding: 0 var(--sc-space-2) var(--sc-space-1);
      font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--sc-fg-2);
    }
    .count {
      padding: 0 7px; border-radius: 999px; background: var(--sc-bg-2); color: var(--sc-accent);
      font-family: var(--sc-font-mono, monospace); letter-spacing: 0; font-size: max(0.68rem, var(--sc-fs-floor));
    }
    .rows { display: flex; flex-direction: column; gap: 2px; }
    .rows.chips { flex-direction: row; flex-wrap: wrap; gap: var(--sc-space-2); padding: 0 var(--sc-space-1); }
    .row { position: relative; display: flex; align-items: center; gap: var(--sc-space-1); border-radius: 12px; }
    /* The selection marker slides in instead of blinking on. */
    .row::before {
      content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
      background: color-mix(in srgb, var(--tone, var(--sc-accent)) 9%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone, var(--sc-accent)) 55%, transparent),
                  inset 3px 0 0 var(--tone, var(--sc-accent));
      opacity: 0; transform: scaleX(0.97); transform-origin: left center;
      transition: opacity 0.16s ease, transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .row:hover::before, .row.active::before { opacity: 1; transform: none; }
    .row.upcoming { --tone: var(--sc-warning); }
    .hit {
      position: relative; flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: var(--sc-space-3);
      min-height: 48px; padding: var(--sc-space-1) var(--sc-space-2); color: inherit; text-decoration: none; border-radius: inherit;
    }
    .hit:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .icon { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
      border-radius: 10px; background: color-mix(in srgb, var(--tone, var(--sc-accent)) 10%, transparent); color: var(--tone, var(--sc-accent)); }
    .icon svg { width: 18px; height: 18px; }
    .body { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
    .name { font-weight: 600; color: var(--sc-fg-0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--sc-space-2); font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .badge { padding: 0 6px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); color: var(--sc-fg-1); }
    .badge.soon { color: var(--sc-warning); border-color: color-mix(in srgb, var(--sc-warning) 40%, transparent); }
    .badge.own { color: var(--sc-accent); }
    .qa { position: relative; flex: none; display: inline-flex; align-items: center; gap: 2px; padding-right: var(--sc-space-1); }
    .qi {
      display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px;
      border: 0; border-radius: 10px; background: transparent; color: var(--sc-fg-2); cursor: pointer; padding: 0;
      opacity: 0.55; transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
    }
    .row:hover .qi, .row.active .qi, .qi:focus-visible, .qi.on { opacity: 1; }
    .qi:hover { color: var(--sc-fg-0); background: var(--sc-bg-2); }
    .qi.on { color: var(--sc-accent); }
    .qi svg { width: 17px; height: 17px; }
    .act {
      display: inline-flex; align-items: center; min-height: 34px; padding: 0 var(--sc-space-3); margin-left: var(--sc-space-1);
      border-radius: 10px; border: 1px solid var(--sc-border); background: transparent; color: var(--sc-fg-1);
      font-family: var(--sc-font-display); font-size: max(0.68rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase;
      text-decoration: none; cursor: pointer; white-space: nowrap;
    }
    .act:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .act.primary { border-color: color-mix(in srgb, var(--sc-accent) 60%, transparent); color: var(--sc-accent); }
    .act.primary:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .act:disabled { opacity: 0.5; cursor: default; }
    .more {
      align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; min-height: 36px;
      margin-left: 52px; padding: 0 var(--sc-space-3); border-radius: 10px; color: var(--sc-accent); text-decoration: none;
      font-size: max(0.8rem, var(--sc-fs-floor)); border: 1px solid transparent;
    }
    .more:hover, .more.active { border-color: color-mix(in srgb, var(--sc-accent) 60%, transparent); background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
    .chip {
      display: inline-flex; align-items: center; min-height: 34px; padding: 0 var(--sc-space-3); border-radius: 999px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-0); color: var(--sc-fg-1); text-decoration: none;
      font-size: max(0.8rem, var(--sc-fs-floor)); transition: border-color 0.15s ease, background-color 0.15s ease;
    }
    .chip:hover, .chip.active { border-color: var(--sc-accent); color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-0)); }
    .state { margin: 0; padding: var(--sc-space-1) var(--sc-space-2); color: var(--sc-fg-2); font-size: max(0.84rem, var(--sc-fs-floor)); }
    .state.err { color: var(--sc-danger); display: flex; flex-wrap: wrap; gap: var(--sc-space-2); align-items: center; }
    .retry { padding: 4px 12px; border-radius: 8px; border: 1px solid var(--sc-danger); background: transparent; color: var(--sc-danger); cursor: pointer; font: inherit; }
    .keys {
      position: sticky; bottom: calc(-1 * var(--sc-space-3)); margin: 0 calc(-1 * var(--sc-space-3)) calc(-1 * var(--sc-space-3));
      display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sc-space-1) var(--sc-space-4);
      padding: var(--sc-space-2); border-top: 1px solid var(--sc-border);
      background: color-mix(in srgb, var(--sc-bg-1) 96%, transparent); color: var(--sc-fg-2); font-size: max(0.74rem, var(--sc-fs-floor));
    }
    .keys span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: -1px; padding: 0; }

    /* Compact (tool pages): a slimmer field, same panel. */
    :host(.compact) .field { height: 40px; }

    /* Phones: the bar sits at the bottom, under the thumb. The panel becomes
       a sheet above it, from the top safe area down to the bar. */
    :host(.bottom) .panel {
      position: fixed; top: max(var(--sc-space-3), env(safe-area-inset-top, 0px)); right: var(--sc-page-gutter, 12px); left: var(--sc-page-gutter, 12px);
      bottom: calc(var(--sc-float-bottom) + var(--sc-bar-h) + var(--sc-space-2));
      width: auto; max-height: none; transform-origin: bottom center;
      animation-name: fs-sheet-in;
    }
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
    /* Under the thumb the field needs its width: the context chip shows once the search is open. */
    :host(.bottom:not(.open)) .ctx-chip { display: none; }
    @media (pointer: coarse) {
      .hint, .keys { display: none; }
      .qi { width: 44px; height: 44px; opacity: 1; }
      .act, .more, .chip { min-height: 44px; }
      .xslot { width: 44px; height: 44px; }
      .close { width: 44px; height: 44px; }
      .ctx-x { width: 36px; height: 36px; }
    }
    /* A narrow capsule: the field keeps its text, the key hint gives way (aria-keyshortcuts stays). */
    @media (max-width: 1023px) {
      .hint { display: none; }
      :host(:not(.open)) .ctx-chip { display: none; }
      .ctx-label { max-width: 12ch; }
    }
    @media (max-width: 480px) {
      /* The name needs the width: the actions move under it, the copy icon goes. */
      .row { flex-wrap: wrap; }
      .hit { flex-basis: 100%; }
      .qa { margin: -4px 0 var(--sc-space-1) auto; }
      .qa .qi:nth-last-child(2) { display: none; }
      .ctx-label { max-width: 10ch; }
    }

    @keyframes fs-panel-in { from { opacity: 0; transform: translateY(-6px) scale(0.985); } }
    @keyframes fs-sheet-in { from { opacity: 0; transform: translateY(10px); } }
    @keyframes fs-row-in { from { opacity: 0; transform: translateY(4px); } }
    @keyframes fs-chip-in { from { opacity: 0; transform: scale(0.92); } }
    @media (prefers-reduced-motion: reduce) {
      .panel, .group, .ask, .ctx-chip { animation-name: fs-fade; animation-delay: 0s; }
      .row::before { transform: none; transition: opacity 0.12s linear; }
      @keyframes fs-fade { from { opacity: 0; } }
    }
  `],
})
export class FusionSearchComponent {
  readonly engine = inject(CodexSearchEngine);
  readonly codex = inject(CodexService);
  readonly auth = inject(AuthService);
  private readonly hangar = inject(HangarService);
  private readonly ownership = inject(HqOwnershipService);
  private readonly hub = inject(CodexSearchHub);
  private readonly chrome = inject(ShellChromeService);
  private readonly router = inject(Router);
  private readonly t = inject(TranslateService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** `top` (desktop/tablet capsule) or `bottom` (phone thumb bar). */
  readonly placement = input<'top' | 'bottom'>('top');
  /** Hide the scope chip: the staged field is the search alone, and the kind switch already names the scope. */
  readonly hideContext = input(false);
  /** Staged search: while idle and unfocused, example searches type themselves. */
  readonly demo = input(false);
  readonly demoKeys = ['fusionBar.demo.ship', 'fusionBar.demo.patch', 'fusionBar.demo.item'] as const;
  private readonly reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  readonly demoOn = computed(() => this.demo() && !this.reducedMotion && !this.open() && !this.engine.input());
  /** Tool pages: the slimmer field. */
  readonly compact = input(false);
  /** Open/closed — the bar widens the field and keeps itself shown while open. */
  readonly openChange = output<boolean>();

  readonly companionRoute = [COMPANION_ROUTE];
  readonly listboxId = 'fs-results';
  private readonly fieldRef = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly magRef = viewChild<ElementRef<HTMLButtonElement>>('mag');

  readonly open = signal(false);
  private readonly url = signal(this.router.url);
  /** The reader dropped the context chip — neutral until the next navigation. */
  private readonly contextDropped = signal(false);
  readonly activeIndex = signal(-1);
  readonly adding = signal<ReadonlySet<string>>(new Set());
  readonly addFailed = signal(false);
  readonly copied = signal<string | null>(null);

  readonly context = computed<SearchContext>(() =>
    this.contextDropped() ? neutralContext() : searchContextOf(this.url()),
  );
  readonly contextLabelKey = computed(() => this.context().labelKey);
  /** i18n key of the Codex kind the chip names (index / detail contexts). */
  readonly kindKey = computed(() => {
    const kind = this.context().labelParams?.['kind'];
    return kind ? `codex.kinds.${kind}` : 'fusionBar.ctx.codex';
  });
  /** The page title the chip names on a ship page (published by the page header). */
  readonly chipName = computed(() => this.chrome.crumbs()?.title ?? null);

  readonly busy = computed(() => this.engine.loading() || this.engine.input().trim() !== this.engine.term().trim());
  readonly codexGroups = computed<WeightedGroup[]>(() =>
    weightGroups(this.engine.groups(), this.context(), (slug) => this.ownership.ownsShip(slug), (g) =>
      indexTarget(g.kind, this.engine.term()),
    ),
  );
  readonly places = computed(() =>
    matchPlaces(this.engine.input(), this.context(), (p) => this.t.instant(p.labelKey)),
  );
  readonly companion = computed(() => {
    const q = this.engine.input().trim();
    return offersCompanion(q) ? q : null;
  });

  readonly sections = computed<FusionSection[]>(() => {
    const term = this.engine.input().trim();
    if (!term) return this.suggestionSections();
    const out: FusionSection[] = [];
    const places = this.places();
    const placeSection: FusionSection | null = places.length
      ? {
          id: 'places',
          labelKey: 'fusionBar.search.places',
          count: null,
          countIsFloor: false,
          options: places.map((p) => ({
            type: 'place' as const,
            id: `place-${p.id}`,
            place: p,
            target: { link: p.link, queryParams: p.queryParams },
          })),
        }
      : null;
    if (placeSection && this.context().placesFirst) out.push(placeSection);
    for (const w of this.codexGroups()) {
      const options: FusionOption[] = w.shown.map((hit, i) => ({
        type: 'hit' as const,
        id: `${w.group.kind}-${i}`,
        hit,
        target: hitTarget(hit),
      }));
      if (w.more) options.push({ type: 'more', id: `${w.group.kind}-more`, kind: w.group.kind, total: w.group.total, target: w.more });
      out.push({
        id: w.group.kind,
        labelKey: `codex.kinds.${w.group.kind}`,
        count: w.group.count,
        countIsFloor: w.group.countIsFloor,
        options,
      });
    }
    if (placeSection && !this.context().placesFirst) out.push(placeSection);
    return out;
  });

  readonly options = computed<FusionOption[]>(() => this.sections().flatMap((s) => s.options));
  readonly activeOption = computed<FusionOption | null>(() => this.options()[this.activeIndex()] ?? null);
  readonly activeDescendant = computed(() => {
    const o = this.activeOption();
    return o ? `${this.listboxId}-${o.id}` : null;
  });

  private readonly hubHandle: CodexSearchBarHandle = {
    activate: (seed?: string) => this.focus(seed),
    active: this.open.asReadonly(),
  };
  private unregisterHub: (() => void) | null = null;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e instanceof NavigationEnd) {
        this.url.set(e.urlAfterRedirects);
        this.contextDropped.set(false);
        // A search that led somewhere is done; a still-open one (new tab) keeps its term.
        if (!this.open()) this.engine.clear();
      }
    });
    // On a Codex page the bar IS the page's Codex search: the page header's
    // trigger and type-to-search reach it through the hub.
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
    inject(DestroyRef).onDestroy(() => {
      this.unregisterHub?.();
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
    });
  }

  /** Caps the dropdown panel at the room left below the field. */
  fitPanel(): void {
    const el = this.host.nativeElement as HTMLElement;
    const room = window.innerHeight - el.getBoundingClientRect().bottom - 24;
    el.style.setProperty('--fs-panel-room', `${Math.max(240, Math.round(room))}px`);
  }

  private suggestionSections(): FusionSection[] {
    const out: FusionSection[] = [];
    const recent = this.engine.recent();
    if (recent.length) {
      out.push({
        id: 'recent',
        labelKey: 'codex.search.bar.recent',
        count: null,
        countIsFloor: false,
        options: recent.map((term, i) => ({
          type: 'recent' as const,
          id: `recent-${i}`,
          term,
          target: { link: ['/codex'], queryParams: { q: term } },
        })),
      });
    }
    const ctx = this.context();
    const boosted = placesFor(ctx);
    if (boosted.length) {
      out.push({
        id: 'here',
        labelKey: 'fusionBar.search.here',
        count: null,
        countIsFloor: false,
        options: boosted.map((p) => ({
          type: 'place' as const,
          id: `place-${p.id}`,
          place: p,
          target: { link: p.link, queryParams: p.queryParams },
        })),
      });
    }
    out.push({
      id: 'areas',
      labelKey: 'codex.search.bar.areas',
      count: null,
      countIsFloor: false,
      options: SEARCH_CATEGORY_SHORTCUTS.map((c, i) => ({
        type: 'category' as const,
        id: `cat-${i}`,
        labelKey: c.labelKey,
        target: c.target,
      })),
    });
    return out;
  }

  // ---- open / close / focus ----

  /** Focus the field (Ctrl+K, "/", the hub); `seed` starts a search with it. */
  focus(seed?: string): void {
    if (seed != null) this.onInput(this.engine.input() + seed);
    this.openPanel();
    queueMicrotask(() => this.fieldRef()?.nativeElement.focus());
    // Collapsed (phone) the field is only shown after the next render: focus again then.
    if (this.placement() === 'bottom') setTimeout(() => this.fieldRef()?.nativeElement.focus());
  }

  openPanel(): void {
    if (this.open()) return;
    this.open.set(true);
    this.openChange.emit(true);
    this.engine.ensureSuggestions();
    if (this.auth.user()) void this.ownership.ensureLoaded();
  }

  close(returnFocus = false): void {
    if (!this.open()) return;
    this.open.set(false);
    this.activeIndex.set(-1);
    this.openChange.emit(false);
    const field = this.fieldRef()?.nativeElement;
    if (returnFocus && this.placement() === 'bottom') {
      // Collapsed to the magnifier: focus goes back to it once it is shown.
      setTimeout(() => this.magRef()?.nativeElement.focus({ preventScroll: true }));
    } else if (returnFocus) field?.focus({ preventScroll: true });
    else field?.blur();
  }

  /** Phone: the magnifier opens the field and puts the caret in it (after the field is shown). */
  openFromButton(): void {
    this.openPanel();
    setTimeout(() => this.fieldRef()?.nativeElement.focus());
  }

  onFieldPointer(ev: PointerEvent): void {
    // A press anywhere on the capsule field (glyph, chip gap) focuses the input.
    const target = ev.target as HTMLElement;
    if (target.closest('button, a, input')) return;
    ev.preventDefault();
    this.focus();
  }

  onInput(value: string): void {
    this.engine.setInput(value);
    this.chrome.pageSearch()?.(value);
    this.activeIndex.set(-1);
    this.addFailed.set(false);
  }

  /** The ✕ in the field: empties it and puts the caret back in, ready to type. */
  clearInput(): void {
    this.onInput('');
    this.focus();
  }

  dropContext(): void {
    this.contextDropped.set(true);
    this.fieldRef()?.nativeElement.focus();
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
      // A page with its own search field (admin feedback) takes the chord while it is on screen.
      if (this.chrome.focusPageSearch()) return;
      // A hub stage with its own search line on screen keeps it (landing terminal).
      if (this.chrome.stageSearch() === 'stage' && this.hub.activate()) return;
      this.focus();
      return;
    }
    if (this.open()) return;
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
      case 'Backspace': {
        const el = ev.target as HTMLInputElement;
        if (this.context().key !== 'all' && el.selectionStart === 0 && el.selectionEnd === 0) {
          ev.preventDefault();
          this.dropContext();
        }
        return;
      }
      case 'Escape':
        ev.preventDefault();
        ev.stopPropagation();
        if (this.engine.input()) this.onInput('');
        else this.close(true);
        return;
      case 'Enter': {
        ev.preventDefault();
        if (ev.shiftKey && this.companion()) {
          void this.router.navigate(this.companionRoute, { queryParams: { q: this.companion() } });
          this.close();
          return;
        }
        if (this.engine.commit()) return; // results are on their way
        const opt = this.activeOption() ?? (this.engine.input().trim() ? (this.options()[0] ?? null) : null);
        if (!opt) return;
        this.openOption(opt, ev.ctrlKey || ev.metaKey);
        return;
      }
      default:
        return;
    }
  }

  private openOption(opt: FusionOption, newTab: boolean): void {
    if (opt.type === 'recent' && !newTab) {
      this.engine.searchFor(opt.term);
      return;
    }
    this.noteOpening(opt);
    if (newTab) {
      window.open(this.href(opt.target), '_blank', 'noopener');
      return;
    }
    void this.router.navigate(opt.target.link, { queryParams: opt.target.queryParams ?? undefined });
    this.close();
  }

  private noteOpening(opt: FusionOption): void {
    if (opt.type === 'hit') this.engine.opening({ type: 'hit', id: opt.id, hit: opt.hit, target: opt.target });
    else if (opt.type === 'more') this.engine.remember();
  }

  private scrollActive(): void {
    const id = this.activeDescendant();
    if (id) queueMicrotask(() => document.getElementById(id)?.scrollIntoView({ block: 'nearest' }));
  }

  // ---- rows ----

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
    if (!isPlainLeftClick(ev)) return;
    if (o.type === 'recent') {
      ev.preventDefault();
      this.engine.searchFor(o.term);
      this.fieldRef()?.nativeElement.focus();
      return;
    }
    this.close();
  }

  onActionClick(ev: MouseEvent): void {
    if (isPlainLeftClick(ev)) this.close();
  }

  onCompanion(ev: MouseEvent): void {
    if (isPlainLeftClick(ev)) this.close();
  }

  title(hit: PolySearchHit): string {
    return hitTitle(hit, this.engine.lang());
  }

  mfr(hit: PolySearchHit): string | null {
    return hitManufacturer(hit, this.engine.lang());
  }

  iconKind(hit: PolySearchHit) {
    return polyHitIconKind(hit);
  }

  upcoming(hit: PolySearchHit): boolean {
    return isUpcomingHit(hit);
  }

  pinKind(hit: PolySearchHit) {
    return pinKindOf(hit);
  }

  owns(slug: string): boolean {
    return this.ownership.ownsShip(slug);
  }

  indexOf(hit: PolySearchHit): SearchTarget {
    return indexTarget(hit.kind, this.title(hit));
  }

  /** The one button action of a row, by type. */
  buttonAction(hit: PolySearchHit): 'add' | 'hangar' | 'index' | 'open' {
    if (hit.kind === 'ship') {
      if (!this.auth.user()) return 'open';
      return this.owns(hit.classNameSlug) ? 'hangar' : 'add';
    }
    if (hit.kind === 'weapon' || hit.kind === 'component' || hit.kind === 'item' || hit.kind === 'ammunition') return 'index';
    return 'open';
  }

  href(target: SearchTarget): string {
    return this.engine.href(target);
  }

  async copyLink(o: FusionOption): Promise<void> {
    const url = `${location.origin}${this.href(o.target)}`;
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(o.id);
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(null), 1800);
    } catch (err) {
      logWarn('fusion-search', 'clipboard write failed', err);
    }
  }

  async addToHangar(slug: string): Promise<void> {
    if (this.adding().has(slug)) return;
    this.adding.update((s) => new Set(s).add(slug));
    this.addFailed.set(false);
    try {
      if (!(await this.hangar.addShip(slug, 'owned'))) this.addFailed.set(true);
    } catch {
      this.addFailed.set(true);
    } finally {
      this.adding.update((s) => {
        const next = new Set(s);
        next.delete(slug);
        return next;
      });
    }
  }

  /** For specs and the bar: the target URL of an option. */
  urlOf(o: FusionOption): string {
    return targetUrl(o.target);
  }
}

/** The places a context offers on an empty field ("Hier"). */
function placesFor(ctx: SearchContext): SearchPlace[] {
  return SEARCH_PLACES.filter((p) => p.boost.includes(ctx.key)).slice(0, 4);
}
