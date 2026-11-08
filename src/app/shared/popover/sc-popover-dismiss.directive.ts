import { Directive, ElementRef, inject, input, output } from '@angular/core';

/**
 * `[scPopoverDismiss]` — Escape and outside click close a trigger + popover
 * pair. Put it on the wrapper that holds the trigger button (the one with
 * `aria-expanded`) and the popover. While `scPopoverDismiss` is true:
 * - Escape (anywhere, unless an inner widget already consumed it) emits
 *   `dismissed` and hands focus back to the trigger,
 * - a pointer press outside the wrapper emits `dismissed` and leaves focus
 *   where the user clicked.
 * The host flips its open signal in `dismissed`, which also resets `aria-expanded`.
 */
@Directive({
  selector: '[scPopoverDismiss]',
  standalone: true,
  host: {
    '(document:keydown)': 'onKeydown($event)',
    '(document:pointerdown)': 'onPointerdown($event)',
  },
})
export class ScPopoverDismissDirective {
  /** Whether the popover is open. */
  readonly scPopoverDismiss = input(false);
  readonly dismissed = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  onKeydown(ev: KeyboardEvent): void {
    if (!this.scPopoverDismiss() || ev.key !== 'Escape' || ev.defaultPrevented) return;
    ev.preventDefault();
    this.dismissed.emit();
    this.host.querySelector<HTMLElement>('[aria-expanded]')?.focus({ preventScroll: true });
  }

  onPointerdown(ev: PointerEvent): void {
    if (!this.scPopoverDismiss()) return;
    if (ev.target instanceof Node && this.host.contains(ev.target)) return;
    this.dismissed.emit();
  }
}
