import { Injectable, computed, inject, signal } from '@angular/core';
import { FeedbackSpotService } from './feedback-spot.service';

/** A bare Ctrl/Alt must be held this long, alone, before the panel dissolves. */
export const PEEK_DELAY_MS = 150;

/**
 * Hold-to-dissolve (feedback #313): while the admin panel is open with a
 * composer and the admin HOLDS Ctrl or Alt, the panel fades out and lets
 * pointer events through, so the page behind can be hovered and Ctrl/Alt-
 * clicked as a reference. Released key, click, blur or any other key brings it
 * back.
 *
 * Typing shortcuts must not flash the panel (Ctrl+V, Ctrl+A, AltGr+Q = "@"
 * which German keyboards report as Ctrl+Alt): the dissolve starts only after
 * the bare modifier has been down for `PEEK_DELAY_MS`, and any other keydown
 * cancels it. The panel stays mounted (focus and draft are untouched); only
 * opacity and pointer-events change.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackPeekService {
  private readonly spots = inject(FeedbackSpotService);
  private readonly _peeking = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Only an open admin panel with a composer mounted has anything to dissolve for. */
  private readonly armed = computed(() => this.spots.owner() === 'admin' && this.spots.composerCount() > 0);

  /** The panel is dissolved right now. */
  readonly peeking = computed(() => this._peeking() && this.armed());

  /** Attach the document listeners. Returns the detach function. */
  listen(): () => void {
    if (typeof document === 'undefined') return () => undefined;
    const down = (e: KeyboardEvent) => this.onKeyDown(e);
    const up = (e: KeyboardEvent) => this.onKeyUp(e);
    const end = () => this.end();
    const hidden = () => {
      if (document.visibilityState === 'hidden') this.end();
    };
    document.addEventListener('keydown', down, true);
    document.addEventListener('keyup', up, true);
    // The click that picks the element ends the dissolve (the capture
    // handler runs on the same event).
    document.addEventListener('click', end, true);
    window.addEventListener('blur', end);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('keydown', down, true);
      document.removeEventListener('keyup', up, true);
      document.removeEventListener('click', end, true);
      window.removeEventListener('blur', end);
      document.removeEventListener('visibilitychange', hidden);
      this.end();
    };
  }

  onKeyDown(e: KeyboardEvent): void {
    const bare = (e.key === 'Control' || e.key === 'Alt') && !e.shiftKey && !e.metaKey;
    // AltGr: Windows reports it as Ctrl+Alt, the key itself is "AltGraph".
    const altGr = e.key === 'AltGraph' || e.getModifierState?.('AltGraph') === true;
    // A held modifier keeps firing keydown (repeat): only a fresh press may arm
    // the dissolve, and a repeat must not end it either.
    if (bare && e.repeat) return;
    if (!bare || altGr) {
      this.end();
      return;
    }
    if (!this.armed() || this._peeking() || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.armed()) this._peeking.set(true);
    }, PEEK_DELAY_MS);
  }

  onKeyUp(e: KeyboardEvent): void {
    if (e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'AltGraph') return;
    if (e.ctrlKey || e.altKey) return; // the other modifier is still down
    this.end();
  }

  /** Bring the panel back and forget a pending dissolve. */
  end(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this._peeking()) this._peeking.set(false);
  }
}
