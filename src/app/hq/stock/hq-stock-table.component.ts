import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { averageLabel } from '../data/hq-quality';
import type { ScrapState } from '../data/scrap-info';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import type { DeckCrate } from './hq-stock-deck';

/**
 * Tabelle (I7, screen a3-s6): the Excel-like detail mode of the deck. Amount is edited in place (Enter / blur writes,
 * `setAmount`), a wrong or outdated entry goes with the row's delete action. Selection by highlighting the row
 * (click, Space or Enter on the row), never a checkbox (I8); the bar with the actions is the page's.
 */
@Component({
  selector: 'sc-hq-stock-table',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc-table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">{{ 'hq.bestand.deck.col.item' | translate }}</th>
            <th scope="col">{{ 'hq.bestand.deck.col.place' | translate }}</th>
            <th scope="col">{{ 'hq.bestand.deck.col.quality' | translate }}</th>
            <th scope="col" class="num">{{ 'hq.bestand.deck.col.amount' | translate }}</th>
            <th scope="col" class="num">{{ 'hq.bestand.deck.col.reserved' | translate }}</th>
            <th scope="col">{{ 'hq.bestand.deck.col.scrap' | translate }}</th>
            <th scope="col"><span class="sc-sr-only">{{ 'hq.bestand.deck.col.actions' | translate }}</span></th>
          </tr>
        </thead>
        <tbody>
          @for (c of rows(); track c.key) {
            <tr tabindex="0" [class.sel]="isSelected()(c.key)" [attr.aria-selected]="isSelected()(c.key)"
                (click)="onRow($event, c)" (keydown.enter)="onRow($event, c)" (keydown.space)="onRow($event, c)">
              <th scope="row"><b>{{ c.name }}</b>@if (c.sub) { <small>{{ 'hq.bestand.deck.sub.' + c.sub | translate }}</small> }</th>
              <td>{{ placeLabel()(c.location) }}</td>
              <td class="q">{{ qText(c) }}</td>
              <td class="num">
                <input type="number" class="amt" min="0" [step]="c.unit === 'scu' ? 0.01 : 1" [value]="c.qty"
                       [attr.aria-label]="'hq.bestand.deck.editAmount' | translate: { name: c.name }"
                       (click)="$event.stopPropagation()" (keydown.enter)="commit($event, c)" (keydown.space)="$event.stopPropagation()" (change)="commit($event, c)" />
                <small>{{ c.unit === 'scu' ? 'SCU' : '×' }}</small>
              </td>
              <td class="num">{{ c.reserved ? fmt(c.reserved) : '' }}</td>
              <td><span class="scr" [attr.data-scrap]="scrap()(c)">{{ 'hq.bestand.deck.scrap.' + scrap()(c) | translate }}</span></td>
              <td class="act">
                <button type="button" scAction tier="tertiary" tone="danger" [attr.aria-label]="'hq.bestand.deck.deleteOne' | translate: { name: c.name }"
                        [scTooltip]="'hq.bestand.deck.deleteOne' | translate: { name: c.name }" scTooltipTier="label" (click)="$event.stopPropagation(); remove.emit(c)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" /></svg>
                </button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [
    `
      :host { display: block; min-width: 0; }
      table { min-width: 720px; border-collapse: collapse; font-size: 0.8rem; }
      th, td { padding: 6px 10px; border-bottom: 1px solid var(--sc-border); text-align: start; vertical-align: middle; }
      thead th { color: var(--sc-fg-2); font: 600 0.62rem / 1 var(--sc-font-display, inherit); letter-spacing: .14em; text-transform: uppercase; }
      tbody th { font-weight: 400; }
      tbody th small { display: block; color: var(--sc-fg-2); font-size: 0.68rem; }
      .num { text-align: end; white-space: nowrap; }
      tbody tr { cursor: pointer; }
      tbody tr:hover { background: color-mix(in srgb, var(--sc-accent) 6%, transparent); }
      tbody tr:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      tbody tr.sel { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); box-shadow: inset 3px 0 0 var(--sc-accent); }
      .amt { width: 7ch; min-height: 30px; padding: 0 6px; border: 1px solid var(--sc-border); border-radius: 6px; background: var(--sc-bg-0); color: var(--sc-fg); font: inherit; text-align: end; }
      .amt:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .scr[data-scrap='unknown'] { color: var(--sc-fg-2); }
      .scr[data-scrap='no'] { color: var(--sc-warning); }
      .act { width: 1%; }
      .act svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      @media (pointer: coarse) { .amt { min-height: 48px; } }
    `,
  ],
})
export class HqStockTableComponent {
  private readonly tr = inject(TranslateService);
  readonly rows = input<readonly DeckCrate[]>([]);
  readonly isSelected = input<(key: string) => boolean>(() => false);
  readonly placeLabel = input<(location: string) => string>((l) => l);
  readonly scrap = input<(c: DeckCrate) => ScrapState>(() => 'unknown');
  readonly rowToggle = output<DeckCrate>();
  readonly amountChange = output<{ crate: DeckCrate; qty: number }>();
  readonly remove = output<DeckCrate>();

  protected onRow(ev: Event, c: DeckCrate): void {
    if ((ev.target as HTMLElement).closest('input, button')) return;
    ev.preventDefault();
    this.rowToggle.emit(c);
  }

  protected commit(ev: Event, c: DeckCrate): void {
    ev.stopPropagation();
    const v = Number((ev.target as HTMLInputElement).value);
    if (!Number.isFinite(v) || v < 0 || Math.abs(v - c.qty) < 1e-9) return;
    this.amountChange.emit({ crate: c, qty: v });
  }

  protected qText(c: DeckCrate): string {
    return averageLabel(c) ?? (c.unit === 'scu' ? this.tr.instant('hq.bestand.deck.qUnknown') : '');
  }

  protected fmt(n: number): string {
    return n.toLocaleString(this.tr.getCurrentLang() || undefined, { maximumFractionDigits: 3 });
  }
}
