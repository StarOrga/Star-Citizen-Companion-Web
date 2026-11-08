import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { HangarShip } from '../../hangar/hangar.types';
import { HqItemMarksService, HQ_ITEM_NOTE_MAX } from '../../hq/data/hq-item-marks.service';
import { ItemPathService, ownWordOf, type PathResult } from '../../hq/data/item-path.service';
import { cartLinkParams, hqStockLink } from '../../hq/hq-routes';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { CodexOwnShipActionsComponent } from '../holo/codex-own-ship-actions.component';
import { OWN_ICONS } from './codex-own-segment.component';

const WISH_ICON = 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z';
const CRATE_ICON = 'M4 7h16v13H4zM4 7l2-3h12l2 3M9 11h6';
const FLASH_MS = 1400;

/**
 * The ownership card on top of the ship's side column / Holotisch panel and the item panel
 * (concept codex-kopf-besitz C5/C7). Not owned: "Haben?" - Wunschliste and Hangar (Inventar)
 * as secondary pills; once wished a quantity stepper and "Wunschliste öffnen". Owned ship:
 * "Dein Exemplar" - the custom name, rename / note / pin / remove (the Holotisch's former
 * own-ship icons), the Nachschub hint, "Im HQ zeigen", "Noch eins wünschen". Owned item:
 * "Dein Bestand" - the Inventar stepper, note, pin, remove, "Im HQ zeigen", "Noch eins wünschen".
 * Stock writes go through `ItemPathService`; an item's note and pin live in `hq_item_marks`
 * (`HqItemMarksService`). No variant select:
 * that lives in the head strip.
 */
