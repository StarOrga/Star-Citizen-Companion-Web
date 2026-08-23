import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

/** One choice. `labelKey` is an i18n key — the component translates it itself. */
export interface ScSelectOption {
  readonly value: string;
  readonly labelKey: string;
}

/** Sentinel for "nothing picked" — `null` on the wire, `''` inside the list. */
const NONE = '';

let uid = 0;

/**
 * Themed single-select — a listbox the app can actually style.
 *
 * A native `<select>` renders its OPEN state through the operating system: the
 * popup is drawn by Windows/macOS/Android, not by the page, so no amount of CSS
 * reaches it. On a dark, uppercase-display-font surface like this one the
 * expanded list therefore arrives as a bright system menu in the platform's own
 * font — which is exactly what admin feedback fd58a5eb called out ("die
 * aufgeklappten Drop-downs sind nicht in theme").
 *
 * So the control is rebuilt from a `button[role=combobox]` plus a
 * `ul[role=listbox]` the page owns and paints. The WAI-ARIA combobox pattern is
 * followed with `aria-activedescendant`: focus never leaves the trigger, the
 * active option is announced from the id the trigger points at, and the list is
 * a pure presentation layer. Keyboard behaviour mirrors a native select —
 * arrows/Home/End move, Enter/Space commit, Escape closes, typing jumps to the
 * first matching label.
 */
