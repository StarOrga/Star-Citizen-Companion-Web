import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScSelectComponent, type ScSelectOption } from '../../shared/sc-select.component';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { DraftMap, EMPTY_DRAFT } from '../codex-loadout-draft';
import { CartComponentRequest, ComponentCartService } from './component-cart.service';
import {
  SAVED_LOADOUT_NAME_MAX,
  SavedLoadout,
  SavedLoadoutsService,
  layoutShareUrl,
  nextLayoutNumber,
} from './saved-loadouts.service';

/**
 * The right side of the Einsatz row (#322): ONE dropdown with "Neu" plus the
 * reader's layouts of this ship, a save icon (into the picked layout, or a
 * further one named "Layout N" while "Neu" is picked) that carries the
 * draft's "not saved" dot, copying a layout's share link, deleting one — plus
 * the prepared cart icon, disabled until a cart exists. It replaced the
 * separate ENTWURF box of the classic view, so it stays narrow enough to sit
 * beside the mission chips.
 *
 * Local per ship (SavedLoadoutsService), so a signed-out reader can use it
 * too. Recall only EMITS the loadout; the page's draft store puts it on the
 * table, exactly like a restored draft.
 */
@Component({
  selector: 'sc-codex-saved-loadouts',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScTooltipDirective, ScSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="saved" role="group" [attr.aria-label]="'codex.savedLoadouts.group' | translate">
      <!-- ONE dropdown (#322 round 3): "Neu" always on top, then this ship's
           layouts in creation order. Picking a layout puts it on the table;
           "Neu" means the next save starts a further layout. -->
      <sc-select
        class="layouts"
        [options]="layoutOptions()"
        [allowEmpty]="false"
        [value]="selectedId() ?? NEW"
        [ariaLabel]="'codex.savedLoadouts.layouts' | translate"
        (valueChange)="pick($event === NEW ? null : $event)" />
      <!-- A natively disabled button gets no pointer events, so the reason
           tooltip sits on a wrapper (same pattern as the mission chips). The
           dot is the old draft box's "nicht gespeichert", folded into the
           control that answers it. -->
      @let saveLabel = (saveKey() | translate: saveParams())
        + (dirty() ? ' (' + (dirtyKey() | translate: { n: changed() }) + ')' : '');
      <span class="wrap" [scTooltip]="saveLabel" scTooltipTier="label">
        <button type="button" scAction tier="tertiary" class="save" [class.dirty]="dirty()"
                [disabled]="!canSave()" [attr.aria-label]="saveLabel" (click)="saveNow()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" /></svg>
          @if (dirty()) { <span class="dot" aria-hidden="true"></span> }
        </button>
      </span>
      @if (selected(); as sel) {
        <button type="button" scAction tier="tertiary" class="share"
                [attr.aria-label]="'codex.savedLoadouts.share' | translate: { name: sel.name }"
                [scTooltip]="'codex.savedLoadouts.share' | translate: { name: sel.name }"
                scTooltipTier="label" (click)="shareSelected(sel)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
        </button>
        <button type="button" scAction tier="tertiary" tone="danger" class="remove"
                [attr.aria-label]="'codex.savedLoadouts.remove' | translate: { name: sel.name }"
                [scTooltip]="'codex.savedLoadouts.remove' | translate: { name: sel.name }"
                scTooltipTier="label" (click)="removeSelected(sel)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" /></svg>
        </button>
      }
      <span class="wrap" [scTooltip]="'codex.savedLoadouts.cartSoon' | translate" scTooltipTier="label">
        <button type="button" scAction tier="tertiary" class="cart"
                [disabled]="!cart.available || cartRequests().length === 0"
                [attr.aria-label]="'codex.savedLoadouts.cart' | translate"
                [attr.aria-describedby]="cart.available ? null : cartHintId"
                (click)="addToCart()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11h10.2L20 8H6.3M9.5 20a1 1 0 1 0 0-.01M16.5 20a1 1 0 1 0 0-.01" /></svg>
        </button>
      </span>
      @if (!cart.available) {
        <span [id]="cartHintId" class="sr-only">{{ 'codex.savedLoadouts.cartSoon' | translate }}</span>
      }
      <span class="status" [class.has]="!!statusKey()" role="status" aria-live="polite">{{ statusKey() ? (statusKey()! | translate) : '' }}</span>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    /* Narrow on purpose: it shares the Einsatz row with the mission chips,
       which keep their own size — this side gives way, not them. */
    .saved { position: relative; display: flex; align-items: center; gap: 4px; }
    .wrap { display: inline-flex; }
    .layouts { inline-size: 9.5rem; flex: 0 0 auto; }
    @media (pointer: fine) {
      .layouts ::ng-deep .trigger { min-height: 32px; padding: 4px 10px; font-size: max(0.78rem, var(--sc-fs-floor)); }
    }
    .save { position: relative; }
    .dot { position: absolute; top: 4px; right: 4px; width: 7px; height: 7px; border-radius: 50%;
      background: var(--sc-warn); box-shadow: 0 0 0 2px var(--sc-bg-1); }
    /* The share feedback floats under the row instead of widening it. */
    .status { position: absolute; top: calc(100% + 4px); right: 0; z-index: 5; white-space: nowrap;
      padding: 4px 8px; border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      color: var(--sc-fg-1); font-size: max(0.74rem, var(--sc-fs-floor)); }
    .status:not(.has) { width: 1px; height: 1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); }
    .save svg, .share svg, .remove svg, .cart svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  `],
})
export class CodexSavedLoadoutsComponent {
  readonly shipClassName = input.required<string>();
  readonly buildId = input<string | null>(null);
  readonly draft = input<DraftMap>(EMPTY_DRAFT);
  /** A shared link's loadout is not the reader's own — no save from here until adopted. */
  readonly readOnly = input(false);
  /** Slots the draft changed and nobody saved yet — the dot on the save icon. */
  readonly changed = input(0);

  /** A saved loadout was picked: the page puts it on the table. */
  readonly recall = output<SavedLoadout>();

  private readonly store = inject(SavedLoadoutsService);
  private readonly confirm = inject(ScConfirmService);
  private readonly t = inject(TranslateService);
  protected readonly cart = inject(ComponentCartService);

  readonly cartHintId = 'codex-saved-loadouts-cart-hint';
  /** The dropdown's "Neu" entry — no layout id can collide with it. */
  readonly NEW = '__new__';

  /** This ship's layouts in creation order — the switch keeps its order when one is re-saved. */
  readonly layouts = computed(() => {
    this.store.all();
    return this.store.layoutsOf(this.shipClassName());
  });
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(() => this.layouts().find((l) => l.id === this.selectedId()) ?? null);

  readonly layoutOptions = computed<ScSelectOption[]>(() => [
    { value: this.NEW, labelKey: 'codex.savedLoadouts.pickNew' },
    ...this.layouts().map((l) => ({ value: l.id, labelKey: '', label: l.name })),
  ]);

  readonly dirty = computed(() => this.changed() > 0 && !this.readOnly());

  /** What a press on the save icon does — the key half of its name and tooltip. */
  readonly saveKey = computed(() =>
    !this.canSave() ? 'codex.savedLoadouts.saveNothing'
      : this.selected() ? 'codex.savedLoadouts.saveInto' : 'codex.savedLoadouts.saveAsNew');
  readonly saveParams = computed(() => ({ name: this.selected()?.name ?? '' }));
  /** "n Slots geändert" while the draft is dirty — appended to the save icon's name. */
  readonly dirtyKey = computed(() => (this.changed() === 1 ? 'codex.detail.draftChanged' : 'codex.detail.draftChangedPlural'));

  /** Feedback of the last share: copied / clipboard refused. Clears itself. */
  readonly statusKey = signal<string | null>(null);
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.statusTimer) clearTimeout(this.statusTimer);
    });
  }

  readonly canSave = computed(() => !this.readOnly() && !!this.buildId() && this.draft().size > 0);

  /** What the future cart receives: every filled slot of the draft. */
  readonly cartRequests = computed<CartComponentRequest[]>(() =>
    [...this.draft().entries()]
      .filter((e): e is [string, string] => !!e[1])
      .map(([portPath, className]) => ({ className, portPath, quantity: 1 })),
  );

  /** "Layout N" — the smallest number no layout of this ship is named after yet. */
  defaultName(): string {
    const nameFor = (n: number) => this.t.instant('codex.savedLoadouts.defaultName', { n }) as string;
    return nameFor(nextLayoutNumber(this.layouts().map((l) => l.name), nameFor));
  }

  /** The save icon: into the picked layout, or a further one while "Neu" is picked. */
  saveNow(): Promise<void> | void {
    return this.selected() ? this.saveCurrent() : this.saveNew();
  }

  /** "Neues Layout": the current draft becomes a further layout; no name typed = "Layout N". */
  async saveNew(): Promise<void> {
    const buildId = this.buildId();
    if (!this.canSave() || !buildId) return;
    const fallback = this.defaultName();
    const name = await this.confirm.prompt({
      titleKey: 'codex.savedLoadouts.newTitle',
      messageKey: 'codex.savedLoadouts.newMessage',
      inputLabelKey: 'codex.savedLoadouts.nameLabel',
      inputMaxLength: SAVED_LOADOUT_NAME_MAX,
      initialValue: fallback,
      confirmKey: 'codex.savedLoadouts.saveConfirm',
    });
    if (name === null) return;
    const entry = this.store.save(this.shipClassName(), name.trim() || fallback, buildId, this.draft());
    if (entry) this.selectedId.set(entry.id);
  }

  /** "Layout speichern": the draft on the table goes into the picked layout. */
  saveCurrent(): void {
    const buildId = this.buildId();
    const sel = this.selected();
    if (!this.canSave() || !buildId || !sel) return;
    this.store.overwrite(sel.id, buildId, this.draft());
  }

  /** "Layout teilen": copy a link that opens this ship with the layout on the table. */
  async shareSelected(entry: SavedLoadout): Promise<void> {
    const url = typeof location === 'undefined' ? null : layoutShareUrl(location.href, entry);
    let ok = false;
    if (url) {
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch {
        // Clipboard refused (permissions / insecure context) — say so below.
      }
    }
    this.flash(ok ? 'codex.savedLoadouts.shareCopied' : 'codex.savedLoadouts.shareFailed');
  }

  private flash(key: string): void {
    this.statusKey.set(key);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.statusKey.set(null), 2500);
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
