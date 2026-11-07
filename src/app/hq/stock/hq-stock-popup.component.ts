import { BetaService } from '../../core/beta.service';
import { DatePipe } from '@angular/common';
import { humanizeClassName } from '../../codex/codex-format';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CodexService, toLang } from '../../codex/codex.service';
import { toErrorKey } from '../../core/describe-error';
import { HangarService } from '../../hangar/hangar.service';
import { HqLink, hqHangar, ownShipLink } from '../hq-routes';
import { HqOwnershipService } from '../hq-ownership.service';
import { ItemPathService } from '../data/item-path.service';
import { PATH_ICONS } from '../../shared/item-path/path-icons';
import { ItemPathComponent } from '../../shared/item-path/item-path.component';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { OverlayFrameComponent } from '../../shared/overlay-frame/overlay-frame.component';
import { ScSelectComponent, ScSelectOption } from '../../shared/sc-select.component';
import { ScSegmentedComponent, ScSegmentOption } from '../../shared/segmented-control.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HqInventoryService, snapshotAge } from '../data/hq-inventory.service';
import { formatLocationName, lastDestroyedAt, placeLabel, readLocation } from '../now/hq-live.util';
import { HqLiveService } from '../now/hq-live.service';
import { placeOfName } from '../plan/map/hq-places';
import { StockGroup, StockSort, StockUnit, findStock, stockNames } from './hq-stock-find';
import { StockSuggestion, StockTarget, parseStockRef, stockSuggestions, stockTarget } from './hq-stock-ref';
import {
  NO_FILTER,
  STOCK_CATEGORIES,
  STOCK_PAGE,
  StockCategory,
  StockFilter,
  StockItem,
  StockView,
  filterStock,
  isPlaceFree,
  isStale,
  nextWindow,
  stockLines,
} from './hq-stock-model';

export type StockMode = 'browse' | 'find' | 'add';

/** What the page asks the popup to open with. */
export interface StockStart {
  mode: StockMode;
  filter?: Partial<StockFilter>;
}

/**
 * The stock popup: search + filter chips + result rows (the look of the app's own search), grouped
 * by place by default (place-free items as their own group), or by item with every place beneath, or
 * by amount. Rows render in steps while the list is scrolled. "Wo liegt …?" and the capture form are
 * the other two modes of the same sheet. Built on the shared overlay frame in popup mode
 * (focus trap, Escape, scrim).
 */
