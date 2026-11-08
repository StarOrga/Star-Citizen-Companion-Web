import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { humanizeClassName } from '../../codex/codex-format';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { toErrorKey } from '../../core/describe-error';
import { CodexService, toLang } from '../../codex/codex.service';
import { hitTitle } from '../../codex/search/codex-search-model';
import { HangarService } from '../../hangar/hangar.service';
import { flagshipFirst } from '../../hangar/flagship-first';
import type { HangarShip, HangarShipOrigin } from '../../hangar/hangar.types';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { PATH_ICONS } from '../../shared/item-path/path-icons';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ShellChromeService } from '../../shell/fusion-bar/shell-chrome.service';
import { ScSelectComponent, type ScSelectOption } from '../../shared/sc-select.component';
import { HqReserveDialog } from './hq-reserve-dialog';
import { reservationFriends } from './hq-reserve';
import { FriendsService } from '../../social/friends.service';
import { SHIP_ROLES, type ShipRole } from '../../codex/codex-ship-filters';
import { HqInventoryService } from '../data/hq-inventory.service';
import { aggregateQuality, averageLabel, itemIdentity, qualityBands, rangeLabel } from '../data/hq-quality';
import { ScrapInfoService } from '../data/scrap-info';
import { WishlistStore } from '../data/wishlist.store';
import { HqOwnershipService } from '../hq-ownership.service';
import {
  HQ_STOCK_CAT_PARAM,
  HQ_STOCK_FOCUS_PARAM,
  HQ_STOCK_PLACE_PARAM,
  HQ_STOCK_SUB_PARAM,
  HQ_STOCK_TABS,
  HQ_STOCK_TAB_PARAM,
  type HqLink,
  type HqPageLink,
  type HqStockTab,
  hqListLink,
  hqPage,
  hqSet,
  hqStockLink,
  hqStockTabOf,
  ownShipLink,
} from '../hq-routes';
import { NachschubEdgeService } from '../nachschub/nachschub-edge.service';
import { NachschubTargetPicker, type NachschubTargetIntent } from '../nachschub/nachschub-target-picker';
import type { NachschubLineInput } from '../nachschub/nachschub.model';
import { BLUEPRINT_PLACE } from '../nachschub/sammlung.model';
import { SammlungService } from '../nachschub/sammlung.service';
import { NachschubService } from '../nachschub/nachschub.service';
import { HqLiveService } from '../now/hq-live.service';
import { lastDestroyedAt } from '../now/hq-live.util';
import { BetaService } from '../../core/beta.service';
import { HqBlueprintPickerComponent, PickedBlueprint } from './hq-blueprint-picker.component';
import { HqCrateComponent } from './hq-crate.component';
import { HqPlaceSelectComponent } from './hq-place-select.component';
import {
  type DeckCrate,
  type DeckFilter,
  INV_KINDS,
  type InvKind,
  SUBS_OF,
  type SearchEntry,
  alternativesFor,
  buildCrates,
  crateMatches,
  deckBays,
  deckKindOf,
  deckLanes,
  filterCrates,
  kindCounts,
  linesOf,
  parseStockQuery,
  placeCounts,
  subCounts,
  textMatches,
  tieredSearch,
} from './hq-stock-deck';
import { type LogLine, HqStockLogComponent } from './hq-stock-log.component';
import { placeInfo, placeSub } from './hq-stock-places';
import { HqStockPopupComponent, StockStart } from './hq-stock-popup.component';
import { parseStockRef } from './hq-stock-ref';
import { HqStockSharedComponent } from './hq-stock-shared.component';
import { HqStockTableComponent } from './hq-stock-table.component';
import { pageOf } from './hq-stock-tiles';
import { WISH_CART_ICON, type StockWishTarget, StockWishService } from './hq-stock-wish';

/** Alles adds the Hangar and Sammlung lanes to the Inventar kinds (screen a3-s1). */
type DeckKind = InvKind | 'ships' | 'sammlung';
const ALLES_KINDS: readonly DeckKind[] = [...INV_KINDS, 'ships', 'sammlung'];
const ORIGINS: readonly HangarShipOrigin[] = ['pledge', 'ingame', 'loan'];
const SAMMLUNG_KINDS = ['blueprints', 'ruf', 'news', 'gallery'] as const;
type SammlungKind = (typeof SAMMLUNG_KINDS)[number];
/** URL params beside tab/cat/sub/ort (brief f7: a filtered view is a shareable anchor). */
const P_RES = 'res';
const P_FRIEND = 'resfor';
const P_SCRAP = 'zerlegbar';
const P_ORIGIN = 'herkunft';
const P_ROLE = 'rolle';
const P_ART = 'art';
const CRATE_W = 150;
const CRATE_H = 112;
const GAP = 8;
const PHONE_ROWS = 8;

type Cell = { kind: 'add' } | { kind: 'ship'; ship: HangarShip } | { kind: 'bp'; id: string; name: string };

/**
 * HQ page "Bestand" as the Frachtdeck (concept 20261108-2135, design frachtdeck3): tabs Alles · Inventar · Hangar ·
 * Sammlung (path icons, no counts); one filter bar (kind chips with their sub-kinds unfolded inline, the place select,
 * toggles); the loading bays per place with the Ladeprotokoll beside them; the deck of containers per kind lane, or the
 * table; selection by highlight with Reservieren · Verkaufen · Abholen planen · Löschen. The subheader search is the
 * page search (tiered). Rules: `docs/concepts/hq-bestand-ui-spec.md`.
 */
