import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/** One entry in the fly-out chain — a ship or a set, whichever the stage picks from. */
export interface HangarPickerItem {
  id: string;
  label: string;
  active: boolean;
}

const HOVER_DELAY_MS = 300;
const COLLAPSE_DELAY_MS = 150;

/**
 * The "⌂ Hangar" / "⛨ Sets" button that lives top-left inside a Codex stage
 * image (round 16-17, decisions M1–M6, N1–N3). One reusable control for the
 * Codex landing's two stages AND the ship detail page hero (N4) — same
 * optics, same behaviour, same data source (the top 3 recently chosen).
 *
 * - Click on the button itself: `open` (the caller opens the hangar overlay
 *   or navigates to `/hangar`).
 * - Hover for 300 ms (N3): the chain of up to 3 names flies out to the right.
 *   Focus and touch/tap expand immediately — no hover-only path exists.
 * - Escape, or the pointer leaving the widget, collapses after 150 ms.
 * - Arrow keys move focus along the open chain; Escape returns focus to the
 *   button and collapses it.
 * - No counts, no "Alle" entry (N1/N2) — the button names only the domain
 *   ("Hangar"/"Sets"), the chain is pure selection.
 * - `prefers-reduced-motion`: the CSS transition is removed, not skipped in
 *   markup, so the same DOM/timer logic drives both.
 */
