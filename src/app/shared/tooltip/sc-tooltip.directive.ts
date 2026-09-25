import {
  ComponentRef,
  Directive,
  ElementRef,
  HostListener,
  Injectable,
  OnDestroy,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { ConnectedPosition, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ScTooltipComponent } from './sc-tooltip.component';

/** Info tier (default): the element is understandable without the tooltip
 *  (descriptions, hotkey hints, tips). ui-defaults.md R1. */
export const SC_TOOLTIP_INFO_DELAY = 1500;
/** Label tier: the tooltip IS the element's only name, or it explains a
 *  disabled state / shows a truncated value. ui-defaults.md R1. */
export const SC_TOOLTIP_LABEL_DELAY = 500;
/** Once a tooltip has closed, the next one (any instance) opens instantly if
 *  triggered within this window. Radix's `skipDelayDuration`. */
export const SC_TOOLTIP_SKIP_WINDOW = 300;
/** Grace period between "pointer/focus left" and actually closing — lets the
 *  pointer travel from the host onto the bubble (WCAG 2.2 SC 1.4.13,
 *  hoverable) without a flash-close. */
const SC_TOOLTIP_HOVER_GRACE = 150;
/** Touch: long-press duration that opens the tooltip instead of the tap. */
const SC_TOOLTIP_LONG_PRESS = 500;
/** Touch: pointer movement past this many px during the press cancels it —
 *  the user is scrolling/dragging, not asking for a tooltip. */
const SC_TOOLTIP_MOVE_TOLERANCE = 8;

/**
 * App-wide tooltip state: the skip-delay window is shared across every
 * tooltip, not per instance — moving the pointer from one icon straight to
 * the next must feel instant, matching Radix's `skipDelayDuration`. A root
 * service rather than a module variable, so each TestBed starts clean.
 */
@Injectable({ providedIn: 'root' })
export class ScTooltipState {
  lastCloseAt = 0;
}

/** Best-effort `:focus-visible` equivalent, tracked ourselves (rather than
 *  read via `Element.matches(':focus-visible')`) so the "keyboard focus opens
 *  instantly, mouse focus does not" behaviour is deterministic under test —
 *  the native pseudo-class's heuristics are keyed off trusted input events
 *  and are not reliably reproducible with synthetic ones. Same idea as the
 *  `focus-visible` polyfill: the last pointer/keyboard interaction decides. */
let lastInputWasKeyboard = false;
let modalityListenersInstalled = false;

function installModalityListeners(): void {
  if (modalityListenersInstalled || typeof document === 'undefined') return;
  modalityListenersInstalled = true;
  document.addEventListener(
    'keydown',
    (ev) => {
      if (ev.key === 'Tab') lastInputWasKeyboard = true;
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    () => {
      lastInputWasKeyboard = false;
    },
    true,
  );
  document.addEventListener(
    'mousedown',
    () => {
      lastInputWasKeyboard = false;
    },
    true,
  );
}

const POSITIONS: ConnectedPosition[] = [
  // Above, centred (the default placement the contract asks for).
  { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
  // Fallback: below.
  { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
  // Fallback: left of the host.
  { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -8 },
  // Fallback: right of the host.
  { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 8 },
];

/**
 * App-styled replacement for the native `title` attribute (ui-defaults.md
 * R0/R1): a CDK-overlay-portaled bubble (`sc-tooltip-bubble`), with
 * the two delay tiers, WCAG 2.2 SC 1.4.13 hover/focus persistence, Escape
 * dismissal and a long-press affordance on touch.
 *
 * ```html
 * <button [scTooltip]="'codex.compare.pin' | translate" scTooltipTier="label" aria-label="...">★</button>
 * ```
 */
@Directive({
  selector: '[scTooltip]',
  standalone: true,
})
export class ScTooltipDirective implements OnDestroy {
  readonly scTooltip = input<string | null | undefined>(null);
  readonly scTooltipTier = input<'info' | 'label'>('info');
  readonly scTooltipDisabled = input(false);

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly overlay = inject(Overlay);
  private readonly state = inject(ScTooltipState);

  private overlayRef: OverlayRef | null = null;
  private bubble: ComponentRef<ScTooltipComponent> | null = null;

  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;

  private pointerDownAt: { x: number; y: number } | null = null;
  private isTouchOpen = false;
  private suppressNextClick = false;

  private hoveringHost = false;
  private hoveringBubble = false;
  private focusedOpen = false;

  private readonly uid = `sc-tooltip-${Math.random().toString(36).slice(2, 9)}`;

  constructor() {
    installModalityListeners();
    // A tooltip that is open while its text changes (★ pin → "pinned") says
    // the new text, instead of the one it opened with; an emptied text closes it.
    effect(() => {
      const text = this.scTooltip();
      untracked(() => {
        if (!this.bubble) return;
        if (text) this.bubble.setInput('text', text);
        else this.close();
      });
    });
  }

  ngOnDestroy(): void {
    this.clearAllTimers();
    this.disposeOverlay();
    if (this.isTouchOpen) document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
  }

  // Pointer, not mouse, events: a touch tap fires emulated mouseenter, which
  // would open the tooltip a moment after the tap — touch opens on long-press only.
  @HostListener('pointerenter', ['$event'])
  onPointerEnter(ev: PointerEvent): void {
    if (ev.pointerType === 'touch') return;
    this.hoveringHost = true;
    this.cancelCloseTimer();
    this.scheduleOpen();
  }

  @HostListener('pointerleave', ['$event'])
  onPointerLeave(ev: PointerEvent): void {
    if (ev.pointerType === 'touch') return;
    this.hoveringHost = false;
    this.cancelOpenTimer();
    this.scheduleCloseIfIdle();
  }

  @HostListener('focus')
  onFocus(): void {
    if (!lastInputWasKeyboard) return;
    this.focusedOpen = true;
    this.cancelCloseTimer();
    this.openNow();
  }

  @HostListener('blur')
  onBlur(): void {
    this.focusedOpen = false;
    this.scheduleCloseIfIdle();
  }

  @HostListener('keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' || !this.overlayRef) return;
    // Dismissible (WCAG 2.2 SC 1.4.13): closes the tooltip without moving
    // focus. Only swallowed from a parent (e.g. a dialog) while a tooltip
    // was actually open — otherwise Escape must reach the dialog untouched.
    ev.stopPropagation();
    this.close();
  }

  @HostListener('pointerdown', ['$event'])
  onPointerDown(ev: PointerEvent): void {
    if (ev.pointerType !== 'touch') return;
    this.pointerDownAt = { x: ev.clientX, y: ev.clientY };
    this.clearLongPressTimer();
    this.longPressTimer = setTimeout(() => {
      this.isTouchOpen = true;
      this.suppressNextClick = true;
      this.openNow();
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    }, SC_TOOLTIP_LONG_PRESS);
  }

  @HostListener('pointermove', ['$event'])
  onPointerMove(ev: PointerEvent): void {
    if (ev.pointerType !== 'touch' || !this.pointerDownAt) return;
    const dx = Math.abs(ev.clientX - this.pointerDownAt.x);
    const dy = Math.abs(ev.clientY - this.pointerDownAt.y);
    if (dx > SC_TOOLTIP_MOVE_TOLERANCE || dy > SC_TOOLTIP_MOVE_TOLERANCE) this.clearLongPressTimer();
  }

  @HostListener('pointerup')
  onPointerUp(): void {
    this.clearLongPressTimer();
    this.pointerDownAt = null;
  }

  @HostListener('pointercancel')
  onPointerCancel(): void {
    this.clearLongPressTimer();
    this.pointerDownAt = null;
  }

  @HostListener('click', ['$event'])
  onClick(ev: MouseEvent): void {
    // Touch: the long-press that opened the tooltip must not also fire the
    // host's own click action on release.
    if (!this.suppressNextClick) return;
    this.suppressNextClick = false;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }

  // -- open/close scheduling ------------------------------------------------

  private scheduleOpen(): void {
    if (this.scTooltipDisabled() || !this.scTooltip()) return;
    if (this.overlayRef) return;
    this.clearOpenTimer();
    const sinceClose = Date.now() - this.state.lastCloseAt;
    const skip = sinceClose >= 0 && sinceClose < SC_TOOLTIP_SKIP_WINDOW;
    if (skip) {
      this.openNow();
      return;
    }
    const delay = this.scTooltipTier() === 'label' ? SC_TOOLTIP_LABEL_DELAY : SC_TOOLTIP_INFO_DELAY;
    this.openTimer = setTimeout(() => this.openNow(), delay);
  }

  private scheduleCloseIfIdle(): void {
    this.clearCloseTimer();
    this.closeTimer = setTimeout(() => {
      if (!this.hoveringHost && !this.hoveringBubble && !this.focusedOpen) this.close();
    }, SC_TOOLTIP_HOVER_GRACE);
  }

  private openNow(): void {
    this.clearOpenTimer();
    const text = this.scTooltip();
    if (!text || this.scTooltipDisabled()) return;
    if (this.overlayRef) return;

    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay
        .position()
        .flexibleConnectedTo(this.host.nativeElement)
        .withPositions(POSITIONS)
        .withPush(true),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      panelClass: 'sc-tooltip-panel',
      // Never blocks pointer events on the page — only the bubble itself
      // (via its own CSS) is interactive, everything else stays click-through.
      disposeOnNavigation: true,
    });

    const componentRef = overlayRef.attach(new ComponentPortal(ScTooltipComponent));
    componentRef.setInput('text', text);
    componentRef.setInput('tooltipId', this.uid);

    overlayRef.overlayElement.addEventListener('mouseenter', this.onBubbleEnter);
    overlayRef.overlayElement.addEventListener('mouseleave', this.onBubbleLeave);
    // Dismissible from anywhere, not only while the host has focus: a tooltip
    // opened by hover must close on Escape too (bubble phase, so the host's own
    // listener runs first and keeps a parent dialog's Escape for itself).
    document.addEventListener('keydown', this.onDocumentKeydown);

    this.overlayRef = overlayRef;
    this.bubble = componentRef;
    this.applyDescribedBy(text);
  }

  private close(): void {
    if (!this.overlayRef) return;
    this.disposeOverlay();
    this.removeDescribedBy();
    this.state.lastCloseAt = Date.now();
    this.clearAllTimers();
    if (this.isTouchOpen) {
      this.isTouchOpen = false;
      document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    }
  }

  private disposeOverlay(): void {
    if (!this.overlayRef) return;
    this.overlayRef.overlayElement.removeEventListener('mouseenter', this.onBubbleEnter);
    this.overlayRef.overlayElement.removeEventListener('mouseleave', this.onBubbleLeave);
    document.removeEventListener('keydown', this.onDocumentKeydown);
    this.overlayRef.dispose();
    this.overlayRef = null;
    this.bubble = null;
  }

  private readonly onDocumentKeydown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') this.close();
  };

  private readonly onBubbleEnter = (): void => {
    this.hoveringBubble = true;
    this.cancelCloseTimer();
  };

  private readonly onBubbleLeave = (): void => {
    this.hoveringBubble = false;
    this.scheduleCloseIfIdle();
  };

  /** Touch: any pointerdown elsewhere closes the open tooltip. */
  private readonly onDocumentPointerDown = (): void => {
    this.close();
  };

  // -- accessibility ---------------------------------------------------------

  private accessibleName(): string {
    const el = this.host.nativeElement;
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel?.trim()) return ariaLabel.trim();
    return el.textContent?.trim() ?? '';
  }

  /** Only set when the tooltip says something the accessible name doesn't
   *  already say — otherwise an icon button whose `aria-label` equals the
   *  tooltip text would have its name read twice. Pre-existing describedby
   *  ids are kept. */
  private applyDescribedBy(text: string): void {
    if (this.accessibleName() === text.trim()) return;
    const el = this.host.nativeElement;
    const existing = el.getAttribute('aria-describedby');
    const ids = existing ? existing.split(/\s+/).filter(Boolean) : [];
    if (!ids.includes(this.uid)) {
      ids.push(this.uid);
      el.setAttribute('aria-describedby', ids.join(' '));
    }
  }

  private removeDescribedBy(): void {
    const el = this.host.nativeElement;
    const existing = el.getAttribute('aria-describedby');
    if (!existing) return;
    const ids = existing.split(/\s+/).filter((id: string) => id && id !== this.uid);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  }

  // -- timers ----------------------------------------------------------------

  private clearOpenTimer(): void {
    if (this.openTimer === null) return;
    clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private cancelOpenTimer(): void {
    this.clearOpenTimer();
  }

  private clearCloseTimer(): void {
    if (this.closeTimer === null) return;
    clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  private cancelCloseTimer(): void {
    this.clearCloseTimer();
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer === null) return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private clearAllTimers(): void {
    this.clearOpenTimer();
    this.clearCloseTimer();
    this.clearLongPressTimer();
  }
}
