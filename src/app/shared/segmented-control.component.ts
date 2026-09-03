import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { QueryParamsHandling, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Router target for a segment whose state lives in the URL. When present the
 * segment renders as a real `<a>` instead of a `<button>` — middle click,
 * Ctrl/Cmd+click and "open in new tab" are browser features that only work on
 * an anchor, so a bookmarkable filter must never be a click handler.
 */
export interface ScSegmentLink {
  /** `routerLink` commands — `[]` keeps the current route and only swaps params. */
  readonly commands: unknown[];
  readonly queryParams?: Record<string, string | number>;
  readonly queryParamsHandling?: QueryParamsHandling;
}

/** One segment. `label` is ready-made text and WINS over the i18n `labelKey`. */
export interface ScSegmentOption {
  /**
   * Stable identity of this choice. It is what the control emits and what the
   * caller compares against, so it should read as a name ('all', 'release'),
   * not as a display string — a label may be translated, an id may not.
   */
  readonly value: string;
  /** Ready-made text, for labels that come from data (an RSI series name). */
  readonly label?: string;
  /** i18n key, translated by the control. Ignored when `label` is set. */
  readonly labelKey?: string;
  /** Optional i18n key for the `title` tooltip — use for abbreviated labels. */
  readonly titleKey?: string;
  /** Turns this segment into a link. Set it on ALL options or on none. */
  readonly link?: ScSegmentLink;
}

/**
 * Segmented control — one row of mutually exclusive choices in a single pill.
 *
 * Extracted from the telemetry time-range picker (`sc-telemetry-stats`) so the
 * app has ONE look for "pick exactly one of these", instead of a second
 * chip-bar dialect per page (admin feedback 1f78e57f).
 *
 * Two modes, chosen per option:
 *
 * - **Buttons** (default) — a WAI-ARIA radio group. Picking is a client-side
 *   action, so it is a real `<button>`; the group carries a roving tabindex and
 *   arrow/Home/End keys move the selection, which is what a screen reader and a
 *   keyboard user expect from a radio group.
 * - **Links** (`option.link`) — for state that lives in the URL. Then it is a
 *   plain labelled group of anchors: `aria-current` marks the active one and
 *   the browser owns focus order, because a roving tabindex on links would
 *   remove them from the tab sequence for no gain.
 *
 * Geometry is deliberately stable: segments never wrap, so the control's height
 * cannot change when a label does, and the row it sits in cannot reflow around
 * it. Where the labels are wider than the viewport the pill scrolls sideways
 * rather than pushing anything off screen.
 */
@Component({
  selector: 'sc-segmented',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sc-segmented' },
  template: `
    <div
      class="seg"
      [attr.role]="linkMode() ? 'group' : 'radiogroup'"
      [attr.aria-label]="ariaLabel() || null"
      (keydown)="onKeydown($event)"
    >
      @for (o of options(); track o.value; let i = $index) {
        @if (o.link; as link) {
          <a
            class="seg-btn"
            [class.active]="o.value === value()"
            [attr.aria-current]="o.value === value() ? 'true' : null"
            [attr.title]="o.titleKey ? (o.titleKey | translate) : null"
            [routerLink]="link.commands"
            [queryParams]="link.queryParams ?? null"
            [queryParamsHandling]="link.queryParamsHandling ?? ''"
            >{{ o.label ?? (o.labelKey ?? '' | translate) }}</a
          >
        } @else {
          <button
            type="button"
            class="seg-btn"
            role="radio"
            [class.active]="o.value === value()"
            [attr.aria-checked]="o.value === value()"
            [attr.title]="o.titleKey ? (o.titleKey | translate) : null"
            [attr.tabindex]="i === activeIndex() ? 0 : -1"
            (click)="pick(o.value)"
            >{{ o.label ?? (o.labelKey ?? '' | translate) }}</button
          >
        }
      }
    </div>
  `,
  styles: [`
    /* Shrink-to-fit by default, so the pill is exactly as wide as its segments.
       A caller that wants it to span its slot (a phone row) sets
       display:block / a width on the element from its own stylesheet — the
       segments then share the space via flex: 1 0 auto below. */
    :host { display: inline-block; max-width: 100%; min-width: 0; vertical-align: top; }

    .seg {
      display: flex; width: 100%;
      border: 1px solid var(--sc-border); border-radius: 8px;
      background: var(--sc-bg-1);
      /* Sideways scroll, not overflow: when the labels are wider than the slot
         the pill scrolls inside its own bounds instead of pushing whatever
         shares the row off screen. overflow-y:hidden keeps the rounded
         corners clipping the segments. */
      overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
    }
    .seg::-webkit-scrollbar { display: none; }
    .seg-btn {
      display: inline-flex; align-items: center; justify-content: center;
      /* 48px, not the 44px minimum: the app-wide reveal/press animations scale
         interactive elements by 0.994, which measures a 44px control as 43px. */
      min-height: 48px; padding: 0 1rem;
      /* Grow into a wide slot, but never shrink a label into an ellipsis. */
      flex: 1 0 auto;
      font: inherit; font-size: max(0.82rem, var(--sc-fs-floor));
      white-space: nowrap; text-decoration: none; cursor: pointer;
      background: transparent; color: var(--sc-fg-2);
      border: 0; border-right: 1px solid var(--sc-border);
    }
    .seg-btn:last-child { border-right: 0; }
    .seg-btn:hover { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-fg-0) 6%, transparent); }
    .seg-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .seg-btn.active { background: var(--sc-accent); color: var(--sc-bg-0); font-weight: 600; }
    .seg-btn.active:hover { background: var(--sc-accent); color: var(--sc-bg-0); }

    @media (max-width: 560px) { .seg-btn { padding: 0 0.75rem; } }
  `],
})
export class ScSegmentedComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly options = input.required<readonly ScSegmentOption[]>();
  /** The selected option's `value`. Anything unknown selects nothing. */
  readonly value = input<string | null>(null);
  /** Accessible name of the group — already translated by the caller. */
  readonly ariaLabel = input<string>('');

  /** Emitted on a pick in button mode. Link mode navigates instead. */
  readonly valueChange = output<string>();

  /** Any option carrying a router target puts the whole control in link mode. */
  readonly linkMode = computed(() => this.options().some((o) => !!o.link));

  /**
   * Which segment holds the group's single tab stop. Falls back to the first
   * one when the current value matches nothing, so the control can never drop
   * out of the tab order entirely.
   */
  readonly activeIndex = computed(() => {
    const i = this.options().findIndex((o) => o.value === this.value());
    return i >= 0 ? i : 0;
  });

  pick(value: string): void {
    if (value !== this.value()) this.valueChange.emit(value);
  }

  /** Radio-group keyboard model: arrows/Home/End move the selection AND focus. */
  onKeydown(ev: KeyboardEvent): void {
    if (this.linkMode()) return; // links keep the browser's own tab order
    const options = this.options();
    if (options.length === 0) return;
    const current = this.activeIndex();
    let next: number;
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % options.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + options.length) % options.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = options.length - 1;
        break;
      default:
        return;
    }
    ev.preventDefault();
    this.pick(options[next].value);
    // Index, not identity: the option order is fixed, so the nth button is
    // still the nth button after the caller writes the new value back.
    this.host.nativeElement.querySelectorAll<HTMLElement>('.seg-btn')[next]?.focus();
  }
}
