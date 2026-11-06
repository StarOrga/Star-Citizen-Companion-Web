import { InjectionToken } from '@angular/core';

/**
 * The Verse hub builds in three steps instead of one long frame: the stage and
 * the hero first, then the doors and the beacons, then the hub columns below
 * the fold. A menu hop reveals the page 420 ms after it rendered, so all three
 * steps stand before anything shows. `false` renders everything at once.
 */
export const VERSE_STAGED_BUILD = new InjectionToken<boolean>('VERSE_STAGED_BUILD', { factory: () => true });

/** Steps until the hub is complete. */
export const VERSE_BUILD_STEPS = 2;

/** A hidden tab draws no frames: the build goes on without waiting for one. */
export const AFTER_PAINT_FALLBACK_MS = 250;

/** Runs `run` once after the next painted frame; the result cancels it. */
export function afterPaint(run: () => void): () => void {
  let done = false;
  let task: ReturnType<typeof setTimeout> | undefined;
  const fire = (): void => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(fallback);
    run();
  };
  // A frame callback runs before that frame paints; the task after it runs behind the paint.
  const frame = requestAnimationFrame(() => (task = setTimeout(fire)));
  const fallback = setTimeout(fire, AFTER_PAINT_FALLBACK_MS);
  return () => {
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(fallback);
    clearTimeout(task);
  };
}
