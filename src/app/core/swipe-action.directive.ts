import {
  DestroyRef,
  Directive,
  ElementRef,
  NgZone,
  Renderer2,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

/** Which way a drag is heading — `null` while it is still below the threshold. */
export type SwipeIntent = 'left' | 'right';

/** Travel (px) the finger has to cover before a release commits the action. */
const COMMIT_PX = 96;
/** Travel (px) before the gesture claims the pointer at all. */
const CLAIM_PX = 14;
/** Vertical slop (px) that cancels the gesture — the page is being scrolled. */
const CANCEL_PX = 14;
/** How far the card flies out before the action fires. */
const FLY_PX = 420;
const FLY_MS = 200;

/**
 * Touch-only horizontal swipe on a card, as an ADDITION to the buttons that do
 * the same thing (admin feedback 3bc01a3d, "ggf. ein Tinder-Modus mit Swipe").
 *
 * Three rules make it safe to add rather than a trap:
 *
 * 1. **Touch only.** It reacts to `pointerType === 'touch'` and nothing else, so
 *    a mouse drag (text selection) and a pen are untouched, and no keyboard or
 *    pointer path is removed — every action it fires has a real `<button>` in
 *    the same card. The gesture is a shortcut, never the only way.
 * 2. **The page keeps the vertical axis.** The host must carry
 *    `touch-action: pan-y`; the gesture only claims the pointer once the
 *    horizontal travel beats {@link CLAIM_PX} AND stays ahead of the vertical,
 *    and it cancels outright the moment the finger moves {@link CANCEL_PX} down
 *    or up first. Scrolling a long thread therefore never arms it.
 * 3. **Nothing fires by accident.** {@link intent} goes live at
 *    {@link COMMIT_PX} — well past a stray flick — and the host renders a label
 *    for it, so what a release will do is on screen before the finger lifts.
 *    Dragging back below the threshold disarms it again.
 *
 * The directive owns no chrome: it publishes {@link intent} and
 * {@link dragging} and the host template draws whatever cue it wants from them.
 * The drag itself is painted straight onto the element, outside the Angular
 * zone — a gesture must not run change detection once per frame.
 */
@Directive({
  selector: '[scSwipeAction]',
  standalone: true,
  exportAs: 'scSwipeAction',
})
export class SwipeActionDirective {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly renderer = inject(Renderer2);
  private readonly zone = inject(NgZone);

  /** Master switch — a busy card must not be swiped into a second write. */
  readonly swipeEnabled = input(true);

  readonly swipeLeft = output<void>();
  readonly swipeRight = output<void>();

  /** The action a release would fire right now, or `null` while below threshold. */
  readonly intent = signal<SwipeIntent | null>(null);
  /** True from the moment the gesture claims the pointer until it settles. */
  readonly dragging = signal(false);

  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  /** null = undecided, false = cancelled for this pointer, true = claimed. */
  private claimed: boolean | null = null;

  constructor() {
    const el = this.host.nativeElement as HTMLElement;
    this.zone.runOutsideAngular(() => {
      el.addEventListener('pointerdown', this.onDown, { passive: true });
      el.addEventListener('pointermove', this.onMove, { passive: true });
      el.addEventListener('pointerup', this.onUp);
      el.addEventListener('pointercancel', this.onCancel);
    });
    inject(DestroyRef).onDestroy(() => {
      el.removeEventListener('pointerdown', this.onDown);
      el.removeEventListener('pointermove', this.onMove);
      el.removeEventListener('pointerup', this.onUp);
      el.removeEventListener('pointercancel', this.onCancel);
    });
  }

  /**
   * A pointerdown that started on something the user is actually operating —
   * typing in the composer, pressing a button, following a link, opening a
   * screenshot — is not a swipe. Checked on the event's target chain rather
   * than by stopping propagation in those controls, so nothing has to know this
   * directive exists.
   */
  private isInteractive(target: EventTarget | null): boolean {
    let node = target instanceof Element ? target : null;
    const host = this.host.nativeElement as HTMLElement;
    while (node && node !== host) {
      const tag = node.tagName;
      if (
        tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' ||
        tag === 'SELECT' || tag === 'LABEL' || tag === 'IMG'
      ) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || !this.swipeEnabled()) return;
    if (this.pointerId !== null) return;
    if (this.isInteractive(e.target)) return;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.claimed = null;
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;

    if (this.claimed === null) {
      if (Math.abs(dy) > CANCEL_PX && Math.abs(dy) > Math.abs(dx)) {
        // The finger is scrolling the page. Drop the gesture for good — not
        // just for this frame — so a diagonal scroll can never turn into a
        // decision halfway down.
        this.claimed = false;
        this.pointerId = null;
        return;
      }
      if (Math.abs(dx) < CLAIM_PX || Math.abs(dx) <= Math.abs(dy)) return;
      this.claimed = true;
      this.zone.run(() => this.dragging.set(true));
    }
    if (this.claimed !== true) return;

    // Resistance past the commit point: the card keeps following the finger but
    // slower, which reads as "this is as far as it goes".
    const over = Math.max(0, Math.abs(dx) - COMMIT_PX);
    const eased = Math.sign(dx) * (Math.min(Math.abs(dx), COMMIT_PX) + over * 0.35);
    this.paint(eased);

    // Only the two threshold CROSSINGS reach Angular — not every frame.
    const next: SwipeIntent | null = dx <= -COMMIT_PX ? 'left' : dx >= COMMIT_PX ? 'right' : null;
    if (next !== this.intent()) this.zone.run(() => this.intent.set(next));
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const decision = this.claimed === true ? this.intent() : null;
    this.pointerId = null;
    this.claimed = null;
    if (!decision) {
      this.settle();
      return;
    }
    this.fly(decision);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.claimed = null;
    this.settle();
  };

  /** Paint the drag straight onto the element — no signal, no change detection. */
  private paint(px: number): void {
    const el = this.host.nativeElement as HTMLElement;
    this.renderer.setStyle(el, 'transform', `translate3d(${px}px, 0, 0)`);
    this.renderer.setStyle(el, 'transition', 'none');
  }

  /** Spring back to rest — the release did not reach a decision. */
  private settle(): void {
    const el = this.host.nativeElement as HTMLElement;
    this.renderer.setStyle(el, 'transition', 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)');
    this.renderer.setStyle(el, 'transform', 'none');
    this.zone.run(() => {
      this.intent.set(null);
      this.dragging.set(false);
    });
  }

  /**
   * Send the card out the side it was dragged to, THEN fire. The action usually
   * swaps the card's content in place, so firing first would animate the next
   * topic off screen instead of the one that was decided.
   */
  private fly(intent: SwipeIntent): void {
    const el = this.host.nativeElement as HTMLElement;
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const done = () => {
      this.renderer.removeStyle(el, 'transition');
      this.renderer.removeStyle(el, 'transform');
      this.intent.set(null);
      this.dragging.set(false);
      if (intent === 'left') this.swipeLeft.emit();
      else this.swipeRight.emit();
    };
    if (reduced) {
      this.zone.run(done);
      return;
    }
    this.renderer.setStyle(el, 'transition', `transform ${FLY_MS}ms ease-in`);
    this.renderer.setStyle(
      el,
      'transform',
      `translate3d(${intent === 'left' ? -FLY_PX : FLY_PX}px, 0, 0)`,
    );
    setTimeout(() => this.zone.run(done), FLY_MS);
  }
}