@Component({
  selector: 'sc-hq-stock',
  standalone: true,
  imports: [
    TranslatePipe, DatePipe, NgTemplateOutlet, RouterLink, ScActionDirective, ScTooltipDirective, HqStockPopupComponent, HqStockSharedComponent,
    HqBlueprintPickerComponent, HqCrateComponent, HqPlaceSelectComponent, ScSelectComponent, HqStockLogComponent, HqStockTableComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <span class="ti" aria-hidden="true"><svg viewBox="0 0 24 24">@for (d of tabIcon(tab()); track $index) { <path [attr.d]="d" /> }</svg></span>
      <div class="ttl">
        <small>{{ 'hq.bestand.title' | translate }}</small>
        <h2 class="page-title" id="hq-stock-title">{{ 'hq.bestand.tab.' + tab() | translate }}</h2>
      </div>
      <nav class="tabs" [attr.aria-label]="'hq.bestand.tabsAria' | translate">
        @for (t of tabs; track t) {
          <a class="tab" [routerLink]="tabLink(t).commands" [queryParams]="tabLink(t).queryParams" [fragment]="tabLink(t).fragment" [attr.aria-current]="tab() === t ? 'page' : null">
            <svg viewBox="0 0 24 24" aria-hidden="true">@for (d of tabIcon(t); track $index) { <path [attr.d]="d" /> }</svg>{{ 'hq.bestand.tab.' + t | translate }}
          </a>
        }
      </nav>
      <span class="head-r">
        @if (isDeckTab()) {
          <span class="mode" role="group" [attr.aria-label]="'hq.bestand.deck.modeAria' | translate">
            <button type="button" [attr.aria-pressed]="mode() === 'deck'" (click)="mode.set('deck')">{{ 'hq.bestand.deck.mode.deck' | translate }}</button>
            <button type="button" [attr.aria-pressed]="mode() === 'table'" (click)="mode.set('table')">{{ 'hq.bestand.deck.mode.table' | translate }}</button>
          </span>
          <button type="button" scAction tier="secondary" (click)="add()">{{ 'hq.bestand.addItem' | translate }}</button>
        }
        <span class="menu-wrap">
          <button type="button" scAction tier="tertiary" aria-haspopup="menu" [attr.aria-expanded]="menuOpen()" [attr.aria-label]="'hq.bestand.menu' | translate"
                  [scTooltip]="'hq.bestand.menu' | translate" scTooltipTier="label" (click)="menuOpen.set(!menuOpen())">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="18.5" r="1.4" /></svg>
          </button>
          @if (menuOpen()) {
            <ul class="menu" role="menu" (keydown.escape)="menuOpen.set(false)">
              <li role="none"><a role="menuitem" [routerLink]="importLink" (click)="menuOpen.set(false)">{{ 'hq.bestand.deck.import' | translate }}</a></li>
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

      <!-- One filter bar (brief f7): kinds, the chosen kind's sub-kinds inline, place select, toggles, reset. -->
      <div class="bar" [attr.aria-label]="'hq.bestand.filter' | translate" role="group">
        @if (isDeckTab()) {
          <div class="grp" role="radiogroup" [attr.aria-label]="'hq.bestand.deck.kindAria' | translate" (keydown)="rove($event)">
            <button type="button" role="radio" class="chip" [attr.aria-checked]="!kind()" [tabindex]="!kind() ? 0 : -1" (click)="setKind(null)">{{ 'hq.bestand.all' | translate }}</button>
            @for (k of deckKinds(); track k) {
              @if (k === 'ships' || (k === 'sets' && tab() === 'alles')) { <span class="sep" aria-hidden="true"></span> }
              <button type="button" role="radio" class="chip" [class.zero]="!kindCount(k)" [attr.aria-checked]="kind() === k" [tabindex]="kind() === k ? 0 : -1" (click)="setKind(k)">
                {{ 'hq.bestand.deck.kind.' + k | translate }}<b>{{ kindCount(k) }}</b>
              </button>
              @if (kind() === k && subs().length) {
                <span class="subs" role="radiogroup" [attr.aria-label]="'hq.bestand.deck.subAria' | translate: { kind: ('hq.bestand.deck.kind.' + k | translate) }" (keydown)="rove($event)" (keydown.escape)="leaveSubs($event)">
                  @for (s of subs(); track s.id) {
                    <button type="button" role="radio" class="chip sub" [class.zero]="!s.n" [attr.aria-checked]="sub() === s.id" [tabindex]="(sub() ? sub() === s.id : $first) ? 0 : -1" (click)="setSub(s.id)">
                      {{ 'hq.bestand.deck.sub.' + s.id | translate }}<b>{{ s.n }}</b>
                    </button>
                  }
                </span>
              }
            }
          </div>
          <sc-hq-place-select class="place" [known]="knownPlaces()" [amounts]="placeAmounts()" [value]="place()" (valueChange)="setPlace($event)" />
          <button type="button" class="tog" [attr.aria-pressed]="reserved()" (click)="setToggle(P_RES, !reserved())">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z" /></svg>{{ 'hq.bestand.deck.reserved' | translate }}
          </button>
          @if (reserved() && friendOptions().length) {
            <sc-select class="place" [options]="friendOptions()" [value]="friend()" [allowEmpty]="true" placeholderKey="hq.bestand.deck.rsv.allFriends"
                       [ariaLabel]="'hq.bestand.deck.rsv.byFriend' | translate" (valueChange)="setParam(P_FRIEND, $event)" />
          }
          <button type="button" class="tog" [attr.aria-pressed]="scrapOnly()" (click)="setToggle(P_SCRAP, !scrapOnly())">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></svg>{{ 'hq.bestand.deck.scrapOnly' | translate }}
          </button>
        } @else if (tab() === 'hangar') {
          <div class="grp" role="radiogroup" [attr.aria-label]="'hq.bestand.deck.originAria' | translate" (keydown)="rove($event)">
            <button type="button" role="radio" class="chip" [attr.aria-checked]="!origin()" [tabindex]="!origin() ? 0 : -1" (click)="setParam(P_ORIGIN, null)">{{ 'hq.bestand.all' | translate }}</button>
            @for (o of origins; track o) {
              <button type="button" role="radio" class="chip" [class.zero]="!originCounts().get(o)" [attr.aria-checked]="origin() === o" [tabindex]="origin() === o ? 0 : -1" (click)="setParam(P_ORIGIN, origin() === o ? null : o)">
                {{ 'hq.bestand.deck.origin.' + o | translate }}<b>{{ originCounts().get(o) ?? 0 }}</b>
              </button>
            }
          </div>
          <span class="sep" aria-hidden="true"></span>
          <div class="grp" role="radiogroup" [attr.aria-label]="'hq.bestand.deck.roleAria' | translate" (keydown)="rove($event)">
            <button type="button" role="radio" class="chip" [attr.aria-checked]="!role()" [tabindex]="!role() ? 0 : -1" (click)="setParam(P_ROLE, null)">{{ 'hq.bestand.deck.allRoles' | translate }}</button>
            @for (r of roles; track r) {
              <button type="button" role="radio" class="chip" [class.zero]="!roleCounts().get(r)" [attr.aria-checked]="role() === r" [tabindex]="role() === r ? 0 : -1" (click)="setParam(P_ROLE, role() === r ? null : r)">
                {{ 'hq.bestand.deck.role.' + r | translate }}<b>{{ roleCounts().get(r) ?? 0 }}</b>
              </button>
            }
          </div>
          <a class="wishes" [routerLink]="wishLink.commands" [queryParams]="wishLink.queryParams" [fragment]="wishLink.fragment">
            <svg viewBox="0 0 24 24" aria-hidden="true">@for (d of wishIcon; track $index) { <path [attr.d]="d" /> }</svg>{{ 'hq.bestand.deck.wishCount' | translate: { n: shipWishes.count() } }}
          </a>
        } @else {
          <div class="grp" role="radiogroup" [attr.aria-label]="'hq.bestand.deck.artAria' | translate" (keydown)="rove($event)">
            <button type="button" role="radio" class="chip" [attr.aria-checked]="!art()" [tabindex]="!art() ? 0 : -1" (click)="setParam(P_ART, null)">{{ 'hq.bestand.all' | translate }}</button>
            @for (a of sammlungKinds; track a) {
              <button type="button" role="radio" class="chip" [class.zero]="!artCount(a)" [attr.aria-checked]="art() === a" [tabindex]="art() === a ? 0 : -1" (click)="setParam(P_ART, art() === a ? null : a)">
                {{ 'hq.bestand.deck.art.' + a | translate }}<b>{{ artCount(a) }}</b>
              </button>
            }
          </div>
        }
        @if (anyFilter()) {
          <button type="button" scAction tier="tertiary" class="reset" [attr.aria-label]="'hq.bestand.deck.resetFilters' | translate"
                  [scTooltip]="'hq.bestand.deck.resetFilters' | translate" scTooltipTier="label" (click)="resetFilters()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        }
        <span class="sc-sr-only" aria-live="polite">{{ 'hq.bestand.deck.hits' | translate: { n: liveHits() } }}</span>
      </div>

      @if (isDeckTab()) {
        <div class="main">
          <div class="left">
            @if (bays().length) {
              <div class="bays" role="group" [attr.aria-label]="'hq.bestand.deck.baysAria' | translate">
                @for (b of bays(); track b.location) {
                  <button type="button" class="bay" [style.flex-grow]="b.weight" [attr.aria-pressed]="place() === b.location" (click)="setPlace(place() === b.location ? null : b.location)"
                          [scTooltip]="bayLabel(b.location).name + ' · ' + bayLabel(b.location).sub" scTooltipTier="label">
                    <b>{{ bayLabel(b.location).name }}</b><small>{{ bayLabel(b.location).sub }}</small>
                  </button>
                }
              </div>
            }

            @if (detail(); as d) {
              <section class="res" aria-labelledby="hq-res-h">
                <header>
                  <div>
                    <h3 id="hq-res-h">{{ 'hq.bestand.deck.byQuality' | translate: { name: d.agg.name } }}</h3>
                    <small>{{ 'hq.bestand.deck.resSummary' | translate: { qty: fmtQty(d.agg.qty, d.agg.unit), n: d.crates.length } }}@if (avgOf(d.agg); as a) { · {{ a }} }</small>
                  </div>
                  <button type="button" scAction tier="secondary" (click)="wishCrate(d.crates[0])">{{ 'hq.bestand.deck.toWishlist' | translate }}</button>
                </header>
                <div class="spec" role="list">
                  @for (band of d.bands; track band.from) {
                    <div class="band" role="listitem" [style.--h.%]="band.qty / d.maxBand * 100" [style.--r.%]="band.qty ? band.reserved / band.qty * 100 : 0"
                         [scTooltip]="'hq.bestand.deck.bandTip' | translate: { from: band.from, to: band.to, qty: fmtQty(band.qty, d.agg.unit), res: fmtQty(band.reserved, d.agg.unit) }" scTooltipTier="info" tabindex="0">
                      <b class="mono">{{ fmtNum(band.qty) }}</b>
                      <span class="bar" [class.hit]="minQ() !== null && band.to >= minQ()!"><i class="rh"></i></span>
                      <small>Q {{ band.from }}–{{ band.to }}</small>
                    </div>
                  }
                  @if (d.agg.unknownQty > 0) {
                    <div class="band unk" role="listitem" [style.--h.%]="d.agg.unknownQty / d.maxBand * 100" [style.--r.%]="0">
                      <b class="mono">{{ fmtNum(d.agg.unknownQty) }}</b><span class="bar"></span><small>{{ 'hq.bestand.deck.qUnknown' | translate }}</small>
                    </div>
                  }
                </div>
                <div class="stacks">
                  @for (c of d.crates; track c.key) {
                    <sc-hq-crate class="sz-m" [crate]="c" size="m" [selected]="selection().has(c.key)" [placeLabel]="crateLabel(c.location)" [scrap]="scrapOf(c)" [friendName]="friendName" (chosen)="toggleSel(c)" />
                  }
                </div>
              </section>
            }

            @if (query().text) {
              @if (alts(); as a) {
                <section class="ghost" aria-labelledby="hq-alt-h">
                  <h3 id="hq-alt-h">{{ (shownCrates().length ? 'hq.bestand.deck.fewHits' : 'hq.bestand.deck.noHits') | translate: { q: q(), n: shownCrates().length } }}</h3>
                  @for (c of a.elsewhere; track c.key) {
                    <div class="alt">
                      <span><b>{{ 'hq.bestand.deck.alt.elsewhere' | translate: { qty: fmtQty(c.qty, c.unit), name: c.name, place: crateLabel(c.location) } }}</b>
                        <small>{{ 'hq.bestand.deck.alt.free' | translate: { n: fmtQty(c.available, c.unit) } }}@if (avgOf(c); as av) { · {{ av }} }</small></span>
                      <button type="button" scAction tier="secondary" (click)="hand('pickup', [c])">{{ 'hq.bestand.deck.pickup' | translate }}</button>
                    </div>
                  }
                  @if (a.wish; as w) {
                    <div class="alt">
                      <span><b>{{ (w.minQ ? 'hq.bestand.deck.alt.wishQ' : 'hq.bestand.deck.alt.wish') | translate: { name: q(), q: w.minQ } }}</b></span>
                      <button type="button" scAction tier="secondary" (click)="wishAndPlan()">{{ 'hq.bestand.deck.alt.wishGo' | translate }}</button>
                    </div>
                  }
                  @for (c of a.swap; track c.key) {
                    <div class="alt"><span><b>{{ 'hq.bestand.deck.alt.swap' | translate: { name: c.name, qty: fmtQty(c.qty, c.unit), place: crateLabel(c.location) } }}</b>
                      <small>{{ 'hq.bestand.deck.alt.swapWhy' | translate }}</small></span></div>
                  }
                  @for (b of a.craft; track b.id) {
                    <a class="alt" [routerLink]="['/codex/blueprint', b.id]"><span><b>{{ 'hq.bestand.deck.alt.craft' | translate }}</b><small>{{ b.name }}</small></span></a>
                  }
                </section>
              }
              @if (searchTiers().rest.length) {
                <section class="tiers" aria-labelledby="hq-tier-h">
                  <h3 id="hq-tier-h">{{ 'hq.bestand.deck.alsoIn' | translate }}</h3>
                  <ul>
                    @for (e of searchTiers().rest; track e.area + e.key) {
                      <li><a [routerLink]="restLink(e).commands" [queryParams]="restLink(e).queryParams" [fragment]="restLink(e).fragment">{{ e.name }} <small>{{ 'hq.bestand.tab.' + e.area | translate }}</small></a></li>
                    }
                  </ul>
                </section>
              }
              @if (codexHits().length) {
                <section class="tiers codex-hits" aria-labelledby="hq-codex-h">
                  <h3 id="hq-codex-h">{{ 'hq.bestand.deck.codexTier' | translate }}</h3>
                  <ul>
                    @for (h of codexHits(); track h.key) {
                      <li>
                        <span>{{ h.name }} <small>{{ h.kind }}</small></span>
                        @if (shipWishes.has(h.kind, h.className, h.name)) {
                          <span class="wished">{{ 'hq.bestand.deck.onWishlist' | translate }}</span>
                        } @else {
                          <button type="button" scAction tier="secondary" [busy]="wishing() === h.key" (click)="wishCodexHit(h)">{{ 'hq.bestand.deck.toWishlist' | translate }}</button>
                        }
                      </li>
                    }
                  </ul>
                </section>
              }
              <a class="codex-tier" [routerLink]="['/codex/index']" [queryParams]="{ q: query().text }">{{ 'hq.bestand.deck.inCodex' | translate: { q: query().text } }}</a>
            }

            @if (mode() === 'table') {
              <sc-hq-stock-table [rows]="pageCrates()" [isSelected]="isSelected" [placeLabel]="crateLabel" [scrap]="scrapOf" (rowToggle)="toggleSel($event)"
                                 (amountChange)="setAmount($event.crate, $event.qty)" (remove)="deleteOne($event)" (reservations)="openReserve([$event])" />
            } @else {
              <div #deck class="deck">
                @for (l of lanes(); track l.kind) {
                  <section class="lane" [attr.aria-label]="'hq.bestand.deck.kind.' + l.kind | translate">
                    <span class="lbl"><svg viewBox="0 0 24 24" aria-hidden="true">@for (d of laneIcon; track $index) { <path [attr.d]="d" /> }</svg>{{ 'hq.bestand.deck.kind.' + l.kind | translate }}</span>
                    <div class="row">
                      @for (c of l.crates; track c.key) {
                        <sc-hq-crate [class]="'sz-' + sizeOf(c, l.crates)" [crate]="c" [size]="sizeOf(c, l.crates)" [selected]="selection().has(c.key)" [showPlace]="!place()"
                                     [placeLabel]="crateLabel(c.location)" [scrap]="scrapOf(c)" [friendName]="friendName" (chosen)="toggleSel(c)" />
                      }
                    </div>
                  </section>
                }
                @if (showSets()) {
                  <section class="lane" [attr.aria-label]="'hq.bestand.deck.kind.sets' | translate">
                    <span class="lbl">{{ 'hq.bestand.deck.kind.sets' | translate }}</span>
                    <div class="row">
                      @for (s of sets(); track s.id) {
                        <a class="set" [routerLink]="setLink(s.id)"><b>{{ s.name }}</b><small>{{ 'hangar.roles.' + s.role | translate }} · {{ 'hq.bestand.deck.setItems' | translate: { n: s.items.length } }}</small></a>
                      }
                      <button type="button" class="set add" (click)="addSet()"><span aria-hidden="true">+</span> {{ 'hq.bestand.deck.addSet' | translate }}</button>
                    </div>
                  </section>
                }
                @if (tab() === 'alles' && (!kind() || kind() === 'ships') && shownShips().length) {
                  <section class="lane" [attr.aria-label]="'hq.bestand.deck.kind.ships' | translate">
                    <span class="lbl"><svg viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.hangar; track $index) { <path [attr.d]="d" /> }</svg>{{ 'hq.bestand.deck.kind.ships' | translate }}</span>
                    <div class="row">
                      @for (s of shownShips(); track s.id) {
                        <a class="pad" [routerLink]="shipLink(s).commands" [queryParams]="shipLink(s).queryParams"><b>{{ shipName(s) }}</b><small>{{ shipWhere(s) }}</small></a>
                      }
                    </div>
                  </section>
                }
                @if (tab() === 'alles' && (!kind() || kind() === 'sammlung') && shownBlueprints().length) {
                  <section class="lane" [attr.aria-label]="'hq.bestand.deck.kind.sammlung' | translate">
                    <span class="lbl"><svg viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.sammlung; track $index) { <path [attr.d]="d" /> }</svg>{{ 'hq.bestand.deck.kind.sammlung' | translate }}</span>
                    <div class="row">
                      @for (b of shownBlueprints(); track b.id) {
                        <a class="lock" [routerLink]="['/codex/blueprint', b.id]"><b>{{ b.name }}</b><small>{{ 'hq.bestand.blueprint' | translate }}</small></a>
                      }
                    </div>
                  </section>
                }
              </div>
            }

            @if (deckEmpty()) {
              <div class="empty-area">
                <p>{{ (crates().length ? 'hq.bestand.deck.emptyFiltered' : 'hq.bestand.deck.emptyInv') | translate }}</p>
                @if (crates().length) {
                  <button type="button" scAction tier="primary" (click)="resetFilters()">{{ 'hq.bestand.deck.resetFilters' | translate }}</button>
                } @else {
                  <button type="button" scAction tier="primary" (click)="add()">{{ 'hq.bestand.addItem' | translate }}</button>
                  <a class="second" [routerLink]="nowLink.commands" [fragment]="nowLink.fragment">{{ 'hq.bestand.deck.emptyInvSecond' | translate }}</a>
                }
              </div>
            }
          </div>
          <sc-hq-stock-log class="log" [summary]="filterSummary()" [hits]="shownCrates().length" [lines]="logLines()" (wishOne)="wishLog([$event])" (reorder)="wishLog($event)" />
        </div>
      } @else {
        <div class="grid" [class.pads]="tab() === 'hangar'" [class.lockers]="tab() === 'sammlung'" role="list" [attr.aria-label]="'hq.bestand.tab.' + tab() | translate">
          @for (c of pageCells(); track cellKey(c)) {
            @if (c.kind === 'add') {
              <button type="button" class="tile add" role="listitem" [attr.aria-label]="addLabel() | translate" (click)="add()">
                <span class="plus"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span>
                <span class="add-t">{{ addLabel() | translate }}</span>
              </button>
            } @else if (c.kind === 'ship') {
              <div class="tile item ship" role="listitem" [class.focus]="focusKey() === c.ship.shipClassName.toLowerCase()">
                <a class="nm tile-link" [routerLink]="shipLink(c.ship).commands" [queryParams]="shipLink(c.ship).queryParams">{{ shipName(c.ship) }}</a>
                <span class="qty mono">×{{ c.ship.qty ?? 1 }}</span>
                <small class="where">
                  {{ shipWhere(c.ship) }}
                  @if (variantCount(c.ship); as n) { · {{ 'hq.bestand.deck.variants' | translate: { n } }} }
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
        @if (cells().length <= 1) {
          <div class="empty-area">
            @if (tab() === 'hangar') {
              <p>{{ 'hq.bestand.deck.emptyHangar' | translate }}</p>
              <button type="button" scAction tier="primary" (click)="add()">{{ 'hq.bestand.addShip' | translate }}</button>
              <a class="second" [routerLink]="importLink">{{ 'hq.bestand.deck.emptyHangarSecond' | translate }}</a>
            } @else if (art() === 'news' || art() === 'gallery') {
              <p>{{ 'hq.bestand.deck.emptyArt.' + art() | translate: { n: artCount(art()!) } }}</p>
              <a class="second" [routerLink]="art() === 'news' ? '/news' : '/verse/gallery'">{{ 'hq.bestand.deck.emptyArtGo.' + art() | translate }}</a>
            } @else if (art() !== 'ruf') {
              <p>{{ 'hq.bestand.deck.emptySammlung' | translate }}</p>
              <button type="button" scAction tier="primary" (click)="add()">{{ 'hq.bestand.addBlueprint' | translate }}</button>
              <a class="second" [routerLink]="['/codex/index']">{{ 'hq.bestand.deck.emptySammlungSecond' | translate }}</a>
            }
          </div>
        }
        @if (tab() === 'sammlung' && (!art() || art() === 'ruf')) {
          <section class="ruf panel" aria-labelledby="ruf-h" data-ruf>
            <h3 id="ruf-h">{{ 'hq.bestand.ruf' | translate }}</h3>
            <div class="empty">
              <span class="ring" aria-hidden="true"></span>
              <b>{{ 'hq.bestand.rufEmptyTitle' | translate }}</b>
              <small>{{ 'hq.bestand.rufEmptyText' | translate }}</small>
            </div>
          </section>
        }
      }

      <ng-template #wishRow let-tg>
        <span class="hint">
          @if (hint(tg); as h) { <span>{{ h.key | translate: h.params }}</span> }
          <button type="button" scAction tier="tertiary" class="nach" [attr.aria-label]="'hq.bestand.catchUpOne' | translate: { name: tg.name }"
                  [scTooltip]="'hq.bestand.catchUpOne' | translate: { name: tg.name }" scTooltipTier="label" (click)="wishTarget(tg)">
            <svg viewBox="0 0 24 24" aria-hidden="true">@for (d of cartIcon; track $index) { <path [attr.d]="d" /> }</svg>
          </button>
        </span>
      </ng-template>

      @if (selectedCrates().length) {
        <div class="selbar sc-dock-phone" role="toolbar" [attr.aria-label]="'hq.bestand.deck.selAria' | translate">
          <b>{{ 'hq.bestand.deck.selected' | translate: { n: selectedCrates().length } }}</b>
          <button type="button" scAction tier="secondary" (click)="reserveSel()">{{ 'hq.bestand.deck.reserve' | translate }}</button>
          <button type="button" scAction tier="secondary" (click)="hand('sell', selectedCrates())">{{ 'hq.bestand.deck.sell' | translate }}</button>
          <button type="button" scAction tier="secondary" (click)="hand('pickup', selectedCrates())">{{ 'hq.bestand.deck.pickup' | translate }}</button>
          <button type="button" scAction tier="secondary" tone="danger" (click)="deleteSel()">{{ 'hq.bestand.deck.delete' | translate }}</button>
          <button type="button" scAction tier="tertiary" [attr.aria-label]="'hq.bestand.deck.clearSel' | translate" [scTooltip]="'hq.bestand.deck.clearSel' | translate" scTooltipTier="label" (click)="selection.set(emptySel)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      }

      <footer class="foot">
        <span class="ticker-room" aria-hidden="true"></span>
        <sc-hq-stock-shared class="shared-slot" />
        @if (view().pages > 1) {
          <span class="pager" role="group" [attr.aria-label]="'hq.bestand.pager' | translate">
            <span class="pg" role="status">{{ 'hq.bestand.range' | translate: { from: view().from, to: view().to, total: view().total } }}</span>
            <button type="button" scAction tier="tertiary" [disabled]="view().page <= 0" [attr.aria-label]="'hq.bestand.prev' | translate" [scTooltip]="'hq.bestand.prev' | translate" scTooltipTier="label" (click)="page.set(view().page - 1)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" /></svg>
            </button>
            <button type="button" scAction tier="tertiary" [disabled]="view().page >= view().pages - 1" [attr.aria-label]="'hq.bestand.next' | translate" [scTooltip]="'hq.bestand.next' | translate" scTooltipTier="label" (click)="page.set(view().page + 1)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" /></svg>
            </button>
          </span>
        }
      </footer>
    }

    @if (popup(); as start) {
      <sc-hq-stock-popup [start]="start" (closed)="popup.set(null)" />
    }
    @if (bpPicking()) {
      <sc-hq-blueprint-picker [owned]="ownedBlueprints()" (picked)="addPickedBlueprint($event)" (closed)="bpPicking.set(false)" />
    }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); min-height: 0; padding-bottom: var(--sc-fab-clear-block, 0px); container-type: inline-size; }
      svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-3, 12px); }
      .ti { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid var(--sc-border); border-radius: 10px; color: var(--sc-accent); }
      .ti svg { width: 22px; height: 22px; }
      .ttl small { display: block; color: var(--sc-fg-2); font-size: 0.7rem; letter-spacing: .14em; text-transform: uppercase; }
      .page-title { margin: 0; font: 600 1.4rem / 1.2 var(--sc-font-display); }
      .tabs { display: inline-flex; flex-wrap: wrap; padding: 3px; border: 1px solid var(--sc-border); border-radius: 999px; background: var(--sc-bg-0); }
      .tab { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; padding: 0 14px; border-radius: 999px; color: var(--sc-fg-2); text-decoration: none; }
      .tab svg { width: 16px; height: 16px; }
      .tab:hover { color: var(--sc-fg); }
      .tab[aria-current='page'] { color: var(--sc-fg); background: color-mix(in srgb, var(--sc-accent) 20%, transparent); box-shadow: 0 0 0 1px var(--sc-accent); }
      .tab[aria-current='page'] svg { color: var(--sc-accent); }
      .tab:focus-visible, .chip:focus-visible, .tog:focus-visible, .bay:focus-visible, .mode button:focus-visible, .tile:focus-visible, .set:focus-visible, .pad:focus-visible, .lock:focus-visible, .band:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .head-r { margin-left: auto; display: inline-flex; align-items: center; gap: var(--sc-space-2, 8px); }
      .mode { display: inline-flex; padding: 3px; border: 1px solid var(--sc-border); border-radius: 10px; }
      .mode button { min-height: 28px; padding: 0 10px; border: 0; border-radius: 7px; background: none; color: var(--sc-fg-2); font: inherit; font-size: 0.8rem; cursor: pointer; }
      .mode button[aria-pressed='true'] { color: var(--sc-fg); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      .menu-wrap { position: relative; }
      .menu-wrap svg { width: 18px; height: 18px; fill: currentColor; }
      .menu { position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; min-width: 240px; margin: 0; padding: 6px; list-style: none; border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-1); box-shadow: 0 12px 32px rgb(0 0 0 / 0.5); }
      .menu a, .menu button { display: flex; align-items: center; width: 100%; min-height: 36px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--sc-fg); font: inherit; text-align: start; text-decoration: none; cursor: pointer; box-sizing: border-box; }
      .menu a:hover, .menu button:hover { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .menu .danger { color: var(--sc-danger); }
      .menu a:focus-visible, .menu button:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      .err { margin: 0; color: var(--sc-warning); }
      .state { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sc-space-2, 8px); }
      .state p { margin: 0; }
      .bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 6px; }
      .grp, .subs { display: contents; }
      .subs > .chip:first-child { margin-left: 4px; box-shadow: -8px 0 0 -6px color-mix(in srgb, var(--sc-accent) 35%, transparent); }
      .chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 1px solid var(--sc-border); border-radius: 999px; background: transparent; color: var(--sc-fg-1); font: inherit; font-size: 0.78rem; cursor: pointer; }
      .chip.sub { height: 26px; font-size: 0.72rem; border-style: dashed; }
      .chip b { color: var(--sc-fg-2); font-weight: 500; font-variant-numeric: tabular-nums; }
      .chip.zero { opacity: .45; }
      .chip:hover { border-color: var(--sc-accent); opacity: 1; }
      .chip[aria-checked='true'] { color: var(--sc-fg); border-color: var(--sc-accent); border-style: solid; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); opacity: 1; }
      .sep { width: 1px; height: 20px; background: var(--sc-border); }
      .place { margin-left: auto; }
      .tog { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border: 0; border-radius: 8px; background: none; color: var(--sc-fg-2); font: inherit; font-size: 0.78rem; cursor: pointer; }
      .tog svg { width: 14px; height: 14px; }
      .tog[aria-pressed='true'] { color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      .wishes { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; min-height: 30px; color: var(--sc-accent); font-size: 0.78rem; text-decoration: none; }
      .wishes svg { width: 14px; height: 14px; }
      .reset svg { width: 16px; height: 16px; }
      .main { display: grid; grid-template-columns: minmax(0, 1fr) 290px; grid-template-areas: 'left log'; gap: 14px; align-items: start; }
      .left { grid-area: left; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
      .log { grid-area: log; position: sticky; top: var(--sc-space-3, 12px); }
      @container (max-width: 860px) { .main { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'log' 'left'; } .log { position: static; } }
      .bays { display: flex; gap: 6px; min-height: 48px; }
      .bay { flex: 1 1 0; min-width: calc(3ch + 22px); display: flex; flex-direction: column; justify-content: center; padding: 4px 10px; border: 1px solid var(--sc-border); border-radius: 6px; color: var(--sc-fg); font: inherit; text-align: start; cursor: pointer;
        background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--sc-accent) 4%, transparent) 0 10px, transparent 10px 20px), var(--sc-bg-0); }
      .bay b { font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bay small { color: var(--sc-fg-2); font-size: 0.66rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bay[aria-pressed='true'] { border-color: var(--sc-accent); box-shadow: inset 0 0 0 1px var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .deck { display: flex; flex-direction: column; gap: 8px; }
      .lane { display: flex; gap: 10px; padding: 8px 10px; border: 1px solid var(--sc-border); border-radius: 10px; background: linear-gradient(180deg, color-mix(in srgb, var(--sc-bg-0) 40%, transparent), color-mix(in srgb, var(--sc-bg-0) 80%, transparent)); }
      .lbl { flex: none; width: 90px; display: flex; flex-direction: column; gap: 6px; color: var(--sc-fg-2); font: 600 0.62rem / 1.2 var(--sc-font-display, inherit); letter-spacing: .12em; text-transform: uppercase; }
      .lbl svg { width: 18px; height: 18px; color: var(--sc-accent); }
      .row { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
      sc-hq-crate.sz-xl { width: 190px; height: 112px; } sc-hq-crate.sz-l { width: 156px; height: 104px; } sc-hq-crate.sz-m { width: 136px; height: 96px; } sc-hq-crate.sz-s { width: 120px; height: 90px; }
      .set, .pad, .lock { display: flex; flex-direction: column; gap: 2px; width: 150px; min-height: 56px; padding: 8px 10px; border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-1); color: var(--sc-fg); font: inherit; font-size: 0.75rem; text-align: start; text-decoration: none; }
      .set small, .pad small, .lock small { color: var(--sc-fg-2); font-size: 0.66rem; }
      .set:hover, .pad:hover, .lock:hover { border-color: var(--sc-accent); }
      .set.add { justify-content: center; border-style: dashed; color: var(--sc-accent); cursor: pointer; }
      .pad { background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--sc-warning) 5%, transparent) 0 8px, transparent 8px 16px), var(--sc-bg-1); }
      .res { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-1); }
      .res header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; justify-content: space-between; }
      .res h3 { margin: 0; font: 600 1.1rem / 1.1 var(--sc-font-display, inherit); }
      .res header small { color: var(--sc-fg-2); }
      .spec { display: flex; align-items: flex-end; gap: 14px; height: 180px; padding: 0 4px; border-bottom: 1px solid var(--sc-border); overflow-x: auto; }
      .band { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; height: 100%; min-width: 52px; }
      .band b { font-size: 0.75rem; }
      .band .bar { position: relative; width: 46px; height: calc(var(--h) * 0.7); min-height: 4px; border-radius: 4px 4px 0 0; background: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-bg-1)); overflow: hidden; }
      .band .bar.hit { background: var(--sc-accent); }
      .band .rh { position: absolute; inset: auto 0 0; height: var(--r); background: repeating-linear-gradient(135deg, transparent 0 5px, rgb(0 0 0 / .45) 5px 8px); border-top: 1.5px dashed var(--sc-bg-0); }
      .band.unk .bar { background: var(--sc-border); }
      .band small { color: var(--sc-fg-2); font-size: 0.62rem; white-space: nowrap; }
      .stacks { display: flex; flex-wrap: wrap; gap: 8px; }
      .ghost, .tiers { display: grid; gap: 6px; padding: 10px; border: 1px dashed var(--sc-border); border-radius: 10px; }
      .ghost h3, .tiers h3 { margin: 0; font-size: 0.85rem; }
      .alt { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border-radius: 8px; background: var(--sc-bg-1); color: var(--sc-fg); text-decoration: none; font-size: 0.8rem; }
      .alt small { display: block; color: var(--sc-fg-2); font-size: 0.7rem; }
      a.alt:hover { outline: 1px solid var(--sc-accent); }
      .codex-hits ul { flex-direction: column; flex-wrap: nowrap; gap: 6px; }
      .codex-hits li { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .codex-hits small, .codex-hits .wished { color: var(--sc-fg-2); }
      .tiers ul { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.8rem; }
      .tiers a, .codex-tier, .second { color: var(--sc-accent); }
      .tiers small { color: var(--sc-fg-2); }
      .codex-tier { font-size: 0.8rem; }
      .empty-area { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-3, 12px); padding: var(--sc-space-4, 16px); border: 1px dashed var(--sc-border); border-radius: 12px; }
      .empty-area p { margin: 0; flex-basis: 100%; }
      .selbar { position: sticky; bottom: var(--sc-float-bottom, 12px); z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-inline-end: var(--sc-fab-clear-inline, 0px); padding: 8px 12px; border: 1px solid var(--sc-accent); border-radius: 12px; background: var(--sc-bg-1); box-shadow: 0 10px 28px rgb(0 0 0 / .45); }
      .selbar svg { width: 16px; height: 16px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(172px, 1fr)); grid-auto-rows: minmax(104px, auto); gap: 10px; align-content: start; }
      .tile { position: relative; display: flex; flex-direction: column; justify-content: space-between; gap: 2px; min-width: 0; padding: 10px 12px; border: 1px solid var(--sc-border); border-radius: 12px; background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 5%, var(--sc-bg-1)), var(--sc-bg-1)); color: var(--sc-fg); text-decoration: none; font: inherit; text-align: start; transition: border-color 0.2s, transform 0.2s; }
      .tile.add { align-items: center; justify-content: center; border-style: dashed; border-color: color-mix(in srgb, var(--sc-accent) 50%, var(--sc-border)); background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); cursor: pointer; }
      .tile.add:hover { border-color: var(--sc-accent); transform: translateY(-1px); }
      /* F2, a3-s9: Hangar reads as ship bays - a landing pad (hatched floor, ring) per ship. */
      .grid.pads { grid-template-columns: repeat(auto-fill, minmax(188px, 1fr)); grid-auto-rows: minmax(150px, auto); gap: 14px; }
      .grid.pads .tile { align-items: center; justify-content: flex-end; text-align: center; padding: 14px 10px 12px; border-radius: 8px;
        background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--sc-warning) 6%, transparent) 0 8px, transparent 8px 16px), var(--sc-bg-1); }
      .grid.pads .tile::before { content: ''; position: absolute; left: 14%; right: 14%; top: 22px; height: 62px; border: 1.5px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); border-radius: 50%; pointer-events: none; }
      .grid.pads .tile .nm { padding-right: 0; font-weight: 600; }
      .grid.pads .tile .qty { top: 8px; right: 8px; }
      .grid.pads .tile.add { background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); justify-content: center; }
      .grid.pads .tile.add::before { display: none; }
      /* F2, a3-s10: Sammlung reads as an archive - a locker (handle bar, ruled front) per entry. */
      .grid.lockers { grid-template-columns: repeat(auto-fill, minmax(172px, 1fr)); grid-auto-rows: minmax(130px, auto); gap: 10px; }
      .grid.lockers .tile { justify-content: flex-start; padding: 28px 12px 12px; border-radius: 6px;
        background: linear-gradient(90deg, color-mix(in srgb, var(--sc-fg-2) 8%, transparent) 1px, transparent 1px) 0 0 / 12px 100%, var(--sc-bg-1); }
      .grid.lockers .tile::before { content: ''; position: absolute; left: 10px; right: 10px; top: 10px; height: 6px; border-radius: 3px; background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--sc-fg-2) 40%, transparent) 0 3px, transparent 3px 6px); pointer-events: none; }
      .grid.lockers .tile.add { background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); }
      .grid.lockers .tile.add::before { display: none; }
      .plus { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; border: 1.5px dashed color-mix(in srgb, var(--sc-accent) 60%, transparent); color: var(--sc-accent); }
      .plus svg { width: 22px; height: 22px; stroke-width: 2; }
      .add-t { font-size: 0.8rem; color: var(--sc-fg-1); text-align: center; }
      .tile .nm { font-size: 0.9rem; line-height: 1.2; overflow-wrap: anywhere; padding-right: 3.2ch; }
      .tile .nm.tile-link { color: inherit; text-decoration: none; }
      .tile-link::after { content: ''; position: absolute; inset: 0; border-radius: 12px; }
      .tile-link:focus-visible { outline: none; }
      .tile-link:focus-visible::after { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .tile:has(.tile-link):hover { border-color: var(--sc-accent); transform: translateY(-1px); }
      .tile .qty { position: absolute; top: 8px; right: 12px; font: 700 1rem var(--sc-font-display, inherit); color: var(--sc-accent); pointer-events: none; }
      .tile .where { color: var(--sc-fg-2); font-size: 0.74rem; overflow-wrap: anywhere; }
      .hint { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 4px; min-height: 34px; color: var(--sc-fg-2); font-size: 0.74rem; }
      .nach svg { width: 18px; height: 18px; }
      .tile.focus { border-color: var(--sc-accent); box-shadow: 0 0 0 1px var(--sc-accent), 0 0 20px color-mix(in srgb, var(--sc-accent) 40%, transparent); animation: tile-focus 4s ease-in forwards; }
      @keyframes tile-focus { 70% { box-shadow: 0 0 0 1px var(--sc-accent), 0 0 20px color-mix(in srgb, var(--sc-accent) 40%, transparent); } 100% { box-shadow: none; border-color: var(--sc-border); } }
      .panel { padding: var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-1); }
      .panel h3 { margin: 0 0 6px; font: 600 0.95rem var(--sc-font-display, inherit); color: var(--sc-fg-1); }
      .empty { display: flex; align-items: center; gap: var(--sc-space-3, 12px); flex-wrap: wrap; }
      .empty small { color: var(--sc-fg-2); flex-basis: 100%; }
      .ring { width: 28px; height: 28px; border-radius: 50%; border: 2px dashed color-mix(in srgb, var(--sc-accent) 50%, transparent); }
      .foot { display: flex; align-items: center; gap: var(--sc-space-3, 12px); min-height: 40px; }
      .foot svg { width: 18px; height: 18px; }
      .ticker-room { flex: 0 0 min(300px, 30%); }
      .shared-slot { display: block; flex: 1; min-width: 0; }
      .pager { margin-left: auto; display: inline-flex; align-items: center; gap: var(--sc-space-1, 4px); }
      .pg { color: var(--sc-fg-2); font-size: 0.82rem; margin-right: 4px; }
      @media (pointer: coarse) { .tab, .chip, .chip.sub, .tog, .mode button, .bay, .wishes { min-height: 48px; } }
      @media (max-width: 1023px) { .ticker-room { display: none; } }
      @media (max-width: 599px) {
        .lane { flex-direction: column; }
        .lbl { width: auto; flex-direction: row; align-items: center; }
        .place { margin-left: 0; }
        .bays { flex-wrap: wrap; }
        .bay { flex-basis: 30%; }
        .head-r { margin-left: 0; }
      }
      @media (prefers-reduced-motion: reduce) { .tile { transition: none; } .tile.focus { animation: none; } }
    `,
  ],
})
export class HqStockComponent implements OnInit {
  private readonly tr = inject(TranslateService);
  readonly auth = inject(AuthService);
  readonly hangar = inject(HangarService);
  readonly inv = inject(HqInventoryService);
  private readonly live = inject(HqLiveService);
  private readonly ownership = inject(HqOwnershipService);
  private readonly shellBeta = inject(BetaService).isEnabled('shell');
  private readonly wish = inject(WishlistStore);
  private readonly stockWish = inject(StockWishService);
  protected readonly shipWishes = inject(SearchWishlistService);
  private readonly ns = inject(NachschubService);
  private readonly sammlung = inject(SammlungService);
  private readonly edge = inject(NachschubEdgeService);
  private readonly confirm = inject(ScConfirmService);
  private readonly picker = inject(NachschubTargetPicker);
  private readonly reserveDialog = inject(HqReserveDialog);
  private readonly scrapSvc = inject(ScrapInfoService);
  private readonly friends = inject(FriendsService);
  private readonly chrome = inject(ShellChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly deckRef = viewChild<ElementRef<HTMLElement>>('deck');

  protected readonly tabs = HQ_STOCK_TABS;
  protected readonly icons = PATH_ICONS;
  protected readonly laneIcon = PATH_ICONS.inventar;
  protected readonly wishIcon = PATH_ICONS.wish;
  protected readonly cartIcon = WISH_CART_ICON;
  protected readonly origins = ORIGINS;
  protected readonly roles = SHIP_ROLES;
  protected readonly sammlungKinds = SAMMLUNG_KINDS;
  protected readonly importLink = '/hq/hangar/import';
  protected readonly wishLink = hqListLink('wish');
  protected readonly nowLink = hqPage('jetzt');
  protected readonly emptySel: ReadonlySet<string> = new Set();
  protected readonly P_RES = P_RES;
  protected readonly P_FRIEND = P_FRIEND;
  protected readonly P_SCRAP = P_SCRAP;
  protected readonly P_ORIGIN = P_ORIGIN;
  protected readonly P_ROLE = P_ROLE;
  protected readonly P_ART = P_ART;

  readonly tab = signal<HqStockTab>('inventar');
  readonly mode = signal<'deck' | 'table'>('deck');
  readonly kind = signal<DeckKind | null>(null);
  readonly sub = signal<string | null>(null);
  readonly place = signal<string | null>(null);
  readonly reserved = signal(false);
  readonly friend = signal<string | null>(null);
  readonly scrapOnly = signal(false);
  readonly origin = signal<HangarShipOrigin | null>(null);
  readonly role = signal<ShipRole | null>(null);
  readonly art = signal<SammlungKind | null>(null);
  /** The subheader's text (I14: the bar IS the page search). */
  readonly q = signal('');
  readonly page = signal(0);
  readonly capacity = signal(24);
  readonly selection = signal<ReadonlySet<string>>(new Set());
  readonly popup = signal<StockStart | null>(null);
  readonly menuOpen = signal(false);
  readonly focusKey = signal<string | null>(null);
  readonly errorKey = signal<string | null>(null);
  protected readonly bpPicking = signal(false);
  protected readonly ownedBlueprints = computed(() => new Set(this.blueprints().map((b) => String(b.id).toLowerCase())));
  private pendingFocus: string | null = null;

  protected readonly isDeckTab = computed(() => this.tab() === 'inventar' || this.tab() === 'alles');
  protected readonly deckKinds = computed<readonly DeckKind[]>(() => (this.tab() === 'alles' ? ALLES_KINDS : INV_KINDS));
  protected readonly query = computed(() => parseStockQuery(this.q()));
  protected readonly minQ = computed(() => this.query().minQ);
  protected readonly filter = computed<DeckFilter>(() => {
    const k = this.kind();
    const inv: InvKind | null = k === 'ships' || k === 'sammlung' ? null : k;
    return { kind: inv, sub: this.sub(), place: this.place(), reserved: this.reserved(), friend: this.friend(), scrap: this.scrapOnly(), text: this.query().text, minQ: this.query().minQ };
  });
  protected readonly scrapOf = (c: DeckCrate) => this.scrapSvc.info(parseStockRef(c.className)?.className ?? null).state;
  private readonly scrapYes = (c: DeckCrate): boolean => this.scrapOf(c) === 'yes';
  protected readonly isSelected = (key: string): boolean => this.selection().has(key);
  protected readonly friendName = (id: string): string | null => {
    const f = this.friends.graph().friends.find((x) => x.user_id === id);
    return f ? (f.display_name || f.username) : null;
  };

  /** Friends holding a reservation in the Bestand (filter "Reserviert" grouped by friend, D2). */
  protected readonly friendOptions = computed<ScSelectOption[]>(() =>
    reservationFriends(this.crates()).map((f) => ({ value: f.id, labelKey: 'common.select.none', label: `${this.friendName(f.id) ?? f.id} (${f.count})` })),
  );

  protected readonly crates = computed(() => buildCrates(this.inv.items(), this.inv.kinds(), BLUEPRINT_PLACE));
  /** Inventar containers under the filter; on Alles with the Schiffe / Sammlung kind none. */
  protected readonly shownCrates = computed(() => {
    const k = this.kind();
    if (k === 'ships' || k === 'sammlung') return [];
    return filterCrates(this.crates(), this.filter(), this.scrapYes);
  });
  protected readonly view = computed(() => pageOf<DeckCrate | Cell>(this.isDeckTab() ? this.shownCrates() : this.cells().slice(1), this.page(), this.capacity()));
  protected readonly pageCrates = computed(() => (this.isDeckTab() ? (this.view().items as unknown as DeckCrate[]) : []));
  protected readonly lanes = computed(() => deckLanes(this.pageCrates()));
  protected readonly bays = computed(() => deckBays(this.shownCrates()));
  private readonly kindCountMap = computed(() => kindCounts(this.crates(), this.filter(), this.scrapYes, this.sets().length));
  protected readonly subs = computed(() => {
    const m = subCounts(this.crates(), this.filter(), this.scrapYes);
    return [...m.entries()].map(([id, n]) => ({ id, n }));
  });
  protected readonly placeAmounts = computed(() => placeCounts(this.crates(), this.filter(), this.scrapYes));
  protected readonly knownPlaces = computed(() => [...new Set(this.crates().map((c) => c.location))]);

  protected readonly sets = computed(() => this.hangar.roleLoadouts());
  protected readonly showSets = computed(() => this.isDeckTab() && this.mode() === 'deck' && (this.kind() === 'sets' || (!this.kind() && this.sets().length > 0 && !this.query().text && !this.place())));
  protected readonly ships = computed(() => {
    const owned = this.hangar.ships().filter((s) => s.status === 'owned');
    return flagshipFirst(owned, (c) => this.hangar.isFlagship(c));
  });
  private readonly shipRole = (s: HangarShip): ShipRole | null => this.inv.kinds().get(s.shipClassName.toLowerCase())?.role ?? null;
  private readonly shipText = (s: HangarShip): boolean => textMatches(this.shipName(s), s.shipClassName, this.query().text);
  protected readonly shownShips = computed(() =>
    this.ships().filter((s) => (!this.origin() || s.origin === this.origin()) && (!this.role() || this.shipRole(s) === this.role()) && this.shipText(s)),
  );
  protected readonly originCounts = computed(() => {
    const m = new Map<string, number>();
    for (const s of this.ships()) if (s.origin && (!this.role() || this.shipRole(s) === this.role()) && this.shipText(s)) m.set(s.origin, (m.get(s.origin) ?? 0) + 1);
    return m;
  });
  protected readonly roleCounts = computed(() => {
    const m = new Map<string, number>();
    for (const s of this.ships()) {
      const r = this.shipRole(s);
      if (r && (!this.origin() || s.origin === this.origin()) && this.shipText(s)) m.set(r, (m.get(r) ?? 0) + 1);
    }
    return m;
  });
  protected readonly blueprints = computed(() => this.sammlung.blueprints());
  protected readonly shownBlueprints = computed(() =>
    this.blueprints()
      .map((b) => ({ id: String(b.id), name: b.name ?? humanizeClassName(String(b.id)) }))
      .filter((b) => textMatches(b.name, b.id, this.query().text)),
  );

  /** Hangar / Sammlung cells; the "+" tile is always the first. */
  protected readonly cells = computed<Cell[]>(() => {
    if (this.tab() === 'hangar') return [{ kind: 'add' }, ...this.shownShips().map((ship) => ({ kind: 'ship' as const, ship }))];
    if (this.tab() === 'sammlung') {
      const a = this.art();
      const bps = !a || a === 'blueprints' ? this.shownBlueprints().map((b) => ({ kind: 'bp' as const, ...b })) : [];
      return [{ kind: 'add' }, ...bps];
    }
    return [{ kind: 'add' }];
  });
  protected readonly pageCells = computed<Cell[]>(() => [{ kind: 'add' }, ...(this.isDeckTab() ? [] : (this.view().items as unknown as Cell[]))]);

  protected readonly searchTiers = computed(() => {
    const entries: SearchEntry[] = [
      ...this.crates().map((c) => ({ area: 'inventar' as const, key: (c.className || c.name).toLowerCase(), name: c.name, className: c.className })),
      ...this.ships().map((s) => ({ area: 'hangar' as const, key: s.shipClassName.toLowerCase(), name: this.shipName(s), className: s.shipClassName })),
      ...this.blueprints().map((b) => ({ area: 'sammlung' as const, key: String(b.id).toLowerCase(), name: b.name ?? String(b.id), className: String(b.id) })),
    ];
    const t = this.tab();
    const active: SearchEntry['area'][] = t === 'alles' ? ['inventar', 'hangar', 'sammlung'] : [t];
    const tiers = tieredSearch(entries, active, this.query().text);
    const seen = new Set<string>();
    return { active: tiers.active, rest: tiers.rest.filter((e) => !seen.has(e.area + e.key) && seen.add(e.area + e.key)).slice(0, 8) };
  });
  protected readonly alts = computed(() => (this.isDeckTab() ? alternativesFor(this.crates(), this.shownCrates(), this.filter(), this.scrapYes, this.blueprints()) : null));

  protected readonly selectedCrates = computed(() => this.crates().filter((c) => this.selection().has(c.key)));
  /** I6: one material selected (any places) or the search shows one material only → its quality view. */
  protected readonly detail = computed(() => {
    if (this.mode() !== 'deck') return null;
    const sel = this.selectedCrates();
    const pool = sel.length ? sel : this.query().text ? this.shownCrates() : [];
    if (!pool.length || pool[0].unit !== 'scu') return null;
    const id = itemIdentity({ class_name: pool[0].className, name: pool[0].name });
    if (pool.some((c) => itemIdentity({ class_name: c.className, name: c.name }) !== id)) return null;
    const rows = this.inv.items().filter((r) => r.location !== BLUEPRINT_PLACE && itemIdentity(r) === id);
    const agg = aggregateQuality(rows, 'item')[0];
    if (!agg) return null;
    const bands = qualityBands(agg.stacks);
    const maxBand = Math.max(1, agg.unknownQty, ...bands.map((b) => b.qty));
    return { agg, bands, maxBand, crates: this.crates().filter((c) => itemIdentity({ class_name: c.className, name: c.name }) === id) };
  });

  protected readonly logLines = computed<LogLine[]>(() => {
    const f = this.filter();
    const keep = (location: string, name: string, className: string | null, unit: 'pcs' | 'scu'): boolean => {
      if (f.place && location !== f.place) return false;
      if (!textMatches(name, className, f.text)) return false;
      if (f.kind && f.kind !== 'sets') {
        const k = deckKindOf({ class_name: className, unit }, this.inv.kinds());
        if (k.kind !== f.kind || (f.sub && k.sub !== f.sub)) return false;
      }
      return true;
    };
    const outs: LogLine[] = this.inv
      .lastRemovals(this.live.events())
      .filter((r) => keep(r.location, r.name, r.className, r.unit))
      .map((r) => ({ key: `o:${r.key}`, at: r.at, kind: 'out' as const, name: r.name, className: r.className, qty: r.qty, unit: r.unit, place: this.crateLabel(r.location), why: r.kind }));
    const res: LogLine[] = [];
    for (const c of this.crates()) {
      if (!keep(c.location, c.name, c.className, c.unit)) continue;
      const all = [...c.anyReservations, ...c.stacks.flatMap((s) => s.reservations)];
      all.forEach((r, i) => res.push({ key: `r:${c.key}:${r.id ?? i}`, at: r.at, kind: 'reserve', name: c.name, className: c.className, qty: r.amount, unit: c.unit, place: this.crateLabel(c.location) }));
    }
    return [...outs, ...res].filter((l) => !!l.at).sort((a, b) => b.at.localeCompare(a.at));
  });
  protected readonly filterSummary = computed(() => {
    const parts: string[] = [];
    if (this.place()) parts.push(this.crateLabel(this.place()!));
    if (this.kind()) parts.push(this.tr.instant('hq.bestand.deck.kind.' + this.kind()));
    if (this.sub()) parts.push(this.tr.instant('hq.bestand.deck.sub.' + this.sub()));
    if (this.q().trim()) parts.push(`„${this.q().trim()}“`);
    return parts.length ? parts.join(' · ') : this.tr.instant('hq.bestand.deck.everything');
  });
  protected readonly anyFilter = computed(() => !!(this.kind() || this.sub() || this.place() || this.reserved() || this.scrapOnly() || this.origin() || this.role() || this.art()));
  protected readonly liveHits = computed(() => (this.isDeckTab() ? this.shownCrates().length : this.cells().length - 1));
  protected readonly deckEmpty = computed(
    () => this.isDeckTab() && !this.shownCrates().length && !this.showSets() && !(this.tab() === 'alles' && !this.kind() && (this.ships().length || this.blueprints().length)) && !(this.kind() === 'ships' && this.shownShips().length) && !(this.kind() === 'sammlung' && this.shownBlueprints().length) && !this.alts(),
  );

  private readonly codex = inject(CodexService);
  /** Codex hits of the search text (third tier, I14); each can go onto the wishlist. */
  protected readonly codexHits = signal<readonly { key: string; kind: string; className: string; name: string }[]>([]);
  protected readonly wishing = signal<string | null>(null);
  private codexTimer: ReturnType<typeof setTimeout> | null = null;
  private codexSeq = 0;

  private searchCodex(text: string): void {
    if (this.codexTimer) clearTimeout(this.codexTimer);
    const seq = ++this.codexSeq;
    if (text.trim().length < 2 || !this.isDeckTab()) {
      this.codexHits.set([]);
      return;
    }
    this.codexTimer = setTimeout(() => {
      this.codex
        .searchAll(text.trim(), 4)
        .then((res) => {
          if (seq !== this.codexSeq) return;
          const lang = toLang(this.tr.getCurrentLang() ?? this.tr.getFallbackLang());
          const seen = new Set<string>();
          const out: { key: string; kind: string; className: string; name: string }[] = [];
          for (const h of res.hits) {
            const key = `${h.kind}:${(h.classNameSlug ?? '').toLowerCase()}`;
            if (!h.classNameSlug || seen.has(key)) continue;
            seen.add(key);
            out.push({ key, kind: h.kind, className: h.classNameSlug, name: hitTitle(h, lang) });
            if (out.length >= 4) break;
          }
          this.codexHits.set(out);
        })
        .catch(() => {
          if (seq === this.codexSeq) this.codexHits.set([]);
        });
    }, 300);
  }

  protected async wishCodexHit(h: { key: string; kind: string; className: string; name: string }): Promise<void> {
    if (this.wishing()) return;
    this.wishing.set(h.key);
    try {
      const ok = await this.shipWishes.add(h.kind, h.className, h.name);
      this.errorKey.set(ok ? null : 'hq.flow.search.addFailed');
    } catch (err) {
      this.errorKey.set(toErrorKey('hq', 'wishAdd', err));
    } finally {
      this.wishing.set(null);
    }
  }

  constructor() {
    effect(() => this.searchCodex(this.query().text));
    inject(DestroyRef).onDestroy(() => {
      if (this.codexTimer) clearTimeout(this.codexTimer);
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => this.applyParams(q));
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(this.chrome.registerPageSearch(this, (term) => this.q.set(term)));
    // A new filter starts on page one; a filter never keeps a selection of what it hides.
    effect(() => {
      this.filter();
      this.tab();
      this.kind();
      this.origin();
      this.role();
      this.art();
      untracked(() => this.page.set(0));
    });
    // The Codex lanes / roles and the scrap state of what is shown (I9, H1, I18); both degrade to "other" / "unknown".
    effect(() => {
      const classes = [...new Set([...this.inv.items().map((r) => parseStockRef(r.class_name)?.className ?? ''), ...this.hangar.ships().map((s) => s.shipClassName)].filter(Boolean))];
      if (!classes.length) return;
      untracked(() => {
        void this.inv.ensureKinds(classes);
        void this.scrapSvc.load(classes);
      });
    });
    effect(() => {
      const want = this.pendingFocus;
      const cells = this.cells();
      if (!want || this.isDeckTab()) return;
      const i = cells.findIndex((c) => c.kind !== 'add' && cellId(c) === want);
      if (i < 0) return;
      untracked(() => {
        this.pendingFocus = null;
        this.page.set(Math.floor((i - 1) / Math.max(1, this.capacity())));
        this.focusKey.set(want);
      });
    });
    afterNextRender(() => {
      const fit = (): void => this.measure();
      this.measure();
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', fit, { passive: true });
        destroyRef.onDestroy(() => window.removeEventListener('resize', fit));
      }
    });
    effect(() => {
      this.tab();
      this.mode();
      this.auth.user();
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

  /**
   * F6: how many containers / tiles fit the visible area below the bar, minus the feedback launcher lane — the deck
   * pages instead of being clipped. Below the desktop frame the page scrolls: a fixed number of rows per page.
   */
  private measure(): void {
    if (typeof window === 'undefined') return;
    const el = this.deckRef()?.nativeElement ?? null;
    const w = el?.clientWidth || 900;
    const top = el?.getBoundingClientRect().top ?? 300;
    const clear = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sc-fab-clear-block')) || 72;
    const cols = Math.max(1, Math.floor((w - 100 + GAP) / (CRATE_W + GAP)));
    const rows = window.innerWidth < 1024 ? PHONE_ROWS : Math.max(2, Math.floor((window.innerHeight - top - clear - 60) / (CRATE_H + GAP)));
    const next = this.isDeckTab() ? cols * rows : Math.max(6, Math.floor((w + 10) / 182) * rows);
    if (next !== this.capacity()) this.capacity.set(next);
  }

  private applyParams(q: ParamMap): void {
    const t = hqStockTabOf(q.get(HQ_STOCK_TAB_PARAM)) ?? 'inventar';
    if (t !== this.tab()) this.selection.set(new Set());
    this.tab.set(t);
    const cat = q.get(HQ_STOCK_CAT_PARAM);
    const kinds: readonly string[] = t === 'alles' ? ALLES_KINDS : INV_KINDS;
    const k = cat && kinds.includes(cat) ? (cat as DeckKind) : null;
    this.kind.set(k);
    const sub = q.get(HQ_STOCK_SUB_PARAM);
    this.sub.set(k && sub && (SUBS_OF[k as InvKind] ?? []).includes(sub) ? sub : null);
    this.place.set(q.get(HQ_STOCK_PLACE_PARAM) || null);
    this.reserved.set(q.get(P_RES) === '1');
    this.friend.set(q.get(P_RES) === '1' ? q.get(P_FRIEND) || null : null);
    this.scrapOnly.set(q.get(P_SCRAP) === '1');
    const o = q.get(P_ORIGIN);
    this.origin.set((ORIGINS as readonly string[]).includes(o ?? '') ? (o as HangarShipOrigin) : null);
    const r = q.get(P_ROLE);
    this.role.set((SHIP_ROLES as readonly string[]).includes(r ?? '') ? (r as ShipRole) : null);
    const a = q.get(P_ART);
    this.art.set((SAMMLUNG_KINDS as readonly string[]).includes(a ?? '') ? (a as SammlungKind) : null);
    const focus = q.get(HQ_STOCK_FOCUS_PARAM);
    if (focus) this.pendingFocus = focus.toLowerCase();
  }

  /** Filter state lives in the URL (shareable, survives reload); the param subscription applies it. */
  private nav(patch: Record<string, string | null>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: patch, queryParamsHandling: 'merge', preserveFragment: true, replaceUrl: true });
  }

  protected setParam(key: string, value: string | null): void {
    this.nav({ [key]: value });
  }

  protected setToggle(key: string, on: boolean): void {
    this.nav(key === P_RES && !on ? { [key]: null, [P_FRIEND]: null } : { [key]: on ? '1' : null });
  }

  /** Clicking the active kind again returns to "Alle"; a new kind clears the sub-kind (brief f7). */
  protected setKind(k: DeckKind | null): void {
    const next = k && this.kind() === k ? null : k;
    this.nav({ [HQ_STOCK_CAT_PARAM]: next, [HQ_STOCK_SUB_PARAM]: null });
  }

  protected setSub(s: string): void {
    this.nav({ [HQ_STOCK_SUB_PARAM]: this.sub() === s ? null : s });
  }

  protected setPlace(p: string | null): void {
    this.nav({ [HQ_STOCK_PLACE_PARAM]: p });
  }

  protected resetFilters(): void {
    this.nav({ [HQ_STOCK_CAT_PARAM]: null, [HQ_STOCK_SUB_PARAM]: null, [HQ_STOCK_PLACE_PARAM]: null, [P_RES]: null, [P_FRIEND]: null, [P_SCRAP]: null, [P_ORIGIN]: null, [P_ROLE]: null, [P_ART]: null });
  }

  /** Roving focus inside a radiogroup: arrows move, Home/End jump; selection stays on Space/Enter (brief f7 keyboard). */
  protected rove(ev: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    const group = ev.currentTarget as HTMLElement;
    const radios = [...group.querySelectorAll<HTMLElement>(':scope > [role=radio]')];
    const i = radios.indexOf(ev.target as HTMLElement);
    if (i < 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const n = radios.length;
    const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + n) % n;
    radios[j].focus();
  }

  protected leaveSubs(ev: Event): void {
    ev.stopPropagation();
    ((ev.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null)?.focus();
  }

  protected kindCount(k: DeckKind): number {
    if (k === 'ships') return this.shownShips().length;
    if (k === 'sammlung') return this.shownBlueprints().length;
    return this.kindCountMap().get(k) ?? 0;
  }

  protected artCount(a: SammlungKind): number {
    if (a === 'blueprints') return this.shownBlueprints().length;
    if (a === 'ruf') return this.sammlung.rep().length;
    return a === 'news' ? this.sammlung.news().size : this.sammlung.gallery().size;
  }

  protected tabLink(t: HqStockTab): HqPageLink {
    return hqStockLink({ tab: t });
  }

  protected tabIcon(t: HqStockTab): readonly string[] {
    return t === 'hangar' ? PATH_ICONS.hangar : t === 'sammlung' ? PATH_ICONS.sammlung : PATH_ICONS.inventar;
  }

  protected restLink(e: SearchEntry): HqPageLink {
    return hqStockLink({ tab: e.area, focus: e.key });
  }

  protected setLink(id: string): string[] {
    return hqSet(id);
  }

  /** I2: a ship's hold is labelled with the ship's place — "Cutlass · Area18 (Stanton)", only without a place "Weltall". */
  protected bayLabel(location: string): { name: string; sub: string } {
    const ship = this.shipAt(location);
    if (ship) {
      const st = this.inv.shipStorage().find((s) => s.ship_ref === ship.id || s.ship_ref === ship.shipClassName);
      const p = st?.location ? placeInfo(st.location) : null;
      return { name: this.shipName(ship), sub: p ? (p.system ? `${p.name} (${p.system})` : p.name) : this.tr.instant('hq.bestand.deck.inSpace') };
    }
    const p = placeInfo(location);
    return { name: p.name, sub: placeSub(p) ?? '' };
  }

  protected readonly crateLabel = (location: string): string => {
    const b = this.bayLabel(location);
    return this.shipAt(location) ? `${b.name} · ${b.sub}` : b.name;
  };

  private shipAt(location: string): HangarShip | null {
    const f = location.trim().toLowerCase();
    if (!f) return null;
    return (
      this.hangar.ships().find((s) => s.status === 'owned' && [s.id, s.shipClassName, s.customName ?? '', humanizeClassName(s.shipClassName)].some((n) => n && n.toLowerCase() === f)) ?? null
    );
  }

  protected shipName(s: HangarShip): string {
    return s.customName || humanizeClassName(s.shipClassName);
  }

  protected shipWhere(s: HangarShip): string {
    const st = this.inv.shipStorage().find((x) => x.ship_ref === s.id || x.ship_ref === s.shipClassName);
    const parts: string[] = [];
    if (st?.location) parts.push(placeInfo(st.location).name);
    if (s.origin) parts.push(this.tr.instant('hq.bestand.deck.origin.' + s.origin));
    const r = this.shipRole(s);
    if (r) parts.push(this.tr.instant('hq.bestand.deck.role.' + r));
    return parts.join(' · ');
  }

  protected variantCount(s: HangarShip): number {
    return this.ownership.configsForShip(s.id).length;
  }

  protected sizeOf(c: DeckCrate, lane: readonly DeckCrate[]): 'xl' | 'l' | 'm' | 's' {
    const max = Math.max(...lane.map((x) => x.qty));
    const r = max > 0 ? c.qty / max : 0;
    return r >= 0.6 ? 'xl' : r >= 0.3 ? 'l' : r >= 0.12 ? 'm' : 's';
  }

  protected avgOf(c: Parameters<typeof averageLabel>[0] & Parameters<typeof rangeLabel>[0]): string | null {
    const a = averageLabel(c);
    const r = rangeLabel(c);
    return a ? (r && r !== String(c.avg) ? `${a} (${r})` : a) : null;
  }

  protected fmtNum(n: number): string {
    return n.toLocaleString(this.tr.getCurrentLang() || undefined, { maximumFractionDigits: 3 });
  }

  protected fmtQty(n: number, unit: 'pcs' | 'scu'): string {
    return unit === 'scu' ? `${this.fmtNum(n)} SCU` : `${this.fmtNum(n)}×`;
  }

  protected toggleSel(c: DeckCrate): void {
    const next = new Set(this.selection());
    if (next.has(c.key)) next.delete(c.key);
    else next.add(c.key);
    this.selection.set(next);
  }

  protected addLabel(): string {
    return this.tab() === 'hangar' ? 'hq.bestand.addShip' : this.tab() === 'sammlung' ? 'hq.bestand.addBlueprint' : 'hq.bestand.addItem';
  }

  protected cellKey(c: Cell): string {
    return `${c.kind}:${cellId(c)}`;
  }

  protected add(): void {
    if (this.isDeckTab()) this.popup.set({ mode: 'add' });
    else if (this.tab() === 'sammlung') this.bpPicking.set(true);
    else void this.addShip();
  }

  protected async addPickedBlueprint(b: PickedBlueprint): Promise<void> {
    const ok = await this.inv.addManual(BLUEPRINT_PLACE, b.name, 1, 'pcs', b.className);
    this.errorKey.set(ok ? null : (this.inv.error() ?? 'errors.generic'));
    if (ok) this.bpPicking.set(false);
  }

  private async addShip(): Promise<void> {
    const name = await this.confirm.prompt({ titleKey: 'hq.bestand.addShip', inputLabelKey: 'hq.bestand.addShipLabel', inputMaxLength: 80 });
    const n = name?.trim();
    if (!n) return;
    const copies = await this.edge.addShipCopy(n);
    this.errorKey.set(copies ? null : (this.hangar.error() ?? 'errors.generic'));
  }

  /** "+ Set anlegen" (S2): a named FPS set, then straight into its editor. */
  protected async addSet(): Promise<void> {
    const name = (await this.confirm.prompt({ titleKey: 'hq.bestand.deck.addSet', inputLabelKey: 'hq.bestand.deck.setName', inputMaxLength: 80 }))?.trim();
    if (!name) return;
    const set = await this.hangar.createRoleLoadout(name, 'fps');
    if (!set) {
      this.errorKey.set(this.hangar.error() ?? 'errors.generic');
      return;
    }
    void this.router.navigate(hqSet(set.id));
  }

  /** Abholen planen / Verkaufen / wünschen + einplanen: the Nachschub side asks where to (D5) and writes. */
  protected async hand(intent: NachschubTargetIntent, crates: readonly DeckCrate[]): Promise<void> {
    const lines = linesOf(crates, (l) => placeInfo(l).system);
    if (!lines.length) return;
    await this.openPicker(intent, lines);
  }

  protected async wishAndPlan(): Promise<void> {
    const ref = this.alts()?.elsewhere[0] ?? this.shownCrates()[0] ?? null;
    const lines: NachschubLineInput[] = [{ name: ref?.name ?? this.query().text, className: parseStockRef(ref?.className)?.className ?? null, amount: 1, unit: ref?.unit ?? 'scu', ...(this.query().minQ ? { minQuality: this.query().minQ! } : {}) }];
    await this.openPicker('buy', lines);
  }

  private async openPicker(intent: NachschubTargetIntent, lines: readonly NachschubLineInput[]): Promise<void> {
    try {
      const res = await this.picker.open({ intent, lines });
      if (res) this.selection.set(new Set());
    } catch {
      this.errorKey.set('errors.generic');
    }
  }

  /** Reservieren (I8, D2): the dialog asks for the friend or a text, amount, quality stack and expiry. */
  protected async openReserve(list: readonly DeckCrate[]): Promise<void> {
    const done = await this.reserveDialog.open(list);
    if (done) this.selection.set(new Set());
  }

  protected reserveSel(): Promise<void> {
    return this.openReserve(this.selectedCrates());
  }

  protected async deleteSel(): Promise<void> {
    const list = this.selectedCrates();
    const ok = await this.confirm.confirm({ titleKey: 'hq.bestand.deck.deleteTitle', messageKey: 'hq.bestand.deck.deleteMessage', params: { n: list.length }, confirmKey: 'hq.bestand.deck.delete', tone: 'danger' });
    if (!ok) return;
    let failed = false;
    for (const c of list) if (!(await this.inv.deleteRow({ location: c.location, name: c.name }))) failed = true;
    this.errorKey.set(failed ? (this.inv.error() ?? 'errors.generic') : null);
    this.selection.set(new Set());
  }

  protected async deleteOne(c: DeckCrate): Promise<void> {
    const ok = await this.confirm.confirm({ titleKey: 'hq.bestand.deck.deleteTitle', messageKey: 'hq.bestand.deck.deleteMessage', params: { n: 1 }, confirmKey: 'hq.bestand.deck.delete', tone: 'danger' });
    if (!ok) return;
    const done = await this.inv.deleteRow({ location: c.location, name: c.name });
    this.errorKey.set(done ? null : (this.inv.error() ?? 'errors.generic'));
  }

  protected async setAmount(c: DeckCrate, qty: number): Promise<void> {
    const done = await this.inv.setAmount({ location: c.location, name: c.name }, qty);
    this.errorKey.set(done ? null : (this.inv.error() ?? 'errors.generic'));
  }

  protected shipLink(s: HangarShip): HqLink {
    return ownShipLink(s, this.ownership.configsForShip(s.id), this.shellBeta());
  }

  protected destroyedAt(shipClassName: string): string | null {
    return lastDestroyedAt(this.live.events(), shipClassName, Date.now());
  }

  protected shipTarget(s: HangarShip): StockWishTarget {
    return this.stockWish.shipTarget(s.shipClassName, this.shipName(s));
  }

  protected blueprintTarget(c: { id: string; name: string }): StockWishTarget {
    return this.stockWish.blueprintTarget(c.id, c.name);
  }

  protected hint(t: StockWishTarget): { key: string; params: Record<string, unknown> } | null {
    return this.stockWish.hint(t);
  }

  protected async wishTarget(t: StockWishTarget): Promise<void> {
    const ok = await this.stockWish.wish(t, 1);
    this.errorKey.set(ok ? null : 'errors.generic');
  }

  protected async wishCrate(c: DeckCrate | undefined): Promise<void> {
    if (!c) return;
    const t = this.stockWish.targetOf({ className: c.className, name: c.name, unit: c.unit, cat: c.kind });
    if (!t) return;
    this.errorKey.set((await this.stockWish.wish(t, 1)) ? null : 'errors.generic');
  }

  /** I13 / I17: removals back onto the wishlist with their amounts (one line, or all of them). */
  protected async wishLog(list: readonly LogLine[]): Promise<void> {
    const single = list.length === 1;
    let failed = false;
    for (const l of list) {
      const t = this.stockWish.targetOf({ className: l.className, name: l.name, unit: l.unit });
      if (!t) continue;
      const qty = l.unit === 'scu' ? Math.max(1, Math.ceil(l.qty)) : Math.max(1, Math.round(l.qty));
      if (!(await this.stockWish.wish(t, qty, single))) failed = true;
    }
    this.errorKey.set(failed ? 'errors.generic' : null);
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
    case 'ship':
      return c.ship.shipClassName.toLowerCase();
    case 'bp':
      return c.id.toLowerCase();
  }
}

/** Re-exported for the spec: the facet logic the chips use. */
export { crateMatches };
