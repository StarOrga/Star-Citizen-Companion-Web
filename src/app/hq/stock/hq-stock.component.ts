import { formatLocationName } from '../now/hq-live.util';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CodexService, toLang } from '../../codex/codex.service';
import { hitTitle } from '../../codex/search/codex-search-model';
import { toErrorKey } from '../../core/describe-error';
import { HqInventoryItemRow } from '../data/hq-db.types';
import { StockTarget, encodeStockRef, stockTarget } from './hq-stock-ref';

interface StockSuggestion {
  key: string;
  kind: 'ship' | 'item' | 'component' | 'weapon' | 'ammunition';
  title: string;
}
const STOCK_PICK_KINDS: readonly string[] = ['ship', 'item', 'component', 'weapon', 'ammunition'];
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { ScSelectComponent, ScSelectOption } from '../../shared/sc-select.component';
import { ScSegmentedComponent, ScSegmentOption } from '../../shared/segmented-control.component';
import { HqInventoryService, snapshotAge } from '../data/hq-inventory.service';
import { HqStatsService } from '../data/hq-stats.service';
import { HqOwnershipService } from '../hq-ownership.service';
import { hqHangar, hqLocker, hqShip } from '../hq-routes';
import { HqLiveService } from '../now/hq-live.service';
import { readLocation } from '../now/hq-live.util';
import { placeOfName } from '../plan/map/hq-places';
import { HqStockSharedComponent } from './hq-stock-shared.component';
import { StockGroup, StockSort, StockUnit, findStock, stockNames } from './hq-stock-find';

/**
 * HQ page "Bestand" (D38/D39): Schiffe (favourites + count), Sets (ship loadouts · FPS sets),
 * Erspieltes (blueprints) and Lager per Ort with the snapshot age as margin note — warning
 * colour from 7 days, never danger. "Wo liegt …?" answers the question the Lager is for: an item
 * and an amount give the places that hold it, nearest or fullest first, with the places to fetch
 * the amount from marked. A form below captures a manual item. Everything that leads somewhere is
 * a real anchor.
 */
