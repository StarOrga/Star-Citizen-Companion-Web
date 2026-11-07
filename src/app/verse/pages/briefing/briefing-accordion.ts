import { signal } from '@angular/core';

/** The pointer has to stand still this long over an entry before it opens (reaction delay: 80 ms x 1/0.3). */
export const ACC_REST_MS = 267;
/** A step of at most this many pixels is jitter: the pointer counts as standing still. */
export const ACC_MOVE_PX = 4;
/** One open/close transition; a started one always runs to its end. Same value as --acc-t in briefing-hub.component.scss. */
export const ACC_TRANSITION_MS = 450;

/**
 * Hover intent for the hub's News accordion (exactly one entry open):
 *
 * - the entry under the pointer opens only after the pointer has rested on it
 *   for {@link ACC_REST_MS} (jitter within {@link ACC_MOVE_PX} does not restart
 *   that wait), so neither a sweep across the rows nor a slow creep reacts at once;
 * - a started transition ({@link ACC_TRANSITION_MS}) always completes; a new
 *   target waits for its end and starts then — or is dropped cleanly when the
 *   pointer moved on in between;
 * - leaving the list keeps whatever is open open (no return to the newest).
 *
 * Keyboard focus opens its entry at once (same no-abort rule).
 */
export class AccordionIntent {
  readonly open = signal(0);
  private last: { x: number; y: number; t: number } | null = null;
  private rest: ReturnType<typeof setTimeout> | null = null;
  private busy: ReturnType<typeof setTimeout> | null = null;
  private restFor = -1;
  private queued: number | null = null;

  constructor(initial = 0) {
    this.open.set(initial);
  }

  /** Pointer moved over entry `i` (client coordinates, `t` in ms). */
  move(i: number, x: number, y: number, t = Date.now()): void {
    const p = this.last;
    this.last = { x, y, t };
    // Moving on: a target that waited for the running transition is dropped.
    if (this.queued !== null && this.queued !== i) this.queued = null;
    // Jitter on the same entry keeps the running rest wait.
    const jitter = p !== null && this.restFor === i && Math.hypot(x - p.x, y - p.y) <= ACC_MOVE_PX;
    if (jitter && this.rest) return;
    this.clearRest();
    this.restFor = i;
    this.rest = setTimeout(() => {
      this.rest = null;
      this.request(i);
    }, ACC_REST_MS);
  }

  /** Pointer left the list: whatever is open stays open; a pending target is dropped. */
  leave(): void {
    this.last = null;
    this.restFor = -1;
    this.clearRest();
    this.queued = null;
  }

  /** Keyboard focus on entry `i`. */
  focus(i: number): void {
    this.clearRest();
    this.request(i);
  }

  /** True while a transition runs (exposed for specs). */
  get transitioning(): boolean {
    return this.busy !== null;
  }

  destroy(): void {
    this.clearRest();
    if (this.busy) clearTimeout(this.busy);
    this.busy = null;
    this.queued = null;
  }

  private request(i: number): void {
    if (this.busy) {
      this.queued = i === this.open() ? null : i;
      return;
    }
    if (i === this.open()) return;
    this.open.set(i);
    this.busy = setTimeout(() => {
      this.busy = null;
      const q = this.queued;
      this.queued = null;
      if (q !== null) this.request(q);
    }, ACC_TRANSITION_MS);
  }

  private clearRest(): void {
    if (this.rest) clearTimeout(this.rest);
    this.rest = null;
  }
}
