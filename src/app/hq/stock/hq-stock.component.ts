import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { humanizeClassName } from '../../codex/codex-format';
import { HangarService } from '../../hangar/hangar.service';
import { flagshipFirst } from '../../hangar/flagship-first';
import type { HangarShip } from '../../hangar/hangar.types';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HqInventoryService } from '../data/hq-inventory.service';
import { WishlistStore } from '../data/wishlist.store';
import { HqOwnershipService } from '../hq-ownership.service';
import {
  HQ_STOCK_CAT_PARAM,
  HQ_STOCK_FOCUS_PARAM,
  HQ_STOCK_TAB_PARAM,
  type HqLink,
  type HqStockTab,
  hqStockTabOf,
  ownShipLink,
} from '../hq-routes';
import { NachschubEdgeService } from '../nachschub/nachschub-edge.service';
import { BLUEPRINT_PLACE } from '../nachschub/sammlung.model';
import { SammlungService } from '../nachschub/sammlung.service';
import { NachschubService } from '../nachschub/nachschub.service';
import { HqLiveService } from '../now/hq-live.service';
import { lastDestroyedAt, placeLabel } from '../now/hq-live.util';
import { BetaService } from '../../core/beta.service';
import { STOCK_CATEGORIES, type StockCategory } from './hq-stock-model';
import { HqStockPopupComponent, StockStart } from './hq-stock-popup.component';
import { HqStockSharedComponent } from './hq-stock-shared.component';
import { WISH_CART_ICON, type StockWishTarget, StockWishService } from './hq-stock-wish';
import { type InvTile, type UsedUp, buildTiles, categoryCounts, filterTiles, pageOf, usedUpRecently } from './hq-stock-tiles';

const TILE_W = 172;
const TILE_H = 104;
const GAP = 10;
/** Shown by name in the "Kürzlich aufgebraucht" summary before it folds into "+n". */
const USED_NAMES = 3;
/** Rows of tiles per page where the page may scroll (phones and tablets). */
const PHONE_ROWS = 8;

type Cell =
  | { kind: 'add' }
  | { kind: 'item'; tile: InvTile }
  | { kind: 'ship'; ship: HangarShip }
  | { kind: 'bp'; id: string; name: string };

/**
 * HQ page "Bestand" (round 4, s6/s7): Inventar · Hangar · Sammlung as tabs, each a page of tiles that never scrolls the
 * page - the grid pages itself to what fits. Inventar opens with a "+" tile (manual entry), a summarised "Kürzlich
 * aufgebraucht" strip (48 h) and a quiet hint per tile (wishlist count / Nachschub) with "Nachholen" (= onto the wishlist).
 * The filter and the focused item arrive from the quick access and the search as a deep link (`hqStockLink`).
 */
