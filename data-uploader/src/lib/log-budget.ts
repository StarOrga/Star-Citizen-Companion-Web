/**
 * Bounded forwarding of the Python sidecar's `log` events. A build can emit
 * thousands of per-entity info lines; warn/error are rare and always worth
 * keeping, info is kept only up to a cap so neither the DOM log drawer nor
 * main.log floods. `take` says whether a line goes through; `dropped` counts
 * what the cap swallowed so the caller can say so once.
 */
export interface LogBudget {
  take(level: string | undefined): boolean;
  readonly dropped: number;
}

export function createLogBudget(infoCap: number): LogBudget {
  let infos = 0;
  let dropped = 0;
  return {
    take(level) {
      if (level === 'warn' || level === 'error') return true;
      if (infos < infoCap) {
        infos += 1;
        return true;
      }
      dropped += 1;
      return false;
    },
    get dropped() {
      return dropped;
    },
  };
}

/** Minimal shape of a sidecar event the heartbeat reads. */
export interface HeartbeatEvent {
  type: string;
  stage?: string;
  phase?: string;
  current?: number;
  total?: number;
  detail?: string;
}

/**
 * Throttled "still alive" line for long jobs. The sidecar emits progress many
 * times a second; main.log gets one line per `intervalMs` (the latest position)
 * so a multi-hour job leaves a trail an operator can read - the 2026-11-11 skin
 * job logged nothing for 100 minutes. Returns null when it is not yet time.
 */
export function createHeartbeat(
  label: string,
  intervalMs: number,
  now: () => number = Date.now,
): (ev: HeartbeatEvent) => string | null {
  let last = now();
  return (ev) => {
    if (ev.type !== 'progress' && ev.type !== 'phase') return null;
    const t = now();
    if (t - last < intervalMs) return null;
    last = t;
    const where = ev.stage ?? ev.phase ?? 'working';
    const pos = ev.current !== undefined ? ` ${ev.current}${ev.total !== undefined ? `/${ev.total}` : ''}` : '';
    const detail = ev.detail ? ` - ${ev.detail}` : '';
    return `[${label}] still running: ${where}${pos}${detail}`;
  };
}
