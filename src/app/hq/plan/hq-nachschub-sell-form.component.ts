import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HqInventoryService } from '../data/hq-inventory.service';
import type { HqInventoryItemRow } from '../data/hq-db.types';
import type { NachschubLineInput } from '../nachschub/nachschub.model';
import { ScTristateComponent } from '../../shared/tristate/sc-tristate.component';

/** One stock row as a Verkauf line: the whole amount at its place (a single stop). */
export function sellLineOf(r: Pick<HqInventoryItemRow, 'name' | 'class_name' | 'location' | 'qty' | 'unit'>): NachschubLineInput {
  return { name: r.name, className: r.class_name, amount: r.qty, unit: r.unit, stops: [{ location: r.location, amount: r.qty, done: false }] };
}

/**
 * The "Geld verdienen" part of Planen's new-Nachschub popup (D6): the aUEC goal and the items of the Bestand to sell.
 * The lines come from the Bestand, never from the wishlist; progress later comes from the sales the app reports.
 */
@Component({
  selector: 'sc-hq-nachschub-sell-form',
  standalone: true,
  imports: [FormsModule, TranslatePipe, ScTristateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="goal">
      <span>{{ 'hq.nachschub.sellForm.goal' | translate }}</span>
      <input type="text" class="input" inputmode="numeric" autocomplete="off" [ngModel]="goal()" (ngModelChange)="goal.set($event)"
             [attr.aria-invalid]="invalid() ? 'true' : null" [placeholder]="'hq.nachschub.sellForm.goalPlaceholder' | translate" />
    </label>
    @if (rows().length === 0) {
      <p class="hint">{{ 'hq.nachschub.sellForm.empty' | translate }}</p>
    } @else {
      <p class="hint">{{ 'hq.nachschub.sellForm.pickHint' | translate }}</p>
      <ul class="rows">
        @for (r of rows(); track r.location + '|' + r.name) {
          <li>
            <sc-tristate variant="checkbox" [label]="'hq.nachschub.sellForm.pick' | translate: { name: r.name, place: r.location }"
                         [value]="has(r) ? 1 : 0" (toggled)="toggle(r)" />
            <b>{{ r.name }}</b>
            <span>{{ r.qty }} {{ r.unit === 'scu' ? 'SCU' : '×' }} · {{ r.location }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); }
      .goal { display: flex; flex-direction: column; gap: 4px; }
      .goal span, .hint { color: var(--sc-fg-2); font-size: 0.82rem; margin: 0; }
      .input { min-height: 40px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-0); color: var(--sc-fg-0); font: inherit; }
      .input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .input[aria-invalid='true'] { border-color: var(--sc-warning); }
      .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .rows li { display: flex; align-items: center; gap: var(--sc-space-2, 8px); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-0); }
      .rows b { font-weight: 600; }
      .rows span { color: var(--sc-fg-2); font-size: 0.82rem; }
    `,
  ],
})
export class HqNachschubSellFormComponent {
  /** The goal as typed (parsed by `parseSellGoal` on save). */
  readonly goal = model('');
  /** The lines picked from the Bestand. */
  readonly lines = model<readonly NachschubLineInput[]>([]);
  /** The parent flags a goal it could not use. */
  readonly invalid = model(false);

  private readonly stock = inject(HqInventoryService);
  protected readonly rows = computed(() =>
    [...this.stock.items()].filter((r) => r.qty > 0).sort((a, b) => a.name.localeCompare(b.name) || a.location.localeCompare(b.location)),
  );
  private readonly keys = signal<ReadonlySet<string>>(new Set());

  private key(r: Pick<HqInventoryItemRow, 'name' | 'location'>): string {
    return `${r.location}|${r.name}`;
  }

  protected has(r: HqInventoryItemRow): boolean {
    return this.keys().has(this.key(r));
  }

  protected toggle(r: HqInventoryItemRow): void {
    const next = new Set(this.keys());
    if (!next.delete(this.key(r))) next.add(this.key(r));
    this.keys.set(next);
    this.lines.set(this.rows().filter((x) => next.has(this.key(x))).map(sellLineOf));
  }
}
