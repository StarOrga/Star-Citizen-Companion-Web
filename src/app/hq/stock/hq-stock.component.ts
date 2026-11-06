import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HqInventoryService } from '../data/hq-inventory.service';
import { HqStatsService } from '../data/hq-stats.service';
import { HqOwnershipService } from '../hq-ownership.service';
import { hqHangar, hqLocker, hqShip } from '../hq-routes';
import { formatLocationName } from '../now/hq-live.util';
import { StockCategory, buildOverview } from './hq-stock-model';
import { HqStockPopupComponent, StockStart } from './hq-stock-popup.component';
import { HqStockSharedComponent } from './hq-stock-shared.component';

/** How many stale places the overview names before it folds the rest into "+n". */
const STALE_SHOWN = 3;

/**
 * HQ page "Bestand": an overview that never scrolls, and a popup for everything else. The page
 * shows totals, the largest places, places whose stand is older than seven days, the categories and
 * the cards Schiffe / Sets / Erspieltes. Every number is a quick link: a button that opens the popup
 * already filtered. "Durchsuchen", "Wo liegt …?" and "Hinzufügen" open it in that mode. Links that
 * leave the page (ships, sets, blueprints) are real anchors.
 */
@Component({
  selector: 'sc-hq-stock',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ScTooltipDirective, HqStockPopupComponent, HqStockSharedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h2 class="page-title" id="hq-stock-title">{{ 'hq.pages.bestand' | translate }}</h2>
      @if (auth.user()) {
        <div class="actions">
          <button type="button" class="sc-btn" (click)="open({ mode: 'browse' })">{{ 'hq.stock.actions.browse' | translate }}</button>
          <button type="button" class="sc-btn" (click)="open({ mode: 'find' })">{{ 'hq.stock.actions.find' | translate }}</button>
          <button type="button" class="sc-btn sc-btn-primary" (click)="open({ mode: 'add' })">{{ 'hq.stock.actions.add' | translate }}</button>
        </div>
      }
    </header>

    @if (!auth.user()) {
      <p class="muted" role="status">{{ 'hq.stock.signedOut' | translate }}</p>
    } @else if (inv.error() && !inv.loaded()) {
      <div class="state" role="alert">
        <p>{{ inv.error()! | translate }}</p>
        <button type="button" class="sc-btn" (click)="inv.load()">{{ 'hq.stock.retry' | translate }}</button>
      </div>
    } @else if (inv.loaded() && !inv.items().length && !inv.locations().length) {
      <div class="card intro">
        <p class="intro-title" role="status">{{ 'hq.stock.lager.empty' | translate }}</p>
        <p class="muted">{{ 'hq.stock.lager.emptyHow' | translate }}</p>
      </div>
    } @else {
      <div class="grid">
        <section class="card totals" aria-labelledby="hq-stock-totals">
          <h3 id="hq-stock-totals">{{ 'hq.stock.totals.title' | translate }}</h3>
          <div class="nums">
            <button type="button" class="num" (click)="open({ mode: 'browse' })">
              <b>{{ ov().items }}</b><span>{{ 'hq.stock.totals.items' | translate }}</span>
            </button>
            <button type="button" class="num" (click)="open({ mode: 'browse' })">
              <b>{{ ov().places }}</b><span>{{ 'hq.stock.totals.places' | translate }}</span>
            </button>
          </div>
        </section>

        <section class="card" aria-labelledby="hq-stock-places">
          <h3 id="hq-stock-places">{{ 'hq.stock.places.title' | translate }}</h3>
          <div class="chips one">
            @for (p of ov().top; track p.location; let i = $index) {
              <button type="button" class="chip" [class.fold]="i >= 2" [scTooltip]="placeName(p.location)" scTooltipTier="label" (click)="open({ mode: 'browse', filter: { place: p.location } })">
                <span class="cl">{{ placeName(p.location) }}</span><b>{{ p.count }}</b>
              </button>
            }
            @if (ov().top.length > 2) {
              <button type="button" class="chip narrow-only plus" (click)="open({ mode: 'browse' })">+{{ ov().top.length - 2 }}</button>
            }
            @if (ov().free) {
              <button type="button" class="chip" [scTooltip]="'hq.stock.free' | translate" scTooltipTier="label" (click)="open({ mode: 'browse', filter: { place: '' } })">
                <span class="cl">{{ 'hq.stock.free' | translate }}</span><b>{{ ov().free }}</b>
              </button>
            }
          </div>
        </section>

        <section class="card" aria-labelledby="hq-stock-stale">
          <h3 id="hq-stock-stale">{{ 'hq.stock.stale.title' | translate }}</h3>
          @if (ov().stale.length) {
            <div class="chips one">
              @for (p of staleShown(); track p.location; let i = $index) {
                <button type="button" class="chip warn" [class.fold]="i >= 1" [scTooltip]="placeName(p.location)" scTooltipTier="label"
                        (click)="open({ mode: 'browse', filter: { place: p.location } })">
                  <span class="cl">{{ placeName(p.location) }}</span>
                </button>
              }
              @if (ov().stale.length > 1) {
                <button type="button" class="chip warn narrow-only plus" (click)="open({ mode: 'browse', filter: { stale: true } })">
                  +{{ ov().stale.length - 1 }}
                </button>
              }
              @if (ov().stale.length > staleShown().length) {
                <button type="button" class="chip warn wide-only plus" (click)="open({ mode: 'browse', filter: { stale: true } })">
                  +{{ ov().stale.length - staleShown().length }}
                </button>
              }
            </div>
          } @else {
            <p class="muted">{{ 'hq.stock.stale.none' | translate }}</p>
          }
        </section>

        <section class="card" aria-labelledby="hq-stock-cats">
          <h3 id="hq-stock-cats">{{ 'hq.stock.cats.title' | translate }}</h3>
          <div class="chips cats">
            @for (c of ov().cats; track c.cat) {
              <button type="button" class="chip" [scTooltip]="('hq.stock.cat.' + c.cat | translate) + ' · ' + c.count" scTooltipTier="label" (click)="openCat(c.cat)">
                <span class="cl">{{ 'hq.stock.cat.' + c.cat | translate }}</span><b>{{ c.count }}</b>
              </button>
            }
            @if (inv.shipStorage().length) {
              <button type="button" class="chip" [scTooltip]="'hq.stock.lager.storage' | translate" scTooltipTier="label" (click)="open({ mode: 'browse', filter: { ships: true } })">
                <span class="cl">{{ 'hq.stock.lager.storage' | translate }}</span><b>{{ inv.shipStorage().length }}</b>
              </button>
            }
          </div>
        </section>

        <section class="card tile" aria-labelledby="hq-stock-ships">
          <h3 id="hq-stock-ships">{{ 'hq.stock.ships.title' | translate }}</h3>
          <a class="line" [routerLink]="hangarLink">{{ 'hq.stock.ships.count' | translate: { n: owned() } }}</a>
          @if (favourites().length) {
            <ul class="favs wide-only">
              @for (s of favourites(); track s.id) {
                <li><a [routerLink]="shipRoute(s.id)">★ {{ s.customName || s.shipClassName }}</a></li>
              }
            </ul>
          } @else {
            <p class="muted wide-only">{{ 'hq.stock.ships.noFavourites' | translate }}</p>
          }
        </section>

        <section class="card tile" aria-labelledby="hq-stock-sets">
          <h3 id="hq-stock-sets">{{ 'hq.stock.sets.title' | translate }}</h3>
          <ul class="favs col">
            <li><a [routerLink]="hangarLink">{{ 'hq.stock.sets.ship' | translate: { n: shipLoadouts() } }}</a></li>
            <li><a [routerLink]="lockerLink">{{ 'hq.stock.sets.fps' | translate: { n: hangar.roleLoadouts().length } }}</a></li>
          </ul>
        </section>

        <section class="card tile" aria-labelledby="hq-stock-earned">
          <h3 id="hq-stock-earned">{{ 'hq.stock.earned.title' | translate }}</h3>
          @if (blueprintTotal() !== null) {
            <a class="line" [routerLink]="['/codex', 'index']" [queryParams]="{ kind: 'blueprint' }">{{ 'hq.stock.earned.blueprints' | translate: { n: blueprintTotal() } }}</a>
          } @else {
            <a class="line" [routerLink]="['/codex', 'index']" [queryParams]="{ kind: 'blueprint' }">{{ 'hq.stock.earned.open' | translate }} ›</a>
          }
        </section>
      </div>
    }

    @if (auth.user()) {
      <!-- Friends' shares can be many: they scroll inside their slot, the page stays one screen. -->
      <sc-hq-stock-shared class="shared-slot" />
    }

    @if (popup(); as start) {
      <sc-hq-stock-popup [start]="start" (closed)="popup.set(null)" />
    }
  `,
  styles: [
    `
      :host { display: block; container-type: inline-size; }
      .shared-slot { display: block; margin-top: var(--sc-space-3, 12px); max-height: 11rem; overflow-y: auto; }
      .shared-slot:not(:has(*)) { margin-top: 0; }
      .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sc-space-3, 12px); margin-bottom: var(--sc-space-3, 12px); }
      .page-title { margin: 0; font: 600 1.6rem / 1.2 var(--sc-font-display); }
      .actions { display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); }
      .actions .sc-btn { min-height: var(--sc-tap-min, 44px); min-width: 0; white-space: normal; overflow-wrap: anywhere; }
      h3 { margin: 0; font: 600 0.95rem / 1.2 var(--sc-font-display); color: var(--sc-fg-1); }
      .muted { color: var(--sc-fg-2); margin: 0; }
      .grid { display: grid; gap: var(--sc-space-3, 12px); grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); }
      .grid > *, .card { min-width: 0; }
      .card { background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: var(--sc-radius); padding: var(--sc-space-3, 12px); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sc-space-2, 8px); align-content: start; min-width: 0; }
      .nums { display: flex; gap: var(--sc-space-3, 12px); }
      .num { display: grid; gap: 2px; text-align: start; padding: var(--sc-space-1, 4px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-0); color: var(--sc-fg-1); font: inherit; cursor: pointer; flex: 1 1 0; min-height: var(--sc-tap-min, 44px); }
      .num b { font: 600 1.4rem / 1.1 var(--sc-font-display); color: var(--sc-fg-0); }
      .num:hover { border-color: var(--sc-accent); }
      .chips { display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); }
      .chip { min-width: 0; overflow: hidden; display: inline-flex; align-items: center; gap: var(--sc-space-2, 8px); max-width: 100%; min-height: 32px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 999px; background: transparent; color: var(--sc-fg-1); font: inherit; cursor: pointer; }
      .chip:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
      .chip.warn { color: var(--sc-warning); border-color: color-mix(in srgb, var(--sc-warning) 55%, var(--sc-border)); }
      .chip b { font-variant-numeric: tabular-nums; color: var(--sc-fg-2); }
      .cl { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      @media (pointer: coarse) { .chip { min-height: 44px; } }
      a { color: var(--sc-accent); }
      a:focus-visible, button:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .line { margin: 0; color: var(--sc-fg-0); }
      .favs { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--sc-space-1, 4px) var(--sc-space-3, 12px); }
      .favs.col { flex-direction: column; }
      .more { justify-self: start; }
      .state { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sc-space-2, 8px); }
      .state p { margin: 0; }
      .intro-title { margin: 0; color: var(--sc-fg-0); }
      .narrow-only { display: none; }
      .plus { flex: 0 0 auto; }
      .chips.one .chip:not(.plus) { flex: 1 1 0; }
      /* Narrow (container, so a phone and a test fixed at 390 px agree): one dense screen, no scrolling.
         Long chip lists fold to a few plus "+n" (the rest is one tap away in the popup). */
      @container (max-width: 520px) {
        .shared-slot { max-height: none; overflow: visible; }
        .fold, .wide-only { display: none; }
        .narrow-only { display: inline-flex; }
        .page-title { font-size: 1.3rem; }
        .head { margin-bottom: var(--sc-space-2, 8px); gap: var(--sc-space-2, 8px); }
        .actions { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr) minmax(0, 1.2fr); width: 100%; }
        .actions .sc-btn { padding-inline: var(--sc-space-1, 4px); line-height: 1.15; letter-spacing: 0; font-size: 0.8rem; }
        .tile h3 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sc-space-2, 8px); }
        .grid > .card:not(.tile) { grid-column: 1 / -1; }
        .card { padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); gap: var(--sc-space-1, 4px); }
        .totals h3 { display: none; }
        .chips { gap: var(--sc-space-1, 4px); }
        .chips.one { flex-wrap: nowrap; }
        .chips.cats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .chips.cats .chip { min-width: 0; padding-inline: var(--sc-space-2, 8px); gap: var(--sc-space-1, 4px); }
        .tile .line { font-size: max(0.85rem, var(--sc-fs-floor)); }
        .favs.col { gap: 0; }
      }
    `,
  ],
})
export class HqStockComponent implements OnInit {
  readonly placeName = formatLocationName;
  readonly auth = inject(AuthService);
  readonly hangar = inject(HangarService);
  readonly inv = inject(HqInventoryService);
  private readonly stats = inject(HqStatsService);
  private readonly ownership = inject(HqOwnershipService);

  readonly hangarLink = hqHangar;
  readonly lockerLink = hqLocker;

  /** What the popup opens with; null = closed. */
  readonly popup = signal<StockStart | null>(null);

  readonly ov = computed(() =>
    buildOverview(
      this.inv.items(),
      this.inv.snapshots().map((s) => ({ location: s.location, takenAt: s.taken_at })),
    ),
  );
  readonly staleShown = computed(() => this.ov().stale.slice(0, STALE_SHOWN));

  readonly owned = computed(() => this.hangar.ships().filter((s) => s.status === 'owned').length);
  readonly favourites = computed(() =>
    this.hangar
      .ships()
      .filter((s) => s.pinnedRank !== null && s.pinnedRank >= 1 && s.pinnedRank <= 3)
      .sort((a, b) => (a.pinnedRank ?? 9) - (b.pinnedRank ?? 9)),
  );
  readonly shipLoadouts = computed(() => this.ownership.configs().length);
  /** Blueprints received in the stats range loaded elsewhere; null until the Statistik data exists. */
  readonly blueprintTotal = computed(() => this.stats.stats()?.blueprints.total ?? null);

  ngOnInit(): void {
    if (!this.auth.user()) return;
    void this.inv.load();
    void this.ownership.ensureLoaded();
  }

  open(start: StockStart): void {
    this.popup.set(start);
  }

  openCat(cat: StockCategory): void {
    this.open({ mode: 'browse', filter: { cat } });
  }

  shipRoute(id: string): string[] {
    return hqShip(id);
  }
}
