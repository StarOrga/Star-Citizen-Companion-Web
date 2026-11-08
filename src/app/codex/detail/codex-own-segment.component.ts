import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ItemPathService, ownWordOf } from '../../hq/data/item-path.service';
import type { HqConfigRef } from '../../hq/hq-ownership.service';
import { CodexModeSwitchComponent } from './codex-personal-mode.component';

/** Icon paths of the strip and the card (24px grid, stroked). */
export const OWN_ICONS = {
  hangar: 'M3 11l9-7 9 7v9H3zM9 20v-6h6v6',
  diamond: 'M12 3l8 9-8 9-8-9z',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
} as const;

/**
 * The ownership part of the head strip (concept codex-kopf-besitz, d1 "Kennleiste"): one
 * segment after [Patch ▾]. Ship: "⌂ Im Hangar" plus the inline variant select (the page's
 * old "Meine Variante" switch, no primary tier any more) - or a quiet "◇ Nicht im Hangar"
 * that leads to the ownership card (`jump`). Item: "Im Inventar · 2×" / "Nicht im Inventar"
 * (a blueprint: Sammlung). It never writes: every change lives in the card.
 */
@Component({
  selector: 'sc-codex-own-segment',
  standalone: true,
  imports: [TranslatePipe, CodexModeSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (owned()) {
      <span class="seg own">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="isShip() ? icons.hangar : icons.box" /></svg>
        <span class="lbl">{{ ownedKey() | translate: { n: qty() } }}</span>
        @if (showVariant()) {
          <sc-codex-mode-switch class="var" [compact]="true" kind="ship" [className]="className()" [personal]="personal()"
            [variants]="variants()" [activeVariantId]="activeVariantId()" [hangarShipId]="hangarShipId()" />
        }
      </span>
    } @else {
      <button type="button" class="seg quiet" (click)="jump.emit()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons.diamond" /></svg>
        <span class="lbl">{{ notOwnedKey() | translate }}</span>
      </button>
    }
  `,
  styles: [`
    :host { display: inline-flex; align-items: stretch; }
    .seg { display: inline-flex; align-items: center; gap: 7px; padding: 0 12px; white-space: nowrap;
      font: inherit; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .own { border-radius: 0 9px 9px 0; background: color-mix(in srgb, var(--sc-accent) 12%, transparent); color: var(--sc-fg-0); }
    .own > svg { color: var(--sc-accent); }
    .quiet { border: 0; border-radius: 0 9px 9px 0; background: transparent; color: var(--sc-fg-2); cursor: pointer; }
    .quiet:hover { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
    .quiet:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    svg { width: 15px; height: 15px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .var { margin-inline-start: 3px; }
  `],
})
export class CodexOwnSegmentComponent {
  private readonly path = inject(ItemPathService);

  readonly kind = input.required<string>();
  readonly className = input.required<string>();
  readonly name = input<string | null>(null);
  /** Ships: the variant select shows (the reader's variants of this hull). */
  readonly showVariant = input(false);
  readonly variants = input<readonly HqConfigRef[]>([]);
  readonly activeVariantId = input<string | null>(null);
  readonly personal = input(false);
  readonly hangarShipId = input<string | null>(null);
  /** HQ > Hangar > ship: the page is the reader's own copy, owned without asking the stores. */
  readonly forceOwned = input(false);
  /** "Nicht im Hangar" was clicked: the page brings the ownership card into view. */
  readonly jump = output<void>();

  protected readonly icons = OWN_ICONS;
  private readonly state = computed(() => this.path.state(this.kind(), this.className(), this.name())());
  protected readonly isShip = computed(() => this.kind() === 'ship' || this.kind() === 'upcoming');
  protected readonly qty = computed(() => (this.isShip() ? Math.max(1, this.state().hangarQty) : this.state().inventarQty));
  readonly owned = computed(() => this.forceOwned() || (this.isShip() ? this.state().inHangar : this.state().inventarQty > 0));
  private readonly word = computed(() => ownWordOf(this.kind()) ?? 'hangar');
  protected readonly ownedKey = computed(() => {
    if (this.isShip()) return 'codex.head.own.hangar';
    return this.word() === 'sammlung' ? 'codex.head.own.sammlung' : 'codex.head.own.inventar';
  });
  protected readonly notOwnedKey = computed(() => {
    if (this.isShip()) return 'codex.head.notOwn.hangar';
    return this.word() === 'sammlung' ? 'codex.head.notOwn.sammlung' : 'codex.head.notOwn.inventar';
  });

  constructor() {
    effect(() => this.path.ensureLoaded());
  }
}
