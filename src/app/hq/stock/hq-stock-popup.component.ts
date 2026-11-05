import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { OverlayFrameComponent } from '../../shared/overlay-frame/overlay-frame.component';
import { ScSelectComponent, ScSelectOption } from '../../shared/sc-select.component';
import { ScSegmentedComponent, ScSegmentOption } from '../../shared/segmented-control.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HqInventoryService, snapshotAge } from '../data/hq-inventory.service';
import { formatLocationName, readLocation } from '../now/hq-live.util';
import { HqLiveService } from '../now/hq-live.service';
import { placeOfName } from '../plan/map/hq-places';
import { StockGroup, StockSort, StockUnit, findStock, stockNames } from './hq-stock-find';
import {
  NO_FILTER,
  STOCK_CATEGORIES,
  STOCK_PAGE,
  StockCategory,
  StockFilter,
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
  imports: [TranslatePipe, FormsModule, OverlayFrameComponent, ScSegmentedComponent, ScSelectComponent, ScTooltipDirective],
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
            <sc-segmented [options]="viewOptions" [value]="view()" [ariaLabel]="'hq.stock.popup.view' | translate"
                          (valueChange)="setView($event)" />
            <span class="count" role="status">{{ 'hq.stock.popup.count' | translate: { n: rows().length } }}</span>
          </div>

          <div class="list" tabindex="0" [attr.aria-label]="'hq.stock.popup.results' | translate" (scroll)="onScroll($event)">
            @if (!inv.loaded()) {
              <p class="muted" role="status">{{ 'hq.stock.popup.loading' | translate }}</p>
            } @else if (!rows().length) {
              <p class="muted" role="status">{{ (inv.items().length ? 'hq.stock.popup.noMatch' : 'hq.stock.lager.empty') | translate }}</p>
            } @else {
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
                        @if (l.showName) { <span class="t">{{ l.row.name }}</span> }
                        @if (l.showPlace) { <span class="place" [class.t]="!l.showName">{{ l.row.location.trim() ? placeName(l.row.location) : ('hq.stock.free' | translate) }}</span> }
                      </span>
                      <span class="qty">{{ l.row.qty }} {{ unitLabel(l.row.unit) }}</span>
                    </li>
                  }
                }
              </ul>
              @if (visible().length < lines().length) {
                <p class="muted more" role="status">{{ 'hq.stock.popup.loadingMore' | translate }}</p>
              }
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
              <label>
                <span>{{ 'hq.stock.capture.item' | translate }}</span>
                <input name="item" [(ngModel)]="item" maxlength="160" autocomplete="off" [placeholder]="'hq.stock.capture.itemHint' | translate" />
              </label>
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
              <p class="ok" role="status">{{ 'hq.stock.capture.added' | translate }}</p>
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
      .state { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sc-space-2, 8px); }
      .state p { margin: 0; }
      input {
        font: inherit; color: var(--sc-fg); background: var(--sc-bg-0, var(--sc-bg-1)); border: 1px solid var(--sc-border);
        border-radius: var(--sc-radius); padding: var(--sc-space-2, 8px); min-height: 2.75rem; box-sizing: border-box; width: 100%;
      }
      input:focus-visible, .chip:focus-visible, .list:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
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
      .qty { font-variant-numeric: tabular-nums; color: var(--sc-fg-2); text-align: end; white-space: nowrap; }
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

  protected readonly placeName = formatLocationName;
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

  protected readonly places = computed(() => this.inv.snapshots().map((s) => ({ location: s.location, takenAt: s.taken_at })));
  protected readonly rows = computed(() => filterStock(this.inv.items(), this.filter(), this.places()));
  protected readonly lines = computed(() => stockLines(this.rows(), this.view()));
  protected readonly visible = computed(() => this.lines().slice(0, this.limit()));
  protected readonly placeOptions = computed<ScSelectOption[]>(() =>
    [...new Set(this.inv.items().map((i) => i.location))]
      .filter((l) => !isPlaceFree(l))
      .sort((a, b) => a.localeCompare(b))
      .map((l) => ({ value: l, labelKey: '', label: formatLocationName(l) })),
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
  protected item = '';
  protected qty: number | null = 1;
  protected location = '';
  protected readonly unit = signal<'pcs' | 'scu'>('pcs');
  protected readonly justAdded = signal(false);

  protected valid(): boolean {
    return !!this.item.trim() && !!this.location.trim() && Number(this.qty) > 0;
  }

  protected async add(): Promise<void> {
    if (!this.valid()) return;
    const ok = await this.inv.addManual(this.location, this.item, Number(this.qty), this.unit());
    if (ok) {
      this.item = '';
      this.qty = 1;
      this.justAdded.set(true);
    }
  }
}