@Component({
  selector: 'sc-codex-own-card',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ScActionDirective, ScTooltipDirective, CodexOwnShipActionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sc-own-card', tabindex: '-1', '[class.flash]': 'flashing()', '[class.mine]': 'owned()' },
  template: `
    @if (owned()) {
      <h3 class="oc-h">{{ (isShip() ? 'codex.ownCard.mineShip' : sammlung() ? 'codex.ownCard.mineBlueprint' : 'codex.ownCard.mineItem') | translate }}</h3>
      @if (isShip()) {
        <div class="oc-row">
          <span class="oc-name">{{ shipName() }}</span>
          <span class="oc-grow"></span>
          @if (ship(); as s) { <sc-codex-own-ship-actions [ship]="s" /> }
        </div>
        @if (nachschubName(); as n) {
          <div class="oc-row">
            <span class="oc-hq">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="crateIcon" /></svg>
              {{ 'codex.ownCard.inNachschub' | translate: { name: n } }}
            </span>
          </div>
        }
      } @else {
        <div class="oc-row">
          @if (sammlung()) {
            <span class="oc-dim oc-collected">{{ 'codex.ownCard.collected' | translate }}</span>
          } @else {
          <span class="oc-step" role="group" [attr.aria-label]="'codex.ownCard.qtyAria' | translate: { name: label() }">
            <button type="button" class="st" [disabled]="busy()" [attr.aria-label]="'codex.ownCard.less' | translate"
                    [scTooltip]="'codex.ownCard.less' | translate" scTooltipTier="label" (click)="stepStock(-1)">−</button>
            <b class="mono">{{ state().inventarQty }}</b>
            <button type="button" class="st" [disabled]="busy()" [attr.aria-label]="'codex.ownCard.more' | translate"
                    [scTooltip]="'codex.ownCard.more' | translate" scTooltipTier="label" (click)="stepStock(1)">+</button>
          </span>
          <span class="oc-dim">{{ 'codex.ownCard.inInventar' | translate }}</span>
          }
          <span class="oc-grow"></span>
          <button type="button" scAction tier="tertiary" class="oc-note" [attr.aria-label]="'codex.own.note' | translate"
                  [scTooltip]="'codex.own.note' | translate" scTooltipTier="label" (click)="editNote()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v12l-4 4H5V4zM9 9h6M9 13h4" /></svg>
          </button>
          <button type="button" scAction tier="tertiary" class="oc-pin" [attr.aria-pressed]="pinned()"
                  [attr.aria-label]="(pinned() ? 'codex.own.unpin' : 'codex.own.pin') | translate"
                  [scTooltip]="(pinned() ? 'codex.own.unpin' : 'codex.own.pin') | translate" scTooltipTier="label" (click)="togglePin()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2h-4v6l-1 1-1-1v-6H7v-2l3-3-1-6z" [attr.fill]="pinned() ? 'currentColor' : 'none'" /></svg>
          </button>
          <button type="button" scAction tier="tertiary" tone="danger" class="oc-remove" [busy]="busy()"
                  [attr.aria-label]="removeKey() | translate" [scTooltip]="removeKey() | translate"
                  scTooltipTier="label" (click)="removeItem()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" /></svg>
          </button>
        </div>
        @if (itemNote(); as n) { <p class="oc-note-text">{{ n }}</p> }
      }
      <div class="oc-row">
        <a class="oc-link" [routerLink]="hqLink().commands" [queryParams]="hqLink().queryParams" [fragment]="hqLink().fragment">
          {{ 'codex.ownCard.showInHq' | translate }} <span aria-hidden="true">↗</span>
        </a>
        @if (!sammlung()) {
          <span class="oc-grow"></span>
          <button type="button" scAction tier="secondary" class="oc-again" [busy]="busy()" (click)="wishAgain()">
            <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="wishIcon" /></svg>
            <span>{{ 'codex.ownCard.wishAgain' | translate }}</span>
          </button>
        }
      </div>
    } @else {
      <h3 class="oc-h">{{ 'codex.ownCard.haveTitle' | translate }}</h3>
      @if (!state().signedIn) {
        <p class="oc-dim">{{ 'codex.ownCard.signedOut' | translate }}</p>
        <div class="oc-row"><a scAction tier="secondary" routerLink="/login">{{ 'codex.ownCard.signIn' | translate }}</a></div>
      } @else {
        <p class="oc-dim">
          @if (state().wished) { {{ 'codex.ownCard.wished' | translate: { n: state().wishQty } }} }
          @else { {{ (isShip() ? 'codex.ownCard.noneShip' : (word() === 'sammlung' ? 'codex.ownCard.noneSammlung' : 'codex.ownCard.noneItem')) | translate }} }
        </p>
        <div class="oc-row">
          @if (state().wished) {
            <span class="oc-step" role="group" [attr.aria-label]="'codex.ownCard.wishQtyAria' | translate: { name: label() }">
              <button type="button" class="st" [disabled]="busy()" [attr.aria-label]="'codex.ownCard.less' | translate"
                      [scTooltip]="'codex.ownCard.less' | translate" scTooltipTier="label" (click)="stepWish(-1)">−</button>
              <b class="mono">{{ state().wishQty }}</b>
              <button type="button" class="st" [disabled]="busy()" [attr.aria-label]="'codex.ownCard.more' | translate"
                      [scTooltip]="'codex.ownCard.more' | translate" scTooltipTier="label" (click)="stepWish(1)">+</button>
            </span>
            <a class="oc-link" [routerLink]="[]" [queryParams]="cartParams" queryParamsHandling="merge" preserveFragment>
              {{ 'codex.ownCard.openWishlist' | translate }}
            </a>
          } @else {
            <button type="button" scAction tier="secondary" class="oc-wish" [busy]="busy()" (click)="wish()">
              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="wishIcon" /></svg>
              <span>{{ 'codex.ownCard.toWishlist' | translate }}</span>
            </button>
          }
          @if (canOwn()) {
            <span class="oc-grow"></span>
            <button type="button" scAction tier="secondary" class="oc-own" [busy]="busy()" (click)="own()">
              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="isShip() ? icons.hangar : icons.box" /></svg>
              <span>{{ ownActionKey() | translate }}</span>
            </button>
          }
        </div>
      }
    }
    @if (errorKey(); as e) {
      <p class="oc-err" role="alert">{{ e | translate }}</p>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 10px; outline: none;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent);
      background: color-mix(in srgb, var(--sc-accent) 7%, transparent);
      transition: box-shadow 0.3s ease, border-color 0.3s ease; }
    :host(.mine) { border-inline-start: 3px solid var(--sc-accent); }
    :host(.flash) { border-color: var(--sc-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 35%, transparent); }
    :host(:focus-visible) { box-shadow: 0 0 0 2px var(--sc-accent); }
    .oc-h { margin: 0; font-family: var(--sc-font-display); font-size: max(0.7rem, var(--sc-fs-floor)); font-weight: 600;
      letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-accent); }
    .oc-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
    .oc-grow { flex: 1; }
    .oc-name { font-size: max(0.95rem, var(--sc-fs-floor)); font-weight: 600; color: var(--sc-fg-0); min-width: 0; overflow-wrap: anywhere; }
    .oc-note-text { margin: 0; color: var(--sc-fg-1); font-size: max(0.8rem, var(--sc-fs-floor)); overflow-wrap: anywhere; white-space: pre-wrap; }
    .oc-dim { margin: 0; color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); }
    .oc-hq { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 10px; border-radius: 12px;
      border: 1px dashed color-mix(in srgb, var(--sc-warning) 55%, transparent); color: var(--sc-warning);
      font-size: max(0.74rem, var(--sc-fs-floor)); }
    .oc-link { display: inline-flex; align-items: center; gap: 5px; min-height: var(--sc-tap-min, 32px); color: var(--sc-accent);
      font-size: max(0.8rem, var(--sc-fs-floor)); text-decoration: none; }
    .oc-link:hover { text-decoration: underline; }
    .oc-link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
    .oc-step { display: inline-flex; align-items: center; gap: 6px; }
    .oc-step b { min-width: 1.4em; text-align: center; color: var(--sc-fg-0); font-size: max(0.95rem, var(--sc-fs-floor)); }
    .st { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border-radius: 50%; cursor: pointer;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1); color: var(--sc-fg-1); font: inherit; line-height: 1; }
    .st:hover:not(:disabled) { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .st:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    .st:disabled { opacity: 0.5; cursor: default; }
    .oc-err { margin: 0; color: var(--sc-danger); font-size: max(0.76rem, var(--sc-fs-floor)); }
    .mono { font-family: var(--sc-font-mono, monospace); }
    svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    @media (pointer: coarse) { .st { width: 44px; height: 44px; } .oc-link { min-height: 48px; } }
    @media (prefers-reduced-motion: reduce) { :host { transition: none; } }
  `],
})
export class CodexOwnCardComponent {
  private readonly path = inject(ItemPathService);
  private readonly toast = inject(UndoToastService);
  private readonly confirmDialog = inject(ScConfirmService);
  private readonly marks = inject(HqItemMarksService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly kind = input.required<string>();
  readonly className = input.required<string>();
  readonly name = input<string | null>(null);
  /** Ships: the reader's hangar row (rename / note / pin / remove act on it). */
  readonly ship = input<HangarShip | null>(null);
  /** HQ > Hangar > ship: the page is the reader's own copy. */
  readonly forceOwned = input(false);
  /** Name of the Nachschub the ship sits in; null = no hint. */
  readonly nachschubName = input<string | null>(null);

  protected readonly icons = OWN_ICONS;
  protected readonly wishIcon = WISH_ICON;
  protected readonly crateIcon = CRATE_ICON;
  protected readonly cartParams = cartLinkParams;
  protected readonly state = computed(() => this.path.state(this.kind(), this.className(), this.name())());
  protected readonly isShip = computed(() => this.kind() === 'ship' || this.kind() === 'upcoming');
  protected readonly word = computed(() => ownWordOf(this.kind()));
  /** Blueprints are collected, not counted: no stepper, no second wish, removal takes it out of the Sammlung. */
  protected readonly sammlung = computed(() => this.word() === 'sammlung');
  protected readonly removeKey = computed(() => (this.sammlung() ? 'codex.ownCard.removeSammlung' : 'codex.ownCard.removeItem'));
  readonly owned = computed(() => this.forceOwned() || (this.isShip() ? this.state().inHangar : this.state().inventarQty > 0));
  protected readonly canOwn = computed(() => this.state().steps.some((s) => s === 'hangar' || s === 'inventar'));
  protected readonly ownActionKey = computed(() =>
    this.isShip() ? 'codex.ownCard.toHangar' : this.word() === 'sammlung' ? 'codex.ownCard.toSammlung' : 'codex.ownCard.toInventar',
  );
  protected readonly label = computed(() => this.name() ?? this.className());
  protected readonly shipName = computed(() => {
    const custom = this.ship()?.customName?.trim();
    return custom ? `„${custom}“` : this.label();
  });
  protected readonly pinned = computed(() => this.marks.isPinned(this.className()));
  protected readonly itemNote = computed(() => this.marks.noteOf(this.className()));
  protected readonly hqLink = computed(() =>
    hqStockLink({ tab: this.isShip() ? 'hangar' : this.word() === 'sammlung' ? 'sammlung' : 'inventar', focus: this.className() }),
  );

  readonly busy = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly flashing = signal(false);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => this.path.ensureLoaded());
    effect(() => {
      if (!this.isShip() && this.owned()) void this.marks.ensureLoaded();
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.flashTimer) clearTimeout(this.flashTimer);
    });
  }

  /** The head's "Nicht im Hangar": the card comes into view, takes focus and lights up briefly. */
  reveal(): void {
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.host.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    this.host.focus({ preventScroll: true });
    this.flashing.set(true);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flashing.set(false), FLASH_MS);
  }

  wish(): Promise<void> {
    return this.run(() => this.path.addWish(this.kind(), this.className(), this.name()));
  }

  wishAgain(): Promise<void> {
    const s = this.state();
    return this.run(() =>
      s.wished ? this.path.setWishQty(this.kind(), this.className(), this.name(), s.wishQty + 1) : this.path.addWish(this.kind(), this.className(), this.name()),
    );
  }

  stepWish(delta: number): Promise<void> {
    return this.run(() => this.path.setWishQty(this.kind(), this.className(), this.name(), this.state().wishQty + delta));
  }

  /** Ships go into the Hangar; items into the Inventar at the current place (live location or "Bei mir"). */
  own(): Promise<void> {
    if (this.isShip()) return this.run(() => this.path.addToHangar(this.className(), this.name()));
    return this.run(() => this.path.moveToInventar(this.kind(), this.className(), this.label(), this.path.currentPlaceDefault(), 1));
  }

  /** The stepper moves stock at the first place that holds it (a new piece lands there too). */
  stepStock(delta: number): Promise<void> {
    const s = this.state();
    if (delta < 0 && s.inventarQty <= 1) return this.removeItem();
    const place = s.places[0]?.location ?? this.path.currentPlaceDefault();
    return this.run(() => this.path.adjustInventar(this.className(), this.label(), place, delta));
  }

  /** The item's note (per user and item, not per storage place). */
  async editNote(): Promise<void> {
    const v = await this.confirmDialog.prompt({
      titleKey: 'codex.ownCard.noteTitle',
      inputLabelKey: 'codex.own.note',
      inputMaxLength: HQ_ITEM_NOTE_MAX,
      initialValue: this.itemNote() ?? '',
      confirmKey: 'hangar.detail.save',
    });
    if (v === null) return;
    await this.markResult(this.marks.setNote(this.className(), v));
  }

  async togglePin(): Promise<void> {
    await this.markResult(this.marks.setPinned(this.className(), !this.pinned()));
  }

  private async markResult(write: Promise<boolean>): Promise<void> {
    this.errorKey.set(null);
    if (!(await write)) this.errorKey.set(this.marks.error() ?? 'errors.generic');
  }

  async removeItem(): Promise<void> {
    const sammlung = this.sammlung();
    const ok = await this.confirmDialog.confirm({
      titleKey: sammlung ? 'codex.ownCard.removeSammlungTitle' : 'codex.ownCard.removeTitle',
      messageKey: sammlung ? 'codex.ownCard.removeSammlungBody' : 'codex.ownCard.removeBody',
      params: { name: this.label(), n: this.state().inventarQty },
      confirmKey: 'codex.ownCard.removeConfirm',
      tone: 'danger',
    });
    if (!ok) return;
    if (sammlung) await this.run(() => this.path.setBlueprintOwned(this.className(), this.label(), false));
    else await this.run(() => this.path.removeFromInventar(this.kind(), this.className(), this.label()));
  }

  private async run(write: () => Promise<PathResult>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      this.report(await write());
    } finally {
      this.busy.set(false);
    }
  }

  private report(res: PathResult): void {
    if (!res.ok) {
      this.errorKey.set(res.key);
      return;
    }
    const undo = res.undo;
    if (!undo) return;
    this.toast.offer({
      messageKey: res.key,
      messageParams: res.params,
      commit: () => undefined,
      onUndo: () => void undo().then((back) => { if (!back.ok) this.errorKey.set(back.key); }),
    });
  }
}
