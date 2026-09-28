import {
  Directive,
  ElementRef,
  OnDestroy,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';
import { FocusTrap, FocusTrapFactory } from '@angular/cdk/a11y';

/**
 * `[scDialog]` — the one place for "focus in, Tab stays in, Escape, focus
 * back" on any dialog-like element (confirm dialog, lightbox, panel, popover).
 *
 * Opening is construction: the directive sits on an element that appears via
 * `@if` or a CDK portal. It remembers `document.activeElement` as the opener,
 * moves focus inside after the first render and, when destroyed, hands focus
 * back to the opener (or `scDialogReturnFocus`).
 *
 * Tab trapping uses the CDK focus-trap anchors instead of a hand-written
 * tabbable selector, so `select`, `textarea`, hidden and disabled elements are
 * handled the same way the CDK dialog handles them.
 *
 * Escape is read from the HOST's keydown, not from `document`: an inner widget
 * that already consumed the key (sc-select with an open list calls
 * preventDefault + stopPropagation, sc-tooltip stops propagation) never
 * reaches us, and after we handle it we stop propagation — so in a stacked
 * dialog (a confirm over the bundle-history popup) Escape closes only the
 * topmost one, and page-wide Escape handlers (account menu, feedback FAB) do
 * not fire along with it.
 *
 * Focus return waits one animation frame: by then a trigger that was disabled
 * while the dialog ran (a "Deleting…" button) is enabled again. It only
 * returns when focus vanished with the dialog (activeElement is body/null) —
 * if the user clicked another control, or a follow-up dialog holds focus, we
 * do not steal it.
 */
@Directive({
  selector: '[scDialog]',
  standalone: true,
  host: { class: 'sc-dialog', '(keydown)': 'onKeydown($event)' },
})
export class ScDialogDirective implements OnDestroy {
  /** true (default): Tab/Shift+Tab stay inside the dialog. false: non-modal popover — only focus in, Escape, focus back. */
  readonly scDialogModal = input(true);
  /** 'first': the element with the cdkFocusInitial attribute, else the first tabbable element, else the dialog itself. 'container': the dialog itself. */
  readonly scDialogInitialFocus = input<'first' | 'container'>('first');
  /** Explicit return target; defaults to the element that had focus when the dialog opened. */
  readonly scDialogReturnFocus = input<HTMLElement | null>(null);
  /** Escape inside the dialog. The host decides what "close" means. */
  readonly scDialogEscape = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly trapFactory = inject(FocusTrapFactory);
  private readonly opener: HTMLElement | null;
  private trap: FocusTrap | null = null;
  private destroyed = false;

  constructor() {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    this.opener = active instanceof HTMLElement && active !== document.body ? active : null;
    if (!this.host.hasAttribute('tabindex')) this.host.setAttribute('tabindex', '-1');

    afterNextRender(() => {
      if (this.destroyed) return;
      this.trap = this.trapFactory.create(this.host);
      this.trap.enabled = this.scDialogModal();
      if (this.scDialogInitialFocus() === 'container') {
        this.host.focus({ preventScroll: true });
        return;
      }
      if (!this.trap.focusInitialElement({ preventScroll: true })) {
        this.host.focus({ preventScroll: true });
      }
    });
  }

  onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' || ev.defaultPrevented) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.scDialogEscape.emit();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.trap?.destroy();
    this.trap = null;
    const target = this.scDialogReturnFocus() ?? this.opener;
    if (!target || typeof requestAnimationFrame === 'undefined') return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (!target.isConnected) return;
      if (target.matches(':disabled')) return;
      target.focus({ preventScroll: true });
    });
  }
}
