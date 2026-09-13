import { DOCUMENT, Injectable, inject } from '@angular/core';

/** How long a row takes to fold away (ms) — matched by `fb-arrive` on the other side. */
export const LEAVE_MS = 320;
/** How long a one-time highlight stays visible before its class is dropped (ms). */
export const HIGHLIGHT_MS = 1_800;

/**
 * The board's motion helpers (admin feedback cf74472a): the JS side of the
 * few effects CSS alone cannot do — folding a row out of a band before the
 * data that removes it lands, and the timers behind one-time highlights.
 *
 * Everything here honours `prefers-reduced-motion`: a reduced viewer gets the
 * end state at once, never a shortened version of the movement. The CSS
 * keyframes in the component are already clamped to 0.01 ms by the global
 * rule in `styles.scss`; this service keeps the JS-driven waits in step so a
 * reduced viewer is not left staring at a frozen row for 320 ms.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackMotionService {
  private readonly doc = inject(DOCUMENT);

  /** True when the user asked the OS/browser to cut animation down. */
  get reducedMotion(): boolean {
    const win = this.doc.defaultView;
    if (!win?.matchMedia) return false;
    try {
      return win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  /**
   * Fold a row out of its list: height, padding and the flex gap under it go
   * to zero while it fades and slides slightly right — the way a card is
   * swiped off a stack. Resolves when the fold is done (at once for reduced
   * motion or when there is nothing to animate). The element is left in its
   * folded state; the caller removes it from the data right after.
   */
  collapse(el: HTMLElement | null): Promise<void> {
    if (!el || !el.isConnected || typeof el.animate !== 'function') return Promise.resolve();
    const gap = this.gapBelow(el);
    if (this.reducedMotion) {
      el.style.visibility = 'hidden';
      return Promise.resolve();
    }
    const from = { height: `${el.offsetHeight}px`, opacity: 1, transform: 'none', marginBottom: '0px' };
    const to = {
      height: '0px',
      paddingTop: '0px',
      paddingBottom: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      opacity: 0,
      transform: 'translateX(18px)',
      marginBottom: `-${gap}px`,
    };
    el.style.overflow = 'hidden';
    el.style.pointerEvents = 'none';
    try {
      const anim = el.animate([from, to], { duration: LEAVE_MS, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' });
      return anim.finished.then(
        () => undefined,
        () => undefined,
      );
    } catch {
      return Promise.resolve();
    }
  }

  /** Undo {@link collapse} on a row that stays after all (the write failed). */
  restore(el: HTMLElement | null): void {
    if (!el) return;
    try {
      el.getAnimations?.().forEach((a) => a.cancel());
    } catch {
      /* no WAAPI */
    }
    el.style.overflow = '';
    el.style.pointerEvents = '';
    el.style.visibility = '';
  }

  /** Bring a row into view before it moves — the viewer sees WHERE it leaves from. */
  reveal(el: HTMLElement | null): void {
    if (!el || typeof el.scrollIntoView !== 'function') return;
    try {
      el.scrollIntoView({ block: 'nearest', behavior: this.reducedMotion ? 'auto' : 'smooth' });
    } catch {
      /* older engines take no options object */
    }
  }

  /** The row gap of the flex column an element sits in, in px (0 when unknown). */
  private gapBelow(el: HTMLElement): number {
    const parent = el.parentElement;
    const win = this.doc.defaultView;
    if (!parent || !win) return 0;
    const raw = win.getComputedStyle(parent).rowGap;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  }
}