@Component({
  selector: 'sc-hq-stock',
  standalone: true,
  imports: [TranslatePipe, RouterLink, FormsModule, ScSegmentedComponent, ScSelectComponent, HqStockSharedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="page-title" id="hq-stock-title">{{ 'hq.pages.bestand' | translate }}</h2>

    @if (!auth.user()) {
      <p class="muted" role="status">{{ 'hq.stock.signedOut' | translate }}</p>
    } @else {
      <div class="grid">
        <section class="card" aria-labelledby="hq-stock-ships">
          <h3 id="hq-stock-ships">{{ 'hq.stock.ships.title' | translate }}</h3>
          <p class="big">{{ 'hq.stock.ships.count' | translate: { n: owned() } }}</p>
          @if (favourites().length) {
            <ul class="list">
              @for (s of favourites(); track s.id) {
                <li><a [routerLink]="shipRoute(s.id)">★ {{ s.customName || s.shipClassName }}</a></li>
              }
            </ul>
          } @else {
            <p class="muted">{{ 'hq.stock.ships.noFavourites' | translate }}</p>
          }
          <a class="more" [routerLink]="hangarLink">{{ 'hq.stock.ships.open' | translate }} ›</a>
        </section>

        <section class="card" aria-labelledby="hq-stock-sets">
          <h3 id="hq-stock-sets">{{ 'hq.stock.sets.title' | translate }}</h3>
          <ul class="list">
            <li>
              <a [routerLink]="hangarLink">{{ 'hq.stock.sets.ship' | translate: { n: shipLoadouts() } }}</a>
            </li>
            <li>
              <a [routerLink]="lockerLink">{{ 'hq.stock.sets.fps' | translate: { n: hangar.roleLoadouts().length } }}</a>
            </li>
          </ul>
        </section>

        <section class="card" aria-labelledby="hq-stock-earned">
          <h3 id="hq-stock-earned">{{ 'hq.stock.earned.title' | translate }}</h3>
          @if (blueprintTotal() !== null) {
            <p class="big">{{ 'hq.stock.earned.blueprints' | translate: { n: blueprintTotal() } }}</p>
          }
          <a class="more" [routerLink]="['/codex', 'index']" [queryParams]="{ kind: 'blueprint' }">{{ 'hq.stock.earned.open' | translate }} ›</a>
        </section>
      </div>

      <sc-hq-stock-shared />

      <section class="lager" aria-labelledby="hq-stock-lager">
        <h3 id="hq-stock-lager">{{ 'hq.stock.lager.title' | translate }}</h3>

        @if (inv.error() && !inv.loaded()) {
          <div class="state" role="alert">
            <p>{{ inv.error()! | translate }}</p>
            <button type="button" class="sc-btn" (click)="inv.load()">{{ 'hq.stock.retry' | translate }}</button>
          </div>
        } @else if (inv.loaded() && !inv.locations().length && !storage().length) {
          <div class="card intro">
            <p class="intro-title" role="status">{{ 'hq.stock.lager.empty' | translate }}</p>
            <p class="muted">{{ 'hq.stock.lager.emptyHow' | translate }}</p>
          </div>
        } @else {
          @if (inv.items().length) {
            <section class="card find" aria-labelledby="hq-stock-find">
              <h4 id="hq-stock-find">{{ 'hq.stock.find.title' | translate }}</h4>
              <div class="row">
                <label class="wide">
                  <span>{{ 'hq.stock.find.item' | translate }}</span>
                  <input name="find-term" type="search" autocomplete="off" [placeholder]="'hq.stock.find.itemHint' | translate"
                         [value]="term()" (input)="term.set($any($event.target).value)" />
                </label>
                <label class="qty-f">
                  <span>{{ 'hq.stock.find.want' | translate }}</span>
                  <input name="find-want" type="number" min="0" step="any" inputmode="decimal"
                         [value]="want() ?? ''" (input)="setWant($any($event.target).valueAsNumber)" />
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
                <div class="names" role="group" [attr.aria-label]="'hq.stock.find.yours' | translate">
                  <span class="field-label">{{ 'hq.stock.find.yours' | translate }}</span>
                  @for (n of names(); track n) {
                    <button type="button" class="name" [attr.aria-pressed]="n === term()" (click)="term.set(n)">{{ n }}</button>
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
            </section>
          }

          <ul class="places">
            @for (loc of inv.locations(); track loc.snapshot.location) {
              <li class="card place">
                <div class="place-head">
                  <h4>{{ placeName(loc.snapshot.location) }}</h4>
                  <span class="age" [class.stale]="age(loc.snapshot.taken_at).stale">{{ ageText(loc.snapshot.taken_at) }}</span>
                </div>
                @if (loc.materials.length) {
                  <p class="sub">{{ 'hq.stock.lager.materials' | translate }}</p>
                  <ul class="items">
                    @for (i of loc.materials; track i.name) {
                      <li>
                        @if (target(i); as t) { <a class="entry" [routerLink]="t.commands" [queryParams]="t.queryParams">{{ i.name }}</a> } @else { <span>{{ i.name }}</span> }
                        <span class="qty">{{ i.qty }} SCU</span>
                      </li>
                    }
                  </ul>
                }
                @if (loc.pieces.length) {
                  <p class="sub">{{ 'hq.stock.lager.pieces' | translate }}</p>
                  <ul class="items">
                    @for (i of loc.pieces; track i.name) {
                      <li>
                        @if (target(i); as t) { <a class="entry" [routerLink]="t.commands" [queryParams]="t.queryParams">{{ i.name }}</a> } @else { <span>{{ i.name }}</span> }
                        <span class="qty">{{ i.qty }}×</span>
                      </li>
                    }
                  </ul>
                }
                @if (!loc.items.length) {
                  <p class="muted">{{ 'hq.stock.lager.placeEmpty' | translate }}</p>
                }
              </li>
            }
          </ul>

          @if (storage().length) {
            <div class="card">
              <h4>{{ 'hq.stock.lager.storage' | translate }}</h4>
              <ul class="items">
                @for (s of storage(); track s.ref) {
                  <li>
                    @if (s.shipId) {
                      <a [routerLink]="shipRoute(s.shipId)">{{ s.name }}</a>
                    } @else {
                      <span>{{ s.name }}</span>
                    }
                    <span class="qty">
                      {{ s.location }} ·
                      <span class="age" [class.stale]="age(s.takenAt).stale">{{ ageText(s.takenAt) }}</span>
                    </span>
                  </li>
                }
              </ul>
            </div>
          }
        }

        <form class="capture card" (submit)="$event.preventDefault(); add()" aria-labelledby="hq-stock-capture">
          <h4 id="hq-stock-capture">{{ 'hq.stock.capture.title' | translate }}</h4>
          <div class="row">
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
              <sc-segmented
                [options]="unitOptions"
                [value]="unit()"
                [ariaLabel]="'hq.stock.capture.unit' | translate"
                (valueChange)="unit.set($event === 'scu' ? 'scu' : 'pcs')" />
            </div>
          </div>
          <div class="row">
            <label class="wide">
              <span>{{ 'hq.stock.capture.location' | translate }}</span>
              <input name="location" [(ngModel)]="location" maxlength="200" autocomplete="off" [placeholder]="'hq.stock.capture.locationHint' | translate" />
            </label>
            <button type="submit" class="sc-btn" [disabled]="!valid()">{{ 'hq.stock.capture.save' | translate }}</button>
          </div>
          @if (inv.error() && inv.loaded()) {
            <p class="warn" role="alert">{{ inv.error()! | translate }}</p>
          }
        </form>
      </section>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .page-title { margin: 0 0 var(--sc-space-4, 16px); font: 600 1.6rem / 1.2 var(--sc-font-display); }
      h3 { margin: 0 0 var(--sc-space-2, 8px); font: 600 1.1rem / 1.2 var(--sc-font-display); }
      h4 { margin: 0; font: 600 1rem / 1.2 var(--sc-font-display); }
      .muted { color: var(--sc-fg-2); margin: 0; }
      .grid { display: grid; gap: var(--sc-space-3, 12px); grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); margin-bottom: var(--sc-space-6, 24px); }
      .card { background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: var(--sc-radius); padding: var(--sc-space-3, 12px); display: grid; gap: var(--sc-space-2, 8px); align-content: start; }
      .big { margin: 0; font: 600 1.4rem / 1.1 var(--sc-font-display); }
      .list, .items, .places { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sc-space-1, 4px); }
      .places { gap: var(--sc-space-3, 12px); margin: var(--sc-space-2, 8px) 0 var(--sc-space-3, 12px); }
      a { color: var(--sc-accent); }
      a:focus-visible, input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .more { justify-self: start; }
      .place-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--sc-space-2, 8px); }
      .age { color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .age.stale { color: var(--sc-warning); }
      .sub { margin: 0; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.04em; }
      .items li { display: flex; justify-content: space-between; gap: var(--sc-space-3, 12px); }
      .qty { font-variant-numeric: tabular-nums; color: var(--sc-fg-2); text-align: end; }
      .state { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sc-space-2, 8px); }
      .state p { margin: 0; }
      .capture { margin-top: var(--sc-space-3, 12px); }
      .row { display: flex; flex-wrap: wrap; gap: var(--sc-space-3, 12px); align-items: end; }
      label { display: grid; gap: var(--sc-space-1, 4px); flex: 1 1 10rem; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .field { display: grid; gap: var(--sc-space-1, 4px); }
      .field-label { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .intro-title { margin: 0; color: var(--sc-fg-0); }
      .find { margin: var(--sc-space-2, 8px) 0 var(--sc-space-3, 12px); gap: var(--sc-space-3, 12px); }
      .names { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px); }
      .name { min-height: 32px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 999px; background: transparent; color: var(--sc-fg-1); font: inherit; cursor: pointer; }
      .name:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
      .name[aria-pressed='true'] { border-color: var(--sc-accent); color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      .name:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .where { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-3, 12px); }
      .here-pick { flex: 0 1 18rem; min-width: 12rem; }
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
      label.qty-f { flex: 0 1 7rem; }
      label.wide { flex: 2 1 14rem; }
      input {
        font: inherit; color: var(--sc-fg); background: var(--sc-bg-0, var(--sc-bg-1)); border: 1px solid var(--sc-border);
        border-radius: var(--sc-radius); padding: var(--sc-space-2, 8px); min-height: 2.75rem; box-sizing: border-box; width: 100%;
      }
      .picker { position: relative; flex: 1 1 10rem; }
      .picker > label { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .msg { margin: 0; min-height: 1.2em; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .suggest { position: absolute; z-index: 5; inset-inline: 0; top: 100%; margin: 0; padding: var(--sc-space-1, 4px); list-style: none; max-height: min(18rem, 40dvh); overflow-y: auto; background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: var(--sc-radius); }
      .suggest li { display: flex; justify-content: space-between; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px); min-height: 2.75rem; align-items: center; cursor: pointer; border-radius: var(--sc-radius); }
      .suggest li:hover, .suggest li.active { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      .opt-name { min-width: 0; overflow-wrap: anywhere; color: var(--sc-fg-0); }
      .opt-kind { flex: none; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .entry { min-width: 0; overflow-wrap: anywhere; }
      .warn { margin: 0; color: var(--sc-warning); }
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

  private readonly live = inject(HqLiveService);

  readonly unitOptions: readonly ScSegmentOption[] = [
    { value: 'pcs', labelKey: 'hq.stock.capture.pcs' },
    { value: 'scu', label: 'SCU' },
  ];
  readonly sortOptions: readonly ScSegmentOption[] = [
    { value: 'nearest', labelKey: 'hq.stock.find.nearest' },
    { value: 'most', labelKey: 'hq.stock.find.most' },
  ];

  readonly term = signal('');
  readonly want = signal<number | null>(null);
  readonly findUnit = signal<StockUnit>('scu');
  /** The reader's choice; until then nearest when their place is known. */
  readonly sortChoice = signal<StockSort | null>(null);
  /** "Wo bist du gerade?" without a live position. */
  readonly manualHere = signal<string | null>(null);

  /** The place the SCC app reports, as a readable name. */
  readonly liveHere = computed(() => {
    const at = readLocation(this.live.state());
    return at ? formatLocationName(at.name) : null;
  });
  readonly hereName = computed(() => readLocation(this.live.state())?.name ?? this.manualHere());
  readonly sort = computed<StockSort>(() => this.sortChoice() ?? (this.hereName() ? 'nearest' : 'most'));
  readonly hereOptions = computed<ScSelectOption[]>(() =>
    this.inv.locations().map((l) => ({ value: l.snapshot.location, labelKey: '', label: formatLocationName(l.snapshot.location) })),
  );
  readonly names = computed(() => stockNames(this.inv.items(), this.term(), this.findUnit()));
  readonly found = computed<StockGroup[]>(() => {
    const name = this.hereName();
    return findStock(this.inv.items(), {
      term: this.term(),
      unit: this.findUnit(),
      want: this.want() ?? 0,
      here: name ? placeOfName(name, readLocation(this.live.state())?.system ?? null) : null,
      sort: this.sort(),
    });
  });

  setWant(n: number): void {
    this.want.set(Number.isFinite(n) && n > 0 ? n : null);
  }

  unitLabel(u: StockUnit): string {
    return u === 'scu' ? 'SCU' : this.translate.instant('hq.stock.find.pcsUnit');
  }

  /** The line above a result: enough at one place, enough together, or how much is missing. */
  summary(g: StockGroup): string {
    const p = { want: g.want, total: g.total, stops: g.stops, unit: this.unitLabel(g.unit) };
    if (g.want <= 0) return this.translate.instant('hq.stock.find.summaryTotal', p);
    if (!g.covered) return this.translate.instant('hq.stock.find.summaryShort', p);
    return this.translate.instant(g.stops === 1 ? 'hq.stock.find.summaryOne' : 'hq.stock.find.summaryMany', p);
  }

  /** Picker state: the typed text, the suggestions for it, and the one the reader chose. */
  readonly itemText = signal('');
  readonly suggestions = signal<StockSuggestion[]>([]);
  readonly picked = signal<StockSuggestion | null>(null);
  readonly activeIndex = signal(-1);
  readonly open = signal(false);
  readonly searchError = signal<string | null>(null);
  /** The term the suggestions answer; null while a search is pending. */
  private readonly answeredFor = signal<string | null>(null);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;
  private readonly codex = inject(CodexService);

  readonly listOpen = computed(() => this.open() && this.suggestions().length > 0);
  /** Text typed, searched, and nothing in the Codex matches it. */
  readonly unknown = computed(() => {
    const t = this.itemText().trim();
    return !!t && !this.picked() && this.answeredFor() === t && this.suggestions().length === 0 && !this.searchError();
  });
  qty: number | null = 1;
  location = '';
  readonly unit = signal<'pcs' | 'scu'>('pcs');

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

  /** Ships with their storage place; `ref` is a hangar ship id or a class name. */
  readonly storage = computed(() => {
    const ships = this.hangar.ships();
    return this.inv.shipStorage().map((s) => {
      const ship = ships.find((x) => x.id === s.ship_ref) ?? ships.find((x) => x.shipClassName === s.ship_ref);
      return {
        ref: s.ship_ref,
        shipId: ship?.id ?? null,
        name: ship?.customName || ship?.shipClassName || s.ship_ref,
        location: s.location,
        takenAt: s.taken_at,
      };
    });
  });

  ngOnInit(): void {
    if (!this.auth.user()) return;
    void this.inv.load();
    void this.ownership.ensureLoaded();
  }

  shipRoute(id: string): string[] {
    return hqShip(id);
  }

  age(takenAt: string) {
    return snapshotAge(takenAt);
  }

  /** Translation key + count of the margin note; rendered by the template's translate pipe. */
  ageText(takenAt: string): string {
    const a = snapshotAge(takenAt);
    return this.i18nAge(a.unit, a.n);
  }

  private readonly translate = inject(TranslateService);

  private i18nAge(unit: string, n: number): string {
    return this.translate.instant(`hq.stock.age.${unit}`, { n });
  }

  /** Owned ships only: a ship entry leads to the reader's own copy when there is one. */
  private readonly ownedShips = computed(() => this.hangar.ships().filter((s) => s.status === 'owned'));

  target(i: Pick<HqInventoryItemRow, 'name' | 'class_name'>): StockTarget | null {
    return stockTarget(i.name, i.class_name, this.ownedShips());
  }

  onItemInput(v: string): void {
    this.itemText.set(v);
    this.searchError.set(null);
    const t = v.trim();
    const p = this.picked();
    if (p && p.title !== t) this.picked.set(null);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchSeq++;
    if (!t) {
      this.suggestions.set([]);
      this.answeredFor.set(null);
      this.open.set(false);
      return;
    }
    if (p && p.title === t) return;
    this.answeredFor.set(null);
    this.open.set(true);
    const seq = this.searchSeq;
    this.searchTimer = setTimeout(() => void this.runSearch(t, seq), 220);
  }

  private async runSearch(t: string, seq: number): Promise<void> {
    try {
      const res = await this.codex.searchAll(t, 6);
      if (seq !== this.searchSeq) return;
      const lang = toLang(this.translate.getCurrentLang() ?? this.translate.getFallbackLang());
      const seen = new Set<string>();
      const out: StockSuggestion[] = [];
      for (const h of res.hits) {
        if (!STOCK_PICK_KINDS.includes(h.kind)) continue;
        const kind = h.kind as StockSuggestion['kind'];
        const key = encodeStockRef(kind, h.classNameSlug);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, kind, title: hitTitle(h, lang) });
        if (out.length >= 8) break;
      }
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
    this.open.set(false);
    this.activeIndex.set(-1);
  }

  closeList(): void {
    this.open.set(false);
  }

  onItemKey(e: KeyboardEvent): void {
    const n = this.suggestions().length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      this.open.set(true);
      this.activeIndex.set((this.activeIndex() + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      this.open.set(true);
      this.activeIndex.set((this.activeIndex() - 1 + n) % n);
    } else if (e.key === 'Enter' && this.listOpen() && this.activeIndex() >= 0) {
      e.preventDefault();
      this.pick(this.suggestions()[this.activeIndex()]);
    } else if (e.key === 'Escape' && this.open()) {
      e.preventDefault();
      e.stopPropagation();
      this.open.set(false);
    }
  }

  valid(): boolean {
    return !!this.picked() && this.picked()!.title === this.itemText().trim() && !!this.location.trim() && Number(this.qty) > 0;
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
    }
  }
}