@Component({
  selector: 'sc-select',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'sc-select',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(focusout)': 'onFocusOut($event)',
  },
  template: `
    <button
      type="button"
      class="trigger"
      role="combobox"
      [class.open]="open()"
      [disabled]="disabled()"
      [attr.aria-expanded]="open()"
      aria-haspopup="listbox"
      [attr.aria-controls]="listId"
      [attr.aria-label]="ariaLabel() || null"
      [attr.aria-activedescendant]="open() ? optionId(activeIndex()) : null"
      (click)="toggle()"
      (keydown)="onKeydown($event)"
    >
      <span class="value" [class.none]="value() === null">{{ valueLabelKey() | translate }}</span>
      <span class="chevron" aria-hidden="true"></span>
    </button>

    @if (open()) {
      <ul class="panel" [id]="listId" role="listbox" [class.up]="dropUp()">
        @for (o of choices(); track o.value; let i = $index) {
          <li
            [id]="optionId(i)"
            class="option"
            role="option"
            [class.active]="i === activeIndex()"
            [class.selected]="o.value === currentValue()"
            [attr.aria-selected]="o.value === currentValue()"
            (pointerdown)="$event.preventDefault()"
            (click)="choose(i)"
          >
            <span class="tick" aria-hidden="true"></span>
            <span class="label">{{ o.labelKey | translate }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: [`
    :host { position: relative; display: block; min-width: 0; }

    .trigger {
      display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 10px 12px; border-radius: 8px; min-height: 48px; cursor: pointer;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-0);
      font-family: inherit; font-size: 0.88rem; text-align: start;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .trigger:hover:not(:disabled) { border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); }
    .trigger.open { border-color: var(--sc-accent); }
    .trigger:disabled { opacity: 0.45; cursor: not-allowed; }

    .value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .value.none { color: var(--sc-fg-2); }

    /* Chevron drawn from a rotated square so it inherits the text colour and
       needs no asset. Flips when the list is open. */
    .chevron {
      flex: 0 0 auto; inline-size: 7px; block-size: 7px; margin-inline-start: auto;
      border-inline-end: 2px solid var(--sc-fg-2); border-block-end: 2px solid var(--sc-fg-2);
      transform: translateY(-2px) rotate(45deg); transition: transform 0.18s ease;
    }
    .trigger.open .chevron { transform: translateY(1px) rotate(-135deg); border-color: var(--sc-accent); }

    .panel {
      position: absolute; z-index: 30; inset-inline: 0; top: calc(100% + 4px);
      margin: 0; padding: 4px; list-style: none;
      max-height: 260px; overflow-y: auto; overscroll-behavior: contain;
      background: var(--sc-bg-1); border: 1px solid var(--sc-accent); border-radius: 10px;
      box-shadow: var(--sc-glow), 0 12px 30px rgb(0 0 0 / 45%);
    }
    .panel.up { top: auto; bottom: calc(100% + 4px); }

    .option {
      display: flex; align-items: center; gap: 8px; cursor: pointer;
      padding: 9px 10px; border-radius: 6px; min-height: 40px;
      color: var(--sc-fg-1); font-size: 0.86rem;
    }
    .option.active { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-fg-0); }
    .option.selected { color: var(--sc-accent); }
    .option .label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Checkmark for the committed value — the active row is carried by the
       highlight, the selected row by this tick, so the two never collide. */
    .tick {
      flex: 0 0 auto; inline-size: 11px; block-size: 11px; background: var(--sc-accent);
      clip-path: polygon(14% 44%, 0 60%, 40% 100%, 100% 18%, 84% 0, 38% 68%);
      opacity: 0; transition: opacity 0.12s ease;
    }
    .option.selected .tick { opacity: 1; }

    @media (prefers-reduced-motion: reduce) {
      .chevron, .tick, .trigger { transition: none; }
    }
  `],
})
export class ScSelectComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly i18n = inject(TranslateService);

  /** Choices WITHOUT the empty one — that is prepended from `placeholderKey`. */
  readonly options = input.required<readonly ScSelectOption[]>();
  readonly value = input<string | null>(null);
  readonly disabled = input(false);
  /** i18n key for the "nothing picked" row (and the trigger's empty label). */
  readonly placeholderKey = input('common.select.none');
  readonly ariaLabel = input('');

  readonly valueChange = output<string | null>();

  readonly listId = `sc-select-${++uid}`;
  readonly open = signal(false);
  readonly dropUp = signal(false);
  readonly activeIndex = signal(0);

  /** Placeholder first, then the caller's options — index 0 is always "none". */
  readonly choices = computed<readonly ScSelectOption[]>(() => [
    { value: NONE, labelKey: this.placeholderKey() },
    ...this.options(),
  ]);

  readonly currentValue = computed(() => this.value() ?? NONE);

  readonly valueLabelKey = computed(
    () =>
      this.choices().find((o) => o.value === this.currentValue())?.labelKey ?? this.placeholderKey(),
  );

  optionId(i: number): string {
    return `${this.listId}-o${i}`;
  }

  toggle(): void {
    if (this.open()) this.close();
    else this.openList();
  }

  close(): void {
    if (this.open()) this.open.set(false);
  }

  choose(i: number): void {
    const picked = this.choices()[i];
    if (!picked) return;
    this.close();
    this.triggerEl()?.focus();
    const next = picked.value === NONE ? null : picked.value;
    if (next !== this.value()) this.valueChange.emit(next);
  }

  onKeydown(ev: KeyboardEvent): void {
    if (this.disabled()) return;
    const last = this.choices().length - 1;

    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault();
        if (!this.open()) this.openList();
        else if (!ev.altKey) this.moveTo(this.activeIndex() + 1, last);
        return;
      case 'ArrowUp':
        ev.preventDefault();
        if (!this.open()) this.openList();
        else if (ev.altKey) this.close();
        else this.moveTo(this.activeIndex() - 1, last);
        return;
      case 'Home':
        ev.preventDefault();
        if (!this.open()) this.openList();
        else this.moveTo(0, last);
        return;
      case 'End':
        ev.preventDefault();
        if (!this.open()) this.openList();
        else this.moveTo(last, last);
        return;
      case 'Enter':
      case ' ':
        ev.preventDefault();
        if (this.open()) this.choose(this.activeIndex());
        else this.openList();
        return;
      case 'Escape':
        if (this.open()) {
          ev.preventDefault();
          ev.stopPropagation();
          this.close();
        }
        return;
      case 'Tab':
        this.close();
        return;
      default:
        if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) this.typeahead(ev);
    }
  }

  onDocumentPointerDown(ev: Event): void {
    if (this.open() && !this.host.nativeElement.contains(ev.target as Node)) this.close();
  }

  onFocusOut(ev: FocusEvent): void {
    const next = ev.relatedTarget as Node | null;
    if (this.open() && (!next || !this.host.nativeElement.contains(next))) this.close();
  }

  private openList(): void {
    if (this.disabled()) return;
    const i = this.choices().findIndex((o) => o.value === this.currentValue());
    this.activeIndex.set(i < 0 ? 0 : i);
    // Open upward when the panel would otherwise run off the bottom — the
    // pickers sit in a sticky bar that can end up anywhere on screen.
    const rect = this.triggerEl()?.getBoundingClientRect();
    const room = rect ? window.innerHeight - rect.bottom : Number.POSITIVE_INFINITY;
    this.dropUp.set(room < 280 && (rect?.top ?? 0) > 280);
    this.open.set(true);
    this.scrollActiveIntoView();
  }

  private moveTo(to: number, last: number): void {
    this.activeIndex.set(Math.min(last, Math.max(0, to)));
    this.scrollActiveIntoView();
  }

  /** Jump to the first label starting with the typed character, native-style. */
  private typeahead(ev: KeyboardEvent): void {
    const needle = ev.key.toLowerCase();
    const items = this.choices();
    const from = this.open() ? this.activeIndex() + 1 : 0;
    for (let n = 0; n < items.length; n++) {
      const i = (from + n) % items.length;
      const label = String(this.i18n.instant(items[i].labelKey) ?? '');
      if (label.toLowerCase().startsWith(needle)) {
        ev.preventDefault();
        if (!this.open()) this.openList();
        this.activeIndex.set(i);
        this.scrollActiveIntoView();
        return;
      }
    }
  }

  private triggerEl(): HTMLButtonElement | null {
    return this.host.nativeElement.querySelector('.trigger');
  }

  private scrollActiveIntoView(): void {
    queueMicrotask(() => {
      const el = this.host.nativeElement.querySelector(`[id="${this.optionId(this.activeIndex())}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }
}
