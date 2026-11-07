import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScSelectComponent, ScSelectOption } from '../../shared/sc-select.component';
import { CommodityPriceService, priceAge, type PriceAge } from './commodity-price.service';

/** Planen: commodity prices per terminal from UEX (community source), each with its age (#902). */
@Component({
  selector: 'sc-hq-commodity-prices',
  standalone: true,
  imports: [TranslatePipe, DecimalPipe, ScActionDirective, ScSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cp" aria-labelledby="hq-cp-title">
      <h2 id="hq-cp-title" class="cp-title">{{ 'hq.plan.prices.title' | translate }}</h2>
      <p class="cp-source">{{ 'hq.plan.prices.source' | translate }}</p>
      <sc-select
        [options]="options()"
        [value]="value()"
        [ariaLabel]="'hq.plan.prices.pickAria' | translate"
        placeholderKey="hq.plan.prices.pick"
        (valueChange)="pick($event)"
      />
      @if (svc.error(); as key) {
        <p class="cp-err" role="alert">
          {{ key | translate }}
          <button type="button" scAction="secondary" (click)="retry()">{{ 'hq.plan.retry' | translate }}</button>
        </p>
      } @else if (svc.loading()) {
        <p class="cp-note" role="status">{{ 'hq.plan.prices.loading' | translate }}</p>
      } @else if (svc.selectedId() === null) {
        <p class="cp-note">{{ 'hq.plan.prices.idle' | translate }}</p>
      } @else if (rows().length === 0) {
        <p class="cp-note">{{ 'hq.plan.prices.empty' | translate }}</p>
      } @else {
        <div class="sc-table-scroll">
          <table class="cp-table">
            <thead>
              <tr>
                <th scope="col">{{ 'hq.plan.prices.terminal' | translate }}</th>
                <th scope="col" class="num">{{ 'hq.plan.prices.buy' | translate }}</th>
                <th scope="col" class="num">{{ 'hq.plan.prices.sell' | translate }}</th>
                <th scope="col">{{ 'hq.plan.prices.age' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.terminalId) {
                <tr>
                  <th scope="row">{{ r.terminal }}</th>
                  <td class="num mono">{{ r.buy === null ? '-' : (r.buy | number: '1.0-0') }}</td>
                  <td class="num mono">{{ r.sell === null ? '-' : (r.sell | number: '1.0-0') }}</td>
                  <td>{{ ageKey(r.age).key | translate: { n: r.age?.n } }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .cp { display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .cp-title { margin: 0; font: 600 1rem / 1.3 var(--sc-font-display); }
      .cp-source, .cp-note { margin: 0; color: var(--sc-fg-2); }
      .cp-source { font-size: max(0.85rem, var(--sc-fs-floor)); }
      .cp-err { margin: 0; display: flex; align-items: center; flex-wrap: wrap; gap: var(--sc-space-3, 12px); color: var(--sc-warning); }
      .cp-table { min-width: 28rem; border-collapse: collapse; }
      .cp-table th, .cp-table td { padding: var(--sc-space-1, 4px) var(--sc-space-3, 12px); text-align: start; border-bottom: 1px solid var(--sc-border); }
      .cp-table th[scope='row'] { font-weight: 500; }
      .cp-table .num { text-align: end; }
    `,
  ],
})
export class HqCommodityPricesComponent implements OnInit {
  protected readonly svc = inject(CommodityPriceService);

  protected readonly options = computed<ScSelectOption[]>(() =>
    this.svc.commodities().map((c) => ({ value: String(c.id), labelKey: '', label: c.name })),
  );
  protected readonly value = computed(() => (this.svc.selectedId() === null ? null : String(this.svc.selectedId())));
  protected readonly rows = computed(() => {
    const now = Date.now();
    return this.svc
      .prices()
      .filter((p) => p.buy !== null || p.sell !== null)
      .map((p) => ({ ...p, age: priceAge(p.updatedAt, now) }))
      .sort((a, b) => (b.sell ?? 0) - (a.sell ?? 0) || a.terminal.localeCompare(b.terminal));
  });

  ngOnInit(): void {
    void this.svc.loadCommodities();
  }

  protected pick(v: string | null): void {
    void this.svc.select(v === null ? null : Number(v));
  }

  protected retry(): void {
    void this.svc.retry();
  }

  protected ageKey(age: PriceAge | null): { key: string } {
    if (!age) return { key: 'hq.plan.prices.unknownAge' };
    return { key: age.unit === 'minutes' ? 'hq.plan.prices.ageMinutes' : age.unit === 'hours' ? 'hq.plan.prices.ageHours' : 'hq.plan.prices.ageDays' };
  }
}