@Component({
  selector: 'sc-hq-stock',
  standalone: true,
  imports: [TranslatePipe, DatePipe, ScDatePipe, NgTemplateOutlet, FormsModule, RouterLink, ScActionDirective, ScTooltipDirective, HqStockPopupComponent, HqStockSharedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h2 class="page-title" id="hq-stock-title">{{ 'hq.bestand.title' | translate }}</h2>
      <nav class="tabs" [attr.aria-label]="'hq.bestand.tabsAria' | translate">
        @for (t of tabs; track t.id) {
          <button type="button" class="tab" [attr.aria-pressed]="tab() === t.id" [attr.aria-current]="tab() === t.id ? 'page' : null" (click)="setTab(t.id)">
            {{ 'hq.bestand.tab.' + t.id | translate }}<small>{{ t.count() }}</small>
          </button>
        }
      </nav>
      @if (tab() === 'inventar') {
        <label class="search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
          <input type="search" [ngModel]="q()" (ngModelChange)="q.set($event); page.set(0)" [placeholder]="'hq.bestand.search' | translate" [attr.aria-label]="'hq.bestand.search' | translate" />
        </label>
      }
      <span class="head-r">
        <span class="menu-wrap">
          <button type="button" scAction tier="tertiary" aria-haspopup="menu" [attr.aria-expanded]="menuOpen()" [attr.aria-label]="'hq.bestand.menu' | translate"
                  [scTooltip]="'hq.bestand.menu' | translate" scTooltipTier="label" (click)="menuOpen.set(!menuOpen())">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="18.5" r="1.4" /></svg>
          </button>
          @if (menuOpen()) {
            <ul class="menu" role="menu" (keydown.escape)="menuOpen.set(false)">
              <li role="none"><button type="button" role="menuitem" class="danger" (click)="resetIngame()">{{ 'hq.bestand.reset' | translate }}</button></li>
            </ul>
          }
        </span>
      </span>
    </header>

    @if (inv.error() && !inv.loaded()) {
      <div class="state" role="alert">
        <p>{{ inv.error()! | translate }}</p>
        <button type="button" scAction tier="secondary" (click)="inv.load()">{{ 'hq.stock.retry' | translate }}</button>
      </div>
    } @else {
      @if (errorKey(); as e) { <p class="err" role="alert">{{ e | translate }}</p> }

      @if (tab() === 'inventar') {
        <div class="toolbar">
          <div class="chips" role="group" [attr.aria-label]="'hq.bestand.filter' | translate">
            <button type="button" class="chip" [attr.aria-pressed]="cat() === null" (click)="setCat(null)">{{ 'hq.bestand.all' | translate }}<b>{{ allTiles().length }}</b></button>
            @for (c of cats; track c) {
              @if (catCount().get(c); as n) {
                <button type="button" class="chip" [attr.aria-pressed]="cat() === c" (click)="setCat(c)">{{ 'hq.stock.cat.' + c | translate }}<b>{{ n }}</b></button>
              }
            }
          </div>
          @if (used().length) {
            <div class="used-wrap">
              <button type="button" class="used" [attr.aria-expanded]="usedOpen()" (click)="usedOpen.set(!usedOpen())">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v5l3 2" /><circle cx="12" cy="12" r="8.5" /></svg>
                <span class="u-l">{{ 'hq.bestand.used' | translate }}</span>
                <span class="u-t">{{ usedSummary() }}</span>
                <small>{{ 'hq.bestand.used48' | translate }}</small>
              </button>
              @if (usedOpen()) {
                <div class="used-pop" role="group" [attr.aria-label]="'hq.bestand.used' | translate">
                  <ul>
                    @for (u of used(); track u.key) {
                      <li>
                        <span class="nm">{{ usedQty(u) }} {{ u.name }}</span>
                        <small>{{ u.at | scDate: 'datetime' }}</small>
                        <button type="button" scAction tier="secondary" (click)="catchUp([u])">{{ 'hq.bestand.catchUp' | translate }}</button>
                      </li>
                    }
                  </ul>
                  @if (used().length > 1) {
                    <button type="button" scAction tier="secondary" (click)="catchUp(used())">{{ 'hq.bestand.catchUpAll' | translate }}</button>
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      <div #grid class="grid" [class.paged]="true" [attr.aria-label]="'hq.bestand.tab.' + tab() | translate" role="list">
        @for (c of pageCells(); track cellKey(c)) {
          @if (c.kind === 'add') {
              <button type="button" class="tile add" role="listitem" [attr.aria-label]="addLabel() | translate" (click)="add()">
                <span class="plus"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span>
                <span class="add-t">{{ addLabel() | translate }}</span>
              </button>
          } @else if (c.kind === 'item') {
              <div class="tile item" role="listitem" [class.focus]="focusKey() === c.tile.key">
                <b class="nm" [scTooltip]="c.tile.name" scTooltipTier="label">{{ c.tile.name }}</b>
                <span class="qty mono">{{ qtyText(c.tile) }}</span>
                <small class="where">{{ placeText(c.tile) }}</small>
                @if (tileTarget(c.tile); as tg) { <ng-container *ngTemplateOutlet="wishRow; context: { $implicit: tg }" /> }
              </div>
          } @else if (c.kind === 'ship') {
              <div class="tile item ship" role="listitem" [class.focus]="focusKey() === c.ship.shipClassName.toLowerCase()">
                <a class="nm tile-link" [routerLink]="shipLink(c.ship).commands" [queryParams]="shipLink(c.ship).queryParams">{{ c.ship.customName || shipTitle(c.ship.shipClassName) }}</a>
                <span class="qty mono">×{{ c.ship.qty ?? 1 }}</span>
                <small class="where">
                  @if (c.ship.origin) { {{ 'hq.bestand.origin.' + c.ship.origin | translate }} }
                  @if (hangar.isFlagship(c.ship.shipClassName)) { · {{ 'hangar.flagship.mark' | translate }} }
                  @if (destroyedAt(c.ship.shipClassName); as at) { · {{ 'hq.stock.destroyed' | translate: { at: (at | date: 'short') } }} }
                </small>
                <ng-container *ngTemplateOutlet="wishRow; context: { $implicit: shipTarget(c.ship) }" />
              </div>
          } @else if (c.kind === 'bp') {
              <div class="tile item bp" role="listitem" [class.focus]="focusKey() === c.id.toLowerCase()">
                <a class="nm tile-link" [routerLink]="['/codex/blueprint', c.id]">{{ c.name }}</a>
                <small class="where">{{ 'hq.bestand.blueprint' | translate }}</small>
                <ng-container *ngTemplateOutlet="wishRow; context: { $implicit: blueprintTarget(c) }" />
              </div>
          }
        }
      </div>

      <ng-template #wishRow let-tg>
        <span class="hint">
          @if (hint(tg); as h) { <span>{{ h.key | translate: h.params }}</span> }
          <button type="button" scAction tier="tertiary" class="nach" [attr.aria-label]="'hq.bestand.catchUpOne' | translate: { name: tg.name }"
                  [scTooltip]="'hq.bestand.catchUpOne' | translate: { name: tg.name }" scTooltipTier="label" (click)="wishTarget(tg)">
            <svg viewBox="0 0 24 24" aria-hidden="true">@for (d of cartIcon; track $index) { <path [attr.d]="d" /> }</svg>
          </button>
        </span>
      </ng-template>

      @if (tab() === 'sammlung') {
        <section class="ruf panel" aria-labelledby="ruf-h" data-ruf>
          <h3 id="ruf-h">{{ 'hq.bestand.ruf' | translate }}</h3>
          <div class="empty">
            <span class="ring" aria-hidden="true"></span>
            <b>{{ 'hq.bestand.rufEmptyTitle' | translate }}</b>
            <small>{{ 'hq.bestand.rufEmptyText' | translate }}</small>
          </div>
        </section>
      }

      <footer class="foot">
        <span class="ticker-room" aria-hidden="true"></span>
        <sc-hq-stock-shared class="shared-slot" />
        <span class="pager" role="group" [attr.aria-label]="'hq.bestand.pager' | translate">
          <span class="pg" role="status">{{ 'hq.bestand.range' | translate: { from: shown().from, to: shown().to, total: total() } }}</span>
          <button type="button" scAction tier="tertiary" [disabled]="view().page <= 0" [attr.aria-label]="'hq.bestand.prev' | translate" [scTooltip]="'hq.bestand.prev' | translate" scTooltipTier="label" (click)="page.set(view().page - 1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" /></svg>
          </button>
          <button type="button" scAction tier="tertiary" [disabled]="view().page >= view().pages - 1" [attr.aria-label]="'hq.bestand.next' | translate" [scTooltip]="'hq.bestand.next' | translate" scTooltipTier="label" (click)="page.set(view().page + 1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" /></svg>
          </button>
        </span>
      </footer>
    }

    @if (popup(); as start) {
      <sc-hq-stock-popup [start]="start" (closed)="popup.set(null)" />
    }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); height: var(--hq-page-h, auto); min-height: 0; container-type: inline-size; }
      .head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-3, 12px); flex: none; }
      .page-title { margin: 0; font: 600 1.6rem / 1.2 var(--sc-font-display); }
      .tabs { display: inline-flex; padding: 3px; border: 1px solid var(--sc-border); border-radius: 999px; background: var(--sc-bg-0); }
      .tab { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 var(--sc-space-4, 16px); border: 0; border-radius: 999px; background: transparent; color: var(--sc-fg-2); font: inherit; cursor: pointer; }
      .tab small { color: var(--sc-fg-2); font-size: 0.75rem; }
      .tab:hover { color: var(--sc-fg); }
      .tab[aria-pressed='true'] { color: var(--sc-fg); background: color-mix(in srgb, var(--sc-accent) 22%, transparent); box-shadow: 0 0 0 1px var(--sc-accent), 0 0 12px color-mix(in srgb, var(--sc-accent) 40%, transparent); }
      .tab:focus-visible, .chip:focus-visible, .used:focus-visible, .tile:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .search { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 999px; background: var(--sc-bg-0); color: var(--sc-fg-2); }
      .search svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
      .search input { width: 14ch; border: 0; outline: none; background: transparent; color: var(--sc-fg); font: inherit; }
      .search:focus-within { border-color: var(--sc-accent); }
      .head-r { margin-left: auto; display: inline-flex; align-items: center; gap: var(--sc-space-2, 8px); }
      .menu-wrap { position: relative; }
      .menu-wrap svg, .foot svg { width: 18px; height: 18px; fill: currentColor; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .foot svg { fill: none; }
      .menu { position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; min-width: 240px; margin: 0; padding: 6px; list-style: none; border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-1); box-shadow: 0 12px 32px rgb(0 0 0 / 0.5); }
      .menu button { width: 100%; min-height: 36px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--sc-fg); font: inherit; text-align: start; cursor: pointer; }
      .menu button:hover { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .menu button.danger { color: var(--sc-danger); }
      .menu button:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      .muted { color: var(--sc-fg-2); margin: 0; }
      .err { margin: 0; color: var(--sc-warning); }
      .state { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sc-space-2, 8px); }
      .state p { margin: 0; }
      .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-3, 12px); flex: none; position: relative; }
      .chips { display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); }
      .chip { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 999px; background: transparent; color: var(--sc-fg-1); font: inherit; font-size: 0.85rem; cursor: pointer; }
      .chip b { color: var(--sc-fg-2); font-variant-numeric: tabular-nums; font-weight: 500; }
      .chip:hover { border-color: var(--sc-accent); }
      .chip[aria-pressed='true'] { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-fg-0); }
      .used-wrap { position: relative; margin-left: auto; min-width: 0; max-width: 100%; }
      .used { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; min-height: 32px; padding: 0 var(--sc-space-3, 12px); border: 1px solid color-mix(in srgb, var(--sc-warning) 45%, var(--sc-border)); border-radius: 999px; background: color-mix(in srgb, var(--sc-warning) 7%, transparent); color: var(--sc-fg-1); font: inherit; font-size: 0.82rem; cursor: pointer; }
      .used svg { width: 16px; height: 16px; flex: none; fill: none; stroke: var(--sc-warning); stroke-width: 1.8; stroke-linecap: round; }
      .u-l { color: var(--sc-fg-2); white-space: nowrap; }
      .u-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--sc-fg-0); }
      .used small { color: var(--sc-fg-2); white-space: nowrap; }
      .used-pop { position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; width: min(420px, 90vw); display: grid; gap: var(--sc-space-2, 8px); padding: var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-1); box-shadow: 0 12px 32px rgb(0 0 0 / 0.5); }
      .used-pop ul { list-style: none; margin: 0; padding: 0; max-height: 15rem; overflow-y: auto; display: grid; gap: 4px; }
      .used-pop li { display: flex; align-items: center; gap: var(--sc-space-2, 8px); padding: 2px 0; }
      .used-pop .nm { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .used-pop small { color: var(--sc-fg-2); white-space: nowrap; }
      .grid { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(172px, 1fr)); grid-auto-rows: 104px; gap: 10px; align-content: start; overflow: hidden; }
      .tile { position: relative; display: flex; flex-direction: column; justify-content: space-between; gap: 2px; min-width: 0; padding: 10px 12px; border: 1px solid var(--sc-border); border-radius: 12px; background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 5%, var(--sc-bg-1)), var(--sc-bg-1)); color: var(--sc-fg); text-decoration: none; font: inherit; text-align: start; transition: border-color 0.2s, transform 0.2s; }
      a.tile:hover, .tile.add:hover { border-color: var(--sc-accent); transform: translateY(-1px); }
      .tile.add { align-items: center; justify-content: center; border-style: dashed; border-color: color-mix(in srgb, var(--sc-accent) 50%, var(--sc-border)); background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); cursor: pointer; }
      .plus { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; border: 1.5px dashed color-mix(in srgb, var(--sc-accent) 60%, transparent); color: var(--sc-accent); }
      .plus svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
      .add-t { font-size: 0.8rem; color: var(--sc-fg-1); text-align: center; }
      .tile .nm { font-size: 0.9rem; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; padding-right: 3.2ch; }
      .tile .nm.tile-link { color: inherit; text-decoration: none; }
      .tile-link::after { content: ''; position: absolute; inset: 0; border-radius: 12px; }
      .tile-link:focus-visible { outline: none; }
      .tile-link:focus-visible::after { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .tile:has(.tile-link):hover { border-color: var(--sc-accent); transform: translateY(-1px); }
      .tile:has(.tile-link) .qty { pointer-events: none; }
      .hint { position: relative; z-index: 1; }
      .tile .qty { position: absolute; top: 8px; right: 12px; font: 700 1rem var(--sc-font-display, inherit); color: var(--sc-accent); }
      .tile .where { color: var(--sc-fg-2); font-size: 0.74rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .hint { display: flex; align-items: center; justify-content: space-between; gap: 4px; min-height: 34px; color: var(--sc-fg-2); font-size: 0.74rem; }
      .hint span { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; line-height: 1.25; }
      .nach svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .tile.focus { border-color: var(--sc-accent); box-shadow: 0 0 0 1px var(--sc-accent), 0 0 20px color-mix(in srgb, var(--sc-accent) 40%, transparent); animation: tile-focus 4s ease-in forwards; }
      @keyframes tile-focus { 70% { box-shadow: 0 0 0 1px var(--sc-accent), 0 0 20px color-mix(in srgb, var(--sc-accent) 40%, transparent); } 100% { box-shadow: none; border-color: var(--sc-border); } }
      .panel { flex: none; padding: var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-1); }
      .panel h3 { margin: 0 0 6px; font: 600 0.95rem var(--sc-font-display, inherit); color: var(--sc-fg-1); }
      .empty { display: flex; align-items: center; gap: var(--sc-space-3, 12px); flex-wrap: wrap; }
      .empty small { color: var(--sc-fg-2); flex-basis: 100%; }
      .ring { width: 28px; height: 28px; border-radius: 50%; border: 2px dashed color-mix(in srgb, var(--sc-accent) 50%, transparent); }
      .foot { display: flex; align-items: center; gap: var(--sc-space-3, 12px); flex: none; min-height: 40px; }
      .ticker-room { flex: 0 0 min(300px, 30%); }
      .shared-slot { display: block; flex: 1; min-width: 0; max-height: 5rem; overflow-y: auto; }
      .pager { margin-left: auto; display: inline-flex; align-items: center; gap: var(--sc-space-1, 4px); }
      .pg { color: var(--sc-fg-2); font-size: 0.82rem; margin-right: 4px; }
      @media (pointer: coarse) { .tab, .chip, .used, .search { min-height: 44px; } }
      @media (max-width: 1023px) { .grid { overflow: visible; } .ticker-room { display: none; } }
      @media (prefers-reduced-motion: reduce) { .tile { transition: none; } .tile.focus { animation: none; } }
    `,
  ],
})
export class HqStockComponent implements OnInit {
  private readonly tr = inject(TranslateService);
  readonly placeName = (n: string): string => placeLabel(n, this.tr.getCurrentLang());
  readonly auth = inject(AuthService);
  readonly hangar = inject(HangarService);
  readonly inv = inject(HqInventoryService);
  private readonly live = inject(HqLiveService);
  private readonly ownership = inject(HqOwnershipService);
  private readonly shellBeta = inject(BetaService).isEnabled('shell');
  private readonly wish = inject(WishlistStore);
  private readonly stockWish = inject(StockWishService);
  private readonly ns = inject(NachschubService);
  private readonly sammlung = inject(SammlungService);
  private readonly edge = inject(NachschubEdgeService);
  private readonly confirm = inject(ScConfirmService);
  private readonly route = inject(ActivatedRoute);
  private readonly gridRef = viewChild<ElementRef<HTMLElement>>('grid');

  protected readonly shipTitle = humanizeClassName;
  protected readonly cats = STOCK_CATEGORIES;
  protected readonly cartIcon = WISH_CART_ICON;

  readonly tab = signal<HqStockTab>('inventar');
  readonly cat = signal<StockCategory | null>(null);
  readonly q = signal('');
  readonly page = signal(0);
  readonly capacity = signal(24);
  readonly popup = signal<StockStart | null>(null);
  readonly menuOpen = signal(false);
  readonly usedOpen = signal(false);
  readonly focusKey = signal<string | null>(null);
  readonly errorKey = signal<string | null>(null);
  private pendingFocus: string | null = null;
  private readonly clock = signal(Date.now());

  protected readonly allTiles = computed(() => buildTiles(this.inv.items(), BLUEPRINT_PLACE));
  protected readonly catCount = computed(() => categoryCounts(this.allTiles()));
  protected readonly tiles = computed(() => filterTiles(this.allTiles(), this.cat(), this.q()));
  protected readonly ships = computed(() => {
    const owned = this.hangar.ships().filter((s) => s.status === 'owned');
    return flagshipFirst(owned, (c) => this.hangar.isFlagship(c));
  });
  protected readonly blueprints = computed(() => this.sammlung.blueprints());

  protected readonly tabs: readonly { id: HqStockTab; count: () => number }[] = [
    { id: 'inventar', count: () => this.allTiles().length },
    { id: 'hangar', count: () => this.ships().length },
    { id: 'sammlung', count: () => this.blueprints().length },
  ];

  /** Everything the current tab lists; the "+" tile is always the first cell. */
  protected readonly cells = computed<Cell[]>(() => {
    const t = this.tab();
    if (t === 'inventar') return [{ kind: 'add' }, ...this.tiles().map((tile) => ({ kind: 'item' as const, tile }))];
    if (t === 'hangar') return [{ kind: 'add' }, ...this.ships().map((ship) => ({ kind: 'ship' as const, ship }))];
    return [{ kind: 'add' }, ...this.blueprints().map((b) => ({ kind: 'bp' as const, id: String(b.id), name: b.name ?? humanizeClassName(String(b.id)) }))];
  });
  protected readonly view = computed(() => pageOf(this.cells(), this.page(), this.capacity()));
  protected readonly pageCells = computed(() => this.view().items);
  protected readonly total = computed(() => this.cells().length - 1);
  /** "from-to of total" counts the items only: the "+" tile is the first cell of page one and no item. */
  protected readonly shown = computed(() => {
    const v = this.view();
    const n = v.items.filter((c) => c.kind !== 'add').length;
    if (!n) return { from: 0, to: 0 };
    const first = v.page === 0 ? 1 : v.page * this.capacity();
    return { from: first, to: first + n - 1 };
  });

  protected readonly used = computed<UsedUp[]>(() => usedUpRecently(this.live.events(), this.inv.items(), this.clock()));
  protected readonly usedSummary = computed(() => {
    const u = this.used();
    const head = u.slice(0, USED_NAMES).map((x) => `${this.usedQty(x)} ${x.name}`).join(', ');
    return u.length > USED_NAMES ? `${head} +${u.length - USED_NAMES}` : head;
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => this.applyParams(q.get(HQ_STOCK_TAB_PARAM), q.get(HQ_STOCK_CAT_PARAM), q.get(HQ_STOCK_FOCUS_PARAM)));
    // A new filter starts on page one.
    effect(() => {
      this.cat();
      this.tab();
      untracked(() => this.page.set(0));
    });
    // A deep-linked item: show the page that holds it, then mark it.
    effect(() => {
      const want = this.pendingFocus;
      const cells = this.cells();
      if (!want) return;
      const i = cells.findIndex((c) => cellId(c) === want);
      if (i < 0) return;
      untracked(() => {
        this.pendingFocus = null;
        this.page.set(Math.floor(i / Math.max(1, this.capacity())));
        this.focusKey.set(want);
      });
    });
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.gridRef()?.nativeElement;
      const fit = (): void => this.measure();
      this.measure();
      if (el && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        destroyRef.onDestroy(() => ro.disconnect());
      }
    });
    effect(() => {
      this.tab();
      this.auth.user();
      // The grid element appears with the page state: measure when it did.
      queueMicrotask(() => this.measure());
    });
  }

  ngOnInit(): void {
    if (!this.auth.user()) return;
    void this.inv.load();
    void this.ownership.ensureLoaded();
    void this.wish.ensureLoaded();
    void this.sammlung.load();
    void this.ns.ensureLoaded();
  }

  /** How many tiles the grid fits (columns x rows of the real box), so the page never scrolls. */
  private measure(): void {
    const el = this.gridRef()?.nativeElement;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w <= 0 || h <= 0) return;
    const cols = Math.max(1, Math.floor((w + GAP) / (TILE_W + GAP)));
    // Below the desktop frame the page itself may scroll: a fixed page of rows, not what the (growing) box holds.
    const phone = typeof window !== 'undefined' && window.innerWidth < 1024;
    const rows = phone ? PHONE_ROWS : Math.max(1, Math.floor((h + GAP) / (TILE_H + GAP)));
    const next = cols * rows;
    if (next !== this.capacity()) this.capacity.set(next);
  }

  private applyParams(tab: string | null, cat: string | null, focus: string | null): void {
    const t = hqStockTabOf(tab);
    if (t) this.tab.set(t);
    const c = (STOCK_CATEGORIES as readonly string[]).includes(cat ?? '') ? (cat as StockCategory) : null;
    if (t || cat !== null) this.cat.set(c);
    if (focus) {
      this.pendingFocus = focus.toLowerCase();
      this.q.set('');
    }
  }

  protected setTab(t: HqStockTab): void {
    this.tab.set(t);
    this.menuOpen.set(false);
  }

  protected setCat(c: StockCategory | null): void {
    this.cat.set(c);
  }

  protected addLabel(): string {
    return this.tab() === 'inventar' ? 'hq.bestand.addItem' : this.tab() === 'hangar' ? 'hq.bestand.addShip' : 'hq.bestand.addBlueprint';
  }

  protected cellKey(c: Cell): string {
    return `${c.kind}:${cellId(c)}`;
  }

  protected add(): void {
    if (this.tab() === 'inventar') this.popup.set({ mode: 'add' });
    else if (this.tab() === 'sammlung') void this.addBlueprint();
    else void this.addShip();
  }

  /** Blueprints come in by hand as a stock row at the blueprint place (the Sammlung reads them from there). */
  private async addBlueprint(): Promise<void> {
    const name = await this.confirm.prompt({ titleKey: 'hq.bestand.addBlueprint', inputLabelKey: 'hq.bestand.addBlueprintLabel', inputMaxLength: 80 });
    const n = name?.trim();
    if (!n) return;
    const ok = await this.inv.addManual(BLUEPRINT_PLACE, n, 1, 'pcs', null);
    this.errorKey.set(ok ? null : (this.inv.error() ?? 'errors.generic'));
  }

  private async addShip(): Promise<void> {
    const name = await this.confirm.prompt({ titleKey: 'hq.bestand.addShip', inputLabelKey: 'hq.bestand.addShipLabel', inputMaxLength: 80 });
    const n = name?.trim();
    if (!n) return;
    // One more OWNED copy: a wished row becomes owned (its other wished copies stay wished), never +1 on the wish.
    const copies = await this.edge.addShipCopy(n);
    this.errorKey.set(copies ? null : (this.hangar.error() ?? 'errors.generic'));
  }

  protected shipLink(s: HangarShip): HqLink {
    return ownShipLink(s, this.ownership.configsForShip(s.id), this.shellBeta());
  }

  protected destroyedAt(shipClassName: string): string | null {
    return lastDestroyedAt(this.live.events(), shipClassName, Date.now());
  }

  protected qtyText(t: InvTile): string {
    const n = t.qty.toLocaleString(this.tr.getCurrentLang() || undefined, { maximumFractionDigits: 3 });
    return t.unit === 'scu' ? `${n} SCU` : `×${n}`;
  }

  protected usedQty(u: UsedUp): string {
    const n = u.qty.toLocaleString(this.tr.getCurrentLang() || undefined, { maximumFractionDigits: 3 });
    return u.unit === 'scu' ? `${n} SCU` : `${n}×`;
  }

  protected placeText(t: InvTile): string {
    if (!t.places.length) return this.tr.instant('hq.stock.free');
    const first = this.placeName(t.places[0]);
    return t.places.length > 1 ? `${first} +${t.places.length - 1}` : first;
  }

  /** What an Inventar tile means on the wishlist (Codex kind + class name); null without a class name. */
  protected tileTarget(t: InvTile): StockWishTarget | null {
    return this.stockWish.targetOf({ className: t.className, name: t.name, unit: t.unit, cat: t.cat });
  }

  protected shipTarget(s: HangarShip): StockWishTarget {
    return this.stockWish.shipTarget(s.shipClassName, s.customName || humanizeClassName(s.shipClassName));
  }

  protected blueprintTarget(c: { id: string; name: string }): StockWishTarget {
    return this.stockWish.blueprintTarget(c.id, c.name);
  }

  /** The quiet hint on a tile: already wished, or already in a Nachschub. */
  protected hint(t: StockWishTarget): { key: string; params: Record<string, unknown> } | null {
    return this.stockWish.hint(t);
  }

  /** "Nachholen" on a tile: one more onto the wishlist, with the way back in the toast. */
  protected async wishTarget(t: StockWishTarget): Promise<void> {
    const ok = await this.stockWish.wish(t, 1);
    this.errorKey.set(ok ? null : 'errors.generic');
  }

  protected async catchUp(list: readonly UsedUp[]): Promise<void> {
    const single = list.length === 1;
    let failed = false;
    for (const u of list) {
      const t = this.stockWish.targetOf({ className: u.className, name: u.name, unit: u.unit });
      if (!t) continue;
      const qty = u.unit === 'scu' ? Math.max(1, Math.ceil(u.qty)) : Math.max(1, Math.round(u.qty));
      if (!(await this.stockWish.wish(t, qty, single))) failed = true;
    }
    this.errorKey.set(failed ? 'errors.generic' : null);
    this.usedOpen.set(false);
  }

  protected async resetIngame(): Promise<void> {
    this.menuOpen.set(false);
    const ok = await this.confirm.confirm({ titleKey: 'hq.bestand.resetTitle', messageKey: 'hq.bestand.resetMessage', confirmKey: 'hq.bestand.resetConfirm', tone: 'danger' });
    if (!ok) return;
    const done = await this.edge.resetIngameStock();
    this.errorKey.set(done ? null : (this.edge.lastError ?? 'errors.generic'));
  }
}

function cellId(c: Cell): string {
  switch (c.kind) {
    case 'add':
      return '+';
    case 'item':
      return c.tile.key;
    case 'ship':
      return c.ship.shipClassName.toLowerCase();
    case 'bp':
      return c.id.toLowerCase();
  }
}
