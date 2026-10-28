import { signal } from '@angular/core';

/** The pointer has to rest this long on an entry before it opens. */
export const ACC_REST_MS = 200;
/** Movement below this many pixels still counts as resting. */
export const ACC_MOVE_PX = 2;
/** One open/close transition; a started one always runs to its end. */
export const ACC_TRANSITION_MS = 450;

/**
 * Hover intent for the hub's News accordion (exactly one entry open):
 *
 * - an entry opens only after the pointer came to rest on it for
 *   {@link ACC_REST_MS} — measured from the moment it stopped moving (no
 *   movement beyond {@link ACC_MOVE_PX}), not from the first touch;
 * - a quick sweep across the rows starts nothing: while the pointer moves,
 *   the current state stays;
 * - a started transition ({@link ACC_TRANSITION_MS}) always completes; a new
 *   target waits for its end and starts then — or is dropped cleanly when the
 *   pointer moved on in between;
 * - leaving the list returns to the newest entry under the same rules.
 *
 * Keyboard focus opens its entry at once (same no-abort rule).
 */
export class AccordionIntent {
  readonly open = signal(0);
  private anchor: { i: number; x: number; y: number } | null = null;
  private rest: ReturnType<typeof setTimeout> | null = null;
  private busy: ReturnType<typeof setTimeout> | null = null;
  private queued: number | null = null;

  constructor(private readonly home = 0) {}

  /** Pointer moved over entry `i` (client coordinates). */
  move(i: number, x: number, y: number): void {
    const a = this.anchor;
    if (a && a.i === i && Math.hypot(x - a.x, y - a.y) <= ACC_MOVE_PX) return;
    this.anchor = { i, x, y };
    // Moving on: a target that waited for the running transition is dropped.
    if (this.queued !== null && this.queued !== i) this.queued = null;
    this.clearRest();
    this.rest = setTimeout(() => {
      this.rest = null;
      this.request(i);
    }, ACC_REST_MS);
  }

  /** Pointer left the list: back to the newest entry. */
  leave(): void {
    this.anchor = null;
    this.clearRest();
    this.request(this.home);
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
