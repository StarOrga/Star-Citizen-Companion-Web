/**
 * Stall watchdog — turns a *silent hang* into an observable event.
 *
 * The uploader's crash telemetry (see `main/telemetry-reporter`) only fires on
 * thrown errors: `uncaughtException`, `unhandledRejection`, forwarded renderer
 * crashes. A job that simply *stops making progress* — a Python extraction that
 * wedges, an upload socket that never resolves, a native tool that deadlocks —
 * throws nothing, so today it is invisible both to the operator and to
 * server-side telemetry. This is exactly the "hängt / timeouted, sendet keinen
 * Report" gap reported for the data-uploader.
 *
 * A watchdog is a dead-man's switch: callers `pet()` it on every sign of life
 * (a progress event, a chunk, a phase change). If `timeoutMs` passes without a
 * pet, `onTimeout` fires ONCE with the idle duration. The job itself is NOT
 * killed — the watchdog only *reports*; whether to cancel is the caller's call.
 *
 * Pure + injected timers (`setTimer`/`clearTimer` default to the global
 * `setTimeout`/`clearTimeout`) so it is unit-testable with fake clocks and has
 * no Electron/Node coupling.
 */

export interface WatchdogOptions {
  /** Idle time (ms) with no `pet()` before `onTimeout` fires. */
  timeoutMs: number;
  /** Fired at most once, with the elapsed idle time in ms. Must not throw. */
  onTimeout: (idleMs: number) => void;
  /** Injectable timer setter (defaults to global setTimeout). */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Injectable timer clearer (defaults to global clearTimeout). */
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface Watchdog {
  /** Start (or restart) the idle countdown. Call once when the job begins. */
  start: () => void;
  /** Signal progress — resets the countdown. No-op after a fire or stop. */
  pet: () => void;
  /** Stop for good — no further timeouts. Idempotent; call in `finally`. */
  stop: () => void;
  /** True once `onTimeout` has fired (so callers can label a late result). */
  timedOut: () => boolean;
}

export function createWatchdog(opts: WatchdogOptions): Watchdog {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));

  let handle: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let fired = false;

  const arm = (): void => {
    handle = setTimer(() => {
      handle = null;
      if (stopped || fired) return;
      fired = true;
      // Best-effort: a watchdog that itself throws would defeat the purpose.
      try {
        opts.onTimeout(opts.timeoutMs);
      } catch {
        /* swallow — reporting a stall must never create a new failure */
      }
    }, opts.timeoutMs);
  };

  const disarm = (): void => {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  };

  return {
    start(): void {
      if (stopped) return;
      disarm();
      arm();
    },
    pet(): void {
      // Once it has fired or been stopped, petting is meaningless — a single
      // stall report per job is the contract (no timeout storms).
      if (stopped || fired) return;
      disarm();
      arm();
    },
    stop(): void {
      stopped = true;
      disarm();
    },
    timedOut(): boolean {
      return fired;
    },
  };
}
