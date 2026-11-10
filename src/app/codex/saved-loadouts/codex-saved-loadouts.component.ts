import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
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
 * The right side of the Einsatz row (#322): the reader's layouts of this ship
 * as a "Layout 1/2/…" switch, "Neues Layout" (default name "Layout N"),
 * saving the draft into the picked layout, copying a layout's share link,
 * deleting one — plus the prepared "components into the cart" action,
 * disabled until a cart exists.
 *
 * Local per ship (SavedLoadoutsService), so a signed-out reader can use it
 * too. Recall only EMITS the loadout; the page's draft store puts it on the
 * table, exactly like a restored draft.
 */
@Component({
  selector: 'sc-codex-saved-loadouts',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="saved" role="group" [attr.aria-label]="'codex.savedLoadouts.group' | translate">
      @if (layouts().length > 0) {
        <!-- The "Layout 1/2/…" switch: a segment of this ship's layouts in
             creation order; picking one puts it on the table. -->
        <div class="layouts" role="group" [attr.aria-label]="'codex.savedLoadouts.layouts' | translate">
          @for (l of layouts(); track l.id) {
            <button type="button" class="layout" [class.on]="l.id === selectedId()"
                    [attr.aria-pressed]="l.id === selectedId()" (click)="pick(l.id)">{{ l.name }}</button>
          }
        </div>
      }
      <!-- A natively disabled button gets no pointer events, so the reason
           tooltip sits on a wrapper (same pattern as the mission chips). -->
      <span class="wrap" [scTooltip]="canSave() ? null : ('codex.savedLoadouts.saveNothing' | translate)" scTooltipTier="label">
        <button type="button" scAction tier="secondary" class="new" [disabled]="!canSave()" (click)="saveNew()">
          {{ 'codex.savedLoadouts.newLayout' | translate }}
        </button>
      </span>
      @if (selected(); as sel) {
        <span class="wrap" [scTooltip]="canSave() ? ('codex.savedLoadouts.saveInto' | translate: { name: sel.name }) : ('codex.savedLoadouts.saveNothing' | translate)" scTooltipTier="label">
          <button type="button" scAction tier="secondary" class="save" [disabled]="!canSave()" (click)="saveCurrent()">
            {{ 'codex.savedLoadouts.save' | translate }}
          </button>
        </span>
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
      <span class="status" [class.has]="!!statusKey()" role="status" aria-live="polite">{{ statusKey() ? (statusKey()! | translate) : '' }}</span>
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
    .layouts { display: flex; flex-wrap: wrap; gap: 6px; }
    .layout {
      min-height: var(--sc-tap-min); padding: 0 var(--sc-space-3); border: 1px solid var(--sc-border); border-radius: 999px;
      background: none; color: var(--sc-fg-2); font: inherit; font-size: max(0.78rem, var(--sc-fs-floor)); cursor: pointer;
    }
    .layout:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .layout:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .layout.on { color: var(--sc-accent); border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
    .status { color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); }
    .status:not(.has) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .share svg, .remove svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
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
  private readonly t = inject(TranslateService);
  protected readonly cart = inject(ComponentCartService);

  readonly cartHintId = 'codex-saved-loadouts-cart-hint';

  /** This ship's layouts in creation order — the switch keeps its order when one is re-saved. */
  readonly layouts = computed(() => {
    this.store.all();
    return this.store.layoutsOf(this.shipClassName());
  });
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(() => this.layouts().find((l) => l.id === this.selectedId()) ?? null);

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