@Component({
  selector: 'sc-hq-stock-popup',
  standalone: true,
  imports: [TranslatePipe, DatePipe, FormsModule, RouterLink, OverlayFrameComponent, ScSegmentedComponent, ScSelectComponent, ScTooltipDirective, ScActionDirective, ItemPathComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-overlay-frame [heading]="'hq.stock.popup.title' | translate" [popup]="true" (closed)="closed.emit()">
      <div class="pop">
        <sc-segmented class="modes" [options]="modeOptions" [value]="mode()" [ariaLabel]="'hq.stock.popup.modes' | translate"
                      (valueChange)="setMode($event)" />

        @if (inv.error() && !inv.loaded()) {
          <div class="state" role="alert">
            <p>{{ inv.error()! | translate }}</p>
            <button type="button" class="sc-btn" (click)="inv.load()">{{ 'hq.stock.retry' | translate }}</button>
          </div>
        } @else if (mode() === 'browse') {
          <div class="search">
            <input name="stock-q" type="search" autocomplete="off" [value]="filter().q" [placeholder]="'hq.stock.popup.searchHint' | translate"
                   [attr.aria-label]="'hq.stock.popup.search' | translate" (input)="patch({ q: $any($event.target).value })" />
          </div>
          <div class="chips" role="group" [attr.aria-label]="'hq.stock.popup.filters' | translate">
            @for (c of cats; track c) {
              <button type="button" class="chip" [attr.aria-pressed]="filter().cat === c"
                      (click)="patch({ cat: filter().cat === c ? null : c })">{{ 'hq.stock.cat.' + c | translate }}</button>
            }
            <button type="button" class="chip" [attr.aria-pressed]="filter().stale" (click)="patch({ stale: !filter().stale })">
              {{ 'hq.stock.popup.stale' | translate }}
            </button>
            @if (storage().length) {
              <button type="button" class="chip" [attr.aria-pressed]="filter().ships" (click)="patch({ ships: !filter().ships })">
                {{ 'hq.stock.popup.ships' | translate }}
              </button>
            }
            @if (filter().place !== null) {
              <button type="button" class="chip on" aria-pressed="true" [scTooltip]="'hq.stock.popup.clearPlace' | translate" scTooltipTier="label"
                      (click)="patch({ place: null })">
                {{ filter().place!.trim() ? placeName(filter().place!) : ('hq.stock.free' | translate) }} ✕
              </button>
            } @else if (placeOptions().length) {
              <div class="place-pick">
                <sc-select [options]="placeOptions()" [value]="null" placeholderKey="hq.stock.popup.place"
                           [ariaLabel]="'hq.stock.popup.place' | translate" (valueChange)="patch({ place: $event })" />
              </div>
            }
          </div>
          <div class="bar">
            <sc-segmented [options]="viewOptions" [value]="view()" [ariaLabel]="'hq.stock.popup.viewBy' | translate"
                          (valueChange)="setView($event)" />
            <span class="count" role="status">{{ 'hq.stock.popup.count' | translate: { n: rows().length } }}</span>
          </div>

          <div class="list" tabindex="0" [attr.aria-label]="'hq.stock.popup.results' | translate" (scroll)="onScroll($event)">
            @if (!inv.loaded()) {
              <p class="muted" role="status">{{ 'hq.stock.popup.loading' | translate }}</p>
            } @else if (!showShips() && !rows().length) {
              <p class="muted" role="status">{{ (inv.items().length ? 'hq.stock.popup.noMatch' : 'hq.stock.popup.empty') | translate }}</p>
            } @else if (!filter().ships) {
              <ul>
                @for (l of visible(); track l.key) {
                  @if (l.kind === 'head') {
                    <li class="head">
                      <strong>{{ l.free ? ('hq.stock.free' | translate) : l.location !== null ? placeName(l.location) : l.title }}</strong>
                      @if (l.location !== null && !l.free) {
                        <span class="age" [class.stale]="stale(l.location)">{{ ageOf(l.location) }}</span>
                      }
                      <span class="n">{{ l.count }}</span>
                    </li>
                  } @else {
                    <li class="row">
                      <span class="nm">
                        @if (l.showName) {
                          @if (target(l.row); as t) { <a class="t entry" [routerLink]="t.commands" [queryParams]="t.queryParams">{{ l.row.name }}</a> } @else { <span class="t">{{ l.row.name }}</span> }
                        }
                        @if (l.showPlace) { <span class="place" [class.t]="!l.showName">{{ l.row.location.trim() ? placeName(l.row.location) : ('hq.stock.free' | translate) }}</span> }
                      </span>
                      @if (pathOf(l.row); as p) {
                        <!-- D4: tertiary path + "Nachholen" (A7); the row has no click handler of its own. -->
                        <span class="row-acts">
                          <sc-item-path [kind]="p.kind" [className]="p.className" [name]="l.row.name" />
                          <button scAction tier="secondary" type="button" class="again" [attr.aria-label]="'hq.stock.popup.nachholenAria' | translate: { name: l.row.name }" (click)="nachholen(l.row)">
                            <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.nachschub; track $index) { <path [attr.d]="d" /> }</svg>
                            <span>{{ 'hq.stock.popup.nachholen' | translate }}</span>
                          </button>
                        </span>
                      }
                      <span class="qty">{{ l.row.qty }} {{ unitLabel(l.row.unit) }}</span>
                    </li>
                  }
                }
              </ul>
              @if (visible().length < lines().length) {
                <p class="muted more" role="status">{{ 'hq.stock.popup.loadingMore' | translate }}</p>
              }
            }
            @if (rowError(); as key) {
              <p class="warn" role="alert">{{ key | translate }}</p>
            }
            @if (showShips()) {
              <section class="ships" aria-labelledby="hq-stock-ship-storage">
                <h3 id="hq-stock-ship-storage">{{ 'hq.stock.lager.storage' | translate }}</h3>
                <ul>
                  @for (s of storage(); track s.ref) {
                    <li class="row">
                      <span class="nm">
                        @if (s.shipId) {
                          <a class="t" [routerLink]="shipRoute(s.shipId).commands" [queryParams]="shipRoute(s.shipId).queryParams">{{ s.name }}</a>
                        } @else {
                          <span class="t">{{ s.name }}</span>
                        }
                      </span>
                      <span class="qty">
                        @if (s.destroyedAt) { <span class="lost">{{ 'hq.stock.destroyed' | translate: { at: (s.destroyedAt | date: 'short') } }}</span> · }
                        {{ s.location }} · <span class="age" [class.stale]="s.stale">{{ s.age }}</span>
                      </span>
                    </li>
                  }
                </ul>
              </section>
            }
          </div>
        } @else if (mode() === 'find') {
          <section class="find" aria-labelledby="hq-stock-find">
            <h3 id="hq-stock-find">{{ 'hq.stock.find.title' | translate }}</h3>
            <div class="row-f">
              <label class="wide">
                <span>{{ 'hq.stock.find.item' | translate }}</span>
                <input name="find-term" type="search" autocomplete="off" [placeholder]="'hq.stock.find.itemHint' | translate"
                       [value]="term()" (input)="term.set($any($event.target).value)" />
              </label>
              <label class="qty-f">
                <span>{{ 'hq.stock.find.want' | translate }}</span>
                <input name="find-want" type="number" min="0" step="any" inputmode="decimal" [value]="want() ?? ''"
                       (input)="setWant($any($event.target).valueAsNumber)" />
              </label>
              <div class="field">
                <span class="field-label">{{ 'hq.stock.find.unit' | translate }}</span>
                <sc-segmented [options]="unitOptions" [value]="findUnit()" [ariaLabel]="'hq.stock.find.unit' | translate"
                              (valueChange)="findUnit.set($event === 'scu' ? 'scu' : 'pcs')" />
              </div>
              <div class="field">
                <span class="field-label">{{ 'hq.stock.find.sort' | translate }}</span>
                <sc-segmented [options]="sortOptions" [value]="sort()" [ariaLabel]="'hq.stock.find.sort' | translate"
                              (valueChange)="sortChoice.set($event === 'nearest' ? 'nearest' : 'most')" />
              </div>
            </div>
            @if (names().length) {
              <div class="chips" role="group" [attr.aria-label]="'hq.stock.find.yours' | translate">
                <span class="field-label">{{ 'hq.stock.find.yours' | translate }}</span>
                @for (n of names(); track n) {
                  <button type="button" class="chip" [attr.aria-pressed]="n === term()" (click)="term.set(n)">{{ n }}</button>
                }
              </div>
            }
            <div class="where">
              @if (liveHere(); as place) {
                <span class="muted">{{ 'hq.stock.find.here' | translate: { place: place } }}</span>
              } @else {
                <div class="here-pick">
                  <sc-select [options]="hereOptions()" [value]="manualHere()" placeholderKey="hq.stock.find.whereAmI"
                             [ariaLabel]="'hq.stock.find.whereAmI' | translate" (valueChange)="manualHere.set($event)" />
                </div>
                @if (!hereName() && sort() === 'most') {
                  <span class="muted">{{ 'hq.stock.find.unknownHere' | translate }}</span>
                }
              }
            </div>
            <div class="found">
              @if (!term().trim()) {
                <p class="muted">{{ 'hq.stock.find.prompt' | translate }}</p>
              } @else if (!found().length) {
                <p class="muted" role="status">{{ 'hq.stock.find.noHit' | translate }}</p>
              } @else {
                @for (g of found(); track g.name) {
                  <div class="result">
                    <div class="result-head">
                      <strong>{{ g.name }}</strong>
                      <span class="sum" [class.short]="g.want > 0 && !g.covered" role="status">{{ summary(g) }}</span>
                    </div>
                    <ul class="hits">
                      @for (h of g.hits; track h.location) {
                        <li class="hit" [class.take]="h.take > 0">
                          <span class="hit-place">{{ placeName(h.location) }}</span>
                          <span class="tier">{{ 'hq.stock.find.tier.' + h.tier | translate }}</span>
                          @if (h.take > 0) {
                            <span class="take-tag">{{ 'hq.stock.find.take' | translate: { n: h.take } }}</span>
                          }
                          <span class="qty">{{ h.qty }} {{ unitLabel(g.unit) }}</span>
                        </li>
                      }
                    </ul>
                  </div>
                }
              }
            </div>
          </section>
        } @else {
          <form class="capture" (submit)="$event.preventDefault(); add()" aria-labelledby="hq-stock-capture">
            <h3 id="hq-stock-capture">{{ 'hq.stock.capture.title' | translate }}</h3>
            <div class="row-f">
              <div class="field picker">
                <label for="hq-stock-item">{{ 'hq.stock.capture.item' | translate }}</label>
                <input
                  id="hq-stock-item"
                  name="item"
                  role="combobox"
                  aria-autocomplete="list"
                  [attr.aria-expanded]="listOpen()"
                  aria-controls="hq-stock-suggest"
                  [attr.aria-activedescendant]="activeIndex() >= 0 ? 'hq-stock-opt-' + activeIndex() : null"
                  aria-describedby="hq-stock-item-msg"
                  [ngModel]="itemText()"
                  (ngModelChange)="onItemInput($event)"
                  (keydown)="onItemKey($event)"
                  (blur)="closeList()"
                  maxlength="160"
                  autocomplete="off"
                  [placeholder]="'hq.stock.capture.itemHint' | translate"
                />
                @if (listOpen()) {
                  <ul class="suggest" id="hq-stock-suggest" role="listbox" [attr.aria-label]="'hq.stock.capture.suggestions' | translate">
                    @for (o of suggestions(); track o.key; let idx = $index) {
                      <li
                        role="option"
                        [id]="'hq-stock-opt-' + idx"
                        [class.active]="idx === activeIndex()"
                        [attr.aria-selected]="idx === activeIndex()"
                        (mousedown)="$event.preventDefault(); pick(o)"
                      >
                        <span class="opt-name">{{ o.title }}</span>
                        <span class="opt-kind">{{ 'hq.stock.capture.kind.' + o.kind | translate }}</span>
                      </li>
                    }
                  </ul>
                }
                <p id="hq-stock-item-msg" class="msg" role="status">
                  @if (unknown()) {
                    {{ 'hq.stock.capture.unknown' | translate }}
                  } @else if (searchError(); as k) {
                    {{ k | translate }}
                  } @else if (picked()) {
                    {{ 'hq.stock.capture.linked' | translate }}
                  }
                </p>
              </div>
              <label class="qty-f">
                <span>{{ 'hq.stock.capture.qty' | translate }}</span>
                <input name="qty" type="number" min="0.01" step="any" inputmode="decimal" [(ngModel)]="qty" />
              </label>
              <div class="field">
                <span class="field-label">{{ 'hq.stock.capture.unit' | translate }}</span>
                <sc-segmented [options]="unitOptions" [value]="unit()" [ariaLabel]="'hq.stock.capture.unit' | translate"
                              (valueChange)="unit.set($event === 'scu' ? 'scu' : 'pcs')" />
              </div>
            </div>
            <div class="row-f">
              <label class="wide">
                <span>{{ 'hq.stock.capture.location' | translate }}</span>
                <input name="location" [(ngModel)]="location" maxlength="200" autocomplete="off" [placeholder]="'hq.stock.capture.locationHint' | translate" />
              </label>
              <button type="submit" class="sc-btn sc-btn-primary" [disabled]="!valid()">{{ 'hq.stock.capture.save' | translate }}</button>
            </div>
            @if (justAdded()) {
              <p class="ok" role="status">{{ 'hq.stock.captured' | translate }}</p>
            }
            @if (inv.error() && inv.loaded()) {
              <p class="warn" role="alert">{{ inv.error()! | translate }}</p>
            }
          </form>
        }
      </div>
    </sc-overlay-frame>
  `,
  styles: [
    `
      :host { display: contents; }
      .pop { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); height: min(70vh, 44rem); height: min(70dvh, 44rem); min-height: 0; }
      @media (max-width: 720px) { .pop { height: calc(100dvh - 5.5rem - env(safe-area-inset-bottom, 0px)); } }
      h3 { margin: 0; font: 600 1.05rem / 1.2 var(--sc-font-display); }
      .muted { color: var(--sc-fg-2); margin: 0; }
      .ok { margin: 0; color: var(--sc-accent); }
      .warn { margin: 0; color: var(--sc-warning); }
      .picker { position: relative; flex: 1 1 10rem; display: grid; gap: var(--sc-space-1, 4px); }
      .picker > label { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .msg { margin: 0; min-height: 1.2em; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .suggest { position: absolute; z-index: 5; inset-inline: 0; top: calc(100% - 1.2em); margin: 0; padding: var(--sc-space-1, 4px); list-style: none; max-height: min(18rem, 40dvh); overflow-y: auto; background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: var(--sc-radius); }
      .suggest li { display: flex; justify-content: space-between; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px); min-height: 2.75rem; align-items: center; cursor: pointer; }
      .suggest li:hover, .suggest li.active { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      .opt-name { min-width: 0; overflow-wrap: anywhere; color: var(--sc-fg-0); }
      .opt-kind { flex: none; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .entry { min-width: 0; overflow-wrap: anywhere; }
      .state { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sc-space-2, 8px); }
      .state p { margin: 0; }
      input {
        font: inherit; color: var(--sc-fg); background: var(--sc-bg-0, var(--sc-bg-1)); border: 1px solid var(--sc-border);
        border-radius: var(--sc-radius); padding: var(--sc-space-2, 8px); min-height: 2.75rem; box-sizing: border-box; width: 100%;
      }
      input:focus-visible, .chip:focus-visible, .list:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .lost { color: var(--sc-warning); }
      .chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px); }
      .chip {
        min-height: 32px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 999px;
        background: transparent; color: var(--sc-fg-1); font: inherit; cursor: pointer;
      }
      .chip:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
      .chip[aria-pressed='true'] { border-color: var(--sc-accent); color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      @media (pointer: coarse) { .chip { min-height: 44px; } }
      .place-pick { flex: 0 1 14rem; min-width: 10rem; }
      .bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sc-space-2, 8px); }
      .count { color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .list { flex: 1 1 auto; min-height: 0; overflow: auto; border-top: 1px solid var(--sc-border); overscroll-behavior: contain; }
      .list ul { list-style: none; margin: 0; padding: 0; }
      .head { display: flex; align-items: baseline; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) 0; position: sticky; top: 0; background: var(--sc-bg-1); border-bottom: 1px solid var(--sc-border); }
      .head strong { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; color: var(--sc-fg-0); }
      .head .n { color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }
      .age { color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .age.stale { color: var(--sc-warning); }
      .row { display: flex; align-items: center; justify-content: space-between; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) var(--sc-space-2, 8px); min-height: 40px; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 50%, transparent); }
      .nm { display: grid; min-width: 0; }
      .nm .t { color: var(--sc-fg-0); overflow-wrap: anywhere; }
      .nm .place { color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); overflow-wrap: anywhere; }
      .nm .place.t { color: var(--sc-fg-0); font-size: inherit; }
      .row-acts { display: inline-flex; align-items: center; gap: var(--sc-space-2, 8px); margin-inline-start: auto; flex: none; }
      .row-acts .again { min-height: max(32px, var(--sc-tap-min, 0px)); padding: 2px 10px; font-size: 0.8125rem; }
      @media (max-width: 520px) { .row { flex-wrap: wrap; } .row-acts { order: 3; width: 100%; justify-content: flex-end; margin-inline-start: 0; } }
      .qty { font-variant-numeric: tabular-nums; color: var(--sc-fg-2); text-align: end; white-space: nowrap; }
      .ships { margin-top: var(--sc-space-3, 12px); }
      .ships h3 { padding: var(--sc-space-2, 8px) 0; }
      a { color: var(--sc-accent); }
      a:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .more { padding: var(--sc-space-3, 12px) 0; text-align: center; }
      .find, .capture { display: grid; gap: var(--sc-space-3, 12px); align-content: start; overflow: auto; min-height: 0; }
      .row-f { display: flex; flex-wrap: wrap; gap: var(--sc-space-3, 12px); align-items: end; }
      label { display: grid; gap: var(--sc-space-1, 4px); flex: 1 1 10rem; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      label.qty-f { flex: 0 1 7rem; }
      label.wide { flex: 2 1 14rem; }
      .field { display: grid; gap: var(--sc-space-1, 4px); }
      .field-label { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .where { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-3, 12px); }
      .here-pick { flex: 0 1 18rem; min-width: 12rem; }
      .found { display: grid; gap: var(--sc-space-3, 12px); }
      .result { display: grid; gap: var(--sc-space-2, 8px); }
      .result-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--sc-space-2, 8px); }
      .sum { color: var(--sc-fg-1); }
      .sum.short { color: var(--sc-warning); }
      .hits { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sc-space-1, 4px); }
      .hit { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-1, 4px) var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 8px; }
      .hit.take { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .hit-place { flex: 1 1 10rem; min-width: 0; overflow-wrap: anywhere; color: var(--sc-fg-0); }
      .tier { color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .take-tag { padding: 0 8px; border: 1px solid var(--sc-accent); border-radius: 999px; color: var(--sc-accent); font-size: max(0.8rem, var(--sc-fs-floor)); }
    `,
  ],
})
export class HqStockPopupComponent implements OnInit {
  readonly start = input<StockStart>({ mode: 'browse' });
  readonly closed = output<void>();

  protected readonly inv = inject(HqInventoryService);
  private readonly live = inject(HqLiveService);
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly placeName = (n: string): string => placeLabel(n, this.translate.getCurrentLang());
  protected readonly cats: readonly StockCategory[] = STOCK_CATEGORIES;

  protected readonly modeOptions: readonly ScSegmentOption[] = [
    { value: 'browse', labelKey: 'hq.stock.popup.mode.browse' },
    { value: 'find', labelKey: 'hq.stock.popup.mode.find' },
    { value: 'add', labelKey: 'hq.stock.popup.mode.add' },
  ];
  protected readonly viewOptions: readonly ScSegmentOption[] = [
    { value: 'place', labelKey: 'hq.stock.popup.view.place' },
    { value: 'name', labelKey: 'hq.stock.popup.view.name' },
    { value: 'qty', labelKey: 'hq.stock.popup.view.qty' },
  ];
  protected readonly unitOptions: readonly ScSegmentOption[] = [
    { value: 'pcs', labelKey: 'hq.stock.capture.pcs' },
    { value: 'scu', label: 'SCU' },
  ];
  protected readonly sortOptions: readonly ScSegmentOption[] = [
    { value: 'nearest', labelKey: 'hq.stock.find.nearest' },
    { value: 'most', labelKey: 'hq.stock.find.most' },
  ];

  protected readonly mode = signal<StockMode>('browse');
  protected readonly view = signal<StockView>('place');
  protected readonly filter = signal<StockFilter>(NO_FILTER);
  private readonly limit = signal(STOCK_PAGE);
  private readonly hangar = inject(HangarService);
  private readonly injector = inject(Injector);
  private readonly shellBeta = inject(BetaService).isEnabled('shell');
  private readonly path = inject(ItemPathService);
  private readonly toast = inject(UndoToastService);
  protected readonly icons = PATH_ICONS;
  protected readonly rowError = signal<string | null>(null);

  /** The path of one Inventar row: needs a class name; ships have no Inventar stop. */
  protected pathOf(row: Pick<StockItem, 'class_name'>): { kind: string; className: string } | null {
    const ref = parseStockRef(row.class_name);
    if (!ref || ref.kind === 'ship') return null;
    // The path writes bare class names; a blueprint is recognisable by its own prefix.
    return { kind: ref.kind ?? (ref.className.startsWith('BP_') ? 'blueprint' : 'item'), className: ref.className };
  }

  /** A7 "Nachholen": the quantity goes back to Nachschub, the stock stays. */
  protected nachholen(row: StockItem): void {
    const p = this.pathOf(row);
    if (!p) return;
    const res = row.unit === 'scu'
      ? this.path.nachholen(p.kind, p.className, row.name, row.qty, 'scu')
      : this.path.nachholen(p.kind, p.className, row.name, Math.max(1, Math.round(row.qty)));
    this.rowError.set(res.ok ? null : res.key);
    const undo = res.undo;
    if (!res.ok || !undo) return;
    this.toast.offer({
      messageKey: res.key,
      messageParams: res.params,
      commit: () => undefined,
      onUndo: () => void undo().then((back) => this.rowError.set(back.ok ? null : back.key)),
    });
  }

  /** Ships with their storage place; `ref` is a hangar ship id or a class name. */
  protected readonly storage = computed(() => {
    const ships = this.hangar.ships();
    return this.inv.shipStorage().map((s) => {
      const ship = ships.find((x) => x.id === s.ship_ref) ?? ships.find((x) => x.shipClassName === s.ship_ref);
      const a = snapshotAge(s.taken_at);
      return {
        ref: s.ship_ref,
        destroyedAt: lastDestroyedAt(this.live.events(), ship?.shipClassName ?? s.ship_ref, Date.now()),
        shipId: ship?.id ?? null,
        name: ship?.customName || humanizeClassName(ship?.shipClassName ?? s.ship_ref),
        location: s.location,
        stale: a.stale,
        age: this.translate.instant(`hq.stock.age.${a.unit}`, { n: a.n }),
      };
    });
  });
  /** The ship group stands alone under its filter, otherwise at the end of the unfiltered list. */
  protected readonly showShips = computed(() => {
    if (!this.storage().length) return false;
    const f = this.filter();
    return f.ships || (!f.q.trim() && f.place === null && f.cat === null && !f.stale);
  });

  protected shipRoute(id: string): HqLink {
    const ship = this.hangar.ships().find((s) => s.id === id);
    return ship ? ownShipLink(ship, this.injector.get(HqOwnershipService).configsForShip(id), this.shellBeta()) : { commands: [hqHangar], queryParams: {} };
  }

  protected readonly places = computed(() => this.inv.snapshots().map((s) => ({ location: s.location, takenAt: s.taken_at })));
  protected readonly rows = computed(() => filterStock(this.inv.items(), this.filter(), this.places()));
  protected readonly lines = computed(() => stockLines(this.rows(), this.view()));
  protected readonly visible = computed(() => this.lines().slice(0, this.limit()));
  protected readonly placeOptions = computed<ScSelectOption[]>(() =>
    [...new Set(this.inv.items().map((i) => i.location))]
      .filter((l) => !isPlaceFree(l))
      .sort((a, b) => a.localeCompare(b))
      .map((l) => ({ value: l, labelKey: '', label: this.placeName(l) })),
  );

  constructor() {
    // A new filter or view starts the window again at the top.
    effect(() => {
      this.lines();
      untracked(() => {
        this.limit.set(STOCK_PAGE);
        const list = this.host.nativeElement.querySelector('.list');
        if (list) list.scrollTop = 0;
      });
    });
  }

  ngOnInit(): void {
    const s = this.start();
    this.mode.set(s.mode);
    this.filter.set({ ...NO_FILTER, ...s.filter });
    if (!this.inv.loaded()) void this.inv.load();
  }

  protected patch(p: Partial<StockFilter>): void {
    this.filter.update((f) => ({ ...f, ...p }));
  }

  protected setMode(v: string): void {
    this.mode.set(v === 'find' || v === 'add' ? v : 'browse');
    this.justAdded.set(false);
  }

  protected setView(v: string): void {
    this.view.set(v === 'name' || v === 'qty' ? v : 'place');
  }

  protected onScroll(ev: Event): void {
    const el = ev.target as HTMLElement;
    if (this.limit() >= this.lines().length) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160) this.limit.set(nextWindow(this.limit(), this.lines().length));
  }

  protected stale(location: string): boolean {
    const s = this.inv.snapshots().find((x) => x.location === location);
    return !!s && isStale(s.taken_at);
  }

  protected ageOf(location: string): string {
    const s = this.inv.snapshots().find((x) => x.location === location);
    if (!s) return '';
    const a = snapshotAge(s.taken_at);
    return this.translate.instant(`hq.stock.age.${a.unit}`, { n: a.n });
  }

  protected unitLabel(u: StockUnit): string {
    return u === 'scu' ? 'SCU' : this.translate.instant('hq.stock.find.pcsUnit');
  }

  // --- "Wo liegt …?" -------------------------------------------------------
  protected readonly term = signal('');
  protected readonly want = signal<number | null>(null);
  protected readonly findUnit = signal<StockUnit>('scu');
  protected readonly sortChoice = signal<StockSort | null>(null);
  protected readonly manualHere = signal<string | null>(null);

  protected readonly liveHere = computed(() => {
    const at = readLocation(this.live.state());
    return at ? formatLocationName(at.name) : null;
  });
  protected readonly hereName = computed(() => readLocation(this.live.state())?.name ?? this.manualHere());
  protected readonly sort = computed<StockSort>(() => this.sortChoice() ?? (this.hereName() ? 'nearest' : 'most'));
  protected readonly hereOptions = computed<ScSelectOption[]>(() =>
    this.inv.locations().map((l) => ({ value: l.snapshot.location, labelKey: '', label: formatLocationName(l.snapshot.location) })),
  );
  protected readonly names = computed(() => stockNames(this.inv.items(), this.term(), this.findUnit()));
  protected readonly found = computed<StockGroup[]>(() => {
    const name = this.hereName();
    return findStock(this.inv.items(), {
      term: this.term(),
      unit: this.findUnit(),
      want: this.want() ?? 0,
      here: name ? placeOfName(name, readLocation(this.live.state())?.system ?? null) : null,
      sort: this.sort(),
    });
  });

  protected setWant(n: number): void {
    this.want.set(Number.isFinite(n) && n > 0 ? n : null);
  }

  protected summary(g: StockGroup): string {
    const p = { want: g.want, total: g.total, stops: g.stops, unit: this.unitLabel(g.unit) };
    if (g.want <= 0) return this.translate.instant('hq.stock.find.summaryTotal', p);
    if (!g.covered) return this.translate.instant('hq.stock.find.summaryShort', p);
    return this.translate.instant(g.stops === 1 ? 'hq.stock.find.summaryOne' : 'hq.stock.find.summaryMany', p);
  }

  // --- capture -------------------------------------------------------------
  /** Picker state: the typed text, the Codex suggestions for it, and the one the reader chose. */
  protected readonly itemText = signal('');
  readonly suggestions = signal<StockSuggestion[]>([]);
  protected readonly picked = signal<StockSuggestion | null>(null);
  protected readonly activeIndex = signal(-1);
  private readonly listWanted = signal(false);
  protected readonly searchError = signal<string | null>(null);
  /** The term the suggestions answer; null while a search is pending. */
  private readonly answeredFor = signal<string | null>(null);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;
  private readonly codex = inject(CodexService);
  protected readonly listOpen = computed(() => this.listWanted() && this.suggestions().length > 0);
  /** Text typed, searched, and nothing in the Codex matches it. */
  protected readonly unknown = computed(() => {
    const t = this.itemText().trim();
    return !!t && !this.picked() && this.answeredFor() === t && this.suggestions().length === 0 && !this.searchError();
  });
  protected qty: number | null = 1;
  location = '';
  protected readonly unit = signal<'pcs' | 'scu'>('pcs');
  protected readonly justAdded = signal(false);

  /** Owned ships only: a ship entry leads to the reader's own copy when there is one. */
  private readonly ownedShips = computed(() => this.hangar.ships().filter((s) => s.status === 'owned'));

  protected target(i: Pick<StockItem, 'name' | 'class_name'>): StockTarget | null {
    return stockTarget(i.name, i.class_name, this.ownedShips(), this.shellBeta());
  }

  protected onItemInput(v: string): void {
    this.itemText.set(v);
    this.searchError.set(null);
    this.justAdded.set(false);
    const t = v.trim();
    const p = this.picked();
    if (p && p.title !== t) this.picked.set(null);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchSeq++;
    if (!t) {
      this.suggestions.set([]);
      this.answeredFor.set(null);
      this.listWanted.set(false);
      return;
    }
    if (p && p.title === t) return;
    this.answeredFor.set(null);
    this.listWanted.set(true);
    const seq = this.searchSeq;
    this.searchTimer = setTimeout(() => void this.runSearch(t, seq), 220);
  }

  private async runSearch(t: string, seq: number): Promise<void> {
    try {
      const res = await this.codex.searchAll(t, 30);
      if (seq !== this.searchSeq) return;
      const lang = toLang(this.translate.getCurrentLang() ?? this.translate.getFallbackLang());
      const out = stockSuggestions(res.hits, t, lang);
      this.suggestions.set(out);
      this.activeIndex.set(-1);
      // An exact name typed in full is the entry: no click needed.
      const exact = out.find((o) => o.title.toLowerCase() === t.toLowerCase());
      if (exact) this.picked.set(exact);
      this.answeredFor.set(t);
    } catch (err) {
      if (seq !== this.searchSeq) return;
      this.suggestions.set([]);
      this.searchError.set(toErrorKey('hq', 'stock.search', err));
    }
  }

  pick(o: StockSuggestion): void {
    this.searchSeq++;
    this.picked.set(o);
    this.itemText.set(o.title);
    this.answeredFor.set(o.title);
    this.listWanted.set(false);
    this.activeIndex.set(-1);
  }

  protected closeList(): void {
    this.listWanted.set(false);
  }

  protected onItemKey(e: KeyboardEvent): void {
    const n = this.suggestions().length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      this.listWanted.set(true);
      this.activeIndex.set((this.activeIndex() + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      this.listWanted.set(true);
      this.activeIndex.set((this.activeIndex() - 1 + n) % n);
    } else if (e.key === 'Enter' && this.listOpen() && this.activeIndex() >= 0) {
      e.preventDefault();
      this.pick(this.suggestions()[this.activeIndex()]);
    } else if (e.key === 'Escape' && this.listWanted()) {
      // The list closes first; only the next Escape closes the sheet.
      e.preventDefault();
      e.stopPropagation();
      this.listWanted.set(false);
    }
  }

  valid(): boolean {
    const p = this.picked();
    return !!p && p.title === this.itemText().trim() && !!this.location.trim() && Number(this.qty) > 0;
  }

  async add(): Promise<void> {
    const p = this.picked();
    if (!this.valid() || !p) return;
    const ok = await this.inv.addManual(this.location, p.title, Number(this.qty), this.unit(), p.key);
    if (ok) {
      this.itemText.set('');
      this.picked.set(null);
      this.suggestions.set([]);
      this.answeredFor.set(null);
      this.qty = 1;
      this.justAdded.set(true);
    }
  }
}
