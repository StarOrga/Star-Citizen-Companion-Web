import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { OverlayFrameComponent } from '../shared/overlay-frame/overlay-frame.component';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { HqSuppliesService, SUPPLY_NAME_MAX, SUPPLY_QTY_MAX } from './hq-supplies.service';

/**
 * "Nachschub" as a popup (shell beta, implement.md §12): a task list crossed with
 * a shopping cart - lines you tick off ("besorgt"), each with a quantity, and a
 * cart-style footer with what is still open. Built on the shared overlay frame
 * (`popup` mode): a centred sheet on desktop, a sheet on tablets, full screen in
 * `dvh` on phones. Close = X, Escape, scrim.
 */
@Component({
  selector: 'sc-hq-supplies-popup',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, OverlayFrameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-overlay-frame [heading]="'hq.supplies.title' | translate" [popup]="true" (closed)="closed.emit()">
      <form class="add" (submit)="$event.preventDefault(); add()">
        <label class="sc-sr-only" for="sup-name">{{ 'hq.supplies.add.name' | translate }}</label>
        <input id="sup-name" class="sc-input name" type="text" autocomplete="off" [maxLength]="nameMax"
               [placeholder]="'hq.supplies.add.name' | translate" [value]="name()" (input)="name.set($any($event.target).value)" />
        <label class="sc-sr-only" for="sup-qty">{{ 'hq.supplies.qty' | translate }}</label>
        <input id="sup-qty" class="sc-input qty" type="number" inputmode="numeric" min="1" [max]="qtyMax"
               [value]="qty()" (input)="qty.set($any($event.target).valueAsNumber)" />
        <button type="submit" class="sc-btn sc-btn-primary" [disabled]="!name().trim()">{{ 'hq.supplies.add.submit' | translate }}</button>
      </form>

      @if (svc.items().length === 0) {
        <div class="empty">
          <p class="empty-title">{{ 'hq.supplies.empty' | translate }}</p>
          <p class="hint">{{ 'hq.supplies.emptyHint' | translate }}</p>
        </div>
      } @else {
        <ul class="list">
          @for (i of svc.items(); track i.id) {
            <li class="line" [class.done]="i.done">
              <label class="check">
                <input type="checkbox" [checked]="i.done" (change)="svc.toggle(i.id)" />
                <span class="name-txt">{{ i.name }}</span>
              </label>
              <span class="stepper" role="group" [attr.aria-label]="'hq.supplies.qtyOf' | translate: { name: i.name }">
                <button type="button" class="step" [disabled]="i.qty <= 1" [attr.aria-label]="'hq.supplies.less' | translate"
                        [scTooltip]="'hq.supplies.less' | translate" scTooltipTier="label" (click)="svc.setQty(i.id, i.qty - 1)">−</button>
                <b class="n mono">{{ i.qty }}</b>
                <button type="button" class="step" [disabled]="i.qty >= qtyMax" [attr.aria-label]="'hq.supplies.more' | translate"
                        [scTooltip]="'hq.supplies.more' | translate" scTooltipTier="label" (click)="svc.setQty(i.id, i.qty + 1)">+</button>
              </span>
              <button type="button" class="step rm" [attr.aria-label]="'hq.supplies.remove' | translate: { name: i.name }"
                      [scTooltip]="'hq.supplies.remove' | translate: { name: i.name }" scTooltipTier="label" (click)="svc.remove(i.id)">✕</button>
            </li>
          }
        </ul>
        <footer class="cart">
          <span class="sum" role="status">{{ 'hq.supplies.sum' | translate: { open: svc.open().length, units: svc.openUnits(), done: svc.done().length } }}</span>
          @if (svc.done().length) {
            <button type="button" class="sc-btn small ghost" (click)="svc.clearDone()">{{ 'hq.supplies.clearDone' | translate }}</button>
          }
        </footer>
      }
    </sc-overlay-frame>
  `,
  styles: [
    `
      :host { display: contents; }
      .add { display: flex; gap: var(--sc-space-2, 8px); flex-wrap: wrap; margin-bottom: var(--sc-space-4, 16px); }
      .name { flex: 1 1 200px; min-width: 0; }
      .qty { width: 5.5rem; }
      .add .sc-btn { min-height: var(--sc-tap-min, 44px); }
      .empty { display: flex; flex-direction: column; gap: 6px; }
      .empty-title { margin: 0; color: var(--sc-fg-0); }
      .hint { margin: 0; color: var(--sc-fg-2); }
      .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border-top: 1px solid var(--sc-border); }
      .line { display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) 0; border-bottom: 1px solid var(--sc-border); }
      .check { display: flex; align-items: center; gap: var(--sc-space-3, 12px); flex: 1 1 auto; min-width: 0; min-height: var(--sc-tap-min, 44px); cursor: pointer; }
      .check input { width: 20px; height: 20px; flex: 0 0 auto; accent-color: var(--sc-accent); cursor: pointer; }
      .check input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .name-txt { overflow-wrap: anywhere; color: var(--sc-fg-0); }
      .line.done .name-txt { color: var(--sc-fg-2); text-decoration: line-through; }
      .stepper { display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; }
      .n { min-width: 2.2em; text-align: center; font-variant-numeric: tabular-nums; }
      .step { display: inline-grid; place-items: center; min-width: 36px; min-height: 36px; border-radius: 8px; border: 1px solid var(--sc-border);
        background: var(--sc-bg-0); color: var(--sc-fg-1); font: inherit; cursor: pointer; }
      .step:hover:not(:disabled), .step:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); outline: none; }
      .step:focus-visible { box-shadow: 0 0 0 2px var(--sc-accent); }
      .step:disabled { opacity: 0.4; cursor: default; }
      .rm { border-color: transparent; background: none; }
      .cart { display: flex; align-items: center; justify-content: space-between; gap: var(--sc-space-3, 12px); flex-wrap: wrap;
        margin-top: var(--sc-space-4, 16px); padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px); border-radius: 8px;
        background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
      .sum { color: var(--sc-fg-1); }
      @media (pointer: coarse) { .step { min-width: 44px; min-height: 44px; } }
    `,
  ],
})
export class HqSuppliesPopupComponent {
  protected readonly svc = inject(HqSuppliesService);
  readonly closed = output<void>();

  protected readonly name = signal('');
  protected readonly qty = signal(1);
  protected readonly nameMax = SUPPLY_NAME_MAX;
  protected readonly qtyMax = SUPPLY_QTY_MAX;

  protected add(): void {
    if (this.svc.add(this.name(), this.qty())) {
      this.name.set('');
      this.qty.set(1);
    }
  }
}
