/**
 * Cooperative pause / resume / cancel for long multi-request jobs.
 *
 * The upload flow is a few hundred sequential HTTPS requests (catalog chunks,
 * skin PUTs). There is no way to *suspend* an in-flight fetch, so "pause" can
 * only mean: stop at the next safe boundary and remember where we were.
 *
 * ## Why pausing UNWINDS instead of blocking
 *
 * The obvious design is for `checkpoint()` to await until the operator resumes,
 * keeping the job's call stack alive. We deliberately do NOT do that, because
 * the feature's hard requirement is resuming after the process is *killed* —
 * and a live call stack cannot survive a kill. A blocking pause would therefore
 * need two separate mechanisms: one for pause (keep the stack) and one for
 * kill-resume (rebuild from disk). The kill path would then be the rare,
 * barely-exercised one — exactly the path that must not be broken.
 *
 * So pausing throws {@link PausedError}: the stack unwinds, the caller persists
 * its cursor, and resuming *replays from disk*. Pause and kill-resume become the
 * same code path, which means every ordinary pause exercises the kill-recovery
 * logic. Cancel unwinds identically via {@link CancelledError}, but the caller
 * discards the job instead of persisting it.
 *
 * Pure and Electron-free so it unit-tests without a browser or app instance.
 */

export type RunSignal = 'running' | 'paused' | 'cancelled';

/** Thrown at a checkpoint when the operator paused — the job state is kept. */
export class PausedError extends Error {
  override readonly name = 'PausedError';
  constructor() {
    super('job paused at checkpoint');
  }
}

/** Thrown at a checkpoint when the operator cancelled — the job is discarded. */
export class CancelledError extends Error {
  override readonly name = 'CancelledError';
  constructor() {
    super('job cancelled at checkpoint');
  }
}

export interface PauseControl {
  /** Current signal. */
  state(): RunSignal;
  /** Request a pause; the job stops at its next `checkpoint()`. */
  pause(): void;
  /** Clear a pause so this control can drive a fresh run. */
  resume(): void;
  /** Request cancellation; the job aborts at its next `checkpoint()`. */
  cancel(): void;
  /**
   * Call at a safe boundary (between chunks / files — never mid-request).
   * Returns normally while running; throws {@link PausedError} or
   * {@link CancelledError} otherwise.
   */
  checkpoint(): void;
  /** Subscribe to signal changes; returns an unsubscribe fn. */
  onChange(cb: (s: RunSignal) => void): () => void;
}

export function createPauseControl(initial: RunSignal = 'running'): PauseControl {
  let signal: RunSignal = initial;
  const listeners = new Set<(s: RunSignal) => void>();

  const set = (next: RunSignal): void => {
    if (signal === next) return;
    signal = next;
    for (const cb of listeners) {
      try {
        cb(next);
      } catch {
        /* a bad listener must never break job control */
      }
    }
  };

  return {
    state: () => signal,
    pause: () => {
      // Cancellation is terminal — a late pause must not revive a cancelled job.
      if (signal === 'cancelled') return;
      set('paused');
    },
    resume: () => {
      if (signal === 'cancelled') return;
      set('running');
    },
    cancel: () => set('cancelled'),
    checkpoint: () => {
      if (signal === 'cancelled') throw new CancelledError();
      if (signal === 'paused') throw new PausedError();
    },
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/** True for the two control-flow signals, so callers can tell them from real failures. */
export function isInterrupt(err: unknown): err is PausedError | CancelledError {
  return err instanceof PausedError || err instanceof CancelledError;
}
