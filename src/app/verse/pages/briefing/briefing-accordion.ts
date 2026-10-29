import { signal } from '@angular/core';

/** After the last (fast) movement the pointer has to stand still this long before its entry opens. */
export const ACC_REST_MS = 80;
/** A step of at most this many pixels is jitter: the pointer counts as standing still. */
export const ACC_MOVE_PX = 4;
/** Slower than this (px per ms) is a resting / creeping pointer, not a sweep. */
export const ACC_SLOW_PX_PER_MS = 0.2;
/** Two pointer samples further apart than this (ms) say nothing about speed. */
export const ACC_SAMPLE_MAX_MS = 150;
/** One open/close transition; a started one always runs to its end. */
export const ACC_TRANSITION_MS = 450;

/**
 * Hover intent for the hub's News accordion (exactly one entry open):
 *
 * - a pointer that stands still or creeps (a step within {@link ACC_MOVE_PX},
 *   or slower than {@link ACC_SLOW_PX_PER_MS}) opens its entry at once — no
 *   delay for a resting pointer;
 * - a pointer in fast motion starts nothing: the entry under it opens only
 *   when it has stopped for {@link ACC_REST_MS}, so a sweep across the rows
 *   toward another target does not react;
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
    this.clearRest();
    // Speed is only known from a recent previous sample; the first one of a burst arms the rest timer.
    const known = p !== null && t - p.t <= ACC_SAMPLE_MAX_MS;
    const dist = known ? Math.hypot(x - p.x, y - p.y) : Infinity;
    const slow = known && (dist <= ACC_MOVE_PX || dist / Math.max(1, t - p.t) <= ACC_SLOW_PX_PER_MS);
    if (slow) {
      this.request(i);
      return;
    }
    this.rest = setTimeout(() => {
      this.rest = null;
      this.request(i);
    }, ACC_REST_MS);
  }

  /** Pointer left the list: whatever is open stays open; a pending target is dropped. */
  leave(): void {
    this.last = null;
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
