import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ScSelectComponent, ScSelectOption } from '../../shared/sc-select.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { DraftMap, EMPTY_DRAFT } from '../codex-loadout-draft';
import { CartComponentRequest, ComponentCartService } from './component-cart.service';
import { SAVED_LOADOUT_NAME_MAX, SavedLoadout, SavedLoadoutsService } from './saved-loadouts.service';

/**
 * The right side of the Einsatz row (#322): save the current draft under a
 * name, call a saved one back onto the table, delete one — plus the prepared
 * "components into the cart" action, disabled until a cart exists.
 *
 * Local per ship (SavedLoadoutsService), so a signed-out reader can use it
 * too. Recall only EMITS the loadout; the page's draft store puts it on the
 * table, exactly like a restored draft.
 */
@Component({
  selector: 'sc-codex-saved-loadouts',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScSelectComponent, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="saved" role="group" [attr.aria-label]="'codex.savedLoadouts.group' | translate">
      <!-- A natively disabled button gets no pointer events, so the reason
           tooltip sits on a wrapper (same pattern as the mission chips). -->
      <span class="wrap" [scTooltip]="canSave() ? null : ('codex.savedLoadouts.saveNothing' | translate)" scTooltipTier="label">
        <button type="button" scAction tier="secondary" class="save" [disabled]="!canSave()" (click)="saveCurrent()">
          {{ 'codex.savedLoadouts.save' | translate }}
        </button>
      </span>
      @if (options().length > 0) {
        <sc-select
          class="pick"
          [options]="options()"
          [value]="selectedId()"
          placeholderKey="codex.savedLoadouts.pick"
          [ariaLabel]="'codex.savedLoadouts.pick' | translate"
          (valueChange)="pick($event)" />
        @if (selected(); as sel) {
          <button type="button" scAction tier="tertiary" tone="danger" class="remove"
                  [attr.aria-label]="'codex.savedLoadouts.remove' | translate: { name: sel.name }"
                  [scTooltip]="'codex.savedLoadouts.remove' | translate: { name: sel.name }"
                  scTooltipTier="label" (click)="removeSelected(sel)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" /></svg>
          </button>
        }
      }
      <span class="wrap" [scTooltip]="'codex.savedLoadouts.cartSoon' | translate" scTooltipTier="label">
        <button type="button" scAction tier="secondary" class="cart"
                [disabled]="!cart.available || cartRequests().length === 0"
                [attr.aria-describedby]="cart.available ? null : cartHintId"
                (click)="addToCart()">
          {{ 'codex.savedLoadouts.cart' | translate }}
        </button>
      </span>
      @if (!cart.available) {
        <span [id]="cartHintId" class="sr-only">{{ 'codex.savedLoadouts.cartSoon' | translate }}</span>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .saved { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .wrap { display: inline-flex; }
    .pick { min-width: 180px; }
    .remove svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  `],
})
export class CodexSavedLoadoutsComponent {
  readonly shipClassName = input.required<string>();
  readonly buildId = input<string | null>(null);
  readonly draft = input<DraftMap>(EMPTY_DRAFT);
  /** A shared link's loadout is not the reader's own — no save from here until adopted. */
  readonly readOnly = input(false);

  /** A saved loadout was picked: the page puts it on the table. */
  readonly recall = output<SavedLoadout>();

  private readonly store = inject(SavedLoadoutsService);
  private readonly confirm = inject(ScConfirmService);
  protected readonly cart = inject(ComponentCartService);

  readonly cartHintId = 'codex-saved-loadouts-cart-hint';

  readonly saved = computed(() => {
    const ship = this.shipClassName();
    return this.store.all()
      .filter((l) => l.shipClassName === ship)
      .slice()
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  });
  readonly options = computed<ScSelectOption[]>(() =>
    this.saved().map((l) => ({ value: l.id, labelKey: '', label: l.name })),
  );
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(() => this.saved().find((l) => l.id === this.selectedId()) ?? null);

  readonly canSave = computed(() => !this.readOnly() && !!this.buildId() && this.draft().size > 0);

  /** What the future cart receives: every filled slot of the draft. */
  readonly cartRequests = computed<CartComponentRequest[]>(() =>
    [...this.draft().entries()]
      .filter((e): e is [string, string] => !!e[1])
      .map(([portPath, className]) => ({ className, portPath, quantity: 1 })),
  );

  async saveCurrent(): Promise<void> {
    const buildId = this.buildId();
    if (!this.canSave() || !buildId) return;
    const name = await this.confirm.prompt({
      titleKey: 'codex.savedLoadouts.saveTitle',
      messageKey: 'codex.savedLoadouts.saveMessage',
      inputLabelKey: 'codex.savedLoadouts.nameLabel',
      inputMaxLength: SAVED_LOADOUT_NAME_MAX,
      initialValue: this.selected()?.name ?? '',
      confirmKey: 'codex.savedLoadouts.saveConfirm',
    });
    if (name === null) return;
    const entry = this.store.save(this.shipClassName(), name, buildId, this.draft());
    if (entry) this.selectedId.set(entry.id);
  }

  pick(id: string | null): void {
    this.selectedId.set(id);
    const entry = id ? this.store.get(id) : null;
    if (entry) this.recall.emit(entry);
  }

  async removeSelected(entry: SavedLoadout): Promise<void> {
    const ok = await this.confirm.confirm({
      titleKey: 'codex.savedLoadouts.removeTitle',
      messageKey: 'codex.savedLoadouts.removeMessage',
      params: { name: entry.name },
      confirmKey: 'codex.savedLoadouts.removeConfirm',
      tone: 'danger',
    });
    if (!ok) return;
    this.store.remove(entry.id);
    if (this.selectedId() === entry.id) this.selectedId.set(null);
  }

  addToCart(): void {
    if (!this.cart.available) return;
    void this.cart.addComponents(this.cartRequests());
  }
}
