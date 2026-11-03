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
