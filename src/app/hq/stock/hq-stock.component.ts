import { formatLocationName } from '../now/hq-live.util';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { ScSegmentedComponent, ScSegmentOption } from '../../shared/segmented-control.component';
import { HqInventoryService, snapshotAge } from '../data/hq-inventory.service';
import { HqStatsService } from '../data/hq-stats.service';
import { HqOwnershipService } from '../hq-ownership.service';
import { hqHangar, hqLocker, hqShip } from '../hq-routes';

/**
 * HQ page "Bestand" (D38/D39): Schiffe (favourites + count), Sets (ship loadouts · FPS sets),
 * Erspieltes (blueprints) and Lager per Ort with the snapshot age as margin note — warning
 * colour from 7 days, never danger. "liegt in …" captures a manual item. Everything that
 * leads somewhere is a real anchor.
 */
@Component({
  selector: 'sc-hq-stock',
  standalone: true,
  imports: [TranslatePipe, RouterLink, FormsModule, ScSegmentedComponent],
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
          <a class="more" [routerLink]="['/codex']" [queryParams]="{ kind: 'blueprint' }">{{ 'hq.stock.earned.open' | translate }} ›</a>
        </section>
      </div>

      <section class="lager" aria-labelledby="hq-stock-lager">
        <h3 id="hq-stock-lager">{{ 'hq.stock.lager.title' | translate }}</h3>

        @if (inv.error() && !inv.loaded()) {
          <div class="state" role="alert">
            <p>{{ inv.error()! | translate }}</p>
            <button type="button" class="sc-btn" (click)="inv.load()">{{ 'hq.stock.retry' | translate }}</button>
          </div>
        } @else if (inv.loaded() && !inv.locations().length && !storage().length) {
          <p class="muted" role="status">{{ 'hq.stock.lager.empty' | translate }}</p>
        } @else {
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
                      <li><span>{{ i.name }}</span><span class="qty">{{ i.qty }} SCU</span></li>
                    }
                  </ul>
                }
                @if (loc.pieces.length) {
                  <p class="sub">{{ 'hq.stock.lager.pieces' | translate }}</p>
                  <ul class="items">
                    @for (i of loc.pieces; track i.name) {
                      <li><span>{{ i.name }}</span><span class="qty">{{ i.qty }}×</span></li>
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
            <label>
              <span>{{ 'hq.stock.capture.item' | translate }}</span>
              <input name="item" [(ngModel)]="item" maxlength="160" autocomplete="off" />
            </label>
            <label class="qty-f">
              <span>{{ 'hq.stock.capture.qty' | translate }}</span>
              <input name="qty" type="number" min="0.01" step="any" inputmode="decimal" [(ngModel)]="qty" />
            </label>
            <sc-segmented
              [options]="unitOptions"
              [value]="unit()"
              [ariaLabel]="'hq.stock.capture.unit' | translate"
              (valueChange)="unit.set($event === 'scu' ? 'scu' : 'pcs')" />
          </div>
          <div class="row">
            <label class="wide">
              <span>{{ 'hq.stock.capture.location' | translate }}</span>
              <input name="location" [(ngModel)]="location" maxlength="200" autocomplete="off" />
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
      .page-title { margin: 0 0 var(--sc-space-3, 12px); font: 600 1.6rem / 1.2 var(--sc-font-display); }
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
      .age { color: var(--sc-fg-2); font-size: var(--sc-fs-floor, 0.8rem); }
      .age.stale { color: var(--sc-warning); }
      .sub { margin: 0; color: var(--sc-fg-2); font-size: var(--sc-fs-floor, 0.8rem); text-transform: uppercase; letter-spacing: 0.04em; }
      .items li { display: flex; justify-content: space-between; gap: var(--sc-space-3, 12px); }
      .qty { font-variant-numeric: tabular-nums; color: var(--sc-fg-2); text-align: end; }
      .state { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sc-space-2, 8px); }
      .state p { margin: 0; }
      .capture { margin-top: var(--sc-space-3, 12px); }
      .row { display: flex; flex-wrap: wrap; gap: var(--sc-space-3, 12px); align-items: end; }
      label { display: grid; gap: var(--sc-space-1, 4px); flex: 1 1 10rem; font-size: var(--sc-fs-floor, 0.8rem); color: var(--sc-fg-2); }
      label.qty-f { flex: 0 1 7rem; }
      label.wide { flex: 2 1 14rem; }
      input {
        font: inherit; color: var(--sc-fg); background: var(--sc-bg-0, var(--sc-bg-1)); border: 1px solid var(--sc-border);
        border-radius: var(--sc-radius); padding: var(--sc-space-2, 8px); min-height: 2.75rem; box-sizing: border-box; width: 100%;
      }
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

  readonly unitOptions: readonly ScSegmentOption[] = [
    { value: 'pcs', labelKey: 'hq.stock.capture.pcs' },
    { value: 'scu', label: 'SCU' },
  ];

  item = '';
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

  valid(): boolean {
    return !!this.item.trim() && !!this.location.trim() && Number(this.qty) > 0;
  }

  async add(): Promise<void> {
    if (!this.valid()) return;
    const ok = await this.inv.addManual(this.location, this.item, Number(this.qty), this.unit());
    if (ok) {
      this.item = '';
      this.qty = 1;
    }
  }
}