@Component({
  selector: 'sc-hangar-picker',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="picker"
      [class.amber]="kind() === 'set'"
      [class.open]="expanded()"
      (mouseenter)="onMouseEnter()"
      (mouseleave)="onMouseLeave()"
      (keydown.escape)="onEscape()"
    >
      <button
        type="button"
        class="picker-btn"
        [attr.aria-expanded]="expanded()"
        [attr.aria-label]="(kind() === 'ship' ? 'codex.hangarPicker.hangar' : 'codex.hangarPicker.sets') | translate"
        [attr.title]="(kind() === 'ship' ? 'codex.hangarPicker.hangar' : 'codex.hangarPicker.sets') | translate"
        (click)="onButtonClick()"
        (focus)="onFocus()"
        (keydown.arrowright)="onArrowFromButton($event)"
      >
        <b aria-hidden="true">{{ kind() === 'ship' ? '⌂' : '⛨' }}</b>
        <span class="picker-btn__label">{{
          (kind() === 'ship' ? 'codex.hangarPicker.hangar' : 'codex.hangarPicker.sets') | translate
        }}</span>
        <span class="picker-btn__arrow" aria-hidden="true">▸</span>
      </button>

      @if (items().length) {
        <div class="picker-chain" role="group" [attr.aria-label]="'codex.hangarPicker.chain' | translate">
          @for (it of items(); track it.id; let i = $index) {
            <button
              #chainBtn
              type="button"
              class="picker-chain__item"
              [class.on]="it.active"
              [tabindex]="expanded() ? 0 : -1"
              [attr.aria-label]="'codex.hangarPicker.switchTo' | translate: { name: it.label }"
              (click)="onPick(it.id)"
              (keydown.arrowright)="onArrowInChain(i, 1, $event)"
              (keydown.arrowleft)="onArrowInChain(i, -1, $event)"
              (keydown.escape)="onEscapeFromChain($event)"
            >{{ it.label }}</button>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .picker {
        position: absolute;
        top: 12px;
        left: 16px;
        z-index: 4;
        display: flex;
        align-items: stretch;
        height: 30px;
      }
      .picker-btn {
        all: unset;
        box-sizing: border-box;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 30px;
        padding: 0 12px;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent);
        border-radius: 3px;
        background: rgba(2, 8, 14, .55);
        backdrop-filter: blur(6px);
        font: 600 9px/1 var(--font-display, 'Orbitron', sans-serif);
        letter-spacing: .08em;
        text-transform: uppercase;
        color: var(--sc-fg-0);
      }
      .picker-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .picker-btn b { color: var(--sc-accent); font-size: 13px; }
      .picker-btn__arrow { color: rgba(242, 247, 251, .45); font-size: 8px; }
      .picker.amber .picker-btn { border-color: color-mix(in srgb, var(--amber, #f0c27b) 45%, transparent); }
      .picker.amber .picker-btn b { color: var(--amber, #f0c27b); }
      .picker.open .picker-btn { border-radius: 3px 0 0 3px; }

      .picker-chain {
        display: flex;
        align-items: stretch;
        width: 0;
        opacity: 0;
        overflow: hidden;
        transition: width .24s ease, opacity .2s ease;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent);
        border-left: 0;
        border-radius: 0 3px 3px 0;
        background: rgba(2, 8, 14, .55);
        backdrop-filter: blur(6px);
        margin-left: -3px;
      }
      .picker.amber .picker-chain { border-color: color-mix(in srgb, var(--amber, #f0c27b) 45%, transparent); }
      .picker.open .picker-chain { width: auto; opacity: 1; }
      .picker-chain__item {
        all: unset;
        box-sizing: border-box;
        cursor: pointer;
        font: 600 9px/28px var(--font-display, 'Orbitron', sans-serif);
        letter-spacing: .08em;
        text-transform: uppercase;
        padding: 0 12px;
        color: rgba(242, 247, 251, .55);
        white-space: nowrap;
        border-bottom: 2px solid transparent;
      }
      .picker-chain__item.on { color: var(--sc-fg-0); border-bottom-color: var(--amber, #f0c27b); }
      .picker-chain__item:hover { color: var(--sc-fg-0); }
      .picker-chain__item:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }

      @media (prefers-reduced-motion: reduce) {
        .picker-chain { transition: none; }
      }
    `,
  ],
})
export class HangarPickerComponent {
  /** Which domain the picker switches within — labels and amber vs. cyan follow this. */
  readonly kind = input.required<'ship' | 'set'>();
  /** Top 3, most-recently-chosen first; `active` marks the one the stage currently shows. */
  readonly items = input<readonly HangarPickerItem[]>([]);

  /** Switch the stage's subject to this item. */
  readonly pick = output<string>();
  /** Open the full hangar (overlay if one exists, else `/hangar`) — the caller decides. */
  readonly open = output<void>();

  private readonly chainButtons = viewChildren<ElementRef<HTMLButtonElement>>('chainBtn');

  readonly expanded = signal(false);
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private collapseTimer: ReturnType<typeof setTimeout> | null = null;

  readonly hasItems = computed(() => this.items().length > 0);

  /**
   * Touch has no hover: the first tap on the button stands in for it and
   * only expands the chain (M2); a second tap — now that the chain is open —
   * falls through to `open`. A mouse click after a hover has already
   * expanded the chain behaves the same way: it opens the hangar.
   */
  onButtonClick(): void {
    if (this.hasItems() && !this.expanded()) {
      this.clearTimers();
      this.expanded.set(true);
      return;
    }
    this.open.emit();
  }

  onFocus(): void {
    this.clearTimers();
    this.expanded.set(true);
  }

  onMouseEnter(): void {
    this.clearTimers();
    if (!this.hasItems()) return;
    this.hoverTimer = setTimeout(() => this.expanded.set(true), HOVER_DELAY_MS);
  }

  onMouseLeave(): void {
    this.clearTimers();
    this.collapseTimer = setTimeout(() => this.expanded.set(false), COLLAPSE_DELAY_MS);
  }

  onEscape(): void {
    this.clearTimers();
    this.expanded.set(false);
  }

  onEscapeFromChain(ev: Event): void {
    ev.stopPropagation();
    this.clearTimers();
    this.expanded.set(false);
  }

  /** Touch/tap on the button behaves like focus: expand immediately, no hover wait. */
  onArrowFromButton(ev: Event): void {
    if (!this.hasItems()) return;
    ev.preventDefault();
    this.clearTimers();
    this.expanded.set(true);
    this.chainButtons()[0]?.nativeElement.focus();
  }

  onArrowInChain(index: number, dir: 1 | -1, ev: Event): void {
    ev.preventDefault();
    const buttons = this.chainButtons();
    const next = buttons[index + dir];
    next?.nativeElement.focus();
  }

  onPick(id: string): void {
    this.pick.emit(id);
  }

  private clearTimers(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    if (this.collapseTimer) clearTimeout(this.collapseTimer);
    this.hoverTimer = null;
    this.collapseTimer = null;
  }
}
