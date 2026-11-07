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
 * cancels it. Ctrl and Alt are interchangeable and may overlap: the panel
 * stays dissolved while either one is held, whatever the press/release order.
 * The panel stays mounted (focus and draft are untouched); only
 * opacity and pointer-events change.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackPeekService {
  private readonly spots = inject(FeedbackSpotService);
  private readonly _peeking = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Set by a typing chord, AltGr or the pick click: a remaining held modifier must not re-dissolve. */
  private suppressed = false;

  /** Only an open admin panel with a composer mounted has anything to dissolve for. */
  private readonly armed = computed(() => this.spots.owner() === 'admin' && this.spots.composerCount() > 0);

  /** The panel is dissolved right now. */
  readonly peeking = computed(() => this._peeking() && this.armed());

  /** Attach the document listeners. Returns the detach function. */
  listen(): () => void {
    if (typeof document === 'undefined') return () => undefined;
    const down = (e: KeyboardEvent) => this.onKeyDown(e);
    const up = (e: KeyboardEvent) => this.onKeyUp(e);
    const pick = () => this.pick();
    const end = () => this.reset();
    const hidden = () => {
      if (document.visibilityState === 'hidden') this.reset();
    };
    document.addEventListener('keydown', down, true);
    document.addEventListener('keyup', up, true);
    // The click that picks the element ends the dissolve (the capture
    // handler runs on the same event).
    document.addEventListener('click', pick, true);
    window.addEventListener('blur', end);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('keydown', down, true);
      document.removeEventListener('keyup', up, true);
      document.removeEventListener('click', pick, true);
      window.removeEventListener('blur', end);
      document.removeEventListener('visibilitychange', hidden);
      this.reset();
    };
  }

  onKeyDown(e: KeyboardEvent): void {
    // AltGr (Windows reports it as Ctrl+Alt, the key itself is "AltGraph") is
    // a typing key: restore and do not re-dissolve from it until a fresh press.
    if (e.key === 'AltGraph') {
      this.suppressed = true;
      this.end();
      return;
    }
    const modifier = e.key === 'Control' || e.key === 'Alt';
    if (!modifier || e.shiftKey || e.metaKey) {
      this.suppressed = true;
      this.end();
      return;
    }
    // A held modifier keeps firing keydown (repeat): only a fresh press may arm
    // the dissolve, and a repeat must not end it either.
    if (e.repeat) return;
    // A fresh press of Ctrl or Alt is a new intent, whatever else is held.
    this.suppressed = false;
    this.arm();
  }

  onKeyUp(e: KeyboardEvent): void {
    if (e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'AltGraph') return;
    // The flags on a keyup describe what is still held after this release, so
    // the order of the presses does not matter (Alt down, Ctrl down, Alt up:
    // Ctrl keeps the panel dissolved).
    if (!e.ctrlKey && !e.altKey) {
      this.suppressed = false;
      this.end();
      return;
    }
    if (!this.suppressed) this.arm();
  }

  /** The click that picks: restore, and stay restored until a fresh press. */
  private pick(): void {
    this.suppressed = true;
    this.end();
  }

  private reset(): void {
    this.suppressed = false;
    this.end();
  }

  private arm(): void {
    if (!this.armed() || this._peeking() || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.armed()) this._peeking.set(true);
    }, PEEK_DELAY_MS);
  }

  /** Bring the panel back and forget a pending dissolve. */
  end(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this._peeking()) this._peeking.set(false);
  }
}
