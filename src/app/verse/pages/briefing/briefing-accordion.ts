import { signal } from '@angular/core';

/**
 * Speed (px/ms) at or below which the pointer counts as "aiming" at the entry under it, which then opens at once.
 * The rows are ~3.4 × --u tall (≈ 50–60 px) and the list spans ≈ 300 px: a normal sweep from the bottom row to the top
 * crosses it in ≈ 250–300 ms, i.e. ≈ 1 px/ms. A slow, deliberate move is ≈ 30 % of that, so 0.3 px/ms; a pointer
 * decelerating onto its target passes below it on the last few pixels anyway.
 */
export const ACC_SLOW_PX_PER_MS = 0.3;
/** Pointer speed is measured over the samples of this window (always at least the previous one). */
export const ACC_SPEED_WINDOW_MS = 80;
/** No pointermove fires while the pointer stands still: after this pause on an entry it counts as stopped and opens. */
export const ACC_STOP_MS = 50;
/** A net movement of at most this many pixels inside the window is jitter: the pointer counts as standing still. */
export const ACC_MOVE_PX = 4;
/** One open/close transition; a started one always runs to its end. Same value as --acc-t in briefing-hub.component.scss. */
export const ACC_TRANSITION_MS = 450;

/**
 * Hover intent for the hub's News accordion (exactly one entry open):
 *
 * - the intent is the pointer's speed, not a dwell time: the entry under the
 *   pointer opens at once when the pointer moves slowly over it (at most
 *   {@link ACC_SLOW_PX_PER_MS}, measured over {@link ACC_SPEED_WINDOW_MS}) or
 *   stops on it ({@link ACC_STOP_MS} without a further move); a fast sweep
 *   across the rows opens nothing. Jitter within {@link ACC_MOVE_PX} counts as
 *   standing still;
 * - a started transition ({@link ACC_TRANSITION_MS}) always completes; a new
 *   target waits for its end and starts then — or is dropped cleanly when the
 *   pointer moved on in between;
 * - leaving the list keeps whatever is open open (no return to the newest).
 *
 * Keyboard focus opens its entry at once (same no-abort rule).
 */
export class AccordionIntent {
  readonly open = signal(0);
  private samples: { x: number; y: number; t: number }[] = [];
  private stop: ReturnType<typeof setTimeout> | null = null;
  private busy: ReturnType<typeof setTimeout> | null = null;
  private queued: number | null = null;

  constructor(initial = 0) {
    this.open.set(initial);
  }

  /** Pointer moved over entry `i` (client coordinates, `t` in ms — the event's timeStamp). */
  move(i: number, x: number, y: number, t = performance.now()): void {
    // Moving on: a target that waited for the running transition is dropped.
    if (this.queued !== null && this.queued !== i) this.queued = null;
    const slow = this.sample(x, y, t);
    this.clearStop();
    if (slow) {
      this.request(i);
      return;
    }
    this.stop = setTimeout(() => {
      this.stop = null;
      this.request(i);
    }, ACC_STOP_MS);
  }

  /** Pointer left the list: whatever is open stays open; a pending target is dropped. */
  leave(): void {
    this.samples = [];
    this.clearStop();
    this.queued = null;
  }

  /** Keyboard focus on entry `i`. */
  focus(i: number): void {
    this.clearStop();
    this.request(i);
  }

  /** True while a transition runs (exposed for specs). */
  get transitioning(): boolean {
    return this.busy !== null;
  }

  destroy(): void {
    this.clearStop();
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

  /**
   * Records a sample and tells whether the pointer is slow: net distance over the window (at least back to the
   * previous sample) divided by its duration, capped at the window. The first sample after entering the list has no speed yet.
   */
  private sample(x: number, y: number, t: number): boolean {
    const keep = this.samples.filter((s) => t - s.t <= ACC_SPEED_WINDOW_MS);
    const prev = this.samples[this.samples.length - 1];
    if (prev && !keep.includes(prev)) keep.push(prev);
    const from = keep[0];
    keep.push({ x, y, t });
    this.samples = keep;
    if (!from) return false;
    const dist = Math.hypot(x - from.x, y - from.y);
    if (dist <= ACC_MOVE_PX) return true;
    // After a pause the gap says nothing about the new move: it counts as at most one window long.
    return dist / Math.min(ACC_SPEED_WINDOW_MS, Math.max(1, t - from.t)) <= ACC_SLOW_PX_PER_MS;
  }

  private clearStop(): void {
    if (this.stop) clearTimeout(this.stop);
    this.stop = null;
  }
}
